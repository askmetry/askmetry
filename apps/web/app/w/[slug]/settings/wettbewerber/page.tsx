import { ActionForm } from '@/components/action-form';
import { AddCompetitorButton } from '@/components/add-competitor';
import { BrandMark } from '@/components/brand-mark';
import { box, Group, MENU_DANGER, SettingsHeader } from '@/components/settings-ui';
import { RowMenu } from '@/components/ui';
import { deleteBrand, saveBrand } from '@/lib/actions/settings';
import { workspaceContext } from '@/lib/context';
import { logoMap } from '@/lib/logos';
import { loadBase, untrackedBrands } from '@/lib/metrics';

export const metadata = { title: 'Wettbewerber · Einstellungen' };

type B = { id: string; name: string; aliases: string[]; domains: string[] };

export default async function WettbewerberPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, brands, selected, canEdit } = await workspaceContext(slug, {});
  const ro = !canEdit;
  const competitors = brands.filter((b) => !b.isOwn);
  const [logos, base] = await Promise.all([logoMap(slug, competitors), selected ? loadBase(ws.id, [selected.id]) : null]);
  // Vorschläge: Marken, die die KIs oft nennen, die du aber noch nicht vergleichst
  const suggestions = base
    ? untrackedBrands(base.resps, base.ments, brands.flatMap((b) => [b.name, ...b.aliases])).filter((u) => u.competitor && u.responses >= 2).slice(0, 6)
    : [];

  return (
    <>
      <SettingsHeader title="Wettbewerber" intro="Mit diesen Marken vergleichen wir dich." ro={ro}
        action={!ro && (
          <details className="group relative" data-testid="add-competitor">
            <summary className="btn btn-primary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">+ Wettbewerber</summary>
            <div className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-card p-4 shadow-card">
              <CompetitorForm slug={slug} />
            </div>
          </details>
        )} />

      {competitors.length === 0
        ? <p className={`${box} text-sm text-muted`}>Noch keine Wettbewerber. Füge oben welche hinzu{suggestions.length ? ' oder übernimm einen Vorschlag' : ''}.</p>
        : (
          <ul className="divide-y divide-border rounded-2xl bg-card shadow-card" data-testid="competitor-list">
            {competitors.map((b) => (
              <li key={b.id} className="relative">
                <details className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 pr-14 [&::-webkit-details-marker]:hidden">
                    <BrandMark name={b.name} src={logos.get(b.name.toLowerCase())} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.name}</span>
                      <span className="block truncate text-sm text-muted">{b.domains.join(', ') || 'ohne Website'}</span>
                    </span>
                    {!ro && <span className="text-sm text-accent group-open:hidden">Bearbeiten</span>}
                  </summary>
                  {!ro && <div className="px-4 pb-4"><CompetitorForm slug={slug} b={b} /></div>}
                </details>
                {!ro && (
                  <div className="absolute right-3 top-3">
                    <RowMenu label={`Aktionen für ${b.name}`}>
                      <ActionForm action={deleteBrand} slug={slug} submit="Wettbewerber entfernen" submitClass={MENU_DANGER} confirm={`„${b.name}“ wirklich entfernen? Bisherige Nennungen bleiben als „nicht getrackt“ erhalten.`}>
                        <input type="hidden" name="id" value={b.id} />
                      </ActionForm>
                    </RowMenu>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

      {suggestions.length > 0 && (
        <Group title="Oft genannt, aber nicht verglichen">
          <ul className="divide-y divide-border rounded-2xl bg-card shadow-card" data-testid="competitor-suggestions">
            {suggestions.map((u) => (
              <li key={u.name} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <BrandMark name={u.name} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{u.name}</span>
                  <span className="block text-sm text-muted">in {u.responses} Antworten genannt</span>
                </span>
                {!ro && <AddCompetitorButton slug={slug} name={u.name} label="Hinzufügen" />}
              </li>
            ))}
          </ul>
        </Group>
      )}
    </>
  );
}

function CompetitorForm({ slug, b }: { slug: string; b?: B }) {
  const id = b?.id ?? 'neu';
  return (
    <ActionForm action={saveBrand} slug={slug} submit={b ? 'Speichern' : 'Hinzufügen'} submitClass="btn btn-primary btn-sm" resetOnSuccess={!b} className="space-y-3">
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor={`c-name-${id}`}>Name</label><input className="input" id={`c-name-${id}`} name="name" defaultValue={b?.name} placeholder="z. B. SumUp" required /></div>
        <div><label className="label" htmlFor={`c-dom-${id}`}>Website</label><input className="input" id={`c-dom-${id}`} name="domains" defaultValue={b?.domains.join(', ')} placeholder="sumup.com" /></div>
      </div>
      <div><label className="label" htmlFor={`c-al-${id}`}>Andere Schreibweisen <span className="font-normal text-muted">(optional)</span></label>
        <input className="input" id={`c-al-${id}`} name="aliases" defaultValue={b?.aliases.join(', ')} placeholder="kommagetrennt" /></div>
    </ActionForm>
  );
}
