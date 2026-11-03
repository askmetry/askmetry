// Claude: Messages API (beta) + web_search
import Anthropic from '@anthropic-ai/sdk';
import { EngineError, withCost } from '../errors.ts';
import { costFromUsage } from '../pricing.ts';
import type { Engine, EngineCitation } from '../types.ts';
import { mergeCitedAndSearched } from '../util.ts';

let client: Anthropic | undefined;

export const claude: Engine = {
  key: 'claude',
  provider: 'anthropic',
  enabled: () => !!process.env.ANTHROPIC_API_KEY,
  async run(prompt, ctx) {
    // keine SDK-Wiederholungen: der Runner ist die einzige Wiederholungsebene
    client ??= new Anthropic({ maxRetries: 0 });
    const o = (ctx.options ?? {}) as { model?: string; effort?: string; maxSearches?: number; system?: string };
    const model = o.model ?? 'claude-sonnet-5-5';
    const messages: any[] = [{ role: 'user', content: prompt }];
    let raw: any;
    const allContent: any[] = [];
    const usage = {
      input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0 },
    };
    const cost = () => costFromUsage({ engine: 'claude', model: raw?.model ?? model, usage });
    // pause_turn: lange Websuche-Turns fortsetzen; Inhalte und Verbrauch aller Teil-Antworten sammeln
    try {
      for (let i = 0; i < 4; i++) {
        const params: any = {
          model,
          max_tokens: 16000,
          output_config: { effort: o.effort ?? 'medium' },
          // Server-Fallback nur für Modelle, die ihn unterstützen (nicht Haiku)
          ...(!model.includes('haiku') && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
          tools: [{
            type: 'web_search_20260209', name: 'web_search', max_uses: o.maxSearches ?? 5,
            user_location: { type: 'approximate', country: ctx.country },
          }],
          ...(o.system && { system: o.system }),
          messages,
        };
        raw = await client.beta.messages.create(params);
        allContent.push(...raw.content);
        usage.input_tokens += raw.usage?.input_tokens ?? 0;
        usage.output_tokens += raw.usage?.output_tokens ?? 0;
        usage.cache_creation_input_tokens += raw.usage?.cache_creation_input_tokens ?? 0;
        usage.cache_read_input_tokens += raw.usage?.cache_read_input_tokens ?? 0;
        usage.server_tool_use.web_search_requests += raw.usage?.server_tool_use?.web_search_requests ?? 0;
        if (raw.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: raw.content });
      }
    } catch (e) {
      // Fehler nach bereits bezahlten Teil-Antworten: Kosten mitgeben
      throw withCost(e, raw ? cost() : 0);
    }
    if (raw.stop_reason === 'pause_turn') {
      throw new EngineError('Claude: Antwort nach 4 Fortsetzungen unvollständig', { costUsd: cost(), retryable: false });
    }
    let answer = '';
    const cited: EngineCitation[] = [];
    const searched: EngineCitation[] = [];
    for (const block of allContent) {
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
    const served = raw.model ?? model;
    return {
      engine: 'claude', model: served, answer,
      citations: mergeCitedAndSearched(cited, searched),
      noAiAnswer: false, usage,
      // Ablehnung: als Antwort mit answer_type 'refusal' speichern, nicht wiederholen
      refusal: raw.stop_reason === 'refusal' ? `Claude refusal: ${raw.stop_details?.category ?? 'unbekannt'}` : null,
      costUsd: costFromUsage({ engine: 'claude', model: served, usage }),
      raw: { ...raw, content: allContent },
    };
  },
};
