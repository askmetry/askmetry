import { ActionForm } from '@/components/action-form';
import { BrandMark } from '@/components/brand-mark';
import { BrandProfileForm } from '@/components/brand-profile';
import { box, Group, SettingsHeader } from '@/components/settings-ui';
import { saveBrand } from '@/lib/actions/settings';
import { removeBrandLogo, uploadBrandLogo } from '@/lib/actions/brand-logo';
import { LogoFileInput } from '@/components/logo-file-input';
import { workspaceContext } from '@/lib/context';
import { logoMap } from '@/lib/logos';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = (await getT()).settings;
  return { title: t.metaTitle(t.pages.marke) };
}

export default async function MarkePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { own, canEdit } = await workspaceContext(slug, {});
  const ro = !canEdit;
  const t = (await getT()).settings;
  const b = t.brand;
  if (!own) return <><SettingsHeader title={t.pages.marke} /><p className={`${box} text-sm text-muted`}>{b.noOwn}</p></>;
  const logo = (await logoMap(slug, [own])).get(own.name.toLowerCase());
  return (
    <>
      <SettingsHeader title={t.pages.marke} intro={b.intro} ro={ro} />
      <div className={`${box} flex flex-wrap items-center gap-4`}>
        <BrandMark name={own.name} src={logo} size={56} own />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{own.name}</p>
          <p className="truncate text-sm text-muted">{own.domains.join(', ') || b.noWebsite}</p>
          <p className="mt-0.5 text-xs text-muted" data-testid="logo-source">
            {own.logoType ? b.logoCustom : logo ? b.logoFromSite : b.logoNone}
          </p>
        </div>
        {!ro && (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <ActionForm action={uploadBrandLogo} slug={slug} submit={b.upload} submitClass="btn btn-sm" className="flex flex-wrap items-center gap-2" inline>
              <LogoFileInput />
            </ActionForm>
            {own.logoType
              ? <ActionForm action={removeBrandLogo} slug={slug} submit={b.useSiteLogo} submitClass="text-xs text-accent hover:underline" inline />
              : <p className="text-xs text-muted">{b.logoHint}</p>}
          </div>
        )}
      </div>

      <Group title={b.offerGroup}>
        <div className={box}>
          <BrandProfileForm slug={slug} own={own} ro={ro} />
          <p className="mt-3 text-xs text-muted">{b.offerHint}</p>
        </div>
      </Group>

      <Group title={b.nameGroup}>
        <div className={box}>
          <ActionForm action={saveBrand} slug={slug} submit={t.save} submitClass="btn btn-sm" disabled={ro} className="space-y-4">
            <input type="hidden" name="id" value={own.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="b-name">{t.name}</label><input className="input" id="b-name" name="name" defaultValue={own.name} required /></div>
              <div><label className="label" htmlFor="b-domains">{t.website}</label><input className="input" id="b-domains" name="domains" defaultValue={own.domains.join(', ')} placeholder="example.de" /></div>
            </div>
            <details open={own.aliases.length > 0}>
              <summary className="cursor-pointer select-none text-sm text-muted hover:text-fg">{b.aliases}</summary>
              <div className="mt-2">
                <input className="input" id="b-aliases" name="aliases" defaultValue={own.aliases.join(', ')} placeholder={b.aliasesPlaceholder} aria-label={b.aliases} />
                <p className="mt-1 text-xs text-muted">{b.aliasesHint}</p>
              </div>
            </details>
          </ActionForm>
        </div>
      </Group>
    </>
  );
}
