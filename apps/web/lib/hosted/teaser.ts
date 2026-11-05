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
