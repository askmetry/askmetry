import { engineDefaults, prices } from './engine-config.ts';

type PriceKey = keyof typeof prices;

/** Preiszeile zum Modell, wie die API es meldet (z. B. "gpt-5.5-2026-10-01" → "gpt-5.5"). */
export function priceFor(model: string | null | undefined, engine?: string) {
  const keys = (Object.keys(prices) as PriceKey[]).sort((a, b) => b.length - a.length);
  const m = (model ?? '').toLowerCase();
  const key = keys.find((k) => m === k || m.startsWith(`${k}-`) || m.startsWith(k));
  if (key) return prices[key];
  const fallback = engine && (engineDefaults as Record<string, { model?: string }>)[engine]?.model;
  return fallback && fallback in prices ? prices[fallback as PriceKey] : null;
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
}): number {
  const { engine, usage: u = {} } = input;
  if (engine === 'mock') return num(input.taskCost);
  if (engine === 'google_aio' || engine === 'google_ai_mode') return num(input.taskCost);
  if (engine === 'perplexity' && u?.cost?.total_cost != null) return num(u.cost.total_cost);
  const p = priceFor(input.model, engine);
  if (!p) return 0;
  const usage = u ?? {};
  let inTok = 0, outTok = 0, searches = 0;
  switch (engine) {
    case 'chatgpt':
      inTok = num(usage.input_tokens);
      outTok = num(usage.output_tokens);
      searches = num(usage.web_search_calls);
      break;
    case 'gemini':
      inTok = num(usage.promptTokenCount) + num(usage.toolUsePromptTokenCount);
      outTok = num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount);
      searches = num(input.searches);
      break;
    case 'claude':
    case 'analyzer':
      inTok = num(usage.input_tokens) + 1.25 * num(usage.cache_creation_input_tokens) + 0.1 * num(usage.cache_read_input_tokens);
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
  // OpenAI flex bzw. Claude Message Batches API: Tokens zu Batch-Preisen (−50 %), Suchgebühr vorsichtig unverändert
  const tokenFactor = (engine === 'chatgpt' && usage.service_tier === 'flex') || (engine === 'claude' && usage.batch === true) ? 0.5 : 1;
  const own = (tokenFactor * (inTok * p.input + outTok * p.output)) / 1e6 + searches * p.perSearch;
  // Claude-Batch: synchron (Normalpreis) nachgeholter Teil – pause_turn-Fortsetzung oder Neustellung nach Ablehnung
  const sync = engine === 'claude' && usage.batch === true && usage.sync && typeof usage.sync === 'object'
    ? costFromUsage({ engine, model: input.model, usage: { ...usage.sync, batch: false, sync: undefined } }) : 0;
  return own + sync;
}
