import { describe, expect, it } from 'vitest';
import {
  AI_BOTS, checkDomain, extractJsonLdTypes, isAllowed, isBotBlocked, parseRobots, rulesFor, visibleText, type FetchLike,
} from '../../src/recommend/site-check.ts';
import { technicalCovered } from '../../src/recommend/index.ts';

describe('robots.txt-Parser', () => {
  it('bildet Gruppen aus aufeinanderfolgenden User-agent-Zeilen', () => {
    const g = parseRobots(`# Kommentar
User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: *
Disallow: /admin
Allow: /admin/public
Sitemap: https://x.de/sitemap.xml
`);
    expect(g).toHaveLength(2);
    expect(g[0].agents).toEqual(['gptbot', 'claudebot']);
    expect(g[0].rules).toEqual([{ allow: false, path: '/' }]);
    expect(g[1].rules).toHaveLength(2);
  });

  it('spezifische Gruppe ersetzt *, Abgleich ohne Groß-/Kleinschreibung', () => {
    const g = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: oai-searchbot\nAllow: /\n');
    expect(isBotBlocked(g, 'OAI-SearchBot')).toBe(false);
    expect(isBotBlocked(g, 'GPTBot')).toBe(true); // fällt auf * zurück
  });

  it('mehrere Gruppen für denselben Bot werden zusammengeführt', () => {
    const g = parseRobots('User-agent: GPTBot\nAllow: /blog\n\nUser-agent: GPTBot\nDisallow: /\n');
    const rules = rulesFor(g, 'GPTBot');
    expect(rules).toHaveLength(2);
    expect(isAllowed(rules, '/blog/artikel')).toBe(true);
    expect(isAllowed(rules, '/preise')).toBe(false);
  });

  it('längste Regel gewinnt, bei Gleichstand Allow', () => {
    const rules = [{ allow: false, path: '/' }, { allow: true, path: '/ratgeber/' }];
    expect(isAllowed(rules, '/ratgeber/x')).toBe(true);
    expect(isAllowed(rules, '/preise')).toBe(false);
    expect(isAllowed([{ allow: false, path: '/a' }, { allow: true, path: '/a' }], '/a')).toBe(true);
  });

  it('Wildcards * und $', () => {
    const rules = [{ allow: false, path: '/*.pdf$' }, { allow: false, path: '/*?session=' }];
    expect(isAllowed(rules, '/datei.pdf')).toBe(false);
    expect(isAllowed(rules, '/datei.pdf?x=1')).toBe(true);
    expect(isAllowed(rules, '/seite?session=abc')).toBe(false);
    expect(isAllowed([{ allow: false, path: '/*' }], '/')).toBe(false);
  });

  it('leeres Disallow erlaubt alles; „Allow: /$“ + „Disallow: /“ gilt als gesperrt', () => {
    expect(isBotBlocked(parseRobots('User-agent: *\nDisallow:\n'), 'GPTBot')).toBe(false);
    expect(isBotBlocked(parseRobots('User-agent: *\nAllow: /$\nDisallow: /\n'), 'GPTBot')).toBe(true);
  });

  it('Crawl-delay trennt keine User-agent-Folge; Produkt-Token mit Version', () => {
    const g = parseRobots('User-agent: *\nCrawl-delay: 1\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: Googlebot/2.1\nAllow: /\n');
    expect(g[0].agents).toEqual(['*', 'gptbot']);
    expect(isBotBlocked(g, 'GPTBot')).toBe(true);
    expect(isBotBlocked(g, 'Googlebot')).toBe(false);
    expect(visibleText('<body>a &#99999999; b</body>')).toBe('a b');
  });

  it('Regeln vor dem ersten User-agent und unbekannte Felder werden ignoriert', () => {
    const g = parseRobots('Disallow: /\nUser-agent: *\nContent-Signal: ai-train=no\nAllow: /\n');
    expect(isBotBlocked(g, 'ClaudeBot')).toBe(false);
  });
});

describe('technicalCovered', () => {
  const base = { domain: 'x.de', home: { status: 200, finalUrl: 'https://x.de/', textChars: 1000, jsonLd: [] }, robots: { status: 200, found: true, blocked: [], allowed: [] }, llmsTxt: { status: 404, found: false } };
  it('Teil-Checks mit Netzfehler decken ihre Maßnahmen nicht ab', () => {
    expect(technicalCovered('technical:robots', [base])).toBe(true);
    expect(technicalCovered('technical:robots', [{ ...base, robots: { ...base.robots, status: null, found: false } }])).toBe(false);
    expect(technicalCovered('technical:js_text', [{ ...base, home: { ...base.home, status: null } }])).toBe(false);
    expect(technicalCovered('technical:structured_data', [{ ...base, home: { ...base.home, status: 403 } }])).toBe(false);
    expect(technicalCovered('technical:llms_txt', [])).toBe(false);
  });
});

describe('HTML-Auswertung', () => {
  it('JSON-LD-Typen inkl. @graph und Arrays', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":["WebSite","Thing"]}]}</script>
      <script type='application/ld+json'>{"@type":"FAQPage","mainEntity":[{"@type":"Question"}]}</script>
      <script type="application/ld+json">{kaputt</script>`;
    expect(extractJsonLdTypes(html).sort()).toEqual(['FAQPage', 'Organization', 'Question', 'Thing', 'WebSite']);
    expect(extractJsonLdTypes('<script type="application/ld+json">{"@type":"https://schema.org/Dentist"}</script>')).toEqual(['Dentist']);
  });

  it('sichtbarer Text ohne Skripte, Styles und Tags', () => {
    const t = visibleText('<html><head><title>T</title><style>a{}</style></head><body><script>var x=1</script><h1>Kartenzahlung &amp; mehr</h1><p>Für Händler&nbsp;günstig</p></body></html>');
    expect(t).toBe('Kartenzahlung & mehr Für Händler günstig');
  });
});

describe('checkDomain (fetch injiziert)', () => {
  const fake = (pages: Record<string, { status: number; body: string; url?: string }>): FetchLike => async (url, init) => {
    expect(init?.headers?.['user-agent']).toBe('OpenGEO-SiteCheck/0.1');
    const p = pages[url];
    if (!p) throw new Error('Netzwerkfehler');
    return { status: p.status, url: p.url ?? url, text: async () => p.body };
  };

  it('erkennt gesperrte KI-Crawler, fehlende llms.txt, JSON-LD und Textmenge', async () => {
    const r = await checkDomain('www.Beispiel.de', {
      fetch: fake({
        'https://beispiel.de/robots.txt': { status: 200, body: 'User-agent: GPTBot\nDisallow: /\nUser-agent: *\nAllow: /\n' },
        'https://beispiel.de/llms.txt': { status: 200, body: '<!doctype html><html>Seite nicht gefunden</html>' }, // Soft-404
        'https://beispiel.de/': { status: 200, body: '<html><body><div id="root"></div><script type="application/ld+json">{"@type":"Organization"}</script></body></html>' },
      }),
    });
    expect(r.domain).toBe('beispiel.de');
    expect(r.robots.blocked).toEqual(['GPTBot']);
    expect(r.robots.allowed).toHaveLength(AI_BOTS.length - 1);
    expect(r.llmsTxt.found).toBe(false);
    expect(r.home.jsonLd).toEqual(['Organization']);
    expect(r.home.textChars).toBe(0);
  });

  it('fehlende robots.txt (404) = keine Sperre; Netzwerkfehler werden festgehalten', async () => {
    const r = await checkDomain('x.de', {
      fetch: fake({
        'https://x.de/robots.txt': { status: 404, body: 'not found' },
        'https://x.de/llms.txt': { status: 200, body: '# X\n> Beschreibung\n' },
      }),
    });
    expect(r.robots.found).toBe(false);
    expect(r.robots.blocked).toEqual([]);
    expect(r.llmsTxt.found).toBe(true);
    expect(r.home.status).toBeNull();
    expect(r.home.error).toMatch(/Netzwerkfehler/);
  });
});
