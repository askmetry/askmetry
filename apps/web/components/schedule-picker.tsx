'use client';
import { useState } from 'react';
import { parseSimpleCron, toCron, WEEKDAYS, type Schedule } from '@/lib/schedule';

// Montag zuerst, Sonntag zuletzt
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Messplan als Klartext-Auswahl (Wochentag + Uhrzeit); schreibt intern weiter einen Cron-Ausdruck in „scheduleCron“. */
export function SchedulePicker({ cron, disabled = false }: { cron: string; disabled?: boolean }) {
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
        <label className="label" htmlFor="w-cron">Eigener Zeitplan (Cron, Europe/Berlin)</label>
        <input className="input font-mono" id="w-cron" name="scheduleCron" value={raw} onChange={(e) => setRaw(e.target.value)} disabled={disabled} />
        <button type="button" className="mt-1.5 text-xs text-accent hover:underline" disabled={disabled}
          onClick={() => { setCustom(false); }}>Stattdessen Wochentag und Uhrzeit wählen</button>
      </div>
    );
  }
  return (
    <div>
    <div className="grid grid-cols-[1fr_auto] gap-3">
      <input type="hidden" name="scheduleCron" value={toCron(s)} />
      <div>
        <label className="label" htmlFor="w-day">Wann</label>
        <select className="input" id="w-day" value={String(s.day)} disabled={disabled}
          onChange={(e) => setS({ ...s, day: e.target.value === 'daily' ? 'daily' : Number(e.target.value) })}>
          {DAY_ORDER.map((d) => <option key={d} value={d}>Jeden {WEEKDAYS[d]}</option>)}
          <option value="daily">Täglich</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="w-time">Uhrzeit</label>
        <input className="input" id="w-time" type="time" value={time} disabled={disabled} required
          onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (Number.isInteger(h) && Number.isInteger(m)) setS({ ...s, hour: h!, minute: m! });
          }} />
      </div>
    </div>
    {original !== null && (
      <button type="button" className="mt-1.5 text-xs text-accent hover:underline" disabled={disabled}
        onClick={() => { setRaw(original); setCustom(true); }}>Zurück zum eigenen Zeitplan ({original})</button>
    )}
    </div>
  );
}
