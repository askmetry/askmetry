import { describe, expect, it } from 'vitest';
import type { ReportView } from '@askmetry/core/hosted/types';
import { progressSteps, reportEta, roundEta } from './report-progress';

const ENGINES = ['chatgpt', 'claude', 'gemini', 'google_aio', 'google_ai_mode'];
type P = NonNullable<ReportView['progress']>;
const eng = (engine: string, closed: number, o: Partial<P['engines'][number]> = {}) =>
  ({ engine, total: 40, answered: closed, failed: 0, inBatch: 0, batch: false, ...o });
const view = (progress: Partial<P> | null, extra: Partial<ReportView> = {}) => ({
  status: 'measuring' as const, tier: 'compact' as const, promptsPreparing: false,
  progress: progress ? { done: 0, total: 200, phase: 'collecting', engines: [], etaMinutes: null, onlyBatchLeft: false, batchOpen: false, ...progress } as P : null,
  ...extra,
});
const states = (steps: ReturnType<typeof progressSteps>) => Object.fromEntries(steps.map((s) => [s.engine ?? s.key, s.state]));

describe('progressSteps', () => {
  it('eine Zeile je KI mit eigenem Fortschritt, Claude im Sammelauftrag, ohne Antwort ruhig gezählt', () => {
    const steps = progressSteps(view({
      engines: [eng('chatgpt', 40, { answered: 38, failed: 2 }), eng('claude', 0, { inBatch: 40, batch: true }), eng('google_aio', 31)],
    }), ENGINES);
    expect(states(steps)).toEqual({ chatgpt: 'done', claude: 'current', google_aio: 'current', analyze: 'todo', recs: 'todo', pdf: 'todo' });
    expect(steps[0]).toMatchObject({ count: { done: 40, total: 40 }, failed: 2, batchWaiting: false });
    expect(steps[1]).toMatchObject({ batchWaiting: true });
    expect(steps[2]).toMatchObject({ count: { done: 31, total: 40 } });
  });
  it('Folgeschritte als eigene Stufen', () => {
    const all = [eng('chatgpt', 40)];
    expect(states(progressSteps(view({ phase: 'analyzing', engines: all }), ENGINES))).toMatchObject({ analyze: 'current', recs: 'todo', pdf: 'todo' });
    expect(states(progressSteps(view({ phase: 'recommending', engines: all }), ENGINES))).toMatchObject({ analyze: 'done', recs: 'current', pdf: 'todo' });
    expect(states(progressSteps(view({ phase: 'done', engines: all }), ENGINES))).toMatchObject({ analyze: 'done', recs: 'done', pdf: 'current' });
  });
  it('vor dem Start (bezahlt, Auto-Start/Zusatzfragen): geplante KIs als „wartet“, beim Strategiebericht zuerst die Zusatzfragen', () => {
    const s = progressSteps(view(null, { status: 'paid', tier: 'strategy', promptsPreparing: true }), ENGINES);
    expect(s[0]).toMatchObject({ key: 'questions', state: 'current' });
    expect(s.filter((x) => x.key === 'engine').every((x) => x.state === 'todo' && x.count === null)).toBe(true);
    expect(progressSteps(view(null, { status: 'paid' }), ENGINES)[0].key).toBe('engine');
  });
  it('queued: nichts läuft schon', () => {
    expect(states(progressSteps(view({ phase: 'queued', engines: [eng('chatgpt', 0)] }), ENGINES)).chatgpt).toBe('todo');
  });
});

describe('reportEta', () => {
  it('ehrliche Ansage aus dem Fortschritt', () => {
    expect(reportEta(view(null, { status: 'paid' }))).toEqual({ kind: 'unknown' });
    expect(reportEta(view({ phase: 'queued' }))).toEqual({ kind: 'unknown' });
    expect(reportEta(view({ etaMinutes: null }))).toEqual({ kind: 'unknown' });
    expect(reportEta(view({ etaMinutes: 23 }))).toEqual({ kind: 'minutes', n: 25, batch: false });
    expect(reportEta(view({ etaMinutes: 23, batchOpen: true }))).toEqual({ kind: 'minutes', n: 25, batch: true });
    expect(reportEta(view({ onlyBatchLeft: true, batchOpen: true }))).toEqual({ kind: 'onlyClaude' });
    expect(reportEta(view({ phase: 'recommending', etaMinutes: 2 }))).toEqual({ kind: 'soon' });
  });
  it('roundEta: bis 10 genau, bis 60 auf 5er, darüber Stunden', () => {
    expect(roundEta(0.2, false)).toEqual({ kind: 'minutes', n: 1, batch: false });
    expect(roundEta(7.1, false)).toEqual({ kind: 'minutes', n: 8, batch: false });
    expect(roundEta(41, false)).toEqual({ kind: 'minutes', n: 45, batch: false });
    expect(roundEta(59, false)).toEqual({ kind: 'minutes', n: 60, batch: false });
    expect(roundEta(100, true)).toEqual({ kind: 'hours', n: 2, batch: true });
  });
});
