import 'server-only';
// Serverseitige Helfer der gehosteten Version für Seiten und Server Actions der Web-App.
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { checkRequest, db, report } from '@askmetry/db';
import { hostedConfig, isHosted } from '@askmetry/core/hosted/config';
import { clientIp as clientIpFrom } from '@/components/marketing/format';
import { scopeLimits, workspaceRights, type WorkspaceRights } from './rights';

export { isHosted };

type Ws = { id: string; hostedKind: string | null };

/** Berichte eines Workspaces (nur Status/Art – für Rechte und Navigation). */
export const reportStatuses = cache(async (workspaceId: string) =>
  db.select({ id: report.id, tier: report.tier, kind: report.kind, status: report.status, readyAt: report.readyAt })
    .from(report).where(eq(report.workspaceId, workspaceId)).orderBy(desc(report.createdAt)));

/** Rechte im Workspace (siehe rights.ts); selbst gehostet alles erlaubt, ohne DB-Zugriff. */
export async function rightsFor(ws: Ws): Promise<WorkspaceRights & { customer: boolean }> {
  const hosted = isHosted();
  if (!hosted || ws.hostedKind !== 'customer') return { ...workspaceRights({ hosted, hostedKind: ws.hostedKind }), customer: false };
  const reps = await reportStatuses(ws.id);
  return { ...workspaceRights({ hosted, hostedKind: ws.hostedKind, reportStatuses: reps.map((r) => r.status), remeasurePaid: reps.some((r) => r.kind === 'remeasure' && r.status === 'paid') }), customer: true };
}

/** Obergrenzen für Fragen/Wettbewerber im Kunden-Workspace (null = keine). */
export async function limitsFor(ws: Ws): Promise<{ prompts: number; competitors: number } | null> {
  if (!isHosted() || ws.hostedKind !== 'customer') return null;
  return scopeLimits(await reportStatuses(ws.id));
}

/** Letzter fertiger Erstbericht/Nachmessung → Link „Nachmessung kaufen“ (gleicher Umfang). */
export async function remeasureHref(ws: Ws & { slug: string }): Promise<string | null> {
  if (!isHosted() || ws.hostedKind !== 'customer') return null;
  const last = (await reportStatuses(ws.id)).find((r) => r.status === 'ready');
  return last ? `/kaufen?tier=${last.tier}&workspace=${encodeURIComponent(ws.slug)}&kind=remeasure` : null;
}

/** Ziel für „Messung starten/Status ansehen“: im Kunden-Workspace die Berichte, sonst Einstellungen → Messung. */
export const measureHref = (slug: string, customer: boolean) => (customer ? `/w/${slug}/berichte` : `/w/${slug}/settings/messung`);

/** Cookie aus /check/<token>/bestaetigen: dieser Browser hat die Check-Adresse bestätigt. */
export const CHECK_VERIFIED_COOKIE = 'askmetry_check_verified';

/**
 * E-Mail-Adresse eines Checks für die Vorbelegung der Registrierung – nur nach Bestätigung und nur in dem Browser,
 * der den Bestätigungslink geöffnet hat (der Token allein reicht nicht; er steckt in weitergegebenen Links).
 */
export async function verifiedCheckEmail(token: string): Promise<string | null> {
  if (!isHosted()) return null;
  if ((await cookies()).get(CHECK_VERIFIED_COOKIE)?.value !== token) return null;
  const [c] = await db.select({ email: checkRequest.email, verified: checkRequest.emailVerifiedAt }).from(checkRequest)
    .where(and(eq(checkRequest.token, token))).limit(1);
  return c?.verified && c.email ? c.email : null;
}

/** Kontaktadresse für Fehlerseiten: Absender aus MAIL_FROM, sonst hallo@askmetry.ai. */
export function contactEmail(): string {
  const m = /<([^>]+)>/.exec(hostedConfig().mail.from)?.[1] ?? hostedConfig().mail.from;
  return /@/.test(m) && !/localhost|noreply|no-reply/i.test(m) ? m : 'hallo@askmetry.ai';
}

/** Client-IP aus den Proxy-Headern (nur für Ratenbegrenzung/Turnstile; nie speichern oder loggen). */
export async function clientIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}
