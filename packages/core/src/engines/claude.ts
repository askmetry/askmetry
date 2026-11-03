// Claude: Messages API (beta) + web_search. Synchron hier, asynchron über die Message Batches API in ../claude-batch.ts –
// beide nutzen dieselben Anfrage-Parameter (claudeParams) und dieselbe Auswertung (parseClaudeContent).
import Anthropic from '@anthropic-ai/sdk';
import { EngineError, withCost } from '../errors.ts';
import { costFromUsage } from '../pricing.ts';
import type { Engine, EngineCitation, EngineResult, RunContext } from '../types.ts';
import { mergeCitedAndSearched } from '../util.ts';

let client: Anthropic | undefined;

export interface ClaudeOptions {
  model?: string;
  effort?: string;
  maxSearches?: number;
  system?: string;
  /** geplante Messungen über die Message Batches API (−50 % auf Tokens); manuelle Messungen bleiben synchron */
  batch?: boolean;
}

export const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-5-5';

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  server_tool_use: { web_search_requests: number };
  /** Tokens zu Batch-Preisen abgerechnet (−50 %) */
  batch?: boolean;
  /** synchron (Normalpreis) nachgeholter Teil einer Batch-Antwort (pause_turn-Fortsetzung oder Ablehnung) */
  sync?: ClaudeUsage;
}

export const emptyClaudeUsage = (): ClaudeUsage => ({
  input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: 0 },
});

export function addClaudeUsage(usage: ClaudeUsage, u: any) {
  usage.input_tokens += u?.input_tokens ?? 0;
  usage.output_tokens += u?.output_tokens ?? 0;
  usage.cache_creation_input_tokens += u?.cache_creation_input_tokens ?? 0;
  usage.cache_read_input_tokens += u?.cache_read_input_tokens ?? 0;
  usage.server_tool_use.web_search_requests += u?.server_tool_use?.web_search_requests ?? 0;
}

/**
 * Anfrage-Parameter – synchron und im Batch identisch (Modell, Denktiefe, Websuche, Such-Anweisung).
 * Nicht enthalten: der Server-Fallback (`fallbacks` + Beta-Header), den die Batches API ablehnt; ihn ergänzt nur der
 * synchrone Weg (syncExtras).
 */
export function claudeParams(prompt: string, ctx: Pick<RunContext, 'country' | 'options'>, messages?: any[]) {
  const o = (ctx.options ?? {}) as ClaudeOptions;
  const model = o.model ?? CLAUDE_DEFAULT_MODEL;
  return {
    model,
    max_tokens: 16000,
    output_config: { effort: o.effort ?? 'medium' },
    tools: [{
      type: 'web_search_20260209', name: 'web_search', max_uses: o.maxSearches ?? 5,
      user_location: { type: 'approximate', country: ctx.country },
    }],
    ...(o.system && { system: o.system }),
    messages: messages ?? [{ role: 'user', content: prompt }],
  };
}

/** Server-Fallback nur für Modelle, die ihn unterstützen (nicht Haiku) – nur synchron, im Batch nicht erlaubt. */
const syncExtras = (model: string) =>
  (!model.includes('haiku') ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {});

/** Antwort, Quellen und Ablehnung aus den gesammelten Inhaltsblöcken – gleiche Auswertung für synchron und Batch. */
export function parseClaudeContent(input: {
  content: any[]; stopReason: string | null | undefined; stopDetails?: any; model: string; usage: ClaudeUsage; raw: any;
}): EngineResult {
  let answer = '';
  const cited: EngineCitation[] = [];
  const searched: EngineCitation[] = [];
  for (const block of input.content) {
    if (block.type === 'text') {
      answer += block.text;
      for (const c of block.citations ?? []) if (c.url) cited.push({ url: c.url, title: c.title, kind: 'cited' });
    }
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) searched.push({ url: r.url, title: r.title, kind: 'searched' });
    }
  }
  // Zitierte Quellen als 'cited', alle übrigen durchsuchten zusätzlich als 'searched'
  // (Kennzahlen nutzen cited, falls vorhanden, sonst searched – siehe CONTRACT.md)
  return {
    engine: 'claude', model: input.model, answer,
    citations: mergeCitedAndSearched(cited, searched),
    noAiAnswer: false, usage: input.usage as unknown as Record<string, unknown>,
    // Ablehnung: als Antwort mit answer_type 'refusal' speichern, nicht wiederholen
    refusal: input.stopReason === 'refusal' ? `Claude refusal: ${input.stopDetails?.category ?? 'unbekannt'}` : null,
    costUsd: costFromUsage({ engine: 'claude', model: input.model, usage: input.usage }),
    raw: { ...input.raw, content: input.content },
  };
}

/**
 * Fortsetzung einer Batch-Antwort (RunContext.claudeResume): bisherige Inhalte und Verbrauch (zu Batch-Preisen).
 * pause_turn → synchron weiterführen; refusal → synchron mit Server-Fallback neu stellen (wie eine synchrone Messung).
 */
export interface ClaudeResume {
  kind: 'pause_turn' | 'refusal';
  content: any[];
  usage: ClaudeUsage;
  raw: any;
}

export const claude: Engine = {
  key: 'claude',
  provider: 'anthropic',
  enabled: () => !!process.env.ANTHROPIC_API_KEY,
  async run(prompt, ctx) {
    // keine SDK-Wiederholungen: der Runner ist die einzige Wiederholungsebene
    client ??= new Anthropic({ maxRetries: 0 });
    const resume = ctx.claudeResume as ClaudeResume | undefined;
    const base = claudeParams(prompt, ctx);
    const model = base.model;
    const messages: any[] = [{ role: 'user', content: prompt }];
    const allContent: any[] = [];
    if (resume?.kind === 'pause_turn') {
      allContent.push(...resume.content);
      messages.push({ role: 'assistant', content: resume.content });
    }
    let raw: any;
    const usage = emptyClaudeUsage();
    // Batch-Anteil zu Batch-Preisen, synchroner Rest zum Normalpreis
    const total = (): ClaudeUsage => (resume ? { ...resume.usage, batch: true, sync: usage } : usage);
    // Fehlerkosten nur für den synchronen Teil: den bezahlten Batch-Anteil verbucht der Runner genau einmal
    const syncCost = () => costFromUsage({ engine: 'claude', model: raw?.model ?? model, usage });
    // pause_turn: lange Websuche-Turns fortsetzen; Inhalte und Verbrauch aller Teil-Antworten sammeln
    try {
      for (let i = 0; i < 4; i++) {
        const params: any = { ...base, ...syncExtras(model), messages };
        raw = await client.beta.messages.create(params);
        allContent.push(...raw.content);
        addClaudeUsage(usage, raw.usage);
        if (raw.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: raw.content });
      }
    } catch (e) {
      // Fehler nach bereits bezahlten Teil-Antworten: Kosten mitgeben
      throw withCost(e, raw ? syncCost() : 0);
    }
    if (raw.stop_reason === 'pause_turn') {
      throw new EngineError('Claude: Antwort nach 4 Fortsetzungen unvollständig', { costUsd: syncCost(), retryable: false });
    }
    const served = raw.model ?? model;
    const result = parseClaudeContent({
      content: allContent, stopReason: raw.stop_reason, stopDetails: raw.stop_details, model: served, usage: total(),
      raw: resume ? { ...raw, batch: { kind: resume.kind, message: resume.raw } } : raw,
    });
    // Batch-Anteil zum Preis des Batch-Modells (der Fallback kann ein anderes Modell sein), Rest zum Normalpreis
    if (resume) {
      result.costUsd = costFromUsage({ engine: 'claude', model: resume.raw?.model ?? model, usage: resume.usage })
        + costFromUsage({ engine: 'claude', model: served, usage });
    }
    return result;
  },
};
