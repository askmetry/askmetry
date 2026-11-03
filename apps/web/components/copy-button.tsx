'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';

/** Kopiert Text in die Zwischenablage und zeigt kurz „Kopiert ✓“. Fallback über ein verstecktes Textfeld. */
export function CopyButton({ text, label, className = 'btn btn-sm', done, testId }: {
  text: string; label: string; className?: string; done?: string; testId?: string;
}) {
  const t = useT().recs.copy;
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    setState(ok ? 'ok' : 'err');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  return (
    <button type="button" onClick={copy} className={className} data-testid={testId} aria-live="polite">
      {state === 'ok' ? done ?? t.done : state === 'err' ? t.failed : label}
    </button>
  );
}
