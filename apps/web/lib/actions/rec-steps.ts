'use server';
// Abgehakte Schritte einer Maßnahme (recommendation.done_steps). Nur Editoren; strikt auf workspace_id eingeschränkt.
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, recommendation } from '@askmetry/db';
import { isUuid } from '@/lib/recommendations';
import { toggleStep } from '@/lib/steps';
import { isNoPermission, requireEditor } from '@/lib/session';
import { getI18n } from '@/lib/i18n/server';

export async function setStepDone(slug: string, id: string, step: number, doneFlag: boolean): Promise<{ ok: true; done: number[] } | { error: string }> {
  const { t: msg } = await getI18n();
  const t = msg.recs.errors;
  let ws;
  try {
    ({ ws } = await requireEditor(slug));
  } catch (e) {
    if (isNoPermission(e)) return { error: msg.common.noPermission };
    throw e;
  }
  if (!isUuid(id) || !Number.isInteger(step) || step < 0 || step > 50 || typeof doneFlag !== 'boolean') return { error: t.invalid };
  const [rec] = await db.select({ steps: recommendation.steps, doneSteps: recommendation.doneSteps })
    .from(recommendation).where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id))).limit(1);
  if (!rec) return { error: t.notFound };
  if (step >= (rec.steps ?? []).length) return { error: t.noSuchStep };
  const done = toggleStep(rec.doneSteps ?? [], step, doneFlag);
  await db.update(recommendation).set({ doneSteps: done }).where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id)));
  revalidatePath(`/w/${slug}/massnahmen/${id}`);
  return { ok: true, done };
}
