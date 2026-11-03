'use client';
import { useState } from 'react';
import { parseSimpleCron, toCron, type Schedule } from '@/lib/schedule';
import { useT } from '@/lib/i18n/client';

// Montag zuerst, Sonntag zuletzt
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Messplan als Klartext-Auswahl (Wochentag + Uhrzeit); schreibt intern weiter einen Cron-Ausdruck in „scheduleCron“. */
export function SchedulePicker({ cron, disabled = false }: { cron: string; disabled?: boolean }) {
  const t = useT().settings.schedule;
  const initial = parseSimpleCron(cron);
  const [custom, setCustom] = useState(initial === null);
  // eigener Cron-Ausdruck vom Server: beim Umschalten behalten, Rückweg anbieten
  const original = initial === null ? cron : null;
  const [raw, setRaw] = useState(cron);
  const [s, setS] = useState<Schedule>(initial ?? { day: 1, hour: 3, minute: 17 });
  const time = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;

  if (custom) {
    return (
      <div>
        <label className="label" htmlFor="w-cron">{t.customLabel}</label>
        <input className="input font-mono" id="w-cron" name="scheduleCron" value={raw} onChange={(e) => setRaw(e.target.value)} disabled={disabled} />
        <button type="button" className="mt-1.5 text-xs text-accent hover:underline" disabled={disabled}
          onClick={() => { setCustom(false); }}>{t.pickInstead}</button>
      </div>
    );
  }
  return (
    <div>
    <div className="grid grid-cols-[1fr_auto] gap-3">
      <input type="hidden" name="scheduleCron" value={toCron(s)} />
      <div>
        <label className="label" htmlFor="w-day">{t.when}</label>
        <select className="input" id="w-day" value={String(s.day)} disabled={disabled}
          onChange={(e) => setS({ ...s, day: e.target.value === 'daily' ? 'daily' : Number(e.target.value) })}>
          {DAY_ORDER.map((d) => <option key={d} value={d}>{t.every(t.weekdays[d]!)}</option>)}
          <option value="daily">{t.daily}</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="w-time">{t.time}</label>
        <input className="input" id="w-time" type="time" value={time} disabled={disabled} required
          onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (Number.isInteger(h) && Number.isInteger(m)) setS({ ...s, hour: h!, minute: m! });
          }} />
      </div>
    </div>
    {original !== null && (
      <button type="button" className="mt-1.5 text-xs text-accent hover:underline" disabled={disabled}
        onClick={() => { setRaw(original); setCustom(true); }}>{t.backToCustom(original)}</button>
    )}
    </div>
  );
}
