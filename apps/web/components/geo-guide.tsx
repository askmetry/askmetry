// Kurzleitfaden GEO als aufklappbare Liste (Server-Komponente). Inhalt aus @askmetry/core/guide, Rahmentexte aus t.guide.
import { sourceNumbers, type Guide } from '@askmetry/core/guide';
import type { Messages } from '@/lib/i18n/messages';
import { OpenOnHash } from './open-on-hash';

/** Strukturierte Daten (FAQPage) aus genau den sichtbaren Texten. */
export function guideJsonLd(guide: Guide) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: guide.lang,
    mainEntity: guide.entries.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: { '@type': 'Answer', text: e.answer.map((b) => (b.kind === 'p' ? b.text : b.items.join(' '))).join('\n\n') },
    })),
  };
}

export function GeoGuide({ guide, t, headingLevel = 'h2' }: { guide: Guide; t: Messages['guide']; headingLevel?: 'h2' | 'h3' }) {
  const H = headingLevel;
  return (
    <div className="max-w-3xl">
      <OpenOnHash />
      <div className="divide-y divide-border border-y border-border">
        {guide.entries.map((e) => {
          const nums = sourceNumbers(guide, e);
          return (
            <details key={e.id} id={e.id} className="group scroll-mt-24 py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-4 text-[17px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
                <H>{e.question}</H>
                <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-muted transition group-open:rotate-45">+</span>
              </summary>
              <div className="space-y-3 pb-5 pr-2 text-[15px] leading-relaxed sm:pr-10">
                {e.answer.map((b, i) => b.kind === 'p'
                  ? <p key={i}>{b.text}</p>
                  : (
                    <ul key={i} className="list-disc space-y-1.5 pl-5">
                      {b.items.map((it) => <li key={it}>{it}</li>)}
                    </ul>
                  ))}
                {nums.length > 0 && (
                  <p className="text-[13px] text-muted">
                    {t.entrySources}{' '}
                    {nums.map((n) => <a key={n} href={`#quelle-${n}`} className="mr-1 text-accent hover:underline">[{n}]</a>)}
                  </p>
                )}
              </div>
            </details>
          );
        })}
      </div>

      <section aria-labelledby="leitfaden-zahlen" className="mt-12">
        <h2 id="leitfaden-zahlen" className="text-[17px] font-semibold">{t.caveatTitle}</h2>
        <p className="mt-2 text-[15px] text-muted">{guide.caveat}</p>
      </section>

      <section aria-labelledby="leitfaden-quellen" className="mt-8">
        <h2 id="leitfaden-quellen" className="text-[17px] font-semibold">{t.sourcesTitle}</h2>
        <ol className="mt-3 space-y-1.5 text-[13px] text-muted">
          {guide.sources.map((s, i) => (
            <li key={s.id} id={`quelle-${i + 1}`} className="flex gap-2">
              <span className="w-6 shrink-0 tabular-nums">[{i + 1}]</span>
              <span className="min-w-0">
                <a href={s.url} target="_blank" rel="noopener" className="break-words text-fg hover:underline">{s.label}</a>
                <span> · {s.date}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
