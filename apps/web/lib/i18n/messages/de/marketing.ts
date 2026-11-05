// Öffentliche Startseite der gehosteten Version (askmetry.ai). Ehrlich: keine Garantie auf Nennungen, Anker nur „typischerweise“.
// Preise kommen als fertig formatierte Strings (aus hostedConfig), damit sie an einer Stelle konfiguriert bleiben.
const marketing = {
  meta: {
    title: 'Askmetry – Wie sichtbar bist du in ChatGPT, Gemini und Google AI?',
    description:
      'Einmaliger Bericht statt Abo: Askmetry misst, ob ChatGPT, Claude, Gemini und Google AI deine Firma nennen, wer statt dir empfohlen wird und was du konkret tun kannst. Gratis-Schnell-Check per URL.',
    ogTitle: 'Wo stehst du in ChatGPT, Claude, Gemini und Google AI?',
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
    eyebrow: 'KI-Sichtbarkeit · Bericht statt Abo',
    title: 'Wo stehst du in ChatGPT, Claude, Gemini und Google AI?',
    sub: 'Askmetry stellt typische Fragen deiner Kunden an fünf KI-Suchen. Du siehst, ob du genannt wirst, wer statt dir empfohlen wird – und was du konkret tun kannst.',
    priceLine: (from: string) => `Bericht ab ${from} netto, einmalig. Kein Abo.`,
    points: ['Schnell-Check kostenlos', 'Ohne Konto', 'Gehostet in Deutschland'],
  },
  form: {
    label: 'Adresse deiner Website',
    placeholder: 'deine-firma.de',
    submit: 'Gratis prüfen',
    submitting: 'Wird gestartet …',
    hint: 'Kostenlos und ohne Konto. Für das Ergebnis bestätigst du nur deine E-Mail-Adresse.',
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
    measured: 'Standortbestimmung · 300 Antworten',
    score: 'KI-Sichtbarkeit',
    verdict: 'Selten sichtbar',
    sentence: 'In 36 von 300 Antworten genannt – Anbieter A in 186.',
    engines: 'Je KI-Suche',
    ranking: 'Wer in der KI-Suche vorne liegt',
    you: 'Du',
    competitor: (letter: string) => `Anbieter ${letter}`,
    insight: 'KIs zitieren vergleichsportal-beispiel.de in 24 % der Antworten – Nordwerk steht dort nicht.',
    engineNames: { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', google_aio: 'Google-Übersicht', google_ai_mode: 'Google KI-Modus' },
  },
  how: {
    title: "So funktioniert's",
    sub: 'Einmal messen, umsetzen, später nachmessen. Ohne Abo und ohne Fachwissen.',
    steps: [
      {
        title: 'Website eingeben',
        text: 'Askmetry liest deine Website, erkennt Angebot und Wettbewerber und formuliert typische Kundenfragen. Der Schnell-Check stellt 10 davon an Gemini und Google (AI Overviews, KI-Modus) und 5 an ChatGPT – kostenlos.',
      },
      {
        title: 'Bericht wählen',
        text: 'Du prüfst die Fragen und Wettbewerber, dann messen wir: jede Frage dreimal in fünf KI-Suchen. Du bekommst den Bericht online und als PDF per E-Mail.',
      },
      {
        title: 'Umsetzen und nachmessen',
        text: 'Arbeite die Maßnahmen ab – selbst, mit deiner KI oder deiner Agentur. Nach 2–3 Monaten zeigt die Nachmessung mit denselben Fragen, was sich bewegt hat.',
      },
    ],
    notes: {
      check: 'Gratis · meist in wenigen Minuten',
      report: (from: string) => `ab ${from} netto, einmalig`,
      remeasure: (from: string) => `Nachmessung ab ${from} netto`,
    },
  },
  get: {
    title: 'Was du bekommst',
    sub: 'Kein Datenberg, sondern eine klare Antwort: wo du stehst, warum – und was du als Nächstes tust.',
    items: [
      { title: 'Dein Stand in einer Zahl', text: 'KI-Sichtbarkeit von 0 bis 100, je KI-Suche und im Vergleich mit deinen Wettbewerbern.' },
      { title: 'Wer statt dir genannt wird', text: 'Für jede Frage: welche Marken die KIs nennen und empfehlen – mit allen Antworten im Volltext.' },
      { title: 'Welche Quellen die KIs nutzen', text: 'Die Seiten, auf die sich die Antworten stützen. Oft stehen dort deine Wettbewerber, du aber nicht.' },
      { title: 'Konkrete Maßnahmen', text: 'Sortiert nach erwarteter Wirkung, jede mit Schritten, Aufwand und einem fertigen Prompt für deine KI.' },
      { title: 'PDF per E-Mail', text: 'Zum Weiterleiten an Chef, Team oder Agentur. Online bleibt alles abrufbar.' },
    ],
    measures: 'Das bringt dich nach vorn',
    copyPrompt: 'Prompt kopieren',
    cats: { content: 'Eigene Inhalte', external: 'Auf anderen Seiten', community: 'Community', tech: 'Technik' },
    recs: [
      { cat: 'tech', title: 'KI-Suchroboter in der robots.txt freigeben', meta: 'Große Wirkung · ca. 30 Min.' },
      { cat: 'external', title: 'Eintrag auf vergleichsportal-beispiel.de anfragen', meta: 'Große Wirkung · ca. 1 Std.' },
      { cat: 'content', title: 'Vergleichsseite „Nordwerk oder Anbieter A?“ anlegen', meta: 'Mittlere Wirkung · ca. 3 Std.' },
    ],
  },
  pricing: {
    title: 'Preise',
    sub: 'Einmal zahlen, kein Abo. Den Schnell-Check gibt es gratis – danach entscheidest du.',
    beta: 'Beta-Preis',
    instead: (list: string) => `regulär später ${list}`,
    net: 'netto, einmalig',
    popular: 'Mehr Tiefe',
    cta: 'Mit Gratis-Check starten',
    ctaNote: 'Kaufen kannst du direkt nach dem Schnell-Check.',
    compact: {
      name: 'Standortbestimmung',
      for: 'Der ehrliche Überblick: Wo stehst du, und was bringt am meisten?',
      features: [
        '20 Kundenfragen, je 3× in 5 KI-Suchen (300 Antworten)',
        'Vergleich mit bis zu 3 Wettbewerbern',
        'Alle Maßnahmen mit Schritten und fertigen Prompts',
        'Die wichtigsten Quellen der KIs',
        'PDF-Bericht per E-Mail',
      ],
    },
    strategy: {
      name: 'Strategiebericht',
      for: 'Für Teams mit mehreren Angeboten, Themen oder Märkten.',
      features: [
        '60 Kundenfragen nach Themen, je 3× in 5 KI-Suchen (900 Antworten)',
        'Vergleich mit bis zu 5 Wettbewerbern',
        'Quellen je Thema: wo du vertreten sein solltest',
        '90-Tage-Plan mit Reihenfolge',
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
        text: 'Dieselbe Frage bringt nicht immer dieselbe Antwort. Deshalb stellen wir jede Frage dreimal je KI und sagen dir, auf wie vielen Antworten eine Zahl beruht.',
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
        a: 'Der Schnell-Check ist meist wenige Minuten nach der Bestätigung deiner E-Mail-Adresse fertig. Einen Bericht startest du, nachdem du Fragen und Wettbewerber geprüft hast. Sobald er fertig ist – meist innerhalb eines Tages, in der Regel spätestens nach 3 Werktagen –, bekommst du eine E-Mail.',
      },
      {
        q: 'Welche KIs werden gemessen?',
        a: 'Im Bericht: ChatGPT, Claude, Gemini, Google AI Overviews und der Google KI-Modus. Der Gratis-Check fragt Gemini und beide Google-Varianten zu 10 Fragen und ChatGPT zu den ersten 5, jeweils einmal. Perplexity und Microsoft Copilot sind noch nicht dabei.',
      },
      {
        q: 'Gibt es eine Garantie, dass ich danach genannt werde?',
        a: 'Nein, und das kann niemand seriös. KIs stellen ihre Antworten jedes Mal neu zusammen. Wir zeigen dir, welche Maßnahmen nach deinen Daten am ehesten helfen, und mit der Nachmessung siehst du, ob sie gewirkt haben.',
      },
      {
        q: 'Brauche ich technisches Wissen?',
        a: 'Nein. Jede Maßnahme kommt mit Schritten und einem fertigen Prompt, den du in deine KI kopieren kannst. Technische Punkte sind so beschrieben, dass du sie an deine Webagentur weitergeben kannst.',
      },
      {
        q: 'Was passiert mit meinen Daten?',
        a: 'Wir speichern deine Website-Adresse, die erzeugten Fragen, die KI-Antworten und deine E-Mail-Adresse. Für die Begrenzung der Gratis-Checks nutzen wir statt deiner IP-Adresse nur einen Hashwert und löschen ihn nach 7 Tagen; Server-Logs löschen wir nach 14 Tagen. An die KI-Anbieter gehen die Fragen, Marken- und Wettbewerbernamen und Inhalte deiner öffentlichen Website – nicht dein Name oder deine E-Mail-Adresse. Details stehen in der Datenschutzerklärung.',
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
        a: 'Zum Kauf legst du ein Konto an (die E-Mail-Adresse aus dem Check ist schon eingetragen) und bestätigst, dass du als Unternehmen kaufst. Nach der Zahlung prüfst du Fragen und Wettbewerber und startest die Messung. Wenn der Bericht fertig ist, bekommst du ihn per E-Mail als PDF und kannst ihn online ansehen. Nach etwa 8 Wochen erinnern wir dich einmal an die Nachmessung – abbestellbar mit einem Klick.',
      },
      {
        q: 'Kann ich Askmetry selbst betreiben?',
        a: 'Ja. Askmetry ist Open Source (AGPL). Mit eigenen API-Schlüsseln kannst du es auf deinem Server betreiben und regelmäßig messen. Die Anleitung steht auf GitHub.',
      },
    ],
  },
  final: {
    title: 'Finde heraus, wo du stehst.',
    sub: 'Gib deine Website ein. Der Schnell-Check ist kostenlos und dauert meist nur wenige Minuten.',
  },
  footer: {
    claim: 'KI-Sichtbarkeit messen – ehrlich, einmalig, ohne Abo.',
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
