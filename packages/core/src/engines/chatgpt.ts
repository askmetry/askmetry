// ChatGPT: OpenAI Responses API + web_search
import { EngineError } from '../errors.ts';
import { costFromUsage } from '../pricing.ts';
import type { Engine, EngineCitation } from '../types.ts';
import { mergeCitedAndSearched, openAiSearchedSources, postJson } from '../util.ts';

export const chatgpt: Engine = {
  key: 'chatgpt',
  provider: 'openai',
  enabled: () => !!process.env.OPENAI_API_KEY,
  async run(prompt, ctx) {
    const o = (ctx.options ?? {}) as { model?: string; searchContextSize?: string; reasoningEffort?: string; serviceTier?: 'flex' | 'default' };
    const model = o.model ?? 'gpt-5.5';
    const body = (tier?: string) => ({
      model,
      input: prompt,
      tools: [{
        type: 'web_search',
        user_location: { type: 'approximate', country: ctx.country },
        ...(o.searchContextSize && { search_context_size: o.searchContextSize }),
      }],
      ...(o.reasoningEffort && { reasoning: { effort: o.reasoningEffort } }),
      // flex: Batch-Preise (−50 %), gleiches Modell, nur langsamer
      ...(tier && { service_tier: tier }),
      include: ['web_search_call.action.sources'],
    });
    const headers = { authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
    let raw: any;
    try {
      // flex ist langsamer; 5 Min. je Versuch, bei Zeitüberschreitung wiederholt der Runner
      raw = await postJson('https://api.openai.com/v1/responses', body(o.serviceTier), headers, o.serviceTier === 'flex' ? 300_000 : 180_000);
    } catch (e) {
      // flex ohne freie Kapazität (429 „Resource Unavailable“ oder 503) → sofort einmal zum Normalpreis.
      // Nicht bei Zeitüberschreitung: die abgebrochene Anfrage könnte trotzdem abgerechnet werden.
      const noCapacity = e instanceof EngineError && ((e.status === 429 && /resource|unavailable|capacity/i.test(e.message)) || e.status === 503);
      if (o.serviceTier !== 'flex' || !noCapacity) throw e;
      raw = await postJson('https://api.openai.com/v1/responses', body(), headers);
    }
    let answer = '';
    const citations: EngineCitation[] = [];
    for (const item of raw.output ?? []) {
      if (item.type !== 'message') continue;
      for (const part of item.content ?? []) {
        if (part.type !== 'output_text') continue;
        answer += part.text;
        for (const a of part.annotations ?? []) {
          if (a.type === 'url_citation') citations.push({ url: a.url, title: a.title, kind: 'cited' });
        }
      }
    }
    // Jeder web_search_call wird als Suche abgerechnet
    const searchCalls = (raw.output ?? []).filter((i: any) => i.type === 'web_search_call').length;
    // service_tier meldet die API zurück (flex = Batch-Preise)
    const usage = { ...raw.usage, web_search_calls: searchCalls, service_tier: raw.service_tier ?? null };
    const served = raw.model ?? model;
    // Zitierte Quellen als 'cited', zusätzlich alle durchsuchten/gelesenen (include: web_search_call.action.sources)
    // als 'searched' – ohne die bereits zitierten. Kennzahlen nutzen cited, falls vorhanden (CONTRACT.md).
    return {
      engine: 'chatgpt', model: served, answer, citations: mergeCitedAndSearched(citations, openAiSearchedSources(raw)), noAiAnswer: false,
      usage, costUsd: costFromUsage({ engine: 'chatgpt', model: served, usage }), raw,
    };
  },
};
