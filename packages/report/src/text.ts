// Texte und Formatierung des PDF-Berichts (DE/EN). Rein, ohne DB.
import { engineName, listJoin, type Lang } from '@askmetry/core/present';
import type { ReportKind, ReportModel, ReportTier } from './data.ts';

const NB = ' ';

export const fmt = (lang: Lang) => {
  const loc = lang === 'en' ? 'en-US' : 'de-DE';
  const en = lang === 'en';
  return {
    pct: (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(x * 100)}${en ? '' : NB}%`),
    /** Prozentpunkte mit Vorzeichen */
    pp: (x: number | null | undefined) => {
      if (x == null || !Number.isFinite(x)) return '–';
      const v = Math.round(x * 100);
      const s = v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '±0';
      return en ? `${s}${NB}pts` : `${s}${NB}Pp.`;
    },
    num: (x: number | null | undefined, digits = 1) => (x == null || !Number.isFinite(x) ? '–' : x.toLocaleString(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits })),
    int: (x: number) => x.toLocaleString(loc),
    date: (d: Date | null | undefined) => (d ? d.toLocaleDateString(loc, { timeZone: 'Europe/Berlin', day: 'numeric', month: 'long', year: 'numeric' }) : '–'),
    dateShort: (d: Date | null | undefined) => (d ? d.toLocaleDateString(loc, { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }) : '–'),
    of: (a: number, b: number) => (en ? `${a} of ${b}` : `${a} von ${b}`),
    engine: (k: string) => engineName(k, lang),
    list: (xs: string[]) => listJoin(xs, lang),
  };
};

export function tierLabel(tier: ReportTier, kind: ReportKind, lang: Lang): string {
  if (kind === 'remeasure') return lang === 'en' ? 'Follow-up measurement' : 'Nachmessung';
  if (tier === 'strategy') return lang === 'en' ? 'Strategy report' : 'Strategiebericht';
  return lang === 'en' ? 'Baseline report' : 'Standortbestimmung';
}

/** Name der Berichtsart ohne Nachmessung (für „Nachmessung · Standortbestimmung“). */
export const baseTierLabel = (tier: ReportTier, lang: Lang) => tierLabel(tier, 'initial', lang);

/** „20 Fragen × 3 Durchläufe × 5 KIs = 300 Antworten“ */
export function scopeLine(m: ReportModel): string {
  const { prompts, repetitions, engines, planned } = m.scope;
  const en = m.lang === 'en';
  const q = en ? `${prompts} question${prompts === 1 ? '' : 's'}` : `${prompts} ${prompts === 1 ? 'Frage' : 'Fragen'}`;
  const r = en ? `${repetitions} run${repetitions === 1 ? '' : 's'}` : `${repetitions} ${repetitions === 1 ? 'Durchlauf' : 'Durchläufe'}`;
  const e = en ? `${engines.length} AI engine${engines.length === 1 ? '' : 's'}` : `${engines.length} ${engines.length === 1 ? 'KI' : 'KIs'}`;
  const product = prompts * repetitions * engines.length;
  if (product === planned) return `${q} × ${r} × ${e} = ${planned} ${en ? 'answers' : 'Antworten'}`;
  return `${q} × ${r} × ${e} (${planned} ${en ? 'answers planned' : 'Antworten geplant'})`;
}

/** Zusatz, wenn nicht alle geplanten Abfragen eine auswertbare Antwort ergaben. */
export function scopeNote(m: ReportModel): string | null {
  const { planned, responses, noAiAnswer } = m.scope;
  if (responses >= planned) return null;
  const en = m.lang === 'en';
  const missing = planned - responses;
  const g = Math.min(noAiAnswer, missing);
  if (en) return `${responses} of them could be evaluated${g ? ` (Google showed no AI answer for ${g} searches)` : ''}.`;
  return `Davon waren ${responses} auswertbar${g ? ` (bei ${g} Suchen zeigte Google keine KI-Antwort)` : ''}.`;
}

/** Ein Satz Einordnung zur Hauptzahl. */
export function heroSentence(m: ReportModel): string {
  const f = fmt(m.lang);
  const en = m.lang === 'en';
  const N = m.scope.responses;
  const lead = m.ranking.leader && m.ranking.leader.name !== m.brand.name ? m.ranking.leader : null;
  const comp = m.brands.find((b) => !b.own && b.named > 0);
  const other = lead ?? (comp ? { name: comp.name, responses: comp.named } : null);
  if (en) {
    return `${m.brand.name} is mentioned in ${f.of(m.own.named, N)} answers${other ? ` – ${other.name} in ${other.responses}` : ''}.`;
  }
  return `${m.brand.name} wird in ${f.of(m.own.named, N)} Antworten genannt${other ? ` – ${other.name} in ${other.responses}` : ''}.`;
}

export function placeLine(m: ReportModel): string | null {
  if (!m.ranking.place) return null;
  return m.lang === 'en'
    ? `Rank ${m.ranking.place} of ${m.ranking.total} brands mentioned in the answers.`
    : `Platz ${m.ranking.place} von ${m.ranking.total} Marken, die in den Antworten vorkommen.`;
}

export function ciLine(m: ReportModel): string | null {
  const ci = m.own.ci;
  if (!ci) return null;
  const lo = Math.round(ci.lo * 100), hi = Math.round(ci.hi * 100);
  return m.lang === 'en'
    ? `Range of variation (95%): about ${lo}–${hi} out of 100.`
    : `Schwankungsbreite (95${NB}%): etwa ${lo}–${hi} von 100.`;
}

export function engineExtremesLine(m: ReportModel): string | null {
  const f = fmt(m.lang);
  if (!m.strongest || !m.weakest) {
    const any = m.engines.find((e) => e.responses > 0);
    if (!any) return null;
    return m.lang === 'en' ? 'All AI engines mention you about equally often.' : 'Alle KI-Suchen nennen dich etwa gleich oft.';
  }
  const s = m.strongest, w = m.weakest;
  return m.lang === 'en'
    ? `Strongest: ${f.engine(s.engine)} (${f.of(s.named, s.responses)} answers). Weakest: ${f.engine(w.engine)} (${f.of(w.named, w.responses)}).`
    : `Am stärksten: ${f.engine(s.engine)} (${f.of(s.named, s.responses)} Antworten). Am schwächsten: ${f.engine(w.engine)} (${f.of(w.named, w.responses)}).`;
}

/** Satz zum Vorher-nachher-Vergleich mit ehrlicher Einordnung. */
export function comparisonSentence(m: ReportModel): string | null {
  const c = m.comparison;
  if (!c) return null;
  const f = fmt(m.lang);
  const en = m.lang === 'en';
  if (c.delta === null) return en ? 'No comparison possible – one of the two measurements has no evaluable answers.' : 'Kein Vergleich möglich – eine der beiden Messungen hat keine auswertbaren Antworten.';
  if (c.withinNoise) {
    return en
      ? `The change of ${f.pp(c.delta)} is within the normal variation of AI answers (about ±10 points) – treat it as “roughly unchanged”, not as a trend.`
      : `Die Veränderung von ${f.pp(c.delta)} liegt im Rahmen der normalen Schwankung von KI-Antworten (etwa ±10 Prozentpunkte) – sieh sie als „etwa gleich“, nicht als Trend.`;
  }
  const up = c.delta > 0;
  return en
    ? `${m.brand.name} is mentioned ${up ? 'clearly more' : 'clearly less'} often than before (${f.pp(c.delta)}). Differences below about ±10 points can be noise; this one is larger.`
    : `${m.brand.name} wird deutlich ${up ? 'öfter' : 'seltener'} genannt als vorher (${f.pp(c.delta)}). Unterschiede unter etwa ±10 Prozentpunkten können Rauschen sein – dieser ist größer.`;
}

export const kindLabel = (kind: string | null, lang: Lang) => {
  const de: Record<string, string> = { provider: 'Anbieter', portal: 'Vergleichsportal/Ratgeber', retailer: 'Händler', other: 'Sonstiges' };
  const en: Record<string, string> = { provider: 'Provider', portal: 'Comparison site/guide', retailer: 'Retailer', other: 'Other' };
  return kind ? (lang === 'en' ? en : de)[kind] ?? null : null;
};

/** Feste Beschriftungen. */
export function labels(lang: Lang) {
  const en = lang === 'en';
  return en ? {
    reportFrom: 'Report from', measuredFrom: 'Measured', comparedWith: 'Compared with the measurement from', website: 'Website',
    createdWith: 'Created with Askmetry – measures how AI search engines mention your brand.', page: (a: number, b: number) => `Page ${a} of ${b}`,
    s1: 'The key points', s2: 'Results by AI engine', s3: 'Results by question', s4: 'Sources', s5: 'All actions', s6: 'Topics and 90-day plan', s7: 'Method and limits', s8: 'Appendix: prompts for your AI',
    visibility: 'AI visibility', of100: 'out of 100', vsCompetitors: 'Compared with competitors', topActions: 'The 3 most important actions',
    beforeAfter: 'Before and after', before: 'Before', now: 'Now', change: 'Change', range: 'range',
    engine: 'AI engine', answers: 'Answers', named: 'Mentioned', vis: 'Visibility', avgPos: 'Avg. position', ownSite: 'Your website as source', leader: 'Leading brand',
    brandCol: 'Brand', recommended: 'Recommended', sov: 'Share of voice', you: 'you',
    noAi: (n: number) => `${n} without AI answer`,
    question: 'Question', total: 'Total', topicCol: 'Topic', othersNamed: 'Mentioned instead',
    legendYes: 'mentioned', legendNo: 'not mentioned', legendPart: 'mentioned in some runs (e.g. 2/3 = in 2 of 3 runs)',
    ownSiteH: 'Where your website appears', compOnlyH: 'Where competitors appear – and you don’t', topSourcesH: 'Most used sources', compSitesH: 'Competitors’ websites as sources',
    domain: 'Domain', type: 'Type', typeOwn: 'Your website', typeComp: (n: string) => `Competitor: ${n}`, typeOther: '–',
    compOnlyCol: 'Answers with competitors, without you',
    sourcesNote: 'Counted: the sources an answer cites; where an AI engine cites none, the pages it read.',
    category: 'Category', steps: 'Steps', withAi: 'Do it with AI', promptRef: (n: number) => `Prompt A${n} in the appendix`,
    topicsH: 'Results by topic', planH: '90-day plan', month: (n: number) => `Month ${n}`, days: (n: number) => `Days ${(n - 1) * 30 + 1}–${n * 30}`,
    planEnd: 'At the end: follow-up measurement with the same questions to check the effect.',
    prompts: 'Questions', topDomains: 'Main sources',
    appendixIntro: 'Each prompt is complete and self-contained: paste it into your AI assistant (ChatGPT, Claude, Gemini – or for code e.g. Claude Code, Codex, Cursor). Copying is easiest in the web app: Actions → Copy prompt.',
    noRecs: 'This measurement produced no actions.',
    status: { open: '', in_progress: 'In progress', done: 'Done', dismissed: '' } as Record<string, string>,
    models: 'Model versions', period: 'Measurement period', scope: 'Scope', kind: 'Type of brand',
  } : {
    reportFrom: 'Bericht vom', measuredFrom: 'Gemessen', comparedWith: 'Verglichen mit der Messung vom', website: 'Website',
    createdWith: 'Erstellt mit Askmetry – misst, wie KI-Suchen deine Marke nennen.', page: (a: number, b: number) => `Seite ${a} von ${b}`,
    s1: 'Das Wichtigste', s2: 'Ergebnisse je KI-Suche', s3: 'Ergebnisse je Frage', s4: 'Quellen', s5: 'Alle Maßnahmen', s6: 'Themen und 90-Tage-Plan', s7: 'Methode und Grenzen', s8: 'Anhang: Prompts für deine KI',
    visibility: 'KI-Sichtbarkeit', of100: 'von 100', vsCompetitors: 'Im Vergleich mit den Wettbewerbern', topActions: 'Die 3 wichtigsten Maßnahmen',
    beforeAfter: 'Vorher und jetzt', before: 'Vorher', now: 'Jetzt', change: 'Veränderung', range: 'Schwankung',
    engine: 'KI-Suche', answers: 'Antworten', named: 'Genannt', vis: 'Sichtbarkeit', avgPos: 'Ø Platz', ownSite: 'Deine Website als Quelle', leader: 'Spitzenreiter',
    brandCol: 'Marke', recommended: 'Empfohlen', sov: 'Anteil an allen Nennungen', you: 'du',
    noAi: (n: number) => `${n} ohne KI-Antwort`,
    question: 'Frage', total: 'Gesamt', topicCol: 'Thema', othersNamed: 'Stattdessen genannt',
    legendYes: 'genannt', legendNo: 'nicht genannt', legendPart: 'in einem Teil der Durchläufe genannt (z. B. 2/3 = in 2 von 3)',
    ownSiteH: 'Wo deine Website als Quelle auftaucht', compOnlyH: 'Hier stehen Wettbewerber, du nicht', topSourcesH: 'Meistgenutzte Quellen', compSitesH: 'Websites der Wettbewerber als Quelle',
    domain: 'Domain', type: 'Art', typeOwn: 'Deine Website', typeComp: (n: string) => `Wettbewerber: ${n}`, typeOther: '–',
    compOnlyCol: 'Antworten mit Wettbewerbern, ohne dich',
    sourcesNote: 'Gezählt: die Quellen, die eine Antwort zitiert; wo eine KI keine zitiert, die Seiten, die sie gelesen hat.',
    category: 'Kategorie', steps: 'Schritte', withAi: 'Mit KI umsetzen', promptRef: (n: number) => `Prompt A${n} im Anhang`,
    topicsH: 'Ergebnisse je Thema', planH: '90-Tage-Plan', month: (n: number) => `Monat ${n}`, days: (n: number) => `Tag ${(n - 1) * 30 + 1}–${n * 30}`,
    planEnd: 'Zum Schluss: Nachmessung mit denselben Fragen, um die Wirkung zu prüfen.',
    prompts: 'Fragen', topDomains: 'Wichtigste Quellen',
    appendixIntro: 'Jeder Prompt ist vollständig und eigenständig: Füge ihn in deine KI ein (ChatGPT, Claude, Gemini – für Code z. B. Claude Code, Codex, Cursor). Am einfachsten kopierst du ihn in der Web-App: Maßnahmen → Prompt kopieren.',
    noRecs: 'Aus dieser Messung ergeben sich keine Maßnahmen.',
    status: { open: '', in_progress: 'In Arbeit', done: 'Erledigt', dismissed: '' } as Record<string, string>,
    models: 'Modellversionen', period: 'Messzeitraum', scope: 'Umfang', kind: 'Art der Marke',
  };
}

/** Absätze „Methode und Grenzen“. */
export function methodParagraphs(m: ReportModel): { title: string; text: string }[] {
  const f = fmt(m.lang);
  const en = m.lang === 'en';
  const engines = m.scope.engines.map(f.engine);
  const google = m.scope.engines.some((e) => e.startsWith('google_'));
  const api = m.scope.engines.filter((e) => !e.startsWith('google_')).map(f.engine);
  const reps = m.scope.repetitions;
  if (en) {
    return [
      { title: 'How we measured', text: `We asked ${m.scope.prompts} questions that your customers might ask, ${reps === 1 ? 'once' : `${reps} times each`}, in ${f.list(engines)}. ${api.length ? `${f.list(api)} were queried via their official APIs with live web search switched on. ` : ''}${google ? 'For Google AI Overviews and AI Mode we evaluated the real Google results page (via DataForSEO). ' : ''}The questions don’t contain your brand name.` },
      { title: 'How we evaluated', text: 'An answer counts as “mentioned” if it names your brand. Visibility = share of answers that mention the brand (out of 100). Position = where in the answer the brand appears (1 = first; shown from 5 mentions). Share of voice = mentions of the brand divided by all brand mentions. Sources = the pages an answer cites; where an engine cites none, the pages it read.' },
      { title: 'AI answers vary', text: `The same question can get a different answer every time. That is why each question was asked ${reps === 1 ? 'once per engine – a sample' : `${reps} times per engine`}. The range of variation on page 2 shows how precise the main number is. Differences below about ±10 points between two measurements can be noise.` },
      { title: 'API is not the app', text: 'Answers via the API can differ from what users see in the ChatGPT, Claude or Gemini apps (e.g. personalisation, location, chat history, model version). Google results depend on location and time. We measure under the same conditions each time so that measurements stay comparable.' },
      { title: 'Actions', text: 'Actions are derived only from this measurement (which sources the engines use, where competitors appear without you) and from a technical check of your website. They don’t guarantee more mentions – the follow-up measurement shows whether they work.' },
    ];
  }
  return [
    { title: 'So haben wir gemessen', text: `Wir haben ${m.scope.prompts} Fragen, wie sie deine Kunden stellen, ${reps === 1 ? 'je einmal' : `je ${reps}-mal`} an ${f.list(engines)} gestellt. ${api.length ? `${f.list(api)} haben wir über die offiziellen Schnittstellen (APIs) mit eingeschalteter Live-Websuche abgefragt. ` : ''}${google ? 'Für die Google-Übersicht (AI Overviews) und den Google KI-Modus haben wir die echte Google-Ergebnisseite ausgewertet (über DataForSEO). ' : ''}Die Fragen enthalten deinen Markennamen nicht.` },
    { title: 'So haben wir ausgewertet', text: 'Eine Antwort zählt als „genannt“, wenn sie deine Marke nennt. Sichtbarkeit = Anteil der Antworten, die die Marke nennen (von 100). Platz = an welcher Stelle der Antwort die Marke vorkommt (1 = zuerst; gezeigt ab 5 Nennungen). Anteil an allen Nennungen = Nennungen der Marke geteilt durch alle Markennennungen. Quellen = die Seiten, die eine Antwort zitiert; wo eine KI keine zitiert, die Seiten, die sie gelesen hat.' },
    { title: 'KI-Antworten schwanken', text: `Dieselbe Frage kann jedes Mal etwas anders beantwortet werden. Deshalb wurde jede Frage ${reps === 1 ? 'je KI einmal gestellt – das ist eine Stichprobe' : `je KI ${reps}-mal gestellt`}. Die Schwankungsbreite auf Seite 2 zeigt, wie genau die Hauptzahl ist. Unterschiede unter etwa ±10 Prozentpunkten zwischen zwei Messungen können Rauschen sein.` },
    { title: 'API ist nicht gleich App', text: 'Antworten über die Schnittstelle können von dem abweichen, was Nutzer in den Apps von ChatGPT, Claude oder Gemini sehen (z. B. durch Personalisierung, Standort, bisherigen Chatverlauf, Modellversion). Google-Ergebnisse hängen von Ort und Zeitpunkt ab. Wir messen jedes Mal unter denselben Bedingungen, damit Messungen vergleichbar bleiben.' },
    { title: 'Maßnahmen', text: 'Die Maßnahmen leiten wir nur aus dieser Messung ab (welche Quellen die KIs nutzen, wo Wettbewerber ohne dich auftauchen) und aus einem technischen Check deiner Website. Sie garantieren keine Nennung – ob sie wirken, zeigt die Nachmessung.' },
  ];
}
