'use client';
import { useId } from 'react';

/**
 * Bildmarke „Radar-Blase“: Sprechblase als Radarschirm – der Strahl tastet KI-Antworten ab, der Punkt ist die gefundene Marke.
 * Strahl, Fächer und Punkte sind ausgestanzt (Maske), damit die Marke auf jedem Grund funktioniert. Quelldateien: docs/brand/.
 */
export function AskmetryMark({ size = 24, color = 'var(--accent)', className }: { size?: number; color?: string; className?: string }) {
  const id = `am-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={className}>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <circle cx="33" cy="29" r="26" fill="#fff" />
        <path d="M10.5 42L6 60L26.3 54.1Z" fill="#fff" />
        <path d="M33 29L29.2 7.3A22 22 0 0 1 51.1 16.4Z" fill="#000" fillOpacity=".5" />
        <path d="M33 29L50.4 15.5" fill="none" stroke="#000" strokeWidth="4.5" strokeLinecap="round" />
        <circle cx="33" cy="29" r="4.5" fill="#000" />
        <circle cx="43.5" cy="40" r="4" fill="#000" />
      </mask>
      <rect width="64" height="64" fill={color} mask={`url(#${id})`} />
    </svg>
  );
}
