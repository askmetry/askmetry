// Google AI Overviews + AI Mode über DataForSEO (Live-Endpunkte)
import type { Engine, EngineCitation, EngineResult } from '../types.ts';
import { EngineError } from '../errors.ts';
import { dedupeByUrl, postJson } from '../util.ts';

const locationCodes: Record<string, number> = { DE: 2276, AT: 2040, CH: 2756 };

function collectRefs(node: any, out: EngineCitation[]) {
  if (Array.isArray(node)) { node.forEach((n) => collectRefs(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.references)) {
    for (const r of node.references) if (r?.url) out.push({ url: r.url, title: r.title ?? r.source, kind: 'cited' });
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectRefs(v, out);
}

async function dataforseo(path: string, body: Record<string, unknown>) {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  // Ein Versuch je Aufruf – Wiederholungen übernimmt der Runner (nur bei vorübergehenden Fehlern wie 40101).
  const raw = await postJson(`https://api.dataforseo.com/v3/serp/google/${path}/live/advanced`, [body], { authorization: `Basic ${auth}` });
  const task = raw.tasks?.[0];
  const cost = Number(task?.cost ?? 0) || 0;
  if (task?.status_code !== 20000) {
    const code = Number(task?.status_code ?? raw.status_code);
    // 40101 ("Internal SE Server Error") tritt sporadisch auf; 5xxxx = Serverfehler. Alles andere (Auth, Parameter) ist dauerhaft.
    throw new EngineError(`DataForSEO ${task?.status_code ?? raw.status_code}: ${task?.status_message ?? raw.status_message}`, {
      costUsd: cost, retryable: code === 40101 || code >= 50000,
    });
  }
  return { raw, task: { ...task, cost }, items: (task.result?.[0]?.items ?? []) as any[] };
}

export function aiItemsToResult(engine: string, items: any[], cost: number, raw: unknown): EngineResult {
  const ai = items.filter((i) => i.type === 'ai_overview');
  const answer = ai.map((i) => i.markdown ?? i.text ?? '').join('\n\n').trim();
  const citations: EngineCitation[] = [];
  collectRefs(ai, citations);
  return {
    engine, model: 'google', answer, citations: dedupeByUrl(citations), noAiAnswer: ai.length === 0,
    usage: { dataforseo_cost: cost }, costUsd: cost, raw,
  };
}

const enabled = () => !!process.env.DATAFORSEO_LOGIN && !!process.env.DATAFORSEO_PASSWORD;

export const googleAio: Engine = {
  key: 'google_aio',
  provider: 'dataforseo',
  enabled,
  async run(prompt, ctx) {
    const { raw, task, items } = await dataforseo('organic', {
      keyword: prompt, location_code: locationCodes[ctx.country] ?? 2276, language_code: ctx.language,
      device: 'desktop', load_async_ai_overview: true, // AI Overviews werden oft nachgeladen
    });
    return aiItemsToResult('google_aio', items, task.cost, raw);
  },
};

export const googleAiMode: Engine = {
  key: 'google_ai_mode',
  provider: 'dataforseo',
  enabled,
  async run(prompt, ctx) {
    const { raw, task, items } = await dataforseo('ai_mode', {
      keyword: prompt, location_code: locationCodes[ctx.country] ?? 2276, language_code: ctx.language,
    });
    return aiItemsToResult('google_ai_mode', items, task.cost, raw);
  },
};
