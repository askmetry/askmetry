import Link from 'next/link';
import { Logo } from '@/components/auth/auth-form';
import { CreateWorkspaceForm } from '@/components/create-workspace-form';
import { UserMenu } from '@/components/user-menu';
import { BrandMark } from '@/components/brand-mark';
import { and, eq, inArray } from 'drizzle-orm';
import { brand, db } from '@opengeo/db';
import { domainsWithLogo } from '@opengeo/core';
import { Card } from '@/components/ui';
import { myWorkspaces } from '@/lib/workspaces';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Workspaces' };
const ROLE: Record<string, string> = { owner: 'Inhaber', admin: 'Admin', viewer: 'Nur lesen' };

export default async function WorkspacesPage() {
  const u = await requireUser();
  const list = await myWorkspaces(u.id);
  // eigene Marke je Workspace für das Logo
  const owns = list.length ? await db.select({ ws: brand.workspaceId, id: brand.id, name: brand.name, domains: brand.domains, logoType: brand.logoType, logoUpdatedAt: brand.logoUpdatedAt }).from(brand)
    .where(and(inArray(brand.workspaceId, list.map((w) => w.id)), eq(brand.isOwn, true))) : [];
  const ownBy = new Map(owns.map((o) => [o.ws, { id: o.id, custom: o.logoType ? o.logoUpdatedAt?.getTime() ?? 0 : null, name: o.name, domain: o.domains[0]?.toLowerCase().replace(/^www\./, '') ?? null }]));
  const has = await domainsWithLogo(owns.map((o) => ownBy.get(o.ws)!.domain).filter((d): d is string => !!d));
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Logo small />
          <UserMenu email={u.email} name={u.name} />
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-10 md:grid-cols-[1fr_360px]">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Deine Workspaces</h1>
          <p className="mb-6 text-sm text-muted">Ein Workspace bündelt eine Marke, ihre Wettbewerber und die Fragen, die wir den KI-Suchen stellen.</p>
          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted">
              Du bist noch in keinem Workspace. Lege rechts deinen ersten an.
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {list.map((w) => (
                <li key={w.id}>
                  <Link href={`/w/${w.slug}`} className="flex items-center justify-between px-5 py-4 hover:bg-subtle">
                    <span className="flex min-w-0 items-center gap-3">
                      {(() => { const o = ownBy.get(w.id); const d = o?.domain; return <BrandMark name={o?.name ?? w.name} size={32} own src={o?.custom != null ? `/w/${w.slug}/markenlogo/${o.id}?v=${o.custom}` : d && has.has(d) ? `/w/${w.slug}/logo/${encodeURIComponent(d)}` : null} />; })()}
                      <span className="truncate font-medium">{w.name}</span>
                    </span>
                    <span className="text-xs text-muted">{ROLE[w.role] ?? w.role} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card title="Neuer Workspace"><CreateWorkspaceForm /></Card>
      </main>
    </div>
  );
}
