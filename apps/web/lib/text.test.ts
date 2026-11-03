import { describe, expect, it } from 'vitest';
import { brandKey, firstSentence, plainTerms, uniqueBrandNames } from './text';

describe('firstSentence', () => {
  it('nimmt den ersten Satz, ignoriert Abkürzungen', () => {
    expect(firstSentence('KIs nutzen paylindo.de in 15 von 50 Antworten als Quelle. Sie nennen Paylindo aber nicht.')).toBe('KIs nutzen paylindo.de in 15 von 50 Antworten als Quelle.');
    expect(firstSentence('Vergleichsportale wie z. B. Check24 listen dich nicht. Das kostet Nennungen.')).toBe('Vergleichsportale wie z. B. Check24 listen dich nicht.');
    expect(firstSentence('Kurz. Danach mehr Text hier.')).toBe('Kurz. Danach mehr Text hier.');
    expect(firstSentence('  Nur ein Satz ohne Punkt ')).toBe('Nur ein Satz ohne Punkt');
  });
});

describe('Markennamen', () => {
  it('normalisiert Schreibweisen', () => {
    expect(brandKey(' Giro-Card ')).toBe(brandKey('giro card'));
    expect(uniqueBrandNames(['girocard', 'SumUp', 'Girocard', 'sumup'])).toEqual(['Girocard', 'SumUp']);
  });
});

describe('plainTerms', () => {
  it('ersetzt Prompt(s) durch Frage(n), außer bei Claude-Prompts', () => {
    expect(plainTerms('Sichtbarkeit bei den betroffenen Prompts')).toBe('Sichtbarkeit bei den betroffenen Fragen');
    expect(plainTerms('dieselben Prompts erneut')).toBe('dieselben Fragen erneut');
    expect(plainTerms('Claude-Prompts und Prompt kopieren')).toBe('Claude-Prompts und Prompt kopieren');
    expect(plainTerms('Prompts für Zahlungsanbieter')).toBe('Fragen für Zahlungsanbieter');
    expect(plainTerms('Prompt für deine KI')).toBe('Prompt für deine KI');
  });
});

describe('plainTerms (en)', () => {
  it('replaces prompt(s) with question(s), except for AI prompts', () => {
    expect(plainTerms('Visibility for the affected prompts', 'en')).toBe('Visibility for the affected questions');
    expect(plainTerms('Prompts about payments', 'en')).toBe('Questions about payments');
    expect(plainTerms('Copy prompt', 'en')).toBe('Copy prompt');
    expect(plainTerms('the prompt for your AI', 'en')).toBe('the prompt for your AI');
    expect(plainTerms('Claude-prompts stay', 'en')).toBe('Claude-prompts stay');
  });
});
