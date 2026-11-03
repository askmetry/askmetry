import { eq } from 'drizzle-orm';
import { db, prompt } from '@opengeo/db';
import { ActionForm } from '@/components/action-form';
import { box, Group, SettingsHeader } from '@/components/settings-ui';
import { Bar } from '@/components/ui';
import { saveWorkspaceSettings } from '@/lib/actions/settings';
import { fmtPct, fmtUsd } from '@/lib/format';
import { maxBudgetUsd } from '@/lib/limits';
import { engineLabel } from '@/lib/metrics';
import { requireWorkspace } from '@/lib/session';
import { loadCosts } from '@/lib/settings-data';

export const metadata = { title: 'Kosten · Einstellungen' };

export default async function KostenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, canEdit } = await requireWorkspace(slug);
  const ro = !canEdit;
  const prompts = await db.select({ active: prompt.active }).from(prompt).where(eq(prompt.workspaceId, ws.id));
  const c = await loadCosts(ws, prompts.filter((p) => p.active).length);
  const budget = Number(ws.monthlyBudgetUsd);
  const ratio = budget > 0 ? c.spent / budget : 0;

  return (
    <>
      <SettingsHeader title="Kosten" intro="Was die Abfragen an die KI-Suchen kosten." ro={ro} />
      <div className={box}>
        <p className="text-sm text-muted">Ausgaben im {c.month.label}</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-3xl font-semibold tabular-nums">{fmtUsd(c.spent)}</span>
          <span className="text-sm text-muted">von {fmtUsd(budget)}</span>
        </div>
        <div className="mt-3"><Bar value={ratio} tone={ratio > 0.9 ? 'comp' : 'accent'} /></div>
        <p className="mt-2 text-xs text-muted">{budget > 0 ? `${fmtPct(ratio)} verbraucht. Ist das Budget erreicht, überspringen wir weitere Abfragen.` : 'Kein Budget gesetzt.'}</p>
      </div>

      <Group title="Budget je Monat">
        <div className={box}>
          <ActionForm action={saveWorkspaceSettings} slug={slug} submit="Speichern" disabled={ro} className="flex flex-wrap items-end gap-3" inline>
            <input type="hidden" name="part" value="kosten" />
            <div className="w-48">
              <label className="label" htmlFor="w-budget">USD je Monat</label>
              <input className="input" id="w-budget" name="monthlyBudgetUsd" inputMode="decimal" defaultValue={budget.toFixed(2).replace('.', ',')} />
            </div>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Höchstens {fmtUsd(maxBudgetUsd())}.</p>
        </div>
      </Group>

      <Group title="Kosten je KI-Suche">
        <div className="rounded-2xl bg-card pb-2 shadow-card">
          <table className="data">
            <thead><tr><th>KI-Suche</th><th className="num">je Abfrage</th><th className="num">diesen Monat</th></tr></thead>
            <tbody>
              {c.engines.map((e) => (
                <tr key={e.engine} className={e.on ? '' : 'text-muted'}>
                  <td>{engineLabel(e.engine)}{!e.on && ' (aus)'}</td>
                  <td className="num">{e.avg === null ? '–' : fmtUsd(e.avg, e.avg < 0.1 ? 3 : 2)}</td>
                  <td className="num">{fmtUsd(e.month)}</td>
                </tr>
              ))}
              {c.recCost > 0 && <tr><td>Maßnahmen formulieren</td><td className="num">–</td><td className="num">{fmtUsd(c.recCost, c.recCost < 0.1 ? 3 : 2)}</td></tr>}
            </tbody>
          </table>
          <p className="px-5 pt-1 text-xs text-muted">„je Abfrage“ ist der Durchschnitt aller bisherigen Messungen.</p>
        </div>
      </Group>
    </>
  );
}
