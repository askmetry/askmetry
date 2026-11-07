// Mail-Vorlagen (DE/EN): freundlich, sachlich, kurz, du-Form im Deutschen. Signaturen verbindlich (HOSTED.md).
import { publicUrl } from '../hosted/config.ts';
import { INTL_LOCALE, type Lang } from '../i18n.ts';
import { oneLine, renderLayout, safeLink, type LayoutInput } from './layout.ts';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
  /** zusätzliche Kopfzeilen (z. B. List-Unsubscribe bei der Erinnerung); beim Versand einfach mitgeben: sendMail({ to, ...mail }) */
  headers?: Record<string, string>;
}

const L = (lang: unknown): Lang => (lang === 'en' ? 'en' : 'de');
const impressum = () => `${publicUrl()}/impressum`;

function build(input: Omit<LayoutInput, 'impressumUrl'>, subject: string, headers?: Record<string, string>): RenderedMail {
  const { html, text } = renderLayout({ ...input, impressumUrl: impressum() });
  return { subject: oneLine(subject, 160), html, text, ...(headers ? { headers } : {}) };
}

function dateText(d: Date, lang: Lang): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(INTL_LOCALE[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(d);
}

export const mailTemplates = {
  /** Schnell-Check: E-Mail bestätigen (Link 24 h gültig). */
  checkVerify: (i: { lang: Lang; domain: string; verifyUrl: string; consent?: boolean }): RenderedMail => {
    const lang = L(i.lang);
    const domain = oneLine(i.domain, 100);
    if (lang === 'en') {
      return build({
        lang, preheader: `One click and we’ll email you the result for ${domain}.`,
        heading: 'Confirm your email address',
        intro: [
          { text: `You started a free quick check for ${domain} on Askmetry. You asked us to email you when it’s ready. Please confirm your email address – then we’ll send you the result as soon as it’s done.` },
          ...(i.consent ? [{ text: 'You also agreed that we may remind you of your results and send you tips. Confirming covers that too – you can unsubscribe from any of these emails.' }] : []),
        ],
        button: { label: 'Confirm email', url: i.verifyUrl },
        outro: [{ text: 'The link is valid for 24 hours. If you didn’t start this check, just ignore this email.', muted: true }],
      }, `Confirm your quick check for ${domain}`);
    }
    return build({
      lang, preheader: `Ein Klick, dann schicken wir dir das Ergebnis für ${domain}.`,
      heading: 'Bestätige deine E-Mail-Adresse',
      intro: [
        { text: `Du hast für ${domain} einen kostenlosen Schnell-Check bei Askmetry gestartet. Du möchtest per Mail Bescheid bekommen, wenn er fertig ist. Bestätige bitte kurz deine E-Mail-Adresse – dann schicken wir dir das Ergebnis, sobald es da ist.` },
        ...(i.consent ? [{ text: 'Außerdem hast du zugestimmt, dass wir dich an deine Ergebnisse erinnern und dir Tipps schicken. Mit der Bestätigung gilt auch das – abbestellen kannst du in jeder dieser Mails.' }] : []),
      ],
      button: { label: 'E-Mail bestätigen', url: i.verifyUrl },
      outro: [{ text: 'Der Link ist 24 Stunden gültig. Wenn du den Check nicht gestartet hast, ignoriere diese Mail einfach.', muted: true }],
    }, `Bestätige deinen Schnell-Check für ${domain}`);
  },

  /** Schnell-Check fertig. */
  checkReady: (i: { lang: Lang; domain: string; checkUrl: string; recommendationsTotal: number }): RenderedMail => {
    const lang = L(i.lang);
    const domain = oneLine(i.domain, 100);
    const n = Number.isFinite(i.recommendationsTotal) ? Math.max(0, Math.round(i.recommendationsTotal)) : 0;
    if (lang === 'en') {
      const recs = n === 0 ? 'You’ll also see which sources the AI engines rely on.'
        : n === 1 ? 'We also found 1 action that can make you more visible.'
          : `We also found ${n} actions that can make you more visible.`;
      return build({
        lang, preheader: `How ChatGPT, Gemini and Google answer about ${domain}.`,
        heading: 'Your quick check is ready',
        intro: [
          { text: `We measured how AI search engines like ChatGPT, Gemini and Google answer questions your customers ask – and whether they mention ${domain}.` },
          { text: recs },
        ],
        button: { label: 'View result', url: i.checkUrl },
        outro: [{ text: 'The quick check is a small sample. AI answers vary, so treat the numbers as a first indication.', muted: true }],
      }, `Your quick check for ${domain} is ready`);
    }
    const recs = n === 0 ? 'Außerdem siehst du, auf welche Quellen sich die KIs stützen.'
      : n === 1 ? 'Dazu haben wir 1 Maßnahme gefunden, mit der du sichtbarer wirst.'
        : `Dazu haben wir ${n} Maßnahmen gefunden, mit denen du sichtbarer wirst.`;
    return build({
      lang, preheader: `So antworten ChatGPT, Gemini und Google über ${domain}.`,
      heading: 'Dein Schnell-Check ist fertig',
      intro: [
        { text: `Wir haben gemessen, wie KI-Suchen wie ChatGPT, Gemini und Google auf Fragen deiner Kunden antworten – und ob sie ${domain} nennen.` },
        { text: recs },
      ],
      button: { label: 'Ergebnis ansehen', url: i.checkUrl },
      outro: [{ text: 'Der Schnell-Check ist eine kleine Stichprobe. KI-Antworten schwanken, sieh die Zahlen als ersten Anhaltspunkt.', muted: true }],
    }, `Dein Schnell-Check für ${domain} ist fertig`);
  },

  /** Bericht fertig (PDF hängt an). */
  reportReady: (i: { lang: Lang; brandName: string; tierLabel: string; reportUrl: string; remeasure: boolean }): RenderedMail => {
    const lang = L(i.lang);
    const brand = oneLine(i.brandName, 80);
    const tier = oneLine(i.tierLabel, 60);
    if (lang === 'en') {
      return build({
        lang, preheader: `${tier} for ${brand} – PDF attached.`,
        heading: i.remeasure ? `Your follow-up measurement for ${brand} is ready` : `Your ${tier.toLowerCase()} for ${brand} is ready`,
        intro: [
          { text: i.remeasure
            ? `We asked the same questions again. The report shows what has changed since the last measurement – and which actions to take next.`
            : `The report shows how often AI search engines mention ${brand}, who is ahead of you, which sources they rely on – and what to do next.` },
          { text: 'The PDF is attached to this email, ready to forward or print. Online you’ll find every action with steps and a ready-made prompt for your AI assistant.' },
        ],
        button: { label: 'Open report', url: i.reportUrl },
      }, i.remeasure ? `Follow-up measurement for ${brand} is ready` : `${tier} for ${brand} is ready`);
    }
    return build({
      lang, preheader: `${tier} für ${brand} – das PDF hängt an.`,
      heading: i.remeasure ? `Deine Nachmessung für ${brand} ist fertig` : `${tier} für ${brand} ist fertig`,
      intro: [
        { text: i.remeasure
          ? 'Wir haben dieselben Fragen noch einmal gestellt. Im Bericht siehst du, was sich seit der letzten Messung verändert hat – und was als Nächstes dran ist.'
          : `Im Bericht siehst du, wie oft KI-Suchen ${brand} nennen, wer vor dir liegt, auf welche Quellen sie sich stützen – und was du als Nächstes tun kannst.` },
        { text: 'Das PDF hängt an dieser Mail – zum Weiterleiten und Ausdrucken. Online findest du alle Maßnahmen mit Schritten und einem fertigen Prompt für deine KI.' },
      ],
      button: { label: 'Bericht öffnen', url: i.reportUrl },
    }, i.remeasure ? `Nachmessung für ${brand} ist fertig` : `${tier} für ${brand} ist fertig`);
  },

  /** Einmalige Erinnerung an die Nachmessung (Werbung an Bestandskunden, § 7 Abs. 3 UWG – mit Widerspruchshinweis). */
  remeasureReminder: (i: { lang: Lang; brandName: string; buyUrl: string; optOutUrl: string; readyAt: Date }): RenderedMail => {
    const lang = L(i.lang);
    const brand = oneLine(i.brandName, 80);
    const when = dateText(i.readyAt, lang);
    const headers = { 'List-Unsubscribe': `<${safeLink(i.optOutUrl)}>` };
    if (lang === 'en') {
      return build({
        lang, preheader: `Has ${brand} become more visible in AI search?`,
        heading: 'Time for a follow-up measurement?',
        intro: [
          { text: `${when ? `Your report for ${brand} was ready on ${when}. ` : ''}If you’ve put actions into practice since then, a follow-up measurement shows whether AI search engines now mention ${brand} more often – with the same questions, directly comparable.` },
        ],
        button: { label: 'See follow-up measurement', url: i.buyUrl },
        footerNote: {
          text: 'We send this reminder once because you bought a report from us. You can object to such emails at any time without any costs other than the transmission costs at basic rates:',
          link: { label: 'Unsubscribe', url: i.optOutUrl },
        },
      }, `Time for a follow-up measurement of ${brand}?`, headers);
    }
    return build({
      lang, preheader: `Ist ${brand} in KI-Suchen sichtbarer geworden?`,
      heading: 'Zeit für die Nachmessung?',
      intro: [
        { text: `${when ? `Dein Bericht für ${brand} war am ${when} fertig. ` : ''}Wenn du seitdem Maßnahmen umgesetzt hast, zeigt eine Nachmessung, ob KI-Suchen ${brand} jetzt öfter nennen – mit denselben Fragen, direkt vergleichbar.` },
      ],
      button: { label: 'Nachmessung ansehen', url: i.buyUrl },
      footerNote: {
        text: 'Diese Erinnerung bekommst du einmalig, weil du bei uns einen Bericht gekauft hast. Du kannst solchen Mails jederzeit widersprechen, ohne dass andere als die Übermittlungskosten nach den Basistarifen entstehen:',
        link: { label: 'Abmelden', url: i.optOutUrl },
      },
    }, `Zeit für die Nachmessung von ${brand}?`, headers);
  },

  /**
   * Einmalige Erinnerung 24 h nach dem Schnell-Check – nur mit ausdrücklicher Einwilligung (§ 7 Abs. 2 UWG), mit
   * Abmeldelink und List-Unsubscribe. Inhalt: der stärkste konkrete Befund („Auf … nennt ChatGPT A und B – dich nicht.“).
   */
  checkReminder: (i: {
    lang: Lang; domain: string; brandName: string; checkUrl: string; optOutUrl: string; simulated?: boolean;
    finding: { question: string; engine: string; competitors: string[] } | null;
    mentioned: { n: number; of: number } | null;
  }): RenderedMail => {
    const lang = L(i.lang);
    const domain = oneLine(i.domain, 100);
    const brand = oneLine(i.brandName, 80) || domain;
    const headers = { 'List-Unsubscribe': `<${safeLink(i.optOutUrl)}>` };
    const f = i.finding;
    const q = f ? oneLine(f.question, 160) : '';
    const engine = f ? oneLine(f.engine, 40) : '';
    const comps = f ? f.competitors.map((c) => oneLine(c, 60)).filter(Boolean).slice(0, 3) : [];
    const n = i.mentioned && Number.isFinite(i.mentioned.n) && Number.isFinite(i.mentioned.of) && i.mentioned.of > 0 ? { n: Math.max(0, Math.round(i.mentioned.n)), of: Math.round(i.mentioned.of) } : null;
    const list = (xs: string[], and: string) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`);
    if (lang === 'en') {
      const finding = f && comps.length
        ? `Asked “${q}”, ${engine} names ${list(comps, 'and')} – but not ${brand}.`
        : n ? `${brand} was named in ${n.n} of ${n.of} AI answers in your quick check.` : `Your quick check for ${domain} shows how AI search engines answer your customers’ questions.`;
      return build({
        lang, preheader: f && comps.length ? `${engine} names ${list(comps, 'and')} – not you.` : `Your quick check result for ${domain}.`,
        heading: `Your quick check for ${domain}`,
        intro: [
          { text: finding },
          ...(i.simulated ? [{ text: 'Note: this check ran in test mode with simulated answers.', muted: true }] : []),
          { text: 'In the result you’ll see the questions we asked, which providers the AI engines name instead, and the first action you can take.' },
        ],
        button: { label: 'Open result', url: i.checkUrl },
        footerNote: {
          text: 'You get this email once because you asked us to remind you of your results. You can unsubscribe at any time:',
          link: { label: 'Unsubscribe', url: i.optOutUrl },
        },
      }, f && comps.length ? `${engine} names ${comps[0]} – not ${brand}` : `Your quick check for ${domain}`, headers);
    }
    const finding = f && comps.length
      ? `Auf „${q}“ nennt ${engine} ${list(comps, 'und')} – ${brand} nicht.`
      : n ? `${brand} wurde in deinem Schnell-Check in ${n.n} von ${n.of} KI-Antworten genannt.` : `Dein Schnell-Check für ${domain} zeigt, wie KI-Suchen auf Fragen deiner Kunden antworten.`;
    return build({
      lang, preheader: f && comps.length ? `${engine} nennt ${list(comps, 'und')} – dich nicht.` : `Dein Ergebnis für ${domain}.`,
      heading: `Dein Schnell-Check für ${domain}`,
      intro: [
        { text: finding },
        ...(i.simulated ? [{ text: 'Hinweis: Dieser Check lief im Testmodus mit simulierten Antworten.', muted: true }] : []),
        { text: 'Im Ergebnis siehst du die gestellten Fragen, welche Anbieter die KIs stattdessen nennen, und die erste Maßnahme, mit der du anfangen kannst.' },
      ],
      button: { label: 'Ergebnis öffnen', url: i.checkUrl },
      footerNote: {
        text: 'Diese Mail bekommst du einmalig, weil du dir eine Erinnerung an deine Ergebnisse gewünscht hast. Du kannst dich jederzeit abmelden:',
        link: { label: 'Abmelden', url: i.optOutUrl },
      },
    }, f && comps.length ? `${engine} nennt ${comps[0]} – ${brand} nicht` : `Dein Schnell-Check für ${domain}`, headers);
  },

  /** Konto: E-Mail-Adresse bestätigen. */
  authVerify: (i: { lang: Lang; url: string }): RenderedMail => {
    const lang = L(i.lang);
    if (lang === 'en') {
      return build({
        lang, preheader: 'One click to activate your Askmetry account.',
        heading: 'Confirm your email address',
        intro: [{ text: 'Thanks for signing up for Askmetry. Please confirm your email address to activate your account.' }],
        button: { label: 'Confirm email', url: i.url },
        outro: [{ text: 'For security reasons the link is only valid for a limited time. If you didn’t sign up, just ignore this email.', muted: true }],
      }, 'Confirm your email address for Askmetry');
    }
    return build({
      lang, preheader: 'Ein Klick, dann ist dein Askmetry-Konto aktiv.',
      heading: 'Bestätige deine E-Mail-Adresse',
      intro: [{ text: 'Danke für deine Anmeldung bei Askmetry. Bestätige bitte deine E-Mail-Adresse, damit dein Konto aktiv wird.' }],
      button: { label: 'E-Mail bestätigen', url: i.url },
      outro: [{ text: 'Der Link ist aus Sicherheitsgründen nur begrenzt gültig. Wenn du dich nicht angemeldet hast, ignoriere diese Mail einfach.', muted: true }],
    }, 'Bestätige deine E-Mail-Adresse für Askmetry');
  },

  /** Konto: Passwort zurücksetzen. */
  authReset: (i: { lang: Lang; url: string }): RenderedMail => {
    const lang = L(i.lang);
    if (lang === 'en') {
      return build({
        lang, preheader: 'Choose a new password for Askmetry.',
        heading: 'Reset your password',
        intro: [{ text: 'Someone (hopefully you) asked to reset the password for your Askmetry account. Click the button to choose a new one.' }],
        button: { label: 'Choose new password', url: i.url },
        outro: [{ text: 'For security reasons the link is only valid for a limited time. If you didn’t request this, ignore this email – your password stays the same.', muted: true }],
      }, 'Reset your Askmetry password');
    }
    return build({
      lang, preheader: 'Wähle ein neues Passwort für Askmetry.',
      heading: 'Passwort zurücksetzen',
      intro: [{ text: 'Für dein Askmetry-Konto wurde ein neues Passwort angefordert. Über den Button wählst du ein neues.' }],
      button: { label: 'Neues Passwort wählen', url: i.url },
      outro: [{ text: 'Der Link ist aus Sicherheitsgründen nur begrenzt gültig. Wenn du das nicht warst, ignoriere diese Mail – dein Passwort bleibt unverändert.', muted: true }],
    }, 'Askmetry-Passwort zurücksetzen');
  },
};
