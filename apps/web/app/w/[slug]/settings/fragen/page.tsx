import { SettingsHeader } from '@/components/settings-ui';
import { PromptEditor } from '@/components/prompt-editor';
import { requireWorkspace } from '@/lib/session';
import { rightsFor, topicsFor } from '@/lib/hosted/server';
import { loadPromptsAndTopics } from '@/lib/prompts';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = (await getT()).settings;
  return { title: t.metaTitle(t.pages.fragen) };
}

export default async function FragenSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, canEdit } = await requireWorkspace(slug);
  const locked = canEdit && !(await rightsFor(ws)).editPromptsAndCompetitors;
  const ro = !canEdit || locked;
  const all = await getT();
  const t = all.settings;
  const q = t.prompts;
  const { prompts } = await loadPromptsAndTopics(ws.id);
  const active = prompts.filter((p) => p.active).length;
  return (
    <>
      <SettingsHeader title={t.pages.fragen} ro={!canEdit} intro={locked ? all.reports.lock[(await rightsFor(ws)).lockReason === 'remeasure' ? 'remeasure' : 'measuring'] : q.intro(active, prompts.length)} />
      <PromptEditor slug={slug} workspaceId={ws.id} ro={ro} showTopics={await topicsFor(ws)} />
    </>
  );
}
