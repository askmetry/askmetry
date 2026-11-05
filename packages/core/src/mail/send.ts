// Versand: SMTP (SMTP_URL, z. B. Brevo) oder – ohne SMTP bzw. mit ASKMETRY_MAIL_OUTBOX – als .eml + .json in einen Ordner.
// Fehler werden geworfen (Aufrufer entscheiden). Empfänger erscheinen in Logs nur maskiert.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { hostedConfig } from '../hosted/config.ts';

export interface MailAttachment { filename: string; content: Buffer; contentType?: string }
export interface MailMessage {
  to: string; subject: string; html: string; text: string; attachments?: MailAttachment[]; replyTo?: string;
  /** optionale Kopfzeilen, z. B. List-Unsubscribe (kommt aus mailTemplates.remeasureReminder) */
  headers?: Record<string, string>;
}

/** „max@firma.de“ → „m***@firma.de“ (für Logs). */
export function maskEmail(email: string): string {
  const s = String(email ?? '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return '***';
  return `${s[0]}***${s.slice(at)}`;
}

const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;
/** Einfache Prüfung einer einzelnen Adresse (keine Listen, keine Zeilenumbrüche – gegen Header-Injection). */
export function isValidEmail(s: string): boolean {
  return typeof s === 'string' && s.length <= 254 && EMAIL.test(s);
}

/** Alle http(s)-URLs aus einem Text, in Reihenfolge, ohne Dubletten (Satzzeichen am Ende entfernt). */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const u = m[0].replace(/[.,;:!?)\]}»“”’]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

function slugOf(s: string): string {
  const t = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
  return t || 'mail';
}

const transports = new Map<string, Transporter>();
function smtpTransport(url: string): Transporter {
  let t = transports.get(url);
  if (!t) {
    t = nodemailer.createTransport(url);
    transports.set(url, t);
  }
  return t;
}

const log = (msg: string) => console.info(`[mail] ${msg}`);

function toMailOptions(m: MailMessage, from: string) {
  return {
    from, to: m.to, subject: m.subject, html: m.html, text: m.text,
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(m.headers ? { headers: m.headers } : {}),
    attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { contentType: a.contentType } : {}) })),
  };
}

/** Eine Mail in den Outbox-Ordner schreiben; liefert die Pfade (für Tests). */
export async function writeToOutbox(m: MailMessage, dir: string, from: string): Promise<{ eml: string; json: string }> {
  const abs = path.resolve(dir);
  await mkdir(abs, { recursive: true });
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const info = await composer.sendMail(toMailOptions(m, from));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${stamp}-${slugOf(m.subject)}-${randomBytes(3).toString('hex')}`;
  const eml = path.join(abs, `${base}.eml`);
  const json = path.join(abs, `${base}.json`);
  await writeFile(eml, info.message as Buffer);
  await writeFile(json, JSON.stringify({
    to: m.to, from, subject: m.subject, text: m.text, html: m.html,
    links: extractLinks(m.text),
    attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, bytes: a.content.length })),
    ...(m.headers ? { headers: m.headers } : {}),
    createdAt: new Date().toISOString(),
  }, null, 2));
  return { eml, json };
}

/**
 * Mail senden. Mit `ASKMETRY_MAIL_OUTBOX` (oder ohne `SMTP_URL`) wird sie stattdessen als .eml + .json in den Outbox-Ordner geschrieben.
 * Wirft bei ungültigen Eingaben und Versandfehlern.
 */
export async function sendMail(m: MailMessage): Promise<void> {
  if (!isValidEmail(m.to)) throw new Error('mail: ungültige Empfängeradresse');
  if (m.replyTo && !isValidEmail(m.replyTo)) throw new Error('mail: ungültige Reply-To-Adresse');
  if (!m.subject?.trim() || !m.text?.trim() || !m.html?.trim()) throw new Error('mail: Betreff, Text und HTML sind Pflicht');
  for (const [k, v] of Object.entries(m.headers ?? {})) if (/[\r\n]/.test(k + v)) throw new Error('mail: ungültige Kopfzeile');
  const cfg = hostedConfig().mail;
  // In Produktion nie stillschweigend in die Standard-Outbox schreiben: ohne SMTP_URL nur, wenn die Outbox ausdrücklich gesetzt ist
  if (process.env.NODE_ENV === 'production' && !cfg.smtpUrl && !process.env.ASKMETRY_MAIL_OUTBOX) throw new Error('mail: SMTP_URL fehlt (Produktion)');
  if (cfg.outbox) {
    const { eml } = await writeToOutbox(m, cfg.outbox, cfg.from);
    log(`in Outbox abgelegt für ${maskEmail(m.to)}: ${path.basename(eml)}`);
    return;
  }
  if (!cfg.smtpUrl) throw new Error('mail: weder SMTP_URL noch Outbox konfiguriert');
  try {
    await smtpTransport(cfg.smtpUrl).sendMail(toMailOptions(m, cfg.from));
  } catch (e) {
    // Fehlermeldungen von SMTP-Servern können die Adresse enthalten → nicht durchreichen, nur Code/Antwortcode
    const err = e as { code?: string; responseCode?: number };
    throw new Error(`mail: Versand an ${maskEmail(m.to)} fehlgeschlagen${err.code ? ` (${err.code}${err.responseCode ? ` ${err.responseCode}` : ''})` : ''}`);
  }
  log(`gesendet an ${maskEmail(m.to)}`);
}
