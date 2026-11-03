// Texte für die Workspace-Liste und „Neuer Workspace“. Englisch in ../en/workspaces.ts.
const workspaces = {
  metaTitle: 'Workspaces',
  title: 'Deine Workspaces',
  intro: 'Ein Workspace bündelt eine Marke, ihre Wettbewerber und die Fragen, die wir den KI-Suchen stellen.',
  empty: 'Du bist noch in keinem Workspace. Lege rechts deinen ersten an.',
  roles: { owner: 'Inhaber', admin: 'Admin', viewer: 'Nur lesen' } as Record<string, string>,
  new: 'Neuer Workspace',
  form: {
    name: 'Name des Workspaces',
    namePlaceholder: 'z. B. Paylindo Marketing',
    brand: 'Eigene Marke',
    brandPlaceholder: 'z. B. Paylindo',
    domains: 'Domains der Marke',
    domainsPlaceholder: 'paylindo.de, paylindo.com',
    domainsHint: 'Mehrere mit Komma trennen. Subdomains werden automatisch mitgezählt.',
    creating: 'Wird angelegt …',
    create: 'Workspace anlegen',
  },
  errors: {
    name: 'Bitte gib einen Namen für den Workspace ein.',
    brand: 'Bitte gib den Namen deiner Marke ein.',
  },
};
export default workspaces;
