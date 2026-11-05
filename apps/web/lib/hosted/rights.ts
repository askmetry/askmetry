// Rechte in der gehosteten Version (rein, testbar). Server Actions und Seiten fragen hier, was in einem Workspace erlaubt ist.
import { REPORT_SCOPE, type ReportTier } from '@askmetry/core/hosted/config';

export type HostedKind = 'check' | 'customer' | null;
export type ReportStatus = 'pending_payment' | 'paid' | 'measuring' | 'ready' | 'failed' | 'canceled' | 'refunded';

export interface WorkspaceRights {
  /** „Jetzt messen“ / „Neu messen“ */
  measureNow: boolean;
  /** Messplan, KI-Auswahl, Wiederholungen (Einstellungen → Messung) */
  measureSettings: boolean;
  /** Monatsbudget und Kosten (Einstellungen → Kosten) */
  costs: boolean;
  /** Fragen, Themen, Wettbewerber ändern */
  editPromptsAndCompetitors: boolean;
  /** Berichte-Bereich zeigen */
  reports: boolean;
  /** Warum Fragen/Wettbewerber gesperrt sind (null = nicht gesperrt) */
  lockReason: 'measuring' | 'remeasure' | null;
  /** Wortlaut bestehender Fragen fest (nach dem ersten fertigen Bericht: die Nachmessung misst dieselben Fragen) */
  promptTextLocked: boolean;
}

/**
 * Was in einem Workspace erlaubt ist. Selbst gehostet (hosted = false) bleibt alles wie bisher.
 * Kunden-Workspaces: Messen nur über Berichte; Fragen/Wettbewerber gesperrt, solange ein Bericht misst – und solange eine
 * bezahlte Nachmessung auf den Start wartet (sie misst genau die Fragen der Vormessung; Änderungen würden sie verfälschen).
 */
export function workspaceRights(i: { hosted: boolean; hostedKind: string | null | undefined; reportStatuses?: readonly string[]; remeasurePaid?: boolean }): WorkspaceRights {
  if (!i.hosted || i.hostedKind !== 'customer') {
    return { measureNow: true, measureSettings: true, costs: true, editPromptsAndCompetitors: true, reports: false, lockReason: null, promptTextLocked: false };
  }
  const lockReason = (i.reportStatuses ?? []).includes('measuring') ? 'measuring' : i.remeasurePaid ? 'remeasure' : null;
  const promptTextLocked = (i.reportStatuses ?? []).includes('ready');
  return { measureNow: false, measureSettings: false, costs: false, editPromptsAndCompetitors: !lockReason, reports: true, lockReason, promptTextLocked };
}

/** Check-Workspaces gehören niemandem und sind nie für Nutzer sichtbar. */
export const isHiddenWorkspace = (hostedKind: string | null | undefined) => hostedKind === 'check';

/** Obergrenzen für Fragen/Wettbewerber aus den bezahlten Berichten (größter Umfang gewinnt; ohne Bericht: Standortbestimmung). */
export function scopeLimits(reports: readonly { tier: string; status: string }[]): { prompts: number; competitors: number } {
  const relevant = reports.filter((r) => ['paid', 'measuring', 'ready'].includes(r.status));
  const strategy = relevant.some((r) => r.tier === 'strategy');
  const s = REPORT_SCOPE[strategy ? 'strategy' : 'compact'];
  return { prompts: s.prompts, competitors: s.competitors };
}

export type StartProblem = 'tooManyPrompts' | 'tooFewPrompts' | 'tooManyCompetitors' | 'preparing' | 'wrongState';

/**
 * Kann „Messung starten“ gedrückt werden? Weniger Fragen als vorgesehen sind erlaubt (der Kunde darf streichen),
 * mehr nicht. Ein Strategiebericht wartet, bis die zusätzlichen Fragen erzeugt sind (`preparing`).
 */
export function startProblem(i: { status: string; tier: ReportTier; kind: string; activePrompts: number; competitors: number; preparing?: boolean }): StartProblem | null {
  if (i.status !== 'paid') return 'wrongState';
  if (i.kind === 'remeasure') return null; // gleiche Fragen wie zuvor – nichts zu prüfen
  const s = REPORT_SCOPE[i.tier];
  if (i.tier === 'strategy' && i.preparing) return 'preparing';
  if (i.activePrompts < 1) return 'tooFewPrompts';
  if (i.activePrompts > s.prompts) return 'tooManyPrompts';
  if (i.competitors > s.competitors) return 'tooManyCompetitors';
  return null;
}

/**
 * Strategiebericht (Erstbericht): Zusatzfragen erzeugt der Worker nach der Zahlung. Solange weniger als 60 Fragen aktiv sind
 * und kein Fehler vermerkt ist (wie startReport im Kern), höchstens 10 Minuten lang als „wird vorbereitet“ zeigen.
 */
/** Strategiebericht wartet auf seine Zusatzfragen? Quelle ist der Kern (`ReportView.promptsPreparing`). */
export function strategyPreparing(i: { promptsPreparing: boolean }): boolean {
  return i.promptsPreparing;
}
