import 'server-only';

/** Obergrenze für das Monatsbudget eines Workspaces (env OPENGEO_MAX_BUDGET_USD, Standard 200 USD). */
export function maxBudgetUsd(): number {
  const raw = process.env.OPENGEO_MAX_BUDGET_USD?.trim();
  const v = Number(raw);
  return raw && Number.isFinite(v) && v >= 0 ? v : 200;
}

/** Selbstregistrierung erlaubt? (env OPENGEO_ALLOW_SIGNUP, Standard true; "false" schaltet sie ab) */
export function signupAllowed(): boolean {
  return (process.env.OPENGEO_ALLOW_SIGNUP ?? 'true').trim().toLowerCase() !== 'false';
}
