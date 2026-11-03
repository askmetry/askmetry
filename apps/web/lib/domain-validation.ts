import { parseList } from './metrics.ts';

// Marken-Domains werden später vom Website-Check abgerufen – nur öffentliche Hostnamen zulassen
// (gleiche Regeln wie validateBrandDomain in packages/core/src/domains.ts).
const MAX_BRAND_DOMAINS = 10;
export function validateDomains(input: string): { domains: string[] } | { error: string } {
  const out: string[] = [];
  for (const raw of input.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const host = parseList(raw, { domains: true })[0] ?? '';
    let bare = host;
    try { bare = new URL(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}/`).hostname.replace(/^\[|\]$/g, ''); } catch { bare = ''; }
    bare = bare.replace(/^www\./, '');
    if (!bare) return { error: `„${raw}“ ist keine gültige Domain.` };
    if (/^[\d.]+$/.test(bare) || bare.includes(':')) return { error: `„${raw}“: Bitte eine Domain statt einer IP-Adresse angeben.` };
    if (!bare.includes('.')) return { error: `„${raw}“ ist keine öffentliche Domain (Punkt fehlt, z. B. beispiel.de).` };
    if (bare === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa|intranet|corp)$/.test(bare) || /^(localhost|metadata)\./.test(bare)) {
      return { error: `„${raw}“ ist keine öffentliche Domain.` };
    }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/.test(bare)) return { error: `„${raw}“ ist keine gültige Domain.` };
    if (!out.includes(bare)) out.push(bare);
  }
  if (out.length > MAX_BRAND_DOMAINS) return { error: `Höchstens ${MAX_BRAND_DOMAINS} Domains je Marke.` };
  return { domains: out };
}

