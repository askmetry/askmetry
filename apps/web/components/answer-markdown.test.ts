import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnswerMarkdown } from './answer-markdown';
import type { Term } from '../lib/metrics';

const terms: Term[] = [{ term: 'Paylindo', kind: 'own' }, { term: 'Stripe', kind: 'competitor' }];
const render = (text: string) => renderToStaticMarkup(createElement(AnswerMarkdown, { text, terms }));

describe('AnswerMarkdown', () => {
  it('rendert GFM-Tabellen scrollbar und hebt Marken in Zellen hervor', () => {
    const html = render('| Anbieter | Preis |\n|---|---|\n| **Paylindo** | 1 € |\n| Stripe | 2 € |');
    expect(html).toContain('<div class="md-table"><table>');
    expect(html).toContain('<strong><mark class="hl-own">Paylindo</mark></strong>');
    expect(html).toContain('<mark class="hl-competitor">Stripe</mark>');
  });

  it('zeigt Zitat-Links kompakt und öffnet sie sicher im neuen Tab', () => {
    const html = render('Gut [[1]](https://example.com/a/very/long/path) und [https://www.foo.de/x/y/z](https://www.foo.de/x/y/z).');
    expect(html).toMatch(/<a[^>]*class="md-cite"[^>]*>1<\/a>/);
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/class="md-link md-domain"[^>]*>foo\.de<\/a>/);
  });

  it('rendert kein rohes HTML und keine javascript:-Links', () => {
    const html = render('<script>alert(1)</script>\n\nText <img src=x onerror=alert(1)> [klick](javascript:alert(1)) ![b](https://t.example/p.png)');
    expect(html).not.toMatch(/<script|<img|onerror|javascript:/i);
    expect(html).toContain('klick');
  });
});
