'use server';
// Statuswechsel einer Maßnahme. Nur Editoren; Update strikt auf workspace_id des geprüften Workspaces eingeschränkt.
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, recommendation } from '@opengeo/db';
import { isRecStatus, isUuid, nextBaseline, STATUS_LABEL } from '@/lib/recommendations';
import { requireEditor } from '@/lib/session';
import type { FormState } from './workspaces';

export async function setRecommendationStatus(_p: FormState, f: FormData): Promise<FormState> {
  const slug = String(f.get('slug') ?? '');
  const id = String(f.get('id') ?? '');
  const to = String(f.get('status') ?? '');
  let ws;
  try {
    ({ ws } = await requireEditor(slug));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Keine Berechtigung')) return { error: e.message };
    throw e;
  }
  if (!isUuid(id) || !isRecStatus(to)) return { error: 'Ungültige Anfrage.' };

  const [rec] = await db.select({ id: recommendation.id, status: recommendation.status, baseline: recommendation.baseline, evidence: recommendation.evidence })
    .from(recommendation).where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id))).limit(1);
  if (!rec) return { error: 'Maßnahme nicht gefunden.' };
  if (rec.status === to) return { ok: `Bereits „${STATUS_LABEL[to]}“.` };

  const baseline = nextBaseline(rec.status, to, rec.baseline, rec.evidence);
  await db.update(recommendation)
    .set({ status: to, statusChangedAt: new Date(), ...(baseline !== undefined && { baseline }) })
    .where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id)));
  revalidatePath(`/w/${slug}`, 'layout');
  return { ok: `Status: ${STATUS_LABEL[to]}` };
}
