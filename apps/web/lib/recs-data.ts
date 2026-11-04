import 'server-only';
import { eq } from 'drizzle-orm';
import { db, recommendation } from '@askmetry/db';
import { buildClaudePrompt, localizeRec, toLang, type PromptContext, type RecLike } from '@askmetry/core/present';
import type { Locale } from './i18n/config';
import { nextMeasurementText } from '@askmetry/core';
import type { RecStatus } from './recommendations';

export type RecRow = {
  id: string; key: string; type: string; title: string; why: string; steps: string[]; impact: number; effort: number;
  priority: string; evidence: unknown; active: boolean; status: RecStatus; statusChangedAt: Date | null; baseline: unknown;
  firstSeenAt: Date; lastSeenAt: Date;
};

const cols = {
  id: recommendation.id, key: recommendation.key, type: recommendation.type, title: recommendation.title, why: recommendation.why,
  steps: recommendation.steps, impact: recommendation.impact, effort: recommendation.effort, priority: recommendation.priority,
  evidence: recommendation.evidence, active: recommendation.active, status: recommendation.status, statusChangedAt: recommendation.statusChangedAt,
  baseline: recommendation.baseline, firstSeenAt: recommendation.firstSeenAt, lastSeenAt: recommendation.lastSeenAt,
};

/** Alle Maßnahmen eines Workspaces (immer mit workspace_id gefiltert). */
export async function loadRecs(workspaceId: string): Promise<RecRow[]> {
  return db.select(cols).from(recommendation).where(eq(recommendation.workspaceId, workspaceId));
}

type Ws = { name: string; scheduleEnabled: boolean; scheduleCron: string; language?: string | null };
type BrandRow = { name: string; description: string | null; domains: string[]; isOwn: boolean; kind?: string | null };

/** Kontext für die Claude-Prompts: Marke, Wettbewerber, nächste Messung (in der UI-Sprache), Sprache der Inhalte (Workspace). */
export function promptContext(ws: Ws, brands: readonly BrandRow[], locale: Locale = 'de'): PromptContext {
  const own = brands.find((b) => b.isOwn);
  const next = nextMeasurementText(ws, new Date(), locale);
  return {
    brand: { name: own?.name ?? ws.name, description: own?.description ?? null, domains: own?.domains ?? [], kind: own?.kind ?? null },
    competitors: brands.filter((b) => !b.isOwn).map((b) => b.name),
    workspaceName: ws.name,
    nextMeasurement: next,
    contentLanguage: toLang(ws.language),
  };
}

/** KI-Prompt einer Maßnahme in der UI-Sprache (Texte der Maßnahme vorher über localizeRec). */
export function recPrompt(rec: RecLike, ctx: PromptContext, locale: Locale): string {
  return buildClaudePrompt(localizeRec(rec, locale), ctx, locale);
}
