// Schritt-Checkliste (rein).
/** Index setzen/entfernen; Ergebnis sortiert, ohne Duplikate. */
export function toggleStep(done: readonly number[], step: number, on: boolean): number[] {
  const s = new Set(done.filter((n) => Number.isInteger(n) && n >= 0));
  if (on) s.add(step); else s.delete(step);
  return [...s].sort((a, b) => a - b);
}
