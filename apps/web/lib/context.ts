import 'server-only';
import { getI18n } from './i18n/server';
import { loadBrands, resolveCollection } from './metrics';
import { requireWorkspace } from './session';
import { isHosted } from '@askmetry/core/hosted/config';

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Gemeinsamer Seitenkontext: Mitgliedschaft prüfen, Marken + gewählte Collection laden. */
export async function workspaceContext(slug: string, searchParams: Awaited<SP>) {
  const ctx = await requireWorkspace(slug);
  const [brands, cols] = await Promise.all([loadBrands(ctx.ws.id), resolveCollection(ctx.ws.id, one(searchParams.c))]);
  const own = brands.find((b) => b.isOwn);
  const { t, f } = await getI18n();
  const collectionOptions = cols.finished.map((c, i) => ({
    value: c.id,
    label: `${f.date(c.finishedAt ?? c.createdAt)}${i === 0 ? t.overview.collection.latest : ''}${c.status !== 'done' ? ` – ${t.common.collectionStatus[c.status] ?? c.status}` : ''}`,
  }));
  const prev = cols.selected ? cols.finished[cols.finished.findIndex((c) => c.id === cols.selected!.id) + 1] ?? null : null;
  // Kunden-Workspace (gehostet): gemessen wird über Berichte, nicht über Einstellungen → Messung
  const customer = isHosted() && ctx.ws.hostedKind === 'customer';
  const measureHref = customer ? `/w/${slug}/berichte` : `/w/${slug}/settings/messung`;
  return { ...ctx, brands, own, ...cols, previous: prev, collectionOptions, customer, measureHref, measureLabel: customer ? t.reports.measureViaReports : null };
}
