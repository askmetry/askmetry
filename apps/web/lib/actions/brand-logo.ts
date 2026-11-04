'use server';
// Eigenes Logo der eigenen Marke hochladen/entfernen. Nur Editoren; gespeichert an der Marke (nicht im domainübergreifenden Cache).
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { brand, db } from '@askmetry/db';
import { LOGO_MAX_BYTES, sniffImage } from '@askmetry/core';
import { isNoPermission, requireEditor } from '@/lib/session';
import { getT } from '@/lib/i18n/server';
import type { FormState } from './workspaces';

async function editor(f: FormData) {
  const slug = String(f.get('slug') ?? '');
  const tt = await getT();
  try {
    return { slug, t: tt.settings, ...(await requireEditor(slug)) };
  } catch (e) {
    if (isNoPermission(e)) return { slug, denied: tt.common.noPermission } as const;
    throw e;
  }
}

export async function uploadBrandLogo(_p: FormState, f: FormData): Promise<FormState> {
  const g = await editor(f);
  if ('denied' in g) return { error: g.denied };
  const file = f.get('logo');
  if (!(file instanceof File) || file.size === 0) return { error: g.t.errors.pickImage };
  if (file.size > LOGO_MAX_BYTES) return { error: g.t.brand.logoTooLarge };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Typ aus den Bytes, nicht aus dem Dateinamen; SVG nur ohne Skripte
  const type = sniffImage(bytes);
  if (!type) return { error: g.t.errors.imageType };
  const r = await db.update(brand).set({ logoData: Buffer.from(bytes).toString('base64'), logoType: type, logoUpdatedAt: new Date() })
    .where(and(eq(brand.workspaceId, g.ws.id), eq(brand.isOwn, true))).returning({ id: brand.id });
  if (!r.length) return { error: g.t.errors.noOwnFound };
  revalidatePath(`/w/${g.slug}`, 'layout');
  return { ok: g.t.ok.logoSaved };
}

export async function removeBrandLogo(_p: FormState, f: FormData): Promise<FormState> {
  const g = await editor(f);
  if ('denied' in g) return { error: g.denied };
  await db.update(brand).set({ logoData: null, logoType: null, logoUpdatedAt: null })
    .where(and(eq(brand.workspaceId, g.ws.id), eq(brand.isOwn, true)));
  revalidatePath(`/w/${g.slug}`, 'layout');
  return { ok: g.t.ok.logoRemoved };
}
