// Formular „Bericht kaufen“ prüfen und Rücksprung-Pfade bilden (rein, testbar).
import type { ReportKind, ReportTier } from '@askmetry/core/hosted/config';

/** Fehler-Codes von buyReport; Texte in t.billing.errors[code]. */
export type BuyErrorCode =
  | 'invalid'        // Felder fehlen/ungültig (Formular manipuliert)
  | 'b2bRequired'    // Häkchen „Ich kaufe als Unternehmer“ fehlt
  | 'termsRequired'  // AGB-Zustimmung fehlt
  | 'unavailable'    // Hosted aus oder Zahlung nicht konfiguriert
  | 'notFound'       // Check/Arbeitsbereich nicht gefunden
  | 'noPermission'   // Leserechte im Arbeitsbereich
  | 'failed';        // Fehler beim Anlegen/Checkout

export type BuyTarget = { checkToken: string } | { workspaceSlug: string };
export interface BuyForm { tier: ReportTier; kind: ReportKind; target: BuyTarget; b2b: boolean; terms: boolean }

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === 'string' ? v.trim() : ''; };
const checked = (f: FormData, k: string) => { const v = str(f, k); return v === 'on' || v === 'true' || v === '1'; };

/** Struktur prüfen (ohne Häkchen – die prüft buyReport erst nach der Anmeldung). */
export function parseBuyForm(f: FormData): { ok: true; form: BuyForm } | { ok: false; code: 'invalid' } {
  const tier = str(f, 'tier');
  const kind = str(f, 'kind') || 'initial';
  if (tier !== 'compact' && tier !== 'strategy') return { ok: false, code: 'invalid' };
  if (kind !== 'initial' && kind !== 'remeasure') return { ok: false, code: 'invalid' };
  const checkToken = str(f, 'checkToken');
  const workspaceSlug = str(f, 'workspaceSlug');
  // genau ein Ziel: Schnell-Check (nur Erstbericht) oder Arbeitsbereich
  if (!!checkToken === !!workspaceSlug) return { ok: false, code: 'invalid' };
  if (checkToken && (!TOKEN_RE.test(checkToken) || kind !== 'initial')) return { ok: false, code: 'invalid' };
  if (workspaceSlug && !SLUG_RE.test(workspaceSlug)) return { ok: false, code: 'invalid' };
  return {
    ok: true,
    form: { tier, kind, target: checkToken ? { checkToken } : { workspaceSlug }, b2b: checked(f, 'b2b'), terms: checked(f, 'terms') },
  };
}

/** Seite, auf der gekauft wurde (Rücksprung nach Registrierung bzw. bei Abbruch). */
export const originPath = (t: BuyTarget) => ('checkToken' in t ? `/check/${t.checkToken}` : `/w/${t.workspaceSlug}`);

/** Rücksprung-Pfade des Checkouts. Die Parameter dienen nur der Anzeige – bezahlt ist ein Bericht erst per Webhook. */
export function checkoutPaths(i: { slug: string; reportId: string; origin: string }) {
  return {
    success: `/w/${i.slug}/bericht/${i.reportId}?checkout=done`,
    cancel: `${i.origin}?checkout=canceled`,
  };
}

/** Registrierung mit Rücksprung (nur relative Pfade). */
export const signupUrl = (next: string) => `/signup?next=${encodeURIComponent(next)}`;
