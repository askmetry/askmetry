import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db, workspace, workspaceMember } from '@opengeo/db';
import { auth } from './auth';

export type Role = 'owner' | 'admin' | 'viewer';

/** Viewer versucht etwas zu ändern. Die Meldung bleibt (für Logs) deutsch; die UI zeigt `t.common.noPermission`. */
export class NoPermissionError extends Error {
  readonly code = 'NO_PERMISSION';
  constructor() { super('Keine Berechtigung: Leserechte erlauben keine Änderungen.'); this.name = 'NoPermissionError'; }
}
export const isNoPermission = (e: unknown): e is NoPermissionError =>
  e instanceof NoPermissionError || (e instanceof Error && (e as { code?: string }).code === 'NO_PERMISSION');

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Angemeldeten Nutzer liefern oder zur Anmeldung umleiten. */
export async function requireUser() {
  const s = await getSession();
  if (!s) redirect('/login');
  return s.user;
}

/**
 * Zentrale Mandanten-Prüfung: Workspace per Slug laden, nur wenn der Nutzer Mitglied ist.
 * Nicht-Mitglieder bekommen 404 (Existenz des Workspaces wird nicht verraten).
 */
export const requireWorkspace = cache(async (slug: string) => {
  const u = await requireUser();
  const rows = await db
    .select({ ws: workspace, role: workspaceMember.role })
    .from(workspace)
    .innerJoin(workspaceMember, and(eq(workspaceMember.workspaceId, workspace.id), eq(workspaceMember.userId, u.id)))
    .where(eq(workspace.slug, slug))
    .limit(1);
  if (!rows[0]) notFound();
  const role = rows[0].role as Role;
  return { user: u, ws: rows[0].ws, role, canEdit: role !== 'viewer' };
});

/** Für Server Actions, die etwas ändern: Viewer dürfen nichts ändern. */
export async function requireEditor(slug: string) {
  const ctx = await requireWorkspace(slug);
  if (!ctx.canEdit) throw new NoPermissionError();
  return ctx;
}
