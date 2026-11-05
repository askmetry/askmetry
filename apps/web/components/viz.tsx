'use client';
// Kleine visuelle Bausteine (SVG): Score-Ring, Füllpunkte, Kategorie-Icons.
// Client-Komponenten (Texte über useI18n), damit sie auch in Client-Komponenten wie RecCard nutzbar sind.
import type { RecCategory } from '@askmetry/core/present';
import { impactText } from '@askmetry/core/present';
import { useI18n } from '@/lib/i18n/client';
import type { Fill } from '@/lib/view';
import { catStyle, catText, impactLevel, TONE } from '@/components/viz-style';


/** Ring mit Score 0–100 und Ampelfarbe. */
export function ScoreRing({ score, tone, size = 148 }: { score: number; tone: 'red' | 'amber' | 'green'; size?: number }) {
  const t = useI18n().t.overview.ui;
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  // sehr kleine Werte trotzdem als Bogen erkennbar machen
  const dash = pct === 0 ? 0 : Math.max(2.5, (pct / 100) * c);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={t.scoreAria(pct)} className="shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--subtle)" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={TONE[tone]} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="var(--fg)" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }}>{pct}</text>
      <text x="50" y="70" textAnchor="middle" fill="var(--muted)" style={{ fontSize: 8.5 }}>{t.of100}</text>
    </svg>
  );
}



/** Füllpunkt ○ ◐ ● (grau-leer statt rot). fill=null → keine Antwort. */
export function Dot({ fill, size = 14, title }: { fill: Fill | null; size?: number; title?: string }) {
  const u = useI18n().t.overview.ui;
  const label: Record<Fill, string> = { none: u.fillNone, some: u.fillSome, often: u.fillOften };
  const t = title ?? (fill ? label[fill] : u.noAnswer);
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
    default: // neue Kategorie: neutraler Punkt
      return <svg {...p}><circle cx="12" cy="12" r="4" /></svg>;
  }
}

/**
 * Wirkung einer Maßnahme als Stufen-Balken (1–3 gefüllt, wie eine Signalanzeige) plus Wort.
 * Unterscheidbar über Balkenzahl, Wort und Schriftgewicht – nicht nur über Farbe.
 */
export function ImpactBadge({ impact, className = '' }: { impact: number; className?: string }) {
  const { locale } = useI18n();
  const level = impactLevel(impact);
  const tone = level === 3 ? 'font-semibold text-fg' : level === 2 ? 'text-fg' : 'text-muted';
  return (
    <span data-impact={level} className={`inline-flex items-center gap-1.5 text-sm ${tone} ${className}`}>
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden className="shrink-0">
        {[0, 1, 2].map((i) => {
          const h = 5 + i * 3;
          return <rect key={i} x={i * 5} y={12 - h} width="3.5" height={h} rx="1" fill="var(--fg)" fillOpacity={i < level ? 1 : 0.18} />;
        })}
      </svg>
      {impactText(impact, locale)}
    </span>
  );
}

/** Kategorie-Label mit Icon in Kategoriefarbe. */
export function CategoryTag({ cat, owner = false }: { cat: RecCategory; owner?: boolean }) {
  const c = catText(cat, useI18n().locale);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${catStyle(cat).text}`}>
      <CategoryIcon cat={cat} size={15} />
      {c.label}
      {owner && c.owner && <span className="font-normal text-muted">· {c.owner}</span>}
    </span>
  );
}
