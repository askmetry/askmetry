import { ActionForm } from '@/components/action-form';
import { box, SettingsHeader } from '@/components/settings-ui';
import { saveWorkspaceSettings } from '@/lib/actions/settings';
import { requireWorkspace } from '@/lib/session';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = (await getT()).settings;
  return { title: t.metaTitle(t.pages.workspace) };
}

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, canEdit } = await requireWorkspace(slug);
  const ro = !canEdit;
  const t = (await getT()).settings;
  const w = t.workspace;
  return (
    <>
      <SettingsHeader title={t.pages.workspace} intro={w.intro} ro={ro} />
      <div className={box}>
        <ActionForm action={saveWorkspaceSettings} slug={slug} submit={t.save} disabled={ro} className="space-y-4">
          <input type="hidden" name="part" value="workspace" />
          <div><label className="label" htmlFor="w-name">{t.name}</label><input className="input" id="w-name" name="name" defaultValue={ws.name} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="w-country">{w.country}</label>
              <select className="input" id="w-country" name="country" defaultValue={ws.country}>{['DE', 'AT', 'CH'].map((c) => <option key={c} value={c}>{w.countries[c]}</option>)}</select></div>
            <div><label className="label" htmlFor="w-lang">{w.language}</label>
              <select className="input" id="w-lang" name="language" defaultValue={ws.language} aria-describedby="w-lang-hint">{['de', 'en'].map((l) => <option key={l} value={l}>{w.languages[l]}</option>)}</select></div>
          </div>
          <p id="w-lang-hint" className="text-xs text-muted">{w.languageHint}</p>
        </ActionForm>
      </div>
    </>
  );
}
