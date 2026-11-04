import { and, eq } from 'drizzle-orm';
import { brand, db, workspace, workspaceMember } from '@askmetry/db';
import { getSession } from '@/lib/session';

/** Selbst hochgeladenes Logo einer Marke – nur für Mitglieder des Workspaces. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  const [b] = await db.select({ data: brand.logoData, type: brand.logoType }).from(brand)
    .innerJoin(workspace, eq(workspace.id, brand.workspaceId))
    .innerJoin(workspaceMember, and(eq(workspaceMember.workspaceId, workspace.id), eq(workspaceMember.userId, s.user.id)))
    .where(and(eq(workspace.slug, slug), eq(brand.id, id))).limit(1);
  if (!b?.data || !b.type) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(Buffer.from(b.data, 'base64')), {
    headers: {
      'Content-Type': b.type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // URL enthält ?v=<Zeitstempel> → nach neuem Upload eine neue Adresse
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
