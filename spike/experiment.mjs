// Kosten-Experiment: günstigere Einstellungen für ChatGPT und Claude gegen die Spike-Ergebnisse (Baseline) vergleichen.
// Aufruf: node --env-file=.env experiment.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { projects } from './config.mjs';
import { openai, claude } from './engines.mjs';
import { analyzeAnswer } from './analyze.mjs';

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const OUT = path.resolve('results/experiment');
const PICK = { paylindo: [0, 2, 9], medishift: [0, 4, 9] };

const SEARCH_SYS = 'Recherchiere vor deiner Antwort im Web nach aktuellen Informationen und stütze dich auf die gefundenen Quellen.';
const variants = process.env.ROUND === '3' ? [
  { id: 'claude-sonnet-medium-search', engine: 'claude', run: (p) => claude(p, { model: 'claude-sonnet-5-5', effort: 'medium', maxUses: 3, system: SEARCH_SYS }) },
] : process.env.ROUND === '2' ? [
  { id: 'claude-sonnet-medium', engine: 'claude', run: (p) => claude(p, { model: 'claude-sonnet-5-5', effort: 'medium', maxUses: 3 }) },
  { id: 'chatgpt-5.5-low-r2', engine: 'chatgpt', run: (p) => openai(p, { contextSize: 'low', reasoning: 'low' }) },
] : [
  { id: 'chatgpt-5.5-low', engine: 'chatgpt', run: (p) => openai(p, { contextSize: 'low', reasoning: 'low' }) },
  { id: 'chatgpt-5.4mini', engine: 'chatgpt', run: (p) => openai(p, { model: 'gpt-5.4-mini' }) },
  { id: 'chatgpt-5.4mini-low', engine: 'chatgpt', run: (p) => openai(p, { model: 'gpt-5.4-mini', contextSize: 'low' }) },
  { id: 'claude-sonnet-low', engine: 'claude', run: (p) => claude(p, { model: 'claude-sonnet-5-5', effort: 'low', maxUses: 3 }) },
  { id: 'claude-haiku-low', engine: 'claude', run: (p) => claude(p, { model: 'claude-haiku-5-5', effort: 'low', maxUses: 3, toolType: 'web_search_20250305' }) },
];

const readJson = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; } };
const brandSet = (a) => new Set(a.brands.map((b) => (b.tracked ?? b.name).toLowerCase()));
const jaccard = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; const u = new Set([...a, ...b]).size; return u ? i / u : 1; };
const domains = (r) => new Set(r.citations.map((c) => { try { return new URL(c.url).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean));

const rows = [];
const jobs = [];
for (const project of projects) for (const pi of PICK[project.id]) {
  const prompt = project.prompts[pi];
  for (const v of variants) jobs.push(async () => {
    const base = await readJson(path.join('results/raw', project.id, v.engine, `${hash(prompt)}.json`));
    const baseA = base && await analyzeCached(path.join(OUT, 'base', v.engine, `${hash(prompt)}.json`), base.answer, project);
    const file = path.join(OUT, v.id, `${hash(prompt)}.json`);
    let r = await readJson(file);
    if (!r) {
      try { r = await v.run(prompt); } catch (e) { console.log(`✗ ${v.id} ${project.id}#${pi}: ${e.message}`); return; }
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(r, null, 2));
    }
    const a = await analyzeCached(path.join(OUT, 'analysis', v.id, `${hash(prompt)}.json`), r.answer, project);
    const own = project.brand.name.toLowerCase();
    rows.push({
      variant: v.id, project: project.id, pi,
      usage: r.usage, model: r.model,
      jaccard: baseA ? jaccard(brandSet(a), brandSet(baseA)) : null,
      ownMatch: baseA ? brandSet(a).has(own) === brandSet(baseA).has(own) : null,
      ownNamed: brandSet(a).has(own),
      domainJaccard: base ? jaccard(domains(r), domains(base)) : null,
      brands: a.brands.length, citations: r.citations.length,
    });
    console.log(`✓ ${v.id} ${project.id}#${pi}`);
  });
}

async function analyzeCached(file, answer, project) {
  const c = await readJson(file);
  if (c) return c;
  const a = await analyzeAnswer(answer, project);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(a));
  return a;
}

let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) await jobs[i++](); }));
await fs.writeFile(path.join(OUT, `summary${process.env.ROUND ?? ''}.json`), JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} Ergebnisse → ${path.join(OUT, 'summary.json')}`);
