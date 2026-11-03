// Reine Helfer für die vereinfachte Oberfläche (Übersicht, Fragen, Einstellungen) – ohne DB, testbar.
import { normalizeHost, type Cit } from './metrics';
import { subredditOf } from './sources';

/** Füllgrad für Punkte: ○ nie · ◐ teils · ● oft. null = keine Daten. */
export type Fill = 'none' | 'some' | 'often';
export function fillLevel(rate: number | null | undefined): Fill | null {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return null;
  if (rate <= 0) return 'none';
  return rate < 0.6 ? 'some' : 'often';
}

/** Anteil 0..1 → Score 0–100 (gerundet). */
export const toScore = (rate: number | null | undefined) => (rate === null || rate === undefined || Number.isNaN(rate) ? 0 : Math.round(Math.max(0, Math.min(1, rate)) * 100));

export type RankRow = { name: string; responses: number; rate: number | null; own: boolean };
/** Top n nach Nennungen, eigene Marke immer dabei (ggf. als zusätzliche Zeile). */
export function rankingWithOwn(rows: readonly RankRow[], n = 5): { rows: (RankRow & { place: number })[]; ownExtra: boolean } {
  const sorted = [...rows].sort((a, b) => b.responses - a.responses || Number(b.own) - Number(a.own) || a.name.localeCompare(b.name, 'de'))
    .map((r, i) => ({ ...r, place: i + 1 }));
  const top = sorted.slice(0, n);
  const own = sorted.find((r) => r.own);
  if (own && !top.includes(own)) return { rows: [...top, own], ownExtra: true };
  return { rows: top, ownExtra: false };
}

/** Quellen, die Antworten geprägt haben: Domains (Reddit nach Subreddit) nach Anzahl Antworten. */
export function shapingSources(cits: readonly Cit[], n = 3, exclude: readonly string[] = []): { label: string; responses: number }[] {
  const by = new Map<string, Set<string>>();
  for (const c of cits) {
    const host = normalizeHost(c.domain || c.url);
    if (!host || exclude.some((d) => host === d || host.endsWith('.' + d))) continue;
    const label = subredditOf(c.url) ?? host;
    const s = by.get(label) ?? new Set<string>();
    s.add(c.responseId);
    by.set(label, s);
  }
  return [...by.entries()].map(([label, s]) => ({ label, responses: s.size }))
    .sort((a, b) => b.responses - a.responses || a.label.localeCompare(b.label)).slice(0, n);
}

/** Aufzählung auf Deutsch: „A, B und C“. */
export function joinDe(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} und ${xs[xs.length - 1]}`;
}

export { parseSimpleCron, scheduleText, toCron, WEEKDAYS, type Schedule } from './schedule';

// ---------------------------------------------------------------------------
// Quellen ↔ Maßnahmen: Domain/Subreddit → id einer aktiven Maßnahme
// ---------------------------------------------------------------------------

type RecKeyRow = { id: string; key: string; active: boolean; status: string };

/** Ziel einer Maßnahme aus ihrem Schlüssel: Domain („outreach:x.de“) oder Subreddit („community:reddit:r/x“ → „r/x“). */
export function recTarget(key: string): string | null {
  if (key.startsWith('outreach:')) return key.slice(9).toLowerCase() || null;
  const m = /^community:(\w+):(.+)$/.exec(key);
  if (!m) return null;
  const [, kind, id] = m as unknown as [string, string, string];
  if (kind === 'reddit') return id.toLowerCase();
  if (kind === 'youtube') return 'youtube.com';
  return id.toLowerCase();
}

/** Ziel → Maßnahmen-id (nur aktive, nicht ausgeblendete). */
export function recTargets(recs: readonly RecKeyRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of recs) {
    if (!r.active || r.status === 'dismissed') continue;
    const t = recTarget(r.key);
    if (t && !out.has(t)) out.set(t, r.id);
  }
  return out;
}

export function recForDomain(targets: ReadonlyMap<string, string>, domain: string): string | undefined {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return targets.get(d) ?? targets.get('www.' + d);
}

/** Top n einer (bereits sortierten, mit Platz versehenen) Rangliste; die eigene Marke immer dabei. */
export function topWithOwn<T extends { own: boolean; place: number }>(rows: readonly T[], n = 5): { rows: T[]; ownExtra: boolean } {
  const top = rows.slice(0, n);
  const own = rows.find((r) => r.own);
  if (own && !top.includes(own)) return { rows: [...top, own], ownExtra: true };
  return { rows: top, ownExtra: false };
}
