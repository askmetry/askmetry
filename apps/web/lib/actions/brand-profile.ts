'use server';
// Beschreibung und Typ der eigenen Marke (Hinweisbanner + Einstellungen). Nur Editoren; strikt auf workspace_id eingeschränkt.
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { brand, db } from '@opengeo/db';
import { autofillBrandProfile } from '@opengeo/core';
import { cleanDescription, parseBrandKind } from '@/lib/brand-kind';
import { isNoPermission, requireEditor } from '@/lib/session';
import { getT } from '@/lib/i18n/server';
import type { FormState } from './workspaces';

export async function saveBrandProfile(_p: FormState, f: FormData): Promise<FormState> {
  const slug = String(f.get('slug') ?? '');
  const tt = await getT();
  const t = tt.settings;
  let ws;
  try {
    ({ ws } = await requireEditor(slug));
  } catch (e) {
    if (isNoPermission(e)) return { error: tt.common.noPermission };
    throw e;
  }
  const description = cleanDescription(String(f.get('description') ?? ''));
  const kind = parseBrandKind(String(f.get('kind') ?? ''));
  if (kind === undefined) return { error: t.errors.kind };
  if (!description && f.get('requireDescription') === '1') return { error: t.errors.describe };
  const r = await db.update(brand).set({ description, kind, profileSource: description || kind ? 'user' : null })
    .where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true))).returning({ id: brand.id });
  if (!r.length) return { error: t.errors.noOwnBrand };
  revalidatePath(`/w/${slug}`, 'layout');
  return { ok: t.ok.profileSaved };
}

async function editor(f: FormData) {
  const slug = String(f.get('slug') ?? '');
  const tt = await getT();
  try {
    const { ws } = await requireEditor(slug);
    return { slug, ws, t: tt.settings };
  } catch (e) {
    if (isNoPermission(e)) return { error: tt.common.noPermission };
    throw e;
  }
}

/** Automatisch erkanntes Profil übernehmen („Passt“). */
export async function confirmBrandProfile(_p: FormState, f: FormData): Promise<FormState> {
  const g = await editor(f);
  if ('error' in g) return { error: g.error };
  await db.update(brand).set({ profileSource: 'user' })
    .where(and(eq(brand.workspaceId, g.ws.id), eq(brand.isOwn, true), eq(brand.profileSource, 'auto')));
  revalidatePath(`/w/${g.slug}`, 'layout');
  return { ok: g.t.ok.profileConfirmed };
}

/** Profil jetzt von der Website erkennen (ersetzt auch von Hand eingetragene Werte – der Nutzer hat ausdrücklich geklickt). */
export async function detectBrandProfile(_p: FormState, f: FormData): Promise<FormState> {
  const g = await editor(f);
  if ('error' in g) return { error: g.error };
  const r = await autofillBrandProfile(g.ws.id, { force: true, replaceUser: f.get('replace') === '1' });
  revalidatePath(`/w/${g.slug}`, 'layout');
  if (!r) return { error: g.t.errors.justChecked };
  if (!r.description) return { error: g.t.errors.siteFailed(r.error ?? null) };
  return { ok: g.t.ok.profileDetected };
}
