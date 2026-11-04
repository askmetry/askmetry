// Askmetry-Spike: Prompts an alle Engines schicken, Antworten auswerten, Bericht schreiben.
// Aufruf: npm run spike -- [--limit 2] [--engines chatgpt,claude] [--project paylindo] [--report-only]
// Ergebnisse werden zwischengespeichert; ein zweiter Lauf fragt nur Fehlendes neu ab.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { projects, settings } from './config.mjs';
import { engines } from './engines.mjs';
import { analyzeAnswer } from './analyze.mjs';

// --- Argumente ---
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) throw new Error(`Unerwartetes Argument: ${a}`);
  const [key, inline] = a.slice(2).split('=');
  if (key === 'report-only') { args[key] = true; continue; }
  args[key] = inline ?? process.argv[++i];
}
const limit = args.limit === undefined ? Infinity : Number(args.limit);
if (!(limit > 0)) throw new Error(`--limit muss eine positive Zahl sein, nicht "${args.limit}"`);
const engineKeys = (args.engines?.split(',') ?? Object.keys(engines)).filter((k) => {
  if (!engines[k]) throw new Error(`Unbekannte Engine: ${k}`);
  if (!engines[k].enabled()) { console.log(`– ${k}: kein Schlüssel, übersprungen`); return false; }
  return true;
});
const selected = projects.filter((p) => !args.project || p.id === args.project);
if (!selected.length) throw new Error(`Unbekanntes Projekt: ${args.project}`);
const OUT = path.resolve('results');

// --- Hilfsfunktionen ---
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const norm = (s) => s?.trim().toLowerCase();
const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};
// exakte Domain oder Subdomain – "notpaylindo.de" zählt nicht als "paylindo.de"
const matchesDomain = (host, d) => !!host && (host === d || host.endsWith(`.${d}`));

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function pool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) await tasks[i++]();
  }));
}

// Grobe Preise (USD) für die Kostenschätzung – vor echter Nutzung prüfen.
const PRICES = {
  chatgpt: { in: 5 / 1e6, out: 30 / 1e6, search: 10 / 1000 },
  gemini: { in: 0.5 / 1e6, out: 3 / 1e6, search: 14 / 1000 },
  claude: { in: 4 / 1e6, out: 20 / 1e6, search: 10 / 1000 },
  perplexity: { in: 1 / 1e6, out: 1 / 1e6, search: 5 / 1000 },
};

function estimateCost(r) {
  if (r.cost_usd != null) return r.cost_usd;
  if (r.usage?.cost?.total_cost != null) return r.usage.cost.total_cost; // Perplexity meldet Kosten selbst
  const p = PRICES[r.engine];
  if (!p) return 0;
  const u = r.usage ?? {};
  const inTok = u.input_tokens ?? u.prompt_tokens ?? u.promptTokenCount ?? 0;
  const outTok = u.output_tokens ?? u.completion_tokens ?? ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0));
  const searches = u.server_tool_use?.web_search_requests ?? u.web_search_calls ?? r.queries?.length ?? 1;
  return inTok * p.in + outTok * p.out + searches * p.search;
}

// Marken einer Antwort zusammenfassen: jede Marke höchstens einmal, beste Position, empfohlen wenn irgendwo empfohlen
function brandsOf(analysis, project) {
  const canonical = new Map([project.brand, ...project.competitors].flatMap((b) =>
    [b.name, ...(b.aliases ?? [])].map((n) => [norm(n), b.name])));
  const merged = new Map();
  for (const b of analysis.brands) {
    const name = canonical.get(norm(b.tracked)) ?? canonical.get(norm(b.name)) ?? b.name;
    const prev = merged.get(name);
    merged.set(name, prev
      ? { ...prev, position: Math.min(prev.position, b.position), recommended: prev.recommended || b.recommended }
      : { ...b, name });
  }
  return [...merged.values()];
}

// --- 1) Abfragen + Auswertung ---
const rows = [];
const tasks = [];
for (const project of selected) {
  const trackedKey = hash(JSON.stringify([project.brand, project.competitors]));
  project.prompts.slice(0, limit).forEach((prompt, pi) => {
    for (const engine of engineKeys) {
      tasks.push(async () => {
        const base = { project: project.id, engine, pi, prompt };
        const file = path.join(OUT, 'raw', project.id, engine, `${hash(prompt)}.json`);
        let result = await readJson(file);
        if (!result && !args['report-only']) {
          try {
            result = await engines[engine].run(prompt);
            // leere Antwort nur speichern, wenn die Engine bewusst keine KI-Antwort gezeigt hat
            if (!result.answer?.trim() && !result.no_ai_answer) throw new Error('leere Antwort');
            result.prompt = prompt;
            result.fetched_at = new Date().toISOString();
            await writeJson(file, result);
            console.log(`✓ ${project.id} ${engine} #${pi}`);
          } catch (e) {
            console.log(`✗ ${project.id} ${engine} #${pi}: ${e.message}`);
            rows.push({ ...base, error: e.message });
            return;
          }
        }
        if (!result) return;
        const aFile = path.join(OUT, 'analysis', project.id, engine, `${hash(prompt)}.json`);
        const key = hash(result.answer + trackedKey);
        let analysis = await readJson(aFile);
        if (analysis?.key !== key) {
          try {
            analysis = { key, ...(await analyzeAnswer(result.answer, project)) };
            await writeJson(aFile, analysis);
          } catch (e) {
            console.log(`✗ Analyse ${project.id} ${engine} #${pi}: ${e.message}`);
            rows.push({ ...base, result, error: `Analyse: ${e.message}` });
            return;
          }
        }
        rows.push({ ...base, result, analysis, brands: brandsOf(analysis, project) });
      });
    }
  });
}
await pool(tasks, settings.concurrency);

// --- 2) Bericht ---
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '–');
let md = `# Askmetry-Spike – Ergebnis\n\nStand: ${new Date().toLocaleString('de-DE')}\n\n`;
md += `Engines: ${engineKeys.join(', ')} · Modelle: ${Object.entries(settings.models).map(([k, v]) => `${k}=${v}`).join(', ')}\n\n`;
md += `Hinweis: Wo eine Engine keine Zitate im Text liefert (bisher Claude), zählen die durchsuchten Seiten als Quellen – markiert mit ¹.\n\n`;

let totalCost = 0;
for (const project of selected) {
  const pr = rows.filter((r) => r.project === project.id);
  const ok = pr.filter((r) => r.analysis);
  const answered = ok.filter((r) => r.result.answer?.trim());
  const own = project.brand.name;
  const ownDomains = project.brand.domains;
  const compDomains = project.competitors.flatMap((c) => c.domains.map((d) => [d, c.name]));
  const isOwn = (url) => ownDomains.some((d) => matchesDomain(domainOf(url), d));
  md += `## ${own}\n\n`;

  // Kennzahlen je Engine
  md += `| Engine | Antworten | mit KI-Antwort | ${own} genannt | Ø Position | empfohlen | eigene Seite als Quelle | Kosten (geschätzt) |\n|---|---|---|---|---|---|---|---|\n`;
  for (const engine of engineKeys) {
    const all = pr.filter((r) => r.engine === engine);
    const er = ok.filter((r) => r.engine === engine);
    const withAnswer = er.filter((r) => r.result.answer?.trim());
    const mentions = withAnswer.map((r) => r.brands.find((b) => b.name === own)).filter(Boolean);
    const avgPos = mentions.length ? (mentions.reduce((s, m) => s + m.position, 0) / mentions.length).toFixed(1) : '–';
    const rec = mentions.filter((m) => m.recommended).length;
    const cited = withAnswer.filter((r) => r.result.citations.some((c) => isOwn(c.url))).length;
    const fromSearch = withAnswer.some((r) => r.result.citations_from === 'search_results') ? ' ¹' : '';
    const cost = all.filter((r) => r.result).reduce((s, r) => s + estimateCost(r.result), 0);
    totalCost += cost;
    const errs = all.filter((r) => r.error).length;
    md += `| ${engine}${errs ? ` (${errs} Fehler)` : ''} | ${er.length} | ${withAnswer.length} | ${pct(mentions.length, withAnswer.length)} | ${avgPos} | ${pct(rec, withAnswer.length)} | ${pct(cited, withAnswer.length)}${fromSearch} | $${cost.toFixed(2)} |\n`;
  }

  // Share of Voice: jede Marke höchstens einmal pro Antwort
  const counts = new Map();
  for (const r of answered) for (const b of r.brands) counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
  const totalMentions = [...counts.values()].reduce((a, b) => a + b, 0);
  const trackedNames = new Set([own, ...project.competitors.map((c) => c.name)]);
  md += `\n**Meistgenannte Marken** (Anzahl Antworten mit Nennung, n=${answered.length})\n\n| Marke | Antworten | Anteil an allen Nennungen | getrackt |\n|---|---|---|---|\n`;
  for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    md += `| ${name === own ? `**${name}**` : name} | ${n} | ${pct(n, totalMentions)} | ${trackedNames.has(name) ? 'ja' : 'nein'} |\n`;
  }

  // Quellen
  const domains = new Map();
  for (const r of answered) for (const d of new Set(r.result.citations.map((c) => domainOf(c.url)).filter(Boolean))) {
    domains.set(d, (domains.get(d) ?? 0) + 1);
  }
  const withCitations = answered.filter((r) => r.result.citations.length).length;
  md += `\n**Meistgenutzte Quellen-Domains** (Anteil der Antworten mit Quellen, n=${withCitations})\n\n| Domain | Antworten | Anteil | Typ |\n|---|---|---|---|\n`;
  for (const [d, n] of [...domains].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    const comp = compDomains.find(([cd]) => matchesDomain(d, cd));
    const type = ownDomains.some((o) => matchesDomain(d, o)) ? '**eigene**' : comp ? `Wettbewerber (${comp[1]})` : '';
    md += `| ${d} | ${n} | ${pct(n, withCitations)} | ${type} |\n`;
  }

  // Eigene Seite zitiert, Marke aber nicht genannt
  const citedNotNamed = answered.filter((r) => r.result.citations.some((c) => isOwn(c.url)) && !r.brands.some((b) => b.name === own));
  if (citedNotNamed.length) {
    md += `\n**Als Quelle genutzt, aber nicht als Marke genannt** (${citedNotNamed.length}×)\n\n`;
    for (const r of citedNotNamed) md += `- ${r.engine}: „${r.prompt}“ – ${r.result.citations.filter((c) => isOwn(c.url)).map((c) => c.url).join(', ')}\n`;
  }

  // Lücken
  md += `\n**Lücken: Prompts, bei denen ${own} fehlt, andere Marken aber genannt werden**\n\n`;
  const gaps = project.prompts.slice(0, limit).map((prompt, pi) => {
    const pr2 = answered.filter((r) => r.pi === pi);
    const missing = pr2.filter((r) => !r.brands.some((b) => b.name === own));
    const others = new Set(missing.flatMap((r) => r.brands.map((b) => b.name)));
    return { prompt, engines: missing.map((r) => r.engine), others: [...others].slice(0, 6), total: pr2.length };
  }).filter((g) => g.engines.length && g.others.length);
  if (!gaps.length) md += `Keine.\n`;
  for (const g of gaps) md += `- „${g.prompt}“ – fehlt bei ${g.engines.length}/${g.total} (${g.engines.join(', ')}); genannt: ${g.others.join(', ')}\n`;
  md += '\n';
}
md += `---\nGeschätzte Abfragekosten aller berücksichtigten Antworten: **$${totalCost.toFixed(2)}** (Preise grob; Analyse-Kosten und fehlgeschlagene Versuche nicht enthalten).\n`;

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'report.md'), md);
console.log(`\nBericht: ${path.join(OUT, 'report.md')}`);
