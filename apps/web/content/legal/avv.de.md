<!--
ENTWURF – Stand 05.11.2026, Anlage zu den AGB (Fassung 2026-11-05). Nicht rechtsverbindlich geprüft; Freigabe durch Gründer/Anwalt erforderlich.

Prüf- bzw. Umsetzungspunkte:
1. TOMs (Anlage 1) beschreiben den Soll-Zustand laut Vorgabe. Vor Livegang tatsächlich prüfen/umsetzen:
   - Backups VERSCHLÜSSELT (heute ist im Repo keine Backup-Lösung konfiguriert – z. B. pg_dump + restic/age auf Hetzner Storage Box).
   - Datenbank-Port nicht öffentlich (docker-compose.yml: kein Host-Port – gut), SSH nur per Schlüssel, Firewall, Updates.
   - Verschlüsselung der Festplatten „at rest“ ist NICHT zugesagt (bei Hetzner-Cloud nicht standardmäßig) – bewusst weggelassen.
   - Zugriff: derzeit nur der Geschäftsführer – sobald weitere Personen Zugriff erhalten, Vertraulichkeitsverpflichtung einholen.
2. Meldefrist bei Datenschutzverletzungen: „unverzüglich, möglichst binnen 48 Stunden“ – Vorschlag.
3. Kontrollrechte: Vor-Ort-Prüfung nur nach Anmeldung mit 30 Tagen Vorlauf, Kosten trägt Kunde außer bei festgestellten Verstößen – Vorschlag; in AVV-Praxis üblich,
   aber manche Aufsichtsbehörden sehen Kostenabwälzung kritisch.
4. Unterauftragnehmer: allgemeine Genehmigung + Widerspruchsrecht mit 30 Tagen Vorlauf (Art. 28 Abs. 2 S. 2 DSGVO). Benachrichtigung per E-Mail an Kontoinhaber
   muss organisatorisch sichergestellt werden.
5. Cloudflare: Falls der Cloudflare-Proxy (nicht nur DNS) aktiv ist, läuft der gesamte Datenverkehr inkl. Kundeneingaben über Cloudflare → dann
   ist Cloudflare Unterauftragsverarbeiter für alle Daten. In der Liste so vermerkt – Konfiguration prüfen.
6. Rolle: lindotech ist Auftragsverarbeiter NUR für vom Kunden eingegebene personenbezogene Daten in Fragen/Marken-/Wettbewerberangaben und deren
   Messergebnisse. Für Konto-, Rechnungs- und Kommunikationsdaten ist lindotech selbst Verantwortlicher (Datenschutzerklärung).
   Abgrenzung bei Inhalten öffentlicher Websites, die der Crawler liest: als eigene Verarbeitung von lindotech behandelt – prüfen.
-->

# Auftragsverarbeitungsvertrag (AVV)

Anlage zu den Allgemeinen Geschäftsbedingungen von Askmetry · Stand: 5. November 2026

zwischen dem **Kunden** („Verantwortlicher“) und der **lindotech GmbH**, Eppendorfer Weg 151, 20253 Hamburg („Auftragsverarbeiter“, „wir“).

Dieser Vertrag konkretisiert die Pflichten nach Art. 28 DSGVO. Er wird mit der Annahme der AGB geschlossen und gilt, soweit wir im Rahmen von Askmetry personenbezogene Daten im Auftrag des Kunden verarbeiten. Bei Widersprüchen geht dieser AVV den AGB vor, soweit es um den Schutz personenbezogener Daten geht.

## 1. Gegenstand, Art und Zweck

1. **Gegenstand:** Durchführung von Messungen zur Sichtbarkeit von Marken in KI-Diensten und Erstellung von Berichten nach den AGB.
2. **Art der Verarbeitung:** Speichern, Übermitteln an KI-Dienste, Auswerten, Darstellen im Bericht, Versenden des Berichts, Löschen.
3. **Zweck:** ausschließlich die Erbringung der vom Kunden gekauften Leistungen.
4. Dieser AVV betrifft nur personenbezogene Daten, die der Kunde selbst eingibt – vor allem in **Fragen, Marken- und Wettbewerberangaben** – sowie Messergebnisse, die solche Daten enthalten. Für Konto-, Rechnungs- und Kommunikationsdaten des Kunden sind wir selbst verantwortlich; dafür gilt unsere Datenschutzerklärung.

## 2. Art der Daten und betroffene Personen

1. **Datenarten:** Namen und Bezeichnungen von Personen (z. B. Inhaber, Ärztinnen, Berater, Ansprechpartner), personenbezogene Marken- oder Firmennamen, Angaben zur beruflichen Tätigkeit, sonstige Angaben, die der Kunde in Fragen oder Beschreibungen einträgt, sowie KI-Antworten und Quellen, die sich darauf beziehen.
2. **Betroffene:** Personen, die der Kunde in seinen Eingaben nennt, z. B. Inhaber und Mitarbeitende des Kunden, Personen hinter Wettbewerbern, bekannte Personen der Branche.
3. Besondere Kategorien personenbezogener Daten (Art. 9 DSGVO) darf der Kunde nicht eingeben.

## 3. Dauer

Der AVV gilt, solange wir Daten im Auftrag des Kunden verarbeiten, längstens bis zur Löschung nach Ziffer 9.

## 4. Weisungen

1. Wir verarbeiten die Daten nur auf dokumentierte Weisung des Kunden. Die Weisungen ergeben sich abschließend aus den AGB, diesem AVV und der Nutzung der Funktionen von Askmetry (z. B. Fragen anlegen, Messung starten, Daten löschen). Weitere Weisungen erteilt der Kunde in Textform.
2. Sind wir der Ansicht, dass eine Weisung gegen Datenschutzrecht verstößt, teilen wir dies unverzüglich mit und dürfen die Ausführung bis zur Klärung aussetzen.
3. Eine Verarbeitung ohne Weisung erfolgt nur, wenn wir nach Unionsrecht oder dem Recht eines Mitgliedstaats dazu verpflichtet sind; darüber informieren wir den Kunden vorher, sofern das Recht dies nicht verbietet.

## 5. Pflichten des Auftragsverarbeiters

1. Personen, die bei uns Zugriff auf die Daten haben, sind zur Vertraulichkeit verpflichtet.
2. Wir treffen die technischen und organisatorischen Maßnahmen nach Art. 32 DSGVO, die in **Anlage 1** beschrieben sind. Wir dürfen sie weiterentwickeln, solange das Schutzniveau nicht sinkt.
3. Wir unterstützen den Kunden mit geeigneten Maßnahmen bei der Beantwortung von Anträgen betroffener Personen (Art. 12–22 DSGVO). Wenden sich Betroffene direkt an uns, leiten wir die Anfrage an den Kunden weiter.
4. Wir unterstützen den Kunden bei seinen Pflichten nach Art. 32–36 DSGVO (Sicherheit, Meldung von Verletzungen, Datenschutz-Folgenabschätzung, Konsultation), soweit es unsere Verarbeitung betrifft.
5. Verletzungen des Schutzes personenbezogener Daten melden wir dem Kunden **unverzüglich, möglichst innerhalb von 48 Stunden** nach Kenntnis, mit den Angaben nach Art. 33 Abs. 3 DSGVO, soweit verfügbar.
6. Die Verarbeitung findet auf Servern in Deutschland statt. Übermittlungen in Drittländer erfolgen nur über die Unterauftragnehmer nach Ziffer 7 und nur unter den Voraussetzungen der Art. 44 ff. DSGVO.

## 6. Pflichten des Kunden

1. Der Kunde ist für die Rechtmäßigkeit der Verarbeitung der von ihm eingegebenen Daten verantwortlich, einschließlich der Information der Betroffenen.
2. Der Kunde gibt nur personenbezogene Daten ein, die für die Messung erforderlich sind. Er weiß, dass Eingaben zur Messung an KI-Dienste übermittelt werden (Ziffer 7).
3. Der Kunde informiert uns unverzüglich, wenn er Fehler oder Unregelmäßigkeiten bei der Verarbeitung feststellt.

## 7. Unterauftragnehmer

1. Der Kunde erteilt die **allgemeine Genehmigung**, Unterauftragnehmer einzusetzen. Die bei Vertragsschluss eingesetzten Unterauftragnehmer stehen in der [Liste der Unterauftragnehmer](/unterauftragnehmer); sie gelten als genehmigt.
2. Wir informieren den Kunden per E-Mail mindestens **30 Tage** vorher über das Hinzuziehen oder Ersetzen eines Unterauftragnehmers. Der Kunde kann innerhalb dieser Frist aus wichtigem datenschutzrechtlichem Grund widersprechen. Können wir keine Lösung anbieten, darf der Kunde das Konto kündigen; noch nicht gestartete Berichte erstatten wir.
3. Wir verpflichten Unterauftragnehmer vertraglich auf Datenschutzpflichten, die denen dieses AVV im Wesentlichen entsprechen. Bei Unterauftragnehmern in Drittländern stellen wir ein angemessenes Schutzniveau sicher, etwa durch das EU-US Data Privacy Framework oder EU-Standardvertragsklauseln.
4. Keine Unterauftragsverhältnisse im Sinne dieser Ziffer sind Nebenleistungen ohne Zugriff auf Kundendaten, z. B. Telekommunikation oder Benachrichtigungen an uns ohne personenbezogene Daten.

## 8. Nachweise und Kontrollen

1. Wir stellen dem Kunden auf Anfrage die Informationen zur Verfügung, die zum Nachweis der Einhaltung dieses AVV nötig sind, z. B. eine aktuelle Beschreibung der TOMs und Nachweise unserer Unterauftragnehmer (Zertifikate, Prüfberichte).
2. Reichen diese Informationen nicht aus, kann der Kunde eine Prüfung durchführen oder durch einen zur Verschwiegenheit verpflichteten Prüfer durchführen lassen, der nicht im Wettbewerb zu uns steht. Vor-Ort-Prüfungen sind mit mindestens **30 Tagen** Vorlauf anzumelden, finden während der Geschäftszeiten statt und dürfen den Betrieb nicht unangemessen stören. Der Kunde trägt seine eigenen Kosten; unseren Aufwand kann er uns angemessen vergüten müssen, es sei denn, die Prüfung deckt einen Verstoß gegen diesen AVV auf.
3. Prüfrechte von Aufsichtsbehörden bleiben unberührt.

## 9. Löschung und Rückgabe

1. Der Kunde kann seine Eingaben, Arbeitsbereiche und Berichte jederzeit im Konto bearbeiten bzw. löschen oder uns um Löschung bitten. Fertige Berichte kann er als PDF herunterladen.
2. Nach Ende der Leistungen – spätestens mit Löschung des Kontos – löschen wir die im Auftrag verarbeiteten Daten innerhalb von **30 Tagen**, aus Backups spätestens nach weiteren **30 Tagen** durch deren Rotation, soweit keine gesetzliche Pflicht zur Aufbewahrung besteht. Auf Wunsch bestätigen wir die Löschung in Textform.
3. Bei KI-Diensten werden übermittelte Daten nach deren Vertragsbedingungen gelöscht (in der Regel nach kurzer Speicherung zur Missbrauchserkennung); Einzelheiten nennt die Liste der Unterauftragnehmer.

## 10. Haftung und Schlussbestimmungen

1. Für die Haftung gilt Art. 82 DSGVO. Im Übrigen gelten die Haftungsregeln der AGB.
2. Ist eine Bestimmung unwirksam, bleibt der AVV im Übrigen wirksam. Es gelten deutsches Recht und der Gerichtsstand nach den AGB.

---

## Anlage 1: Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

**Vertraulichkeit**

- **Hosting in Deutschland:** Server bei Hetzner Online GmbH in Rechenzentren in Deutschland; physischer Zutrittsschutz durch Hetzner (zertifiziert nach ISO/IEC 27001).
- **Zugriffsbeschränkung:** Administrativer Zugriff auf Server und Datenbank nur für namentlich bestimmte Personen der lindotech GmbH, SSH nur mit Schlüssel, Datenbank nicht aus dem Internet erreichbar.
- **Mandantentrennung:** Alle Kundendaten sind einem Arbeitsbereich zugeordnet; jeder Zugriff wird in der Anwendung gegen die Mitgliedschaft im Arbeitsbereich geprüft.
- **Passwörter** von Nutzern werden nur als sicherer Hashwert gespeichert; Bestätigungscodes nur als Hash; IP-Adressen beim Gratis-Check nur als Hash.
- **Geheimnisse** (API-Schlüssel) liegen nur in der Serverkonfiguration, nicht im Quellcode.

**Integrität**

- **Verschlüsselung in Transit:** Alle Verbindungen zur Website und zu Dienstleistern laufen über TLS.
- Zahlungsbestätigungen werden nur über signierte Nachrichten (Webhook-Signatur) des Zahlungsdienstleisters angenommen.
- Keine personenbezogenen Daten in Betriebsmeldungen an uns.

**Verfügbarkeit und Belastbarkeit**

- Regelmäßige **verschlüsselte Backups** der Datenbank, getrennt vom Produktivsystem gespeichert, Aufbewahrung 30 Tage.
- Kosten- und Missbrauchsgrenzen sowie Ratenbegrenzung schützen vor Überlastung.
- Zeitnahe Sicherheitsupdates von Betriebssystem und Abhängigkeiten.

**Verfahren zur regelmäßigen Überprüfung**

- Der Quellcode ist öffentlich (Open Source) und wird mit automatisierten Tests geprüft.
- Überprüfung dieser Maßnahmen mindestens einmal jährlich und bei wesentlichen Änderungen.
- Datensparsamkeit: Löschfristen nach der Datenschutzerklärung; Eingaben nur so weit an KI-Dienste, wie für die Messung nötig.
