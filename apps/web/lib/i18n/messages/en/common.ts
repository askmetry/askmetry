import type de from '../de/common';

const common: typeof de = {
  appDescription: 'Measure how visible your brand is in AI search engines',
  nav: {
    overview: 'Overview',
    recs: 'Actions',
    questions: 'Questions',
    analysis: 'Analysis',
    sources: 'Sources',
    settings: 'Settings',
  },
  account: {
    menu: 'Account',
    workspaces: 'Workspaces',
    switchWorkspace: 'Switch workspace',
    signOut: 'Sign out',
    readOnly: 'Read only',
  },
  language: {
    label: 'Language',
    switchTo: 'Change language',
  },
  notFound: {
    title: 'Page not found',
    text: 'This page doesn’t exist, or you don’t have access to it.',
    back: 'Go to my workspaces',
  },
  collectionStatus: {
    queued: 'queued', running: 'running', done: 'completed', failed: 'failed', budget_exceeded: 'budget reached',
  },
  trigger: { scheduled: 'scheduled', manual: 'manual', import: 'import' },
  batchWaiting: (n: number) =>
    `${n} Claude ${n === 1 ? 'query is' : 'queries are'} still waiting for results (lower-cost batch processing) – usually within an hour, at the latest after 24 hours.`,
  noPermission: 'No permission: read-only access doesn’t allow changes.',
  saving: '…',
};
export default common;
