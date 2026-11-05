// PDF-Bericht rendern:
//   pnpm --filter @askmetry/report render -- --report <id> --out <datei.pdf>
//   pnpm --filter @askmetry/report render -- --workspace <slug> --tier compact|strategy --out <datei.pdf> [--collection <id>] [--previous <collectionId>] [--lang de|en] [--recs db|rules]
// Ohne --collection: neueste abgeschlossene echte Messung (Mock-Läufe nur, wenn es keine echte gibt).
// Maßnahmen: aus der DB, wenn sie zu dieser Messung gehören, sonst im Speicher aus den Regeln berechnet (--recs erzwingt eins davon).
// Datenbank: DATABASE_URL (Standard: Dev-Datenbank auf localhost:5433).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb } from '@askmetry/db';
import { renderReportPdf, renderWorkspacePdf } from '../src/index.ts';

const { values: a } = parseArgs({
  args: process.argv.slice(2).filter((x) => x !== '--'),
  options: {
    report: { type: 'string' }, workspace: { type: 'string' }, tier: { type: 'string', default: 'compact' },
    collection: { type: 'string' }, previous: { type: 'string' }, lang: { type: 'string' }, out: { type: 'string' }, recs: { type: 'string' },
  },
});

async function main() {
  if (!a.out || (!a.report && !a.workspace)) {
    console.error('Aufruf: render --report <id> --out <datei.pdf>  |  render --workspace <slug> --tier compact|strategy --out <datei.pdf>');
    process.exitCode = 2;
    return;
  }
  if (a.tier !== 'compact' && a.tier !== 'strategy') throw new Error('--tier muss compact oder strategy sein');
  const t0 = Date.now();
  const pdf = a.report
    ? await renderReportPdf(a.report)
    : await renderWorkspacePdf(a.workspace!, {
      tier: a.tier, collectionId: a.collection, previousCollectionId: a.previous,
      lang: a.lang === 'en' ? 'en' : a.lang === 'de' ? 'de' : undefined,
      recs: a.recs === 'db' || a.recs === 'rules' ? a.recs : undefined,
    });
  const out = path.resolve(a.out);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, pdf);
  console.log(`${out} (${Math.round(pdf.length / 1024)} KB, ${Date.now() - t0} ms)`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => closeDb());
