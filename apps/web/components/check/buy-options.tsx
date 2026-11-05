import Link from 'next/link';
import type { ReportTier } from '@askmetry/core/hosted/config';
import { priceInfo } from '@/lib/billing/price';
import { formatEuro } from '@/components/marketing/format';
import { getI18n } from '@/lib/i18n/server';

/** Beide Berichte mit Inhalt und Preis (netto, durchgestrichener Listenpreis). Button → Kaufformular. */
export async function BuyOptions({ checkToken }: { checkToken: string }) {
  const { t, locale } = await getI18n();
  const b = t.check.buy;
  const tiers: { tier: ReportTier; name: string; points: string[]; main: boolean }[] = [
    { tier: 'compact', name: b.compact, points: b.compactPoints, main: true },
    { tier: 'strategy', name: b.strategy, points: b.strategyPoints, main: false },
  ];
  return (
    <section id="kaufen" aria-labelledby="kaufen-title" className="scroll-mt-20">
      <h2 id="kaufen-title" className="text-[1.375rem] font-semibold tracking-tight">{b.title}</h2>
      <p className="mt-1 max-w-2xl text-[15px] text-muted">{b.intro}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {tiers.map(({ tier, name, points, main }) => {
          const p = priceInfo(tier, 'initial');
          return (
            <article key={tier} data-tier={tier} className={`flex flex-col rounded-2xl bg-card p-6 shadow-card ${main ? 'ring-2 ring-accent' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[17px] font-semibold tracking-tight">{name}</h3>
                {main && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{b.recommended}</span>}
              </div>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
                <span className="text-3xl font-semibold tabular-nums tracking-tight">{formatEuro(p.netCents, locale)}</span>
                {p.listCents && <span className="text-sm text-muted"><span className="sr-only">{b.listPrice} </span><s>{formatEuro(p.listCents, locale)}</s></span>}
                {p.listCents && <span className="text-xs font-medium text-good">{b.betaPrice}</span>}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">{b.net}</p>
              <ul className="mt-4 flex-1 space-y-2 text-[15px]">
                {points.map((x) => <li key={x} className="flex gap-2"><span aria-hidden className="text-good">✓</span><span>{x}</span></li>)}
              </ul>
              <Link href={`/kaufen?tier=${tier}&check=${encodeURIComponent(checkToken)}`} className={`btn mt-6 justify-center ${main ? 'btn-primary' : ''}`} data-testid={`buy-${tier}`}>
                {b.cta(name)}
              </Link>
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-muted">{b.remeasureNote}</p>
    </section>
  );
}
