// Reine Darstellungslogik des Schnell-Check-Teasers (ohne DB, testbar). Zahlen kommen nur aus CheckSummary – nichts wird erfunden.
import type { RecCategory } from '@askmetry/core/present';
import type { CheckStatus, CheckSummary, RecArea } from '@askmetry/core/hosted/types';

/** Teaser-Bereiche in der Reihenfolge der Maßnahmen-Seite und ihre Kategorie (Icon/Farbe/Label aus present.ts). */
export const AREA_ORDER: readonly RecArea[] = ['own_content', 'other_sites', 'community', 'technical'];
export const AREA_CATEGORY: Record<RecArea, RecCategory> = {
  own_content: 'content', other_sites: 'offsite', community: 'community', technical: 'technical',
};

/**
 * Grober Sichtbarkeitswert (0–100) aus einer kleinen Stichprobe: auf 5er-Schritte gerundet,
 * damit niemand eine Genauigkeit liest, die 25–35 Antworten nicht hergeben. Ganz ohne Nennung bleibt es 0,
 * mit mindestens einer Nennung nie 0 (sonst widerspräche die Zahl dem Satz „in 1 von 10 Fragen genannt“).
 */
export function roughScore(visibility: number | null | undefined): number {
  if (visibility === null || visibility === undefined || !Number.isFinite(visibility) || visibility <= 0) return 0;
  const v = Math.min(1, visibility);
  return Math.max(5, Math.round((v * 100) / 5) * 5);
}

/** Zahl der gesperrten Maßnahmen: alle außer den frei gezeigten (nie negativ). */
export function lockedCount(summary: Pick<CheckSummary, 'recommendationsTotal'>, freeShown: number): number {
  return Math.max(0, (summary.recommendationsTotal ?? 0) - Math.max(0, freeShown));
}

/** Bereiche mit Anzahl, in fester Reihenfolge; leere Bereiche bleiben weg. */
export function areaCounts(counts: Partial<Record<RecArea, number>> | null | undefined): { area: RecArea; cat: RecCategory; n: number }[] {
  return AREA_ORDER.map((area) => ({ area, cat: AREA_CATEGORY[area], n: Math.max(0, Math.round(counts?.[area] ?? 0)) })).filter((x) => x.n > 0);
}

export type TeaserRankRow = { name: string; promptsMentioned: number; own: boolean };

/** Rangliste „in X von 10 Fragen“: eigene Marke + bis zu 5 Wettbewerber, absteigend; bei Gleichstand die eigene zuerst. */
export function teaserRanking(summary: Pick<CheckSummary, 'brand' | 'promptsMentioned' | 'competitors'>, n = 5): TeaserRankRow[] {
  const rows: TeaserRankRow[] = [
    { name: summary.brand.name, promptsMentioned: summary.promptsMentioned, own: true },
    ...summary.competitors.slice(0, n).map((c) => ({ name: c.name, promptsMentioned: c.promptsMentioned, own: false })),
  ];
  return rows.sort((a, b) => b.promptsMentioned - a.promptsMentioned || Number(b.own) - Number(a.own) || a.name.localeCompare(b.name, 'de'));
}

/** Stärkster Wettbewerber nur, wenn er überhaupt genannt wurde. */
export function strongestCompetitor(summary: Pick<CheckSummary, 'topCompetitor'>): { name: string; promptsMentioned: number } | null {
  const c = summary.topCompetitor;
  return c && c.promptsMentioned > 0 ? c : null;
}

/** Fortschrittsschritte des Checks: 0 Website lesen · 1 E-Mail · 2 Messung · 3 Ergebnis. Liefert den aktuellen Schritt. */
export function checkStep(status: CheckStatus): 0 | 1 | 2 | 3 {
  switch (status) {
    case 'discovering': return 0;
    case 'awaiting_email': return 1;
    case 'queued':
    case 'measuring': return 2;
    default: return 3;
  }
}

/** Sekunden bis zum nächsten automatischen Aktualisieren (null = nicht nötig). */
export function refreshSeconds(status: CheckStatus): number | null {
  if (status === 'discovering') return 3;
  if (status === 'queued' || status === 'measuring') return 5;
  return null;
}

/** Domain für Anzeige und Link: ohne Protokoll/Pfad, ohne „www.“. Ungültiges → null. */
export function cleanDomain(d: string): string | null {
  const host = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/.test(host) ? host : null;
}
