import 'server-only';
import { eq } from 'drizzle-orm';
import { db, workspace, workspaceMember } from '@opengeo/db';

/** Workspaces des Nutzers – nur serverseitig (kein Server Action: userId darf nicht vom Client kommen). */
export async function myWorkspaces(userId: string) {
  return db
    .select({ id: workspace.id, name: workspace.name, slug: workspace.slug, role: workspaceMember.role, createdAt: workspace.createdAt })
    .from(workspace).innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
    .where(eq(workspaceMember.userId, userId)).orderBy(workspace.name);
}
