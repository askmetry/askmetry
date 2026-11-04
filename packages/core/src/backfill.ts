// Nachträge für bestehende Daten (ohne API-Aufrufe)
import { citation, db, response, run } from '@askmetry/db';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { normalizeDomain, safeHttpUrl } from './domains.ts';
import { claudeSearchedSources, openAiSearchedSources, urlKey } from './util.ts';

/** Gespeicherte Engine-Rohdaten → durchsuchte Quellen (nur Engines, die sie mitliefern). */
export function searchedSourcesFromRaw(engine: string, raw: any) {
  // Ablehnungen werden als { refusal, response } gespeichert
  const r = raw && typeof raw === 'object' && 'refusal' in raw && raw.response ? raw.response : raw;
  if (engine === 'chatgpt') return openAiSearchedSources(r);
  if (engine === 'claude') return claudeSearchedSources(r);
  return [];
}

/**
 * Durchsuchte Quellen (kind 'searched') für bestehende ChatGPT- und Claude-Antworten aus response.raw nachtragen.
 * Idempotent: URLs, die für die Antwort schon gespeichert sind (cited oder searched), werden übersprungen.
 */
export async function backfillSearchedCitations(opts: { workspaceId?: string; log?: (m: string) => void; batchSize?: number } = {}) {
  const log = opts.log ?? (() => {});
  const batch = opts.batchSize ?? 50;
  let lastId = '00000000-0000-0000-0000-000000000000';
  let responses = 0, inserted = 0, removed = 0;
  for (;;) {
    const conds = [inArray(run.engine, ['chatgpt', 'claude']), gt(response.id, lastId)];
    if (opts.workspaceId) conds.push(eq(response.workspaceId, opts.workspaceId));
    const rows = await db.select({ id: response.id, workspaceId: response.workspaceId, raw: response.raw, engine: run.engine })
      .from(response).innerJoin(run, eq(run.id, response.runId)).where(and(...conds)).orderBy(asc(response.id)).limit(batch);
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    for (const r of rows) {
      const sources = searchedSourcesFromRaw(r.engine, r.raw);
      if (!sources.length) continue;
      const n = await db.transaction(async (tx) => {
        const existing = await tx.select({ id: citation.id, url: citation.url, position: citation.position, kind: citation.kind })
          .from(citation).where(eq(citation.responseId, r.id));
        // searched-Zeilen, die nur eine zitierte URL (mit Tracking-Parametern) wiederholen, entfernen
        const citedKeys = new Set(existing.filter((c) => c.kind === 'cited').map((c) => urlKey(c.url)));
        const dupes = existing.filter((c) => c.kind === 'searched' && citedKeys.has(urlKey(c.url)));
        if (dupes.length) { await tx.delete(citation).where(inArray(citation.id, dupes.map((c) => c.id))); removed += dupes.length; }
        const have = new Set(existing.filter((c) => !dupes.includes(c)).map((c) => urlKey(c.url)));
        let pos = existing.reduce((m, c) => Math.max(m, c.position), 0);
        const values: (typeof citation.$inferInsert)[] = [];
        for (const s of sources) {
          const url = s.url.replace(/\u0000/g, '');
          const domain = safeHttpUrl(url) ? normalizeDomain(url) : null;
          if (!domain || have.has(urlKey(url))) continue;
          have.add(urlKey(url));
          values.push({ responseId: r.id, workspaceId: r.workspaceId, url, domain, title: s.title ?? null, position: ++pos, kind: 'searched' });
        }
        if (values.length) await tx.insert(citation).values(values);
        return values.length;
      });
      responses++;
      inserted += n;
    }
  }
  log(`Durchsuchte Quellen nachgetragen: ${inserted} neue Zeilen aus ${responses} Antworten${removed ? `, ${removed} Doppelungen (zitiert + durchsucht) entfernt` : ''}`);
  return { responses, inserted, removed };
}
