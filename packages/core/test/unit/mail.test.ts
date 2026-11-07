import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractLinks, mailTemplates, maskEmail, sendMail, type RenderedMail } from '../../src/mail/index.ts';

const LANGS = ['de', 'en'] as const;
const EVIL = 'Mül<script>alert(1)</script> & "Co" GmbH';

function all(lang: 'de' | 'en', brandName = 'Paylindo', domain = 'paylindo.de'): Record<string, RenderedMail> {
  return {
    checkVerify: mailTemplates.checkVerify({ lang, domain, verifyUrl: 'https://askmetry.ai/check/tok/bestaetigen?code=abc&x=1' }),
    checkReady0: mailTemplates.checkReady({ lang, domain, checkUrl: 'https://askmetry.ai/check/tok', recommendationsTotal: 0 }),
    checkReady1: mailTemplates.checkReady({ lang, domain, checkUrl: 'https://askmetry.ai/check/tok', recommendationsTotal: 1 }),
    checkReadyN: mailTemplates.checkReady({ lang, domain, checkUrl: 'https://askmetry.ai/check/tok', recommendationsTotal: 12 }),
    checkReadyNaN: mailTemplates.checkReady({ lang, domain, checkUrl: 'https://askmetry.ai/check/tok', recommendationsTotal: Number.NaN }),
    reportReady: mailTemplates.reportReady({ lang, brandName, tierLabel: lang === 'de' ? 'Standortbestimmung' : 'Baseline report', reportUrl: 'https://askmetry.ai/w/x/bericht/1', remeasure: false }),
    reportRemeasure: mailTemplates.reportReady({ lang, brandName, tierLabel: 'Nachmessung', reportUrl: 'https://askmetry.ai/w/x/bericht/2', remeasure: true }),
    reminder: mailTemplates.remeasureReminder({ lang, brandName, buyUrl: 'https://askmetry.ai/w/x/nachmessung', optOutUrl: 'https://askmetry.ai/abmelden?t=abc', readyAt: new Date('2026-09-10T10:00:00Z') }),
    reminderBadDate: mailTemplates.remeasureReminder({ lang, brandName, buyUrl: 'https://askmetry.ai/w/x/nachmessung', optOutUrl: 'https://askmetry.ai/abmelden?t=abc', readyAt: new Date('nope') }),
    checkReminder: mailTemplates.checkReminder({ lang, domain, brandName, checkUrl: 'https://askmetry.ai/check/tok', optOutUrl: 'https://askmetry.ai/abmelden?t=abc', finding: { question: 'Welches EC-Terminal für Cafés?', engine: 'ChatGPT', competitors: ['SumUp', 'Zettle', `${brandName} Rival`] }, mentioned: { n: 3, of: 28 } }),
    checkReminderNoFinding: mailTemplates.checkReminder({ lang, domain, brandName, checkUrl: 'https://askmetry.ai/check/tok', optOutUrl: 'https://askmetry.ai/abmelden?t=abc', finding: null, mentioned: { n: Number.NaN, of: 0 }, simulated: true }),
    authVerify: mailTemplates.authVerify({ lang, url: 'https://askmetry.ai/api/auth/verify?token=t' }),
    authReset: mailTemplates.authReset({ lang, url: 'https://askmetry.ai/reset?token=t' }),
  };
}

describe('mailTemplates', () => {
  beforeEach(() => { process.env.ASKMETRY_HOSTED = '1'; });
  afterEach(() => { delete process.env.ASKMETRY_HOSTED; });
  it('Selbsthosting: keine Betreiberadresse in der Fußzeile', () => {
    delete process.env.ASKMETRY_HOSTED;
    const m = mailTemplates.authVerify({ lang: 'de', url: 'https://example.org/v' });
    expect(m.text).not.toContain('lindotech');
    expect(m.html).not.toContain('lindotech');
  });
  for (const lang of LANGS) {
    it(`rendert alle Vorlagen (${lang}) ohne undefined/NaN, mit Fußzeile, Impressum und Fallback-Link`, () => {
      for (const [name, m] of Object.entries(all(lang))) {
        for (const part of [m.subject, m.html, m.text]) {
          expect(part, name).toBeTruthy();
          expect(part, name).not.toMatch(/undefined|NaN|\[object Object\]|null/);
        }
        expect(m.html, name).toContain('lindotech GmbH · Eppendorfer Weg 151 · 20253 Hamburg');
        expect(m.text, name).toContain('Askmetry · lindotech GmbH · Eppendorfer Weg 151 · 20253 Hamburg');
        expect(m.text, name).toContain('/impressum');
        expect(m.html, name).toContain('color-scheme');
        expect(m.html, name).toContain(`lang="${lang}"`);
        // genau ein Button (bgcolor-Zelle)
        expect(m.html.match(/bgcolor=/g)?.length, name).toBe(1);
        expect(m.subject, name).not.toMatch(/[\r\n]/);
      }
    });
    it(`Erinnerung (${lang}): Abmeldelink, Widerspruchshinweis, List-Unsubscribe`, () => {
      const m = all(lang).reminder;
      expect(m.text).toContain('https://askmetry.ai/abmelden?t=abc');
      expect(m.html).toContain('https://askmetry.ai/abmelden?t=abc');
      expect(m.text).toMatch(lang === 'de' ? /jederzeit widersprechen/ : /object to such emails at any time/);
      expect(m.headers?.['List-Unsubscribe']).toBe('<https://askmetry.ai/abmelden?t=abc>');
      expect(m.text).toMatch(lang === 'de' ? /10\. September 2026/ : /September 10, 2026/);
    });
    it(`Check-Erinnerung (${lang}): konkreter Befund, Abmeldelink, List-Unsubscribe, Testmodus gekennzeichnet`, () => {
      const m = all(lang).checkReminder;
      expect(m.text).toContain(lang === 'de' ? 'Auf „Welches EC-Terminal für Cafés?“ nennt ChatGPT SumUp, Zettle und Paylindo Rival – Paylindo nicht.' : 'Asked “Welches EC-Terminal für Cafés?”, ChatGPT names SumUp, Zettle and Paylindo Rival – but not Paylindo.');
      expect(m.text).toContain('https://askmetry.ai/check/tok');
      expect(m.text).toContain('https://askmetry.ai/abmelden?t=abc');
      expect(m.headers?.['List-Unsubscribe']).toBe('<https://askmetry.ai/abmelden?t=abc>');
      const n = all(lang).checkReminderNoFinding;
      expect(n.text).toMatch(lang === 'de' ? /simulierten Antworten/ : /simulated answers/);
      expect(n.text).not.toMatch(/nennt|names/);
    });
    it(`Bericht fertig (${lang}) erwähnt den PDF-Anhang`, () => {
      expect(all(lang).reportReady.text).toMatch(/PDF/);
    });
  }

  it('escaped Nutzereingaben im HTML (Markenname, Domain)', () => {
    for (const lang of LANGS) {
      for (const [name, m] of Object.entries(all(lang, EVIL, `${EVIL}.de`))) {
        expect(m.html, name).not.toContain('<script>');
        if (/report|reminder|check/i.test(name)) expect(m.html, name).toContain('&lt;script&gt;');
      }
    }
    // & in URLs wird im Attribut escaped
    expect(all('de').checkVerify.html).toContain('code=abc&amp;x=1');
    expect(all('de').checkVerify.text).toContain('code=abc&x=1');
    // Double-Opt-in: die Bestätigungsmail nennt die Einwilligung nur, wenn sie gegeben wurde
    expect(all('de').checkVerify.text).not.toContain('Tipps');
    const withConsent = mailTemplates.checkVerify({ lang: 'de', domain: 'paylindo.de', verifyUrl: 'https://askmetry.ai/x', consent: true });
    expect(withConsent.text).toContain('erinnern und dir Tipps schicken');
    expect(mailTemplates.checkVerify({ lang: 'en', domain: 'paylindo.de', verifyUrl: 'https://askmetry.ai/x', consent: true }).text).toContain('send you tips');
  });

  it('lehnt Links ohne http(s) ab', () => {
    expect(() => mailTemplates.authReset({ lang: 'de', url: 'javascript:alert(1)' })).toThrow();
  });
});

describe('Hilfen', () => {
  it('maskEmail', () => {
    expect(maskEmail('max@firma.de')).toBe('m***@firma.de');
    expect(maskEmail('kaputt')).toBe('***');
  });
  it('extractLinks: Reihenfolge, ohne Dubletten und Satzzeichen', () => {
    expect(extractLinks('Hier: https://a.de/x?y=1. Und (https://b.de/) sowie https://a.de/x?y=1')).toEqual(['https://a.de/x?y=1', 'https://b.de/']);
  });
});

describe('sendMail in die Outbox', () => {
  let dir: string;
  const saved = { ...process.env };
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'askmetry-mail-'));
    process.env.ASKMETRY_MAIL_OUTBOX = dir;
    process.env.SMTP_URL = 'smtp://nicht-benutzt.invalid:25';
    process.env.MAIL_FROM = 'Askmetry <hallo@askmetry.ai>';
    process.env.ASKMETRY_PUBLIC_URL = 'https://askmetry.ai';
  });
  afterEach(async () => {
    process.env = { ...saved };
    await rm(dir, { recursive: true, force: true });
  });

  it('schreibt .eml und .json mit Links und Anhängen (Outbox hat Vorrang vor SMTP)', async () => {
    const m = mailTemplates.checkVerify({ lang: 'de', domain: 'paylindo.de', verifyUrl: 'https://askmetry.ai/check/tok/bestaetigen?code=abc' });
    const pdf = Buffer.from('%PDF-1.7 test');
    await sendMail({ to: 'kunde@firma.de', ...m, attachments: [{ filename: 'bericht.pdf', content: pdf, contentType: 'application/pdf' }] });
    const files = (await readdir(dir)).sort();
    expect(files.filter((f) => f.endsWith('.eml'))).toHaveLength(1);
    const jsonFile = files.find((f) => f.endsWith('.json'))!;
    expect(jsonFile).toMatch(/^\d{4}-\d{2}-\d{2}T.*-bestatige-deinen-schnell-check-fur-paylindo-de-[0-9a-f]{6}\.json$/);
    const j = JSON.parse(await readFile(path.join(dir, jsonFile), 'utf8'));
    expect(j.to).toBe('kunde@firma.de');
    expect(j.subject).toBe(m.subject);
    expect(j.links).toContain('https://askmetry.ai/check/tok/bestaetigen?code=abc');
    expect(j.links).toContain('https://askmetry.ai/impressum');
    expect(j.attachments).toEqual([{ filename: 'bericht.pdf', bytes: pdf.length }]);
    const eml = await readFile(path.join(dir, files.find((f) => f.endsWith('.eml'))!), 'utf8');
    expect(eml).toMatch(/^From: Askmetry <hallo@askmetry\.ai>$/m);
    expect(eml).toMatch(/filename=bericht\.pdf/);
  });

  it('überträgt List-Unsubscribe aus der Vorlage', async () => {
    const m = mailTemplates.remeasureReminder({ lang: 'en', brandName: 'Paylindo', buyUrl: 'https://askmetry.ai/b', optOutUrl: 'https://askmetry.ai/o?t=1', readyAt: new Date() });
    await sendMail({ to: 'kunde@firma.de', ...m });
    const eml = await readFile(path.join(dir, (await readdir(dir)).find((f) => f.endsWith('.eml'))!), 'utf8');
    expect(eml).toMatch(/^List-Unsubscribe: <https:\/\/askmetry\.ai\/o\?t=1>$/m);
  });

  it('wirft bei ungültigen Adressen und Header-Injection', async () => {
    const m = mailTemplates.authVerify({ lang: 'de', url: 'https://askmetry.ai/v' });
    await expect(sendMail({ to: 'a@b.de\nBcc: x@y.de', ...m })).rejects.toThrow(/Empfänger/);
    await expect(sendMail({ to: 'a@b.de, c@d.de', ...m })).rejects.toThrow(/Empfänger/);
    await expect(sendMail({ to: 'a@b.de', ...m, headers: { 'X-A': 'b\r\nBcc: x@y.de' } })).rejects.toThrow(/Kopfzeile/);
    expect(await readdir(dir)).toHaveLength(0);
  });

  it('schreibt in Produktion ohne SMTP_URL nicht stillschweigend in die Standard-Outbox', async () => {
    delete process.env.ASKMETRY_MAIL_OUTBOX;
    delete process.env.SMTP_URL;
    process.env.NODE_ENV = 'production';
    const m = mailTemplates.authVerify({ lang: 'de', url: 'https://askmetry.ai/v' });
    await expect(sendMail({ to: 'kunde@firma.de', ...m })).rejects.toThrow(/SMTP_URL fehlt/);
  });

  it('wirft, wenn SMTP scheitert (ohne Outbox)', async () => {
    delete process.env.ASKMETRY_MAIL_OUTBOX;
    process.env.SMTP_URL = 'smtp://127.0.0.1:1';
    const m = mailTemplates.authVerify({ lang: 'de', url: 'https://askmetry.ai/v' });
    await expect(sendMail({ to: 'kunde@firma.de', ...m })).rejects.toThrow(/k\*\*\*@firma\.de/);
  });
});
