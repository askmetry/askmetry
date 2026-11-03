import { eq } from 'drizzle-orm';
import { db, prompt } from '@opengeo/db';
import { nextMeasurementText } from '@opengeo/core';
import { ActionForm } from '@/components/action-form';
import { AutoRefresh } from '@/components/auto-refresh';
import { SchedulePicker } from '@/components/schedule-picker';
import { box, Group, SettingsHeader } from '@/components/settings-ui';
import { Badge, Bar, Hint } from '@/components/ui';
import { saveWorkspaceSettings, startCollection } from '@/lib/actions/settings';
import { workspaceContext } from '@/lib/context';
import { SELECTABLE_ENGINES } from '@/lib/metrics';
import { engineName } from '@opengeo/core/present';
import { getI18n, getT } from '@/lib/i18n/server';
import { scheduleText } from '@/lib/schedule';
import { loadCosts, runStatsByCollection } from '@/lib/settings-data';

export async function generateMetadata() {
  const t = (await getT()).settings;
  return { title: t.metaTitle(t.pages.messung) };
}

export default async function MessungPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, all, canEdit } = await workspaceContext(slug, {});
  const ro = !canEdit;
  const { t: tt, f, locale } = await getI18n();
  const t = tt.settings;
  const m = t.measure;
  const prompts = await db.select({ active: prompt.active }).from(prompt).where(eq(prompt.workspaceId, ws.id));
  const activePrompts = prompts.filter((p) => p.active).length;
  const [stats, costs] = await Promise.all([runStatsByCollection(ws.id), loadCosts(ws, activePrompts)]);
  const active = all.filter((c) => c.status === 'queued' || c.status === 'running');
  const planned = activePrompts * ws.engines.length * ws.repetitions;
  const next = nextMeasurementText(ws, new Date(), locale);

  return (
    <>
      {active.length > 0 && <AutoRefresh seconds={5} />}
      <SettingsHeader title={t.pages.messung} ro={ro}
        intro={m.intro(activePrompts, ws.engines.length, ws.repetitions, f.int(planned), costs.estimate !== null ? f.usd(costs.estimate) : null)}
        action={<ActionForm action={startCollection} slug={slug} submit={m.now} submitClass="btn btn-primary" disabled={ro || active.length > 0} />} />

      <div className={box} data-testid="measure-status">
        {active.length === 0 ? (
          <p className="text-sm">
            {ws.scheduleEnabled
              ? <>{m.next} <b className="font-medium">{next ?? scheduleText(ws.scheduleCron, locale)}</b> <span className="text-muted">· {scheduleText(ws.scheduleCron, locale)}</span></>
              : <span className="text-muted">{m.autoOff}</span>}
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((c) => {
              const s = stats.get(c.id) ?? {};
              const total = Object.values(s).reduce((a, b) => a + b, 0);
              const fin = (s.done ?? 0) + (s.failed ?? 0) + (s.skipped ?? 0);
              return (
                <li key={c.id} className="text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span><Badge tone="accent">{tt.common.collectionStatus[c.status] ?? c.status}</Badge> <span className="ml-1 text-muted">{tt.common.trigger[c.trigger] ?? c.trigger} · {m.created(f.date(c.createdAt))}</span></span>
                    <span className="tabular-nums text-muted">{total ? m.progress(fin, total) : m.waiting}</span>
                  </div>
                  {total > 0 && <div className="mt-2"><Bar value={fin / total} /></div>}
                </li>
              );
            })}
            <li className="text-xs text-muted">{m.autoRefresh}</li>
          </ul>
        )}
      </div>

      <Group title={m.plan}>
        <div className={box}>
          <ActionForm action={saveWorkspaceSettings} slug={slug} submit={t.save} disabled={ro} className="space-y-5">
            <input type="hidden" name="part" value="messung" />
            <div>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="scheduleEnabled" defaultChecked={ws.scheduleEnabled} /> {m.auto}</label>
              <div className="mt-2"><SchedulePicker cron={ws.scheduleCron} disabled={ro} /></div>
              <p className="mt-1 text-xs text-muted">{m.timezone}</p>
            </div>
            <fieldset>
              <legend className="label">{m.engines}</legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {SELECTABLE_ENGINES.map((e) => (
                  <label key={e} className="flex items-center gap-2 text-sm"><input type="checkbox" name="engines" value={e} defaultChecked={ws.engines.includes(e)} /> {engineName(e, locale)}</label>
                ))}
              </div>
            </fieldset>
            <div className="sm:w-64">
              <label className="label" htmlFor="w-rep">{m.reps} <Hint>{m.repsHint}</Hint></label>
              <input className="input" id="w-rep" name="repetitions" type="number" min={1} max={10} defaultValue={ws.repetitions} />
            </div>
          </ActionForm>
        </div>
      </Group>

      <Group title={m.history(all.length)}>
        <div className="rounded-2xl bg-card shadow-card">
          {all.length === 0 ? <p className="p-5 text-sm text-muted">{m.none}</p> : (
            <div className="overflow-x-auto pb-2">
              <table className="data">
                <thead><tr><th>{m.colDate}</th><th>{m.colStatus}</th><th className="num">{m.colQueries}</th><th className="num">{m.colCost}</th></tr></thead>
                <tbody>
                  {all.slice(0, 15).map((c) => {
                    const s = stats.get(c.id) ?? {};
                    const total = Object.values(s).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap">{f.date(c.createdAt, false)} <span className="text-xs text-muted">· {tt.common.trigger[c.trigger] ?? c.trigger}</span></td>
                        <td><Badge tone={c.status === 'done' ? 'good' : c.status === 'failed' ? 'bad' : c.status === 'budget_exceeded' ? 'warn' : 'accent'}>{tt.common.collectionStatus[c.status] ?? c.status}</Badge>
                          {(s.failed ?? 0) > 0 && <span className="ml-2 text-xs text-bad">{m.failed(s.failed!)}</span>}
                          {(s.skipped ?? 0) > 0 && <span className="ml-2 text-xs text-warn">{m.skipped(s.skipped!)}</span>}
                        </td>
                        <td className="num">{f.int(total)}</td>
                        <td className="num">{f.usd(c.costUsd)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Group>
    </>
  );
}
