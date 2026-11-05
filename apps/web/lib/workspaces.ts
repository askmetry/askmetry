import 'server-only';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { db, workspace, workspaceMember } from '@askmetry/db';

/** Workspaces des Nutzers – nur serverseitig (kein Server Action: userId darf nicht vom Client kommen). */
export async function myWorkspaces(userId: string) {
  return db
    .select({ id: workspace.id, hostedKind: workspace.hostedKind, name: workspace.name, slug: workspace.slug, role: workspaceMember.role, createdAt: workspace.createdAt })
    .from(workspace).innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
    .where(and(eq(workspaceMember.userId, userId), or(isNull(workspace.hostedKind), ne(workspace.hostedKind, 'check')))).orderBy(workspace.name);
}
