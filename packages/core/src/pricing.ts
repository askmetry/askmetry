import { engineDefaults, prices, type PriceRow } from './engine-config.ts';

/** Preise einer Zeile zum Zeitpunkt `at` (angekündigte Änderungen eingerechnet). */
function priceAt(row: PriceRow, at: Date): PriceRow {
  const day = at.toISOString().slice(0, 10);
  let p: PriceRow = row;
  for (const c of row.changes ?? []) {
    if (day < c.from) continue;
    const { from: _from, ...fields } = c;
    p = { ...p, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
  }
  return p;
}

/** Preiszeile zum Modell, wie die API es meldet (z. B. "gpt-5.5-2026-10-01" → "gpt-5.5"). */
export function priceFor(model: string | null | undefined, engine?: string, at: Date = new Date()): PriceRow | null {
  const keys = Object.keys(prices).sort((a, b) => b.length - a.length);
  const m = (model ?? '').toLowerCase();
  const key = keys.find((k) => m === k || m.startsWith(`${k}-`) || m.startsWith(k));
  if (key) return priceAt(prices[key], at);
  const fallback = engine && (engineDefaults as Record<string, { model?: string }>)[engine]?.model;
  return fallback && fallback in prices ? priceAt(prices[fallback], at) : null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Kosten in USD aus dem gemeldeten Verbrauch.
 * DataForSEO meldet die Task-Kosten selbst (taskCost), Perplexity ggf. usage.cost.total_cost.
 */
export function costFromUsage(input: {
  engine: string;
  model?: string | null;
  usage?: any;
  taskCost?: number | null;
  searches?: number | null;
  /** Zeitpunkt der Abfrage (für angekündigte Preisänderungen), Standard jetzt */
  at?: Date;
}): number {
  const { engine, usage: u = {} } = input;
  if (engine === 'mock') return num(input.taskCost);
  if (engine === 'google_aio' || engine === 'google_ai_mode') return num(input.taskCost);
  if (engine === 'perplexity' && u?.cost?.total_cost != null) return num(u.cost.total_cost);
  const p = priceFor(input.model, engine, input.at);
  if (!p) return 0;
  const cachedPrice = p.cachedInput ?? p.input;
  const usage = u ?? {};
  // inTok zum Eingabepreis, cachedTok zum Cache-Lesepreis
  let inTok = 0, cachedTok = 0, outTok = 0, searches = 0;
  switch (engine) {
    case 'chatgpt': {
      // input_tokens enthält die aus dem Cache gelesenen Tokens (input_tokens_details.cached_tokens)
      const total = num(usage.input_tokens);
      cachedTok = Math.min(total, num(usage.input_tokens_details?.cached_tokens));
      inTok = total - cachedTok;
      outTok = num(usage.output_tokens);
      searches = num(usage.web_search_calls);
      break;
    }
    case 'gemini':
      inTok = num(usage.promptTokenCount) + num(usage.toolUsePromptTokenCount);
      outTok = num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount);
      searches = num(input.searches);
      break;
    case 'claude':
    case 'analyzer':
      // input_tokens enthält Cache-Lesen/-Schreiben nicht; Schreiben (5 Min.) 1,25 × Eingabepreis
      inTok = num(usage.input_tokens) + 1.25 * num(usage.cache_creation_input_tokens);
      cachedTok = num(usage.cache_read_input_tokens);
      outTok = num(usage.output_tokens);
      searches = num(usage.server_tool_use?.web_search_requests);
      break;
    case 'perplexity':
      inTok = num(usage.prompt_tokens);
      outTok = num(usage.completion_tokens);
      searches = 1;
      break;
    default:
      inTok = num(usage.input_tokens ?? usage.prompt_tokens);
      outTok = num(usage.output_tokens ?? usage.completion_tokens);
  }
  // OpenAI flex bzw. Claude Message Batches API: alle Token-Preise −50 % (auch Cache), Suchgebühr unverändert
  const tokenFactor = (engine === 'chatgpt' && usage.service_tier === 'flex') || (engine === 'claude' && usage.batch === true) ? 0.5 : 1;
  const own = (tokenFactor * (inTok * p.input + cachedTok * cachedPrice + outTok * p.output)) / 1e6 + searches * p.perSearch;
  // Claude-Batch: synchron (Normalpreis) nachgeholter Teil – pause_turn-Fortsetzung oder Neustellung nach Ablehnung
  const sync = engine === 'claude' && usage.batch === true && usage.sync && typeof usage.sync === 'object'
    ? costFromUsage({ engine, model: input.model, at: input.at, usage: { ...usage.sync, batch: false, sync: undefined } }) : 0;
  return own + sync;
}
