import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TeaserRecommendation } from '@askmetry/core/hosted/types';
import { messages } from '../../lib/i18n/messages';

// getI18n liest Cookies/Header der Anfrage – im Test feste Sprache
vi.mock('@/lib/i18n/server', () => ({
  getI18n: async () => ({ locale: 'de', t: messages.de, f: null }),
}));

const { TeaserRecCard } = await import('./teaser-rec');

const rec: TeaserRecommendation = {
  id: 'r1', area: 'own_content', type: 'comparison', title: 'Vergleichsseite anlegen',
  why: 'Die KIs zitieren Vergleichsseiten deiner Wettbewerber.', steps: ['Seite anlegen'], impact: 3, effort: 2,
};

describe('TeaserRecCard', () => {
  it('zeigt die Wirkung, aber keinen Aufwand', async () => {
    const html = renderToStaticMarkup(await TeaserRecCard({ rec }));
    expect(html).toContain('data-impact="3"');
    expect(html).toContain('Große Wirkung');
    expect(html).not.toMatch(/Aufwand|Std\.|Minuten|\bTage?\b/);
  });
});
