import 'server-only';
import { domainsWithLogo } from '@opengeo/core';

type B = { id?: string; name: string; domains: string[]; logoType?: string | null; logoUpdatedAt?: Date | null };

/** Logo-URL je Markenname: eigenes Upload-Logo vor Website-Logo (erste Domain); null → Initiale. */
export async function logoMap(slug: string, brands: B[]): Promise<Map<string, string | null>> {
  const first = (b: B) => b.domains[0]?.toLowerCase().replace(/^www\./, '') ?? null;
  const has = await domainsWithLogo(brands.filter((b) => !b.logoType).map(first).filter((d): d is string => !!d));
  const m = new Map<string, string | null>();
  for (const b of brands) {
    if (m.has(b.name.toLowerCase())) continue; // gleicher Name zweimal: erste Marke gewinnt (eigene Marke kommt zuerst)
    if (b.logoType && b.id) { m.set(b.name.toLowerCase(), `/w/${slug}/markenlogo/${b.id}?v=${b.logoUpdatedAt?.getTime() ?? 0}`); continue; }
    const d = first(b);
    m.set(b.name.toLowerCase(), d && has.has(d) ? `/w/${slug}/logo/${encodeURIComponent(d)}` : null);
  }
  return m;
}
