// Fehler mit Kosten und Wiederholbarkeit. Engines werfen EngineError, damit bezahlte Fehlversuche verbucht werden
// und nur vorübergehende Fehler (429, 5xx, Netzwerk, DataForSEO 40101) erneut versucht werden.

export class EngineError extends Error {
  /** bereits angefallene (bezahlte) Kosten dieses Versuchs in USD */
  costUsd: number;
  /** vorübergehender Fehler → erneuter Versuch sinnvoll */
  retryable: boolean;
  status?: number;
  constructor(message: string, opts: { costUsd?: number; retryable?: boolean; status?: number; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'EngineError';
    this.costUsd = opts.costUsd ?? 0;
    this.retryable = opts.retryable ?? true;
    this.status = opts.status;
  }
}

/** HTTP-Status als vorübergehend einstufen */
export const isTransientStatus = (status: number | undefined) =>
  status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;

/** Kosten, die an einem Fehler hängen (0, wenn unbekannt) */
export function errorCost(e: unknown): number {
  const c = (e as { costUsd?: unknown })?.costUsd;
  return typeof c === 'number' && Number.isFinite(c) ? c : 0;
}

/** Soll der Runner es noch einmal versuchen? Unbekannte Fehler (Netzwerk, Timeout) gelten als vorübergehend. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof EngineError) return e.retryable;
  const status = (e as { status?: unknown })?.status;
  if (typeof status === 'number') return isTransientStatus(status);
  return true;
}

/** EngineError aus einem beliebigen Fehler machen und Kosten anhängen (z. B. bei Abbruch nach bezahlten Teil-Aufrufen) */
export function withCost(e: unknown, costUsd: number): EngineError {
  if (e instanceof EngineError) {
    e.costUsd += costUsd;
    return e;
  }
  const status = (e as { status?: unknown })?.status;
  return new EngineError((e as Error)?.message ?? String(e), {
    costUsd, retryable: isRetryable(e), status: typeof status === 'number' ? status : undefined, cause: e,
  });
}

/** Postgres-Fehlercode (auch durch Drizzle-Wrapper hindurch) */
export function pgErrorCode(e: unknown): string | undefined {
  for (let cur: any = e, i = 0; cur && i < 5; cur = cur.cause, i++) {
    if (typeof cur.code === 'string' && /^[0-9A-Z]{5}$/.test(cur.code)) return cur.code;
  }
  return undefined;
}

export const isForeignKeyViolation = (e: unknown) => pgErrorCode(e) === '23503';
export const isUniqueViolation = (e: unknown) => pgErrorCode(e) === '23505';
