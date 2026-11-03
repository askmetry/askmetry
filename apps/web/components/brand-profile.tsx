import { ActionForm } from '@/components/action-form';
import { confirmBrandProfile, detectBrandProfile, saveBrandProfile } from '@/lib/actions/brand-profile';
import { BRAND_KINDS, DESCRIPTION_MAX } from '@/lib/brand-kind';

type Own = { name: string; description: string | null; kind: string | null; profileSource?: string | null };

const kindLabel = (k: string | null) => BRAND_KINDS.find((x) => x.value === k)?.label ?? null;

/** Banner nötig? Wenn das Profil fehlt oder nur automatisch erkannt und noch nicht bestätigt ist. */
export const needsProfileBanner = (own: Own) => own.profileSource === 'auto' || !own.description?.trim();

/** Felder für Beschreibung + Markentyp der eigenen Marke (eigene kleine Action, nicht settings.ts). */
export function BrandProfileForm({ slug, own, ro, compact = false }: { slug: string; own: Own; ro: boolean; compact?: boolean }) {
  return (
    <div className="space-y-2">
      <ActionForm action={saveBrandProfile} slug={slug} submit="Speichern" submitClass="btn btn-primary btn-sm" disabled={ro}
        className={compact ? 'flex flex-col gap-2 sm:flex-row sm:items-end' : 'space-y-3'}>
        {compact && <input type="hidden" name="requireDescription" value="1" />}
        <div className="min-w-0 flex-1">
          <label className={compact ? 'sr-only' : 'label'} htmlFor={compact ? 'bp-desc-c' : 'bp-desc'}>Was bietest du an – und für wen?</label>
          {compact
            ? <input className="input" id="bp-desc-c" name="description" defaultValue={own.description ?? ''} maxLength={DESCRIPTION_MAX}
                placeholder={`z. B. ${own.name} vermietet EC-Kartenterminals an Cafés und kleine Läden`} />
            : <textarea className="input min-h-24" id="bp-desc" name="description" defaultValue={own.description ?? ''} maxLength={DESCRIPTION_MAX}
                placeholder={`z. B. ${own.name} vermietet EC-Kartenterminals an Cafés und kleine Läden – ohne Vertragsbindung.`} />}
        </div>
        <div className={compact ? 'sm:w-48' : 'sm:w-64'}>
          <label className={compact ? 'sr-only' : 'label'} htmlFor={compact ? 'bp-kind-c' : 'bp-kind'}>Art der Marke</label>
          <select className="input" id={compact ? 'bp-kind-c' : 'bp-kind'} name="kind" defaultValue={own.kind ?? ''}>
            <option value="">Art der Marke …</option>
            {BRAND_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
      </ActionForm>
      {!compact && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {own.profileSource === 'auto' && <span data-testid="profile-auto">Automatisch von deiner Website erkannt.</span>}
          <ActionForm action={detectBrandProfile} slug={slug} submit="Von Website neu erkennen" submitClass="text-xs text-accent hover:underline" disabled={ro} inline>
            <input type="hidden" name="replace" value="1" />
          </ActionForm>
        </div>
      )}
    </div>
  );
}

/** Profil der Marke: automatisch erkannt → bestätigen; fehlt → von der Website erkennen oder selbst eintragen. */
export function BrandProfileBanner({ slug, own, canEdit }: { slug: string; own: Own; canEdit: boolean }) {
  if (!needsProfileBanner(own)) return null;
  if (own.profileSource === 'auto' && own.description) {
    const kind = kindLabel(own.kind);
    return (
      <section aria-label="Erkanntes Markenprofil" data-testid="brand-banner" data-state="auto" className="rounded-2xl bg-accent-soft px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">Von deiner Website erkannt</p>
        <p className="mt-1 text-[15px]">„{own.description}“{kind && <span className="ml-2 rounded-full bg-card px-2 py-0.5 text-xs text-muted">{kind}</span>}</p>
        {canEdit ? (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <ActionForm action={confirmBrandProfile} slug={slug} submit="Passt" submitClass="btn btn-primary btn-sm" inline />
            <details className="group min-w-0 flex-1">
              <summary className="btn btn-sm inline-flex cursor-pointer list-none">Ändern</summary>
              <div className="mt-3"><BrandProfileForm slug={slug} own={own} ro={false} compact /></div>
            </details>
          </div>
        ) : <p className="mt-1 text-sm text-muted">Bearbeiten kann das jemand mit Bearbeitungsrechten in den Einstellungen.</p>}
      </section>
    );
  }
  return (
    <section aria-label="Marke beschreiben" data-testid="brand-banner" data-state="empty" className="rounded-2xl bg-accent-soft px-5 py-4">
      <p className="text-sm font-medium">Was bietet {own.name} an? Damit werden Maßnahmen und KI-Prompts genauer.</p>
      {canEdit
        ? (
          <div className="mt-3 space-y-3">
            {/* replace: es gibt keine Beschreibung, die verloren gehen könnte; ein selbst gewählter Typ bleibt erhalten */}
            <ActionForm action={detectBrandProfile} slug={slug} submit="Von Website erkennen" submitClass="btn btn-primary btn-sm" inline>
              <input type="hidden" name="replace" value="1" />
            </ActionForm>
            <details>
              <summary className="cursor-pointer text-xs text-muted">Lieber selbst eintragen</summary>
              <div className="mt-2"><BrandProfileForm slug={slug} own={own} ro={false} compact /></div>
            </details>
          </div>
        )
        : <p className="mt-1 text-sm text-muted">Das kann jemand mit Bearbeitungsrechten in den Einstellungen nachtragen.</p>}
    </section>
  );
}
