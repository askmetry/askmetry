// Betriebs-Meldungen per Telegram (Kauf, Fehler, Budget). Still ohne Konfiguration, wirft nie, loggt den Token nie.
// Keine personenbezogenen Daten: nur Ereignis, Berichtsart, Betrag, höchstens die Domain der Marke. E-Mail-Adressen werden
// zur Sicherheit vollständig entfernt (auch maskierte).
import { hostedConfig } from './config.ts';
import { stripEmails } from './util.ts';

/** gleiche Meldung höchstens einmal je Zeitraum */
export const NOTIFY_DEDUPE_MS = 10 * 60 * 1000;
const recent = new Map<string, number>();

/** Nur für Tests: Merker für doppelte Meldungen leeren. */
export const resetNotifyDedupe = () => recent.clear();

export async function notifyOps(text: string): Promise<void> {
  try {
    const { botToken, chatId } = hostedConfig().telegram;
    if (!botToken || !chatId) return;
    const msg = stripEmails(String(text)).slice(0, 3500);
    const now = Date.now();
    for (const [k, t] of recent) if (now - t > NOTIFY_DEDUPE_MS) recent.delete(k);
    if (recent.has(msg)) return;
    recent.set(msg, now);
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `Askmetry: ${msg}`, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[hosted] Telegram-Meldung abgelehnt (HTTP ${res.status})`);
  } catch {
    // Fehlertext bewusst nicht ausgeben (könnte die URL mit Token enthalten)
    console.error('[hosted] Telegram-Meldung fehlgeschlagen');
  }
}
