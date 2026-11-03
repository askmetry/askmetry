import { ActionForm } from '@/components/action-form';
import { box, Group, MENU_DANGER, SettingsHeader } from '@/components/settings-ui';
import { RowMenu } from '@/components/ui';
import { deletePrompt, deleteTopic, savePrompt, saveTopic } from '@/lib/actions/settings';
import { requireWorkspace } from '@/lib/session';
import { loadPromptsAndTopics } from '@/lib/prompts';

export const metadata = { title: 'Fragen · Einstellungen' };

export default async function FragenSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, canEdit } = await requireWorkspace(slug);
  const ro = !canEdit;
  const { prompts, topics } = await loadPromptsAndTopics(ws.id);
  const active = prompts.filter((p) => p.active).length;
  return (
    <>
      <SettingsHeader title="Fragen" ro={ro}
        intro={`${active} von ${prompts.length} aktiv. So formuliert, wie deine Kundinnen und Kunden eine KI fragen würden.`} />

      {!ro && (
        <ActionForm action={savePrompt} slug={slug} submit="Frage hinzufügen" resetOnSuccess className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3 shadow-card" inline>
          <input className="input min-w-0 flex-1 basis-64" name="text" placeholder="z. B. Welches EC-Terminal eignet sich für einen Imbiss?" aria-label="Neue Frage" />
          <TopicSelect topics={topics} value={null} />
          <input type="hidden" name="active" value="on" />
        </ActionForm>
      )}

      {prompts.length === 0 ? <p className={`${box} text-sm text-muted`}>Noch keine Fragen.</p> : (
        <ul className="divide-y divide-border rounded-2xl bg-card shadow-card" data-testid="prompt-list">
          {prompts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 p-3">
              <ActionForm action={savePrompt} slug={slug} submit="Speichern" submitClass="btn btn-sm" disabled={ro} className="flex min-w-0 flex-1 flex-wrap items-center gap-2" inline>
                <input type="hidden" name="id" value={p.id} />
                <input className="input min-w-0 flex-1 basis-64" name="text" defaultValue={p.text} aria-label="Frage" />
                <TopicSelect topics={topics} value={p.topicId} />
                <label className="flex items-center gap-1.5 text-sm text-muted" title="Inaktive Fragen werden nicht gestellt"><input type="checkbox" name="active" defaultChecked={p.active} /> aktiv</label>
              </ActionForm>
              {!ro && (
                <RowMenu label="Aktionen für diese Frage">
                  <ActionForm action={deletePrompt} slug={slug} submit="Frage löschen" submitClass={MENU_DANGER} confirm="Frage löschen? Bisherige Antworten zu dieser Frage werden ebenfalls gelöscht." inline>
                    <input type="hidden" name="id" value={p.id} />
                  </ActionForm>
                </RowMenu>
              )}
            </li>
          ))}
        </ul>
      )}

      <Group title={`Themen (${topics.length}) – zum Gruppieren der Fragen`}>
        <div className={`${box} space-y-2`}>
          {topics.length === 0 && <p className="text-sm text-muted">Noch keine Themen.</p>}
          {topics.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <ActionForm action={saveTopic} slug={slug} submit="Speichern" submitClass="btn btn-sm" disabled={ro} className="flex flex-1 items-center gap-2" inline>
                <input type="hidden" name="id" value={t.id} />
                <input className="input" name="name" defaultValue={t.name} aria-label="Themenname" />
              </ActionForm>
              {!ro && (
                <RowMenu label={`Aktionen für ${t.name}`}>
                  <ActionForm action={deleteTopic} slug={slug} submit="Thema löschen" submitClass={MENU_DANGER} confirm={`Thema „${t.name}“ löschen?`} inline>
                    <input type="hidden" name="id" value={t.id} />
                  </ActionForm>
                </RowMenu>
              )}
            </div>
          ))}
          {!ro && (
            <ActionForm action={saveTopic} slug={slug} submit="Hinzufügen" submitClass="btn btn-sm" resetOnSuccess className="flex items-center gap-2 pt-1" inline>
              <input className="input" name="name" placeholder="Neues Thema" aria-label="Neues Thema" />
            </ActionForm>
          )}
        </div>
      </Group>
    </>
  );
}

function TopicSelect({ topics, value }: { topics: { id: string; name: string }[]; value: string | null }) {
  return (
    <select className="input !w-auto" name="topicId" defaultValue={value ?? ''} aria-label="Thema">
      <option value="">Ohne Thema</option>
      {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}
