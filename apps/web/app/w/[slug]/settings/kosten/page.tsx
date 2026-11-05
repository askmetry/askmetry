import { eq } from 'drizzle-orm';
import { db, prompt } from '@askmetry/db';
import { ActionForm } from '@/components/action-form';
import { box, Group, SettingsHeader } from '@/components/settings-ui';
import { Bar } from '@/components/ui';
import { saveWorkspaceSettings } from '@/lib/actions/settings';
import { maxBudgetUsd } from '@/lib/limits';
import { engineName } from '@askmetry/core/present';
import { getI18n, getT } from '@/lib/i18n/server';
import { redirect } from 'next/navigation';
import { rightsFor } from '@/lib/hosted/server';
import { requireWorkspace } from '@/lib/session';
import { loadCosts } from '@/lib/settings-data';

export async function generateMetadata() {
  const t = (await getT()).settings;
  return { title: t.metaTitle(t.pages.kosten) };
}

export default async function KostenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, canEdit } = await requireWorkspace(slug);
  if (!(await rightsFor(ws)).costs) redirect(`/w/${slug}/berichte`);
  const ro = !canEdit;
  const { t: tt, f, locale } = await getI18n();
  const t = tt.settings;
  const k = t.costs;
  const prompts = await db.select({ active: prompt.active }).from(prompt).where(eq(prompt.workspaceId, ws.id));
  const c = await loadCosts(ws, prompts.filter((p) => p.active).length);
  const budget = Number(ws.monthlyBudgetUsd);
  const ratio = budget > 0 ? c.spent / budget : 0;

  return (
    <>
      <SettingsHeader title={t.pages.kosten} intro={k.intro} ro={ro} />
      <div className={box}>
        <p className="text-sm text-muted">{k.spentIn(f.dateWith(new Date(), { month: 'long', year: 'numeric' }))}</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-3xl font-semibold tabular-nums">{f.usd(c.spent)}</span>
          <span className="text-sm text-muted">{k.of(f.usd(budget))}</span>
        </div>
        <div className="mt-3"><Bar value={ratio} tone={ratio > 0.9 ? 'comp' : 'accent'} /></div>
        <p className="mt-2 text-xs text-muted">{budget > 0 ? k.used(f.pct(ratio)) : k.noBudget}</p>
      </div>

      <Group title={k.budgetGroup}>
        <div className={box}>
          <ActionForm action={saveWorkspaceSettings} slug={slug} submit={t.save} disabled={ro} className="flex flex-wrap items-end gap-3" inline>
            <input type="hidden" name="part" value="kosten" />
            <div className="w-48">
              <label className="label" htmlFor="w-budget">{k.budgetLabel}</label>
              <input className="input" id="w-budget" name="monthlyBudgetUsd" inputMode="decimal" defaultValue={locale === 'de' ? budget.toFixed(2).replace('.', ',') : budget.toFixed(2)} />
            </div>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">{k.max(f.usd(maxBudgetUsd()))}</p>
        </div>
      </Group>

      <Group title={k.perEngine}>
        <div className="rounded-2xl bg-card pb-2 shadow-card">
          <table className="data">
            <thead><tr><th>{k.colEngine}</th><th className="num">{k.colPerQuery}</th><th className="num">{k.colMonth}</th></tr></thead>
            <tbody>
              {c.engines.map((e) => (
                <tr key={e.engine} className={e.on ? '' : 'text-muted'}>
                  <td>{engineName(e.engine, locale)}{!e.on && k.off}</td>
                  <td className="num">{e.avg === null ? '–' : f.usd(e.avg, e.avg < 0.1 ? 3 : 2)}</td>
                  <td className="num">{f.usd(e.month)}</td>
                </tr>
              ))}
              {c.recCost > 0 && <tr><td>{k.recs}</td><td className="num">–</td><td className="num">{f.usd(c.recCost, c.recCost < 0.1 ? 3 : 2)}</td></tr>}
            </tbody>
          </table>
          <p className="px-5 pt-1 text-xs text-muted">{k.avgHint}</p>
        </div>
      </Group>
    </>
  );
}
