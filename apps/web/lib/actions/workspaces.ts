'use server';
import { like } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { autofillBrandProfile, refreshLogos } from '@askmetry/core';
import { brand, db, workspace, workspaceMember } from '@askmetry/db';
import { maxBudgetUsd } from '@/lib/limits';
import { validateDomains } from '@/lib/domain-validation';
import { requireUser } from '@/lib/session';
import { getI18n } from '@/lib/i18n/server';
import { slugify } from '@/lib/slug';

export type FormState = { error?: string; ok?: string } | null;

export async function createWorkspace(_prev: FormState, form: FormData): Promise<FormState> {
  const u = await requireUser();
  const { t, locale } = await getI18n();
  const name = String(form.get('name') ?? '').trim();
  const brandName = String(form.get('brandName') ?? '').trim();
  const dom = validateDomains(String(form.get('domains') ?? ''), locale);
  if (!name) return { error: t.workspaces.errors.name };
  if (!brandName) return { error: t.workspaces.errors.brand };
  if ('error' in dom) return { error: dom.error };
  const domains = dom.domains;

  const base = slugify(name);
  const taken = new Set((await db.select({ slug: workspace.slug }).from(workspace).where(like(workspace.slug, `${base}%`))).map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug) || slug === 'neu'; i++) slug = `${base}-${i}`;

  const wsId = await db.transaction(async (tx) => {
    // Zeitplan aus, bis der Workspace eingerichtet ist; Budget innerhalb der Obergrenze
    const [ws] = await tx.insert(workspace).values({
      name, slug, scheduleEnabled: false, monthlyBudgetUsd: Math.min(50, maxBudgetUsd()).toFixed(2),
    }).returning({ id: workspace.id });
    await tx.insert(workspaceMember).values({ workspaceId: ws!.id, userId: u.id, role: 'owner' });
    await tx.insert(brand).values({ workspaceId: ws!.id, name: brandName, domains, isOwn: true });
    return ws!.id;
  });
  // Beschreibung + Markentyp von der Website ableiten, während der Nutzer die Einstellungen sieht (~0,0004 $)
  after(() => autofillBrandProfile(wsId).then(() => {}, () => {}));
  after(() => refreshLogos(wsId).then(() => {}, () => {}));
  redirect(`/w/${slug}`);
}
