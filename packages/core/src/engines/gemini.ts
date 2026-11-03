// Gemini: Gemini API + Google-Search-Grounding
import { costFromUsage } from '../pricing.ts';
import type { Engine } from '../types.ts';
import { dedupeByUrl, postJson } from '../util.ts';

async function resolveRedirect(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  if (!url.includes('grounding-api-redirect')) return url;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return res.headers.get('location') || null;
  } catch {
    return null;
  }
}

const SAFETY_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

export const gemini: Engine = {
  key: 'gemini',
  provider: 'google',
  enabled: () => !!process.env.GEMINI_API_KEY,
  async run(prompt, ctx) {
    const o = (ctx.options ?? {}) as { model?: string };
    const model = o.model ?? 'gemini-3.5-flash';
    const raw = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] },
      { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
    );
    const cand = raw.candidates?.[0];
    const answer = (cand?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    const chunks: any[] = cand?.groundingMetadata?.groundingChunks ?? [];
    const citations = await Promise.all(
      // Nicht auflösbarer Redirect: Gemini liefert die Quell-Domain im Titel
      chunks.filter((c) => c.web).map(async (c) => ({
        url: (await resolveRedirect(c.web.uri)) ?? `https://${c.web.title}/`,
        title: c.web.title as string | undefined,
        kind: 'cited' as const,
      })),
    );
    const queries: string[] = cand?.groundingMetadata?.webSearchQueries ?? [];
    const served = raw.modelVersion ?? model;
    const usage = { ...raw.usageMetadata, web_search_queries: queries.length };
    // Sicherheitsfilter: Prompt blockiert (promptFeedback) oder Antwort abgebrochen (finishReason)
    const blockReason = raw.promptFeedback?.blockReason as string | undefined;
    const finish = cand?.finishReason as string | undefined;
    const refusal = blockReason ? `Gemini blockiert: ${blockReason}`
      : finish && SAFETY_REASONS.has(finish) ? `Gemini blockiert: ${finish}` : null;
    return {
      engine: 'gemini', model: served, answer, citations: dedupeByUrl(citations), noAiAnswer: false, refusal,
      usage, costUsd: costFromUsage({ engine: 'gemini', model: served, usage: raw.usageMetadata, searches: queries.length }), raw,
    };
  },
};
