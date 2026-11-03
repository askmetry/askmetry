'use server';
// Beschreibung und Typ der eigenen Marke (Hinweisbanner + Einstellungen). Nur Editoren; strikt auf workspace_id eingeschränkt.
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { brand, db } from '@opengeo/db';
import { autofillBrandProfile } from '@opengeo/core';
import { cleanDescription, parseBrandKind } from '@/lib/brand-kind';
import { requireEditor } from '@/lib/session';
import type { FormState } from './workspaces';

export async function saveBrandProfile(_p: FormState, f: FormData): Promise<FormState> {
  const slug = String(f.get('slug') ?? '');
  let ws;
  try {
    ({ ws } = await requireEditor(slug));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Keine Berechtigung')) return { error: e.message };
    throw e;
  }
  const description = cleanDescription(String(f.get('description') ?? ''));
  const kind = parseBrandKind(String(f.get('kind') ?? ''));
  if (kind === undefined) return { error: 'Ungültiger Markentyp.' };
  if (!description && f.get('requireDescription') === '1') return { error: 'Bitte beschreib kurz, was du anbietest.' };
  const r = await db.update(brand).set({ description, kind, profileSource: description || kind ? 'user' : null })
    .where(and(eq(brand.workspaceId, ws.id), eq(brand.isOwn, true))).returning({ id: brand.id });
  if (!r.length) return { error: 'Für diesen Workspace ist keine eigene Marke hinterlegt.' };
  revalidatePath(`/w/${slug}`, 'layout');
  return { ok: 'Gespeichert – ab jetzt fließt das in Maßnahmen und KI-Prompts ein.' };
}

async function editor(f: FormData) {
  const slug = String(f.get('slug') ?? '');
  try {
    const { ws } = await requireEditor(slug);
    return { slug, ws };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Keine Berechtigung')) return { error: e.message };
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
  return { ok: 'Übernommen.' };
}

/** Profil jetzt von der Website erkennen (ersetzt auch von Hand eingetragene Werte – der Nutzer hat ausdrücklich geklickt). */
export async function detectBrandProfile(_p: FormState, f: FormData): Promise<FormState> {
  const g = await editor(f);
  if ('error' in g) return { error: g.error };
  const r = await autofillBrandProfile(g.ws.id, { force: true, replaceUser: f.get('replace') === '1' });
  revalidatePath(`/w/${g.slug}`, 'layout');
  if (!r) return { error: 'Gerade erst geprüft – bitte in einer Minute noch einmal.' };
  if (!r.description) return { error: `Die Website ließ sich nicht auswerten${r.error ? ` (${r.error})` : ''} – bitte von Hand eintragen.` };
  return { ok: 'Von der Website übernommen – bitte kurz prüfen.' };
}
