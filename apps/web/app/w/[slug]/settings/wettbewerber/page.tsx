import { AddCompetitorButton } from '@/components/add-competitor';
import { BrandMark } from '@/components/brand-mark';
import { AddCompetitor, CompetitorList } from '@/components/competitor-editor';
import { Group, SettingsHeader } from '@/components/settings-ui';
import { workspaceContext } from '@/lib/context';
import { rightsFor } from '@/lib/hosted/server';
import { loadBase, untrackedBrands } from '@/lib/metrics';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = (await getT()).settings;
  return { title: t.metaTitle(t.pages.wettbewerber) };
}

export default async function WettbewerberPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, brands, selected, canEdit } = await workspaceContext(slug, {});
  const rights = await rightsFor(ws);
  // Kunden-Workspace: gesperrt, solange ein Bericht misst
  const locked = canEdit && !rights.editPromptsAndCompetitors;
  const ro = !canEdit || locked;
  const all = await getT();
  const t = all.settings;
  const c = t.competitors;
  const competitors = brands.filter((b) => !b.isOwn);
  const base = selected ? await loadBase(ws.id, [selected.id]) : null;
  // Vorschläge: Marken, die die KIs oft nennen, die du aber noch nicht vergleichst
  const suggestions = base
    ? untrackedBrands(base.resps, base.ments, brands.flatMap((b) => [b.name, ...b.aliases])).filter((u) => u.competitor && u.responses >= 2).slice(0, 6)
    : [];

  return (
    <>
      <SettingsHeader title={t.pages.wettbewerber} intro={locked ? all.reports.lock[(await rightsFor(ws)).lockReason === 'remeasure' ? 'remeasure' : 'measuring'] : c.intro} ro={!canEdit}
        action={!ro && <AddCompetitor slug={slug} />} />

      <CompetitorList slug={slug} competitors={competitors} ro={ro} emptyText={`${c.empty}${suggestions.length ? c.emptyOrSuggestion : ''}.`} />

      {suggestions.length > 0 && (
        <Group title={c.suggestions}>
          <ul className="divide-y divide-border rounded-2xl bg-card shadow-card" data-testid="competitor-suggestions">
            {suggestions.map((u) => (
              <li key={u.name} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <BrandMark name={u.name} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{u.name}</span>
                  <span className="block text-sm text-muted">{c.namedIn(u.responses)}</span>
                </span>
                {!ro && <AddCompetitorButton slug={slug} name={u.name} label={t.add} />}
              </li>
            ))}
          </ul>
        </Group>
      )}
    </>
  );
}
