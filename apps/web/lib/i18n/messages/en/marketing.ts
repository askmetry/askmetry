import { CHECK_SCOPE } from '@askmetry/core/hosted/config';
import type de from '../de/marketing';

const CHECK_Q = CHECK_SCOPE.measured;
const CHECK_Q_CHATGPT = Math.min(CHECK_SCOPE.measured, CHECK_SCOPE.engineMaxPrompts.chatgpt ?? CHECK_SCOPE.measured);

const marketing: typeof de = {
  meta: {
    title: 'Askmetry – Concrete actions for more visibility in ChatGPT, Gemini and Google AI',
    description:
      'Askmetry checks whether ChatGPT, Gemini and Google AI mention your company, who gets recommended instead of you – and derives concrete actions, sorted by impact. Free quick check by URL, one-off report instead of a subscription.',
    ogTitle: 'What you can do so ChatGPT and Google AI mention you more often',
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
    eyebrow: 'AI visibility · Concrete actions · No subscription',
    title: 'What you can do so ChatGPT and Google AI mention you more often.',
    sub: 'Askmetry checks whether AI search engines like ChatGPT, Gemini and Google AI mention your company and whom they recommend instead. From that, you get concrete actions sorted by impact: which platforms you are missing from, which pages to add and what is missing technically.',
    priceLine: (from: string) => `Reports from ${from} excl. VAT, one-off. No subscription.`,
    points: ['Free quick check', 'No account, no email', 'Hosted in Germany'],
  },
  form: {
    label: 'Your website address',
    placeholder: 'your-company.com',
    submit: 'Check for free',
    submitting: 'Starting …',
    hint: 'Free, no account, no email. An agent works through its checklist for 2–3 minutes – you watch and see the result right away.',
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
    found: '9 actions found',
    topLabel: 'Most important first',
    insight: 'Create a listing on comparison-site-example.com – the AIs cite it in 24% of answers, and Nordwerk is not listed there.',
    engineNames: { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', google_aio: 'AI Overviews', google_ai_mode: 'AI Mode' },
  },
  measure: {
    title: "Not just measuring: you get actions you can carry out",
    sub: "Knowing that you're rarely mentioned doesn't help on its own. Askmetry derives from the measurement what you're missing – and what you can do about it.",
    kindsTitle: 'Typical actions',
    kinds: [
      { cat: 'external', title: 'Get onto the right platforms', text: 'Directories, comparison sites and trade media the AIs rely on – and where you are not listed yet.' },
      { cat: 'content', title: 'Missing pages and content', text: 'Comparison pages, answers to real customer questions, clear service pages an AI can cite.' },
      { cat: 'community', title: 'Reviews and mentions', text: 'Where reviews and recommendations count in your industry and how to get more of them.' },
      { cat: 'tech', title: 'Technical setup and structured data', text: 'Allow AI crawlers, add structured data (Schema.org) – written so you can hand it to your agency.' },
    ],
    basis: 'It is based on your measurement: which sources the AIs cite for your customer questions, who is listed there and what is missing on your website.',
    plan: 'In the strategy report, the most important actions come as a 30-day plan: what to do in which week.',
    card: {
      label: 'What an action looks like',
      rank: 'Action 1 of 9',
      cat: 'external',
      title: 'Create a listing on comparison-site-example.com',
      impactLabel: 'Impact',
      effortLabel: 'Effort',
      impact: 'High impact',
      effort: 'approx. 1 hr',
      whyTitle: 'Why',
      why: 'For questions like "Which building services provider in Hamburg would you recommend?", ChatGPT and Google AI cite this site in 24% of answers. Providers A and B have a profile there, Nordwerk does not.',
      stepsTitle: 'How to do it',
      steps: [
        'Create a company profile on comparison-site-example.com or claim the existing one',
        'Describe services, service area and contact the same way as on your website',
        'Ask three happy customers to leave a review there',
      ],
      promptTitle: 'Ready-made prompt for your AI assistant',
      prompt: 'Write a profile text for comparison-site-example.com for Nordwerk. Use the services listed on nordwerk-example.com …',
      goal: 'Goal: Nordwerk is listed where the AIs get their answers to these questions.',
    },
  },
  how: {
    title: 'How it works',
    sub: 'Enter your URL, watch the agent, see the result right away. Then decide whether you want the full report.',
    steps: [
      {
        title: 'Enter your URL – the agent checks',
        text: 'An agent reads your website, identifies your offering and competitors, drafts typical customer questions and asks ChatGPT, Gemini and Google (AI Overviews, AI Mode). You see live which item on its checklist it is working on.',
      },
      {
        title: 'See the result right away',
        text: 'After 2–3 minutes: your visibility score, how many improvement actions the agent found, and one of them as an example. No email, no account.',
      },
      {
        title: 'Carry out the actions',
        text: 'The report gives you every action with steps, effort and ready-made prompts, online and as a PDF by email. Do them yourself, with your AI assistant or your agency – and re-measure later to see what has changed.',
      },
    ],
    result: { score: 'AI visibility', found: '9 improvement actions found', example: 'e.g. create a listing on comparison-site-example.com' },
    plan: {
      title: '30-day plan in the strategy report',
      rows: [
        { when: 'Weeks 1–2', what: 'Platform listings and robots.txt' },
        { when: 'Weeks 3–6', what: 'Comparison and FAQ pages' },
        { when: 'Weeks 7–12', what: 'Reviews and mentions' },
      ],
    },
    checklist: ['Read the website', 'Identify offering and competitors', 'Draft customer questions', 'Ask the AI engines', 'Derive actions'],
    notes: {
      check: 'Free · approx. 2–3 minutes',
      result: 'No email · right in your browser',
      report: (from: string) => `Reports from ${from} excl. VAT, one-off`,
    },
  },
  get: {
    title: "What's in the report",
    sub: 'Not a pile of data, but a to-do list: where you stand, why – and what to do next.',
    items: [
      { title: 'Concrete actions, sorted by impact', text: 'Each with a reason from your measurement, steps, effort and a ready-made prompt for your AI assistant.' },
      { title: 'Where you stand, in one number', text: 'AI visibility from 0 to 100, per AI engine and compared with your competitors.' },
      { title: 'Who gets mentioned instead of you', text: 'For every question: which brands the AIs mention and recommend – with every answer in full.' },
      { title: 'Which sources the AIs rely on', text: 'The pages the answers are based on. Your competitors are often listed there, and you are not.' },
      { title: 'PDF by email', text: 'Ready to forward to your boss, team or agency. Everything stays available online.' },
    ],
    measures: 'What moves you forward',
    copyPrompt: 'Copy prompt',
    cats: { content: 'Your content', external: 'Other websites', community: 'Community', tech: 'Technical' },
    recs: [
      { cat: 'external', title: 'Create a listing on comparison-site-example.com', meta: 'High impact · approx. 1 hr' },
      { cat: 'tech', title: 'Allow AI search crawlers in robots.txt', meta: 'High impact · approx. 30 min' },
      { cat: 'content', title: 'Create a comparison page "Nordwerk or Provider A?"', meta: 'Medium impact · approx. 3 hrs' },
    ],
  },
  pricing: {
    title: 'Pricing',
    sub: 'Pay once, no subscription. The quick check is free – decide afterwards.',
    beta: 'Beta price',
    instead: (list: string) => `regular price later ${list}`,
    net: 'excl. VAT, one-off',
    popular: 'Recommended',
    entry: 'To get started',
    cta: 'Start with the free check',
    ctaNote: 'You can buy right after the quick check.',
    compact: {
      name: 'Baseline report',
      for: 'The smaller entry point: where do you stand, and which actions help most?',
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
      for: 'Your complete roadmap: every action grouped by topic, plus a 30-day plan with the most important steps.',
      highlight: '30-day plan: what to do in which week',
      features: [
        '60 customer questions grouped by topic, each 3× in 5 AI engines (900 answers)',
        'Comparison with up to 5 competitors',
        'Sources per topic: where you should be present',
        'All actions with steps and ready-made prompts',
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
        a: "The quick check usually takes 2–3 minutes. You see which item on its checklist the agent is working on, and then the result right away – no email address needed. You start a report after reviewing the questions and competitors. As soon as it's ready – usually within a day, normally within 3 business days at most – we'll email you.",
      },
      {
        q: 'Which AIs are measured?',
        a: `In the report: ChatGPT, Claude, Gemini, Google AI Overviews and Google AI Mode. The free check asks Gemini and both Google variants ${CHECK_Q} questions and ChatGPT the first ${CHECK_Q_CHATGPT}, once each. Perplexity and Microsoft Copilot are not included yet.`,
      },
      {
        q: 'Is there a guarantee that I will be mentioned afterwards?',
        a: 'No – and nobody serious can. AIs put their answers together from scratch every time. We show you which actions are most likely to help based on your data, and the re-measurement shows whether they worked.',
      },
      {
        q: 'What exactly are the actions?',
        a: 'Concrete tasks that follow from your measurement: for example a listing on a site the AIs cite often, a missing comparison or FAQ page, structured data or more reviews. Every action comes with a reason, steps, an estimate of its impact, and a ready-made prompt. In the strategy report, the most important ones also come as a 30-day plan.',
      },
      {
        q: 'Do I need technical knowledge?',
        a: 'No. Every action comes with steps and a ready-made prompt you can paste into your AI assistant. Technical items are written so you can hand them to your web agency.',
      },
      {
        q: 'What happens to my data?',
        a: 'For the quick check, we store your website address, the generated questions and the AI answers; your email address only if you ask to be notified (stored with the check; deleted after 7 days if unconfirmed, or with the check after 90 days without a purchase if confirmed), create an account or buy. To limit free checks, we use a hash instead of your IP address and delete it after 7 days; server logs are deleted after 14 days. The AI providers receive the questions, brand and competitor names and content from your public website – not your name or email address. Details are in the privacy policy.',
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
        a: "To buy, you create an account with your email address and confirm that you're buying as a business. After payment, you review the questions and competitors and start the measurement. When the report is ready, you get it as a PDF by email and can view it online. After about 8 weeks, we'll remind you once about the re-measurement – one click to unsubscribe.",
      },
      {
        q: 'Can I run Askmetry myself?',
        a: 'Yes. Askmetry is open source (AGPL). With your own API keys you can run it on your own server and measure regularly. Instructions are on GitHub.',
      },
    ],
  },
  final: {
    title: 'Find out what you can improve.',
    sub: 'Enter your website. The agent checks it in 2–3 minutes – free, no email, with the result right in your browser.',
  },
  footer: {
    claim: 'Measure and improve AI visibility – honestly, once, without a subscription.',
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
