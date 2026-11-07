// Reine Darstellungslogik der Berichtsseite während der Messung (ohne DB, testbar). Jede Zeile spiegelt einen echten
// Zustand aus ReportView.progress (Runs je KI-Suche, Phase der Messung) – Schätzungen nur, wo der Fortschritt sie hergibt.
import type { ReportView } from '@askmetry/core/hosted/types';

export type StepState = 'done' | 'current' | 'todo';
export type ProgressStepKey = 'questions' | 'engine' | 'analyze' | 'recs' | 'pdf';
export interface ProgressStep {
  key: ProgressStepKey;
  /** nur bei key = engine */
  engine?: string;
  state: StepState;
  /** beendete / alle Abfragen dieser KI-Suche (null = keine Zahl zeigen) */
  count: { done: number; total: number } | null;
  /** Abfragen ohne Antwort (ruhig zeigen) */
  failed: number;
  /** wartet im Claude-Sammelauftrag bei Anthropic */
  batchWaiting: boolean;
}

/** Ansage oben: wann kommt der Bericht? */
export type Eta =
  | { kind: 'unknown' }                       // noch zu früh für eine ehrliche Schätzung
  | { kind: 'soon' }                          // nur noch auswerten / Maßnahmen / PDF
  | { kind: 'minutes'; n: number; batch: boolean }  // batch = Claude-Sammelauftrag läuft noch daneben
  | { kind: 'hours'; n: number; batch: boolean }
  | { kind: 'onlyClaude' };                   // nur noch der Claude-Sammelauftrag fehlt

/** Minuten verständlich runden: bis 10 genau, bis 60 auf 5er, darüber ganze Stunden. */
export function roundEta(min: number, batch: boolean): Eta {
  const m = Math.max(1, Math.ceil(min));
  if (m <= 10) return { kind: 'minutes', n: m, batch };
  if (m < 60) return { kind: 'minutes', n: Math.ceil(m / 5) * 5, batch };
  return { kind: 'hours', n: Math.max(1, Math.round(m / 60)), batch };
}

type View = Pick<ReportView, 'status' | 'progress' | 'promptsPreparing' | 'tier'>;

/** Schritte der Messung: (Zusatzfragen beim Strategiebericht) · eine Zeile je KI · auswerten · Maßnahmen · PDF. */
export function progressSteps(view: View, plannedEngines: readonly string[]): ProgressStep[] {
  const p = view.status === 'measuring' ? view.progress : null;
  const phase = p?.phase ?? 'queued';
  const steps: ProgressStep[] = [];
  const base = { count: null, failed: 0, batchWaiting: false };
  if (view.tier === 'strategy' && view.status === 'paid' && view.promptsPreparing) {
    steps.push({ key: 'questions', state: 'current', ...base });
  }
  const engines = p?.engines.length ? p.engines : plannedEngines.map((engine) => ({ engine, total: 0, answered: 0, failed: 0, inBatch: 0, batch: false }));
  for (const e of engines) {
    const closed = e.answered + e.failed;
    const finished = e.total > 0 && closed >= e.total;
    const running = !!p && phase !== 'queued' && phase !== 'failed' && !finished;
    steps.push({
      key: 'engine', engine: e.engine,
      state: finished ? 'done' : running ? 'current' : 'todo',
      count: e.total > 0 ? { done: Math.min(closed, e.total), total: e.total } : null,
      failed: e.failed,
      batchWaiting: running && e.batch,
    });
  }
  const st = (done: boolean, current: boolean): StepState => (done ? 'done' : current ? 'current' : 'todo');
  steps.push({ key: 'analyze', state: st(phase === 'recommending' || phase === 'done', phase === 'analyzing'), ...base });
  steps.push({ key: 'recs', state: st(phase === 'done', phase === 'recommending'), ...base });
  steps.push({ key: 'pdf', state: st(false, phase === 'done'), ...base });
  return steps;
}

/** Wann kommt der Bericht? Nur aus dem echten Fortschritt; „nur noch Claude“ statt einer erfundenen Zahl. */
export function reportEta(view: View): Eta {
  const p = view.status === 'measuring' ? view.progress : null;
  if (!p || p.phase === 'queued') return { kind: 'unknown' };
  if (p.phase === 'analyzing' || p.phase === 'recommending' || p.phase === 'done') return { kind: 'soon' };
  if (p.onlyBatchLeft) return { kind: 'onlyClaude' };
  return p.etaMinutes == null ? { kind: 'unknown' } : roundEta(p.etaMinutes, p.batchOpen);
}
