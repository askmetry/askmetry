'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id?: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }

/**
 * Cloudflare Turnstile (nur mit Site-Key). Legt das Token in ein verstecktes Feld `cf-turnstile-response`;
 * `resetKey` ändern erzwingt ein neues Token (Tokens gelten nur einmal).
 */
export function Turnstile({ siteKey, locale, resetKey = 0, onToken, appearance = 'always' }: {
  siteKey: string; locale: string; resetKey?: number; onToken?: (t: string | null) => void;
  /** interaction-only: Widget nur sichtbar, wenn Cloudflare eine Interaktion braucht (URL-Feld der Startseite) */
  appearance?: 'always' | 'interaction-only';
}) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.turnstile);
  const [token, setToken] = useState('');
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!ready || !box.current || !window.turnstile) return;
    const set = (v: string) => { setToken(v); cb.current?.(v || null); };
    id.current = window.turnstile.render(box.current, {
      sitekey: siteKey, language: locale, theme: 'auto', appearance,
      callback: (v: string) => set(v), 'expired-callback': () => set(''), 'error-callback': () => set(''),
    });
    return () => { if (id.current) window.turnstile?.remove(id.current); id.current = null; set(''); };
  }, [ready, siteKey, locale, resetKey, appearance]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setReady(true)} />
      <div ref={box} className={appearance === 'always' ? 'min-h-[65px]' : ''} />
      <input type="hidden" name="cf-turnstile-response" value={token} />
    </>
  );
}
