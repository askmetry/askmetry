// Testmarken, getrackte Wettbewerber und Prompts für den Spike.
// Wettbewerber sind ein Startpunkt – die Auswertung findet auch ungetrackte Marken.

export const projects = [
  {
    id: 'paylindo',
    brand: { name: 'Paylindo', aliases: ['paylindo.de'], domains: ['paylindo.de'] },
    competitors: [
      { name: 'SumUp', domains: ['sumup.de', 'sumup.com'] },
      { name: 'Payone', domains: ['payone.com', 'payone.de'] },
      { name: 'Zettle', aliases: ['PayPal Zettle', 'iZettle'], domains: ['zettle.com'] },
      { name: 'myPOS', domains: ['mypos.com'] },
      { name: 'Viva Wallet', aliases: ['Viva.com'], domains: ['viva.com'] },
      { name: 'Stripe', domains: ['stripe.com'] },
      { name: 'Nexi', aliases: ['Concardis'], domains: ['nexi.de', 'nexigroup.com'] },
      { name: 'Worldline', domains: ['worldline.com'] },
    ],
    prompts: [
      'Welches EC-Kartengerät ist für ein kleines Café am günstigsten?',
      'EC-Terminal kaufen oder mieten – was lohnt sich für einen Einzelhändler?',
      'Wo kann ich Anbieter für Kartenzahlungsgeräte in Deutschland vergleichen?',
      'Was kostet Kartenzahlung für Händler in Deutschland an Gebühren?',
      'Kartenzahlungspflicht 2027 – was muss ich als Händler jetzt tun?',
      'Bester Anbieter für Kartenzahlung ohne monatliche Grundgebühr',
      'Payone Erfahrungen und Gebühren für kleine Händler',
      'SumUp oder Zettle – welches Kartenlesegerät ist besser?',
      'Welches Kartenterminal eignet sich für einen Friseursalon?',
      'Wie finde ich den günstigsten EC-Karten-Tarif für mein Geschäft?',
    ],
  },
  {
    id: 'medishift',
    brand: { name: 'MediShift', aliases: ['Medishift'], domains: ['medishift.com', 'medishift.de'] },
    competitors: [
      { name: 'Papershift', domains: ['papershift.com'] },
      { name: 'Planday', domains: ['planday.com'] },
      { name: 'Shiftbase', domains: ['shiftbase.com'] },
      { name: 'Personio', domains: ['personio.de', 'personio.com'] },
      { name: 'Factorial', domains: ['factorialhr.de', 'factorialhr.com'] },
      { name: 'ZEP', domains: ['zep.de'] },
    ],
    prompts: [
      'Welche Dienstplan-Software eignet sich für eine Arztpraxis?',
      'Beste Software für Dienstplanung in einer Zahnarztpraxis',
      'Wie organisiere ich die Urlaubsplanung für MFA in einer Praxis digital?',
      'Zeiterfassung in der Arztpraxis – welche Software ist empfehlenswert?',
      'Dienstplan-App für Praxisteams mit Schichttausch',
      'Personalplanung für Physiotherapie-Praxen – welche Tools gibt es?',
      'Software für Schichtplanung in medizinischen Versorgungszentren (MVZ)',
      'Wie erstelle ich einen fairen Dienstplan für eine Hausarztpraxis?',
      'Alternativen zu Excel für den Dienstplan in der Praxis',
      'DSGVO-konforme Dienstplan-Software für Arztpraxen in Deutschland',
    ],
  },
];

export const settings = {
  country: 'DE',
  language: 'de',
  dataforseoLocationCode: 2276, // Deutschland
  concurrency: 3,
  models: {
    openai: process.env.OPENAI_MODEL || 'gpt-5.5',
    gemini: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    claude: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    perplexity: process.env.PERPLEXITY_MODEL || 'sonar',
    analyzer: process.env.ANALYZER_MODEL || 'claude-haiku-5-5',
  },
};
