import { describe, expect, it } from 'vitest';
import type { CheckProgress } from '@askmetry/core/hosted/types';
import { agentSteps, cleanDomain, elapsedText, lockedCount, refreshSeconds, roughScore, visibilityEstimate, wilsonInterval } from './teaser';

describe('roughScore', () => {
  it('rundet auf 5er-Schritte', () => {
    expect(roughScore(0.31)).toBe(30);
    expect(roughScore(0.33)).toBe(35);
    expect(roughScore(1)).toBe(100);
  });
  it('0 nur ohne Nennung, sonst mindestens 5', () => {
    expect(roughScore(0)).toBe(0);
    expect(roughScore(null)).toBe(0);
    expect(roughScore(Number.NaN)).toBe(0);
    expect(roughScore(0.01)).toBe(5);
  });
  it('klemmt Werte über 1', () => expect(roughScore(1.4)).toBe(100));
});

describe('wilsonInterval', () => {
  it('95-%-Intervall wie im Bericht', () => {
    const w = wilsonInterval(6, 24)!;
    expect(w.low).toBeCloseTo(0.12, 2);
    expect(w.high).toBeCloseTo(0.449, 2);
    expect(wilsonInterval(0, 24)!.low).toBe(0);
    expect(wilsonInterval(24, 24)!.high).toBe(1);
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe('visibilityEstimate (Teaser-Aussage = Kennzahl des Berichts)', () => {
  it('synera.ai-Check: 6 von 24 Antworten → ca. 25, Spanne 10–45 (Bericht danach: 12)', () => {
    expect(visibilityEstimate({ responses: 24, responsesMentioned: 6, visibility: 0.25 }, 12))
      .toEqual({ mentioned: 6, responses: 24, score: 25, range: { low: 10, high: 45 }, simulated: false });
  });
  it('ältere Summary ohne Zähler: aus visibility × responses', () => {
    expect(visibilityEstimate({ responses: 35, visibility: 0.6 }, 12)).toMatchObject({ mentioned: 21, score: 60 });
  });
  it('Wert liegt immer in der Spanne', () => {
    for (let n = 12; n <= 40; n++) for (let k = 0; k <= n; k++) {
      const e = visibilityEstimate({ responses: n, responsesMentioned: k, visibility: k / n }, 12);
      expect(e.score!).toBeGreaterThanOrEqual(e.range!.low);
      expect(e.score!).toBeLessThanOrEqual(e.range!.high);
    }
  });
  it('zu kleine Stichprobe: kein Wert, keine Spanne – nur die Zählung', () => {
    expect(visibilityEstimate({ responses: 8, responsesMentioned: 3, visibility: 0.375 }, 12)).toEqual({ mentioned: 3, responses: 8, score: null, range: null, simulated: false });
  });
  it('simulierte Messung wird gekennzeichnet', () => {
    expect(visibilityEstimate({ responses: 35, responsesMentioned: 21, visibility: 0.6, simulated: true }, 12).simulated).toBe(true);
  });
});

describe('lockedCount', () => {
  it('zieht die freien Maßnahmen ab, nie negativ', () => {
    expect(lockedCount({ recommendationsTotal: 14 }, 2)).toBe(12);
    expect(lockedCount({ recommendationsTotal: 1 }, 2)).toBe(0);
    expect(lockedCount({ recommendationsTotal: 0 }, 0)).toBe(0);
  });
});

const base: CheckProgress = { stage: null, brandName: null, competitors: 0, prompts: 0, engines: [], analyzing: false, recommending: false };
const states = (steps: ReturnType<typeof agentSteps>) => Object.fromEntries(steps.map((x) => [x.key, x.state]));

describe('agentSteps (Checkliste aus echtem Zustand)', () => {
  it('Discovery: Website lesen → Marke → Wettbewerber und Fragen gleichzeitig', () => {
    expect(states(agentSteps({ status: 'discovering', progress: { ...base, stage: 'read' } }))).toMatchObject({ read: 'current', brand: 'todo', competitors: 'todo', chatgpt: 'todo', measures: 'todo' });
    expect(states(agentSteps({ status: 'discovering', progress: { ...base, stage: 'profile' } }))).toMatchObject({ read: 'done', brand: 'current', competitors: 'todo' });
    const plan = agentSteps({ status: 'discovering', progress: { ...base, stage: 'plan', brandName: 'Paylindo' } });
    expect(states(plan)).toMatchObject({ read: 'done', brand: 'done', competitors: 'current', questions: 'current', gemini: 'todo' });
    expect(plan.find((x) => x.key === 'brand')!.detail).toEqual({ kind: 'brand', name: 'Paylindo' });
  });

  it('Messung: Zähler je KI-Suche, fertige Suchen abgehakt, Auswertung danach', () => {
    const progress: CheckProgress = {
      ...base, brandName: 'Paylindo', competitors: 5, prompts: 8,
      engines: [{ engine: 'gemini', done: 8, total: 8 }, { engine: 'google_aio', done: 3, total: 8 }, { engine: 'google_ai_mode', done: 0, total: 8 }, { engine: 'chatgpt', done: 1, total: 4 }],
    };
    const s = agentSteps({ status: 'measuring', progress });
    expect(states(s)).toMatchObject({ read: 'done', brand: 'done', competitors: 'done', questions: 'done', gemini: 'done', google_aio: 'current', google_ai_mode: 'current', chatgpt: 'current', analyze: 'todo', measures: 'todo' });
    expect(s.find((x) => x.key === 'chatgpt')!.detail).toEqual({ kind: 'answered', done: 1, total: 4 });
    expect(s.find((x) => x.key === 'competitors')!.detail).toEqual({ kind: 'competitors', n: 5 });
    expect(s.find((x) => x.key === 'questions')!.detail).toEqual({ kind: 'questions', n: 8 });
    expect(states(agentSteps({ status: 'measuring', progress: { ...progress, analyzing: true } }))).toMatchObject({ analyze: 'current', measures: 'todo' });
    expect(states(agentSteps({ status: 'measuring', progress: { ...progress, recommending: true } }))).toMatchObject({ analyze: 'done', measures: 'current' });
  });

  it('eingereiht ohne Messung: nichts läuft vor; fertig: alles erledigt', () => {
    const q = states(agentSteps({ status: 'queued', progress: { ...base, competitors: 5, prompts: 8 } }));
    expect(Object.values(q).filter((v) => v === 'current')).toHaveLength(0);
    expect(q.questions).toBe('done');
    expect(Object.values(states(agentSteps({ status: 'ready', progress: base }))).every((v) => v === 'done')).toBe(true);
  });
});

describe('Aktualisierung und Laufzeit', () => {
  it('kurz, solange der Check läuft', () => {
    expect(refreshSeconds('discovering')).toBe(2);
    expect(refreshSeconds('measuring')).toBe(2);
    expect(refreshSeconds('ready')).toBeNull();
    expect(refreshSeconds('failed')).toBeNull();
  });
  it('m:ss', () => {
    expect(elapsedText('2026-11-05T10:00:00Z', Date.parse('2026-11-05T10:01:07Z'))).toBe('1:07');
    expect(elapsedText('2026-11-05T10:00:00Z', Date.parse('2026-11-05T09:59:00Z'))).toBe('0:00');
  });
});

describe('cleanDomain', () => {
  it('normalisiert und verwirft Unsinn', () => {
    expect(cleanDomain('https://www.Example.com/path?q')).toBe('example.com');
    expect(cleanDomain('reddit.com')).toBe('reddit.com');
    expect(cleanDomain('javascript:alert(1)')).toBeNull();
    expect(cleanDomain('localhost')).toBeNull();
  });
});
