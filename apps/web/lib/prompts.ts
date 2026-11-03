import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, prompt, topic } from '@opengeo/db';

export async function loadPromptsAndTopics(workspaceId: string) {
  const [prompts, topics] = await Promise.all([
    db.select().from(prompt).where(eq(prompt.workspaceId, workspaceId)).orderBy(prompt.createdAt),
    db.select().from(topic).where(eq(topic.workspaceId, workspaceId)).orderBy(topic.name),
  ]);
  return { prompts, topics };
}

export async function loadPrompt(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.select({ p: prompt, topicName: topic.name }).from(prompt).leftJoin(topic, eq(topic.id, prompt.topicId))
    .where(and(eq(prompt.id, id), eq(prompt.workspaceId, workspaceId)));
  return rows[0] ?? null;
}
