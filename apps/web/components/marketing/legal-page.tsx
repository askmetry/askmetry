import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, ElementContent, Root } from 'hast';
import { isHosted, publicUrl } from '@askmetry/core/hosted/config';
import type { Locale } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { getSession } from '@/lib/session';
import { extractToc, idMaker, splitTitle, stripComments, type LegalDoc } from './legal-markdown';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

const DIR = path.join(process.cwd(), 'content', 'legal');

async function read(doc: LegalDoc, locale: Locale): Promise<string | null> {
  try { return await readFile(path.join(DIR, `${doc}.${locale}.md`), 'utf8'); } catch { return null; }
}

/** Text in der UI-Sprache, sonst Deutsch (mit Hinweis), sonst null → Platzhalter. */
async function load(doc: LegalDoc, locale: Locale) {
  const own = await read(doc, locale);
  if (own !== null) return { md: own, germanOnly: false };
  const de = locale === 'de' ? null : await read(doc, 'de');
  return de !== null ? { md: de, germanOnly: true } : null;
}

const textOf = (n: ElementContent | Root): string =>
  n.type === 'text' ? n.value : 'children' in n ? (n.children as ElementContent[]).map(textOf).join('') : '';

/** rehype: IDs für h2/h3 (gleiche Reihenfolge und Regeln wie extractToc), externe Links in neuem Tab. */
function rehypeLegal() {
  return (tree: Root) => {
    const id = idMaker();
    const walk = (n: Root | Element) => {
      for (const c of n.children) {
        if (c.type !== 'element') continue;
        if (c.tagName === 'h2' || c.tagName === 'h3') c.properties = { ...c.properties, id: id(textOf(c)) };
        if (c.tagName === 'a' && /^https?:/.test(String(c.properties?.href ?? ''))) c.properties = { ...c.properties, target: '_blank', rel: ['noopener'] };
        if (c.tagName === 'table') {
          // Tabellen horizontal scrollbar (mobil)
          const table: Element = { ...c };
          c.tagName = 'div'; c.properties = { className: ['md-table'] }; c.children = [table];
          continue;
        }
        walk(c);
      }
    };
    walk(tree);
  };
}

/** Noch nicht freigegebener Entwurf (deutsche Fassung beginnt mit „<!-- ENTWURF“)? Dann nicht indexieren. */
export async function isLegalDraft(doc: LegalDoc): Promise<boolean> {
  const de = await read(doc, 'de');
  return de === null || /<!--\s*ENTWURF/i.test(de);
}

export async function legalMetadata(doc: LegalDoc): Promise<Metadata> {
  if (!isHosted()) return {};
  const [{ t }, draft] = await Promise.all([getI18n(), isLegalDraft(doc)]);
  return {
    metadataBase: new URL(publicUrl()),
    title: t.legal.titles[doc],
    description: t.legal.descriptions[doc],
    alternates: { canonical: `/${doc}` },
    robots: { index: !draft, follow: true },
  };
}

/** Schlichtes Lese-Layout für Impressum, Datenschutz, AGB, AVV, Unterauftragnehmer. Nur gehostet, sonst 404. */
export async function LegalPage({ doc }: { doc: LegalDoc }) {
  if (!isHosted()) notFound();
  const [{ t, locale }, session] = await Promise.all([getI18n(), getSession()]);
  const loaded = await load(doc, locale);
  const { title, body } = loaded ? splitTitle(stripComments(loaded.md)) : { title: null, body: '' };
  const toc = loaded ? extractToc(body) : [];
  const showToc = toc.length >= 4;
  return (
    <>
      <SiteHeader signedIn={!!session} />
      <main id="inhalt" className="mx-auto max-w-[1120px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        <Link href="/" className="text-sm text-muted hover:text-fg">← {t.legal.back}</Link>
        <div className={`mt-6 ${showToc ? 'lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14' : ''}`}>
          {showToc && (
            <nav aria-label={t.legal.toc} className="mb-8 lg:mb-0">
              <details className="rounded-2xl bg-card p-4 shadow-card lg:hidden">
                <summary className="cursor-pointer text-sm font-semibold">{t.legal.toc}</summary>
                <ol className="mt-3 space-y-1.5 text-sm">
                  {toc.map((h) => <li key={h.id}><a href={`#${h.id}`} className="text-muted hover:text-fg">{h.text}</a></li>)}
                </ol>
              </details>
              <div className="hidden lg:sticky lg:top-24 lg:block">
                <p className="text-sm font-semibold">{t.legal.toc}</p>
                <ol className="mt-3 max-h-[calc(100vh-8rem)] space-y-1.5 overflow-y-auto text-sm">
                  {toc.map((h) => <li key={h.id}><a href={`#${h.id}`} className="text-muted hover:text-fg">{h.text}</a></li>)}
                </ol>
              </div>
            </nav>
          )}
          <article className="min-w-0 max-w-[72ch]">
            <h1 className="text-[2rem] font-semibold leading-tight tracking-tight">{title ?? t.legal.titles[doc]}</h1>
            {loaded?.germanOnly && <p lang="en" className="mt-3 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm">{t.legal.germanOnly}</p>}
            {loaded && body.trim() ? (
              <div className="legal-md mt-6" lang={loaded.germanOnly ? 'de' : undefined}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeLegal]} skipHtml>{body}</ReactMarkdown>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl bg-card p-6 shadow-card">
                <p className="text-lg font-semibold">{t.legal.placeholder}</p>
                <p className="mt-1 text-muted">{t.legal.placeholderText}</p>
              </div>
            )}
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
