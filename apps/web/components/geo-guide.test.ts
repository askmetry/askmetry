import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GEO_GUIDE } from '@askmetry/core/guide';
import { messages } from '../lib/i18n/messages';
import { GeoGuide, guideJsonLd } from './geo-guide';

describe('GeoGuide', () => {
  for (const lang of ['de', 'en'] as const) {
    it(`rendert alle Einträge aufklappbar mit Ankern und Quellen (${lang})`, () => {
      const g = GEO_GUIDE[lang];
      const html = renderToStaticMarkup(createElement(GeoGuide, { guide: g, t: messages[lang].guide }));
      expect(html.match(/<details/g)).toHaveLength(g.entries.length);
      for (const e of g.entries) expect(html).toContain(`id="${e.id}"`);
      for (let i = 1; i <= g.sources.length; i++) expect(html).toContain(`id="quelle-${i}"`);
      // jeder Verweis [n] zeigt auf eine vorhandene Quelle
      for (const m of html.matchAll(/href="#quelle-(\d+)"/g)) expect(Number(m[1])).toBeLessThanOrEqual(g.sources.length);
      expect(html).toContain('id="woher-fragen"'); // Link von der Fragen-Seite
    });
  }

  it('JSON-LD enthält genau die sichtbaren Fragen', () => {
    const ld = guideJsonLd(GEO_GUIDE.de);
    expect(ld.mainEntity.map((q) => q.name)).toEqual(GEO_GUIDE.de.entries.map((e) => e.question));
  });
});
