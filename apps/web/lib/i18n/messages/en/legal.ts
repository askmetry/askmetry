import type de from '../de/legal';

const legal: typeof de = {
  titles: {
    impressum: 'Legal notice',
    datenschutz: 'Privacy policy',
    agb: 'Terms and conditions',
    avv: 'Data processing agreement',
    unterauftragnehmer: 'Sub-processors',
  },
  descriptions: {
    impressum: 'Legal notice (Impressum) of lindotech GmbH for Askmetry.',
    datenschutz: 'How Askmetry processes personal data.',
    agb: 'Terms and conditions for Askmetry reports (businesses only).',
    avv: 'Data processing agreement under Art. 28 GDPR for Askmetry.',
    unterauftragnehmer: 'List of sub-processors used by Askmetry.',
  },
  toc: 'Contents',
  placeholder: 'Coming soon.',
  placeholderText: "We're finishing this text. If you have questions, you can reach us using the details in the legal notice.",
  germanOnly: 'This document is only available in German. The German version is binding.',
  back: 'Back to home',
};
export default legal;
