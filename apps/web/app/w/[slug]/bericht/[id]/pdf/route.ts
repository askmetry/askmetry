import { and, eq } from 'drizzle-orm';
import { db, workspace, workspaceMember } from '@askmetry/db';
import { getReport, getReportPdf } from '@/lib/hosted/data';
import { isHosted } from '@/lib/hosted/server';
import { getSession } from '@/lib/session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response('Not found', { status: 404 });

/** PDF eines Berichts – nur für Mitglieder des Workspaces, zu dem der Bericht gehört. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!isHosted() || !UUID_RE.test(id)) return notFound();
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  const [ws] = await db.select({ id: workspace.id }).from(workspace)
    .innerJoin(workspaceMember, and(eq(workspaceMember.workspaceId, workspace.id), eq(workspaceMember.userId, s.user.id)))
    .where(eq(workspace.slug, slug)).limit(1);
  if (!ws) return notFound();
  const rep = await getReport(id);
  if (!rep || rep.workspaceId !== ws.id || rep.status !== 'ready') return notFound(); // nach Erstattung kein Download
  const pdf = await getReportPdf(id);
  if (!pdf) return notFound();
  const date = (rep.readyAt ?? rep.createdAt).slice(0, 10);
  return new Response(new Uint8Array(pdf.data), {
    headers: {
      'Content-Type': pdf.contentType || 'application/pdf',
      'Content-Disposition': `attachment; filename="askmetry-${slug}-${date}.pdf"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
