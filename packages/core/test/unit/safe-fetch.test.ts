import { describe, expect, it } from 'vitest';
import {
  BlockedUrlError, isPublicIp, resolvePublic, safeFetch, type Resolver, type Transport, type TransportResponse,
} from '../../src/recommend/safe-fetch.ts';
import { safeHttpUrl, validateBrandDomain, validateBrandDomains } from '../../src/domains.ts';
import { checkDomain, robotsStatusUnknown } from '../../src/recommend/site-check.ts';
import { technicalCovered } from '../../src/recommend/index.ts';
import type { SiteCheckResult } from '../../src/recommend/data.ts';

// Keine echten Netz- oder DNS-Aufrufe: Resolver und Transport sind injiziert.
const dns = (map: Record<string, string[]>): Resolver => async (h) => {
  const a = map[h];
  if (!a) throw new Error(`ENOTFOUND ${h}`);
  return a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

type Route = { status: number; headers?: Record<string, string>; body?: string | Uint8Array[] };
function fakeTransport(routes: Record<string, Route>, log: { url: string; address: string }[] = []) {
  const t: Transport = async (url, { address }) => {
    log.push({ url: url.toString(), address: address.address });
    const r = routes[url.toString()];
    if (!r) throw new Error(`ECONNREFUSED ${url}`);
    let destroyed = false;
    const chunks = typeof r.body === 'string' ? [new TextEncoder().encode(r.body)] : (r.body ?? []);
    const res: TransportResponse & { destroyed: () => boolean } = {
      status: r.status,
      headers: Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      body: (async function* () { for (const c of chunks) { if (destroyed) return; yield c; } })(),
      destroy: () => { destroyed = true; },
      destroyed: () => destroyed,
    };
    return res;
  };
  return t;
}

describe('isPublicIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255',
    '0.0.0.0', '0.1.2.3', '224.0.0.1', '239.255.255.250', '255.255.255.255', '198.18.0.1', '192.0.2.5',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254',
    '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '[::1]', '2001:db8::1',
  ])('%s ist nicht öffentlich', (ip) => expect(isPublicIp(ip)).toBe(false));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '2606:4700::6810:84e5'])(
    '%s ist öffentlich', (ip) => expect(isPublicIp(ip)).toBe(true));

  it('kein gültiges IP-Literal → false', () => {
    expect(isPublicIp('example.com')).toBe(false);
    expect(isPublicIp('0x7f000001')).toBe(false);
  });
});

describe('resolvePublic', () => {
  it('lehnt Hosts ab, deren Auflösung irgendeine private Adresse enthält', async () => {
    await expect(resolvePublic('a.de', dns({ 'a.de': ['93.184.216.34', '10.0.0.5'] }))).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(resolvePublic('metadata.google.internal', dns({ 'metadata.google.internal': ['169.254.169.254'] }))).rejects.toThrow(/nicht öffentliche/);
    await expect(resolvePublic('[::1]', dns({}))).rejects.toBeInstanceOf(BlockedUrlError);
    expect(await resolvePublic('a.de', dns({ 'a.de': ['93.184.216.34'] }))).toEqual({ address: '93.184.216.34', family: 4 });
  });
});

describe('safeFetch', () => {
  const resolve = dns({ 'a.de': ['93.184.216.34'], 'www.a.de': ['93.184.216.35'], 'evil.de': ['127.0.0.1'] });

  it('verbindet an die geprüfte IP (Pinning) und liefert Text', async () => {
    const log: { url: string; address: string }[] = [];
    const r = await safeFetch('https://a.de/', { resolve, transport: fakeTransport({ 'https://a.de/': { status: 200, body: 'hallo' } }, log) });
    expect(r).toMatchObject({ status: 200, text: 'hallo', truncated: false, url: 'https://a.de/' });
    expect(log).toEqual([{ url: 'https://a.de/', address: '93.184.216.34' }]);
  });

  it('URL-Prüfung: nur http(s), Port 80/443, IP-Literale nur öffentlich (auch Hex-Schreibweise)', async () => {
    const transport = fakeTransport({});
    for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://0x7f000001/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/',
      'https://a.de:8443/', 'ftp://a.de/', 'file:///etc/passwd', 'https://user:pw@a.de/']) {
      await expect(safeFetch(u, { resolve: dns({ localhost: ['127.0.0.1'] }), transport }), u).rejects.toBeInstanceOf(BlockedUrlError);
    }
  });

  it('Weiterleitungen manuell: jeder Hop wird neu geprüft', async () => {
    const transport = fakeTransport({
      'https://a.de/': { status: 301, headers: { location: 'https://www.a.de/' } },
      'https://www.a.de/': { status: 302, headers: { location: '/start' } },
      'https://www.a.de/start': { status: 200, body: 'ok' },
      'https://a.de/x': { status: 302, headers: { location: 'http://169.254.169.254/' } },
      'https://a.de/y': { status: 302, headers: { location: 'https://evil.de/' } },
      'https://a.de/z': { status: 302, headers: { location: 'https://a.de:6379/' } },
    });
    expect(await safeFetch('https://a.de/', { resolve, transport })).toMatchObject({ status: 200, text: 'ok', url: 'https://www.a.de/start' });
    await expect(safeFetch('https://a.de/x', { resolve, transport })).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch('https://a.de/y', { resolve, transport })).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch('https://a.de/z', { resolve, transport })).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('höchstens 3 Weiterleitungen', async () => {
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 6; i++) routes[`https://a.de/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
    const log: { url: string; address: string }[] = [];
    const r = await safeFetch('https://a.de/0', { resolve, transport: fakeTransport(routes, log) });
    expect(r.status).toBe(302);
    expect(log).toHaveLength(4); // 1 Abruf + 3 Weiterleitungen
  });

  it('Body wird nach maxBytes abgebrochen – auch ohne/mit großem content-length', async () => {
    const chunk = new Uint8Array(1000).fill(97);
    const transport = fakeTransport({ 'https://a.de/': { status: 200, headers: { 'content-length': '999999999' }, body: Array(50).fill(chunk) } });
    const r = await safeFetch('https://a.de/', { resolve, transport, maxBytes: 2500 });
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(2500);
  });
});

describe('Website-Check mit sicherem Abruf', () => {
  it('Apex nicht erreichbar → www.<apex> wird versucht', async () => {
    const transport = fakeTransport({
      'https://www.a.de/robots.txt': { status: 200, body: 'User-agent: GPTBot\nDisallow: /\n' },
      'https://www.a.de/llms.txt': { status: 404, body: '' },
      'https://www.a.de/': { status: 200, body: '<html><body><h1>Hallo</h1></body></html>' },
    });
    const r = await checkDomain('a.de', { resolve: dns({ 'a.de': ['93.184.216.34'], 'www.a.de': ['93.184.216.35'] }), transport });
    expect(r.home.status).toBe(200);
    expect(r.robots.blocked).toContain('GPTBot');
  });

  it('Domain auf private Adresse → kein Abruf, Fehlschlag', async () => {
    const log: { url: string; address: string }[] = [];
    const r = await checkDomain('intern.de', { resolve: dns({ 'intern.de': ['192.168.0.10'], 'www.intern.de': ['10.0.0.1'] }), transport: fakeTransport({}, log) });
    expect(log).toHaveLength(0);
    expect(r.home.status).toBeNull();
    expect(r.home.error).toMatch(/nicht öffentliche/);
  });

  it('robots.txt 429 ist unbekannt (wie 5xx)', async () => {
    expect(robotsStatusUnknown(429)).toBe(true);
    expect(robotsStatusUnknown(503)).toBe(true);
    expect(robotsStatusUnknown(null)).toBe(true);
    expect(robotsStatusUnknown(404)).toBe(false);
    const transport = fakeTransport({
      'https://a.de/robots.txt': { status: 429, body: 'User-agent: *\nDisallow: /' },
      'https://a.de/llms.txt': { status: 404 },
      'https://a.de/': { status: 200, body: '<body>x</body>' },
    });
    const r = await checkDomain('a.de', { resolve: dns({ 'a.de': ['93.184.216.34'] }), transport });
    expect(r.robots.found).toBe(false);
    expect(technicalCovered('technical:robots', [r])).toBe(false);
  });
});

describe('technicalCovered je Domain', () => {
  const ok: SiteCheckResult = { domain: 'a.de', home: { status: 200, finalUrl: 'https://a.de/', textChars: 1000, jsonLd: [] }, robots: { status: 200, found: true, blocked: [], allowed: [] }, llmsTxt: { status: 404, found: false } };
  it('eine erreichbare und eine gescheiterte Domain → nicht abgedeckt', () => {
    const failed: SiteCheckResult = { ...ok, domain: 'b.de', home: { ...ok.home, status: 503 }, robots: { ...ok.robots, status: null } };
    expect(technicalCovered('technical:structured_data', [ok])).toBe(true);
    expect(technicalCovered('technical:structured_data', [ok, failed])).toBe(false);
    expect(technicalCovered('technical:js_text', [ok, { ...failed, home: { ...ok.home, status: 429 } }])).toBe(false);
    expect(technicalCovered('technical:js_text', [ok, { ...failed, home: { ...ok.home, status: 404 } }])).toBe(true);
    expect(technicalCovered('technical:robots', [ok, { ...ok, robots: { ...ok.robots, status: 429 } }])).toBe(false);
  });
});

describe('Validierung von URLs und Marken-Domains', () => {
  it('safeHttpUrl lässt nur http(s) durch', () => {
    expect(safeHttpUrl('https://a.de/x')).toBe('https://a.de/x');
    expect(safeHttpUrl('http://a.de')).toBe('http://a.de');
    for (const u of ['javascript://evil.com/%0aalert(1)', 'data:text/html,x', 'file:///etc/passwd', '/relativ', 'evil.com', '', null]) expect(safeHttpUrl(u)).toBeNull();
  });

  it.each(['localhost', '127.0.0.1', '0x7f000001', '169.254.169.254', '[::1]', '::1', 'metadata.google.internal', 'drucker.local', 'app.localhost', 'intranet', 'http://10.0.0.1:8080/'])(
    '%s wird abgelehnt', (d) => {
      const r = validateBrandDomain(d);
      expect('error' in r && r.error).toBeTruthy();
    });

  it('gültige Domains werden normalisiert', () => {
    expect(validateBrandDomain('https://www.Paylindo.de/preise')).toEqual({ domain: 'paylindo.de' });
    expect(validateBrandDomain('müller.de')).toEqual({ domain: 'xn--mller-kva.de' });
    expect(validateBrandDomains(Array.from({ length: 11 }, (_, i) => `d${i}.de`))).toEqual({ error: 'Höchstens 10 Domains je Marke.' });
    expect(validateBrandDomains(['a.de', 'www.a.de', 'b.de'])).toEqual({ domains: ['a.de', 'b.de'] });
  });
});
