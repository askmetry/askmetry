import { ActionForm } from '@/components/action-form';
import { BrandMark } from '@/components/brand-mark';
import { BrandProfileForm } from '@/components/brand-profile';
import { box, Group, SettingsHeader } from '@/components/settings-ui';
import { saveBrand } from '@/lib/actions/settings';
import { removeBrandLogo, uploadBrandLogo } from '@/lib/actions/brand-logo';
import { LogoFileInput } from '@/components/logo-file-input';
import { workspaceContext } from '@/lib/context';
import { logoMap } from '@/lib/logos';

export const metadata = { title: 'Marke · Einstellungen' };

export default async function MarkePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { own, canEdit } = await workspaceContext(slug, {});
  const ro = !canEdit;
  if (!own) return <><SettingsHeader title="Marke" /><p className={`${box} text-sm text-muted`}>Für diesen Workspace ist noch keine eigene Marke hinterlegt.</p></>;
  const logo = (await logoMap(slug, [own])).get(own.name.toLowerCase());
  return (
    <>
      <SettingsHeader title="Marke" intro="Wer du bist – daraus entstehen Messung, Maßnahmen und KI-Prompts." ro={ro} />
      <div className={`${box} flex flex-wrap items-center gap-4`}>
        <BrandMark name={own.name} src={logo} size={56} own />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{own.name}</p>
          <p className="truncate text-sm text-muted">{own.domains.join(', ') || 'Noch keine Website'}</p>
          <p className="mt-0.5 text-xs text-muted" data-testid="logo-source">
            {own.logoType ? 'Eigenes Logo.' : logo ? 'Logo von deiner Website übernommen.' : 'Kein Logo auf der Website gefunden – wir zeigen die Initiale.'}
          </p>
        </div>
        {!ro && (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <ActionForm action={uploadBrandLogo} slug={slug} submit="Hochladen" submitClass="btn btn-sm" className="flex flex-wrap items-center gap-2" inline>
              <LogoFileInput />
            </ActionForm>
            {own.logoType
              ? <ActionForm action={removeBrandLogo} slug={slug} submit="Wieder Website-Logo verwenden" submitClass="text-xs text-accent hover:underline" inline />
              : <p className="text-xs text-muted">Quadratisch, höchstens 200 KB.</p>}
          </div>
        )}
      </div>

      <Group title="Was du anbietest">
        <div className={box}>
          <BrandProfileForm slug={slug} own={own} ro={ro} />
          <p className="mt-3 text-xs text-muted">Verbessert Maßnahmen und KI-Prompts: Je genauer die Beschreibung, desto passender die Texte.</p>
        </div>
      </Group>

      <Group title="Name und Website">
        <div className={box}>
          <ActionForm action={saveBrand} slug={slug} submit="Speichern" submitClass="btn btn-sm" disabled={ro} className="space-y-4">
            <input type="hidden" name="id" value={own.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="b-name">Name</label><input className="input" id="b-name" name="name" defaultValue={own.name} required /></div>
              <div><label className="label" htmlFor="b-domains">Website</label><input className="input" id="b-domains" name="domains" defaultValue={own.domains.join(', ')} placeholder="example.de" /></div>
            </div>
            <details open={own.aliases.length > 0}>
              <summary className="cursor-pointer select-none text-sm text-muted hover:text-fg">Andere Schreibweisen</summary>
              <div className="mt-2">
                <input className="input" id="b-aliases" name="aliases" defaultValue={own.aliases.join(', ')} placeholder="kommagetrennt, z. B. PayLindo, Pay Lindo" aria-label="Andere Schreibweisen" />
                <p className="mt-1 text-xs text-muted">Damit erkennen wir Nennungen auch, wenn die KI deinen Namen anders schreibt.</p>
              </div>
            </details>
          </ActionForm>
        </div>
      </Group>
    </>
  );
}
