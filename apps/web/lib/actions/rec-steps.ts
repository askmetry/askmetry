'use server';
// Abgehakte Schritte einer Maßnahme (recommendation.done_steps). Nur Editoren; strikt auf workspace_id eingeschränkt.
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, recommendation } from '@opengeo/db';
import { isUuid } from '@/lib/recommendations';
import { toggleStep } from '@/lib/steps';
import { requireEditor } from '@/lib/session';

export async function setStepDone(slug: string, id: string, step: number, doneFlag: boolean): Promise<{ ok: true; done: number[] } | { error: string }> {
  let ws;
  try {
    ({ ws } = await requireEditor(slug));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Keine Berechtigung')) return { error: e.message };
    throw e;
  }
  if (!isUuid(id) || !Number.isInteger(step) || step < 0 || step > 50 || typeof doneFlag !== 'boolean') return { error: 'Ungültige Anfrage.' };
  const [rec] = await db.select({ steps: recommendation.steps, doneSteps: recommendation.doneSteps })
    .from(recommendation).where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id))).limit(1);
  if (!rec) return { error: 'Maßnahme nicht gefunden.' };
  if (step >= (rec.steps ?? []).length) return { error: 'Diesen Schritt gibt es nicht.' };
  const done = toggleStep(rec.doneSteps ?? [], step, doneFlag);
  await db.update(recommendation).set({ doneSteps: done }).where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id)));
  revalidatePath(`/w/${slug}/massnahmen/${id}`);
  return { ok: true, done };
}
