'use server';
// Eigenes Logo der eigenen Marke hochladen/entfernen. Nur Editoren; gespeichert an der Marke (nicht im domainübergreifenden Cache).
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { brand, db } from '@opengeo/db';
import { LOGO_MAX_BYTES, sniffImage } from '@opengeo/core';
import { requireEditor } from '@/lib/session';
import type { FormState } from './workspaces';

async function editor(f: FormData) {
  const slug = String(f.get('slug') ?? '');
  try {
    return { slug, ...(await requireEditor(slug)) };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Keine Berechtigung')) return { slug, denied: e.message } as const;
    throw e;
  }
}

export async function uploadBrandLogo(_p: FormState, f: FormData): Promise<FormState> {
  const g = await editor(f);
  if ('denied' in g) return { error: g.denied };
  const file = f.get('logo');
  if (!(file instanceof File) || file.size === 0) return { error: 'Bitte wähle eine Bilddatei.' };
  if (file.size > LOGO_MAX_BYTES) return { error: 'Die Datei ist zu groß (höchstens 200 KB).' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Typ aus den Bytes, nicht aus dem Dateinamen; SVG nur ohne Skripte
  const type = sniffImage(bytes);
  if (!type) return { error: 'Bitte ein PNG, JPG, WebP, GIF, ICO oder SVG ohne Skripte hochladen.' };
  const r = await db.update(brand).set({ logoData: Buffer.from(bytes).toString('base64'), logoType: type, logoUpdatedAt: new Date() })
    .where(and(eq(brand.workspaceId, g.ws.id), eq(brand.isOwn, true))).returning({ id: brand.id });
  if (!r.length) return { error: 'Keine eigene Marke gefunden.' };
  revalidatePath(`/w/${g.slug}`, 'layout');
  return { ok: 'Logo gespeichert.' };
}

export async function removeBrandLogo(_p: FormState, f: FormData): Promise<FormState> {
  const g = await editor(f);
  if ('denied' in g) return { error: g.denied };
  await db.update(brand).set({ logoData: null, logoType: null, logoUpdatedAt: null })
    .where(and(eq(brand.workspaceId, g.ws.id), eq(brand.isOwn, true)));
  revalidatePath(`/w/${g.slug}`, 'layout');
  return { ok: 'Wieder das Logo der Website.' };
}
