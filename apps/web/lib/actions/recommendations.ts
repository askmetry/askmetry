'use server';
// Statuswechsel einer Maßnahme. Nur Editoren; Update strikt auf workspace_id des geprüften Workspaces eingeschränkt.
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, recommendation } from '@askmetry/db';
import { isRecStatus, isUuid, nextBaseline, statusLabel } from '@/lib/recommendations';
import { getI18n } from '@/lib/i18n/server';
import { isNoPermission, requireEditor } from '@/lib/session';
import type { FormState } from './workspaces';

export async function setRecommendationStatus(_p: FormState, f: FormData): Promise<FormState> {
  const slug = String(f.get('slug') ?? '');
  const id = String(f.get('id') ?? '');
  const to = String(f.get('status') ?? '');
  const { locale, t: msg } = await getI18n();
  const t = msg.recs.errors;
  let ws;
  try {
    ({ ws } = await requireEditor(slug));
  } catch (e) {
    if (isNoPermission(e)) return { error: msg.common.noPermission };
    throw e;
  }
  if (!isUuid(id) || !isRecStatus(to)) return { error: t.invalid };

  const [rec] = await db.select({ id: recommendation.id, status: recommendation.status, baseline: recommendation.baseline, evidence: recommendation.evidence })
    .from(recommendation).where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id))).limit(1);
  if (!rec) return { error: t.notFound };
  if (rec.status === to) return { ok: t.already(statusLabel(to, locale)) };

  const baseline = nextBaseline(rec.status, to, rec.baseline, rec.evidence);
  await db.update(recommendation)
    .set({ status: to, statusChangedAt: new Date(), ...(baseline !== undefined && { baseline }) })
    .where(and(eq(recommendation.id, id), eq(recommendation.workspaceId, ws.id)));
  revalidatePath(`/w/${slug}`, 'layout');
  return { ok: t.statusSet(statusLabel(to, locale)) };
}
