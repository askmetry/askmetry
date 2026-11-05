import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { brand, db } from '@askmetry/db';
import { BuyForm } from '@/components/buy-form';
import { formatEuro } from '@/components/marketing/format';
import { PublicShell } from '@/components/public-shell';
import { priceInfo } from '@/lib/billing/price';
import { signupUrl } from '@/lib/billing/form';
import { getCheckView } from '@/lib/hosted/data';
import { isHosted, reportStatuses } from '@/lib/hosted/server';
import { getI18n, getT } from '@/lib/i18n/server';
import { getSession, requireWorkspace } from '@/lib/session';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export async function generateMetadata() {
  return { title: (await getT()).buy.metaTitle, robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
}

/** Kaufformular: /kaufen?tier=compact|strategy&check=<token> oder ?tier=…&workspace=<slug>&kind=remeasure. */
export default async function BuyPage({ searchParams }: { searchParams: SP }) {
  if (!isHosted()) notFound();
  const sp = await searchParams;
  const { t, locale } = await getI18n();
  const b = t.buy;
  const tier = one(sp.tier);
  const kind = one(sp.kind) === 'remeasure' ? 'remeasure' : 'initial';
  const checkToken = one(sp.check);
  const slug = one(sp.workspace);
  const valid = (tier === 'compact' || tier === 'strategy') && (!!checkToken !== !!slug) && !(checkToken && kind === 'remeasure')
    && (!checkToken || /^[A-Za-z0-9_-]{16,128}$/.test(checkToken)) && (!slug || /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug));
  if (!valid) return <Invalid text={b.invalid.text} />;

  const self = `/kaufen?${new URLSearchParams({ tier, ...(checkToken ? { check: checkToken } : { workspace: slug }), ...(kind === 'remeasure' ? { kind } : {}) })}`;
  if (!(await getSession())) redirect(signupUrl(self));

  let brandName: string | null = null;
  let back: { href: string; label: string };
  if (checkToken) {
    const view = await getCheckView(checkToken);
    if (!view || view.status !== 'ready' || !view.summary) return <Invalid text={b.invalid.text} />;
    brandName = view.summary.brand.name;
    back = { href: `/check/${checkToken}`, label: b.back };
  } else {
    const { ws } = await requireWorkspace(slug);
    if (ws.hostedKind !== 'customer') notFound();
    if (kind === 'remeasure' && !(await reportStatuses(ws.id)).some((r) => r.status === 'ready' && r.tier === tier)) return <Invalid text={b.invalid.noReport} />;
    const [own] = await db.select({ name: brand.name }).from(brand).where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true))).limit(1);
    brandName = own?.name ?? ws.name;
    back = { href: `/w/${slug}/berichte`, label: b.backToReports };
  }

  const tierName = t.check.buy[tier];
  const points = kind === 'remeasure' ? b.remeasurePoints : tier === 'compact' ? t.check.buy.compactPoints : t.check.buy.strategyPoints;
  const steps = kind === 'remeasure' ? b.remeasureSteps : b.howSteps;
  const p = priceInfo(tier, kind);

  return (
    <PublicShell width="max-w-[960px]">
      <Link href={back.href} className="mb-4 inline-block text-sm text-muted hover:text-fg">← {back.label}</Link>
      {one(sp.checkout) === 'canceled' && <p role="status" className="mb-6 rounded-xl bg-subtle px-4 py-3 text-sm">{b.canceled}</p>}
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_360px] md:gap-10">
        <div>
          <p className="text-sm text-muted">{b.forBrand(brandName)}</p>
          <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight">{kind === 'remeasure' ? b.remeasureTitle(tierName) : b.title(tierName)}</h1>
          <h2 className="mt-8 text-[17px] font-semibold tracking-tight">{b.includes}</h2>
          <ul className="mt-3 space-y-2 text-[15px]">
            {points.map((x) => <li key={x} className="flex gap-2"><span aria-hidden className="text-good">✓</span><span>{x}</span></li>)}
          </ul>
          <h2 className="mt-8 text-[17px] font-semibold tracking-tight">{b.howItWorks}</h2>
          <ol className="mt-3 space-y-3 text-[15px]">
            {steps.map((x, i) => (
              <li key={x} className="flex gap-3">
                <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-subtle text-[13px] font-semibold text-muted">{i + 1}</span>
                <span>{x}</span>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-[13px] text-muted">{b.businessOnly}</p>
        </div>
        <aside className="h-fit rounded-2xl bg-card p-6 shadow-card md:sticky md:top-20">
          <p className="text-sm text-muted">{b.price}</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-3xl font-semibold tabular-nums tracking-tight" data-testid="buy-price">{formatEuro(p.netCents, locale)}</span>
            {p.listCents && <span className="text-sm text-muted"><span className="sr-only">{b.listPrice} </span><s>{formatEuro(p.listCents, locale)}</s></span>}
            {p.listCents && <span className="text-xs font-medium text-good">{b.betaPrice}</span>}
          </p>
          <p className="mb-5 mt-0.5 text-[13px] text-muted">{b.net}</p>
          <BuyForm tier={tier} kind={kind} checkToken={checkToken || undefined} workspaceSlug={slug || undefined} />
        </aside>
      </div>
    </PublicShell>
  );
}

async function Invalid({ text }: { text: string }) {
  const b = (await getT()).buy.invalid;
  return (
    <PublicShell width="max-w-[640px]">
      <div className="rounded-3xl bg-card p-8 text-center shadow-card">
        <h1 className="text-[1.5rem] font-semibold tracking-tight">{b.title}</h1>
        <p className="mt-2 text-[15px] text-muted">{text}</p>
        <Link href="/" className="btn btn-primary mt-6">{b.back}</Link>
      </div>
    </PublicShell>
  );
}
