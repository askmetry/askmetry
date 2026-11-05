// Formulierung der Maßnahmen. Die Regeln liefern bereits verständliche Standardtexte (Fallback, Deutsch und Englisch);
// optional verbessert Claude Haiku die Texte – je Aufruf höchstens PHRASE_BATCH_SIZE Maßnahmen (Batching in index.ts).
// Die KI schreibt in der Workspace-Sprache (`ctx.lang` = workspace.language).
import Anthropic from '@anthropic-ai/sdk';
import { engineDefaults, prices } from '../engine-config.ts';
import { isMockMode } from '../engines/index.ts';
import { costFromUsage } from '../pricing.ts';
import { sha } from '../util.ts';
import { normalizeDomain } from '../domains.ts';
import { engineLabel } from './data.ts';
import type { Candidate } from './rules.ts';
import type { Lang } from '../i18n.ts';

export interface PhraseText { title: string; why: string; steps: string[] }
export interface PhraseResult {
  texts: Map<string, PhraseText>; costUsd: number; model: string | null; error?: string;
  /** Ausgabe wegen max_tokens abgeschnitten → mit kleinerem Batch erneut versuchen */
  truncated?: boolean;
}
export type Phraser = (items: Candidate[], ctx: PhraseContext) => Promise<PhraseResult>;
export interface PhraseContext {
  brandName: string; brandDescription?: string | null; domains: string[]; year: number;
  /** Sprache der KI-Texte (workspace.language), Standard 'de' */
  lang?: Lang;
}

/** Version von Prompt/Standardtexten je Typ – erhöhen, wenn diese Maßnahmen neu formuliert werden sollen. */
export const PHRASE_VERSION: Record<string, number> = { default: 5, content_gap: 7, comparison: 6 };
export const phraseVersion = (type: string) => PHRASE_VERSION[type] ?? PHRASE_VERSION.default;

/** Hash der Kernzahlen: ändert er sich, wird neu formuliert. */
export const signatureHash = (c: Pick<Candidate, 'key' | 'signature'>) => sha(JSON.stringify([c.key, c.signature]), 16);

/** Kann die KI-Formulierung laufen? (nicht im Mock-Modus, nur mit ANTHROPIC_API_KEY) */
export function llmAvailable(): boolean {
  return !isMockMode() && !!process.env.ANTHROPIC_API_KEY;
}

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'why', 'steps'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          why: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

/** Evidenz kompakt für das Modell (keine IDs, gekürzte Listen). */
function compactEvidence(c: Candidate) {
  // keine IDs; Texte in anderen Sprachen (…ByLang) gehen nicht an die KI
  const { promptIds: _p, competitorId: _c, texts: _t, redirectsByLang: _r, consequenceByLang: _q, facetsByLang: _f, ...ev } = c.evidence as Record<string, unknown>;
  const ex = (c.evidence.examples ?? []).map((e) => ({ ...e, engine: engineLabel(e.engine) }));
  return { ...ev, examples: ex };
}

const TYPE_HINTS: Record<string, string> = {
  name_on_own_page: 'Eigene Seiten werden als Quelle genutzt, die Marke aber nicht genannt → Marke einmal im ersten Absatz mit Kategorie verknüpfen, eigene Daten/Rechner mit Markennamen benennen. KEIN Markenname in jeder Überschrift oder jedem Titel (unbelegt, wirkt wie Keyword-Stuffing).',
  outreach: 'Drittseite wird bei Wettbewerber-Antworten zitiert. evidence.sourceKind bestimmt die realistische Ansprache: reviews = Profil anlegen und Kunden um Bewertungen bitten; comparison = Listung als Anbieter beantragen (Formular, Partner-/Affiliate-Programm); media = Redaktion eigene Daten oder ein Experten-Zitat anbieten (Digital PR, Erfolg unsicher); site = Autor Fakten bzw. Daten anbieten. Nie vorschlagen, einen Wettbewerber um Nennung zu bitten.',
  content_gap: 'Themen-Cluster: EINE Themenseite deckt mehrere getestete Fragen ab (evidence.prompts). Nie je Frage eine eigene Seite vorschlagen; die Fragen sind eine Stichprobe dessen, was Kunden fragen → nach Aspekten (evidence.facets) gliedern, Titelvorschlag machen.',
  comparison: 'Eigene, transparente Vergleichs-/Alternativenseiten (Übersicht + je Wettbewerber aus evidence.targets) decken alle Vergleichsfragen ab. Fair, mit Absender und Datum; keine verdeckten Vergleichsdomains.',
  listicle: 'Fremde Bestenlisten/Vergleichsartikel (evidence.urls), die die KIs zitieren und in denen Wettbewerber stehen → Autor Fakten anbieten; bezahlte Platzierung nur gekennzeichnet.',
  reviews: 'Bewertungsportale (evidence.domains) als KI-Quelle → Profil vollständig pflegen, Kunden um ehrliche Bewertungen bitten; keine gekauften Bewertungen.',
  entity: 'Wikidata/Wikipedia: Wikidata-Eintrag mit Belegen und Offenlegung; keinen Wikipedia-Artikel über die eigene Firma vorschlagen. Wirkung unsicher – so sagen.',
  community: 'Reddit/YouTube/Foren werden von den KIs gelesen → transparent und hilfreich mitdiskutieren (kein Astroturfing) oder eigene Videos.',
  technical: 'Technischer Befund aus dem Website-Check.',
  positioning: 'Wettbewerber wird häufiger vor der eigenen Marke empfohlen → Gründe der KIs aufgreifen, eigene Stärken klar dagegensetzen.',
  sentiment: 'Negative Aussagen über die eigene Marke → prüfen, richtigstellen.',
};

const promptDe = (ctx: PhraseContext, payload: unknown) => `Du formulierst Maßnahmen für eine Marketingperson (ohne Technikwissen), die die Sichtbarkeit der Marke „${ctx.brandName}“ in KI-Antworten (ChatGPT, Gemini, Claude, Google AI Overviews/AI Mode) verbessern will.
Website(s): ${ctx.domains.join(', ') || '–'}${ctx.brandDescription ? `\nBeschreibung der Marke: ${ctx.brandDescription}` : ''}
Die Marke kann ein Anbieter, ein Vergleichsportal oder ein Dienstleister sein – leite das nur aus Beschreibung und Belegen ab (z. B. eigene URLs), sonst neutral formulieren. Stand: ${ctx.year}.

Für jede Maßnahme gibt es einen Entwurf (draft) und Belege (evidence). Der Entwurf ist nur eine Vorlage – mache die Texte spezifischer, statt ihn zu wiederholen. Überarbeite title, why und steps:
- title: eine Handlungsanweisung als Verb-Satz (z. B. „… ausbauen“, „… anschreiben“), konkret, höchstens 70 Zeichen, mit dem Gegenstand (Domain, Subreddit, Frage, Wettbewerber). Bei content_gap ist der title die Aufgabe (z. B. „Ratgeber zu ‚Kauf oder Miete‘ ausbauen“), nicht der vorgeschlagene Seitentitel – der gehört in die steps.
- why: genau EIN Satz, höchstens 140 Zeichen, mit der wichtigsten Zahl aus den Belegen (z. B. „in 7 von 50 Antworten“). Keine URLs und keine Pfade im why (die stehen in den Belegen). Grammatisch korrekt (z. B. „kein einziges Mal“, „nie“, „nur 2-mal“). Keine Übertreibung.
- steps: 3–5 konkrete, umsetzbare Schritte in sinnvoller Reihenfolge, je höchstens 2 Sätze. Nenne konkrete Seiten/Threads/Prompts aus den Belegen, wo es hilft. Seiten immer genau als Kurzpfad wie im Entwurf schreiben (z. B. „paylindo.de/ratgeber/kosten“) bzw. Subreddits als „r/Name“ – die App macht daraus Links. Nicht umschreiben (nicht „den Kosten-Ratgeber“ statt des Pfads).
  Werte die Ausschnitte (examples[].snippet) aus: Welche Kriterien und Argumente nennen die KIs (z. B. Gebühren, Vertragslaufzeit, Zielgruppe, Funktionen)? Greife sie in den Schritten konkret auf („Kriterien abdecken, die die KIs nennen: …“).
  content_gap: einen besseren, natürlichen Titelvorschlag für die Seite (H1) machen und die Gliederung der Seite in 3–4 Stichpunkten skizzieren. positioning: die Gründe aus den Ausschnitten nennen und sagen, welche Belege die eigene Marke dagegensetzen sollte. outreach: sagen, worauf die Ansprache inhaltlich zielen sollte (welche Seite, welcher Vergleich).
  Technik (strukturierte Daten/JSON-LD/Schema, robots.txt, llms.txt, Rendering) gehört NUR in Maßnahmen vom Typ technical – in allen anderen Typen keine solchen Schritte.
Realismus (belegte GEO-Praxis): Nur Schritte, die ein kleines Team wirklich umsetzen kann. Nicht vorschlagen: Wettbewerber um Nennung bitten, Markennamen in jeden Titel schreiben, llms.txt, FAQ-/Schema-Markup als Zitations-Hebel, Keyword-Stuffing, Wikipedia-Artikel über die eigene Firma.
Regeln: Nichts erfinden – keine Zahlen, Fakten, Preise oder Eigenschaften der Marke, die nicht in den Belegen stehen. Keine URLs erfinden, nur URLs aus den Belegen verwenden. Keine Werbung, kein Astroturfing (Reddit/Foren: transparent als Anbieter auftreten). Deutsch mit korrekten Umlauten, durchgehend du-Form (Imperativ oder Infinitiv, nie „Sie“/„Ihr“), sachlich. Wenn eine Wirkung unsicher ist (z. B. Medienansprache), das ehrlich sagen.
Gib für jeden key genau ein Element zurück (gleicher key).

<massnahmen>
${JSON.stringify(payload, null, 1)}
</massnahmen>`;

const promptEn = (ctx: PhraseContext, payload: unknown) => `You are writing action items for a marketing person (no technical background) who wants to improve the visibility of the brand “${ctx.brandName}” in AI answers (ChatGPT, Gemini, Claude, Google AI Overviews/AI Mode).
Website(s): ${ctx.domains.join(', ') || '–'}${ctx.brandDescription ? `\nBrand description: ${ctx.brandDescription}` : ''}
The brand may be a provider, a comparison site or a service business – infer this only from the description and the evidence (e.g. its own URLs); otherwise stay neutral. As of: ${ctx.year}.

Each action has a draft and evidence. The draft is only a template – make the texts more specific instead of repeating it. Rewrite title, why and steps in English:
- title: an instruction phrased as an imperative (e.g. “Expand …”, “Contact …”), concrete, at most 70 characters, naming the subject (domain, subreddit, question, competitor). For content_gap the title is the task (e.g. “Expand the guide on ‘buy or rent’”), not the suggested page title – that belongs in the steps.
- why: exactly ONE sentence, at most 140 characters, with the most important number from the evidence (e.g. “in 7 of 50 answers”). No URLs and no paths in why (they are in the evidence). Grammatically correct. No exaggeration.
- steps: 3–5 concrete, actionable steps in a sensible order, at most 2 sentences each. Name specific pages/threads/prompts from the evidence where it helps. Always write pages exactly as a short path as in the draft (e.g. “paylindo.de/ratgeber/kosten”) and subreddits as “r/Name” – the app turns them into links. Don’t paraphrase them (not “the cost guide” instead of the path).
  Evaluate the snippets (examples[].snippet): which criteria and arguments do the AIs mention (e.g. fees, contract length, target group, features)? Address them concretely in the steps (“Cover the criteria the AIs mention: …”).
  content_gap: suggest a better, natural title for the page (H1) and outline the page in 3–4 bullet points. positioning: name the reasons from the snippets and say what evidence the brand should put against them. outreach: say what the outreach should focus on (which page, which comparison).
  Technical topics (structured data/JSON-LD/schema, robots.txt, llms.txt, rendering) belong ONLY in actions of type technical – no such steps in any other type.
Realism (proven GEO practice): only steps a small team can really carry out. Never suggest: asking competitors to mention you, putting the brand name in every title, llms.txt, FAQ/schema markup as a citation lever, keyword stuffing, a Wikipedia article about your own company.
Rules: Invent nothing – no numbers, facts, prices or brand properties that aren’t in the evidence. Don’t invent URLs; only use URLs from the evidence. No advertising, no astroturfing (Reddit/forums: participate transparently as the vendor). Natural, plain English addressing the reader as “you” (imperatives), factual. If an effect is uncertain (e.g. media outreach), say so honestly.
Return exactly one item per key (same key).

<actions>
${JSON.stringify(payload, null, 1)}
</actions>`;

let client: Anthropic | undefined;

/**
 * Texte mit Claude Haiku verbessern (strukturierte Ausgabe). Wirft nicht: bei Fehlern leere Map + error (dann gelten die Standardtexte).
 */
/** Höchstens so viele Maßnahmen je KI-Aufruf (die wichtigsten zuerst). */
export const PHRASE_BATCH_SIZE = 12;
/** Ausgabe-Obergrenze je Aufruf, abhängig von der Zahl der Maßnahmen. */
export const phraseMaxTokens = (n: number) => Math.min(16_000, 1_000 + 1_100 * n);

export const payloadOf = (items: Candidate[]) => items.map((c) => ({
  key: c.key, type: c.type, hint: TYPE_HINTS[c.type], impact: c.impact, effort: c.effort,
  draft: { title: c.title, why: c.why, steps: c.steps },
  evidence: compactEvidence(c),
}));

/**
 * Obergrenze der Kosten eines Aufrufs für die Budgetprüfung: geschätzte Eingabe (Prompt + Belege, ~3 Zeichen je Token, großzügig)
 * plus volle max_tokens als Ausgabe.
 */
export function estimatePhraseCost(items: Candidate[]): number {
  if (!items.length) return 0;
  const p = (prices as Record<string, { input: number; output: number }>)[engineDefaults.analyzer.model] ?? { input: 1, output: 5 };
  const inputTokens = 2_500 + Math.ceil(JSON.stringify(payloadOf(items)).length / 3);
  return (inputTokens * p.input + phraseMaxTokens(items.length) * p.output) / 1e6;
}

export const phraseWithLlm: Phraser = async (items, ctx) => {
  if (!items.length) return { texts: new Map(), costUsd: 0, model: null };
  client ??= new Anthropic({ maxRetries: 1, timeout: 60_000 });
  const model = engineDefaults.analyzer.model;
  const payload = payloadOf(items);
  const params: any = {
    model,
    max_tokens: phraseMaxTokens(items.length),
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{
      role: 'user',
      content: (ctx.lang === 'en' ? promptEn : promptDe)(ctx, payload),
    }],
  };
  let res: any;
  try {
    res = await client.messages.create(params);
  } catch (e) {
    return { texts: new Map(), costUsd: 0, model, error: ((e as Error)?.message ?? String(e)).slice(0, 300) };
  }
  const costUsd = costFromUsage({ engine: 'analyzer', model: res.model ?? model, usage: res.usage });
  if (res.stop_reason === 'max_tokens') return { texts: new Map(), costUsd, model: res.model ?? model, error: 'Ausgabe abgeschnitten (max_tokens)', truncated: true };
  const text = res.content?.find((b: any) => b.type === 'text')?.text;
  if (!text || res.stop_reason === 'refusal') return { texts: new Map(), costUsd, model: res.model ?? model, error: `keine Ausgabe (stop_reason: ${res.stop_reason})` };
  let parsed: { items: { key: string; title: string; why: string; steps: string[] }[] };
  try { parsed = JSON.parse(text); } catch (e) {
    return { texts: new Map(), costUsd, model: res.model ?? model, error: `ungültiges JSON (${(e as Error).message})` };
  }
  const keys = new Set(items.map((c) => c.key));
  const texts = new Map<string, PhraseText>();
  for (const it of parsed.items ?? []) {
    if (!keys.has(it.key) || texts.has(it.key)) continue;
    const t = sanitize(it, items.find((c) => c.key === it.key)!, ctx.lang ?? 'de');
    if (t) texts.set(it.key, t);
  }
  return { texts, costUsd, model: res.model ?? model };
};

/** Plausibilitätsprüfung der KI-Texte; bei Problemen null (dann bleibt der Standardtext). */
export function sanitize(t: { title?: unknown; why?: unknown; steps?: unknown }, c: Candidate, lang: Lang = 'de'): PhraseText | null {
  const title = typeof t.title === 'string' ? t.title.trim() : '';
  const why = typeof t.why === 'string' ? t.why.trim() : '';
  const steps = Array.isArray(t.steps) ? t.steps.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()) : [];
  if (title.length < 8 || title.length > 90 || why.length < 20 || steps.length < Math.min(2, c.steps.length)) return null;
  // du-Form: „Sie“/„Ihr(e)“ als Anrede → verwerfen (nicht am Satzanfang als „sie“ = Plural erkennbar, daher nur eindeutige Formen)
  if (lang === 'de' && /\b(Ihnen|Ihre[mnrs]?|Ihr)\b|\b[A-Za-zäöüß]+en Sie\b/.test([title, why, ...steps].join(' '))) return null;
  // Technik-Schritte nur in technischen Maßnahmen
  if (c.type !== 'technical' && steps.some((x) => /JSON-LD|Schema\.org|[A-Za-z]+-Schema\b|robots\.txt|llms\.txt/i.test(x))) return null;
  // keine erfundenen URLs/Domains: jeder Host im Text muss (als Domain oder Subdomain) in Entwurf oder Belegen vorkommen
  const hostsIn = (text: string) => {
    const out = new Set<string>();
    for (const m of text.matchAll(/https?:\/\/([^\s/)»“”"'?#:]+)/gi)) out.add(m[1]);
    for (const m of text.matchAll(/(?<![@\w.-])((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[\s/),.;:!?»“”"']|$)/gi)) out.add(m[1]);
    return [...out].map((h) => normalizeDomain(h)).filter((h): h is string => !!h && /\.[a-z]{2,}$/.test(h) && !/\.(ts|js|txt|json|md|php|html?)$/.test(h));
  };
  const known = hostsIn(JSON.stringify([c.title, c.why, c.steps, c.evidence]).replace(/\\\//g, '/'));
  for (const h of hostsIn([title, why, ...steps].join(' '))) {
    if (!known.some((k) => h === k || h.endsWith(`.${k}`) || k.endsWith(`.${h}`))) return null;
  }
  // Kurzbegründung: ein Satz ≤ 140 Zeichen ohne URLs – sonst die Regel-Begründung
  const whyOk = why.length <= 140 && !/https?:\/\/|www\.|\b[a-z0-9-]+\.(de|com|org|net|io)\/\S/i.test(why) && !/[.!?]\s+\S/.test(why.replace(/\b(z|d|u|v|bzw|ca|inkl|ggf|Nr)\.\s/g, '$1 '));
  return { title: title.length > 70 ? c.title : title, why: whyOk ? why : c.why, steps: steps.slice(0, 5) };
}
