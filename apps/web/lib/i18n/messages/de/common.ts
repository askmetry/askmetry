// Gemeinsame Begriffe (Navigation, Konto, Sprachumschalter, Status). Fachbegriffe siehe DESIGN.md „Begriffe“.
const common = {
  appDescription: 'Sichtbarkeit deiner Marke in KI-Suchmaschinen messen',
  nav: {
    overview: 'Übersicht',
    recs: 'Maßnahmen',
    questions: 'Fragen',
    analysis: 'Analyse',
    sources: 'Quellen',
    settings: 'Einstellungen',
  },
  account: {
    menu: 'Konto',
    workspaces: 'Workspaces',
    switchWorkspace: 'Workspace wechseln',
    signOut: 'Abmelden',
    readOnly: 'Nur lesen',
  },
  language: {
    label: 'Sprache',
    switchTo: 'Sprache wechseln',
  },
  notFound: {
    title: 'Seite nicht gefunden',
    text: 'Diese Seite gibt es nicht oder du hast keinen Zugriff darauf.',
    back: 'Zu meinen Workspaces',
  },
  collectionStatus: {
    queued: 'in Warteschlange', running: 'läuft', done: 'abgeschlossen', failed: 'fehlgeschlagen', budget_exceeded: 'Budget erreicht',
  } as Record<string, string>,
  trigger: { scheduled: 'geplant', manual: 'manuell', import: 'Import' } as Record<string, string>,
  noPermission: 'Keine Berechtigung: Leserechte erlauben keine Änderungen.',
  saving: '…',
};
export default common;
