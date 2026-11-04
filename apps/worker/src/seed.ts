// Seed: Workspaces paylindo + medishift aus spike/config.mjs anlegen und die echten Spike-Ergebnisse
// als Collection (trigger 'import') übernehmen. Ruft keine Engine-APIs auf; die Auswertung wird aus
// spike/results/analysis wiederverwendet (nur falls sie fehlt: Claude Haiku).
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  analyzeWithLlm, costFromUsage, loadWorkspaceBrands, storeRunResult,
  type Analysis, type EngineCitation, type EngineResult,
} from '@askmetry/core';
import { brand, collection, db, prompt, run, topic, user, workspace, workspaceMember } from '@askmetry/db';
import { and, eq } from 'drizzle-orm';
import { repoRoot } from './env.ts';

const topics: Record<string, string> = {
  paylindo: 'Kartenzahlung & EC-Terminals',
  medishift: 'Dienstplanung in Arztpraxen',
};

interface SpikeBrand { name: string; aliases?: string[]; domains: string[] }
interface SpikeProject { id: string; brand: SpikeBrand; competitors: SpikeBrand[]; prompts: string[] }

async function readJson(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

export interface SeedStats {
  workspaces: string[];
  imported: Record<string, number>;
  analyzerCalls: number;
  ownerAdded: number;
}

export async function seed(opts: { owner?: string; log?: (m: string) => void } = {}): Promise<SeedStats> {
  const log = opts.log ?? console.log;
  const spikeDir = path.join(repoRoot, 'spike');
  const { projects } = (await import(pathToFileURL(path.join(spikeDir, 'config.mjs')).href)) as { projects: SpikeProject[] };
  const stats: SeedStats = { workspaces: [], imported: {}, analyzerCalls: 0, ownerAdded: 0 };

  let ownerId: string | null = null;
  if (opts.owner) {
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, opts.owner.trim().toLowerCase()));
    if (!u) throw new Error(`Kein Benutzer mit E-Mail ${opts.owner} gefunden – zuerst in der Web-App registrieren`);
    ownerId = u.id;
  }

  for (const p of projects) {
    // Workspace
    let [ws] = await db.select().from(workspace).where(eq(workspace.slug, p.id));
    if (!ws) {
      [ws] = await db.insert(workspace).values({ name: p.brand.name, slug: p.id, country: 'DE', language: 'de' }).returning();
      log(`Workspace ${p.id} angelegt`);
    }
    stats.workspaces.push(p.id);
    if (ownerId) {
      const res = await db.insert(workspaceMember).values({ workspaceId: ws.id, userId: ownerId, role: 'owner' })
        .onConflictDoNothing().returning();
      stats.ownerAdded += res.length;
    }

    // Marken (eigene + Wettbewerber)
    const existing = await loadWorkspaceBrands(ws.id);
    const wanted = [{ ...p.brand, isOwn: true }, ...p.competitors.map((c) => ({ ...c, isOwn: false }))];
    const missing = wanted.filter((b) => !existing.some((e) => e.name.toLowerCase() === b.name.toLowerCase()));
    if (missing.length) {
      await db.insert(brand).values(missing.map((b) => ({
        workspaceId: ws.id, name: b.name, aliases: b.aliases ?? [], domains: b.domains, isOwn: b.isOwn,
      })));
    }

    // Topic + Prompts
    let [t] = await db.select().from(topic).where(and(eq(topic.workspaceId, ws.id), eq(topic.name, topics[p.id] ?? p.brand.name)));
    if (!t) [t] = await db.insert(topic).values({ workspaceId: ws.id, name: topics[p.id] ?? p.brand.name }).returning();
    const existingPrompts = await db.select().from(prompt).where(eq(prompt.workspaceId, ws.id));
    const newPrompts = p.prompts.filter((text) => !existingPrompts.some((e) => e.text === text));
    if (newPrompts.length) {
      // created_at gestaffelt, damit die Reihenfolge aus der Konfiguration erhalten bleibt
      const base = Date.now();
      await db.insert(prompt).values(newPrompts.map((text, i) => ({
        workspaceId: ws.id, topicId: t.id, text, language: 'de', country: 'DE', createdAt: new Date(base + i),
      })));
    }
    const prompts = await db.select().from(prompt).where(eq(prompt.workspaceId, ws.id));
    const brands = await loadWorkspaceBrands(ws.id);

    // Import der Spike-Ergebnisse (einmalig)
    const [already] = await db.select({ id: collection.id }).from(collection)
      .where(and(eq(collection.workspaceId, ws.id), eq(collection.trigger, 'import'))).limit(1);
    if (already) { log(`${p.id}: Import existiert bereits (${already.id}) – übersprungen`); continue; }

    const rawDir = path.join(spikeDir, 'results/raw', p.id);
    const items: { engine: string; promptId: string; result: EngineResult; analysis: Analysis; at: Date }[] = [];
    let engineDirs: string[] = [];
    try { engineDirs = (await fs.readdir(rawDir)).filter((d) => !d.startsWith('.')); } catch { /* keine Ergebnisse */ }
    for (const engine of engineDirs.sort()) {
      for (const file of (await fs.readdir(path.join(rawDir, engine))).filter((f) => f.endsWith('.json')).sort()) {
        const r = await readJson(path.join(rawDir, engine, file));
        if (!r) continue;
        const pr = prompts.find((x) => x.text === r.prompt);
        if (!pr) { log(`${p.id}/${engine}/${file}: Prompt nicht gefunden – übersprungen`); continue; }
        const kind: EngineCitation['kind'] = engine === 'claude' && r.citations_from === 'search_results' ? 'searched' : 'cited';
        const usage = { ...(r.usage ?? {}) };
        if (engine === 'chatgpt' && usage.web_search_calls == null && Array.isArray(r.raw?.output)) {
          usage.web_search_calls = r.raw.output.filter((i: any) => i.type === 'web_search_call').length;
        }
        const result: EngineResult = {
          engine, model: r.model ?? engine, answer: r.answer ?? '',
          citations: (r.citations ?? []).filter((c: any) => c?.url).map((c: any) => ({ url: c.url, title: c.title ?? null, kind })),
          noAiAnswer: !!r.no_ai_answer,
          usage: r.usage ? usage : (r.cost_usd != null ? { dataforseo_cost: r.cost_usd } : null),
          costUsd: costFromUsage({ engine, model: r.model, usage, taskCost: r.cost_usd, searches: r.queries?.length }),
          raw: r.raw ?? null,
        };
        let analysis: Analysis | null = await readJson(path.join(spikeDir, 'results/analysis', p.id, engine, file));
        if (!analysis?.brands) {
          if (result.answer.trim()) {
            log(`${p.id}/${engine}/${file}: keine gespeicherte Auswertung – Claude Haiku`);
            const a = await analyzeWithLlm(result.answer, brands);
            stats.analyzerCalls++;
            analysis = { answer_type: a.answer_type, brands: a.brands };
            result.costUsd += a.costUsd;
          } else analysis = { answer_type: 'empty', brands: [] };
        }
        items.push({ engine, promptId: pr.id, result, analysis, at: new Date(r.fetched_at ?? Date.now()) });
      }
    }
    if (!items.length) { log(`${p.id}: keine Spike-Ergebnisse gefunden`); continue; }

    const times = items.map((i) => i.at.getTime());
    const first = new Date(Math.min(...times)), last = new Date(Math.max(...times));
    await db.transaction(async (tx) => {
      const [c] = await tx.insert(collection).values({
        workspaceId: ws.id, status: 'running', trigger: 'import', createdAt: first, startedAt: first,
      }).returning();
      for (const it of items) {
        const [r] = await tx.insert(run).values({
          collectionId: c.id, workspaceId: ws.id, promptId: it.promptId, engine: it.engine, repetition: 1,
          status: 'running', attempts: 1, startedAt: it.at, createdAt: it.at,
        }).returning();
        await storeRunResult(tx, {
          runId: r.id, collectionId: c.id, workspaceId: ws.id, result: it.result, analysis: it.analysis,
          brands, costUsd: it.result.costUsd, at: it.at,
        });
      }
      await tx.update(collection).set({ status: 'done', finishedAt: last }).where(eq(collection.id, c.id));
      log(`${p.id}: ${items.length} Antworten importiert (Collection ${c.id})`);
    });
    stats.imported[p.id] = items.length;
  }
  return stats;
}
