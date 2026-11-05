// Rahmentexte für den Kurzleitfaden GEO (/w/[slug]/leitfaden und /leitfaden). Die Einträge selbst stehen in @askmetry/core/guide.
const guide = {
  nav: 'Leitfaden',
  metaTitle: 'Kurzleitfaden GEO',
  publicMetaTitle: 'GEO-Leitfaden: Wie ChatGPT und Google AI entscheiden, wen sie nennen | Askmetry',
  publicDescription: 'Kompakte, belegte Antworten zu Generative Engine Optimization: wie KI-Suchen Quellen wählen, welche Rolle YouTube, Reddit und Backlinks spielen und was du tun kannst.',
  updated: (date: string) => `Stand: ${date}`,
  entrySources: 'Quellen:',
  sourcesTitle: 'Quellen',
  caveatTitle: 'Zu den Zahlen',
  footerLink: 'GEO-Leitfaden',
  whereQuestions: 'Woher kommen die Fragen?',
  cta: {
    title: 'Wie oft nennen die KI-Suchen dich?',
    text: 'Der kostenlose Schnell-Check zeigt es dir in wenigen Minuten.',
    button: 'Schnell-Check starten',
  },
};
export default guide;
