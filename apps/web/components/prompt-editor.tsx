import { ActionForm } from '@/components/action-form';
import { box, Group, MENU_DANGER } from '@/components/settings-ui';
import { RowMenu } from '@/components/ui';
import { deletePrompt, deleteTopic, savePrompt, saveTopic } from '@/lib/actions/settings';
import { loadPromptsAndTopics } from '@/lib/prompts';
import { getT } from '@/lib/i18n/server';
import type { Messages } from '@/lib/i18n/messages';

/**
 * Fragen und Themen bearbeiten (Einstellungen → Fragen und „Bericht vorbereiten“). `ro` = nur lesen.
 * `showTopics = false` (Standortbestimmung): keine Themen-Auswahl und -Verwaltung; die Zuordnung bleibt beim Speichern erhalten.
 */
export async function PromptEditor({ slug, workspaceId, ro, showTopics = true }: { slug: string; workspaceId: string; ro: boolean; showTopics?: boolean }) {
  const t = (await getT()).settings;
  const q = t.prompts;
  const { prompts, topics } = await loadPromptsAndTopics(workspaceId);
  return (
    <>
      {!ro && (
        <ActionForm action={savePrompt} slug={slug} submit={q.add} resetOnSuccess className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3 shadow-card" inline>
          <input className="input min-w-0 flex-1 basis-64" name="text" placeholder={q.placeholder} aria-label={q.newLabel} />
          {showTopics && <TopicSelect topics={topics} value={null} t={q} />}
          <input type="hidden" name="active" value="on" />
        </ActionForm>
      )}

      {prompts.length === 0 ? <p className={`${box} text-sm text-muted`}>{q.empty}</p> : (
        <ul className="divide-y divide-border rounded-2xl bg-card shadow-card" data-testid="prompt-list">
          {prompts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 p-3">
              <ActionForm action={savePrompt} slug={slug} submit={t.save} submitClass="btn btn-sm" disabled={ro} className="flex min-w-0 flex-1 flex-wrap items-center gap-2" inline>
                <input type="hidden" name="id" value={p.id} />
                <input className="input min-w-0 flex-1 basis-64" name="text" defaultValue={p.text} aria-label={q.label} />
                {showTopics ? <TopicSelect topics={topics} value={p.topicId} t={q} /> : <input type="hidden" name="topicId" value={p.topicId ?? ''} />}
                <label className="flex items-center gap-1.5 text-sm text-muted" title={q.inactiveHint}><input type="checkbox" name="active" defaultChecked={p.active} /> {q.active}</label>
              </ActionForm>
              {!ro && (
                <RowMenu label={q.actions}>
                  <ActionForm action={deletePrompt} slug={slug} submit={q.delete} submitClass={MENU_DANGER} confirm={q.deleteConfirm} inline>
                    <input type="hidden" name="id" value={p.id} />
                  </ActionForm>
                </RowMenu>
              )}
            </li>
          ))}
        </ul>
      )}

      {showTopics && <Group title={q.topics(topics.length)}>
        <div className={`${box} space-y-2`}>
          {topics.length === 0 && <p className="text-sm text-muted">{q.noTopics}</p>}
          {topics.map((tp) => (
            <div key={tp.id} className="flex items-center gap-2">
              <ActionForm action={saveTopic} slug={slug} submit={t.save} submitClass="btn btn-sm" disabled={ro} className="flex flex-1 items-center gap-2" inline>
                <input type="hidden" name="id" value={tp.id} />
                <input className="input" name="name" defaultValue={tp.name} aria-label={q.topicName} />
              </ActionForm>
              {!ro && (
                <RowMenu label={t.actionsFor(tp.name)}>
                  <ActionForm action={deleteTopic} slug={slug} submit={q.deleteTopic} submitClass={MENU_DANGER} confirm={q.deleteTopicConfirm(tp.name)} inline>
                    <input type="hidden" name="id" value={tp.id} />
                  </ActionForm>
                </RowMenu>
              )}
            </div>
          ))}
          {!ro && (
            <ActionForm action={saveTopic} slug={slug} submit={t.add} submitClass="btn btn-sm" resetOnSuccess className="flex items-center gap-2 pt-1" inline>
              <input className="input" name="name" placeholder={q.newTopic} aria-label={q.newTopic} />
            </ActionForm>
          )}
        </div>
      </Group>}
    </>
  );
}

function TopicSelect({ topics, value, t }: { topics: { id: string; name: string }[]; value: string | null; t: Messages['settings']['prompts'] }) {
  return (
    <select className="input !w-auto" name="topicId" defaultValue={value ?? ''} aria-label={t.topic}>
      <option value="">{t.noTopic}</option>
      {topics.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
    </select>
  );
}
