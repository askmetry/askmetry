import { ActionForm } from '@/components/action-form';
import { confirmBrandProfile, detectBrandProfile, saveBrandProfile } from '@/lib/actions/brand-profile';
import { BRAND_KINDS, DESCRIPTION_MAX } from '@/lib/brand-kind';
import { getT } from '@/lib/i18n/server';

type Own = { name: string; description: string | null; kind: string | null; profileSource?: string | null };


/** Banner nötig? Wenn das Profil fehlt oder nur automatisch erkannt und noch nicht bestätigt ist. */
export const needsProfileBanner = (own: Own) => own.profileSource === 'auto' || !own.description?.trim();

/** Felder für Beschreibung + Markentyp der eigenen Marke (eigene kleine Action, nicht settings.ts). */
export async function BrandProfileForm({ slug, own, ro, compact = false }: { slug: string; own: Own; ro: boolean; compact?: boolean }) {
  const t = (await getT()).settings;
  const p = t.profile;
  return (
    <div className="space-y-2">
      <ActionForm action={saveBrandProfile} slug={slug} submit={t.save} submitClass="btn btn-primary btn-sm" disabled={ro}
        className={compact ? 'flex flex-col gap-2 sm:flex-row sm:items-end' : 'space-y-3'}>
        {compact && <input type="hidden" name="requireDescription" value="1" />}
        <div className="min-w-0 flex-1">
          <label className={compact ? 'sr-only' : 'label'} htmlFor={compact ? 'bp-desc-c' : 'bp-desc'}>{p.offerLabel}</label>
          {compact
            ? <input className="input" id="bp-desc-c" name="description" defaultValue={own.description ?? ''} maxLength={DESCRIPTION_MAX}
                placeholder={p.placeholderShort(own.name)} />
            : <textarea className="input min-h-24" id="bp-desc" name="description" defaultValue={own.description ?? ''} maxLength={DESCRIPTION_MAX}
                placeholder={p.placeholderLong(own.name)} />}
        </div>
        <div className={compact ? 'sm:w-48' : 'sm:w-64'}>
          <label className={compact ? 'sr-only' : 'label'} htmlFor={compact ? 'bp-kind-c' : 'bp-kind'}>{p.kindLabel}</label>
          <select className="input" id={compact ? 'bp-kind-c' : 'bp-kind'} name="kind" defaultValue={own.kind ?? ''}>
            <option value="">{p.kindPlaceholder}</option>
            {BRAND_KINDS.map((k) => <option key={k} value={k}>{p.kinds[k]}</option>)}
          </select>
        </div>
      </ActionForm>
      {!compact && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {own.profileSource === 'auto' && <span data-testid="profile-auto">{p.auto}</span>}
          <ActionForm action={detectBrandProfile} slug={slug} submit={p.redetect} submitClass="text-xs text-accent hover:underline" disabled={ro} inline>
            <input type="hidden" name="replace" value="1" />
          </ActionForm>
        </div>
      )}
    </div>
  );
}

/** Profil der Marke: automatisch erkannt → bestätigen; fehlt → von der Website erkennen oder selbst eintragen. */
export async function BrandProfileBanner({ slug, own, canEdit }: { slug: string; own: Own; canEdit: boolean }) {
  if (!needsProfileBanner(own)) return null;
  const tt = await getT();
  const p = tt.settings.profile;
  if (own.profileSource === 'auto' && own.description) {
    const kind = own.kind ? p.kinds[own.kind] ?? null : null;
    return (
      <section aria-label={p.bannerDetected} data-testid="brand-banner" data-state="auto" className="rounded-2xl bg-accent-soft px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">{p.detectedFromSite}</p>
        <p className="mt-1 text-[15px]">{tt.recs.quote(own.description)}{kind && <span className="ml-2 rounded-full bg-card px-2 py-0.5 text-xs text-muted">{kind}</span>}</p>
        {canEdit ? (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <ActionForm action={confirmBrandProfile} slug={slug} submit={p.confirm} submitClass="btn btn-primary btn-sm" inline />
            <details className="group min-w-0 flex-1">
              <summary className="btn btn-sm inline-flex cursor-pointer list-none">{p.change}</summary>
              <div className="mt-3"><BrandProfileForm slug={slug} own={own} ro={false} compact /></div>
            </details>
          </div>
        ) : <p className="mt-1 text-sm text-muted">{p.editorsOnly}</p>}
      </section>
    );
  }
  return (
    <section aria-label={p.bannerDescribe} data-testid="brand-banner" data-state="empty" className="rounded-2xl bg-accent-soft px-5 py-4">
      <p className="text-sm font-medium">{p.whatDoes(own.name)}</p>
      {canEdit
        ? (
          <div className="mt-3 space-y-3">
            {/* replace: es gibt keine Beschreibung, die verloren gehen könnte; ein selbst gewählter Typ bleibt erhalten */}
            <ActionForm action={detectBrandProfile} slug={slug} submit={p.detect} submitClass="btn btn-primary btn-sm" inline>
              <input type="hidden" name="replace" value="1" />
            </ActionForm>
            <details>
              <summary className="cursor-pointer text-xs text-muted">{p.selfEnter}</summary>
              <div className="mt-2"><BrandProfileForm slug={slug} own={own} ro={false} compact /></div>
            </details>
          </div>
        )
        : <p className="mt-1 text-sm text-muted">{p.editorsCanAdd}</p>}
    </section>
  );
}
