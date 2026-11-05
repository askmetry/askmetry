// Konto löschen (DSGVO): Arbeitsbereiche, in denen der Nutzer einziger owner ist, samt Daten; Mitgliedschaften, Berichte,
// Sitzungen/Konten/Nutzer. Rechnungen bleiben bei Stripe. E-Mail aus Schnell-Checks und Funnel-Bezüge werden entfernt.
import { account, checkRequest, db, funnelEvent, report, session, user, verification, workspace, workspaceMember } from '@askmetry/db';
import { and, eq, inArray, ne } from 'drizzle-orm';

export interface DeleteSummary { workspacesDeleted: number; membershipsRemoved: number; reportsDeleted: number; userDeleted: boolean }

export async function deleteUserData(userId: string): Promise<DeleteSummary> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId));
    const mine = await tx.select({ workspaceId: workspaceMember.workspaceId, role: workspaceMember.role }).from(workspaceMember).where(eq(workspaceMember.userId, userId));
    const toDelete: string[] = [];
    for (const m of mine) {
      if (m.role !== 'owner') continue;
      const otherOwners = await tx.$count(workspaceMember, and(eq(workspaceMember.workspaceId, m.workspaceId), eq(workspaceMember.role, 'owner'), ne(workspaceMember.userId, userId)));
      if (!otherOwners) toDelete.push(m.workspaceId);
    }
    // Arbeitsbereiche löschen (cascade: Marken, Prompts, Messungen, Maßnahmen, Berichte, PDFs …)
    if (toDelete.length) await tx.delete(workspace).where(inArray(workspace.id, toDelete));
    const removed = await tx.delete(workspaceMember).where(eq(workspaceMember.userId, userId)).returning({ w: workspaceMember.workspaceId });
    const reports = await tx.delete(report).where(eq(report.userId, userId)).returning({ id: report.id });
    await tx.update(funnelEvent).set({ userId: null }).where(eq(funnelEvent.userId, userId));
    if (u?.email) {
      const email = u.email.toLowerCase();
      await tx.update(checkRequest).set({ email: null, verifyCodeHash: null }).where(eq(checkRequest.email, email));
      await tx.delete(verification).where(eq(verification.identifier, u.email));
    }
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(account).where(eq(account.userId, userId));
    const deleted = await tx.delete(user).where(eq(user.id, userId)).returning({ id: user.id });
    return { workspacesDeleted: toDelete.length, membershipsRemoved: removed.length, reportsDeleted: reports.length, userDeleted: deleted.length > 0 };
  });
}
