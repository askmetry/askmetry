import type de from '../de/marketing';

const marketing: typeof de = {
  meta: {
    title: 'Askmetry – How visible are you in ChatGPT, Gemini and Google AI?',
    description:
      'A one-off report instead of a subscription: Askmetry measures whether ChatGPT, Claude, Gemini and Google AI mention your company, who gets recommended instead of you, and what to do about it. Free quick check by URL.',
    ogTitle: 'Where do you stand in ChatGPT, Claude, Gemini and Google AI?',
  },
  nav: {
    label: 'Main navigation',
    how: 'How it works',
    pricing: 'Pricing',
    faq: 'FAQ',
    signIn: 'Sign in',
    myReports: 'My reports',
    skip: 'Skip to content',
    home: 'Askmetry – home',
  },
  hero: {
    eyebrow: 'AI visibility · a report, not a subscription',
    title: 'Where do you stand in ChatGPT, Claude, Gemini and Google AI?',
    sub: 'Askmetry asks five AI search engines the kind of questions your customers ask. You see whether you get mentioned, who gets recommended instead of you – and what you can actually do about it.',
    priceLine: (from: string) => `Reports from ${from} excl. VAT, one-off. No subscription.`,
    points: ['Free quick check', 'No account needed', 'Hosted in Germany'],
  },
  form: {
    label: 'Your website address',
    placeholder: 'your-company.com',
    submit: 'Check for free',
    submitting: 'Starting …',
    hint: 'Free, no account needed. To see the result, you just confirm your email address.',
    errors: {
      empty: 'Please enter your website address, e.g. your-company.com.',
      invalid_url: "That doesn't look like a website address. Try something like your-company.com.",
      unreachable: "We couldn't load this website. Is the address correct?",
      rate_limited: 'Several checks have already been started from your connection today. Please try again tomorrow.',
      disabled: "We can't start new free checks right now. Please try again later.",
      generic: "That didn't work just now. Please try again in a few minutes.",
    },
  },
  preview: {
    badge: 'Example · fictional brand',
    brand: 'Nordwerk',
    measured: 'Baseline report · 300 answers',
    score: 'AI visibility',
    verdict: 'Rarely visible',
    sentence: 'Mentioned in 36 of 300 answers – Provider A in 186.',
    engines: 'By AI engine',
    ranking: 'Who leads in AI search',
    you: 'You',
    competitor: (letter: string) => `Provider ${letter}`,
    insight: 'AIs cite comparison-site-example.com in 24% of answers – Nordwerk is not listed there.',
    engineNames: { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', google_aio: 'AI Overviews', google_ai_mode: 'AI Mode' },
  },
  how: {
    title: 'How it works',
    sub: 'Measure once, act on it, measure again later. No subscription, no expertise needed.',
    steps: [
      {
        title: 'Enter your website',
        text: 'Askmetry reads your website, identifies your offering and competitors, and drafts typical customer questions. The quick check asks Gemini and Google (AI Overviews, AI Mode) 10 of them and ChatGPT 5 – free of charge.',
      },
      {
        title: 'Choose a report',
        text: 'You review the questions and competitors, then we measure: every question three times in five AI search engines. You get the report online and as a PDF by email.',
      },
      {
        title: 'Act and re-measure',
        text: 'Work through the actions – yourself, with your AI assistant or your agency. After 2–3 months, a re-measurement with the same questions shows what has changed.',
      },
    ],
    notes: {
      check: 'Free · usually a few minutes',
      report: (from: string) => `from ${from} excl. VAT, one-off`,
      remeasure: (from: string) => `Re-measurement from ${from} excl. VAT`,
    },
  },
  get: {
    title: 'What you get',
    sub: 'Not a pile of data, but a clear answer: where you stand, why – and what to do next.',
    items: [
      { title: 'Where you stand, in one number', text: 'AI visibility from 0 to 100, per AI engine and compared with your competitors.' },
      { title: 'Who gets mentioned instead of you', text: 'For every question: which brands the AIs mention and recommend – with every answer in full.' },
      { title: 'Which sources the AIs rely on', text: 'The pages the answers are based on. Your competitors are often listed there, and you are not.' },
      { title: 'Concrete actions', text: 'Sorted by expected impact, each with steps, effort and a ready-made prompt for your AI assistant.' },
      { title: 'PDF by email', text: 'Ready to forward to your boss, team or agency. Everything stays available online.' },
    ],
    measures: 'What moves you forward',
    copyPrompt: 'Copy prompt',
    cats: { content: 'Your content', external: 'Other websites', community: 'Community', tech: 'Technical' },
    recs: [
      { cat: 'tech', title: 'Allow AI search crawlers in robots.txt', meta: 'High impact · approx. 30 min' },
      { cat: 'external', title: 'Request a listing on comparison-site-example.com', meta: 'High impact · approx. 1 hr' },
      { cat: 'content', title: 'Create a comparison page "Nordwerk or Provider A?"', meta: 'Medium impact · approx. 3 hrs' },
    ],
  },
  pricing: {
    title: 'Pricing',
    sub: 'Pay once, no subscription. The quick check is free – decide afterwards.',
    beta: 'Beta price',
    instead: (list: string) => `regular price later ${list}`,
    net: 'excl. VAT, one-off',
    popular: 'More depth',
    cta: 'Start with the free check',
    ctaNote: 'You can buy right after the quick check.',
    compact: {
      name: 'Baseline report',
      for: 'The honest overview: where do you stand, and what helps most?',
      features: [
        '20 customer questions, each 3× in 5 AI engines (300 answers)',
        'Comparison with up to 3 competitors',
        'All actions with steps and ready-made prompts',
        'The most important sources the AIs use',
        'PDF report by email',
      ],
    },
    strategy: {
      name: 'Strategy report',
      for: 'For teams with several offerings, topics or markets.',
      features: [
        '60 customer questions grouped by topic, each 3× in 5 AI engines (900 answers)',
        'Comparison with up to 5 competitors',
        'Sources per topic: where you should be present',
        '90-day plan with priorities',
        'Everything in the baseline report, PDF by email',
      ],
    },
    remeasure: {
      title: 'Re-measurement',
      text: (compact: string, strategy: string) =>
        `After 2–3 months: the same questions again, with a before-and-after comparison. ${compact} for the baseline report, ${strategy} for the strategy report. Not included in the price – you decide later.`,
    },
    compare: {
      title: 'For comparison',
      agency: 'GEO audit by an agency',
      agencyPrice: 'typically from around €1,500',
      tool: 'Tracking tool subscription',
      toolPrice: 'from around €95 a month – over €1,100 a year',
      source: 'Typical market prices, own research, as of 11/2026.',
      us: 'Askmetry: baseline report + re-measurement',
      usPrice: (sum: string) => `${sum} excl. VAT`,
      note: "Not equivalent: subscription tools measure continuously and pay off if you optimize every week. To get started, a solid measurement plus a re-measurement is enough for many.",
    },
    legal: 'All prices excl. VAT. Businesses only. Invoice with VAT shown (or a reverse-charge note).',
  },
  honest: {
    title: 'Measured honestly',
    sub: "AI answers aren't a ranking with fixed positions. We show what was actually measured – and where the limits are.",
    points: [
      {
        title: 'Real answers with live web search',
        text: 'We ask ChatGPT, Claude and Gemini through their official APIs with web search turned on. For Google AI Overviews and AI Mode, we evaluate the actual Google results page.',
      },
      {
        title: 'Asked repeatedly, variance shown',
        text: "The same question doesn't always get the same answer. That's why we ask every question three times per AI and tell you how many answers each number is based on.",
      },
      {
        title: 'The API is not the app',
        text: "API answers come close to what the app shows, but they aren't identical: history, location and personalization are missing. Treat the numbers as a solid trend, not a screenshot.",
      },
      {
        title: 'No guaranteed placements',
        text: 'Nobody can guarantee mentions in AI answers. We only recommend actions a small team can carry out and that are backed by your measurement and current studies.',
      },
    ],
    notYet: 'Not included yet: Perplexity and Microsoft Copilot.',
  },
  trust: {
    title: 'Hosted in Germany · open source',
    hosting: {
      title: 'Hosted in Germany',
      text: 'Askmetry runs on servers in Germany (Hetzner), operated by lindotech GmbH, Hamburg. To measure, the questions are sent to the AI providers, partly processed in the US. No tracking cookies, no advertising or analytics tools; Cloudflare Turnstile protects the free check against bots. A data processing agreement is available online.',
      avv: 'View the DPA',
    },
    oss: {
      title: 'Open source (AGPL)',
      text: 'The code is open. You can see exactly how we measure – or run Askmetry yourself with your own API keys, including ongoing measurements.',
      link: 'Code on GitHub',
    },
  },
  faq: {
    title: 'Frequently asked questions',
    items: [
      {
        q: 'How is this different from subscription tools?',
        a: "Tracking tools measure continuously and charge every month. That's worth it if you optimize every week. Askmetry is a one-off report: measure where you stand, act on it, re-measure after 2–3 months. For many companies that's enough, especially at the start.",
      },
      {
        q: 'How long does it take?',
        a: "The quick check is usually ready a few minutes after you confirm your email address. You start a report after reviewing the questions and competitors. As soon as it's ready – usually within a day, normally within 3 business days at most – we'll email you.",
      },
      {
        q: 'Which AIs are measured?',
        a: 'In the report: ChatGPT, Claude, Gemini, Google AI Overviews and Google AI Mode. The free check asks Gemini and both Google variants 10 questions and ChatGPT the first 5, once each. Perplexity and Microsoft Copilot are not included yet.',
      },
      {
        q: 'Is there a guarantee that I will be mentioned afterwards?',
        a: 'No – and nobody serious can. AIs put their answers together from scratch every time. We show you which actions are most likely to help based on your data, and the re-measurement shows whether they worked.',
      },
      {
        q: 'Do I need technical knowledge?',
        a: 'No. Every action comes with steps and a ready-made prompt you can paste into your AI assistant. Technical items are written so you can hand them to your web agency.',
      },
      {
        q: 'What happens to my data?',
        a: 'We store your website address, the generated questions, the AI answers and your email address. To limit free checks, we use a hash instead of your IP address and delete it after 7 days; server logs are deleted after 14 days. The AI providers receive the questions, brand and competitor names and content from your public website – not your name or email address. Details are in the privacy policy.',
      },
      {
        q: 'Will I get an invoice?',
        a: 'Yes, with VAT shown (or a reverse-charge note). Payment is handled by Stripe, where you can enter your VAT ID. All prices are net prices.',
      },
      {
        q: 'Why businesses only?',
        a: 'The report is meant for companies, freelancers and organizations that win customers through their website. So we only sell to businesses (as defined in § 14 BGB, German Civil Code). That keeps the process lean and the price low.',
      },
      {
        q: 'What happens after I buy?',
        a: "To buy, you create an account (the email address from the check is already filled in) and confirm that you're buying as a business. After payment, you review the questions and competitors and start the measurement. When the report is ready, you get it as a PDF by email and can view it online. After about 8 weeks, we'll remind you once about the re-measurement – one click to unsubscribe.",
      },
      {
        q: 'Can I run Askmetry myself?',
        a: 'Yes. Askmetry is open source (AGPL). With your own API keys you can run it on your own server and measure regularly. Instructions are on GitHub.',
      },
    ],
  },
  final: {
    title: 'Find out where you stand.',
    sub: 'Enter your website. The quick check is free and usually takes just a few minutes.',
  },
  footer: {
    claim: 'Measure AI visibility – honestly, once, without a subscription.',
    legalLabel: 'Legal',
    imprint: 'Legal notice',
    privacy: 'Privacy',
    terms: 'Terms',
    dpa: 'DPA',
    subprocessors: 'Sub-processors',
    github: 'GitHub',
    copyright: (year: number) => `© ${year} lindotech GmbH, Hamburg`,
  },
};
export default marketing;
