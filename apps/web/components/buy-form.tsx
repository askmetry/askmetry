'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { buyReport } from '@/lib/billing/actions';
import type { BuyState } from '@/lib/billing/buy';
import { useT } from '@/lib/i18n/client';

/** Kaufformular: Pflicht-Häkchen B2B + AGB, dann buyReport (leitet zur Zahlung weiter oder liefert einen Fehlertext). */
export function BuyForm({ tier, kind, checkToken, workspaceSlug }: { tier: 'compact' | 'strategy'; kind: 'initial' | 'remeasure'; checkToken?: string; workspaceSlug?: string }) {
  const t = useT().buy;
  const [state, run, pending] = useActionState<BuyState, FormData>(buyReport, null);
  const err = state?.error;
  return (
    <form action={run} className="space-y-4" data-testid="buy-form" aria-describedby={err ? 'buy-error' : undefined}>
      <input type="hidden" name="tier" value={tier} />
      <input type="hidden" name="kind" value={kind} />
      {checkToken && <input type="hidden" name="checkToken" value={checkToken} />}
      {workspaceSlug && <input type="hidden" name="workspaceSlug" value={workspaceSlug} />}
      <label className="flex items-start gap-3 text-[15px]">
        <input type="checkbox" name="b2b" required className="mt-1 size-4 shrink-0" aria-invalid={state?.code === 'b2bRequired' || undefined} />
        <span>{t.b2b}</span>
      </label>
      <label className="flex items-start gap-3 text-[15px]">
        <input type="checkbox" name="terms" required className="mt-1 size-4 shrink-0" aria-invalid={state?.code === 'termsRequired' || undefined} />
        <span>
          {t.termsBefore} <Link href="/agb" target="_blank" className="text-accent hover:underline">{t.termsLink}</Link> {t.termsMiddle}{' '}
          <Link href="/datenschutz" target="_blank" className="text-accent hover:underline">{t.privacyLink}</Link>{t.termsAfter === '.' ? '.' : ` ${t.termsAfter}`}
        </span>
      </label>
      {err && <p id="buy-error" role="alert" className="rounded-md bg-subtle px-3 py-2 text-sm text-bad">{err}</p>}
      <button type="submit" className="btn btn-primary w-full justify-center !py-2.5" disabled={pending}>{pending ? t.busy : t.submit}</button>
      <p className="text-[13px] text-muted">{t.reminderNote}</p>
    </form>
  );
}
