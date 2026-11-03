// Kleine visuelle Bausteine (SVG, ohne Client-JS): Score-Ring, Füllpunkte, Kategorie-Icons.
import type { RecCategory } from '@opengeo/core/present';
import { CATEGORIES } from '@opengeo/core/present';
import type { Fill } from '@/lib/view';

const TONE: Record<'red' | 'amber' | 'green', string> = { red: 'var(--bad)', amber: '#d97706', green: 'var(--good)' };

/** Ring mit Score 0–100 und Ampelfarbe. */
export function ScoreRing({ score, tone, size = 148 }: { score: number; tone: 'red' | 'amber' | 'green'; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  // sehr kleine Werte trotzdem als Bogen erkennbar machen
  const dash = pct === 0 ? 0 : Math.max(2.5, (pct / 100) * c);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`KI-Sichtbarkeit ${pct} von 100`} className="shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--subtle)" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={TONE[tone]} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="var(--fg)" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }}>{pct}</text>
      <text x="50" y="70" textAnchor="middle" fill="var(--muted)" style={{ fontSize: 8.5 }}>von 100</text>
    </svg>
  );
}

export const toneColor = (tone: 'red' | 'amber' | 'green') => TONE[tone];

const FILL_LABEL: Record<Fill, string> = { none: 'nie genannt', some: 'teils genannt', often: 'oft genannt' };

/** Füllpunkt ○ ◐ ● (grau-leer statt rot). fill=null → keine Antwort. */
export function Dot({ fill, size = 14, title }: { fill: Fill | null; size?: number; title?: string }) {
  const t = title ?? (fill ? FILL_LABEL[fill] : 'keine Antwort');
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={t} className="inline-block shrink-0">
      <title>{t}</title>
      {fill === null ? (
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="2 2" />
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" fill={fill === 'often' ? 'var(--own)' : 'none'} stroke={fill === 'none' ? 'var(--faint)' : 'var(--own)'} strokeWidth="1.5" />
          {fill === 'some' && <path d="M8 1.75 A6.25 6.25 0 0 1 8 14.25 Z" fill="var(--own)" />}
        </>
      )}
    </svg>
  );
}

export const CAT_STYLE: Record<RecCategory, { fg: string; soft: string; text: string; bg: string; border: string }> = {
  content: { fg: 'var(--cat-content)', soft: 'var(--cat-content-soft)', text: 'text-cat-content', bg: 'bg-cat-content-soft', border: 'border-cat-content' },
  offsite: { fg: 'var(--cat-external)', soft: 'var(--cat-external-soft)', text: 'text-cat-external', bg: 'bg-cat-external-soft', border: 'border-cat-external' },
  community: { fg: 'var(--cat-community)', soft: 'var(--cat-community-soft)', text: 'text-cat-community', bg: 'bg-cat-community-soft', border: 'border-cat-community' },
  technical: { fg: 'var(--cat-tech)', soft: 'var(--cat-tech-soft)', text: 'text-cat-tech', bg: 'bg-cat-tech-soft', border: 'border-cat-tech' },
};

/** Icon je Kategorie: Dokument · Globus · Sprechblase · Zahnrad. */
export function CategoryIcon({ cat, size = 16 }: { cat: RecCategory; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (cat) {
    case 'content':
      return <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
    case 'offsite':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
    case 'community':
      return <svg {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;
    case 'technical':
      return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>;
  }
}

/** Kategorie-Label mit Icon in Kategoriefarbe. */
export function CategoryTag({ cat, owner = false }: { cat: RecCategory; owner?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${CAT_STYLE[cat].text}`}>
      <CategoryIcon cat={cat} size={15} />
      {CATEGORIES[cat].label}
      {owner && <span className="font-normal text-muted">· {CATEGORIES[cat].owner}</span>}
    </span>
  );
}
