import 'server-only';
import { fmtDate, STATUS_LABELS } from './format';
import { loadBrands, resolveCollection } from './metrics';
import { requireWorkspace } from './session';

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Gemeinsamer Seitenkontext: Mitgliedschaft prüfen, Marken + gewählte Collection laden. */
export async function workspaceContext(slug: string, searchParams: Awaited<SP>) {
  const ctx = await requireWorkspace(slug);
  const [brands, cols] = await Promise.all([loadBrands(ctx.ws.id), resolveCollection(ctx.ws.id, one(searchParams.c))]);
  const own = brands.find((b) => b.isOwn);
  const collectionOptions = cols.finished.map((c, i) => ({
    value: c.id,
    label: `${fmtDate(c.finishedAt ?? c.createdAt)}${i === 0 ? ' (neueste)' : ''}${c.status !== 'done' ? ` – ${STATUS_LABELS[c.status]}` : ''}`,
  }));
  const prev = cols.selected ? cols.finished[cols.finished.findIndex((c) => c.id === cols.selected!.id) + 1] ?? null : null;
  return { ...ctx, brands, own, ...cols, previous: prev, collectionOptions };
}
