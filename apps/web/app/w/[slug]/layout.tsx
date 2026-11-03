import Link from 'next/link';
import { Logo } from '@/components/auth/auth-form';
import { WorkspaceNav } from '@/components/nav';
import { requireWorkspace } from '@/lib/session';
import { BrandMark } from '@/components/brand-mark';
import { UserMenu } from '@/components/user-menu';
import { logoMap } from '@/lib/logos';
import { loadBrands } from '@/lib/metrics';
import { getT } from '@/lib/i18n/server';

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, user, role } = await requireWorkspace(slug);
  const t = (await getT()).common;
  const own = (await loadBrands(ws.id)).find((b) => b.isOwn);
  const ownLogo = own ? (await logoMap(slug, [own])).get(own.name.toLowerCase()) : null;
  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card">
        <div className="mx-auto max-w-[1080px] px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/w"><Logo small /></Link>
              <span className="text-muted">/</span>
              <Link href="/w" className="flex min-w-0 items-center gap-2 text-sm font-medium hover:underline" title={t.account.switchWorkspace}>
                <BrandMark name={own?.name ?? ws.name} src={ownLogo} own />
                <span className="truncate">{ws.name}</span>
              </Link>
              {role === 'viewer' && <span className="rounded bg-subtle px-1.5 py-0.5 text-xs text-muted">{t.account.readOnly}</span>}
            </div>
            <UserMenu email={user.email} name={user.name} />
          </div>
          <WorkspaceNav slug={slug} />
        </div>
      </header>
      <main className="mx-auto max-w-[1080px] px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
