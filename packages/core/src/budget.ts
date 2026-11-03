/**
 * Budgetprüfung vor einem Run: Monatssumme (inkl. noch laufender Runs) + geschätzte Run-Kosten
 * dürfen das Monatsbudget nicht überschreiten.
 */
export function exceedsBudget(input: { monthSpendUsd: number; reservedUsd?: number; estimateUsd: number; budgetUsd: number }): boolean {
  const { monthSpendUsd, reservedUsd = 0, estimateUsd, budgetUsd } = input;
  return monthSpendUsd + reservedUsd + estimateUsd > budgetUsd + 1e-9;
}

/** Obergrenze für workspace.monthly_budget_usd (Kostenschutz beim Hosting), env OPENGEO_MAX_BUDGET_USD, Standard 200 */
export function maxBudgetUsd(): number {
  const v = Number(process.env.OPENGEO_MAX_BUDGET_USD);
  return Number.isFinite(v) && v >= 0 && process.env.OPENGEO_MAX_BUDGET_USD?.trim() ? v : 200;
}
