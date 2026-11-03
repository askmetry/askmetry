import { describe, expect, it } from 'vitest';
import { groupRecs, levelLabel, nextBaseline, nextUp, parseEvidence, metricLine, metricText, parseMetric, recTouchesPrompt, sortRecs, statusActions, trend, type RecLike } from './recommendations';

const rec = (id: string, p: number, over: Partial<RecLike> = {}): RecLike =>
  ({ id, status: 'open', priority: String(p), active: true, impact: 2, effort: 2, title: id, type: 'outreach', ...over });

describe('Sortierung und Gruppierung', () => {
  const xs = [
    rec('a', 1.5), rec('b', 9), rec('c', 4, { status: 'in_progress' }), rec('d', 7, { type: 'technical' }),
    rec('e', 8, { active: false }), rec('f', 3, { status: 'done' }), rec('g', 5, { status: 'dismissed', type: 'technical' }), rec('h', 2),
  ];
  it('sortiert nach priority (numerisch, auch als String), dann Wirkung/Aufwand', () => {
    expect(sortRecs(xs).map((r) => r.id)).toEqual(['b', 'e', 'd', 'g', 'c', 'f', 'h', 'a']);
    expect(sortRecs([rec('x', 1, { impact: 1 }), rec('y', 1, { impact: 3 }), rec('z', 1, { impact: 3, effort: 1 })]).map((r) => r.id)).toEqual(['z', 'y', 'x']);
    expect(sortRecs([rec('x', 10), rec('y', 9)]).map((r) => r.id)).toEqual(['x', 'y']); // nicht lexikografisch
  });
  it('nextUp: nur aktive, offene Top-3', () => {
    expect(nextUp(xs).map((r) => r.id)).toEqual(['b', 'd', 'h']);
  });
  it('gruppiert aktive nach Status in fester Reihenfolge, inaktive separat', () => {
    const g = groupRecs(xs);
    expect(g.groups.map((x) => [x.status, x.items.map((r) => r.id)])).toEqual([
      ['open', ['b', 'd', 'h', 'a']], ['in_progress', ['c']], ['done', ['f']], ['dismissed', ['g']],
    ]);
    expect(g.counts).toEqual({ open: 4, in_progress: 1, done: 1, dismissed: 1 });
    expect(g.inactive.map((r) => r.id)).toEqual(['e']);
    expect(g.types).toEqual(['outreach', 'technical']);
  });
  it('filtert nach Status und Typ', () => {
    expect(groupRecs(xs, { type: 'technical' }).groups.map((x) => x.status)).toEqual(['open', 'dismissed']);
    expect(groupRecs(xs, { type: 'technical' }).counts.open).toBe(1);
    expect(groupRecs(xs, { status: 'done' }).total).toBe(1);
  });
});

const snap = (value: number | null, higherIsBetter = true) => ({ label: 'Sichtbarkeit bei den betroffenen Prompts', value, num: 1, den: 5, higherIsBetter, collectionId: 'c1' });
const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('Belege robust lesen (Format laut CONTRACT „Maßnahmen“)', () => {
  it('kommt mit leeren und kaputten evidence-Feldern zurecht', () => {
    const empty = parseEvidence(null);
    expect(empty).toMatchObject({ examples: [], prompts: [], urls: [], competitors: [], baseline: null, current: null, titleSuggestion: null });
    expect(parseEvidence({ examples: 'x', prompts: [1], urls: {}, current: 0.3, baseline: { value: 0.1 } })).toMatchObject({ examples: [], prompts: [], urls: [], current: null, baseline: null });
  });
  it('ordnet Beispiel-Prompts über evidence.prompts zu und filtert unsichere URLs', () => {
    const e = parseEvidence({
      prompts: [{ id: P1, text: 'Welches  Gerät?' }, { id: 'kaputt', text: 'X' }, { id: '1f8fad5b-d9cb-469f-a165-70867728950e', text: 'Zwei', missing: ['chatgpt', 3] }],
      examples: [{ prompt: 'welches gerät?', engine: 'chatgpt', url: 'javascript:alert(1)' }, {}, null, { prompt: 'Unbekannt', url: 'https://chip.de/x' }],
      urls: [{ url: 'https://reddit.com/r/A/comments/1', title: 'T', count: 4, kind: 'searched' }, { url: 'ftp://x' }],
      competitors: [{ name: 'SumUp', count: 3 }, { count: 2 }],
      titleSuggestion: 'Titel', source: 'r/A', basePage: 'https://paylindo.de/x',
      current: snap(0.2), baseline: snap(0.1), previous: null,
    });
    expect(e.prompts).toEqual([{ id: P1, text: 'Welches  Gerät?', missing: [] }, { id: '1f8fad5b-d9cb-469f-a165-70867728950e', text: 'Zwei', missing: ['chatgpt'] }]);
    expect(e.examples).toHaveLength(2);
    expect(e.examples[0]).toMatchObject({ promptId: P1, url: null, engine: 'chatgpt' });
    expect(e.examples[1]).toMatchObject({ promptId: null, url: 'https://chip.de/x' });
    expect(e.urls).toEqual([{ url: 'https://reddit.com/r/A/comments/1', title: 'T', count: 4, kind: 'searched' }]);
    expect(e.competitors).toEqual([{ name: 'SumUp', count: 3 }]);
    expect(e.current).toMatchObject({ value: 0.2, num: 1, den: 5, higherIsBetter: true });
    expect(e.previous).toBeNull();
  });
  it('bewertet Veränderungen je nach higherIsBetter', () => {
    expect(trend(parseMetric(snap(0.1)), parseMetric(snap(0.3)))).toBe('better');
    expect(trend(parseMetric(snap(0.1, false)), parseMetric(snap(0.3, false)))).toBe('worse');
    expect(trend(parseMetric(snap(0.2)), parseMetric(snap(0.2)))).toBe('same');
    expect(trend(null, parseMetric(snap(0.2)))).toBeNull();
    expect(trend(parseMetric(snap(null)), parseMetric(snap(0.2)))).toBeNull();
  });
  it('Labels für Wirkung/Aufwand', () => {
    expect([1, 2, 3, 0, 5].map(levelLabel)).toEqual(['gering', 'mittel', 'hoch', 'mittel', 'hoch']);
  });
});

describe('Statuswechsel', () => {
  it('bietet passende Aktionen an', () => {
    expect(statusActions('open').map((a) => a.label)).toEqual(['Starten', 'Erledigt', 'Verwerfen']);
    expect(statusActions('in_progress').map((a) => a.to)).toEqual(['done', 'dismissed', 'open']);
    expect(statusActions('done').map((a) => a.label)).toEqual(['Wieder öffnen']);
  });
  it('Baseline: Start → evidence.current, Wieder öffnen → evidence.baseline (Rundlauf stellt Ausgangszustand her)', () => {
    const ev = { baseline: snap(0.1), current: snap(0.2) };
    expect(nextBaseline('open', 'in_progress', snap(0.1), ev)).toEqual(snap(0.2));
    expect(nextBaseline('open', 'done', null, ev)).toEqual(snap(0.2));
    expect(nextBaseline('in_progress', 'done', snap(0.15), ev)).toBeUndefined(); // Beginn der Umsetzung bleibt
    expect(nextBaseline('in_progress', 'open', snap(0.2), ev)).toEqual(snap(0.1));
    expect(nextBaseline('done', 'open', snap(0.2), {})).toBeNull();
    expect(nextBaseline('open', 'dismissed', snap(0.1), ev)).toBeUndefined();
    expect(nextBaseline('open', 'in_progress', null, { baseline: snap(0.1) })).toEqual(snap(0.1));
    expect(nextBaseline('open', 'in_progress', null, {})).toBeUndefined();
  });
});

describe('recTouchesPrompt', () => {
  it('erkennt die Frage über Schlüssel, promptIds und prompts', () => {
    expect(recTouchesPrompt('content_gap:p1', {}, 'p1')).toBe(true);
    expect(recTouchesPrompt('outreach:x.de', { promptIds: ['p2', 'p1'] }, 'p1')).toBe(true);
    expect(recTouchesPrompt('community:reddit:r/x', { prompts: [{ id: 'p1', text: 'a' }] }, 'p1')).toBe(true);
    expect(recTouchesPrompt('outreach:x.de', { promptIds: ['p2'], prompts: [{ id: 'p3' }] }, 'p1')).toBe(false);
    expect(recTouchesPrompt('technical:robots', null, 'p1')).toBe(false);
  });
});

describe('metricText', () => {
  it('nennt Nenner mit Bezeichnung und Prozent', () => {
    expect(metricText({ num: 17, den: 50, value: 0.34, denLabel: 'Antworten' })).toBe('17 von 50 Antworten (34 %)');
    expect(metricText({ num: 1, den: 1, value: 1, denLabel: null })).toBe('1 von 1 Antwort (100 %)');
    expect(metricText({ num: 2, den: 5, value: 0.4, denLabel: 'Antworten mit deiner Website als Quelle' })).toBe('2 von 5 Antworten mit deiner Website als Quelle (40 %)');
    expect(metricText({ num: null, den: 5, value: null, denLabel: null })).toBeNull();
  });
});

describe('metricLine', () => {
  it('nennt die Basis nur einmal', () => {
    expect(metricLine({ label: 'Paylindo genannt in Antworten mit deiner Website als Quelle', denLabel: 'Antworten mit deiner Website als Quelle', num: 2, den: 17, value: 2 / 17 }))
      .toBe('Paylindo genannt: 2 von 17 Antworten mit deiner Website als Quelle (12 %)');
    expect(metricLine({ label: 'KI-Sichtbarkeit', denLabel: null, num: 1, den: 45, value: 1 / 45 })).toBe('KI-Sichtbarkeit: 1 von 45 Antworten (2 %)');
    expect(metricLine({ label: 'Technik', denLabel: null, num: null, den: null, value: null })).toBe('Technik');
  });
});
