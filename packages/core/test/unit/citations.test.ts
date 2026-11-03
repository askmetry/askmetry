import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchedSourcesFromRaw } from '../../src/backfill.ts';
import { chatgpt } from '../../src/engines/chatgpt.ts';
import { metricCitations, type Cit } from '../../src/recommend/data.ts';
import { mergeCitedAndSearched, openAiSearchedSources, urlKey } from '../../src/util.ts';

const openAiRaw = {
  model: 'gpt-5.5',
  usage: { input_tokens: 100, output_tokens: 50 },
  output: [
    { type: 'web_search_call', action: { type: 'search', sources: [
      { type: 'url', url: 'https://www.reddit.com/r/Kartenzahlung/comments/abc/sumup_oder_zettle/' },
      { type: 'url', url: 'https://www.zettle.com/de/kosten' },
    ] } },
    { type: 'web_search_call', action: { type: 'open_page', url: 'https://www.mypos.com/de-de/pricing' } },
    { type: 'web_search_call', action: { type: 'search', sources: [{ type: 'url', url: 'https://www.zettle.com/de/kosten' }] } },
    { type: 'message', content: [{ type: 'output_text', text: 'Zettle ist günstig.', annotations: [
      { type: 'url_citation', url: 'https://www.zettle.com/de/kosten', title: 'Zettle Kosten' },
    ] }] },
  ],
};

describe('Gelesene Quellen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mergeCitedAndSearched: zitierte als cited, übrige durchsuchte zusätzlich als searched, dedupliziert', () => {
    const out = mergeCitedAndSearched(
      [{ url: 'https://a.de/', kind: 'cited' as const }, { url: 'https://a.de/', kind: 'cited' as const }],
      [{ url: 'https://a.de/', kind: 'searched' as const }, { url: 'https://b.de/x', kind: 'searched' as const }, { url: 'https://b.de/x', kind: 'searched' as const },
        { url: 'javascript://evil.com/%0aalert(1)', kind: 'searched' as const }],
    );
    expect(out).toEqual([{ url: 'https://a.de/', kind: 'cited' }, { url: 'https://b.de/x', kind: 'searched' }]);
  });

  it('zitierte URL mit ?utm_source=openai wird nicht zusätzlich als searched gespeichert', () => {
    const out = mergeCitedAndSearched(
      [{ url: 'https://www.zettle.com/de/kosten?utm_source=openai', kind: 'cited' as const }],
      [{ url: 'https://zettle.com/de/kosten/', kind: 'searched' as const }, { url: 'https://b.de/', kind: 'searched' as const }],
    );
    expect(out.map((x) => x.kind)).toEqual(['cited', 'searched']);
    expect(urlKey('https://www.a.de/x/?utm_source=openai&id=1#top')).toBe('https://a.de/x/?id=1');
  });

  it('openAiSearchedSources liest action.sources und open_page-URLs', () => {
    expect(openAiSearchedSources(openAiRaw).map((s) => s.url)).toEqual([
      'https://www.reddit.com/r/Kartenzahlung/comments/abc/sumup_oder_zettle/', 'https://www.zettle.com/de/kosten', 'https://www.mypos.com/de-de/pricing',
    ]);
  });

  it('ChatGPT-Adapter speichert zitierte und gelesene Quellen (ohne echten API-Aufruf)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(openAiRaw), { status: 200 })));
    const res = await chatgpt.run('Test', { country: 'DE', language: 'de' });
    expect(res.citations).toEqual([
      { url: 'https://www.zettle.com/de/kosten', title: 'Zettle Kosten', kind: 'cited' },
      { url: 'https://www.reddit.com/r/Kartenzahlung/comments/abc/sumup_oder_zettle/', title: undefined, kind: 'searched' },
      { url: 'https://www.mypos.com/de-de/pricing', title: undefined, kind: 'searched' },
    ]);
  });

  it('searchedSourcesFromRaw: ChatGPT, Claude (auch als Ablehnung gespeichert), andere Engines leer', () => {
    expect(searchedSourcesFromRaw('chatgpt', openAiRaw)).toHaveLength(3);
    const claudeRaw = { content: [{ type: 'web_search_tool_result', content: [{ url: 'https://a.de/x', title: 'A' }, { url: 'https://a.de/x' }] }] };
    expect(searchedSourcesFromRaw('claude', claudeRaw)).toEqual([{ url: 'https://a.de/x', title: 'A', kind: 'searched' }]);
    expect(searchedSourcesFromRaw('claude', { refusal: 'x', response: claudeRaw })).toHaveLength(1);
    expect(searchedSourcesFromRaw('gemini', openAiRaw)).toEqual([]);
  });

  it('metricCitations: cited, falls vorhanden, sonst searched', () => {
    const c = (responseId: string, url: string, kind: 'cited' | 'searched'): Cit => ({ responseId, url, domain: new URL(url).hostname, title: null, position: 1, kind });
    const m = metricCitations([c('r1', 'https://a.de', 'cited'), c('r1', 'https://reddit.com/r/x', 'searched'), c('r2', 'https://b.de', 'searched')]);
    expect(m.get('r1')!.map((x) => x.url)).toEqual(['https://a.de']);
    expect(m.get('r2')!.map((x) => x.url)).toEqual(['https://b.de']);
  });
});
