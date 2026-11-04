import 'server-only';

/** Obergrenze für das Monatsbudget eines Workspaces (env ASKMETRY_MAX_BUDGET_USD, Standard 200 USD). */
export function maxBudgetUsd(): number {
  const raw = process.env.ASKMETRY_MAX_BUDGET_USD?.trim();
  const v = Number(raw);
  return raw && Number.isFinite(v) && v >= 0 ? v : 200;
}

/** Selbstregistrierung erlaubt? (env ASKMETRY_ALLOW_SIGNUP, Standard true; "false" schaltet sie ab) */
export function signupAllowed(): boolean {
  return (process.env.ASKMETRY_ALLOW_SIGNUP ?? 'true').trim().toLowerCase() !== 'false';
}
