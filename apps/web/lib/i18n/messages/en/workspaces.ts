import type de from '../de/workspaces';

const workspaces: typeof de = {
  metaTitle: 'Workspaces',
  title: 'Your workspaces',
  intro: 'A workspace brings together a brand, its competitors and the questions we ask the AI engines.',
  empty: 'You’re not in any workspace yet. Create your first one on the right.',
  roles: { owner: 'Owner', admin: 'Admin', viewer: 'Read only' },
  new: 'New workspace',
  form: {
    name: 'Workspace name',
    namePlaceholder: 'e.g. Paylindo Marketing',
    brand: 'Your brand',
    brandPlaceholder: 'e.g. Paylindo',
    domains: 'Brand domains',
    domainsPlaceholder: 'paylindo.com, paylindo.de',
    domainsHint: 'Separate several with commas. Subdomains are counted automatically.',
    creating: 'Creating …',
    create: 'Create workspace',
  },
  errors: {
    name: 'Please enter a name for the workspace.',
    brand: 'Please enter your brand’s name.',
  },
};
export default workspaces;
