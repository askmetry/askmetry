// Askmetry-Worker: Scheduler-Schleife + CLI
//   start                          Schleife (alle 60 s): fällige geplante Messungen anlegen, Warteschlange abarbeiten
//   once                           Warteschlange abarbeiten, dann beenden
//   collect --workspace <slug> [--mock] [--batch]   manuelle Messung anlegen und sofort abarbeiten
//                                  (--batch: Claude über die Message Batches API wie bei geplanten Messungen;
//                                   Ergebnisse holt `once`/`start` später ab)
//   seed [--owner <email>]         Demo-Workspaces + Spike-Ergebnisse importieren
//   recommend --workspace <slug> [--no-llm] [--collection <id>] [--force-site-check]
//                                  Maßnahmen aus der letzten abgeschlossenen Messung neu berechnen
//   profile --workspace <slug> [--force]   Beschreibung + Markentyp der eigenen Marke von der Website ableiten
//   logos --workspace <slug> [--force]      Website-Icons der Marken holen (kostenlos)
//   backfill-searched [--workspace <slug>]  durchsuchte Quellen (kind 'searched') aus gespeicherten ChatGPT-/Claude-Rohdaten nachtragen
//   Gehostete Version (ASKMETRY_HOSTED=1): `start` verarbeitet zusätzlich Schnell-Checks und Berichte (PDF, Mails, Erinnerungen)
//   und führt 1×/Tag die Löschfristen aus.
//   stats [--days 30]                       Beta-Kennzahlen (Funnel, Conversion, Kosten, Umsetzungs-/Nachmessungsquote)
//   check --url <url> [--lang de|en] [--real]  Discovery testweise (Standard: Fake ohne Netz/Kosten; --real = Website + Sonnet)
//   report-pdf --report <id> --out <datei>  PDF eines Berichts erzeugen (@askmetry/report)
//   purge                                   Löschfristen sofort anwenden
import './env.ts';
import { writeFileSync } from 'node:fs';
import {
  analyzePendingResponses, autofillBrandProfile, refreshLogos, backfillSearchedCitations, createCollection, createDueScheduledCollections, finishedCollections, generateRecommendations, isMockMode,
  listProcessableCollections, processCollection,
} from '@askmetry/core';
import { recommendation } from '@askmetry/db';
import { closeDb, db, workspace } from '@askmetry/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { seed } from './seed.ts';
import { hostedConfigProblems, isHosted } from '@askmetry/core/hosted/config';
import { checksWaiting, hasActiveChecks, normalizeCheckUrl, processChecks } from '@askmetry/core/hosted/checks';
import { processReports } from '@askmetry/core/hosted/reports';
import { discoverBrand } from '@askmetry/core/hosted/discovery';
import { funnelStats } from '@askmetry/core/hosted/stats';
import { purgeExpiredData } from '@askmetry/core/hosted/retention';

const ts = () => new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
const log = (m: string) => console.log(`[${ts()}] ${m}`);

function parseArgs(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`Unerwartetes Argument: ${a}`);
    const [k, inline] = a.slice(2).split('=');
    if (inline !== undefined) flags[k] = inline;
    else if (rest[i + 1] && !rest[i + 1].startsWith('--')) flags[k] = rest[++i];
    else flags[k] = true;
  }
  return { cmd, flags };
}

async function workspaceBySlug(slug: string) {
  const [ws] = await db.select().from(workspace).where(eq(workspace.slug, slug));
  if (!ws) throw new Error(`Workspace ${slug} nicht gefunden`);
  return ws;
}

let stopping = false;
const shouldStop = () => stopping;

/** Lebenszeichen für Docker-Healthchecks: Datei aus ASKMETRY_HEARTBEAT_FILE bei jedem Fortschritt anfassen. */
const HEARTBEAT = process.env.ASKMETRY_HEARTBEAT_FILE;
function heartbeat() {
  if (!HEARTBEAT) return;
  try { writeFileSync(HEARTBEAT, new Date().toISOString()); } catch (e) { log(`Heartbeat nicht schreibbar: ${(e as Error).message}`); }
}

/**
 * Alle offenen Collections nacheinander abarbeiten (jede höchstens einmal pro Durchgang), danach ausstehende
 * Auswertungen nachholen. Fehler einer Collection brechen den Durchgang nicht ab – andere Workspaces laufen weiter.
 */
async function drainQueue() {
  const seen = new Set<string>();
  const hosted = isHosted();
  while (!stopping) {
    let list = (await listProcessableCollections()).filter((c) => !seen.has(c.id));
    // Gehostet: Messungen der Schnell-Checks zuerst (Teaser soll in wenigen Minuten fertig sein)
    const checkWs = hosted ? await checkWorkspaceIds(list.map((c) => c.workspaceId)) : new Set<string>();
    list = [...list.filter((c) => checkWs.has(c.workspaceId)), ...list.filter((c) => !checkWs.has(c.workspaceId))];
    const next = list[0];
    if (!next) break;
    // neue Check-Arbeit wartet (Discovery/Einreihen) → Schleife freigeben, Bericht läuft im nächsten Durchgang weiter
    if (hosted && !checkWs.has(next.workspaceId) && checkWaiting) break;
    // Schnell-Checks: bis zu CHECK_PARALLEL Messungen gleichzeitig (jeder Nutzer wartet live auf sein Ergebnis)
    if (hosted && checkWs.has(next.workspaceId)) {
      const group = list.filter((c) => checkWs.has(c.workspaceId)).slice(0, CHECK_PARALLEL);
      for (const c of group) seen.add(c.id);
      heartbeat();
      await Promise.all(group.map(async (c) => {
        log(`Check-Messung ${c.id} (${c.status}) wird abgearbeitet`);
        try {
          const s = await processCollection(c.id, { shouldStop, log });
          log(`Check-Messung ${c.id}: ${s.status} – ${s.done} fertig, ${s.failed} fehlgeschlagen, ${s.pending} offen, ${s.costUsd.toFixed(4)} $`);
        } catch (e) {
          log(`Check-Messung ${c.id} abgebrochen: ${(e as Error)?.stack ?? e}`);
        }
      }));
      // Teaser sofort fertigstellen (nicht erst nach den übrigen Messungen)
      await processChecks({ log, shouldStop }).catch((e) => log(`Schnell-Checks: Fehler ${(e as Error)?.stack ?? e}`));
      continue;
    }
    seen.add(next.id);
    heartbeat();
    log(`Messung ${next.id} (${next.status}) wird abgearbeitet`);
    try {
      // lange Berichts-Messungen unterbrechen, sobald ein Schnell-Check wartet (keine neuen Runs; offene laufen zu Ende)
      const stop = hosted ? () => stopping || checkWaiting : shouldStop;
      const s = await processCollection(next.id, { shouldStop: stop, log });
      log(`Messung ${next.id}: ${s.status} – ${s.done} fertig, ${s.failed} fehlgeschlagen, ${s.skipped} übersprungen, ${s.pending} offen${s.batchPending ? ` (davon ${s.batchPending} im Claude-Batch, Abholung im nächsten Durchgang)` : ''}, ${s.costUsd.toFixed(4)} $${s.analysisPending ? `, ${s.analysisPending} Auswertungen ausstehend` : ''}`);
    } catch (e) {
      log(`Messung ${next.id} abgebrochen: ${(e as Error)?.stack ?? e}`);
    }
  }
  if (stopping) return;
  try {
    await analyzePendingResponses({ shouldStop, log });
  } catch (e) {
    log(`Nachträgliche Auswertung fehlgeschlagen: ${(e as Error)?.stack ?? e}`);
  }
}

type RenderPdf = (reportId: string) => Promise<Buffer>;
let renderPdfCache: RenderPdf | null | undefined;
/** renderReportPdf aus @askmetry/report (dynamisch, damit der Worker auch ohne das Paket startet). */
async function loadRenderPdf(): Promise<RenderPdf | null> {
  if (renderPdfCache !== undefined) return renderPdfCache;
  try {
    const spec = '@askmetry/report';
    const mod: any = await import(spec);
    if (typeof mod.renderReportPdf !== 'function') throw new Error('renderReportPdf fehlt im Paket');
    renderPdfCache = mod.renderReportPdf as RenderPdf;
  } catch (e) {
    log(`PDF-Renderer (@askmetry/report) nicht verfügbar: ${(e as Error)?.message ?? e} – Berichte warten auf das PDF`);
    renderPdfCache = null;
  }
  return renderPdfCache;
}

/** IDs der Check-Arbeitsbereiche (hosted_kind = 'check') unter den gegebenen. */
async function checkWorkspaceIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ id: workspace.id }).from(workspace).where(and(inArray(workspace.id, ids), eq(workspace.hostedKind, 'check')));
  return new Set(rows.map((r) => r.id));
}

/** Schnell-Check-Messungen, die gleichzeitig laufen (je mit CHECK_SCOPE.concurrency parallelen Abfragen) */
const CHECK_PARALLEL = 2;

/** Gehostet: wartet ein Schnell-Check auf Discovery oder auf seine Messung? (alle 3 s aktualisiert – der Nutzer schaut zu) */
let checkWaiting = false;
let wakeLoop: (() => void) | undefined;
function watchChecks() {
  const t = setInterval(() => {
    // neuer Check wartet → Schlafpause der Schleife sofort beenden
    checksWaiting().then((v) => { checkWaiting = v; if (v) wakeLoop?.(); }).catch(() => {});
  }, 3_000);
  t.unref();
}

let lastPurgeDay = '';
/** Gehostete Jobs: Checks, Berichte, 1×/Tag Löschfristen. Fehler brechen die Schleife nicht ab. */
async function hostedTick() {
  try { await processChecks({ log, shouldStop }); } catch (e) { log(`Schnell-Checks: Fehler ${(e as Error)?.stack ?? e}`); }
  if (stopping) return;
  try {
    const renderPdf = await loadRenderPdf();
    await processReports({ log, shouldStop, ...(renderPdf && { renderPdf }) });
  } catch (e) { log(`Berichte: Fehler ${(e as Error)?.stack ?? e}`); }
  const day = new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  if (day !== lastPurgeDay && !stopping) {
    try {
      const p = await purgeExpiredData();
      lastPurgeDay = day;
      log(`Löschfristen: ${p.ipHashes} IP-Hashes, ${p.emails} unbestätigte E-Mails, ${p.checks} Checks (${p.workspaces} Arbeitsbereiche), ${p.funnelEvents} Funnel-Ereignisse entfernt`);
    } catch (e) { log(`Löschfristen: Fehler ${(e as Error)?.stack ?? e}`); }
  }
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (flags.mock) process.env.ASKMETRY_MOCK_ENGINES = '1';
  if (isMockMode()) log('Mock-Modus aktiv (ASKMETRY_MOCK_ENGINES=1): keine echten API-Aufrufe');

  switch (cmd) {
    case 'start': {
      const onSignal = (sig: string) => {
        if (stopping) return;
        stopping = true;
        log(`${sig} empfangen – laufende Abfragen werden beendet, dann Stopp`);
        wake?.();
      };
      process.on('SIGTERM', () => onSignal('SIGTERM'));
      process.on('SIGINT', () => onSignal('SIGINT'));
      let wake: (() => void) | undefined;
      const hosted = isHosted();
      log(`Worker gestartet (Intervall 60 s${hosted ? ', gehostete Version: neue Schnell-Checks nach höchstens 3 s, 10 s solange welche laufen' : ''})`);
      if (hosted) { for (const p of hostedConfigProblems()) log(`Konfiguration: ${p}`); watchChecks(); }
      while (!stopping) {
        let fast = false;
        try {
          heartbeat();
          // ASKMETRY_SCHEDULER=0: keine Zeitpläne auslösen (z. B. Test-Worker im Mock-Modus neben echten Arbeitsbereichen)
          if (process.env.ASKMETRY_SCHEDULER !== "0") await createDueScheduledCollections(new Date(), log);
          if (hosted) await hostedTick(); // Checks vor der Warteschlange: neue Check-Messungen laufen im selben Durchgang
          await drainQueue();
          if (hosted && !stopping) { await hostedTick(); fast = await hasActiveChecks(); }
        } catch (e) {
          log(`Fehler im Durchlauf: ${(e as Error).stack ?? e}`);
        }
        if (stopping) break;
        await new Promise<void>((r) => { const t = setTimeout(r, fast ? 10_000 : 60_000); wake = () => { clearTimeout(t); r(); }; wakeLoop = wake; });
        wakeLoop = undefined;
      }
      log('Worker beendet');
      break;
    }
    case 'once':
      await drainQueue();
      break;
    case 'collect': {
      const slug = flags.workspace;
      if (typeof slug !== 'string') throw new Error('collect --workspace <slug> [--mock] [--batch]');
      const [ws] = await db.select().from(workspace).where(eq(workspace.slug, slug));
      if (!ws) throw new Error(`Workspace ${slug} nicht gefunden`);
      const c = await createCollection(ws.id, 'manual');
      log(`Messung ${c.id} für ${slug} angelegt`);
      const s = await processCollection(c.id, { log, ...(flags.batch && { batch: true }) });
      log(`Messung ${c.id}: ${s.status} – ${s.done} fertig, ${s.failed} fehlgeschlagen, ${s.skipped} übersprungen, ${s.costUsd.toFixed(4)} $${s.batchPending ? ` – ${s.batchPending} Runs im Claude-Batch, Ergebnisse holt \`once\`/\`start\` ab` : ''}`);
      break;
    }
    case 'seed': {
      const s = await seed({ owner: typeof flags.owner === 'string' ? flags.owner : undefined, log });
      log(`Seed fertig: ${s.workspaces.join(', ')}; importiert: ${JSON.stringify(s.imported)}; Analyse-Aufrufe: ${s.analyzerCalls}; Owner ergänzt: ${s.ownerAdded}`);
      break;
    }
    case 'recommend': {
      const slug = flags.workspace;
      if (typeof slug !== 'string') throw new Error('recommend --workspace <slug> [--no-llm] [--collection <id>] [--force-site-check]');
      const ws = await workspaceBySlug(slug);
      if (typeof flags.collection === 'string') {
        const [latest] = await finishedCollections(ws.id, 1);
        if (latest && latest.id !== flags.collection) {
          log(`WARNUNG: ${flags.collection} ist nicht die neueste abgeschlossene Messung (${latest.id}). Die Maßnahmen werden mit älteren Daten überschrieben, bis die nächste Messung sie neu berechnet.`);
        }
      }
      const s = await generateRecommendations(ws.id, {
        llm: !flags['no-llm'], log,
        collectionId: typeof flags.collection === 'string' ? flags.collection : undefined,
        forceSiteCheck: !!flags['force-site-check'],
      });
      log(`Maßnahmen ${slug}: Messung ${s.collectionId ?? '–'}, ${s.candidates} aktiv, ${s.created} neu, ${s.updated} aktualisiert, ${s.deactivated} inaktiv, KI: ${s.llm} (${s.phrased} formuliert, ${s.costUsd.toFixed(4)} $)`);
      const rows = await db.select().from(recommendation)
        .where(and(eq(recommendation.workspaceId, ws.id), eq(recommendation.active, true))).orderBy(desc(recommendation.priority));
      for (const r of rows) console.log(`  ${Number(r.priority).toFixed(2).padStart(6)}  [${r.type}] ${r.title}  (Wirkung ${r.impact}, Aufwand ${r.effort}, ${r.status})`);
      break;
    }
    case 'profile': {
      const slug = flags.workspace;
      if (typeof slug !== 'string') throw new Error('profile --workspace <slug> [--force]');
      const ws = await workspaceBySlug(slug);
      const g = await autofillBrandProfile(ws.id, { force: !!flags.force, log });
      if (!g) log('Markenprofil: nicht geprüft (von Hand gesetzt oder kürzlich geprüft – mit --force wiederholen)');
      else log(`Markenprofil ${slug}: ${g.description ?? '–'} | Typ: ${g.kind ?? '–'} | Quelle: ${g.source} (${g.url ?? '–'}) | ${g.costUsd.toFixed(4)} $${g.error ? ` | ${g.error}` : ''}`);
      break;
    }
    case 'logos': {
      const slug = flags.workspace;
      if (typeof slug !== 'string') throw new Error('logos --workspace <slug> [--force]');
      const ws = await workspaceBySlug(slug);
      await refreshLogos(ws.id, { force: !!flags.force, log });
      break;
    }
    case 'backfill-searched': {
      const slug = flags.workspace;
      const ws = typeof slug === 'string' ? await workspaceBySlug(slug) : null;
      await backfillSearchedCitations({ workspaceId: ws?.id, log });
      break;
    }
    case 'stats': {
      const days = typeof flags.days === 'string' ? Number(flags.days) : 30;
      const s = await funnelStats({ days });
      const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)} %`);
      console.log(`Beta-Kennzahlen der letzten ${s.days} Tage (seit ${s.since.slice(0, 10)})`);
      console.log(`  Checks gestartet/bestätigt/fertig: ${s.checksStarted} / ${s.checksVerified} / ${s.checksReady}`);
      console.log(`  Käufe: ${s.purchases} Berichte, ${s.remeasurePurchases} Nachmessungen, Umsatz ${(s.revenueCents / 100).toFixed(2)} € netto`);
      console.log(`  Conversion bestätigt → Kauf: ${pct(s.conversionVerifiedToPurchase)}`);
      console.log(`  Teaser-Kosten: ${s.checkCostUsd.toFixed(2)} $ gesamt, ${s.teaserCostPerPayingCustomerUsd == null ? '–' : `${s.teaserCostPerPayingCustomerUsd.toFixed(2)} $`} je zahlendem Kunden`);
      console.log(`  Umsetzungsrate nach 8 Wochen: ${s.implementationRate.done} von ${s.implementationRate.total} Maßnahmen (${pct(s.implementationRate.rate)})`);
      console.log(`  Nachmessungs-Quote: ${s.remeasureRate.remeasured} von ${s.remeasureRate.eligible} (${pct(s.remeasureRate.rate)})`);
      break;
    }
    case 'check': {
      if (typeof flags.url !== 'string') throw new Error('check --url <url> [--lang de|en] [--real]');
      const t = normalizeCheckUrl(flags.url);
      if (!t) throw new Error('Ungültige oder unzulässige URL');
      const d = await discoverBrand({ ...t, locale: flags.lang === 'en' ? 'en' : 'de' }, { mock: !flags.real });
      log(`Discovery ${t.domain} (${d.source}, ${d.costUsd.toFixed(4)} $): ${d.brandName} – ${d.description ?? 'ohne Beschreibung'} | Typ: ${d.kind ?? '–'} | Thema: ${d.topic}`);
      console.log('Wettbewerber:'); for (const c of d.competitors) console.log(`  ${c.name}${c.domain ? ` (${c.domain})` : ''}`);
      console.log('Fragen:'); d.prompts.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${p}`));
      break;
    }
    case 'report-pdf': {
      if (typeof flags.report !== 'string' || typeof flags.out !== 'string') throw new Error('report-pdf --report <id> --out <datei>');
      const render = await loadRenderPdf();
      if (!render) throw new Error('@askmetry/report nicht verfügbar');
      const pdf = await render(flags.report);
      writeFileSync(flags.out, pdf);
      log(`PDF geschrieben: ${flags.out} (${pdf.length} Byte)`);
      break;
    }
    case 'purge': {
      const p = await purgeExpiredData();
      log(`Löschfristen: ${JSON.stringify(p)}`);
      break;
    }
    default:
      console.log('Verwendung: worker <start|once|stats [--days 30]|check --url <url> [--real]|report-pdf --report <id> --out <datei>|purge|collect --workspace <slug> [--mock]|seed [--owner <email>]|recommend --workspace <slug> [--no-llm]|profile --workspace <slug> [--force]|backfill-searched [--workspace <slug>]>');
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => closeDb());
