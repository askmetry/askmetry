import 'server-only';
import { eq } from 'drizzle-orm';
import { db, recommendation } from '@opengeo/db';
import type { PromptContext } from '@opengeo/core/present';
import { nextMeasurementText } from '@opengeo/core';
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

type Ws = { name: string; scheduleEnabled: boolean; scheduleCron: string };
type BrandRow = { name: string; description: string | null; domains: string[]; isOwn: boolean; kind?: string | null };

/** Kontext für die Claude-Prompts: Marke, Wettbewerber, nächste Messung. */
export function promptContext(ws: Ws, brands: readonly BrandRow[]): PromptContext {
  const own = brands.find((b) => b.isOwn);
  const next = nextMeasurementText(ws);
  return {
    brand: { name: own?.name ?? ws.name, description: own?.description ?? null, domains: own?.domains ?? [], kind: own?.kind ?? null },
    competitors: brands.filter((b) => !b.isOwn).map((b) => b.name),
    workspaceName: ws.name,
    nextMeasurement: next,
  };
}
