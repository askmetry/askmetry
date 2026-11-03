import { SettingsNav } from '@/components/settings-nav';

export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <h1 className="mb-2 hidden px-3 text-xs font-semibold uppercase tracking-wide text-faint lg:block">Einstellungen</h1>
        <SettingsNav slug={slug} />
      </aside>
      <div className="min-w-0 max-w-3xl">{children}</div>
    </div>
  );
}
