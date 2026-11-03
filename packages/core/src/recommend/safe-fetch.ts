// Abruf fremder Websites ohne SSRF: nur http(s) auf Port 80/443, nur öffentliche IP-Adressen,
// Weiterleitungen manuell (jeder Hop neu geprüft), Verbindung an die geprüfte IP gepinnt (kein DNS-Rebinding),
// Body gestreamt und nach maxBytes abgebrochen.
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type TransportResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array | string>;
  /** Verbindung schließen, ohne den Rest zu lesen. */
  destroy(): void;
};
/** Eine einzelne Anfrage an genau die übergebene, bereits geprüfte Adresse (keine eigene DNS-Auflösung, keine Weiterleitung). */
export type Transport = (url: URL, opts: { address: ResolvedAddress; headers: Record<string, string>; signal: AbortSignal }) => Promise<TransportResponse>;

export type SafeFetchOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxBytes?: number;
  maxRedirects?: number;
  resolve?: Resolver;
  transport?: Transport;
  /** Body als Bytes statt Text (Bilder) */
  binary?: boolean;
};
export type SafeFetchResult = { status: number; url: string; text: string; truncated: boolean; bytes?: Uint8Array; contentType?: string | null };

export const SAFE_FETCH_MAX_BYTES = 2_000_000;
export const SAFE_FETCH_MAX_REDIRECTS = 3;

export class BlockedUrlError extends Error {
  constructor(message: string) { super(message); this.name = 'BlockedUrlError'; }
}

// ---------------------------------------------------------------------------
// IP-Prüfung
// ---------------------------------------------------------------------------

function v4Bytes(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const b = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return b.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? b : null;
}

function v6Bytes(ip: string): number[] | null {
  let s = ip.replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  let tail: number[] = [];
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (dotted) {
    const b = v4Bytes(dotted[1]);
    if (!b) return null;
    tail = b;
    s = s.slice(0, -dotted[1].length);
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h ? h.split(':') : []);
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const groupsNeeded = 8 - tail.length / 2;
  const fill = halves.length === 2 ? groupsNeeded - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== groupsNeeded)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...rest];
  if (groups.length !== groupsNeeded || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const out: number[] = [];
  for (const g of groups) { const n = parseInt(g, 16); out.push(n >> 8, n & 0xff); }
  return [...out, ...tail];
}

const inPrefix = (bytes: number[], prefix: number[], bits: number) => {
  for (let i = 0; i < bits; i++) {
    const bit = (b: number[], k: number) => (b[k >> 3] >> (7 - (k & 7))) & 1;
    if (bit(bytes, i) !== bit(prefix, i)) return false;
  }
  return true;
};

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const V6_BLOCKED: [string, number][] = [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32],
  ['100::', 64], ['2001::', 23],
];
/** IPv6-Bereiche, die eine IPv4-Adresse einbetten: IPv4-mapped, IPv4-compatible, NAT64; 6to4 (2002::/16) hat sie in Byte 2–5. */
const V6_EMBEDDED_V4: [string, number][] = [['::ffff:0:0', 96], ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48]];

/** Öffentliche, global erreichbare Unicast-Adresse? Loopback, privat (RFC 1918), link-local, ULA, CGNAT, Multicast, Doku-Netze usw. → false. */
export function isPublicIp(ip: string): boolean {
  const fam = isIP(ip.replace(/^\[|\]$/g, ''));
  if (fam === 4) {
    const b = v4Bytes(ip)!;
    return !V4_BLOCKED.some(([p, bits]) => inPrefix(b, v4Bytes(p)!, bits));
  }
  if (fam === 6) {
    const b = v6Bytes(ip);
    if (!b) return false;
    for (const [p, bits] of V6_EMBEDDED_V4) {
      if (inPrefix(b, v6Bytes(p)!, bits) && !(p === '::' && b.every((x) => x === 0))) {
        return isPublicIp(b.slice(12).join('.'));
      }
    }
    if (inPrefix(b, v6Bytes('2002::')!, 16)) return isPublicIp(b.slice(2, 6).join('.'));
    return !V6_BLOCKED.some(([p, bits]) => inPrefix(b, v6Bytes(p)!, bits));
  }
  return false;
}

/** URL vor dem Abruf prüfen: nur http/https, nur Port 80/443, keine Zugangsdaten in der URL. */
export function assertFetchableUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError(`Protokoll ${url.protocol} nicht erlaubt`);
  if (url.port && url.port !== '80' && url.port !== '443') throw new BlockedUrlError(`Port ${url.port} nicht erlaubt`);
  if (url.username || url.password) throw new BlockedUrlError('Zugangsdaten in der URL nicht erlaubt');
}

const defaultResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/** Host auflösen und prüfen: jede gelieferte Adresse muss öffentlich sein (sonst Abbruch), Rückgabe = Adresse für die Verbindung. */
export async function resolvePublic(hostname: string, resolve: Resolver = defaultResolver): Promise<ResolvedAddress> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host);
  if (literal) {
    if (!isPublicIp(host)) throw new BlockedUrlError(`Adresse ${host} ist nicht öffentlich`);
    return { address: host, family: literal === 6 ? 6 : 4 };
  }
  const addrs = await resolve(host);
  if (!addrs.length) throw new BlockedUrlError(`${host} lässt sich nicht auflösen`);
  const bad = addrs.find((a) => !isPublicIp(a.address));
  if (bad) throw new BlockedUrlError(`${host} zeigt auf die nicht öffentliche Adresse ${bad.address}`);
  return addrs[0];
}

// ---------------------------------------------------------------------------
// Transport (node:http/https, an die geprüfte IP gepinnt)
// ---------------------------------------------------------------------------

export const nodeTransport: Transport = (url, { address, headers, signal }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      headers,
      signal,
      agent: false,
      // Verbindung geht genau an die geprüfte Adresse; TLS-Zertifikat/SNI weiter gegen den Hostnamen
      lookup: ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
        if (opts?.all) cb(null, [{ address: address.address, family: address.family }]);
        else cb(null, address.address, address.family);
      }) as never,
    }, (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, destroy: () => res.destroy() });
    });
    req.on('error', reject);
    req.end();
  });

// ---------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------

const header = (h: TransportResponse['headers'], name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

async function readLimited(res: TransportResponse, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  let truncated = false;
  try {
    for await (const chunk of res.body) {
      const buf = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      const take = Math.min(buf.length, maxBytes - bytes);
      text += decoder.decode(buf.subarray(0, take), { stream: true });
      bytes += take;
      if (take < buf.length || bytes >= maxBytes) { truncated = take < buf.length || bytes >= maxBytes; break; }
    }
  } finally {
    if (truncated) res.destroy();
  }
  return { text: text + decoder.decode(), truncated };
}

async function readLimitedBytes(res: TransportResponse, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const parts: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for await (const chunk of res.body) {
      const buf = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      const take = Math.min(buf.length, maxBytes - bytes);
      parts.push(buf.subarray(0, take));
      bytes += take;
      if (take < buf.length || bytes >= maxBytes) { truncated = true; break; }
    }
  } finally {
    if (truncated) res.destroy();
  }
  const out = new Uint8Array(bytes);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { bytes: out, truncated };
}

/**
 * GET mit SSRF-Schutz. Wirft BlockedUrlError bei unzulässigem Ziel (auch nach einer Weiterleitung),
 * sonst Netzwerkfehler wie fetch. 3xx ohne weitere erlaubte Hops wird als Status zurückgegeben.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? SAFE_FETCH_MAX_REDIRECTS;
  const transport = opts.transport ?? nodeTransport;
  const signal = opts.signal ?? AbortSignal.timeout(10_000);
  let url = new URL(input);
  for (let hop = 0; ; hop++) {
    assertFetchableUrl(url);
    signal.throwIfAborted();
    const address = await resolvePublic(url.hostname, opts.resolve);
    const res = await transport(url, { address, headers: { ...(opts.headers ?? {}) }, signal });
    const location = header(res.headers, 'location');
    if (res.status >= 300 && res.status < 400 && location) {
      res.destroy();
      if (hop >= maxRedirects) return { status: res.status, url: url.toString(), text: '', truncated: false };
      url = new URL(location, url);
      continue;
    }
    const contentType = header(res.headers, 'content-type') ?? null;
    if (opts.binary) {
      const { bytes, truncated } = await readLimitedBytes(res, maxBytes);
      return { status: res.status, url: url.toString(), text: '', truncated, bytes, contentType };
    }
    // Große Antworten nicht komplett laden – auch wenn content-length das Limit schon überschreitet, nur den Anfang lesen
    const { text, truncated } = await readLimited(res, maxBytes);
    return { status: res.status, url: url.toString(), text, truncated, contentType };
  }
}
