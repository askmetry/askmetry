import Link from 'next/link';
import { Logo } from '@/components/auth/auth-form';
import { CreateWorkspaceForm } from '@/components/create-workspace-form';
import { UserMenu } from '@/components/user-menu';
import { BrandMark } from '@/components/brand-mark';
import { and, eq, inArray } from 'drizzle-orm';
import { brand, db } from '@askmetry/db';
import { domainsWithLogo } from '@askmetry/core';
import { Card } from '@/components/ui';
import { myWorkspaces } from '@/lib/workspaces';
import { requireUser } from '@/lib/session';
import { getT } from '@/lib/i18n/server';
import { isHosted } from '@/lib/hosted/server';

export async function generateMetadata() {
  return { title: (await getT()).workspaces.metaTitle };
}

export default async function WorkspacesPage() {
  const u = await requireUser();
  const all = await getT();
  const t = all.workspaces;
  const hosted = isHosted();
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
          <UserMenu email={u.email} name={u.name} account={hosted} />
        </div>
      </header>
      <main className={`mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 ${hosted ? '' : 'md:grid-cols-[1fr_360px]'}`}>
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mb-6 text-sm text-muted">{t.intro}</p>
          {list.length === 0 && hosted ? (
            <div className="rounded-2xl bg-card px-6 py-12 text-center shadow-card" data-testid="hosted-empty">
              <p className="text-lg font-semibold">{all.reports.hostedEmpty.title}</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{all.reports.hostedEmpty.text}</p>
              <Link href="/" className="btn btn-primary mt-5">{all.reports.startCheck}</Link>
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted">
              {t.empty}
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
                    <span className="text-xs text-muted">{t.roles[w.role] ?? w.role} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* gehostet entstehen Workspaces nur über einen Schnell-Check + Kauf */}
        {!hosted && <Card title={t.new}><CreateWorkspaceForm /></Card>}
      </main>
    </div>
  );
}
