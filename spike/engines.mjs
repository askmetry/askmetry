// Engine-Adapter. Jeder liefert dasselbe Format:
// { engine, model, answer, citations: [{url, title}], usage, cost_usd?, raw }
import Anthropic from '@anthropic-ai/sdk';
import { settings } from './config.mjs';

async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${res.status}: ${text.slice(0, 300)}`); }
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
  return json;
}

const dedupe = (list) => {
  const seen = new Set();
  return list.filter((c) => c.url && !seen.has(c.url) && seen.add(c.url));
};

// --- ChatGPT (OpenAI Responses API + web_search) ---
export async function openai(prompt, opts = {}) {
  const model = opts.model ?? settings.models.openai;
  const raw = await postJson(
    'https://api.openai.com/v1/responses',
    {
      model,
      input: prompt,
      tools: [{
        type: 'web_search', user_location: { type: 'approximate', country: settings.country },
        ...(opts.contextSize && { search_context_size: opts.contextSize }),
      }],
      ...(opts.reasoning && { reasoning: { effort: opts.reasoning } }),
      include: ['web_search_call.action.sources'],
    },
    { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  );
  let answer = '';
  const citations = [];
  const sources = [];
  for (const item of raw.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type !== 'output_text') continue;
        answer += part.text;
        for (const a of part.annotations ?? []) {
          if (a.type === 'url_citation') citations.push({ url: a.url, title: a.title });
        }
      }
    }
    if (item.type === 'web_search_call') {
      for (const s of item.action?.sources ?? []) if (s.url) sources.push({ url: s.url, title: s.title });
    }
  }
  const searchCalls = (raw.output ?? []).filter((i) => i.type === 'web_search_call').length;
  return {
    engine: 'chatgpt', model: raw.model ?? model, answer, citations: dedupe(citations), sources: dedupe(sources),
    usage: { ...raw.usage, web_search_calls: searchCalls }, raw,
  };
}

// --- Gemini (Gemini API + Google-Search-Grounding) ---
async function resolveRedirect(url) {
  if (!url?.includes('grounding-api-redirect')) return url;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return res.headers.get('location') || null;
  } catch {
    return null;
  }
}

async function gemini(prompt) {
  const model = settings.models.gemini;
  const raw = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] },
    { 'x-goog-api-key': process.env.GEMINI_API_KEY },
  );
  const cand = raw.candidates?.[0];
  const answer = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
  const citations = await Promise.all(
    // Nicht auflösbarer Redirect: Gemini liefert die Quell-Domain im Titel
    chunks.filter((c) => c.web).map(async (c) => ({
      url: (await resolveRedirect(c.web.uri)) ?? `https://${c.web.title}/`, title: c.web.title,
    })),
  );
  return {
    engine: 'gemini', model, answer, citations: dedupe(citations),
    queries: cand?.groundingMetadata?.webSearchQueries, usage: raw.usageMetadata, raw,
  };
}

// --- Claude (Messages API + web_search) ---
let anthropic;
export async function claude(prompt, opts = {}) {
  anthropic ??= new Anthropic();
  const model = opts.model ?? settings.models.claude;
  const messages = [{ role: 'user', content: prompt }];
  let raw;
  const allContent = [];
  const usage = { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 0 } };
  // pause_turn: lange Websuche-Turns fortsetzen; Inhalte und Verbrauch aller Teil-Antworten sammeln
  for (let i = 0; i < 4; i++) {
    raw = await anthropic.beta.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: opts.effort ?? 'medium' },
      // Server-Fallback nur für Modelle, die ihn unterstützen (nicht Haiku)
      ...(!model.includes('haiku') && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
      tools: [{
        type: opts.toolType ?? 'web_search_20260209', name: 'web_search', max_uses: opts.maxUses ?? 5,
        user_location: { type: 'approximate', country: settings.country },
      }],
      ...(opts.system && { system: opts.system }),
      messages,
    });
    allContent.push(...raw.content);
    usage.input_tokens += raw.usage?.input_tokens ?? 0;
    usage.output_tokens += raw.usage?.output_tokens ?? 0;
    usage.server_tool_use.web_search_requests += raw.usage?.server_tool_use?.web_search_requests ?? 0;
    if (raw.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: raw.content });
  }
  if (raw.stop_reason === 'refusal') throw new Error(`Claude refusal: ${raw.stop_details?.category ?? 'unbekannt'}`);
  if (raw.stop_reason === 'pause_turn') throw new Error('Claude: Antwort nach 4 Fortsetzungen unvollständig');
  let answer = '';
  const citations = [];
  const sources = [];
  for (const block of allContent) {
    if (block.type === 'text') {
      answer += block.text;
      for (const c of block.citations ?? []) if (c.url) citations.push({ url: c.url, title: c.title });
    }
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) sources.push({ url: r.url, title: r.title });
    }
  }
  // Ohne Zitate im Text: die durchsuchten Quellen verwenden (im Bericht markiert)
  const cited = dedupe(citations);
  return {
    engine: 'claude', model: raw.model ?? model, answer,
    citations: cited.length ? cited : dedupe(sources),
    citations_from: cited.length ? 'inline' : 'search_results',
    sources: dedupe(sources), usage, raw: { ...raw, content: allContent },
  };
}

// --- Perplexity (Sonar API) ---
async function perplexity(prompt) {
  const model = settings.models.perplexity;
  const raw = await postJson(
    'https://api.perplexity.ai/chat/completions',
    { model, messages: [{ role: 'user', content: prompt }], web_search_options: { user_location: { country: settings.country } } },
    { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
  );
  const answer = raw.choices?.[0]?.message?.content ?? '';
  const citations = (raw.search_results ?? raw.citations ?? []).map((c) => (typeof c === 'string' ? { url: c } : { url: c.url, title: c.title }));
  return { engine: 'perplexity', model, answer, citations: dedupe(citations), usage: raw.usage, raw };
}

// --- Google AI Overviews + AI Mode (DataForSEO) ---
function collectRefs(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collectRefs(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.references)) {
    for (const r of node.references) if (r?.url) out.push({ url: r.url, title: r.title ?? r.source });
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectRefs(v, out);
}

async function dataforseo(path, body) {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  // 40101 ("Internal SE Server Error") tritt sporadisch auf → bis zu 4 Versuche
  let raw, task, spent = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    raw = await postJson(`https://api.dataforseo.com/v3/serp/google/${path}/live/advanced`, [body], { authorization: `Basic ${auth}` });
    task = raw.tasks?.[0];
    spent += task?.cost ?? 0;
    if (task?.status_code === 20000) break;
    if (task?.status_code !== 40101 || attempt === 4) throw new Error(`DataForSEO ${task?.status_code}: ${task?.status_message}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  task.cost = spent;
  return { raw, task, items: task.result?.[0]?.items ?? [] };
}

function aiItemsToResult(engine, items, task, raw) {
  const ai = items.filter((i) => i.type === 'ai_overview');
  const answer = ai.map((i) => i.markdown ?? i.text ?? '').join('\n\n').trim();
  const citations = [];
  collectRefs(ai, citations);
  return { engine, model: 'google', answer, citations: dedupe(citations), no_ai_answer: ai.length === 0, cost_usd: task.cost, raw };
}

async function googleAio(prompt) {
  const { raw, task, items } = await dataforseo('organic', {
    keyword: prompt, location_code: settings.dataforseoLocationCode, language_code: settings.language,
    device: 'desktop', load_async_ai_overview: true, // AI Overviews werden oft nachgeladen
  });
  return aiItemsToResult('google_aio', items, task, raw);
}

async function googleAiMode(prompt) {
  const { raw, task, items } = await dataforseo('ai_mode', {
    keyword: prompt, location_code: settings.dataforseoLocationCode, language_code: settings.language,
  });
  return aiItemsToResult('google_ai_mode', items, task, raw);
}

export const engines = {
  chatgpt: { run: openai, enabled: () => !!process.env.OPENAI_API_KEY },
  gemini: { run: gemini, enabled: () => !!process.env.GEMINI_API_KEY },
  claude: { run: claude, enabled: () => !!process.env.ANTHROPIC_API_KEY },
  perplexity: { run: perplexity, enabled: () => !!process.env.PERPLEXITY_API_KEY },
  google_aio: { run: googleAio, enabled: () => !!process.env.DATAFORSEO_LOGIN },
  google_ai_mode: { run: googleAiMode, enabled: () => !!process.env.DATAFORSEO_LOGIN },
};
