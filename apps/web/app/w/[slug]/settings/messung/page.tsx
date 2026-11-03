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
import { fmtDate, fmtInt, fmtUsd, STATUS_LABELS, TRIGGER_LABELS } from '@/lib/format';
import { engineLabel, SELECTABLE_ENGINES } from '@/lib/metrics';
import { scheduleText } from '@/lib/schedule';
import { loadCosts, runStatsByCollection } from '@/lib/settings-data';

export const metadata = { title: 'Messung · Einstellungen' };

export default async function MessungPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, all, canEdit } = await workspaceContext(slug, {});
  const ro = !canEdit;
  const prompts = await db.select({ active: prompt.active }).from(prompt).where(eq(prompt.workspaceId, ws.id));
  const activePrompts = prompts.filter((p) => p.active).length;
  const [stats, costs] = await Promise.all([runStatsByCollection(ws.id), loadCosts(ws, activePrompts)]);
  const active = all.filter((c) => c.status === 'queued' || c.status === 'running');
  const planned = activePrompts * ws.engines.length * ws.repetitions;
  const next = nextMeasurementText(ws);

  return (
    <>
      {active.length > 0 && <AutoRefresh seconds={5} />}
      <SettingsHeader title="Messung" ro={ro}
        intro={`${activePrompts} ${activePrompts === 1 ? 'Frage' : 'Fragen'} × ${ws.engines.length} KI-Suchen × ${ws.repetitions} ${ws.repetitions === 1 ? 'Durchgang' : 'Durchgänge'} = ${fmtInt(planned)} Abfragen je Messung${costs.estimate !== null ? `, ca. ${fmtUsd(costs.estimate)}` : ''}.`}
        action={<ActionForm action={startCollection} slug={slug} submit="Jetzt messen" submitClass="btn btn-primary" disabled={ro || active.length > 0} />} />

      <div className={box} data-testid="measure-status">
        {active.length === 0 ? (
          <p className="text-sm">
            {ws.scheduleEnabled
              ? <>Nächste Messung: <b className="font-medium">{next ?? scheduleText(ws.scheduleCron)}</b> <span className="text-muted">· {scheduleText(ws.scheduleCron)}</span></>
              : <span className="text-muted">Automatisch messen ist aus – gemessen wird nur mit „Jetzt messen“.</span>}
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
                    <span><Badge tone="accent">{STATUS_LABELS[c.status]}</Badge> <span className="ml-1 text-muted">{TRIGGER_LABELS[c.trigger]} · erstellt {fmtDate(c.createdAt)}</span></span>
                    <span className="tabular-nums text-muted">{total ? `${fin} / ${total} Abfragen` : 'wartet auf den Worker'}</span>
                  </div>
                  {total > 0 && <div className="mt-2"><Bar value={fin / total} /></div>}
                </li>
              );
            })}
            <li className="text-xs text-muted">Die Seite aktualisiert sich automatisch.</li>
          </ul>
        )}
      </div>

      <Group title="Messplan">
        <div className={box}>
          <ActionForm action={saveWorkspaceSettings} slug={slug} submit="Speichern" disabled={ro} className="space-y-5">
            <input type="hidden" name="part" value="messung" />
            <div>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="scheduleEnabled" defaultChecked={ws.scheduleEnabled} /> Automatisch messen</label>
              <div className="mt-2"><SchedulePicker cron={ws.scheduleCron} disabled={ro} /></div>
              <p className="mt-1 text-xs text-muted">Uhrzeit in deutscher Zeit (Europe/Berlin).</p>
            </div>
            <fieldset>
              <legend className="label">KI-Suchen</legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {SELECTABLE_ENGINES.map((e) => (
                  <label key={e} className="flex items-center gap-2 text-sm"><input type="checkbox" name="engines" value={e} defaultChecked={ws.engines.includes(e)} /> {engineLabel(e)}</label>
                ))}
              </div>
            </fieldset>
            <div className="sm:w-64">
              <label className="label" htmlFor="w-rep">Durchgänge je Frage <Hint>KI-Antworten schwanken. Mehrere Durchgänge machen die Werte stabiler, kosten aber entsprechend mehr.</Hint></label>
              <input className="input" id="w-rep" name="repetitions" type="number" min={1} max={10} defaultValue={ws.repetitions} />
            </div>
          </ActionForm>
        </div>
      </Group>

      <Group title={`Bisherige Messungen (${all.length})`}>
        <div className="rounded-2xl bg-card shadow-card">
          {all.length === 0 ? <p className="p-5 text-sm text-muted">Noch keine Messung.</p> : (
            <div className="overflow-x-auto pb-2">
              <table className="data">
                <thead><tr><th>Datum</th><th>Status</th><th className="num">Abfragen</th><th className="num">Kosten</th></tr></thead>
                <tbody>
                  {all.slice(0, 15).map((c) => {
                    const s = stats.get(c.id) ?? {};
                    const total = Object.values(s).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap">{fmtDate(c.createdAt, false)} <span className="text-xs text-muted">· {TRIGGER_LABELS[c.trigger]}</span></td>
                        <td><Badge tone={c.status === 'done' ? 'good' : c.status === 'failed' ? 'bad' : c.status === 'budget_exceeded' ? 'warn' : 'accent'}>{STATUS_LABELS[c.status]}</Badge>
                          {(s.failed ?? 0) > 0 && <span className="ml-2 text-xs text-bad">{s.failed} fehlgeschlagen</span>}
                          {(s.skipped ?? 0) > 0 && <span className="ml-2 text-xs text-warn">{s.skipped} übersprungen</span>}
                        </td>
                        <td className="num">{fmtInt(total)}</td>
                        <td className="num">{fmtUsd(c.costUsd)}</td>
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
