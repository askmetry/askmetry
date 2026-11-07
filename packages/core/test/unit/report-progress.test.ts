// Berichtsseite während der Messung: Phase und ehrliche Restzeit (reine Funktionen aus hosted/progress.ts, ohne DB).
import { describe, expect, it } from 'vitest';
import { ANALYSIS_WAIT_MS, estimateRemainingMinutes, FINISH_TAIL_MIN, measurementPhase, RECS_GRACE_MS } from '../../src/hosted/progress.ts';
import { reportErrorKey } from '../../src/hosted/reports.ts';

describe('measurementPhase', () => {
  const ph = (o: Partial<Parameters<typeof measurementPhase>[0]>) =>
    measurementPhase({ status: 'running', openRuns: 0, closedRuns: 0, pendingAnalysis: 0, recs: 0, finishedAgoMs: 0, ...o });
  it('queued → collecting → analyzing → recommending → done', () => {
    expect(ph({ status: 'queued', openRuns: 10 })).toBe('queued');
    expect(ph({ status: 'queued', openRuns: 9, closedRuns: 1 })).toBe('collecting'); // unterbrochen, schon angefangen
    expect(ph({ status: 'running', openRuns: 3, closedRuns: 7 })).toBe('collecting');
    expect(ph({ status: 'running', openRuns: 0, closedRuns: 10 })).toBe('analyzing');
    expect(ph({ status: 'done', pendingAnalysis: 2, finishedAgoMs: 1000 })).toBe('analyzing');
    expect(ph({ status: 'done', pendingAnalysis: 2, finishedAgoMs: ANALYSIS_WAIT_MS + 1, recs: 3 })).toBe('done');
    expect(ph({ status: 'done', recs: 0, finishedAgoMs: 1000 })).toBe('recommending');
    expect(ph({ status: 'done', recs: 3, recsLocked: true, finishedAgoMs: 5 * 60_000 })).toBe('recommending');
    expect(ph({ status: 'budget_exceeded', recs: 0, finishedAgoMs: RECS_GRACE_MS + 1 })).toBe('done');
    expect(ph({ status: 'failed' })).toBe('failed');
  });
});

describe('estimateRemainingMinutes', () => {
  const min = 60_000;
  const eng = (engine: string, total: number, closed: number, batch = false) =>
    ({ engine, total, answered: closed, failed: 0, inBatch: batch ? total - closed : 0, batch });
  it('langsamste KI ohne Sammelauftrag + Auswertung', () => {
    // ChatGPT 20/40 in 10 min → 10 min Rest; Gemini 30/40 → 3,3 min; Claude im Batch zählt nicht
    expect(estimateRemainingMinutes({ phase: 'collecting', elapsedMs: 10 * min, engines: [eng('chatgpt', 40, 20), eng('gemini', 40, 30), eng('claude', 40, 0, true)] }))
      .toBe(10 + FINISH_TAIL_MIN);
  });
  it('keine erfundene Zahl: zu früh, zu wenig Daten, nur noch Claude, noch nicht gestartet', () => {
    expect(estimateRemainingMinutes({ phase: 'collecting', elapsedMs: 30_000, engines: [eng('chatgpt', 40, 20)] })).toBeNull();
    expect(estimateRemainingMinutes({ phase: 'collecting', elapsedMs: 10 * min, engines: [eng('chatgpt', 40, 2)] })).toBeNull();
    expect(estimateRemainingMinutes({ phase: 'collecting', elapsedMs: 10 * min, engines: [eng('chatgpt', 40, 40), eng('claude', 40, 10, true)] })).toBeNull();
    expect(estimateRemainingMinutes({ phase: 'queued', elapsedMs: 0, engines: [eng('chatgpt', 40, 0)] })).toBeNull();
  });
  it('Folgeschritte: wenige Minuten', () => {
    for (const phase of ['analyzing', 'recommending', 'done'] as const) {
      const n = estimateRemainingMinutes({ phase, elapsedMs: 0, engines: [] })!;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(FINISH_TAIL_MIN);
    }
  });
});

describe('reportErrorKey (nur Schlüssel nach außen)', () => {
  it('Auto-Start-Gründe, Zusatzfragen, Fehlschlag', () => {
    expect(reportErrorKey({ status: 'paid', error: null })).toBeNull();
    expect(reportErrorKey({ status: 'paid', error: 'autostart|budget' })).toBe('autostart_budget');
    expect(reportErrorKey({ status: 'paid', error: 'autostart|measurement_active' })).toBe('autostart_queued');
    expect(reportErrorKey({ status: 'paid', error: 'autostart|too_few_prompts' })).toBe('autostart_too_few');
    expect(reportErrorKey({ status: 'paid', error: 'autostart|error' })).toBe('autostart_failed');
    expect(reportErrorKey({ status: 'paid', error: 'prompts|Timeout bei kunde@firma.de' })).toBe('prompts_failed');
    expect(reportErrorKey({ status: 'failed', error: 'Messung: alles kaputt' })).toBe('failed');
    expect(reportErrorKey({ status: 'measuring', error: 'autostart|budget' })).toBeNull();
  });
});
