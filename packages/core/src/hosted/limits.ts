// Tagesbudgets der gehosteten Version (Kalendertag Europe/Berlin).
// Gezählt werden alle KI-Kosten: Runs (nach Abschluss), recommendation_generation (Formulierung, Markenprofil, Discovery)
// sowie Discovery-Kosten fehlgeschlagener Checks ohne Arbeitsbereich (stehen nur auf check_request.cost_usd).
import { checkRequest, db, recommendationGeneration, run, workspace } from '@askmetry/db';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { estimatedCostPerRun } from '../engine-config.ts';
import { isMockMode } from '../engines/index.ts';
import { hostedConfig } from './config.ts';
import { notifyOps } from './notify.ts';
import { berlinDayStart } from './util.ts';

async function sumToday(onlyCheckWorkspaces: boolean): Promise<number> {
  const wsFilter = onlyCheckWorkspaces
    ? sql`and workspace_id in (select id from ${workspace} where ${workspace.hostedKind} = 'check')` : sql``;
  const [[r], [g], [d]] = await Promise.all([
    db.select({ t: sql<string>`coalesce(sum(${run.costUsd}), 0)` }).from(run)
      .where(sql`${run.finishedAt} is not null and ${run.finishedAt} >= ${berlinDayStart} ${wsFilter}`),
    db.select({ t: sql<string>`coalesce(sum(${recommendationGeneration.costUsd}), 0)` }).from(recommendationGeneration)
      .where(sql`${recommendationGeneration.createdAt} >= ${berlinDayStart} ${wsFilter}`),
    db.select({ t: sql<string>`coalesce(sum(${checkRequest.costUsd}), 0)` }).from(checkRequest)
      .where(and(isNull(checkRequest.workspaceId), inArray(checkRequest.status, ['failed', 'blocked']), sql`${checkRequest.createdAt} >= ${berlinDayStart}`)),
  ]);
  return Number(r?.t ?? 0) + Number(g?.t ?? 0) + Number(d?.t ?? 0);
}

/** Alle KI-Kosten heute (Checks + Berichte + Selbst-Hosting-Arbeitsbereiche auf derselben Instanz). */
export const globalSpendToday = () => sumToday(false);
/** KI-Kosten der Schnell-Checks heute (Arbeitsbereiche mit hosted_kind = 'check'). */
export const checkSpendToday = () => sumToday(true);

export type BudgetBlock = 'global_budget' | 'check_budget';

/**
 * Darf eine neue Messung (Check oder Bericht) starten? Prüft das globale Tagesbudget, bei Checks zusätzlich das
 * Check-Tagesbudget. `estimateUsd` = geschätzte Kosten der neuen Messung (Reserve). Meldet Überschreitungen an den Betrieb.
 */
export async function canStartMeasurement(kind: 'check' | 'report', estimateUsd = 0): Promise<{ ok: true } | { ok: false; reason: BudgetBlock }> {
  const cfg = hostedConfig();
  const global = await globalSpendToday();
  if (global + estimateUsd > cfg.globalDailyBudgetUsd + 1e-9) {
    void notifyOps(`Globales Tagesbudget erreicht (${global.toFixed(2)} $ von ${cfg.globalDailyBudgetUsd} $) – neue ${kind === 'check' ? 'Checks' : 'Berichte'} warten`);
    return { ok: false, reason: 'global_budget' };
  }
  if (kind === 'check') {
    const check = await checkSpendToday();
    if (check + estimateUsd > cfg.checkDailyBudgetUsd + 1e-9) {
      void notifyOps(`Check-Tagesbudget erreicht (${check.toFixed(2)} $ von ${cfg.checkDailyBudgetUsd} $)`);
      return { ok: false, reason: 'check_budget' };
    }
  }
  return { ok: true };
}

/** Geschätzte Kosten einer Messung: Prompts × Wiederholungen × Engines (mit Obergrenzen je Engine). */
export function estimateMeasurementUsd(plan: { prompts: number; repetitions: number; engines: string[]; engineMaxPrompts?: Record<string, number>; batch?: boolean }): number {
  if (isMockMode()) return 0;
  let total = 0;
  for (const e of plan.engines) {
    const n = Math.min(plan.prompts, plan.engineMaxPrompts?.[e] ?? Infinity);
    const per = e === 'claude' && plan.batch ? estimatedCostPerRun.claude_batch ?? 0 : estimatedCostPerRun[e] ?? 0;
    total += n * plan.repetitions * per;
  }
  return total;
}

/** Obergrenze neuer Discoveries (Schnell-Checks ohne Cache-Treffer) je Stunde, global. ASKMETRY_CHECK_DISCOVERIES_PER_HOUR, Standard 30. */
export function checkDiscoveriesPerHour(): number {
  const raw = process.env.ASKMETRY_CHECK_DISCOVERIES_PER_HOUR?.trim();
  const v = Number(raw);
  return raw && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 30;
}
