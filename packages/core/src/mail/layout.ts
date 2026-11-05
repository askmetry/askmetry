// Gemeinsames Layout der transaktionalen Mails: schlichtes, tabellenbasiertes HTML mit Inline-Styles
// (Gmail, Outlook, Apple Mail), Dunkelmodus über color-scheme + Media-Query, ein Button, Fallback-Link als Text.
// Alle Nutzereingaben (Markenname, Domain, URLs) werden hier escaped – Vorlagen geben nur Rohtext hinein.
import type { Lang } from '../i18n.ts';
import { isHosted, OPERATOR_LINE } from '../hosted/config.ts';

export const SENDER_LINE = `Askmetry · ${OPERATOR_LINE}`;
/** Absenderzeile: Betreiberadresse nur in der gehosteten Version */
const senderLine = () => (isHosted() ? SENDER_LINE : 'Askmetry');

/** HTML-Sonderzeichen ersetzen (Text und Attributwerte). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Nutzereingabe für Betreff/Text: eine Zeile, Steuerzeichen raus, Länge gekappt. */
export function oneLine(s: string | null | undefined, max = 120): string {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Nur absolute http(s)-Links sind erlaubt (Programmierfehler sonst – lieber laut scheitern als einen kaputten Link verschicken). */
export function safeLink(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('mail: ungültiger Link'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('mail: nur http(s)-Links erlaubt');
  return u.toString();
}

export interface Block {
  /** Absatz (Rohtext, wird escaped) */
  text: string;
  muted?: boolean;
}

export interface LayoutInput {
  lang: Lang;
  /** unsichtbare Vorschauzeile im Posteingang */
  preheader: string;
  heading: string;
  intro: Block[];
  button: { label: string; url: string };
  outro?: Block[];
  /** zusätzlicher Hinweis im Fuß (z. B. Abmeldung), Text mit optionalem Link */
  footerNote?: { text: string; link?: { label: string; url: string } };
  impressumUrl: string;
}

const C = {
  bg: '#f4f5f7', card: '#ffffff', text: '#1d1d1f', muted: '#5f6368', line: '#e3e5e8', accent: '#1f5fd1', accentText: '#ffffff',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Mail rendern: HTML und reiner Text aus denselben Bausteinen. */
export function renderLayout(i: LayoutInput): { html: string; text: string } {
  const btnUrl = safeLink(i.button.url);
  const imp = safeLink(i.impressumUrl);
  const impLabel = i.lang === 'en' ? 'Legal notice' : 'Impressum';
  const fallback = i.lang === 'en' ? 'If the button doesn’t work, copy this link into your browser:' : 'Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:';
  const p = (b: Block) =>
    `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:${b.muted ? 14 : 16}px;line-height:1.55;color:${b.muted ? C.muted : C.text};" class="${b.muted ? 'm-muted' : 'm-text'}">${escapeHtml(b.text)}</p>`;
  const note = i.footerNote
    ? `<p style="margin:0 0 10px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};" class="m-muted">${escapeHtml(i.footerNote.text)}${
      i.footerNote.link ? ` <a href="${escapeHtml(safeLink(i.footerNote.link.url))}" style="color:${C.muted};text-decoration:underline;" class="m-muted">${escapeHtml(i.footerNote.link.label)}</a>` : ''}</p>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="${i.lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(i.heading)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .m-bg { background-color:#111214 !important; }
    .m-card { background-color:#1c1d20 !important; border-color:#2c2e33 !important; }
    .m-text, .m-h { color:#f1f2f4 !important; }
    .m-muted { color:#a8adb4 !important; }
    .m-link { color:#8ab4ff !important; }
  }
  [data-ogsc] .m-text, [data-ogsc] .m-h { color:#f1f2f4 !important; }
  [data-ogsc] .m-muted { color:#a8adb4 !important; }
  @media (max-width:600px) { .m-pad { padding:24px 20px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.bg};" class="m-bg">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(i.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};" class="m-bg">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px 4px;font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:0.2px;color:${C.text};" class="m-text">Askmetry</td></tr>
<tr><td class="m-card m-pad" style="background-color:${C.card};border:1px solid ${C.line};border-radius:12px;padding:32px 36px;">
<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:600;color:${C.text};" class="m-h">${escapeHtml(i.heading)}</h1>
${i.intro.map(p).join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr>
<td align="center" bgcolor="${C.accent}" style="border-radius:8px;background-color:${C.accent};">
<a href="${escapeHtml(btnUrl)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1.2;color:${C.accentText};text-decoration:none;border-radius:8px;">${escapeHtml(i.button.label)}</a>
</td></tr></table>
${(i.outro ?? []).map(p).join('\n')}
<p style="margin:8px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};" class="m-muted">${escapeHtml(fallback)}<br><a href="${escapeHtml(btnUrl)}" style="color:${C.accent};word-break:break-all;" class="m-link">${escapeHtml(btnUrl)}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0 4px;">
${note}
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};" class="m-muted">${escapeHtml(senderLine())} · <a href="${escapeHtml(imp)}" style="color:${C.muted};text-decoration:underline;" class="m-muted">${impLabel}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const lines: string[] = [i.heading, ''];
  for (const b of i.intro) lines.push(b.text, '');
  lines.push(`${i.button.label}:`, btnUrl, '');
  for (const b of i.outro ?? []) lines.push(b.text, '');
  lines.push('-- ');
  if (i.footerNote) lines.push(i.footerNote.link ? `${i.footerNote.text} ${i.footerNote.link.label}: ${safeLink(i.footerNote.link.url)}` : i.footerNote.text, '');
  lines.push(senderLine(), `${impLabel}: ${imp}`);
  return { html, text: lines.join('\n') };
}
