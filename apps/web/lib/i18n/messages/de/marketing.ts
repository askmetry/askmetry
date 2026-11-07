// Öffentliche Startseite der gehosteten Version (askmetry.ai). Ehrlich: keine Garantie auf Nennungen, Anker nur „typischerweise“.
// Preise kommen als fertig formatierte Strings (aus hostedConfig), damit sie an einer Stelle konfiguriert bleiben.
import { CHECK_SCOPE } from '@askmetry/core/hosted/config';

// Umfang des Gratis-Checks aus CHECK_SCOPE (eine Quelle der Wahrheit für Zahlen in Texten)
const CHECK_Q = CHECK_SCOPE.measured;
const CHECK_Q_CHATGPT = Math.min(CHECK_SCOPE.measured, CHECK_SCOPE.engineMaxPrompts.chatgpt ?? CHECK_SCOPE.measured);

const marketing = {
  meta: {
    title: 'Askmetry – Konkrete Maßnahmen für mehr Sichtbarkeit in ChatGPT, Gemini und Google AI',
    description:
      'Askmetry prüft, ob ChatGPT, Gemini und Google AI deine Firma nennen, wer statt dir empfohlen wird – und leitet konkrete Maßnahmen ab, sortiert nach Wirkung. Gratis-Schnell-Check per URL, Bericht einmalig statt Abo.',
    ogTitle: 'Was du tun kannst, damit ChatGPT und Google AI dich öfter nennen',
  },
  nav: {
    label: 'Hauptnavigation',
    how: "So funktioniert's",
    pricing: 'Preise',
    faq: 'FAQ',
    signIn: 'Anmelden',
    myReports: 'Zu meinen Berichten',
    skip: 'Zum Inhalt springen',
    home: 'Askmetry – Startseite',
  },
  hero: {
    eyebrow: 'KI-Sichtbarkeit · Konkrete Maßnahmen · Kein Abo',
    title: 'Was du tun kannst, damit ChatGPT und Google AI dich öfter nennen.',
    sub: 'Askmetry prüft, ob KI-Suchen wie ChatGPT, Gemini und Google AI deine Firma nennen und wen sie stattdessen empfehlen. Daraus bekommst du konkrete Maßnahmen, sortiert nach Wirkung: auf welchen Portalen du fehlst, welche Seiten du anlegen solltest und was technisch fehlt.',
    priceLine: (from: string) => `Bericht ab ${from} netto, einmalig. Kein Abo.`,
    points: ['Schnell-Check kostenlos', 'Ohne Konto, ohne E-Mail', 'Gehostet in Deutschland'],
  },
  form: {
    label: 'Adresse deiner Website',
    placeholder: 'deine-firma.de',
    submit: 'Gratis prüfen',
    submitting: 'Wird gestartet …',
    hint: 'Kostenlos, ohne Konto, ohne E-Mail. Ein Agent arbeitet 2–3 Minuten seine Checkliste ab – du schaust zu und siehst das Ergebnis sofort.',
    errors: {
      empty: 'Bitte gib die Adresse deiner Website ein, z. B. deine-firma.de.',
      invalid_url: 'Das sieht nicht nach einer Website-Adresse aus. Versuch es z. B. mit deine-firma.de.',
      unreachable: 'Diese Website konnten wir nicht abrufen. Stimmt die Adresse?',
      rate_limited: 'Von deinem Anschluss wurden heute schon mehrere Checks gestartet. Bitte versuch es morgen wieder.',
      disabled: 'Gerade können wir keine neuen Gratis-Checks starten. Bitte versuch es später wieder.',
      generic: 'Das hat gerade nicht geklappt. Bitte versuch es in ein paar Minuten noch einmal.',
    },
  },
  preview: {
    badge: 'Beispiel · erfundene Marke',
    brand: 'Nordwerk',
    measured: 'Standortbestimmung · 200 Antworten',
    score: 'KI-Sichtbarkeit',
    verdict: 'Selten sichtbar',
    sentence: 'In 24 von 200 Antworten genannt – Anbieter A in 124.',
    engines: 'Je KI-Suche',
    ranking: 'Wer in der KI-Suche vorne liegt',
    you: 'Du',
    competitor: (letter: string) => `Anbieter ${letter}`,
    found: '9 Maßnahmen gefunden',
    topLabel: 'Wichtigste zuerst',
    insight: 'Eintrag auf vergleichsportal-beispiel.de anlegen – die KIs zitieren das Portal in 24 % der Antworten, Nordwerk steht dort nicht.',
    engineNames: { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', google_aio: 'Google-Übersicht', google_ai_mode: 'Google KI-Modus' },
  },
  measure: {
    title: 'Nicht nur messen: Du bekommst Maßnahmen, die du umsetzen kannst',
    sub: 'Zu wissen, dass du selten genannt wirst, hilft dir allein nicht weiter. Askmetry leitet aus der Messung ab, was dir fehlt – und was du dagegen tun kannst.',
    kindsTitle: 'Typische Maßnahmen',
    kinds: [
      { cat: 'external', title: 'Auf die richtigen Portale', text: 'Branchenverzeichnisse, Vergleichsportale und Fachmedien, auf die sich die KIs stützen – und auf denen du noch fehlst.' },
      { cat: 'content', title: 'Fehlende Seiten und Inhalte', text: 'Vergleichsseiten, Antworten auf echte Kundenfragen, klare Leistungsseiten, die eine KI zitieren kann.' },
      { cat: 'community', title: 'Bewertungen und Erwähnungen', text: 'Wo Bewertungen und Empfehlungen für deine Branche zählen und wie du mehr davon bekommst.' },
      { cat: 'tech', title: 'Technik und strukturierte Daten', text: 'KI-Suchroboter zulassen, strukturierte Daten (Schema.org) ergänzen – so beschrieben, dass du es an deine Agentur geben kannst.' },
    ],
    basis: 'Grundlage ist deine Messung: welche Quellen die KIs bei deinen Kundenfragen zitieren, wer dort steht und was auf deiner Website fehlt.',
    plan: 'Im Strategiebericht kommen die wichtigsten Maßnahmen als 30-Tage-Plan: was in welcher Woche.',
    card: {
      label: 'So sieht eine Maßnahme aus',
      rank: 'Maßnahme 1 von 9',
      cat: 'external',
      title: 'Eintrag auf vergleichsportal-beispiel.de anlegen',
      impactLabel: 'Wirkung',
      impact: 'Große Wirkung',
      whyTitle: 'Warum',
      why: 'Bei Fragen wie „Welcher Anbieter für Gebäudetechnik in Hamburg ist zu empfehlen?“ zitieren ChatGPT und Google AI dieses Portal in 24 % der Antworten. Anbieter A und B haben dort ein Profil, Nordwerk nicht.',
      stepsTitle: 'So gehst du vor',
      steps: [
        'Firmenprofil auf vergleichsportal-beispiel.de anlegen oder bestehendes übernehmen',
        'Leistungen, Einsatzgebiet und Ansprechpartner so beschreiben wie auf deiner Website',
        'Drei zufriedene Kunden bitten, dort eine Bewertung zu schreiben',
      ],
      promptTitle: 'Fertiger Prompt für deine KI',
      prompt: 'Schreib mir einen Profiltext für vergleichsportal-beispiel.de für Nordwerk. Nutze die Leistungen von nordwerk-beispiel.de …',
      goal: 'Ziel: Nordwerk steht dort, wo die KIs ihre Antworten zu diesen Fragen herholen.',
    },
  },
  how: {
    title: "So funktioniert's",
    sub: 'URL eingeben, dem Agenten zuschauen, Ergebnis sofort sehen. Danach entscheidest du, ob du den ganzen Bericht willst.',
    steps: [
      {
        title: 'URL eingeben – der Agent prüft',
        text: 'Ein Agent liest deine Website, erkennt Angebot und Wettbewerber, formuliert typische Kundenfragen und stellt sie ChatGPT, Gemini und Google (AI Overviews, KI-Modus). Du siehst live, welchen Punkt seiner Checkliste er gerade abarbeitet.',
      },
      {
        title: 'Ergebnis sofort sehen',
        text: 'Nach 2–3 Minuten: dein Sichtbarkeitswert, wie viele Verbesserungsmaßnahmen der Agent gefunden hat, und eine davon als Beispiel. Ohne E-Mail, ohne Konto.',
      },
      {
        title: 'Maßnahmen umsetzen',
        text: 'Im Bericht bekommst du alle Maßnahmen mit Wirkung, Schritten und fertigen Prompts, online und als PDF per E-Mail. Setz sie selbst um, mit deiner KI oder deiner Agentur – und miss später nach, was sich bewegt hat.',
      },
    ],
    result: { score: 'KI-Sichtbarkeit', found: '9 Verbesserungsmaßnahmen gefunden', example: 'z. B. Eintrag auf vergleichsportal-beispiel.de anlegen' },
    plan: {
      title: '30-Tage-Plan im Strategiebericht',
      rows: [
        { when: 'Woche 1', what: 'Voraussetzungen, z. B. KI-Suchroboter zulassen' },
        { when: 'Woche 2–3', what: 'Vergleichs- und Themenseiten' },
        { when: 'Woche 4', what: 'Portale und Bewertungen' },
      ],
    },
    checklist: ['Website lesen', 'Angebot und Wettbewerber erkennen', 'Kundenfragen formulieren', 'KI-Suchen befragen', 'Maßnahmen ableiten'],
    notes: {
      check: 'Gratis · ca. 2–3 Minuten',
      result: 'Ohne E-Mail · direkt im Browser',
      report: (from: string) => `Bericht ab ${from} netto, einmalig`,
    },
  },
  get: {
    title: 'Was im Bericht steht',
    sub: 'Kein Datenberg, sondern eine Aufgabenliste: wo du stehst, warum – und was du als Nächstes tust.',
    items: [
      { title: 'Konkrete Maßnahmen, nach Wirkung sortiert', text: 'Jede mit Begründung aus deiner Messung, erwarteter Wirkung, Schritten und einem fertigen Prompt für deine KI.' },
      { title: 'Dein Stand in einer Zahl', text: 'KI-Sichtbarkeit von 0 bis 100, je KI-Suche und im Vergleich mit deinen Wettbewerbern.' },
      { title: 'Wer statt dir genannt wird', text: 'Für jede Frage: welche Marken die KIs nennen und empfehlen – mit allen Antworten im Volltext.' },
      { title: 'Welche Quellen die KIs nutzen', text: 'Die Seiten, auf die sich die Antworten stützen. Oft stehen dort deine Wettbewerber, du aber nicht.' },
      { title: 'PDF per E-Mail', text: 'Zum Weiterleiten an Chef, Team oder Agentur. Online bleibt alles abrufbar.' },
    ],
    measures: 'Das bringt dich nach vorn',
    copyPrompt: 'Prompt kopieren',
    cats: { content: 'Eigene Inhalte', external: 'Auf anderen Seiten', community: 'Community', tech: 'Technik' },
    recs: [
      { cat: 'external', title: 'Eintrag auf vergleichsportal-beispiel.de anlegen', meta: 'Große Wirkung · ca. 1 Std.' },
      { cat: 'tech', title: 'KI-Suchroboter in der robots.txt freigeben', meta: 'Große Wirkung · ca. 30 Min.' },
      { cat: 'content', title: 'Vergleichsseite „Nordwerk oder Anbieter A?“ anlegen', meta: 'Mittlere Wirkung · ca. 3 Std.' },
    ],
  },
  pricing: {
    title: 'Preise',
    sub: 'Einmal zahlen, kein Abo. Den Schnell-Check gibt es gratis – danach entscheidest du.',
    beta: 'Beta-Preis',
    instead: (list: string) => `regulär später ${list}`,
    net: 'netto, einmalig',
    popular: 'Empfohlen',
    entry: 'Zum Einstieg',
    cta: 'Mit Gratis-Check starten',
    ctaNote: 'Kaufen kannst du direkt nach dem Schnell-Check.',
    compact: {
      name: 'Standortbestimmung',
      for: 'Der kleinere Einstieg: Wo stehst du, und welche Maßnahmen bringen am meisten?',
      features: [
        '20 Kundenfragen, je 2× in 5 KI-Suchen (200 Antworten)',
        'Vergleich mit bis zu 3 Wettbewerbern',
        'Alle Maßnahmen mit Schritten und fertigen Prompts',
        'Die wichtigsten Quellen der KIs',
        'PDF-Bericht per E-Mail',
      ],
    },
    strategy: {
      name: 'Strategiebericht',
      for: 'Dein kompletter Fahrplan: alle Maßnahmen nach Themen, dazu ein 30-Tage-Plan mit den wichtigsten Schritten.',
      highlight: '30-Tage-Plan: was du in welcher Woche umsetzt',
      features: [
        '60 Kundenfragen nach Themen, je 2× in 5 KI-Suchen (600 Antworten)',
        'Vergleich mit bis zu 5 Wettbewerbern',
        'Quellen je Thema: wo du vertreten sein solltest',
        'Alle Maßnahmen mit Schritten und fertigen Prompts',
        'Alles aus der Standortbestimmung, PDF per E-Mail',
      ],
    },
    remeasure: {
      title: 'Nachmessung',
      text: (compact: string, strategy: string) =>
        `Nach 2–3 Monaten: dieselben Fragen noch einmal, mit Vorher-nachher-Vergleich. ${compact} zur Standortbestimmung, ${strategy} zum Strategiebericht. Nicht im Preis enthalten – du entscheidest später.`,
    },
    compare: {
      title: 'Zum Vergleich',
      agency: 'GEO-Audit einer Agentur',
      agencyPrice: 'typischerweise ab ca. 1.500 €',
      tool: 'Tracking-Tool im Abo',
      toolPrice: 'ab ca. 95 € im Monat – über 1.100 € im Jahr',
      source: 'Typische Marktpreise, eigene Recherche, Stand 11/2026.',
      us: 'Askmetry: Standortbestimmung + Nachmessung',
      usPrice: (sum: string) => `${sum} netto`,
      note: 'Nicht gleichwertig: Abo-Tools messen laufend und lohnen sich, wenn du wöchentlich optimierst. Für den Start reicht vielen eine gute Messung plus Nachmessung.',
    },
    legal: 'Alle Preise netto zzgl. USt. Nur für Unternehmen. Rechnung mit ausgewiesener Umsatzsteuer (bzw. Reverse-Charge-Hinweis).',
  },
  honest: {
    title: 'Ehrlich gemessen',
    sub: 'KI-Antworten sind kein Ranking mit festen Plätzen. Wir zeigen, was wirklich gemessen wurde – und wo die Grenzen liegen.',
    points: [
      {
        title: 'Echte Antworten mit Live-Websuche',
        text: 'ChatGPT, Claude und Gemini fragen wir über ihre offiziellen Schnittstellen mit eingeschalteter Websuche. Für Google AI Overviews und den Google KI-Modus werten wir die echte Google-Ergebnisseite aus.',
      },
      {
        title: 'Mehrfach gefragt, Schwankung offen',
        text: 'Dieselbe Frage bringt nicht immer dieselbe Antwort. Deshalb stellen wir jede Frage zweimal je KI und sagen dir, auf wie vielen Antworten eine Zahl beruht.',
      },
      {
        title: 'Schnittstelle ist nicht gleich App',
        text: 'Was die Schnittstelle antwortet, kommt der App nahe, ist aber nicht identisch: Verlauf, Standort und Personalisierung fehlen. Nimm die Werte als belastbare Tendenz, nicht als Bildschirmfoto.',
      },
      {
        title: 'Keine Garantie auf Platzierungen',
        text: 'Niemand kann Nennungen in KI-Antworten garantieren. Wir empfehlen nur Maßnahmen, die ein kleines Team umsetzen kann und die durch deine Messung und aktuelle Studien gestützt sind.',
      },
    ],
    notYet: 'Noch nicht dabei: Perplexity und Microsoft Copilot.',
  },
  trust: {
    title: 'Gehostet in Deutschland · Open Source',
    hosting: {
      title: 'Gehostet in Deutschland',
      text: 'Askmetry läuft auf Servern in Deutschland (Hetzner), Betreiber ist die lindotech GmbH aus Hamburg. Für die Messung gehen die Fragen an die KI-Anbieter, teils mit Verarbeitung in den USA. Keine Tracking-Cookies, keine Werbe- oder Analyse-Tools; den Gratis-Check schützt Cloudflare Turnstile vor Bots. Einen Vertrag zur Auftragsverarbeitung gibt es online.',
      avv: 'Zum AV-Vertrag',
    },
    oss: {
      title: 'Open Source (AGPL)',
      text: 'Der Code ist offen. Du kannst nachsehen, wie gemessen wird – oder Askmetry mit eigenen API-Schlüsseln selbst betreiben, auch mit laufender Messung.',
      link: 'Code auf GitHub',
    },
  },
  faq: {
    title: 'Häufige Fragen',
    items: [
      {
        q: 'Was ist der Unterschied zu Abo-Tools?',
        a: 'Tracking-Tools messen laufend und kosten jeden Monat. Das lohnt sich, wenn du wöchentlich optimierst. Askmetry ist ein einmaliger Bericht: Stand messen, umsetzen, nach 2–3 Monaten nachmessen. Für viele Firmen reicht das, gerade am Anfang.',
      },
      {
        q: 'Wie lange dauert es?',
        a: 'Der Schnell-Check dauert meist 2–3 Minuten. Du siehst dabei, welchen Punkt seiner Checkliste der Agent gerade abarbeitet, und danach sofort das Ergebnis – ohne E-Mail-Adresse. Einen Bericht startest du, nachdem du Fragen und Wettbewerber geprüft hast. Sobald er fertig ist – meist innerhalb eines Tages, in der Regel spätestens nach 3 Werktagen –, bekommst du eine E-Mail.',
      },
      {
        q: 'Welche KIs werden gemessen?',
        a: `Im Bericht: ChatGPT, Claude, Gemini, Google AI Overviews und der Google KI-Modus. Der Gratis-Check fragt Gemini und beide Google-Varianten zu ${CHECK_Q} Fragen und ChatGPT zu den ersten ${CHECK_Q_CHATGPT}, jeweils einmal. Perplexity und Microsoft Copilot sind noch nicht dabei.`,
      },
      {
        q: 'Gibt es eine Garantie, dass ich danach genannt werde?',
        a: 'Nein, und das kann niemand seriös. KIs stellen ihre Antworten jedes Mal neu zusammen. Wir zeigen dir, welche Maßnahmen nach deinen Daten am ehesten helfen, und mit der Nachmessung siehst du, ob sie gewirkt haben.',
      },
      {
        q: 'Was genau sind die Maßnahmen?',
        a: 'Konkrete Aufgaben, die sich aus deiner Messung ergeben: zum Beispiel ein Eintrag auf einem Portal, das die KIs oft zitieren, eine fehlende Vergleichs- oder FAQ-Seite, strukturierte Daten oder mehr Bewertungen. Jede Maßnahme hat eine Begründung, Schritte, eine Einschätzung der Wirkung und einen fertigen Prompt. Im Strategiebericht kommen die wichtigsten zusätzlich als 30-Tage-Plan.',
      },
      {
        q: 'Brauche ich technisches Wissen?',
        a: 'Nein. Jede Maßnahme kommt mit Schritten und einem fertigen Prompt, den du in deine KI kopieren kannst. Technische Punkte sind so beschrieben, dass du sie an deine Webagentur weitergeben kannst.',
      },
      {
        q: 'Was passiert mit meinen Daten?',
        a: 'Für den Schnell-Check speichern wir deine Website-Adresse, die erzeugten Fragen und die KI-Antworten; deine E-Mail-Adresse nur, wenn du dich benachrichtigen lässt (beim Check; unbestätigt löschen wir sie nach 7 Tagen, bestätigt mit dem Check nach 90 Tagen ohne Kauf), ein Konto anlegst oder kaufst. Für die Begrenzung der Gratis-Checks nutzen wir statt deiner IP-Adresse nur einen Hashwert und löschen ihn nach 7 Tagen; Server-Logs löschen wir nach 14 Tagen. An die KI-Anbieter gehen die Fragen, Marken- und Wettbewerbernamen und Inhalte deiner öffentlichen Website – nicht dein Name oder deine E-Mail-Adresse. Details stehen in der Datenschutzerklärung.',
      },
      {
        q: 'Bekomme ich eine Rechnung?',
        a: 'Ja, mit ausgewiesener Umsatzsteuer (bzw. Reverse-Charge-Hinweis). Bezahlt wird über Stripe; deine USt-IdNr. kannst du dabei angeben. Alle Preise sind Nettopreise.',
      },
      {
        q: 'Warum nur für Unternehmen?',
        a: 'Der Bericht ist für Firmen, Selbstständige und Organisationen gedacht, die mit ihrer Website Kunden gewinnen. Wir verkaufen deshalb nur an Unternehmer im Sinne von § 14 BGB. Das hält die Abwicklung schlank und den Preis niedrig.',
      },
      {
        q: 'Was passiert nach dem Kauf?',
        a: 'Zum Kauf legst du ein Konto mit deiner E-Mail-Adresse an und bestätigst, dass du als Unternehmen kaufst. Nach der Zahlung prüfst du Fragen und Wettbewerber und startest die Messung. Wenn der Bericht fertig ist, bekommst du ihn per E-Mail als PDF und kannst ihn online ansehen. Nach etwa 8 Wochen erinnern wir dich einmal an die Nachmessung – abbestellbar mit einem Klick.',
      },
      {
        q: 'Kann ich Askmetry selbst betreiben?',
        a: 'Ja. Askmetry ist Open Source (AGPL). Mit eigenen API-Schlüsseln kannst du es auf deinem Server betreiben und regelmäßig messen. Die Anleitung steht auf GitHub.',
      },
    ],
  },
  final: {
    title: 'Finde heraus, was du verbessern kannst.',
    sub: 'Gib deine Website ein. Der Agent prüft sie in 2–3 Minuten – kostenlos, ohne E-Mail, mit Ergebnis direkt im Browser.',
  },
  footer: {
    claim: 'KI-Sichtbarkeit messen und verbessern – ehrlich, einmalig, ohne Abo.',
    legalLabel: 'Rechtliches',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    terms: 'AGB',
    dpa: 'AV-Vertrag',
    subprocessors: 'Unterauftragnehmer',
    github: 'GitHub',
    copyright: (year: number) => `© ${year} lindotech GmbH, Hamburg`,
  },
};
export default marketing;
