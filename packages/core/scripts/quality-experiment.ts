// Qualitäts-Experiment: günstigere Engine-Einstellungen gegen die teure Referenz-Messung vom 31.10.2026.
// Aufruf (aus dem Repo-Root): node --env-file=.env packages/core/scripts/quality-experiment.ts [--report]
// Ergebnisse werden je Variante/Prompt/Wiederholung in spike/quality/results/ zwischengespeichert,
// ein erneuter Aufruf fragt nur Fehlendes ab (kostet dann nichts).
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { brand, citation, closeDb, collection, db, prompt, response, run, workspace } from '@askmetry/db';
import { analyzeWithLlm } from '../src/analyze.ts';
import { chatgpt } from '../src/engines/chatgpt.ts';
import { claude } from '../src/engines/claude.ts';
import { engineDefaults } from '../src/engine-config.ts';
import { costFromUsage } from '../src/pricing.ts';
import type { BrandRef, Engine, EngineCitation } from '../src/types.ts';

const OUT = path.resolve(import.meta.dirname, '../../../spike/quality/results');
const REPS = 2;
const SLUGS = ['paylindo', 'medishift'];

type Variant = { id: string; engine: Engine; options: Record<string, unknown> };
const variants: Variant[] = [
  // aktueller Standard, über flex (gleiches Modell, halber Preis)
  { id: 'chatgpt-gpt55-low-flex', engine: chatgpt, options: { ...engineDefaults.chatgpt, serviceTier: 'flex' } },
  // das Modell der ChatGPT-App
  { id: 'chatgpt-chat-latest', engine: chatgpt, options: { model: 'chat-latest' } },
  // aktueller Standard (Sonnet 5.5, mittlere Denktiefe, max. 3 Suchen, Such-Anweisung)
  { id: 'claude-sonnet-default', engine: claude, options: { ...engineDefaults.claude } },
];

type Sample = { answer: string; citations: EngineCitation[]; costUsd: number; model: string; searches: number; sec?: number };
type Scored = Sample & { brands: string[]; own: boolean; ownRecommended: boolean; top3: string[]; domains: string[] };

const readJson = async (f: string) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; } };
const writeJson = async (f: string, v: unknown) => { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(v, null, 1)); };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const jaccard = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); const u = new Set([...A, ...B]).size; return u ? [...A].filter((x) => B.has(x)).length / u : 1; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const searchesOf = (usage: any) => Number(usage?.web_search_calls ?? usage?.server_tool_use?.web_search_requests ?? 0);

// --- Daten laden -----------------------------------------------------------------
const wss = await db.select().from(workspace).where(inArray(workspace.slug, SLUGS));
const items: { ws: string; promptId: string; text: string; country: string; brands: BrandRef[] }[] = [];
for (const ws of wss) {
  const bs = await db.select({ name: brand.name, aliases: brand.aliases, domains: brand.domains, isOwn: brand.isOwn, description: brand.description }).from(brand).where(eq(brand.workspaceId, ws.id));
  const ps = await db.select().from(prompt).where(and(eq(prompt.workspaceId, ws.id), eq(prompt.active, true)));
  for (const p of ps) items.push({ ws: ws.slug, promptId: p.id, text: p.text, country: p.country, brands: bs });
}

// Referenz: teure Messung vom 31.10. (gpt-5.5 Standard-Suchkontext, Claude Opus 5.5)
async function reference(engineKey: 'chatgpt' | 'claude', promptId: string): Promise<Sample | null> {
  const rows = await db.select({ id: response.id, answer: response.answer, usage: response.usage, model: run.model, cost: run.costUsd })
    .from(run).innerJoin(response, eq(response.runId, run.id)).innerJoin(collection, eq(collection.id, run.collectionId))
    .where(and(eq(run.promptId, promptId), eq(run.engine, engineKey), inArray(run.model, ['gpt-5.5', 'claude-opus-5-5'])));
  const r = rows[0];
  if (!r) return null;
  const cs = await db.select({ url: citation.url, title: citation.title, kind: citation.kind }).from(citation).where(eq(citation.responseId, r.id));
  return { answer: r.answer, citations: cs, costUsd: Number(r.cost), model: r.model ?? '', searches: searchesOf(r.usage) };
}

async function score(file: string, s: Sample, brands: BrandRef[]): Promise<Scored> {
  let a = await readJson(file);
  if (!a) { a = await analyzeWithLlm(s.answer, brands); await writeJson(file, a); }
  const own = brands.find((b) => b.isOwn)!.name.toLowerCase();
  const names = (a.brands as any[]).sort((x, y) => x.position - y.position).map((b) => (b.tracked ?? b.name).toLowerCase());
  const ownB = (a.brands as any[]).find((b) => (b.tracked ?? b.name).toLowerCase() === own);
  const cited = s.citations.filter((c) => c.kind === 'cited');
  return { ...s, brands: names, own: !!ownB, ownRecommended: !!ownB?.recommended, top3: names.slice(0, 3),
    domains: [...new Set((cited.length ? cited : s.citations).map((c) => host(c.url ?? '')).filter(Boolean) as string[])] };
}

// --- Abfragen (mit Zwischenspeicher) -------------------------------------------------
const jobs: (() => Promise<void>)[] = [];
for (const v of variants) for (const it of items) for (let rep = 1; rep <= REPS; rep++) {
  const file = path.join(OUT, v.id, `${it.promptId}-${rep}.json`);
  jobs.push(async () => {
    if (await readJson(file)) return;
    const t = Date.now();
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await v.engine.run(it.text, { country: it.country, language: 'de', options: v.options });
        await writeJson(file, { answer: r.answer, citations: r.citations, costUsd: r.costUsd, model: r.model, searches: searchesOf(r.usage), sec: (Date.now() - t) / 1000, usage: r.usage });
        console.log(`✓ ${v.id} ${it.ws} ${rep} ${r.costUsd.toFixed(3)} $`);
        return;
      } catch (e: any) {
        console.log(`✗ ${v.id} ${it.ws} ${rep} (Versuch ${attempt}): ${e.message.slice(0, 160)}`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
  });
}
if (!process.argv.includes('--report')) {
  // je Anbieter höchstens 3 gleichzeitig
  const byProv = new Map<string, typeof jobs>();
  jobs.forEach((j, i) => { const prov = variants[Math.floor(i / (items.length * REPS))].engine.provider; byProv.set(prov, [...(byProv.get(prov) ?? []), j]); });
  await Promise.all([...byProv.values()].flatMap((list) => { let i = 0; return Array.from({ length: 3 }, async () => { while (i < list.length) await list[i++](); }); }));
}

// --- Auswertung ---------------------------------------------------------------------
type Row = Record<string, string | number>;
const table: Row[] = [];
for (const engineKey of ['chatgpt', 'claude'] as const) {
  const refRows: Scored[] = [];
  const refByPrompt = new Map<string, Scored>();
  for (const it of items) {
    const ref = await reference(engineKey, it.promptId);
    if (!ref) continue;
    const sc = await score(path.join(OUT, 'analysis', `ref-${engineKey}`, `${it.promptId}.json`), ref, it.brands);
    refByPrompt.set(it.promptId, sc); refRows.push(sc);
  }
  const summarize = (id: string, samples: { promptId: string; reps: Scored[] }[]) => {
    const all = samples.flatMap((s) => s.reps);
    const within = samples.filter((s) => s.reps.length >= 2).map((s) => jaccard(s.reps[0].brands, s.reps[1].brands));
    const vsRef = samples.flatMap((s) => { const r = refByPrompt.get(s.promptId); return r ? s.reps.map((x) => jaccard(x.brands, r.brands)) : []; });
    const domVsRef = samples.flatMap((s) => { const r = refByPrompt.get(s.promptId); return r ? s.reps.map((x) => jaccard(x.domains, r.domains)) : []; });
    const ownAgree = samples.flatMap((s) => { const r = refByPrompt.get(s.promptId); return r ? s.reps.map((x) => (x.own === r.own ? 1 : 0)) : []; });
    table.push({
      variante: id, n: all.length,
      'Kosten/Anfrage $': +mean(all.map((x) => x.costUsd)).toFixed(4),
      'Websuche genutzt %': Math.round(100 * mean(all.map((x) => (x.searches > 0 || x.citations.length > 0 ? 1 : 0)))),
      'Ø Quellen-Domains': +mean(all.map((x) => x.domains.length)).toFixed(1),
      'Ø Marken': +mean(all.map((x) => x.brands.length)).toFixed(1),
      'Eigene Marke genannt %': Math.round(100 * mean(all.map((x) => (x.own ? 1 : 0)))),
      'Marken-Übereinst. mit sich selbst': within.length ? +mean(within).toFixed(2) : '–',
      'Marken-Übereinst. mit Referenz': vsRef.length ? +mean(vsRef).toFixed(2) : '–',
      'Quellen-Übereinst. mit Referenz': domVsRef.length ? +mean(domVsRef).toFixed(2) : '–',
      'Eigene Marke gleich wie Referenz %': ownAgree.length ? Math.round(100 * mean(ownAgree)) : '–',
      'Ø Sekunden': +mean(all.map((x) => x.sec ?? NaN).filter((x) => !Number.isNaN(x))).toFixed(0) || '–',
    });
  };
  summarize(`REFERENZ ${engineKey}`, items.filter((it) => refByPrompt.has(it.promptId)).map((it) => ({ promptId: it.promptId, reps: [refByPrompt.get(it.promptId)!] })));
  for (const v of variants.filter((v) => v.engine.key === engineKey)) {
    const samples: { promptId: string; reps: Scored[] }[] = [];
    for (const it of items) {
      const reps: Scored[] = [];
      for (let rep = 1; rep <= REPS; rep++) {
        const s = await readJson(path.join(OUT, v.id, `${it.promptId}-${rep}.json`));
        // Kosten mit der aktuellen Preistabelle neu berechnen (z. B. flex-Rabatt)
        if (s?.usage) s.costUsd = costFromUsage({ engine: engineKey, model: s.model, usage: s.usage });
        if (s) reps.push(await score(path.join(OUT, 'analysis', v.id, `${it.promptId}-${rep}.json`), s, it.brands));
      }
      samples.push({ promptId: it.promptId, reps });
    }
    summarize(v.id, samples);
  }
}
console.table(table);
await writeJson(path.join(OUT, 'summary.json'), table);
await closeDb();
