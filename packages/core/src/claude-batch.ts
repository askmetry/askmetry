// Claude über die Message Batches API (POST /v1/messages/batches): −50 % auf Tokens, Websuche unterstützt.
// Hier nur Transport (Einreichen, Status, Ergebnisse) und die Einordnung einzelner Ergebnisse; den Ablauf in der
// Datenbank (Runs einreichen, später abholen, speichern, auswerten) steuert runner.ts.
// Doku: https://platform.claude.com/docs/en/build-with-claude/batch-processing
import Anthropic from '@anthropic-ai/sdk';
import { addClaudeUsage, emptyClaudeUsage, parseClaudeContent, type ClaudeResume, type ClaudeUsage } from './engines/claude.ts';
import { EngineError, isTransientStatus } from './errors.ts';
import { costFromUsage } from './pricing.ts';
import type { EngineResult } from './types.ts';

export interface BatchRequest {
  /** ^[a-zA-Z0-9_-]{1,64}$ – wir nutzen die Run-ID (UUID, 36 Zeichen) */
  custom_id: string;
  params: Record<string, unknown>;
}

export interface BatchInfo {
  id: string;
  /** in_progress → (canceling) → ended */
  processing_status: 'in_progress' | 'canceling' | 'ended' | string;
  created_at?: string;
  ended_at?: string | null;
  expires_at?: string | null;
  request_counts?: Record<string, number>;
}

/** Eine Zeile der Ergebnisdatei (.jsonl); Reihenfolge beliebig → immer über custom_id zuordnen. */
export interface BatchResultLine {
  custom_id: string;
  result:
    | { type: 'succeeded'; message: any }
    | { type: 'errored'; error: any }
    | { type: 'canceled' }
    | { type: 'expired' };
}

export interface BatchTransport {
  submit(requests: BatchRequest[]): Promise<BatchInfo>;
  retrieve(batchId: string): Promise<BatchInfo>;
  results(batchId: string): AsyncIterable<BatchResultLine>;
  /** Batches des API-Workspaces, neueste zuerst (GET /v1/messages/batches, seitenweise) – zum Zuordnen unklarer Einreichungen */
  list(): AsyncIterable<BatchInfo>;
}

/** Anzahl Anfragen eines Batches (Summe aller request_counts) */
export const batchRequestTotal = (b: BatchInfo) => Object.values(b.request_counts ?? {}).reduce((a, n) => a + (Number(n) || 0), 0);

/** SDK-Fehler (APIError mit status) als EngineError: 429/5xx/Netzwerk wiederholbar, 4xx nicht. */
function asEngineError(e: unknown, what: string): EngineError {
  if (e instanceof EngineError) return e;
  const status = typeof (e as any)?.status === 'number' ? (e as any).status as number : undefined;
  const msg = ((e as Error)?.message ?? String(e)).slice(0, 300);
  return new EngineError(`Claude-Batch ${what}: ${status ?? ''} ${msg}`.replace(/\s+/g, ' ').trim(), {
    status, retryable: isTransientStatus(status) && !/credit balance/i.test(msg), cause: e,
  });
}

let client: Anthropic | undefined;

/**
 * Transport über das Anthropic-SDK (bereits Abhängigkeit des Projekts, kein neues Paket).
 * maxRetries 0: ein wiederholtes Einreichen nach Zeitüberschreitung könnte einen zweiten (bezahlten) Batch anlegen;
 * Statusabfragen holt der nächste Worker-Durchgang ohnehin nach.
 */
export function anthropicBatchTransport(): BatchTransport {
  const c = () => (client ??= new Anthropic({ maxRetries: 0 }));
  return {
    async submit(requests) {
      try {
        // feste Obergrenze: danach gilt das Einreichen als unklar und wird über list() zugeordnet (SUBMIT_GRACE_MS)
        return await c().messages.batches.create({ requests } as any, { timeout: 120_000 }) as unknown as BatchInfo;
      } catch (e) { throw asEngineError(e, 'Einreichen'); }
    },
    async retrieve(id) {
      try {
        return await c().messages.batches.retrieve(id) as unknown as BatchInfo;
      } catch (e) { throw asEngineError(e, 'Status'); }
    },
    async *results(id) {
      let it: AsyncIterable<any>;
      try { it = await c().messages.batches.results(id); } catch (e) { throw asEngineError(e, 'Ergebnisse'); }
      for await (const line of it) yield line as BatchResultLine;
    },
    async *list() {
      try {
        for await (const b of c().messages.batches.list({ limit: 100 })) yield b as unknown as BatchInfo;
      } catch (e) { throw asEngineError(e, 'Liste'); }
    },
  };
}

export type BatchOutcome =
  /** fertige Antwort (gleiche Auswertung wie synchron) */
  | { kind: 'result'; result: EngineResult }
  /** Batch-Antwort braucht einen synchronen Nachgang: pause_turn fortsetzen bzw. Ablehnung mit Server-Fallback neu stellen */
  | { kind: 'resume'; resume: ClaudeResume; batchCostUsd: number }
  /** kein Ergebnis (nicht berechnet): errored, expired, canceled */
  | { kind: 'error'; message: string; retryable: boolean };

/** Ergebniszeile eines Batches einordnen. */
export function classifyBatchResult(line: BatchResultLine, fallbackModel: string): BatchOutcome {
  const r = line.result as any;
  switch (r?.type) {
    case 'succeeded': {
      const msg = r.message ?? {};
      const usage: ClaudeUsage = { ...emptyClaudeUsage(), batch: true };
      addClaudeUsage(usage, msg.usage);
      const model = msg.model ?? fallbackModel;
      const content = Array.isArray(msg.content) ? msg.content : [];
      // Ablehnung nur neu stellen, wo der synchrone Weg einen Server-Fallback hat (nicht Haiku) – sonst wie synchron speichern
      const reask = msg.stop_reason === 'refusal' && !String(model).includes('haiku');
      if (msg.stop_reason === 'pause_turn' || reask) {
        return {
          kind: 'resume', resume: { kind: msg.stop_reason, content, usage, raw: msg },
          batchCostUsd: costFromUsage({ engine: 'claude', model, usage }),
        };
      }
      return {
        kind: 'result',
        result: parseClaudeContent({
          content, stopReason: msg.stop_reason, stopDetails: msg.stop_details, model, usage,
          raw: { ...msg, batch: { kind: 'batch' } },
        }),
      };
    }
    case 'errored': {
      // { type: 'error', error: { type: 'invalid_request_error' | 'api_error' | 'overloaded_error' | …, message } }
      const err = r.error?.error ?? r.error ?? {};
      const type = String(err.type ?? 'unbekannt');
      const retryable = !/invalid_request|authentication|permission|not_found|request_too_large/.test(type);
      return { kind: 'error', message: `Claude-Batch: ${type}: ${String(err.message ?? '').slice(0, 300)}`.trim(), retryable };
    }
    case 'expired':
      return { kind: 'error', message: 'Claude-Batch: Anfrage nach 24 h abgelaufen (expired)', retryable: true };
    case 'canceled':
      return { kind: 'error', message: 'Claude-Batch: Anfrage abgebrochen (canceled)', retryable: true };
    default:
      return { kind: 'error', message: `Claude-Batch: unbekanntes Ergebnis ${JSON.stringify(r?.type ?? null)}`, retryable: true };
  }
}
