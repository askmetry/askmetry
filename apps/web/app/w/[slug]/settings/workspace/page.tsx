import { ActionForm } from '@/components/action-form';
import { box, SettingsHeader } from '@/components/settings-ui';
import { saveWorkspaceSettings } from '@/lib/actions/settings';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Workspace · Einstellungen' };

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, canEdit } = await requireWorkspace(slug);
  const ro = !canEdit;
  return (
    <>
      <SettingsHeader title="Workspace" intro="Name sowie Land und Sprache, in denen wir die KI-Suchen fragen." ro={ro} />
      <div className={box}>
        <ActionForm action={saveWorkspaceSettings} slug={slug} submit="Speichern" disabled={ro} className="space-y-4">
          <input type="hidden" name="part" value="workspace" />
          <div><label className="label" htmlFor="w-name">Name</label><input className="input" id="w-name" name="name" defaultValue={ws.name} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="w-country">Land</label>
              <select className="input" id="w-country" name="country" defaultValue={ws.country}><option value="DE">Deutschland</option><option value="AT">Österreich</option><option value="CH">Schweiz</option></select></div>
            <div><label className="label" htmlFor="w-lang">Sprache</label>
              <select className="input" id="w-lang" name="language" defaultValue={ws.language}><option value="de">Deutsch</option><option value="en">Englisch</option></select></div>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
