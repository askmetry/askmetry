// Perplexity: Sonar API
import { costFromUsage } from '../pricing.ts';
import type { Engine } from '../types.ts';
import { dedupeByUrl, postJson } from '../util.ts';

export const perplexity: Engine = {
  key: 'perplexity',
  provider: 'perplexity',
  enabled: () => !!process.env.PERPLEXITY_API_KEY,
  async run(prompt, ctx) {
    const o = (ctx.options ?? {}) as { model?: string; searchContextSize?: string };
    const model = o.model ?? 'sonar';
    const raw = await postJson(
      'https://api.perplexity.ai/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        web_search_options: {
          user_location: { country: ctx.country },
          ...(o.searchContextSize && { search_context_size: o.searchContextSize }),
        },
      },
      { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    );
    const answer = raw.choices?.[0]?.message?.content ?? '';
    const citations = (raw.search_results ?? raw.citations ?? []).map((c: any) =>
      typeof c === 'string' ? { url: c, kind: 'cited' as const } : { url: c.url, title: c.title, kind: 'cited' as const });
    const served = raw.model ?? model;
    return {
      engine: 'perplexity', model: served, answer, citations: dedupeByUrl(citations), noAiAnswer: false,
      usage: raw.usage ?? null, costUsd: costFromUsage({ engine: 'perplexity', model: served, usage: raw.usage }), raw,
    };
  },
};
