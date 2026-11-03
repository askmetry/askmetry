'use client';
import { useT } from '@/lib/i18n/client';

const MAX = 200_000;

/** Datei-Auswahl fürs Logo: zu große Dateien schon im Browser sperren (Next lehnt Bodies > 1 MB sonst mit Fehlerseite ab). */
export function LogoFileInput() {
  const t = useT().settings.brand;
  return (
    <input type="file" name="logo" required aria-label={t.logoFile}
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon"
      onChange={(e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.setCustomValidity(f && f.size > MAX ? t.logoTooLarge : '');
        e.currentTarget.reportValidity();
      }}
      className="max-w-56 text-sm text-muted file:mr-2 file:rounded-lg file:border-0 file:bg-subtle file:px-3 file:py-1.5 file:text-sm file:text-fg" />
  );
}
