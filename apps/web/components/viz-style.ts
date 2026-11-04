// Farben der visuellen Bausteine (reine Werte, aus Server- und Client-Komponenten nutzbar).
import type { RecCategory } from '@askmetry/core/present';

export const TONE: Record<'red' | 'amber' | 'green', string> = { red: 'var(--bad)', amber: '#d97706', green: 'var(--good)' };
export const toneColor = (tone: 'red' | 'amber' | 'green') => TONE[tone];

export const CAT_STYLE: Record<RecCategory, { fg: string; soft: string; text: string; bg: string; border: string }> = {
  content: { fg: 'var(--cat-content)', soft: 'var(--cat-content-soft)', text: 'text-cat-content', bg: 'bg-cat-content-soft', border: 'border-cat-content' },
  offsite: { fg: 'var(--cat-external)', soft: 'var(--cat-external-soft)', text: 'text-cat-external', bg: 'bg-cat-external-soft', border: 'border-cat-external' },
  community: { fg: 'var(--cat-community)', soft: 'var(--cat-community-soft)', text: 'text-cat-community', bg: 'bg-cat-community-soft', border: 'border-cat-community' },
  technical: { fg: 'var(--cat-tech)', soft: 'var(--cat-tech-soft)', text: 'text-cat-tech', bg: 'bg-cat-tech-soft', border: 'border-cat-tech' },
};
