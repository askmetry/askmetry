// Reine Darstellungslogik des Schnell-Check-Teasers (ohne DB, testbar). Zahlen kommen nur aus CheckSummary – nichts wird erfunden.
import type { RecCategory } from '@askmetry/core/present';
import type { CheckProgress, CheckStatus, CheckSummary, RecArea } from '@askmetry/core/hosted/types';

/** Teaser-Bereiche in der Reihenfolge der Maßnahmen-Seite und ihre Kategorie (Icon/Farbe/Label aus present.ts). */
export const AREA_ORDER: readonly RecArea[] = ['own_content', 'other_sites', 'community', 'technical'];
export const AREA_CATEGORY: Record<RecArea, RecCategory> = {
  own_content: 'content', other_sites: 'offsite', community: 'community', technical: 'technical',
};

/**
 * Grober Sichtbarkeitswert (0–100) aus einer kleinen Stichprobe: auf 5er-Schritte gerundet,
 * damit niemand eine Genauigkeit liest, die 25–35 Antworten nicht hergeben. Ganz ohne Nennung bleibt es 0,
 * mit mindestens einer Nennung nie 0 (sonst widerspräche die Zahl dem Satz „in 1 von 10 Fragen genannt“).
 */
export function roughScore(visibility: number | null | undefined): number {
  if (visibility === null || visibility === undefined || !Number.isFinite(visibility) || visibility <= 0) return 0;
  const v = Math.min(1, visibility);
  return Math.max(5, Math.round((v * 100) / 5) * 5);
}

/** 95-%-Wilson-Intervall für k von n (wie im Bericht, packages/report wilson) – null ohne Antworten. */
export function wilsonInterval(k: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (!(n > 0) || k < 0) return null;
  const p = Math.min(1, k / n);
  const z2 = z * z;
  const d = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / d;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export interface VisibilityEstimate {
  /** Antworten mit Nennung / ausgewertete Antworten – dieselbe Kennzahl wie der Score im Bericht */
  mentioned: number;
  responses: number;
  /** grober Wert (5er-Schritte) und Spanne (nach außen auf 5er gerundet); null = Stichprobe zu klein für einen Wert */
  score: number | null;
  range: { low: number; high: number } | null;
  simulated: boolean;
}

/**
 * Sichtbarkeitsaussage des Teasers. Gleiche Kennzahl wie der Bericht (Anteil der KI-Antworten mit Nennung), aber
 * mit Spanne statt Scheingenauigkeit; unter `minResponses` Antworten gar kein Wert.
 * Ältere Summaries ohne `responsesMentioned`: Zähler aus visibility × responses.
 */
export function visibilityEstimate(
  s: Pick<CheckSummary, 'responses' | 'visibility' | 'responsesMentioned' | 'simulated'>,
  minResponses: number,
): VisibilityEstimate {
  const responses = Math.max(0, s.responses ?? 0);
  const mentioned = Math.min(responses, Math.max(0, s.responsesMentioned ?? Math.round((s.visibility ?? 0) * responses)));
  const w = responses >= Math.max(1, minResponses) ? wilsonInterval(mentioned, responses) : null;
  return {
    mentioned, responses, simulated: !!s.simulated,
    score: w ? roughScore(mentioned / responses) : null,
    range: w ? { low: Math.floor((w.low * 100) / 5) * 5, high: Math.ceil((w.high * 100) / 5) * 5 } : null,
  };
}

/** Zahl der gesperrten Maßnahmen: alle außer den frei gezeigten (nie negativ). */
export function lockedCount(summary: Pick<CheckSummary, 'recommendationsTotal'>, freeShown: number): number {
  return Math.max(0, (summary.recommendationsTotal ?? 0) - Math.max(0, freeShown));
}

export type AgentStepKey = 'read' | 'brand' | 'competitors' | 'questions' | 'chatgpt' | 'gemini' | 'google_aio' | 'google_ai_mode' | 'analyze' | 'measures';
export type AgentStepState = 'done' | 'current' | 'todo';
export type AgentStepDetail =
  | { kind: 'brand'; name: string }
  | { kind: 'competitors'; n: number }
  | { kind: 'questions'; n: number }
  | { kind: 'answered'; done: number; total: number };
export interface AgentStep { key: AgentStepKey; state: AgentStepState; detail: AgentStepDetail | null }

/** Reihenfolge der KI-Suchen in der Checkliste (gemessen wird parallel) */
export const AGENT_ENGINES = ['chatgpt', 'gemini', 'google_aio', 'google_ai_mode'] as const;

/**
 * Checkliste der Warteansicht – jeder Haken entspricht einem echten Zustand in der Datenbank:
 * Discovery-Schritt (read → profile → plan), angelegte Marken/Fragen, erledigte Runs je KI-Suche, Auswertung, Maßnahmen.
 * Wettbewerber und Fragen entstehen in einem KI-Aufruf und laufen deshalb gleichzeitig; die KI-Suchen ebenso.
 */
export function agentSteps(view: { status: CheckStatus; progress: CheckProgress }): AgentStep[] {
  const { status, progress: p } = view;
  const ready = status === 'ready';
  const discovered = status !== 'discovering';
  const measuring = status === 'measuring';
  const stage = p.stage ?? 'read';
  const st = (done: boolean, current: boolean): AgentStepState => (done ? 'done' : current ? 'current' : 'todo');
  const steps: AgentStep[] = [
    { key: 'read', state: st(discovered || stage !== 'read', !discovered), detail: null },
    { key: 'brand', state: st(discovered || stage === 'plan', stage === 'profile' && !discovered), detail: p.brandName && (discovered || stage === 'plan') ? { kind: 'brand', name: p.brandName } : null },
    { key: 'competitors', state: st(discovered, stage === 'plan'), detail: discovered && p.competitors ? { kind: 'competitors', n: p.competitors } : null },
    { key: 'questions', state: st(discovered, stage === 'plan'), detail: discovered && p.prompts ? { kind: 'questions', n: p.prompts } : null },
  ];
  for (const key of AGENT_ENGINES) {
    const e = p.engines.find((x) => x.engine === key);
    const done = ready || (!!e && e.done >= e.total);
    steps.push({ key, state: st(done, !!e && measuring), detail: e && !ready ? { kind: 'answered', done: Math.min(e.done, e.total), total: e.total } : null });
  }
  steps.push({ key: 'analyze', state: st(ready || p.recommending, p.analyzing), detail: null });
  steps.push({ key: 'measures', state: st(ready, p.recommending), detail: null });
  return steps;
}

/** Laufzeit als „m:ss“ (für „läuft seit …“). */
export function elapsedText(fromIso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Sekunden bis zum nächsten automatischen Aktualisieren (null = nicht nötig). Kurz, weil der Nutzer der Checkliste zuschaut. */
export function refreshSeconds(status: CheckStatus): number | null {
  if (status === 'discovering' || status === 'queued' || status === 'measuring') return 2;
  return null;
}

/** Domain für Anzeige und Link: ohne Protokoll/Pfad, ohne „www.“. Ungültiges → null. */
export function cleanDomain(d: string): string | null {
  const host = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/.test(host) ? host : null;
}
