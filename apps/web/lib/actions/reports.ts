'use server';
// Berichte im Kunden-Workspace: „Messung starten“. Mandanten- und Statusprüfung hier, den Rest erledigt startReport im Kern.
import { and, count, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { brand, db, prompt } from '@askmetry/db';
import type { ReportTier } from '@askmetry/core/hosted/config';
import { getReport, startReport } from '@/lib/hosted/data';
import { startProblem, strategyPreparing } from '@/lib/hosted/rights';
import { isHosted } from '@/lib/hosted/server';
import { getI18n } from '@/lib/i18n/server';
import { isNoPermission, requireEditor } from '@/lib/session';
import type { FormState } from './workspaces';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startReportAction(_p: FormState, f: FormData): Promise<FormState> {
  const { t } = await getI18n();
  const r = t.reports;
  const slug = String(f.get('slug') ?? '');
  const id = String(f.get('reportId') ?? '');
  if (!isHosted() || !UUID_RE.test(id)) return { error: r.errors.notFound };
  let ctx;
  try { ctx = await requireEditor(slug); } catch (e) { if (isNoPermission(e)) return { error: t.common.noPermission }; throw e; }
  const rep = await getReport(id);
  if (!rep || rep.workspaceId !== ctx.ws.id) return { error: r.errors.notFound };
  const [[pc], [bc]] = await Promise.all([
    db.select({ n: count() }).from(prompt).where(and(eq(prompt.workspaceId, ctx.ws.id), eq(prompt.active, true))),
    db.select({ n: count() }).from(brand).where(and(eq(brand.workspaceId, ctx.ws.id), eq(brand.isOwn, false))),
  ]);
  const activePrompts = pc?.n ?? 0;
  const problem = startProblem({
    status: rep.status, tier: rep.tier as ReportTier, kind: rep.kind, activePrompts, competitors: bc?.n ?? 0,
    preparing: strategyPreparing(rep),
  });
  if (problem) {
    const max = rep.tier === 'strategy' ? { p: 60, c: 5 } : { p: 20, c: 3 };
    return { error: problem === 'tooManyPrompts' ? r.prepare.questionsTooMany(max.p)
      : problem === 'tooFewPrompts' ? r.prepare.questionsTooFew(max.p)
      : problem === 'tooManyCompetitors' ? r.prepare.competitorsTooMany(max.c)
      : problem === 'preparing' ? r.prepare.preparing : r.errors.wrongState };
  }
  const res = await startReport(id, ctx.user.id);
  if ('error' in res) return { error: startErrorText(r.errors, res.error) };
  revalidatePath(`/w/${slug}`, 'layout');
  return { ok: r.measuring.waiting };
}

type Errs = Awaited<ReturnType<typeof getI18n>>['t']['reports']['errors'];
const START_ERRORS: Record<string, keyof Errs> = {
  not_found: 'notFound', forbidden: 'forbidden', wrong_state: 'wrongState', preparing: 'preparing',
  measurement_active: 'measurementActive', previous_missing: 'previousMissing', no_prompts: 'noPrompts', budget: 'budget',
};
function startErrorText(e: Errs, code: string): string {
  const k = START_ERRORS[code];
  return k ? e[k] : e.generic;
}
