// Maßnahmen-Generator: Messung laden → Regeln → (optional) KI-Formulierung → Upsert in recommendation.
import {
  brand, citation, collection, db, mention, prompt, recommendation, recommendationGeneration, response, run, topic, workspace,
} from '@askmetry/db';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { maxBudgetUsd } from '../budget.ts';
import { monthToDateSpend } from '../runner.ts';
import { indexData, type RecData, type SiteCheckResult } from './data.ts';
import { estimatePhraseCost, llmAvailable, PHRASE_BATCH_SIZE, phraseVersion, phraseWithLlm, signatureHash, type PhraseContext, type PhraseResult, type PhraseText, type Phraser } from './phrase.ts';
import { buildCandidates, REC_TYPES, type Candidate, type RecType } from './rules.ts';
import { robotsStatusUnknown, runSiteCheck, type FetchLike } from './site-check.ts';
import { autofillBrandProfile } from './profile.ts';
import { toLang } from '../i18n.ts';
import { refreshLogos } from '../logo.ts';

export * from './data.ts';
export * from './rules.ts';
export * from './phrase.ts';
export * from './site-check.ts';
export * from './safe-fetch.ts';
export * from './present.ts';
export * from './brief.ts';

export const FINISHED = ['done', 'budget_exceeded'] as const;

// ---------------------------------------------------------------------------
// Daten laden
// ---------------------------------------------------------------------------

/** Abgeschlossene Messungen mit ausgewerteten Antworten, neueste zuerst. */
export async function finishedCollections(workspaceId: string, limit = 2) {
  return db.select({ id: collection.id, createdAt: collection.createdAt, finishedAt: collection.finishedAt })
    .from(collection)
    .where(and(eq(collection.workspaceId, workspaceId), inArray(collection.status, [...FINISHED]),
      sql`exists (select 1 from ${response} resp join ${run} rr on rr.id = resp.run_id
        where rr.collection_id = ${collection.id} and resp.answer <> '' and resp.analyzed)`))
    .orderBy(desc(collection.createdAt)).limit(limit);
}

/** Datenbasis einer Messung (gleiche Basis wie die Kennzahlen: Antworten mit Text, ausgewertet). */
export async function loadRecData(workspaceId: string, collectionId: string): Promise<RecData> {
  const where = and(eq(response.workspaceId, workspaceId), eq(run.collectionId, collectionId), ne(response.answer, ''), eq(response.analyzed, true));
  const [[c], [ws]] = await Promise.all([
    db.select().from(collection).where(eq(collection.id, collectionId)),
    db.select({ language: workspace.language }).from(workspace).where(eq(workspace.id, workspaceId)),
  ]);
  const [brands, prompts, resps, ments, cits] = await Promise.all([
    db.select({ id: brand.id, name: brand.name, aliases: brand.aliases, domains: brand.domains, isOwn: brand.isOwn, description: brand.description, kind: brand.kind })
      .from(brand).where(eq(brand.workspaceId, workspaceId)),
    db.select({ id: prompt.id, text: prompt.text, topicId: prompt.topicId, topicName: topic.name })
      .from(prompt).leftJoin(topic, eq(topic.id, prompt.topicId)).where(eq(prompt.workspaceId, workspaceId)),
    db.select({ id: response.id, promptId: run.promptId, engine: run.engine })
      .from(response).innerJoin(run, eq(run.id, response.runId)).where(where),
    db.select({
      responseId: mention.responseId, brandId: mention.brandId, name: mention.name, position: mention.position,
      recommended: mention.recommended, sentiment: mention.sentiment, snippet: mention.snippet, isCompetitor: mention.isCompetitor,
    }).from(mention).innerJoin(response, eq(response.id, mention.responseId)).innerJoin(run, eq(run.id, response.runId)).where(where),
    db.select({ responseId: citation.responseId, url: citation.url, domain: citation.domain, title: citation.title, position: citation.position, kind: citation.kind })
      .from(citation).innerJoin(response, eq(response.id, citation.responseId)).innerJoin(run, eq(run.id, response.runId)).where(where)
      .orderBy(citation.responseId, citation.position),
  ]);
  return {
    workspaceId, collectionId, at: c?.finishedAt ?? c?.createdAt ?? new Date(),
    brands, prompts: new Map(prompts.map((p) => [p.id, p])), resps, ments, cits, lang: toLang(ws?.language),
  };
}

// ---------------------------------------------------------------------------
// Wirkungsmessung
// ---------------------------------------------------------------------------

export interface RecMetric {
  /** Beschriftung für „vorher → jetzt“ */
  label: string;
  /** Was der Nenner zählt, für „1 von 45 Antworten zu den betroffenen Fragen“ */
  denLabel: string;
  /** Anteil 0..1 (null, wenn die Basis leer ist) */
  value: number | null;
  num: number;
  den: number;
  higherIsBetter: boolean;
  collectionId: string;
}

type RecLike = { type: string; key: string; evidence: unknown };

/**
 * Kennzahl, an der sich die Wirkung einer Maßnahme ablesen lässt – berechnet auf einer Messung.
 * name_on_own_page: Nennungsrate in Antworten, die eigene Seiten als Quelle nutzen · outreach/content_gap/community:
 * Sichtbarkeit der eigenen Marke bei den betroffenen Fragen · technical: keine Kennzahl (null) – die Wirkung technischer
 * Änderungen lässt sich an einer Messung nicht sauber ablesen; Erfolg zeigt der Website-Check ·
 * positioning: Anteil der Antworten mit dem Wettbewerber, in denen die eigene Marke vor ihm steht · sentiment: Anteil negativer Nennungen.
 */
export function recommendationMetric(rec: RecLike, data: RecData): RecMetric | null {
  const ix = indexData(data);
  const ev = (rec.evidence ?? {}) as Record<string, any>;
  const own = ix.own;
  const ownName = own?.name ?? 'Eigene Marke';
  const m = (label: string, denLabel: string, num: number, den: number, higherIsBetter = true): RecMetric =>
    ({ label, denLabel, num, den, value: den ? num / den : null, higherIsBetter, collectionId: data.collectionId });
  switch (rec.type as RecType) {
    case 'name_on_own_page': {
      const den = ix.ownSiteResps.size;
      const num = [...ix.ownSiteResps].filter((r) => ix.ownNamed.has(r)).length;
      return m(`${ownName} genannt in Antworten mit deiner Website als Quelle`, 'Antworten mit deiner Website als Quelle', num, den);
    }
    case 'technical':
    case 'entity':
      // keine Kennzahl: Wirkung zeigt sich nicht sauber in einer Messung (Erfolg zeigt der Website-Check)
      return null;
    case 'positioning': {
      const cid = ev.competitorId as string | undefined;
      let den = 0, num = 0;
      for (const [rid, comps] of ix.compsByResp) {
        const c = comps.find((x) => x.brandId === cid);
        if (!c) continue;
        den++;
        const o = (ix.mentsByResp.get(rid) ?? []).find((x) => x.brandId === own?.id);
        if (o && o.position < c.position) num++;
      }
      const comp = ev.competitor ?? 'dem Wettbewerber';
      return m(`${ownName} vor ${comp} genannt`, `Antworten, die ${comp} nennen`, num, den);
    }
    case 'sentiment': {
      const ms = ix.ments.filter((x) => x.brandId === own?.id);
      return m(`Negative Nennungen von ${ownName}`, `Nennungen von ${ownName}`, ms.filter((x) => x.sentiment === 'negative').length, ms.length, false);
    }
    default: {
      const pids = new Set<string>(Array.isArray(ev.promptIds) ? ev.promptIds : []);
      const rs = data.resps.filter((r) => pids.has(r.promptId));
      return m(`Sichtbarkeit von ${ownName} bei den betroffenen Fragen`, 'Antworten zu den betroffenen Fragen', rs.filter((r) => ix.ownNamed.has(r.id)).length, rs.length);
    }
  }
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

export type RecRow = typeof recommendation.$inferSelect;

export interface UpsertInput {
  workspaceId: string;
  collectionId: string;
  candidates: Candidate[];
  /** KI-Texte je key (sonst Standardtexte bzw. vorhandene KI-Texte bei unveränderter Evidenz) */
  texts?: Map<string, PhraseText>;
  /** Kosten der KI-Formulierung, auf die neu formulierten Maßnahmen verteilt */
  costUsd?: number;
  /** Maßnahmen-Typen, die diese Berechnung abdeckt; nur deren nicht mehr gestützte Maßnahmen werden inaktiv */
  coveredTypes?: RecType[];
  /** feinere Abdeckung: false = diese (abgedeckt-typige) Maßnahme trotzdem nicht inaktivieren (z. B. technischer Teil-Check gescheitert) */
  isCovered?: (key: string) => boolean;
  /** Kennzahlen je key (Wirkungsmessung) */
  metrics?: Map<string, { current: RecMetric | null; previous?: RecMetric | null }>;
  /** an die KI geschickte Maßnahmen (abgeschlossen, nicht nur verschoben) – ohne Text zählt das als gescheiterter Versuch */
  attempted?: Set<string>;
  now?: Date;
}

/** Braucht der Kandidat eine (neue) KI-Formulierung? */
export function needsPhrasing(c: Candidate, existing: Pick<RecRow, 'evidence' | 'status'> | undefined): boolean {
  if (existing?.status === 'dismissed') return false;
  if (!existing) return true;
  const ev = (existing.evidence ?? {}) as Record<string, any>;
  const hash = hashOf(c);
  if (ev.textHash === hash && ev.phrasedBy === 'llm') return false;
  // nach MAX_PHRASE_ATTEMPTS gescheiterten Versuchen mit unveränderter Evidenz nicht endlos erneut bezahlen
  if (ev.phraseAttempts?.hash === hash && ev.phraseAttempts.n >= MAX_PHRASE_ATTEMPTS) return false;
  return true;
}

/** So oft wird eine Maßnahme mit unveränderter Evidenz höchstens erfolglos an die KI geschickt. */
export const MAX_PHRASE_ATTEMPTS = 2;
/** Höchstens so viele KI-Aufrufe je Generierung (Rest beim nächsten Mal). */
export const MAX_PHRASE_CALLS = 3;
/** Schnell-Check: Maßnahmen je Aufruf (bis zu MAX_PHRASE_CALLS Aufrufe gleichzeitig) */
export const CHECK_PHRASE_BATCH_SIZE = 5;

// Sprache gehört zum Textstand (KI schreibt in der Workspace-Sprache); für de bleibt der Hash wie bisher (keine Neuformulierung).
export const hashOf = (c: Candidate) => signatureHash({ key: c.key, signature: [c.signature, phraseVersion(c.type), ...(c.lang === 'en' ? ['en'] : [])] });
/** exakte Kernzahlen – ändern sie sich ohne neue Formulierung, wird die Begründung (why) aus den Regeln genommen */
const metricsKey = (c: Candidate) => JSON.stringify(c.evidence.metrics ?? {});

/**
 * Kandidaten per (workspaceId, key) speichern: neue → status open (Ausgangswert in baseline + evidence.baseline);
 * vorhandene → Texte/Evidenz/Priorität/lastSeenAt/lastCollectionId aktualisieren, Status bleibt;
 * nicht mehr gestützte (abgedeckte Typen) → active = false, Status bleibt.
 */
export async function upsertRecommendations(input: UpsertInput) {
  const now = input.now ?? new Date();
  const covered = new Set(input.coveredTypes ?? REC_TYPES);
  const texts = input.texts ?? new Map();
  // Kosten in 1/10000 $ verteilen, Rest auf die ersten Maßnahmen, damit die Summe stimmt
  const totalUnits = Math.round((input.costUsd ?? 0) * 10000);
  const llmKeys = input.candidates.filter((c) => texts.has(c.key)).map((c) => c.key);
  const unitsFor = (key: string) => {
    const i = llmKeys.indexOf(key);
    if (i < 0 || !llmKeys.length) return 0;
    return Math.floor(totalUnits / llmKeys.length) + (i < totalUnits % llmKeys.length ? 1 : 0);
  };
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(recommendation).where(eq(recommendation.workspaceId, input.workspaceId));
    const byKey = new Map(existing.map((r) => [r.key, r]));
    let created = 0, updated = 0, deactivated = 0;
    for (const c of input.candidates) {
      const ex = byKey.get(c.key);
      const exEv = (ex?.evidence ?? {}) as Record<string, any>;
      const hash = hashOf(c);
      const llm = texts.get(c.key);
      let text: PhraseText;
      let phrasedBy: 'llm' | 'rules';
      // Die Kurzbegründung (why) kommt immer aus den Regeln: ein Satz ≤ 140 Zeichen, exakte Zahlen, korrekte Grammatik.
      // Die KI formuliert Titel und Schritte.
      if (llm) { text = { ...llm, why: c.why }; phrasedBy = 'llm'; }
      else if (ex && exEv.phrasedBy === 'llm' && exEv.textHash === hash) {
        text = { title: ex.title, why: c.why, steps: ex.steps };
        phrasedBy = 'llm';
      }
      else { text = { title: c.title, why: c.why, steps: c.steps }; phrasedBy = 'rules'; }
      const noMetric = c.type === 'technical' || c.type === 'entity';
      const metric = noMetric ? undefined : input.metrics?.get(c.key);
      // abgehakte Schritte gelten nur für dieselben Schritte – ändern sich die Schritte, beginnt die Liste neu
      const stepsChanged = !!ex && JSON.stringify(ex.steps ?? []) !== JSON.stringify(text.steps);
      const evidence = {
        ...c.evidence,
        reach: c.reach,
        collectionId: input.collectionId,
        textHash: hash,
        phrasedBy,
        phrasedMetrics: llm ? metricsKey(c) : (exEv.phrasedMetrics ?? null),
        // gescheiterte KI-Versuche je Textstand (siehe needsPhrasing)
        phraseAttempts: llm || phrasedBy === 'llm' ? null
          : input.attempted?.has(c.key)
            ? { hash, n: (exEv.phraseAttempts?.hash === hash ? exEv.phraseAttempts.n : 0) + 1 }
            : (exEv.phraseAttempts?.hash === hash ? exEv.phraseAttempts : null),
        // Ausgangswert bei Entstehung bleibt erhalten; current = aktuelle Messung, previous = Messung davor
        // technical: keine Kennzahl → baseline/current/previous null (auch bei Altbeständen)
        baseline: noMetric ? null : exEv.baseline ?? metric?.current ?? null,
        current: metric?.current ?? null,
        previous: metric?.previous ?? null,
        // Standardtexte immer mitgeben (für Vergleich/Fallback in der UI): fallback = Workspace-Sprache,
        // texts = alle Sprachen ({ de: {title, why, steps}, en: {…} }) – die UI zeigt Regeltexte in der Sprache des Nutzers
        fallback: { title: c.title, why: c.why, steps: c.steps },
        texts: c.texts,
      };
      const costAdd = unitsFor(c.key) / 10000;
      const values = {
        type: c.type, title: text.title, why: text.why, steps: text.steps, impact: c.impact, effort: c.effort,
        priority: c.priority.toFixed(3), evidence, active: true, lastCollectionId: input.collectionId, lastSeenAt: now,
      };
      if (!ex) {
        const ins = await tx.insert(recommendation).values({
          workspaceId: input.workspaceId, key: c.key, ...values, status: 'open', baseline: metric?.current ?? null,
          generationCostUsd: costAdd.toFixed(4), firstSeenAt: now,
        }).onConflictDoNothing().returning({ id: recommendation.id });
        if (ins.length) { created++; continue; }
      }
      await tx.update(recommendation).set({
        ...values,
        ...(noMetric ? { baseline: null } : {}),
        ...(stepsChanged ? { doneSteps: [] as number[] } : {}),
        generationCostUsd: sql`${recommendation.generationCostUsd} + ${costAdd.toFixed(4)}::numeric`,
      }).where(and(eq(recommendation.workspaceId, input.workspaceId), eq(recommendation.key, c.key)));
      updated++;
    }
    const keys = new Set(input.candidates.map((c) => c.key));
    for (const r of existing) {
      if (!r.active || keys.has(r.key) || !covered.has(r.type as RecType) || (input.isCovered && !input.isCovered(r.key))) continue;
      await tx.update(recommendation).set({ active: false }).where(eq(recommendation.id, r.id));
      deactivated++;
    }
    return { created, updated, deactivated };
  });
}

// ---------------------------------------------------------------------------
// Generieren
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Messung (Standard: letzte abgeschlossene mit ausgewerteten Antworten) */
  collectionId?: string;
  /** nur rechnen, wenn collectionId die neueste abgeschlossene Messung ist (nach einer Messung bzw. Nachauswertung) */
  onlyIfLatest?: boolean;
  /** KI-Formulierung (Standard: an, wenn verfügbar – nicht im Mock-Modus, nur mit ANTHROPIC_API_KEY) */
  llm?: boolean;
  /** KI-Formulierung ersetzen (Tests) */
  phraser?: Phraser;
  /** Website-Check (Standard: an, außer im Mock-Modus oder mit ASKMETRY_SITE_CHECK=0) */
  siteCheck?: boolean;
  /** fetch für den Website-Check (Tests) */
  fetch?: FetchLike;
  /** Website-Check auch bei frischem Ergebnis wiederholen */
  forceSiteCheck?: boolean;
  /** Logos der Marken aktualisieren (Standard: wie Website-Check, aber nie mit eigenem fetch) */
  logos?: boolean;
  log?: (m: string) => void;
  now?: Date;
}

export interface GenerateSummary {
  collectionId: string | null;
  candidates: number;
  created: number;
  updated: number;
  deactivated: number;
  phrased: number;
  costUsd: number;
  llm: 'used' | 'skipped' | 'budget' | 'failed' | 'off';
  siteChecks: number;
}

/**
 * Wurde der Teil des Website-Checks erfolgreich ausgeführt, auf dem eine technische Maßnahme beruht?
 * Nur dann darf sie mangels Befund inaktiv werden (Netzfehler/Timeouts lassen sie unverändert).
 */
export function technicalCovered(key: string, checks: SiteCheckResult[]): boolean {
  if (!checks.length) return false;
  // Jede Domain muss für den Teil-Check ein belastbares Ergebnis haben – ein Fehlschlag auf einer Domain reicht,
  // damit eine dort bestehende Maßnahme nicht mangels Befund inaktiv wird.
  // Startseite auswertbar (2xx/3xx) oder dauerhaft nicht vorhanden (404/410); 401/403/429/5xx/Netzfehler = unbekannt
  const homeDecided = (c: SiteCheckResult) => c.home.status !== null && (c.home.status < 400 || c.home.status === 404 || c.home.status === 410);
  switch (key) {
    case 'technical:robots': return checks.every((c) => !robotsStatusUnknown(c.robots.status));
    case 'technical:bot_protection': return checks.every((c) => c.home.status !== null);
    // Sitemap: Abruf mit belastbarem Status (Checks vor Nov. 2026 haben kein sitemap-Feld → nicht abgedeckt)
    case 'technical:sitemap': return checks.every((c) => !!c.sitemap && !robotsStatusUnknown(c.sitemap.status));
    // aus der Messung abgeleitet, braucht nur einen gelaufenen Check
    case 'technical:search_index': return true;
    // Unterseiten-Befunde: nur mit vertieftem Check und ohne gescheiterten Unterseiten-Abruf
    case 'technical:noindex': case 'technical:canonical': case 'technical:meta': case 'technical:speed': case 'technical:hreflang':
      return checks.every((c) => homeDecided(c) && !!c.pages && c.pages.every((p) => p.status !== null && (p.status < 400 || p.status === 404 || p.status === 410)));
    default: return checks.every(homeDecided);
  }
}

/** Beruht auf der Wikidata-Abfrage des Website-Checks: nur abgedeckt, wenn sie für mindestens eine Domain geklappt hat. */
export function entityCovered(checks: SiteCheckResult[]): boolean {
  return checks.some((c) => c.wikidata && c.wikidata.status !== 'error');
}

/** Schätzung der KI-Kosten für die Budgetprüfung (Haiku, großzügig). */

function siteCheckDefault() {
  return process.env.ASKMETRY_MOCK_ENGINES !== '1' && process.env.ASKMETRY_SITE_CHECK !== '0';
}

/**
 * KI-Formulierung in Batches: je Aufruf höchstens PHRASE_BATCH_SIZE (wichtigste zuerst), höchstens MAX_PHRASE_CALLS Aufrufe,
 * jeder Aufruf nur, wenn seine Kostenobergrenze noch ins Budget passt. Bei abgeschnittener Ausgabe (max_tokens) wird der Batch halbiert.
 * Bei einem Fehler ohne jedes Ergebnis wird abgebrochen (kein Wiederholen in derselben Generierung).
 */
export async function phraseInBatches(
  items: Candidate[], ctx: PhraseContext,
  opts: {
    phraser: Phraser; budgetLeft: number; onCall?: (res: PhraseResult) => Promise<void> | void;
    /** Maßnahmen je Aufruf (Standard PHRASE_BATCH_SIZE) */
    batchSize?: number;
    /** so viele Aufrufe gleichzeitig (Standard 1; Schnell-Check: kleinere Batches parallel, damit der Teaser schneller fertig ist) */
    parallel?: number;
  },
) {
  const queue = [...items];
  let size = Math.max(1, opts.batchSize ?? PHRASE_BATCH_SIZE);
  const parallel = Math.max(1, opts.parallel ?? 1);
  const texts = new Map<string, PhraseText>();
  const attempted = new Set<string>();
  const errors: string[] = [];
  let costUsd = 0, calls = 0, budgetHit = false;
  while (queue.length && calls < MAX_PHRASE_CALLS) {
    // eine Runde: bis zu `parallel` Batches, jeder nur, wenn seine Kostenobergrenze (samt den anderen der Runde) ins Budget passt
    const round: Candidate[][] = [];
    let off = 0, reserved = 0;
    while (round.length < parallel && off < queue.length && calls + round.length < MAX_PHRASE_CALLS) {
      const batch = queue.slice(off, off + size);
      const est = estimatePhraseCost(batch);
      if (costUsd + reserved + est > opts.budgetLeft) { budgetHit = true; break; }
      round.push(batch); off += batch.length; reserved += est;
    }
    if (!round.length) break;
    calls += round.length;
    const results = await Promise.all(round.map((b) => opts.phraser(b, ctx)));
    const back: Candidate[] = [];
    let stop = false, truncatedLen = 0;
    for (let i = 0; i < round.length; i++) {
      const res = results[i], batch = round[i];
      costUsd += res.costUsd;
      await opts.onCall?.(res);
      for (const [k, v] of res.texts) texts.set(k, v);
      if (res.truncated && batch.length > 1) { back.push(...batch); truncatedLen = Math.max(truncatedLen, batch.length); continue; }
      for (const c of batch) attempted.add(c.key);
      if (res.error) { errors.push(res.error); if (!res.texts.size) stop = true; }
    }
    queue.splice(0, off);
    queue.unshift(...back);
    if (truncatedLen) size = Math.ceil(truncatedLen / 2);
    if (stop || budgetHit) break;
  }
  return { texts, costUsd, calls, attempted, errors, budgetHit, deferred: queue.length };
}

/**
 * Maßnahmen für einen Workspace aus der letzten abgeschlossenen Messung neu berechnen und speichern.
 * Je Workspace läuft höchstens eine Generierung gleichzeitig (Advisory Lock); wird während der Berechnung eine neuere
 * Messung fertig, wird ohne Speichern abgebrochen.
 * Wirft bei DB-Fehlern; Website-Check und KI-Formulierung scheitern weich (Standardtexte bzw. technische Maßnahmen bleiben unverändert).
 */
export async function generateRecommendations(workspaceId: string, opts: GenerateOptions = {}): Promise<GenerateSummary> {
  // Transaktion nur für den Lock (wird mit ihr freigegeben); die Arbeit selbst läuft über eigene Verbindungen
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`askmetry:recommend:${workspaceId}`}))`);
    return generateUnlocked(workspaceId, opts);
  });
}

async function generateUnlocked(workspaceId: string, opts: GenerateOptions): Promise<GenerateSummary> {
  const log = opts.log ?? (() => {});
  const cols = await finishedCollections(workspaceId, 1000);
  const empty: GenerateSummary = { collectionId: null, candidates: 0, created: 0, updated: 0, deactivated: 0, phrased: 0, costUsd: 0, llm: 'off', siteChecks: 0 };
  const idx = opts.collectionId ? cols.findIndex((c) => c.id === opts.collectionId) : 0;
  if (opts.collectionId && idx < 0) {
    log(`Maßnahmen: Messung ${opts.collectionId} ist keine abgeschlossene Messung dieses Workspaces mit ausgewerteten Antworten`);
    return empty;
  }
  const target = cols[idx];
  if (!target) { log('Maßnahmen: keine abgeschlossene Messung'); return empty; }
  if (opts.onlyIfLatest && idx !== 0) return empty;
  const prevId = cols[idx + 1]?.id; // Messung davor (neueste zuerst sortiert)

  const data = await loadRecData(workspaceId, target.id);
  const own = data.brands.find((b) => b.isOwn);
  if (!own) { log('Maßnahmen: keine eigene Marke angelegt'); return { ...empty, collectionId: target.id }; }
  if (!data.resps.length) { log('Maßnahmen: Messung ohne ausgewertete Antworten'); return { ...empty, collectionId: target.id }; }

  // Markenprofil automatisch von der Website ableiten, solange keines eingetragen ist (höchstens 1× pro Woche, ~0,001 $)
  let profileCost = 0;
  if ((opts.siteCheck ?? siteCheckDefault()) && own.domains.length && !own.description?.trim()) {
    try {
      const g = await autofillBrandProfile(workspaceId, { log, useLlm: opts.llm === false ? false : undefined, fetch: opts.fetch });
      profileCost = g?.costUsd ?? 0;
      // gespeicherten Stand übernehmen (gleiche Werte wie in der Datenbank)
      const [b] = await db.select({ description: brand.description, kind: brand.kind }).from(brand).where(eq(brand.id, own.id));
      if (b) { own.description = b.description; own.kind = b.kind; }
    } catch (e) {
      log(`Markenprofil-Erkennung fehlgeschlagen: ${(e as Error)?.message ?? e}`);
    }
  }

  // Logos der Marken (kostenlos, je Domain höchstens alle 30 Tage; nicht in Tests mit eigenem fetch)
  if ((opts.logos ?? (siteCheckDefault() && !opts.fetch)) && opts.siteCheck !== false) {
    try { await refreshLogos(workspaceId, { log }); } catch (e) { log(`Logos fehlgeschlagen: ${(e as Error)?.message ?? e}`); }
  }

  // Website-Check (kostenlos, höchstens 1× pro Tag je Domain)
  const covered = new Set<RecType>(REC_TYPES);
  if ((opts.siteCheck ?? siteCheckDefault()) && own.domains.length) {
    try {
      data.siteChecks = await runSiteCheck(workspaceId, own.domains, { fetch: opts.fetch, force: opts.forceSiteCheck, log });
    } catch (e) {
      log(`Website-Check fehlgeschlagen: ${(e as Error)?.message ?? e}`);
      covered.delete('technical');
      covered.delete('entity');
    }
  } else {
    covered.delete('technical'); // ohne Check bleiben technische Maßnahmen unverändert
    covered.delete('entity');
  }

  const candidates = buildCandidates(data);

  // Kennzahlen für die Wirkungsmessung (aktuell + vorige Messung)
  const prevData = prevId ? await loadRecData(workspaceId, prevId) : null;
  const metrics = new Map<string, { current: RecMetric | null; previous: RecMetric | null }>();
  for (const c of candidates) {
    metrics.set(c.key, { current: recommendationMetric(c, data), previous: prevData ? recommendationMetric(c, prevData) : null });
  }

  // KI-Formulierung nur für neue/geänderte Maßnahmen
  const existing = await db.select({ key: recommendation.key, evidence: recommendation.evidence, status: recommendation.status })
    .from(recommendation).where(eq(recommendation.workspaceId, workspaceId));
  const exByKey = new Map(existing.map((r) => [r.key, r]));
  const toPhrase = candidates.filter((c) => needsPhrasing(c, exByKey.get(c.key)));
  let texts = new Map<string, PhraseText>();
  let costUsd = 0;
  let llmState: GenerateSummary['llm'] = 'off';
  const useLlm = opts.llm ?? true;
  let attempted = new Set<string>();
  if (useLlm && toPhrase.length && (opts.phraser || llmAvailable())) {
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
    const budget = Math.min(Number(ws.monthlyBudgetUsd), maxBudgetUsd());
    const spent = await monthToDateSpend(workspaceId);
    const res = await phraseInBatches(
      toPhrase,
      { brandName: own.name, brandDescription: own.description, domains: own.domains, year: data.at.getFullYear(), lang: data.lang ?? 'de' },
      {
        phraser: opts.phraser ?? phraseWithLlm,
        budgetLeft: budget - spent,
        // Schnell-Check (gehostet): kleinere Batches gleichzeitig – der Teaser wartet auf die Formulierung
        ...(ws.hostedKind === 'check' && { batchSize: CHECK_PHRASE_BATCH_SIZE, parallel: MAX_PHRASE_CALLS }),
        // jeder Aufruf wird sofort gebucht – auch wenn er scheitert
        onCall: async (r) => {
          if (r.costUsd > 0 || r.texts.size) {
            await db.insert(recommendationGeneration).values({
              workspaceId, collectionId: target.id, model: r.model, items: r.texts.size, costUsd: r.costUsd.toFixed(4),
            });
          }
        },
      },
    );
    texts = res.texts;
    costUsd = res.costUsd;
    attempted = res.attempted;
    if (!res.calls) {
      llmState = 'budget';
      log(`Maßnahmen: Monatsbudget erreicht (${spent.toFixed(2)} $ von ${budget} $) – Standardtexte ohne KI`);
    } else {
      llmState = res.errors.length && !texts.size ? 'failed' : 'used';
      for (const e of res.errors) log(`Maßnahmen: KI-Formulierung teilweise fehlgeschlagen (${e}) – Standardtexte`);
      if (res.deferred) log(`Maßnahmen: ${res.deferred} weitere Maßnahmen werden beim nächsten Mal formuliert${res.budgetHit ? ' (Budget)' : ''}`);
    }
  } else if (useLlm && toPhrase.length) {
    llmState = 'skipped';
  }

  // Inzwischen neuere Messung fertig? Dann nicht mit veralteten Daten überschreiben (die neuere Messung erzeugt selbst).
  if (idx === 0) {
    const [latest] = await finishedCollections(workspaceId, 1);
    if (latest && latest.id !== target.id) {
      log(`Maßnahmen: während der Berechnung wurde Messung ${latest.id} fertig – Ergebnis für ${target.id} wird verworfen`);
      return { ...empty, collectionId: target.id, costUsd, llm: llmState };
    }
  }

  const up = await upsertRecommendations({
    workspaceId, collectionId: target.id, candidates, texts, costUsd, coveredTypes: [...covered], metrics, attempted, now: opts.now,
    isCovered: (key) => (key.startsWith('technical:') ? technicalCovered(key, data.siteChecks ?? [])
      : key.startsWith('entity:') ? entityCovered(data.siteChecks ?? []) : true),
  });
  log(`Maßnahmen: ${candidates.length} aktiv (${up.created} neu, ${up.updated} aktualisiert, ${up.deactivated} nicht mehr gestützt), `
    + `${texts.size} per KI formuliert, ${costUsd.toFixed(4)} $`);
  return {
    collectionId: target.id, candidates: candidates.length, ...up, phrased: texts.size, costUsd: costUsd + profileCost, llm: llmState,
    siteChecks: data.siteChecks?.length ?? 0,
  };
}

/** Für die Einbindung nach einer Messung: Fehler werden geloggt, nie geworfen. */
export async function generateRecommendationsSafe(workspaceId: string, opts: GenerateOptions = {}) {
  try {
    return await generateRecommendations(workspaceId, opts);
  } catch (e) {
    (opts.log ?? console.error)(`Maßnahmen konnten nicht berechnet werden: ${(e as Error)?.stack ?? e}`);
    return null;
  }
}
export * from './profile.ts';
