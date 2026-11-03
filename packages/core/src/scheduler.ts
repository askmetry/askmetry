import { collection, db, workspace } from '@opengeo/db';
import { and, desc, eq } from 'drizzle-orm';
import { CollectionActiveError, createCollection, hasActiveCollection } from './runner.ts';
import { isScheduleDue } from './schedule.ts';

/** Für jeden Workspace mit aktivem Zeitplan eine geplante Collection anlegen, wenn sie fällig ist. */
export async function createDueScheduledCollections(now = new Date(), log: (m: string) => void = () => {}) {
  const created: string[] = [];
  const list = await db.select().from(workspace).where(eq(workspace.scheduleEnabled, true));
  for (const ws of list) {
    const [last] = await db.select({ createdAt: collection.createdAt }).from(collection)
      .where(and(eq(collection.workspaceId, ws.id), eq(collection.trigger, 'scheduled')))
      .orderBy(desc(collection.createdAt)).limit(1);
    let due = false;
    try {
      due = isScheduleDue(ws.scheduleCron, last?.createdAt ?? null, ws.createdAt, now, ws.scheduleUpdatedAt);
    } catch (e) {
      log(`Ungültiger Zeitplan für ${ws.slug}: ${ws.scheduleCron}`);
      continue;
    }
    if (!due) continue;
    // läuft schon eine Messung (oder wartet), diesen Tick auslassen
    if (await hasActiveCollection(ws.id)) {
      log(`Geplante Messung für ${ws.slug} übersprungen – es läuft bereits eine Messung`);
      continue;
    }
    let c;
    try {
      c = await createCollection(ws.id, 'scheduled');
    } catch (e) {
      if (e instanceof CollectionActiveError) { log(`Geplante Messung für ${ws.slug} übersprungen – es läuft bereits eine Messung`); continue; }
      throw e;
    }
    log(`Geplante Messung für ${ws.slug} angelegt (${c.id})`);
    created.push(c.id);
  }
  return created;
}
