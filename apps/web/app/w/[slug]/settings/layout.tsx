import { SettingsNav } from '@/components/settings-nav';
import { getT } from '@/lib/i18n/server';
import { rightsFor } from '@/lib/hosted/server';
import { requireWorkspace } from '@/lib/session';

export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = (await getT()).settings;
  const r = await rightsFor((await requireWorkspace(slug)).ws);
  // Kunden-Workspace (gehostet): Messung und Kosten gibt es nicht – gemessen wird über Berichte
  const hide = [...(r.measureSettings ? [] : ['messung']), ...(r.costs ? [] : ['kosten'])];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <h1 className="mb-2 hidden px-3 text-xs font-semibold uppercase tracking-wide text-faint lg:block">{t.title}</h1>
        <SettingsNav slug={slug} hide={hide} />
      </aside>
      <div className="min-w-0 max-w-3xl">{children}</div>
    </div>
  );
}
