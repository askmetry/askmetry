import { ActionForm } from '@/components/action-form';
import { BrandMark } from '@/components/brand-mark';
import { box, MENU_DANGER } from '@/components/settings-ui';
import { RowMenu } from '@/components/ui';
import { deleteBrand, saveBrand } from '@/lib/actions/settings';
import { logoMap } from '@/lib/logos';
import { getT } from '@/lib/i18n/server';
import type { Messages } from '@/lib/i18n/messages';

type B = { id: string; name: string; aliases: string[]; domains: string[]; logoType?: string | null; logoUpdatedAt?: Date | null };

/** Wettbewerber-Liste mit Bearbeiten/Entfernen (Einstellungen → Wettbewerber und „Bericht vorbereiten“). */
export async function CompetitorList({ slug, competitors, ro, emptyText }: { slug: string; competitors: B[]; ro: boolean; emptyText?: string }) {
  const t = (await getT()).settings;
  const c = t.competitors;
  const logos = await logoMap(slug, competitors);
  return (
    <>
      {competitors.length === 0
        ? <p className={`${box} text-sm text-muted`}>{emptyText ?? `${c.empty}.`}</p>
        : (
          <ul className="divide-y divide-border rounded-2xl bg-card shadow-card" data-testid="competitor-list">
            {competitors.map((b) => (
              <li key={b.id} className="relative">
                <details className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 pr-14 [&::-webkit-details-marker]:hidden">
                    <BrandMark name={b.name} src={logos.get(b.name.toLowerCase())} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.name}</span>
                      <span className="block truncate text-sm text-muted">{b.domains.join(', ') || c.noWebsite}</span>
                    </span>
                    {!ro && <span className="text-sm text-accent group-open:hidden">{c.edit}</span>}
                  </summary>
                  {!ro && <div className="px-4 pb-4"><CompetitorForm slug={slug} b={b} t={t} /></div>}
                </details>
                {!ro && (
                  <div className="absolute right-3 top-3">
                    <RowMenu label={t.actionsFor(b.name)}>
                      <ActionForm action={deleteBrand} slug={slug} submit={c.remove} submitClass={MENU_DANGER} confirm={c.removeConfirm(b.name)}>
                        <input type="hidden" name="id" value={b.id} />
                      </ActionForm>
                    </RowMenu>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

    </>
  );
}

/** „+ Wettbewerber“ als aufklappendes Formular. */
export async function AddCompetitor({ slug }: { slug: string }) {
  const t = (await getT()).settings;
  return (
    <details className="group relative" data-testid="add-competitor">
      <summary className="btn btn-primary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">{t.competitors.addButton}</summary>
      <div className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-card p-4 shadow-card">
        <CompetitorForm slug={slug} t={t} />
      </div>
    </details>
  );
}

export function CompetitorForm({ slug, b, t }: { slug: string; b?: B; t: Messages['settings'] }) {
  const id = b?.id ?? 'neu';
  return (
    <ActionForm action={saveBrand} slug={slug} submit={b ? t.save : t.add} submitClass="btn btn-primary btn-sm" resetOnSuccess={!b} className="space-y-3">
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor={`c-name-${id}`}>{t.name}</label><input className="input" id={`c-name-${id}`} name="name" defaultValue={b?.name} placeholder={t.competitors.namePlaceholder} required /></div>
        <div><label className="label" htmlFor={`c-dom-${id}`}>{t.website}</label><input className="input" id={`c-dom-${id}`} name="domains" defaultValue={b?.domains.join(', ')} placeholder="sumup.com" /></div>
      </div>
      <div><label className="label" htmlFor={`c-al-${id}`}>{t.brand.aliases} <span className="font-normal text-muted">{t.optional}</span></label>
        <input className="input" id={`c-al-${id}`} name="aliases" defaultValue={b?.aliases.join(', ')} placeholder={t.commaSeparated} /></div>
    </ActionForm>
  );
}
