import { eq } from 'drizzle-orm';
import { brand, checkRequest, db } from '@askmetry/db';
import { loadLogo } from '@askmetry/core';
import type { CheckSummary } from '@askmetry/core/hosted/types';
import { cleanDomain } from '@/lib/hosted/teaser';
import { isHosted } from '@/lib/hosted/server';

const notFound = () => new Response('Not found', { status: 404 });
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Logos für den Teaser: nur mit gültigem Check-Token und nur für Marken-Domains dieses Checks bzw. seine Top-Quellen. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; domain: string }> }) {
  const { token, domain: raw } = await params;
  if (!isHosted() || !TOKEN_RE.test(token)) return notFound();
  let domain: string | null;
  try { domain = cleanDomain(decodeURIComponent(raw)); } catch { return notFound(); }
  if (!domain) return notFound();
  const [c] = await db.select({ ws: checkRequest.workspaceId, summary: checkRequest.summary }).from(checkRequest).where(eq(checkRequest.token, token)).limit(1);
  if (!c) return notFound();
  const allowed = new Set<string>();
  for (const d of (c.summary as CheckSummary | null)?.topDomains ?? []) { const x = cleanDomain(d.domain); if (x) allowed.add(x); }
  if (c.ws) for (const b of await db.select({ domains: brand.domains }).from(brand).where(eq(brand.workspaceId, c.ws))) for (const d of b.domains) { const x = cleanDomain(d); if (x) allowed.add(x); }
  if (!allowed.has(domain)) return notFound();
  const logo = await loadLogo(domain);
  if (!logo) return notFound();
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      'Content-Type': logo.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=86400',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
