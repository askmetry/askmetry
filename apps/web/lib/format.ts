// Deutsche Formatierung: „38 %“, „2,5“, „1,23 $“
const nf = (min: number, max: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max });
const NBSP = ' '; // schmales geschütztes Leerzeichen vor „%“

export function fmtPct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  return `${nf(digits, digits).format(x * 100)}${NBSP}%`;
}
export function fmtNum(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  return nf(digits, digits).format(x);
}
export function fmtInt(x: number | null | undefined): string {
  if (x === null || x === undefined) return '–';
  return nf(0, 0).format(x);
}
export function fmtUsd(x: number | string | null | undefined, digits = 2): string {
  if (x === null || x === undefined || x === '') return '–';
  return `${nf(digits, digits).format(Number(x))}${NBSP}$`;
}
export function fmtDate(d: Date | string | null | undefined, withTime = true): string {
  if (!d) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(d));
}
export const STATUS_LABELS: Record<string, string> = {
  queued: 'in Warteschlange', running: 'läuft', done: 'abgeschlossen', failed: 'fehlgeschlagen', budget_exceeded: 'Budget erreicht',
};
export const TRIGGER_LABELS: Record<string, string> = { scheduled: 'geplant', manual: 'manuell', import: 'Import' };
