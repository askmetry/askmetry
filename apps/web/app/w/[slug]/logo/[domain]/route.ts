import { and, eq, sql } from 'drizzle-orm';
import { brand, db, workspace, workspaceMember } from '@askmetry/db';
import { loadLogo } from '@askmetry/core';
import { getSession } from '@/lib/session';

const notFound = () => new Response('Not found', { status: 404 });

/** Logo einer Marke des Workspaces ausliefern – nur für Mitglieder und nur für Domains dieser Marken. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; domain: string }> }) {
  const { slug, domain: raw } = await params;
  let domain: string;
  try { domain = decodeURIComponent(raw).toLowerCase(); } catch { return notFound(); }
  // gleiche Form wie validateDomains (auch IDN-TLDs wie .xn--p1ai)
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/.test(domain)) return notFound();
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  const [ok] = await db.select({ id: brand.id }).from(brand)
    .innerJoin(workspace, eq(workspace.id, brand.workspaceId))
    .innerJoin(workspaceMember, and(eq(workspaceMember.workspaceId, workspace.id), eq(workspaceMember.userId, s.user.id)))
    .where(and(eq(workspace.slug, slug), sql`${domain} = any(${brand.domains})`)).limit(1);
  if (!ok) return notFound();
  const logo = await loadLogo(domain);
  if (!logo) return notFound();
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      'Content-Type': logo.contentType,
      'X-Content-Type-Options': 'nosniff',
      // SVG darf kein Skript ausführen
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
