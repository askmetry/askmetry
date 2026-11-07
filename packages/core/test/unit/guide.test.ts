import { describe, expect, it } from 'vitest';
import { GEO_GUIDE, GEO_GUIDE_SELF_HOSTED, GUIDE_SOURCE_IDS, geoGuide, sourceNumbers, type Guide } from '../../src/guide.ts';
import { CHECK_SCOPE, REMEASURE_REMINDER_DAYS, REPORT_SCOPE } from '../../src/hosted/config.ts';

const texts = (g: Guide) => g.entries.flatMap((e) => [e.question, ...e.answer.flatMap((b) => (b.kind === 'p' ? [b.text] : b.items))]);

describe('Kurzleitfaden GEO', () => {
  it('de und en haben dieselben Einträge in derselben Reihenfolge, mit denselben Quellen und Blockarten', () => {
    const shape = (l: 'de' | 'en', all = GEO_GUIDE) => all[l].entries.map((e) => ({ id: e.id, sources: e.sources ?? [], blocks: e.answer.map((b) => (b.kind === 'p' ? 'p' : `list${b.items.length}`)) }));
    expect(shape('en')).toEqual(shape('de'));
    expect(shape('en', GEO_GUIDE_SELF_HOSTED)).toEqual(shape('de', GEO_GUIDE_SELF_HOSTED));
    expect(GEO_GUIDE.en.sources.map((s) => s.id)).toEqual(GEO_GUIDE.de.sources.map((s) => s.id));
  });

  it('8–12 Einträge, eindeutige IDs, nicht-leere Texte', () => {
    for (const g of [...Object.values(GEO_GUIDE), ...Object.values(GEO_GUIDE_SELF_HOSTED)]) {
      expect(g.entries.length).toBeGreaterThanOrEqual(8);
      expect(g.entries.length).toBeLessThanOrEqual(12);
      expect(new Set(g.entries.map((e) => e.id)).size).toBe(g.entries.length);
      for (const t of [g.title, g.intro, g.caveat, ...texts(g)]) expect(t.trim()).not.toBe('');
    }
  });

  it('jede Quelle ist bekannt, wird genutzt und hat eine https-URL; Nummern passen', () => {
    const used = new Set(GEO_GUIDE.de.entries.flatMap((e) => e.sources ?? []));
    expect([...used].every((id) => GUIDE_SOURCE_IDS.includes(id))).toBe(true);
    expect(GUIDE_SOURCE_IDS.filter((id) => !used.has(id))).toEqual([]);
    for (const s of GEO_GUIDE.de.sources) expect(s.url).toMatch(/^https:\/\//);
    const g = GEO_GUIDE.de;
    expect(sourceNumbers(g, g.entries[0]!)).toEqual([1, 2, 3, 4]);
  });

  it('keine deutschen Reste im Englischen, Umlaute im Deutschen', () => {
    const german = /[äöüÄÖÜß]|\b(und|oder|nicht|keine?|mit|für|der|die|das|deine?|wird|werden)\b/;
    expect(texts(GEO_GUIDE.en).filter((t) => german.test(t))).toEqual([]);
    expect(texts(GEO_GUIDE_SELF_HOSTED.en).filter((t) => german.test(t))).toEqual([]);
    expect(texts(GEO_GUIDE.de).join(' ')).toMatch(/[äöüß]/);
    expect(texts(GEO_GUIDE.de).join(' ')).not.toMatch(/\b(fuer|Massnahme|ueber|koennen)\b/i);
  });

  it('Aussagen über Askmetry passen zur Konfiguration', () => {
    const text = texts(GEO_GUIDE.de).join(' ');
    expect(text).toContain(`${REPORT_SCOPE.compact.prompts} Fragen`);
    expect(text).toContain(`(${REPORT_SCOPE.compact.prompts} bzw. ${REPORT_SCOPE.strategy.prompts})`);
    expect(text).toContain(`${REPORT_SCOPE.strategy.prompts - REPORT_SCOPE.compact.prompts} weitere Fragen`);
    expect(REPORT_SCOPE.compact.repetitions).toBe(2); // „zweimal je KI-Suche“
    expect(REPORT_SCOPE.compact.engines).toHaveLength(5); // „fünf KI-Suchen“
    // Schnell-Check: 8 Fragen ohne Markennamen, je 1× in Gemini + beiden Google-Suchen, die Hälfte (4) auch in ChatGPT
    expect(text).toContain(`nur ${CHECK_SCOPE.measured} Fragen ohne deinen Markennamen, jede einmal in Gemini und den beiden Google-Suchen`);
    expect(text).toContain(`die Hälfte davon (${CHECK_SCOPE.engineMaxPrompts.chatgpt}) auch in ChatGPT`);
    expect(CHECK_SCOPE.engineMaxPrompts.chatgpt * 2).toBe(CHECK_SCOPE.measured);
    expect([...CHECK_SCOPE.engines].sort()).toEqual(['chatgpt', 'gemini', 'google_ai_mode', 'google_aio']);
    expect(Object.keys(CHECK_SCOPE.engineMaxPrompts)).toEqual(['chatgpt']);
    expect(CHECK_SCOPE.repetitions).toBe(1); // „einmal“, „im Schnell-Check nur einmal“
    // Wiederholungen nur im Bericht, nicht im Check
    const schw = GEO_GUIDE.de.entries.find((e) => e.id === 'schwankungen')!.answer.map((b) => (b.kind === 'p' ? b.text : '')).join(' ');
    expect(schw).toContain(`im Bericht jede Frage ${['', 'einmal', 'zweimal', 'dreimal'][REPORT_SCOPE.compact.repetitions]} je KI-Suche (im Schnell-Check nur einmal)`);
    expect(GEO_GUIDE.en.entries.find((e) => e.id === 'messung')!.answer.map((b) => (b.kind === 'p' ? b.text : '')).join(' '))
      .toContain(`only ${CHECK_SCOPE.measured} questions without your brand name, each once in Gemini and both Google engines (AI Overviews, AI Mode), and half of them (${CHECK_SCOPE.engineMaxPrompts.chatgpt}) in ChatGPT too`);
    expect(REMEASURE_REMINDER_DAYS).toBe(56); // „acht Wochen“
  });

  it('Selbsthosting: keine Aussagen über Hosted-Funktionen, dieselben Anker', () => {
    const hostedTerms = /Schnell-Check|Strategiebericht|Standortbestimmung|Nachmessung|Bericht|gesperrt|erinnert|quick check|strategy report|re-measure|report|locked|reminds/i;
    for (const lang of ['de', 'en'] as const) {
      const self = geoGuide(lang, { hosted: false });
      expect(self).toBe(GEO_GUIDE_SELF_HOSTED[lang]);
      expect(texts(self).filter((t) => hostedTerms.test(t))).toEqual([]);
      // Einträge mit Hosted-Aussagen haben eine neutrale Fassung – Anker (z. B. #woher-fragen) bleiben erhalten
      expect(self.entries.map((e) => e.id)).toEqual(GEO_GUIDE[lang].entries.map((e) => e.id));
      for (const id of ['woher-fragen', 'fragen-anpassen', 'messung', 'schwankungen', 'wirkung']) {
        expect(GEO_GUIDE[lang].entries.find((e) => e.id === id)!.hostedOnly, id).toBe(true);
      }
      expect(self.entries.every((e) => !e.hostedOnly && !e.selfHosted)).toBe(true);
      // Quellenverzeichnis passt zu den Einträgen
      for (const e of self.entries) for (const n of sourceNumbers(self, e)) expect(n).toBeGreaterThan(0);
      // gehostete Fassung ist Standard
      expect(geoGuide(lang)).toBe(GEO_GUIDE[lang]);
      expect(geoGuide(lang, { hosted: true })).toBe(GEO_GUIDE[lang]);
    }
    expect(GEO_GUIDE_SELF_HOSTED.de.entries.find((e) => e.id === 'woher-fragen')!.question).toBe('Welche Fragen sollte ich messen?');
  });

  it('geoGuide fällt auf Deutsch zurück', () => {
    expect(geoGuide('en').lang).toBe('en');
    expect(geoGuide('fr').lang).toBe('de');
    expect(geoGuide(null).title).toBe('Kurzleitfaden GEO');
  });
});
