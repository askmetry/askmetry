// Bezahlung: Fehlermeldungen von buyReport und der Fake-Checkout (/kasse/<id>, nur Entwicklung).
const billing = {
  errors: {
    invalid: 'Das Formular ist unvollständig. Bitte lade die Seite neu und versuche es erneut.',
    b2bRequired: 'Bitte bestätige, dass du als Unternehmer kaufst (§ 14 BGB).',
    termsRequired: 'Bitte stimme den AGB zu.',
    unavailable: 'Der Kauf ist gerade nicht möglich. Bitte versuche es später erneut.',
    notFound: 'Dazu haben wir nichts gefunden. Bitte starte den Kauf erneut von der Ergebnisseite.',
    noPermission: 'Mit Leserechten kannst du in diesem Workspace nichts kaufen.',
    failed: 'Die Bezahlung konnte nicht gestartet werden. Bitte versuche es erneut.',
  },
  tier: { compact: 'Standortbestimmung', strategy: 'Strategiebericht' },
  kind: { initial: 'Bericht', remeasure: 'Nachmessung' },
  fake: {
    pageTitle: 'Testzahlung',
    banner: 'Testzahlung – kein echtes Geld',
    bannerText: 'Diese Seite gibt es nur in der Entwicklung. Es wird nichts abgebucht.',
    product: 'Produkt',
    net: 'Netto',
    vat: (pct: string) => `USt ${pct}`,
    gross: 'Gesamt (brutto)',
    pay: 'Testzahlung abschließen',
    cancel: 'Abbrechen',
    notPending: 'Diese Zahlung ist bereits abgeschlossen oder abgebrochen.',
    toReport: 'Zum Bericht',
  },
};
export default billing;
