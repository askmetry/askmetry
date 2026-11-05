// Öffentliche Startseite der gehosteten Version. Server-Komponente; einzig das URL-Feld ist ein Client-Baustein.
import type { ReactNode } from 'react';
import { hostedConfig } from '@askmetry/core/hosted/config';
import { getI18n } from '@/lib/i18n/server';
import { CheckForm } from './check-form';
import { formatEuro } from './format';
import { MeasuresPreview, OverviewPreview } from './report-preview';
import { SiteFooter, GITHUB_URL } from './site-footer';
import { SiteHeader } from './site-header';

function Section({ id, title, sub, children, className = '' }: { id?: string; title: string; sub?: string; children: ReactNode; className?: string }) {
  const hid = id ? `${id}-titel` : undefined;
  return (
    <section id={id} aria-labelledby={hid} className={`scroll-mt-20 py-16 sm:py-24 ${className}`}>
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 id={hid} className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2.125rem]">{title}</h2>
          {sub && <p className="mt-3 text-lg text-muted">{sub}</p>}
        </div>
        <div className="mt-10 sm:mt-12">{children}</div>
      </div>
    </section>
  );
}

const Check = ({ className = 'text-good' }: { className?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className={`mt-0.5 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

export async function MarketingHome({ signedIn }: { signedIn: boolean }) {
  const { t: all, locale, f } = await getI18n();
  const t = all.marketing;
  const cfg = hostedConfig();
  const eur = (c: number) => formatEuro(c, locale);
  const price = {
    compact: eur(cfg.priceCents.compact),
    strategy: eur(cfg.priceCents.strategy),
    listCompact: eur(cfg.listPriceCents.compact),
    listStrategy: eur(cfg.listPriceCents.strategy),
    reCompact: eur(cfg.priceCents.remeasure_compact),
    reStrategy: eur(cfg.priceCents.remeasure_strategy),
    baseAndRemeasure: eur(cfg.priceCents.compact + cfg.priceCents.remeasure_compact),
  };
  const from = price.compact;
  const pct = (x: number) => f.pct(x);

  const tiers = [
    { key: 'compact', d: t.pricing.compact, price: price.compact, list: price.listCompact, listCents: cfg.listPriceCents.compact, cents: cfg.priceCents.compact, featured: false },
    { key: 'strategy', d: t.pricing.strategy, price: price.strategy, list: price.listStrategy, listCents: cfg.listPriceCents.strategy, cents: cfg.priceCents.strategy, featured: true },
  ];
  const stepNotes = [t.how.notes.check, t.how.notes.report(from), t.how.notes.remeasure(price.reCompact)];

  // Strukturierte Daten: FAQ und Anbieter (nur Texte, die sichtbar auf der Seite stehen)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'lindotech GmbH', brand: { '@type': 'Brand', name: 'Askmetry' }, url: cfg.publicUrl, address: { '@type': 'PostalAddress', addressLocality: 'Hamburg', addressCountry: 'DE' }, sameAs: [GITHUB_URL] },
      { '@type': 'FAQPage', mainEntity: t.faq.items.map((it) => ({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.a } })) },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <SiteHeader signedIn={signedIn} onHome />
      <main id="inhalt">
        {/* Hero: was es ist, was es kostet, wie man anfängt */}
        <section aria-labelledby="hero-titel" className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_60%_at_70%_0%,var(--accent-soft),transparent)]" />
          <div className="mx-auto grid max-w-[1120px] items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pb-24">
            <div>
              <p className="text-sm font-medium text-accent">{t.hero.eyebrow}</p>
              <h1 id="hero-titel" className="mt-3 text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.025em] text-balance sm:text-[3.25rem]">{t.hero.title}</h1>
              <p className="mt-5 max-w-xl text-lg text-muted text-pretty">{t.hero.sub}</p>
              <div className="mt-8 max-w-xl"><CheckForm id="url-hero" /></div>
              <p className="mt-6 text-[15px] font-medium">{t.hero.priceLine(from)}</p>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
                {t.hero.points.map((p) => <li key={p} className="flex items-center gap-1.5"><Check />{p}</li>)}
              </ul>
            </div>
            <div className="lg:pl-4"><OverviewPreview t={t} pct={pct} /></div>
          </div>
        </section>

        {/* So funktioniert's */}
        <Section id="so-gehts" title={t.how.title} sub={t.how.sub} className="bg-card">
          <ol className="grid gap-5 md:grid-cols-3">
            {t.how.steps.map((s, i) => (
              <li key={s.title} className="rounded-3xl bg-bg p-6">
                <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-accent-fg">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-muted">{s.text}</p>
                <p className="mt-4 text-sm font-medium text-accent">{stepNotes[i]}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Was du bekommst */}
        <Section title={t.get.title} sub={t.get.sub} id="bericht">
          <div className="grid items-start gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
            <ul className="space-y-6">
              {t.get.items.map((it) => (
                <li key={it.title} className="flex gap-3.5">
                  <Check className="text-accent" />
                  <div>
                    <h3 className="text-lg font-semibold">{it.title}</h3>
                    <p className="mt-1 text-muted">{it.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <MeasuresPreview t={t} />
          </div>
        </Section>

        {/* Preise */}
        <Section id="preise" title={t.pricing.title} sub={t.pricing.sub} className="bg-card">
          <div className="grid gap-5 md:grid-cols-2">
            {tiers.map((tier) => (
              <article key={tier.key} aria-labelledby={`tier-${tier.key}`}
                className={`relative flex flex-col rounded-3xl p-6 sm:p-8 ${tier.featured ? 'bg-bg ring-2 ring-accent' : 'bg-bg'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={`tier-${tier.key}`} className="text-lg font-semibold">{tier.d.name}</h3>
                  {tier.featured && <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg">{t.pricing.popular}</span>}
                </div>
                <p className="mt-1 text-muted">{tier.d.for}</p>
                <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[2.75rem] font-semibold leading-none tracking-tight">{tier.price}</span>
                  <span className="text-sm text-muted">{t.pricing.net}</span>
                </div>
                {tier.listCents > tier.cents && (
                  <p className="mt-2 text-sm">
                    <span className="rounded-md bg-comp-soft px-1.5 py-0.5 font-medium text-warn">{t.pricing.beta}</span>{' '}
                    <span className="text-muted">{t.pricing.instead(tier.list)}</span>
                  </p>
                )}
                <ul className="mt-6 flex-1 space-y-2.5">
                  {tier.d.features.map((x) => <li key={x} className="flex gap-2.5"><Check />{x}</li>)}
                </ul>
                <a href="#start" className={`btn mt-8 h-11 justify-center text-[15px] ${tier.featured ? 'btn-primary' : ''}`}>{t.pricing.cta}</a>
              </article>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-2 rounded-3xl bg-bg p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" /></svg>
              </span>
              <h3 className="text-lg font-semibold">{t.pricing.remeasure.title}</h3>
            </div>
            <p className="text-muted sm:flex-1">{t.pricing.remeasure.text(price.reCompact, price.reStrategy)}</p>
          </div>

          <div className="mt-10">
            <h3 className="text-lg font-semibold">{t.pricing.compare.title}</h3>
            <dl className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {[
                { k: t.pricing.compare.agency, v: t.pricing.compare.agencyPrice, us: false },
                { k: t.pricing.compare.tool, v: t.pricing.compare.toolPrice, us: false },
                { k: t.pricing.compare.us, v: t.pricing.compare.usPrice(price.baseAndRemeasure), us: true },
              ].map((r) => (
                <div key={r.k} className={`flex flex-col gap-0.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between ${r.us ? 'bg-accent-soft' : ''}`}>
                  <dt className={r.us ? 'font-semibold' : 'text-muted'}>{r.k}</dt>
                  <dd className={r.us ? 'font-semibold text-accent' : 'font-medium'}>{r.v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 max-w-3xl text-sm text-muted">{t.pricing.compare.note} {t.pricing.compare.source}</p>
          </div>
          <p className="mt-8 text-sm text-muted">{t.pricing.legal} {t.pricing.ctaNote}</p>
        </Section>

        {/* Ehrlich gemessen */}
        <Section id="methode" title={t.honest.title} sub={t.honest.sub}>
          <div className="grid gap-x-10 gap-y-9 md:grid-cols-2">
            {t.honest.points.map((p, i) => (
              <div key={p.title} className="flex gap-4">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {[
                      <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
                      <path d="M3 17l5-6 4 4 4-7 5 9" />,
                      <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
                      <path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z" />,
                    ][i]}
                  </svg>
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{p.title}</h3>
                  <p className="mt-1.5 text-muted">{p.text}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-10 text-sm text-muted">{t.honest.notYet}</p>
        </Section>

        {/* Gehostet in Deutschland · Open Source */}
        <section aria-labelledby="vertrauen-titel" className="pb-16 sm:pb-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <h2 id="vertrauen-titel" className="sr-only">{t.trust.title}</h2>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
                <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden fill="none" stroke="var(--fg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
                <h3 className="mt-3 text-lg font-semibold">{t.trust.hosting.title}</h3>
                <p className="mt-2 text-muted">{t.trust.hosting.text}</p>
                <a href="/avv" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">{t.trust.hosting.avv} →</a>
              </div>
              <div className="rounded-3xl bg-card p-6 shadow-card sm:p-8">
                <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden fill="none" stroke="var(--fg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></svg>
                <h3 className="mt-3 text-lg font-semibold">{t.trust.oss.title}</h3>
                <p className="mt-2 text-muted">{t.trust.oss.text}</p>
                <a href={GITHUB_URL} target="_blank" rel="noopener" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">{t.trust.oss.link} ↗</a>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <Section id="faq" title={t.faq.title} className="bg-card">
          <div className="max-w-3xl divide-y divide-border border-y border-border">
            {t.faq.items.map((it) => (
              <details key={it.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-4 text-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
                  <h3>{it.q}</h3>
                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-muted transition group-open:rotate-45">+</span>
                </summary>
                <p className="pb-5 pr-10 text-muted">{it.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* Abschluss */}
        <section id="start" aria-labelledby="start-titel" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
            <div className="mx-auto max-w-2xl rounded-[2rem] bg-card px-5 py-10 text-center shadow-card sm:px-12 sm:py-14">
              <h2 id="start-titel" className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2.125rem]">{t.final.title}</h2>
              <p className="mt-3 text-lg text-muted">{t.final.sub}</p>
              <div className="mt-8 text-left"><CheckForm id="url-final" size="md" tone="onCard" /></div>
              <p className="mt-5 text-sm text-muted">{t.hero.priceLine(from)}</p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
