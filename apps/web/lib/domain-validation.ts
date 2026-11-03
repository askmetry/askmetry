import { parseList } from './metrics.ts';
import { messages } from './i18n/messages';
import type { Locale } from './i18n/config';

// Marken-Domains werden später vom Website-Check abgerufen – nur öffentliche Hostnamen zulassen
// (gleiche Regeln wie validateBrandDomain in packages/core/src/domains.ts).
const MAX_BRAND_DOMAINS = 10;
export function validateDomains(input: string, locale: Locale = 'de'): { domains: string[] } | { error: string } {
  const t = messages[locale].settings.domains;
  const out: string[] = [];
  for (const raw of input.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const host = parseList(raw, { domains: true })[0] ?? '';
    let bare = host;
    try { bare = new URL(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}/`).hostname.replace(/^\[|\]$/g, ''); } catch { bare = ''; }
    bare = bare.replace(/^www\./, '');
    if (!bare) return { error: t.invalid(raw) };
    if (/^[\d.]+$/.test(bare) || bare.includes(':')) return { error: t.ip(raw) };
    if (!bare.includes('.')) return { error: t.noDot(raw) };
    if (bare === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa|intranet|corp)$/.test(bare) || /^(localhost|metadata)\./.test(bare)) {
      return { error: t.notPublic(raw) };
    }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/.test(bare)) return { error: t.invalid(raw) };
    if (!out.includes(bare)) out.push(bare);
  }
  if (out.length > MAX_BRAND_DOMAINS) return { error: t.tooMany(MAX_BRAND_DOMAINS) };
  return { domains: out };
}

