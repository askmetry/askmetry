// Check-Seite vor dem Kauf (rein, ohne DB): konkrete Befunde, Antwort-Ausschnitte, Live-Antworten, Listen bearbeiten.
import { describe, expect, it } from 'vitest';
import { applyListOp, cleanEntry } from '../../src/hosted/check-edit.ts';
import { answerExcerpt, pickFindings, plainAnswerText, toLiveAnswers, type AnswerRow } from '../../src/hosted/findings.ts';

let n = 0;
const ans = (engine: string, question: string, answer: string, mentions: { name: string; own?: boolean; competitor?: boolean }[], extra: Partial<AnswerRow> = {}): AnswerRow => ({
  id: `r${++n}`, engine, question, answer, analyzed: true, noAiAnswer: false, createdAt: new Date(2026, 10, 7, 12, 0, n),
  mentions: mentions.map((m, i) => ({ name: m.name, own: !!m.own, competitor: m.competitor ?? !m.own, position: i + 1, snippet: null })),
  ...extra,
});

describe('answerExcerpt / plainAnswerText', () => {
  it('Markdown, Links und HTML werden zu Fließtext', () => {
    expect(plainAnswerText('## Tipp\n1. **SumUp** – [mehr](https://sumup.de) <script>x</script> [1]')).toBe('Tipp SumUp – mehr x');
  });
  it('Ausschnitt um die Nennung, an Satz-/Wortgrenzen gekürzt, mit Auslassungszeichen', () => {
    const text = `${'Vorab ein langer Einleitungssatz über viele Dinge. '.repeat(3)}Für kleine Läden empfehlen viele **SumUp**, weil es günstig ist. Danach kommt noch sehr viel weiterer Text, der nicht mehr in den Ausschnitt gehört und abgeschnitten wird.`;
    const e = answerExcerpt(text, 'SumUp')!;
    expect(e).toBe('… Für kleine Läden empfehlen viele SumUp, weil es günstig ist.');
    expect(answerExcerpt(`SumUp ${'und noch mehr '.repeat(20)}`, 'SumUp')).toMatch(/^SumUp und .* …$/);
    expect(answerExcerpt('Ohne Treffer', 'SumUp')).toBeNull();
    expect(answerExcerpt('', 'SumUp')).toBeNull();
  });
});

describe('pickFindings', () => {
  it('Lücken: Wettbewerber ja, eigene Marke nein; mehr Wettbewerber zuerst; verschiedene KIs und Fragen', () => {
    const rows = [
      ans('chatgpt', 'Q1', 'Nimm SumUp oder Zettle.', [{ name: 'SumUp' }, { name: 'Zettle' }]),
      ans('chatgpt', 'Q1', 'SumUp, Zettle und Paylindo.', [{ name: 'SumUp' }, { name: 'Zettle' }, { name: 'Paylindo', own: true }]),
      ans('chatgpt', 'Q2', 'SumUp, Zettle, myPOS.', [{ name: 'SumUp' }, { name: 'Zettle' }, { name: 'myPOS' }]),
      ans('gemini', 'Q2', 'Zettle ist gut.', [{ name: 'Zettle' }]),
      ans('gemini', 'Q3', 'SumUp ist gut.', [{ name: 'SumUp' }]),
      ans('google_aio', 'Q4', '', [], { noAiAnswer: true }),
      ans('google_aio', 'Q4', 'SumUp.', [{ name: 'SumUp' }], { analyzed: false }),
    ];
    const f = pickFindings(rows);
    expect(f.gapAnswers).toBe(4);
    expect(f.answers).toBe(5);
    expect(f.gaps.map((g) => [g.engine, g.question])).toEqual([['chatgpt', 'Q2'], ['gemini', 'Q3'], ['chatgpt', 'Q1']]);
    expect(f.gaps[0].competitors).toEqual(['SumUp', 'Zettle', 'myPOS']);
    expect(f.gaps[0].excerpt).toBe('SumUp, Zettle, myPOS.');
    expect(f.wins).toEqual([]);
  });
  it('ohne Lücken: Antworten mit dir als positiver Befund; ohne alles: leer', () => {
    const rows = [
      ans('chatgpt', 'Q1', 'Zettle und Paylindo.', [{ name: 'Zettle' }, { name: 'Paylindo', own: true }]),
      ans('gemini', 'Q2', 'Paylindo ist Testsieger.', [{ name: 'Paylindo', own: true }]),
    ];
    const f = pickFindings(rows, { simulated: true });
    expect(f.gaps).toEqual([]);
    expect(f.wins.map((w) => w.question)).toEqual(['Q2', 'Q1']);
    expect(f.wins[0].excerpt).toBe('Paylindo ist Testsieger.');
    expect(f.simulated).toBe(true);
    expect(pickFindings([ans('gemini', 'Q', 'Kommt drauf an.', [])])).toMatchObject({ gaps: [], wins: [], gapAnswers: 0, answers: 1 });
  });
});

describe('toLiveAnswers', () => {
  it('neueste zuerst begrenzt, nur Namen, Zustände', () => {
    const rows = [
      ans('chatgpt', 'Q1', 'SumUp und Paylindo', [{ name: 'SumUp' }, { name: 'Paylindo', own: true }, { name: 'sumup' }]),
      ans('gemini', 'Q2', 'x', [], { analyzed: false }),
      ans('google_aio', 'Q3', '', [], { noAiAnswer: true }),
    ];
    const l = toLiveAnswers(rows, 2);
    expect(l).toEqual([
      { id: rows[0].id, engine: 'chatgpt', question: 'Q1', brands: [{ name: 'SumUp', own: false }, { name: 'Paylindo', own: true }], ownNamed: true, state: 'analyzed' },
      { id: rows[1].id, engine: 'gemini', question: 'Q2', brands: [], ownNamed: false, state: 'pending' },
    ]);
    expect(toLiveAnswers(rows)[2].state).toBe('empty');
  });
});

describe('applyListOp (Fragen/Themen vor dem Kauf)', () => {
  const rules = { max: 3, min: 1, minLength: 10, maxLength: 300, brand: 'Paylindo', maxWithBrand: 1 };
  const list = ['Welches Terminal für Cafés?', 'Was kostet Paylindo pro Monat?'];
  it('hinzufügen, ändern, löschen mit Grenzen', () => {
    expect(applyListOp(list, { action: 'add', text: '  Welche Kasse für Friseure?  ' }, rules)).toEqual({ list: [...list, 'Welche Kasse für Friseure?'] });
    expect(applyListOp([...list, 'Dritte Frage zum Thema?'], { action: 'add', text: 'Vierte Frage zum Thema?' }, rules)).toEqual({ error: 'too_many' });
    expect(applyListOp(list, { action: 'add', text: 'kurz' }, rules)).toEqual({ error: 'too_short' });
    expect(applyListOp(list, { action: 'add', text: 'x'.repeat(301) }, rules)).toEqual({ error: 'too_long' });
    expect(applyListOp(list, { action: 'add', text: 'welches terminal für cafés?' }, rules)).toEqual({ error: 'duplicate' });
    expect(applyListOp(list, { action: 'add', text: 'Ist Paylindo seriös und gut?' }, rules)).toEqual({ error: 'brand_limit' });
    // die Markenfrage selbst umformulieren bleibt erlaubt
    expect(applyListOp(list, { action: 'edit', index: 1, expected: list[1], text: 'Ist Paylindo seriös und gut?' }, rules)).toEqual({ list: [list[0], 'Ist Paylindo seriös und gut?'] });
    expect(applyListOp(list, { action: 'edit', index: 1, expected: 'alt', text: 'Ist Paylindo seriös und gut?' }, rules)).toEqual({ error: 'wrong_state' });
    expect(applyListOp(list, { action: 'delete', index: 5, expected: 'x' }, rules)).toEqual({ error: 'wrong_state' });
    expect(applyListOp(list, { action: 'delete', index: 0, expected: list[0] }, rules)).toEqual({ list: [list[1]] });
    expect(applyListOp([list[0]], { action: 'delete', index: 0, expected: list[0] }, rules)).toEqual({ error: 'too_short' });
  });
  it('cleanEntry entfernt HTML, URLs, Aufzählungszeichen', () => {
    expect(cleanEntry('1. <b>Beste</b> Kasse? https://x.de')).toBe('Beste Kasse?');
  });
});
