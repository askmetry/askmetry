import type de from '../de/billing';

const billing: typeof de = {
  errors: {
    invalid: 'The form is incomplete. Please reload the page and try again.',
    b2bRequired: 'Please confirm that you are buying as a business.',
    termsRequired: 'Please accept the terms and conditions.',
    unavailable: 'Purchasing is not possible right now. Please try again later.',
    notFound: 'We could not find that. Please start the purchase again from the results page.',
    noPermission: 'With read-only access you cannot buy anything in this workspace.',
    failed: 'The payment could not be started. Please try again.',
  },
  tier: { compact: 'Visibility snapshot', strategy: 'Strategy report' },
  kind: { initial: 'Report', remeasure: 'Re-measurement' },
  fake: {
    pageTitle: 'Test payment',
    banner: 'Test payment – no real money',
    bannerText: 'This page only exists in development. Nothing will be charged.',
    product: 'Product',
    net: 'Net',
    vat: (pct: string) => `VAT ${pct}`,
    gross: 'Total (gross)',
    pay: 'Complete test payment',
    cancel: 'Cancel',
    notPending: 'This payment has already been completed or canceled.',
    toReport: 'Go to report',
  },
};
export default billing;
