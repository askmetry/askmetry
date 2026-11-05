// Farben der visuellen Bausteine (reine Werte, aus Server- und Client-Komponenten nutzbar).
import { categoryText, type Lang, type RecCategory } from '@askmetry/core/present';

export const TONE: Record<'red' | 'amber' | 'green', string> = { red: 'var(--bad)', amber: '#d97706', green: 'var(--good)' };
export const toneColor = (tone: 'red' | 'amber' | 'green') => TONE[tone];

export const CAT_STYLE: Record<RecCategory, { fg: string; soft: string; text: string; bg: string; border: string }> = {
  content: { fg: 'var(--cat-content)', soft: 'var(--cat-content-soft)', text: 'text-cat-content', bg: 'bg-cat-content-soft', border: 'border-cat-content' },
  offsite: { fg: 'var(--cat-external)', soft: 'var(--cat-external-soft)', text: 'text-cat-external', bg: 'bg-cat-external-soft', border: 'border-cat-external' },
  community: { fg: 'var(--cat-community)', soft: 'var(--cat-community-soft)', text: 'text-cat-community', bg: 'bg-cat-community-soft', border: 'border-cat-community' },
  technical: { fg: 'var(--cat-tech)', soft: 'var(--cat-tech-soft)', text: 'text-cat-tech', bg: 'bg-cat-tech-soft', border: 'border-cat-tech' },
};

/** Stil einer Kategorie – neue/unbekannte Kategorien (z. B. aus einer neueren Maßnahmen-Erzeugung) bekommen den neutralen Technik-Stil. */
export const catStyle = (cat: string) => (CAT_STYLE as Record<string, (typeof CAT_STYLE)[RecCategory]>)[cat] ?? CAT_STYLE.technical;

/** Kategorie-Bezeichnung; unbekannte Kategorien fallen auf ihren Schlüssel zurück, statt die Seite zu kippen. */
export function catText(cat: RecCategory, locale: Lang): { label: string; owner: string } {
  try {
    const c = categoryText(cat, locale);
    if (c?.label) return c;
  } catch { /* unten */ }
  const k = String(cat).replace(/[_-]+/g, ' ');
  return { label: k.charAt(0).toUpperCase() + k.slice(1), owner: '' };
}

/** Wirkung 1–3 aus dem Feld `impact` der Maßnahme (wie impactText: ab 3 groß, 2 mittel, sonst klein). */
export const impactLevel = (impact: number): 1 | 2 | 3 => (impact >= 3 ? 3 : impact === 2 ? 2 : 1);
