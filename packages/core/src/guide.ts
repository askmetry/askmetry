// Kurzleitfaden GEO (FAQ) – eine Datenquelle für die App (/w/[slug]/leitfaden, /leitfaden) und den PDF-Anhang.
// Rein und ohne Abhängigkeiten. Import: `import { geoGuide } from '@askmetry/core/guide'`.
// Regeln: nur belegte Zahlen (Quelle in GUIDE_SOURCES), Du-Form, Unsicherheiten benennen, de und en mit denselben Einträgen.
// Aussagen über Askmetry selbst (Fragen, Messung, Sperren) müssen zum Code passen; Aussagen nur über die gehostete Version
// (Schnell-Check, Berichte, Sperren, Erinnerung) stehen in Einträgen mit hostedOnly und haben eine neutrale selfHosted-Fassung:
// hosted/discovery.ts, hosted/config.ts (REPORT_SCOPE, CHECK_SCOPE, REMEASURE_REMINDER_DAYS), apps/web/lib/hosted/rights.ts.

export type GuideLang = 'de' | 'en';

/** Ein Absatz oder eine Aufzählung. Texte sind Klartext (kein Markdown, kein HTML). */
export type GuideBlock = { kind: 'p'; text: string } | { kind: 'list'; items: string[] };

export interface GuideEntry {
  /** stabil, URL-tauglich (Anker #id), in beiden Sprachen gleich */
  id: string;
  question: string;
  answer: GuideBlock[];
  /** IDs aus GUIDE_SOURCES, in der Reihenfolge der Nennung */
  sources?: string[];
  /**
   * true = beschreibt Funktionen der gehosteten Version (Schnell-Check, Berichte, Sperren, Erinnerung).
   * Im Selbsthosting gilt stattdessen `selfHosted`; fehlt es, entfällt der Eintrag.
   */
  hostedOnly?: boolean;
  /** neutrale Fassung für Selbsthoster (nur bei hostedOnly); Frage optional, sonst dieselbe */
  selfHosted?: { question?: string; answer: GuideBlock[] };
}

export interface GuideSource {
  id: string;
  /** Herausgeber und Titel, z. B. „Seer Interactive: 87 % der ChatGPT-Zitate …“ */
  label: string;
  /** Veröffentlichung, z. B. „Feb. 2025“ */
  date: string;
  url: string;
}

export interface Guide {
  lang: GuideLang;
  /** Titel für App und PDF-Anhang („Kurzleitfaden GEO“) */
  title: string;
  /** ein bis zwei Sätze unter dem Titel */
  intro: string;
  /** Vorbehalt zu den Zahlen (unter der Liste bzw. vor den Quellen) */
  caveat: string;
  /** Stand der Recherche */
  updated: string;
  entries: GuideEntry[];
  /** alle Quellen der Einträge, nummeriert in dieser Reihenfolge ([1], [2], …) */
  sources: GuideSource[];
}

// ---------------------------------------------------------------------------
// Quellen (sprachneutral bis auf das Datum)
// ---------------------------------------------------------------------------

const SRC: { id: string; label: string; date: Record<GuideLang, string>; url: string }[] = [
  { id: 'seer-bing', label: 'Seer Interactive: 87% of SearchGPT citations match Bing’s top results', date: { de: 'Feb. 2025', en: 'Feb 2025' }, url: 'https://www.seerinteractive.com/insights/87-percent-of-searchgpt-citations-match-bings-top-results' },
  { id: 'willison-brave', label: 'Simon Willison: Anthropic’s Claude uses Brave Search', date: { de: 'März 2025', en: 'Mar 2025' }, url: 'https://simonwillison.net/2025/Mar/21/anthropic-use-brave/' },
  { id: 'google-ai-features', label: 'Google Search Central: AI features and your website', date: { de: 'abgerufen Nov. 2026', en: 'retrieved Nov 2026' }, url: 'https://developers.google.com/search/docs/appearance/ai-features' },
  { id: 'ahrefs-mentions', label: 'Ahrefs: Brand mentions vs. AI Overview visibility (75,000 brands)', date: { de: 'Mai 2025', en: 'May 2025' }, url: 'https://ahrefs.com/blog/ai-overview-brand-correlation/' },
  { id: 'ahrefs-visibility', label: 'Ahrefs: Top brand visibility factors in ChatGPT, AI Mode and AI Overviews', date: { de: 'Dez. 2025', en: 'Dec 2025' }, url: 'https://ahrefs.com/blog/ai-brand-visibility-correlations/' },
  { id: 'ahrefs-lists', label: 'Ahrefs: “Best X” lists in ChatGPT sources (26,283 URLs)', date: { de: 'Dez. 2025', en: 'Dec 2025' }, url: 'https://ahrefs.com/blog/best-lists-research/' },
  { id: 'princeton-geo', label: 'Aggarwal et al.: GEO – Generative Engine Optimization (KDD 2024)', date: { de: '2024', en: '2024' }, url: 'https://arxiv.org/abs/2311.09735' },
  { id: 'peec-domains', label: 'Peec AI: Most cited domains in AI search (30 million citations, US)', date: { de: 'März 2026', en: 'Mar 2026' }, url: 'https://docs.peec.ai/research/most-cited-domains-in-ai-search' },
  { id: 'semrush-domains', label: 'Semrush: The most-cited domains in AI – a 3-month study', date: { de: 'Nov. 2025', en: 'Nov 2025' }, url: 'https://www.semrush.com/blog/most-cited-domains-ai/' },
  { id: 'sej-aio-top10', label: 'Search Engine Journal: Google AI Overview citations from top-ranking pages drop sharply (Ahrefs data)', date: { de: '2026', en: '2026' }, url: 'https://www.searchenginejournal.com/google-ai-overview-citations-from-top-ranking-pages-drop-sharply/568637/' },
  { id: 'openai-crawlers', label: 'OpenAI: Overview of OpenAI crawlers (OAI-SearchBot)', date: { de: 'abgerufen Nov. 2026', en: 'retrieved Nov 2026' }, url: 'https://developers.openai.com/docs/gptbot' },
  { id: 'vercel-crawlers', label: 'Vercel: The rise of the AI crawler', date: { de: 'Dez. 2024', en: 'Dec 2024' }, url: 'https://vercel.com/blog/the-rise-of-the-ai-crawler' },
  { id: 'llms-txt', label: 'PPC Land: llms.txt adoption rises, but 97% of files get zero AI requests', date: { de: '2026', en: '2026' }, url: 'https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/' },
  { id: 'sparktoro-consistency', label: 'SparkToro: AIs are highly inconsistent when recommending brands or products', date: { de: 'Jan. 2026', en: 'Jan 2026' }, url: 'https://sparktoro.com/blog/new-research-ais-are-highly-inconsistent-when-recommending-brands-or-products-marketers-should-take-care-when-tracking-ai-visibility/' },
];

// ---------------------------------------------------------------------------
// Einträge
// ---------------------------------------------------------------------------

type Draft = Omit<Guide, 'lang' | 'sources'>;

const p = (text: string): GuideBlock => ({ kind: 'p', text });
const list = (...items: string[]): GuideBlock => ({ kind: 'list', items });

const de: Draft = {
  title: 'Kurzleitfaden GEO',
  intro: 'Die wichtigsten Fragen zu Generative Engine Optimization (GEO): wie KI-Suchen entscheiden, wen sie nennen, was du dafür tun kannst – und wie Askmetry misst.',
  caveat: 'Die meisten Zahlen stammen von Anbietern von SEO- und KI-Tools, beziehen sich auf englischsprachige Fragen (meist USA) und zeigen Zusammenhänge, keine bewiesenen Ursachen. Für deutschsprachige Fragen gibt es bisher keine unabhängige Studie – deshalb misst Askmetry selbst.',
  updated: 'November 2026',
  entries: [
    {
      id: 'wie-entscheidet-ki',
      question: 'Wie entscheidet sich, was in den KI-Suchen auftaucht?',
      answer: [
        p('Eine KI-Antwort speist sich aus zwei Quellen: dem Wissen, das das Modell im Training gelernt hat, und einer Websuche, die es zur Frage live ausführt. Askmetry misst alle KI-Suchen mit eingeschalteter Websuche, so wie Interessenten sie nutzen.'),
        p('Welche Seiten die KI dabei findet, hängt vom Suchindex dahinter ab: Die Zitate von ChatGPT deckten sich in einer Stichprobe von Seer Interactive zu 87 % mit den Bing-Top-20, aber nur zu 56 % mit Google. Claude suchte nachweislich über Brave. Google AI Overviews und der KI-Modus nutzen den Google-Index und zerlegen eine Frage in mehrere Teilsuchen („Query Fan-out“).'),
        p('Aus den gefundenen Seiten wählt das Modell aus, welche Marken es nennt – bevorzugt solche, die auf vielen unabhängigen Seiten im passenden Zusammenhang vorkommen. Wie genau gewichtet wird, legt kein Anbieter offen.'),
      ],
      sources: ['seer-bing', 'willison-brave', 'google-ai-features', 'ahrefs-mentions'],
    },
    {
      id: 'positionierung',
      question: 'Wie verbessere ich meine Positionierung generell?',
      answer: [
        p('Am meisten bringt es, wenn die KI an vielen Stellen dasselbe über dich liest und dich eindeutig einer Kategorie zuordnen kann. Die wichtigsten Hebel:'),
        list(
          'Ein klarer Satz „Marke + Kategorie + für wen“, gleichlautend auf Startseite, Über-uns-Seite und allen Profilen.',
          'Inhalte für die Fragen, bei denen Wettbewerber genannt werden und du nicht: Vergleiche, „Alternativen zu X“ und ehrliche „Beste X für Y“-Listen. Bei Ahrefs waren 43,8 % der von ChatGPT verlinkten Seiten solche Listen.',
          'Antwort zuerst: Frage als Überschrift, darunter die Antwort in zwei, drei Sätzen, dann Details mit Zahlen und Quellen. Im Princeton-Laborversuch steigerten Statistiken, Zitate und Quellenangaben die Sichtbarkeit um bis zu 40 %.',
          'Erwähnungen auf fremden Seiten: Bewertungsportale, Vergleichsportale, Fachmedien und Ratgeber.',
        ),
        p('Rechne in Monaten, nicht in Tagen, und miss nach: Keine einzelne Maßnahme garantiert eine Nennung.'),
      ],
      sources: ['ahrefs-lists', 'princeton-geo', 'ahrefs-mentions'],
    },
    {
      id: 'plattformen',
      question: 'Welche Rolle spielen YouTube, Reddit und andere Plattformen?',
      answer: [
        p('Eine große: In einer Auswertung von Peec AI mit 30 Millionen Zitaten (USA, März 2026) lagen Reddit, YouTube, LinkedIn und Wikipedia vorn. Bei Ahrefs hingen Erwähnungen in YouTube-Videos unter allen geprüften Faktoren am stärksten mit KI-Sichtbarkeit zusammen (Korrelation rund 0,74).'),
        p('Die Anteile schwanken aber stark: Laut Semrush fiel der Anteil der ChatGPT-Antworten mit Reddit-Zitat 2025 binnen weniger Wochen von etwa 60 % auf etwa 10 %. Für deutschsprachige Fragen fehlen unabhängige Zahlen, und in vielen DACH-Nischen ist auf Reddit kaum etwas los.'),
        p('Werde deshalb dort aktiv, wo Askmetry die Plattform bei deinen Fragen tatsächlich als Quelle misst: mit Erklärvideos auf YouTube, fachlichen LinkedIn-Beiträgen oder offenen Antworten als Anbieter in Foren. Gekaufte Posts und Zweitkonten fliegen auf und schaden der Marke; einen Wikipedia-Artikel über die eigene Firma lassen die Relevanzkriterien selten zu.'),
      ],
      sources: ['peec-domains', 'ahrefs-visibility', 'semrush-domains'],
    },
    {
      id: 'backlinks',
      question: 'Welche Rolle spielen Backlinks?',
      answer: [
        p('Eine kleinere, als viele erwarten. In der Ahrefs-Studie mit 75.000 Marken hingen Erwähnungen der Marke im Netz deutlich stärker mit Nennungen in Google AI Overviews zusammen (0,66) als die Zahl der Backlinks (0,22) oder die Domain-Stärke (0,33).'),
        p('Wertlos sind Links trotzdem nicht: Die KI-Suchen finden Seiten über Bing und Google, und dort helfen Links weiter beim Ranking. Entscheidend ist aber, dass deine Marke auf relevanten Seiten genannt und eingeordnet wird – ein gekaufter Link ohne Zusammenhang bringt wenig, eine Erwähnung in einem Vergleichsartikel kann auch ohne Link helfen.'),
        p('Beides sind Korrelationen: Bekannte Marken haben meist viele Links und viele Erwähnungen zugleich.'),
      ],
      sources: ['ahrefs-mentions', 'ahrefs-visibility'],
    },
    {
      id: 'google-ranking',
      question: 'Reicht es, bei Google weit oben zu stehen?',
      answer: [
        p('Es hilft, reicht aber nicht. Laut Ahrefs-Daten kamen zuletzt nur noch rund 38 % der Zitate in Google AI Overviews von Seiten aus den Google-Top-10, vorher waren es rund 76 %. ChatGPT orientiert sich zudem eher an Bing als an Google.'),
        p('Google selbst sagt, für AI Overviews und den KI-Modus brauche es keine besondere Optimierung: Die Seite muss indexiert sein und mit Textauszug angezeigt werden dürfen. Gutes SEO bleibt also die Basis; GEO ergänzt es um Erwähnungen auf fremden Seiten und Inhalte, die Fragen direkt beantworten.'),
      ],
      sources: ['sej-aio-top10', 'seer-bing', 'google-ai-features'],
    },
    {
      id: 'technik',
      question: 'Welche technischen Voraussetzungen braucht meine Website?',
      answer: [
        p('Wenige, aber sie sind Pflicht:'),
        list(
          'KI-Crawler nicht sperren (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot, Googlebot) – auch nicht versehentlich in Cloudflare oder der Firewall. Laut OpenAI erscheinen Seiten, die OAI-SearchBot aussperren, nicht in den Suchantworten von ChatGPT.',
          'Wichtige Inhalte als fertiges HTML ausliefern: Die Crawler von OpenAI, Anthropic und Perplexity führen laut Vercel kein JavaScript aus.',
          'Die Website in den Bing Webmaster Tools anmelden und neue Seiten per IndexNow melden.',
        ),
        p('llms.txt und zusätzliches Schema-Markup sind nach heutigem Stand keine Hebel: Google braucht dafür keine neuen Dateien oder Auszeichnungen, und 97 % der untersuchten llms.txt-Dateien wurden von KIs nie abgerufen. Crawler-Sperren und Text ohne JavaScript prüft der Website-Check von Askmetry automatisch.'),
      ],
      sources: ['openai-crawlers', 'vercel-crawlers', 'google-ai-features', 'llms-txt'],
    },
    {
      id: 'woher-fragen',
      question: 'Woher kommen die Fragen, die Askmetry misst?',
      answer: [
        p('Askmetry liest die Startseite deiner Website und erkennt daraus Marke, Angebot und Wettbewerber. Ein KI-Modell formuliert dann 20 Fragen, wie Interessenten in deinem Markt sie ChatGPT oder Google stellen würden: Kategoriefragen („beste X für Y“), Problemfragen, Vergleiche zwischen Anbietern, „Alternative zu …“ und Fragen zu Kosten.'),
        p('Deine eigene Marke kommt in höchstens zwei Fragen vor, denn es geht darum, ob die KI dich von sich aus nennt. Für den Strategiebericht erzeugt Askmetry 40 weitere Fragen, gruppiert nach Themen.'),
        p('Die Fragen sind eine Stichprobe typischer Kundenfragen, keine vollständige Liste: Was Nutzer tatsächlich eintippen, legen die KI-Anbieter nicht offen.'),
      ],
      hostedOnly: true,
      selfHosted: {
        question: 'Welche Fragen sollte ich messen?',
        answer: [
          p('Die Fragen legst du selbst an, unter „Fragen“ bzw. in den Einstellungen. Nimm Fragen, wie Interessenten in deinem Markt sie ChatGPT oder Google stellen würden: Kategoriefragen („beste X für Y“), Problemfragen, Vergleiche zwischen Anbietern, „Alternative zu …“ und Fragen zu Kosten.'),
          p('Deine eigene Marke sollte nur in wenigen Fragen vorkommen, denn es geht darum, ob die KI dich von sich aus nennt. Gute Quellen für echte Fragen sind Vertrieb und Kundenservice.'),
          p('Die Fragen sind eine Stichprobe typischer Kundenfragen, keine vollständige Liste: Was Nutzer tatsächlich eintippen, legen die KI-Anbieter nicht offen.'),
        ],
      },
    },
    {
      id: 'fragen-anpassen',
      question: 'Kann ich die Fragen anpassen?',
      answer: [
        p('Ja. Unter „Fragen“ führt „Fragen bearbeiten“ in die Einstellungen; dort kannst du Fragen umformulieren, hinzufügen, deaktivieren, löschen und Themen zuordnen. Ein neuer Bericht misst die aktiven Fragen bis zu seinem Umfang (20 bzw. 60).'),
        p('Nach dem ersten fertigen Bericht ist der Wortlaut bestehender Fragen gesperrt: Die Nachmessung stellt genau dieselben Fragen wie der Bericht davor – nur so lässt sich vergleichen, was deine Maßnahmen bewirkt haben. Neu hinzugefügte Fragen fließen deshalb erst in einen neuen Bericht ein, nicht in die Nachmessung. Solange ein Bericht misst oder eine bezahlte Nachmessung auf ihren Start wartet, lassen sich Fragen und Wettbewerber gar nicht ändern.'),
        p('Unser Rat: Ersetze vor dem ersten Bericht Fragen, die so niemand stellen würde, durch echte Fragen aus Vertrieb und Kundenservice.'),
      ],
      hostedOnly: true,
      selfHosted: {
        answer: [
          p('Ja. Unter „Fragen“ führt „Fragen bearbeiten“ in die Einstellungen; dort kannst du Fragen umformulieren, hinzufügen, deaktivieren, löschen und Themen zuordnen. Jede Messung stellt die aktiven Fragen.'),
          p('Vergleiche über die Zeit sind nur aussagekräftig, wenn die Fragen gleich bleiben. Ändere den Wortlaut deshalb möglichst früh und danach selten – sonst lässt sich nicht trennen, was deine Maßnahmen bewirkt haben und was an der neuen Frage liegt.'),
          p('Unser Rat: Ersetze Fragen, die so niemand stellen würde, durch echte Fragen aus Vertrieb und Kundenservice.'),
        ],
      },
    },
    {
      id: 'messung',
      question: 'Wie misst Askmetry?',
      answer: [
        p('Askmetry stellt jede Frage fünf KI-Suchen: ChatGPT, Gemini, Claude, Google AI Overviews und dem Google KI-Modus – jeweils mit Websuche, über die offiziellen Schnittstellen bzw. für Google über einen Datendienst. Im Bericht läuft jede Frage dreimal je KI-Suche. Der kostenlose Schnell-Check misst nur 8 Fragen ohne deinen Markennamen, jede einmal in Gemini und den beiden Google-Suchen (AI Overviews, KI-Modus), die Hälfte davon (4) auch in ChatGPT; er ist ein erster Eindruck, kein belastbares Ergebnis.'),
        p('In jeder Antwort erkennt Askmetry, welche Marken genannt und empfohlen werden und welche Seiten die KI als Quelle nutzt. Die KI-Sichtbarkeit (0–100) ist der Anteil der Antworten, in denen deine Marke vorkommt.'),
        p('Die Schnittstellen verhalten sich ähnlich, aber nicht genauso wie die Apps: Dort spielen Anmeldung, Verlauf und Standort der Nutzer mit hinein.'),
      ],
      hostedOnly: true,
      selfHosted: {
        answer: [
          p('Askmetry stellt jede Frage den KI-Suchen, die in deinem Workspace aktiv sind – ChatGPT, Gemini, Claude, Google AI Overviews und Google KI-Modus, optional Perplexity –, jeweils mit Websuche, über die offiziellen Schnittstellen bzw. für Google über einen Datendienst. Wie oft jede Frage je KI-Suche läuft, legst du in den Einstellungen über die Wiederholungen fest.'),
          p('In jeder Antwort erkennt Askmetry, welche Marken genannt und empfohlen werden und welche Seiten die KI als Quelle nutzt. Die KI-Sichtbarkeit (0–100) ist der Anteil der Antworten, in denen deine Marke vorkommt.'),
          p('Die Schnittstellen verhalten sich ähnlich, aber nicht genauso wie die Apps: Dort spielen Anmeldung, Verlauf und Standort der Nutzer mit hinein.'),
        ],
      },
    },
    {
      id: 'schwankungen',
      question: 'Warum schwanken die Ergebnisse?',
      answer: [
        p('KI-Modelle formulieren jede Antwort neu, die Websuche liefert je nach Zeitpunkt andere Seiten, und die Anbieter ändern Modelle und Quellen laufend. In einer SparkToro-Studie mit knapp 3.000 Durchläufen lieferten ChatGPT und Google AI seltener als in einem von 100 Fällen dieselbe Markenliste, dieselbe Reihenfolge nur etwa einmal in 1.000.'),
        p('Stabiler ist, wie oft eine Marke überhaupt vorkommt. Deshalb stellt Askmetry im Bericht jede Frage dreimal je KI-Suche (im Schnell-Check nur einmal) und zählt Anteile über viele Antworten, statt nur auf einen Listenplatz zu schauen.'),
        p('Kleine Unterschiede zwischen zwei Messungen können Zufall sein. Achte auf die Richtung über mehrere Messungen und auf ganze Gruppen von Fragen statt auf einzelne Antworten.'),
      ],
      sources: ['sparktoro-consistency', 'semrush-domains'],
      hostedOnly: true,
      selfHosted: {
        answer: [
          p('KI-Modelle formulieren jede Antwort neu, die Websuche liefert je nach Zeitpunkt andere Seiten, und die Anbieter ändern Modelle und Quellen laufend. In einer SparkToro-Studie mit knapp 3.000 Durchläufen lieferten ChatGPT und Google AI seltener als in einem von 100 Fällen dieselbe Markenliste, dieselbe Reihenfolge nur etwa einmal in 1.000.'),
          p('Stabiler ist, wie oft eine Marke überhaupt vorkommt. Stell deshalb jede Frage mehrmals (Wiederholungen in den Einstellungen) – Askmetry zählt Anteile über viele Antworten, statt nur auf einen Listenplatz zu schauen.'),
          p('Kleine Unterschiede zwischen zwei Messungen können Zufall sein. Achte auf die Richtung über mehrere Messungen und auf ganze Gruppen von Fragen statt auf einzelne Antworten.'),
        ],
      },
    },
    {
      id: 'wirkung',
      question: 'Wie schnell wirken Maßnahmen, und wann messe ich nach?',
      answer: [
        p('Genau vorhersagen lässt sich das nicht. Änderungen an deiner Website können die KI-Suchen aufgreifen, sobald Bing oder Google die Seite neu erfasst haben; Erwähnungen auf fremden Seiten brauchen länger, bis sie entstehen und gefunden werden. In das Trainingswissen der Modelle gelangen sie erst mit späteren Modellversionen.'),
        p('Askmetry erinnert dich acht Wochen nach einem Bericht an die Nachmessung. Das ist ein sinnvoller Abstand, damit Maßnahmen umgesetzt und erfasst werden können – aber keine Garantie, dass sie bis dahin schon wirken.'),
      ],
      hostedOnly: true,
      selfHosted: {
        answer: [
          p('Genau vorhersagen lässt sich das nicht. Änderungen an deiner Website können die KI-Suchen aufgreifen, sobald Bing oder Google die Seite neu erfasst haben; Erwähnungen auf fremden Seiten brauchen länger, bis sie entstehen und gefunden werden. In das Trainingswissen der Modelle gelangen sie erst mit späteren Modellversionen.'),
          p('Miss regelmäßig mit denselben Fragen, z. B. über einen Zeitplan in den Einstellungen, und vergleiche nach etwa acht Wochen. Das ist ein sinnvoller Abstand, damit Maßnahmen umgesetzt und erfasst werden können – aber keine Garantie, dass sie bis dahin schon wirken.'),
        ],
      },
    },
  ],
};

const en: Draft = {
  title: 'GEO quick guide',
  intro: 'The key questions about generative engine optimization (GEO): how AI search decides which brands to mention, what you can do about it – and how Askmetry measures.',
  caveat: 'Most figures come from vendors of SEO and AI tools, cover English-language questions (mostly in the US) and show correlations, not proven causes. There is no independent study for German-language questions yet – which is why Askmetry measures for itself.',
  updated: 'November 2026',
  entries: [
    {
      id: 'wie-entscheidet-ki',
      question: 'How is it decided what shows up in AI search?',
      answer: [
        p('An AI answer draws on two things: what the model learned in training and a web search it runs live for the question. Askmetry measures every AI engine with web search turned on, the way prospects use them.'),
        p('Which pages the AI finds depends on the search index behind it: in a sample by Seer Interactive, 87% of ChatGPT citations matched Bing’s top 20 results, but only 56% matched Google. Claude was shown to search via Brave. Google AI Overviews and AI Mode use the Google index and split a question into several sub-searches (“query fan-out”).'),
        p('From the pages it finds, the model picks which brands to mention – preferably ones that appear on many independent sites in the right context. No provider discloses exactly how this is weighted.'),
      ],
      sources: ['seer-bing', 'willison-brave', 'google-ai-features', 'ahrefs-mentions'],
    },
    {
      id: 'positionierung',
      question: 'How do I improve my positioning in general?',
      answer: [
        p('What helps most is when the AI reads the same thing about you in many places and can clearly place you in a category. The main levers:'),
        list(
          'One clear sentence – “brand + category + for whom” – worded the same on your home page, about page and every profile.',
          'Content for the questions where competitors are mentioned and you are not: comparisons, “alternatives to X” and honest “best X for Y” lists. In an Ahrefs study, 43.8% of the pages ChatGPT linked to were such lists.',
          'Answer first: the question as a heading, the answer in two or three sentences below it, then details with figures and sources. In the Princeton lab experiment, statistics, quotes and citations raised visibility by up to 40%.',
          'Mentions on other sites: review platforms, comparison sites, trade media and guides.',
        ),
        p('Think in months, not days, and measure again: no single action guarantees a mention.'),
      ],
      sources: ['ahrefs-lists', 'princeton-geo', 'ahrefs-mentions'],
    },
    {
      id: 'plattformen',
      question: 'What role do YouTube, Reddit and other platforms play?',
      answer: [
        p('A big one: in a Peec AI analysis of 30 million citations (US, March 2026), Reddit, YouTube, LinkedIn and Wikipedia came out on top. In Ahrefs’ data, mentions in YouTube videos were the factor most strongly linked to AI visibility (correlation of about 0.74).'),
        p('The shares swing a lot, though: according to Semrush, the share of ChatGPT answers citing Reddit fell from about 60% to about 10% within a few weeks in 2025. There are no independent figures for German-language questions, and in many niche markets in the DACH region Reddit is quiet.'),
        p('So get active where Askmetry actually measures the platform as a source for your questions: explainer videos on YouTube, expert posts on LinkedIn or open answers as a vendor in forums. Bought posts and sock-puppet accounts get found out and hurt the brand; Wikipedia’s notability rules rarely allow an article about your own company.'),
      ],
      sources: ['peec-domains', 'ahrefs-visibility', 'semrush-domains'],
    },
    {
      id: 'backlinks',
      question: 'What role do backlinks play?',
      answer: [
        p('A smaller one than many expect. In the Ahrefs study of 75,000 brands, mentions of the brand on the web were much more strongly linked to appearing in Google AI Overviews (0.66) than the number of backlinks (0.22) or domain strength (0.33).'),
        p('Links are not worthless, though: AI engines find pages through Bing and Google, where links still help rankings. What matters most is that your brand is mentioned and put in context on relevant sites – a bought link without context does little, while a mention in a comparison article can help even without a link.'),
        p('Both are correlations: well-known brands usually have lots of links and lots of mentions at the same time.'),
      ],
      sources: ['ahrefs-mentions', 'ahrefs-visibility'],
    },
    {
      id: 'google-ranking',
      question: 'Is ranking high on Google enough?',
      answer: [
        p('It helps, but it is not enough. According to Ahrefs data, only about 38% of citations in Google AI Overviews recently came from pages in Google’s top 10, down from about 76%. ChatGPT also leans more on Bing than on Google.'),
        p('Google itself says AI Overviews and AI Mode need no special optimization: a page must be indexed and eligible to be shown with a snippet. Good SEO remains the foundation; GEO adds mentions on other sites and content that answers questions directly.'),
      ],
      sources: ['sej-aio-top10', 'seer-bing', 'google-ai-features'],
    },
    {
      id: 'technik',
      question: 'What technical basics does my website need?',
      answer: [
        p('Only a few, but they are a must:'),
        list(
          'Don’t block AI crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot, Googlebot) – not even by accident in Cloudflare or your firewall. According to OpenAI, sites that block OAI-SearchBot are not shown in ChatGPT search answers.',
          'Serve important content as ready-made HTML: according to Vercel, the crawlers of OpenAI, Anthropic and Perplexity don’t run JavaScript.',
          'Register your site in Bing Webmaster Tools and submit new pages via IndexNow.',
        ),
        p('As things stand, llms.txt and extra schema markup are not levers: Google needs no new files or markup for its AI features, and 97% of the llms.txt files studied were never requested by an AI. Askmetry’s website check tests crawler blocks and text without JavaScript automatically.'),
      ],
      sources: ['openai-crawlers', 'vercel-crawlers', 'google-ai-features', 'llms-txt'],
    },
    {
      id: 'woher-fragen',
      question: 'Where do the questions Askmetry measures come from?',
      answer: [
        p('Askmetry reads your website’s home page and works out your brand, offer and competitors. An AI model then writes 20 questions the way prospects in your market would ask ChatGPT or Google: category questions (“best X for Y”), problem questions, comparisons between vendors, “alternative to …” and questions about costs.'),
        p('Your own brand appears in at most two questions, because the point is whether the AI mentions you on its own. For the strategy report, Askmetry generates 40 more questions, grouped by topic.'),
        p('The questions are a sample of typical customer questions, not a complete list: AI providers don’t disclose what users actually type.'),
      ],
      hostedOnly: true,
      selfHosted: {
        question: 'Which questions should I measure?',
        answer: [
          p('You add the questions yourself, on “Questions” or in the settings. Use questions the way prospects in your market would ask ChatGPT or Google: category questions (“best X for Y”), problem questions, comparisons between vendors, “alternative to …” and questions about costs.'),
          p('Your own brand should appear in only a few questions, because the point is whether the AI mentions you on its own. Your sales and support teams are good sources of real questions.'),
          p('The questions are a sample of typical customer questions, not a complete list: AI providers don’t disclose what users actually type.'),
        ],
      },
    },
    {
      id: 'fragen-anpassen',
      question: 'Can I change the questions?',
      answer: [
        p('Yes. On “Questions”, “Edit questions” takes you to the settings, where you can reword, add, deactivate and delete questions and assign topics. A new report measures the active questions up to its size (20 or 60).'),
        p('After your first finished report, the wording of existing questions is locked: the re-measurement asks exactly the same questions as the report before it – that is the only way to compare what your actions achieved. Newly added questions therefore only count in a new report, not in the re-measurement. While a report is measuring or a paid re-measurement is waiting to start, questions and competitors can’t be changed at all.'),
        p('Our advice: before your first report, replace questions nobody would ask with real ones from your sales and support teams.'),
      ],
      hostedOnly: true,
      selfHosted: {
        answer: [
          p('Yes. On “Questions”, “Edit questions” takes you to the settings, where you can reword, add, deactivate and delete questions and assign topics. Every measurement asks the active questions.'),
          p('Comparisons over time are only meaningful if the questions stay the same. So change the wording early and rarely after that – otherwise you can’t tell what your actions achieved and what is down to the new question.'),
          p('Our advice: replace questions nobody would ask with real ones from your sales and support teams.'),
        ],
      },
    },
    {
      id: 'messung',
      question: 'How does Askmetry measure?',
      answer: [
        p('Askmetry asks every question to five AI engines: ChatGPT, Gemini, Claude, Google AI Overviews and Google AI Mode – each with web search, via the official APIs or, for Google, a data provider. In a report, every question runs three times per engine. The free quick check measures only 8 questions without your brand name, each once in Gemini and both Google engines (AI Overviews, AI Mode), and half of them (4) in ChatGPT too; it gives a first impression, not a reliable result.'),
        p('In every answer, Askmetry detects which brands are mentioned and recommended and which pages the AI uses as sources. AI visibility (0–100) is the share of answers that mention your brand.'),
        p('The APIs behave similarly to the apps, but not identically: in the apps, the user’s login, history and location also play a part.'),
      ],
      hostedOnly: true,
      selfHosted: {
        answer: [
          p('Askmetry asks every question to the AI engines enabled in your workspace – ChatGPT, Gemini, Claude, Google AI Overviews and Google AI Mode, optionally Perplexity –, each with web search, via the official APIs or, for Google, a data provider. How often each question runs per engine is up to you: set the repetitions in the settings.'),
          p('In every answer, Askmetry detects which brands are mentioned and recommended and which pages the AI uses as sources. AI visibility (0–100) is the share of answers that mention your brand.'),
          p('The APIs behave similarly to the apps, but not identically: in the apps, the user’s login, history and location also play a part.'),
        ],
      },
    },
    {
      id: 'schwankungen',
      question: 'Why do the results fluctuate?',
      answer: [
        p('AI models write every answer from scratch, web search returns different pages at different times, and providers keep changing models and sources. In a SparkToro study with almost 3,000 runs, ChatGPT and Google AI returned the same list of brands less than once in 100 runs, and the same order only about once in 1,000.'),
        p('How often a brand appears at all is more stable. That is why, in a report, Askmetry asks every question three times per engine (only once in the quick check) and counts shares across many answers instead of relying on list positions alone.'),
        p('Small differences between two measurements can be chance. Look at the direction across several measurements and at whole groups of questions rather than single answers.'),
      ],
      sources: ['sparktoro-consistency', 'semrush-domains'],
      hostedOnly: true,
      selfHosted: {
        answer: [
          p('AI models write every answer from scratch, web search returns different pages at different times, and providers keep changing models and sources. In a SparkToro study with almost 3,000 runs, ChatGPT and Google AI returned the same list of brands less than once in 100 runs, and the same order only about once in 1,000.'),
          p('How often a brand appears at all is more stable. So ask every question several times (repetitions in the settings) – Askmetry counts shares across many answers instead of relying on list positions alone.'),
          p('Small differences between two measurements can be chance. Look at the direction across several measurements and at whole groups of questions rather than single answers.'),
        ],
      },
    },
    {
      id: 'wirkung',
      question: 'How fast do actions work, and when should I measure again?',
      answer: [
        p('There is no exact answer. AI engines can pick up changes to your website once Bing or Google have recrawled the page; mentions on other sites take longer to appear and be found. They only make it into a model’s training knowledge with later model versions.'),
        p('Askmetry reminds you to re-measure eight weeks after a report. That gives your actions time to be done and picked up – but it is no guarantee they will already have an effect by then.'),
      ],
      hostedOnly: true,
      selfHosted: {
        answer: [
          p('There is no exact answer. AI engines can pick up changes to your website once Bing or Google have recrawled the page; mentions on other sites take longer to appear and be found. They only make it into a model’s training knowledge with later model versions.'),
          p('Measure regularly with the same questions, for example with a schedule in the settings, and compare after about eight weeks. That gives your actions time to be done and picked up – but it is no guarantee they will already have an effect by then.'),
        ],
      },
    },
  ],
};

function build(lang: GuideLang, d: Draft, hosted = true): Guide {
  // Selbsthosting: Hosted-Einträge durch ihre neutrale Fassung ersetzen (ohne Fassung: weglassen)
  const entries = hosted ? d.entries : d.entries.flatMap((e): GuideEntry[] => {
    if (!e.hostedOnly) return [e];
    if (!e.selfHosted) return [];
    const { hostedOnly: _h, selfHosted, ...rest } = e;
    return [{ ...rest, question: selfHosted.question ?? e.question, answer: selfHosted.answer }];
  });
  d = { ...d, entries };
  // Quellen in der Reihenfolge der ersten Nennung, damit [1], [2], … beim Lesen aufsteigen
  const order: string[] = [];
  for (const e of d.entries) for (const s of e.sources ?? []) if (!order.includes(s)) order.push(s);
  const sources = order.map((id) => {
    const s = SRC.find((x) => x.id === id);
    if (!s) throw new Error(`Leitfaden: unbekannte Quelle ${id}`);
    return { id: s.id, label: s.label, date: s.date[lang], url: s.url };
  });
  return { lang, ...d, sources };
}

/** Kurzleitfaden GEO je Sprache, gehostete Fassung (App-Seite und PDF-Anhang). */
export const GEO_GUIDE: Record<GuideLang, Guide> = { de: build('de', de), en: build('en', en) };
/** Fassung für Selbsthoster: ohne Aussagen über Schnell-Check, Berichte, Sperren und Erinnerung. */
export const GEO_GUIDE_SELF_HOSTED: Record<GuideLang, Guide> = { de: build('de', de, false), en: build('en', en, false) };

/**
 * Leitfaden in der gewünschten Sprache (alles außer 'en' → Deutsch). `hosted` = gehostete Version (isHosted());
 * ohne Angabe die gehostete Fassung.
 */
export const geoGuide = (lang: string | null | undefined, opts: { hosted?: boolean } = {}): Guide =>
  (opts.hosted === false ? GEO_GUIDE_SELF_HOSTED : GEO_GUIDE)[lang === 'en' ? 'en' : 'de'];

/** Nummern ([1], [2], …) der Quellen eines Eintrags im Quellenverzeichnis des Leitfadens. */
export function sourceNumbers(guide: Guide, entry: GuideEntry): number[] {
  return (entry.sources ?? []).map((id) => guide.sources.findIndex((s) => s.id === id) + 1).filter((n) => n > 0);
}

/** Alle Quellen-IDs (für Tests). */
export const GUIDE_SOURCE_IDS = SRC.map((s) => s.id);
