'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/lib/actions/locale';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/client';

/** Sprachumschalter „DE · EN“ (Nutzermenü, Login, Signup). Setzt das Sprach-Cookie und lädt die Seite neu. */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const current = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (l: Locale) => {
    if (l === current) return;
    start(async () => { await setLocale(l); router.refresh(); });
  };
  return (
    <div role="group" aria-label={t.common.language.label} data-testid="locale-switcher"
      className={`inline-flex items-center rounded-lg bg-subtle p-0.5 text-xs ${pending ? 'opacity-60' : ''} ${className}`}>
      {LOCALES.map((l) => (
        <button key={l} type="button" lang={l} onClick={() => pick(l)} disabled={pending} aria-pressed={l === current} title={LOCALE_NAMES[l]}
          className={`rounded-md px-2 py-1 font-medium uppercase ${l === current ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
