'use client';
import { useState } from 'react';

/** Marken-Logo als ruhige Kachel (Radius 22 %, weiße Platte) – ohne Logo oder bei Ladefehler die Initiale. */
export function BrandMark({ name, src, size = 20, own = false, className = '' }: { name: string; src?: string | null; size?: number; own?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: size * 0.22 } as const;
  if (src && !failed) {
    return (
      <span aria-hidden className={`brand-mark inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ${className}`} style={{ ...style, padding: Math.max(1, Math.round(size * 0.1)) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className="size-full object-contain" onError={() => setFailed(true)} />
      </span>
    );
  }
  const initial = (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  return (
    <span aria-hidden className={`inline-flex shrink-0 select-none items-center justify-center font-semibold ${own ? 'bg-own-soft text-own' : 'bg-subtle text-muted'} ${className}`}
      style={{ ...style, fontSize: Math.round(size * 0.5) }}>{initial}</span>
  );
}
