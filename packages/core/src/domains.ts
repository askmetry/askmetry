import { domainToASCII } from 'node:url';

/**
 * Host einer URL (oder eines Hostnamens) ohne `www.`, kleingeschrieben, IDN als Punycode
 * („müller.de“ → „xn--mller-kva.de“) – Marken-Domains und Citation-Hosts landen so in derselben Form.
 * null bei ungültiger Eingabe.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, '');
  host = (domainToASCII(host) || host).replace(/^www\./, '');
  return host || null;
}

/** Exakte Domain oder Subdomain – "notpaylindo.de" zählt nicht als "paylindo.de". */
export function matchesDomain(host: string | null | undefined, domain: string | null | undefined): boolean {
  const h = normalizeDomain(host ?? '');
  const d = normalizeDomain(domain ?? '');
  return !!h && !!d && (h === d || h.endsWith(`.${d}`));
}

export function matchesAnyDomain(host: string | null | undefined, domains: readonly string[] | null | undefined): boolean {
  return (domains ?? []).some((d) => matchesDomain(host, d));
}

/** Nur absolute http(s)-URLs mit Host – alles andere (javascript:, data:, file:, relative Pfade) → null. */
export function safeHttpUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  return s;
}

export const MAX_BRAND_DOMAINS = 10;

/**
 * Marken-Domain beim Speichern prüfen: öffentlicher Hostname mit Punkt, keine blanke IP-Adresse,
 * kein localhost/.local/.internal/.localhost. Liefert die normalisierte Domain oder eine deutsche Fehlermeldung.
 */
export function validateBrandDomain(input: string): { domain: string } | { error: string } {
  const raw = input.trim();
  const host = normalizeDomain(raw);
  if (!host) return { error: `„${raw}“ ist keine gültige Domain.` };
  const bare = host.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) return { error: `„${raw}“: Bitte eine Domain statt einer IP-Adresse angeben.` };
  if (!bare.includes('.')) return { error: `„${raw}“ ist keine öffentliche Domain (Punkt fehlt, z. B. beispiel.de).` };
  if (bare === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa|intranet|corp)$/.test(bare) || /^(localhost|metadata)\./.test(bare)) {
    return { error: `„${raw}“ ist keine öffentliche Domain.` };
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/.test(bare)) return { error: `„${raw}“ ist keine gültige Domain.` };
  return { domain: bare };
}

/** Liste von Marken-Domains prüfen (höchstens MAX_BRAND_DOMAINS). */
export function validateBrandDomains(inputs: string[]): { domains: string[] } | { error: string } {
  const out: string[] = [];
  for (const d of inputs) {
    const r = validateBrandDomain(d);
    if ('error' in r) return r;
    if (!out.includes(r.domain)) out.push(r.domain);
  }
  if (out.length > MAX_BRAND_DOMAINS) return { error: `Höchstens ${MAX_BRAND_DOMAINS} Domains je Marke.` };
  return { domains: out };
}
