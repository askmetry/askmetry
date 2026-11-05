import type de from '../de/guide';

const guide: typeof de = {
  nav: 'Guide',
  metaTitle: 'GEO quick guide',
  publicMetaTitle: 'GEO guide: how ChatGPT and Google AI decide which brands to mention | Askmetry',
  publicDescription: 'Short, sourced answers about generative engine optimization: how AI search picks its sources, what role YouTube, Reddit and backlinks play, and what you can do.',
  updated: (date: string) => `As of ${date}`,
  entrySources: 'Sources:',
  sourcesTitle: 'Sources',
  caveatTitle: 'About the figures',
  footerLink: 'GEO guide',
  whereQuestions: 'Where do the questions come from?',
  whereQuestionsSelf: 'Which questions should I measure?',
  cta: {
    title: 'How often do AI engines mention you?',
    text: 'The free quick check shows you in a few minutes.',
    button: 'Start quick check',
  },
};
export default guide;
