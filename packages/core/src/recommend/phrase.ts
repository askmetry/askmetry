// Formulierung der Maßnahmen. Die Regeln liefern bereits verständliche deutsche Standardtexte (Fallback);
// optional verbessert Claude Haiku die Texte – je Aufruf höchstens PHRASE_BATCH_SIZE Maßnahmen (Batching in index.ts).
import Anthropic from '@anthropic-ai/sdk';
import { engineDefaults, prices } from '../engine-config.ts';
import { isMockMode } from '../engines/index.ts';
import { costFromUsage } from '../pricing.ts';
import { sha } from '../util.ts';
import { normalizeDomain } from '../domains.ts';
import { engineLabel } from './data.ts';
import type { Candidate } from './rules.ts';

export interface PhraseText { title: string; why: string; steps: string[] }
export interface PhraseResult {
  texts: Map<string, PhraseText>; costUsd: number; model: string | null; error?: string;
  /** Ausgabe wegen max_tokens abgeschnitten → mit kleinerem Batch erneut versuchen */
  truncated?: boolean;
}
export type Phraser = (items: Candidate[], ctx: PhraseContext) => Promise<PhraseResult>;
export interface PhraseContext { brandName: string; brandDescription?: string | null; domains: string[]; year: number }

/** Version von Prompt/Standardtexten je Typ – erhöhen, wenn diese Maßnahmen neu formuliert werden sollen. */
export const PHRASE_VERSION: Record<string, number> = { default: 5, content_gap: 6 };
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
  const { promptIds: _p, competitorId: _c, ...ev } = c.evidence as Record<string, unknown>;
  const ex = (c.evidence.examples ?? []).map((e) => ({ ...e, engine: engineLabel(e.engine) }));
  return { ...ev, examples: ex };
}

const TYPE_HINTS: Record<string, string> = {
  name_on_own_page: 'Eigene Seiten werden als Quelle genutzt, die Marke aber nicht genannt → Marke einmal im ersten Absatz mit Kategorie verknüpfen, eigene Daten/Rechner mit Markennamen benennen. KEIN Markenname in jeder Überschrift oder jedem Titel (unbelegt, wirkt wie Keyword-Stuffing).',
  outreach: 'Drittseite wird bei Wettbewerber-Antworten zitiert. evidence.sourceKind bestimmt die realistische Ansprache: reviews = Profil anlegen und Kunden um Bewertungen bitten; comparison = Listung als Anbieter beantragen (Formular, Partner-/Affiliate-Programm); media = Redaktion eigene Daten oder ein Experten-Zitat anbieten (Digital PR, Erfolg unsicher); site = Autor Fakten bzw. Daten anbieten. Nie vorschlagen, einen Wettbewerber um Nennung zu bitten.',
  content_gap: 'Für diese Frage fehlt eine eigene Seite bzw. sie wird nicht genutzt → Seite erstellen/ausbauen, Titelvorschlag machen.',
  community: 'Reddit/YouTube/Foren werden von den KIs gelesen → transparent und hilfreich mitdiskutieren (kein Astroturfing) oder eigene Videos.',
  technical: 'Technischer Befund aus dem Website-Check.',
  positioning: 'Wettbewerber wird häufiger vor der eigenen Marke empfohlen → Gründe der KIs aufgreifen, eigene Stärken klar dagegensetzen.',
  sentiment: 'Negative Aussagen über die eigene Marke → prüfen, richtigstellen.',
};

let client: Anthropic | undefined;

/**
 * Texte mit Claude Haiku verbessern (strukturierte Ausgabe). Wirft nicht: bei Fehlern leere Map + error (dann gelten die Standardtexte).
 */
/** Höchstens so viele Maßnahmen je KI-Aufruf (die wichtigsten zuerst). */
export const PHRASE_BATCH_SIZE = 12;
/** Ausgabe-Obergrenze je Aufruf, abhängig von der Zahl der Maßnahmen. */
export const phraseMaxTokens = (n: number) => Math.min(16_000, 1_000 + 1_100 * n);

const payloadOf = (items: Candidate[]) => items.map((c) => ({
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
      content: `Du formulierst Maßnahmen für eine Marketingperson (ohne Technikwissen), die die Sichtbarkeit der Marke „${ctx.brandName}“ in KI-Antworten (ChatGPT, Gemini, Claude, Google AI Overviews/AI Mode) verbessern will.
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
</massnahmen>`,
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
    const t = sanitize(it, items.find((c) => c.key === it.key)!);
    if (t) texts.set(it.key, t);
  }
  return { texts, costUsd, model: res.model ?? model };
};

/** Plausibilitätsprüfung der KI-Texte; bei Problemen null (dann bleibt der Standardtext). */
export function sanitize(t: { title?: unknown; why?: unknown; steps?: unknown }, c: Candidate): PhraseText | null {
  const title = typeof t.title === 'string' ? t.title.trim() : '';
  const why = typeof t.why === 'string' ? t.why.trim() : '';
  const steps = Array.isArray(t.steps) ? t.steps.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim()) : [];
  if (title.length < 8 || title.length > 90 || why.length < 20 || steps.length < Math.min(2, c.steps.length)) return null;
  // du-Form: „Sie“/„Ihr(e)“ als Anrede → verwerfen (nicht am Satzanfang als „sie“ = Plural erkennbar, daher nur eindeutige Formen)
  if (/\b(Ihnen|Ihre[mnrs]?|Ihr)\b|\b[A-Za-zäöüß]+en Sie\b/.test([title, why, ...steps].join(' '))) return null;
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
