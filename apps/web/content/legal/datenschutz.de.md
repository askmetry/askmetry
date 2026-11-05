<!--
ENTWURF – Stand 05.11.2026. Nicht rechtsverbindlich geprüft; Freigabe durch Gründer/Anwalt erforderlich.
Interne Links (/agb, /avv, /unterauftragnehmer, /impressum, /datenschutz) sind angenommene Routen – an die echten Seiten anpassen.

Prüf- bzw. Umsetzungspunkte:
1. Löschfristen sind VORSCHLÄGE und müssen technisch umgesetzt werden (Worker-Job). Heute löscht der Code nichts automatisch:
   - check_request: E-Mail, ip_hash, verify_code_hash nach 90 Tagen ab Erstellung entfernen (bzw. Datensatz löschen);
     ip_hash zusätzlich schon nach 7 Tagen leeren; unbestätigte E-Mails nach 7 Tagen.
   - funnel_event (enthält user_id/check_id): nach 24 Monaten löschen oder Bezüge entfernen.
   - Server-Logs 14 Tage (Hetzner/Reverse-Proxy-Konfiguration prüfen); Backups: Rotation 30 Tage angenommen – prüfen.
   - Konto-Löschung: Funktion „Konto löschen“ bzw. Löschung auf Anfrage muss es geben.
2. Aufbewahrungsfrist Rechnungen: Seit BEG IV (ab 01.01.2025) gelten für Buchungsbelege/Rechnungen 8 Jahre (§ 147 Abs. 3 AO, § 257 Abs. 4 HGB),
   für Bücher/Jahresabschlüsse 10 Jahre. Text sagt „8 bzw. 10 Jahre“ – mit Steuerberater abstimmen.
3. Stripe: Für die eigentliche Zahlungsabwicklung, Betrugsprävention und regulatorische Pflichten tritt Stripe nach eigener Darstellung
   als eigenständiger Verantwortlicher auf; für Rechnungserstellung (Stripe Invoicing) eher als Auftragsverarbeiter. Hier so dargestellt – prüfen.
4. Cloudflare Turnstile: Liest/speichert Informationen im Endgerät (u. a. Browser-Signale). Wir stützen uns auf § 25 Abs. 2 Nr. 2 TDDDG
   (unbedingt erforderlich für den vom Nutzer gewünschten, missbrauchsgeschützten Gratis-Dienst). Das ist vertretbar, aber nicht unumstritten.
   Alternative: Einwilligung vor Laden des Widgets. Entscheidung nötig. Cloudflare-Entität: Cloudflare, Inc. (USA), DPF-zertifiziert (Stand Recherche, auf
   dataprivacyframework.gov gegenprüfen).
5. KI-Dienste: OpenAI Ireland Ltd und Anthropic Ireland, Limited sind laut deren Vertragsbedingungen Vertragspartner für EWR-Kunden;
   Unterverarbeitung in den USA durch die US-Muttergesellschaften (SCC laut DPA; DPF-Status von OpenAI OpCo/Anthropic PBC nicht verifiziert).
   Google (Gemini API, kostenpflichtig, mit Cloud-Billing): Vertragspartner für EWR vermutlich Google Cloud EMEA Ltd (Irland), Verarbeitung auch durch Google LLC
   (DPF-zertifiziert). Voraussetzung: kostenpflichtige Gemini-API (bei kostenlosem Kontingent nutzt Google Daten zur Produktverbesserung!). Bitte sicherstellen.
   DPAs mit allen Anbietern tatsächlich abschließen (OpenAI: DPA im Dashboard ausführen; Anthropic: in Commercial Terms enthalten; Google: Cloud DPA).
   Websuche: Die Anbieter können Suchbegriffe an eigene/fremde Suchdienste weitergeben – Details nicht recherchiert.
6. DataForSEO: Recherche ergab DataForSEO OÜ, Tallinn, Estland (Reg.-Nr. 14502291) mit Team/Adresse auch in Charkiw, Ukraine.
   Ob Daten in der Ukraine verarbeitet werden, ist unklar (Ukraine hat keinen Angemessenheitsbeschluss). DPA anfordern und Verarbeitungsorte erfragen.
   An DataForSEO gehen nur Suchfragen (Prompts), keine Kontaktdaten.
7. Erinnerungsmail § 7 Abs. 3 UWG: Der Hinweis auf das Widerspruchsrecht muss BEI ERHEBUNG der E-Mail-Adresse (Kauf/Checkout) und in jeder Mail erfolgen.
   Im Checkout-Formular einen kurzen Hinweis ergänzen. Ein Bericht ist ein „ähnliches“ Angebot zur Nachmessung – vertretbar.
8. Brevo: Sendinblue SAS, 106 boulevard Haussmann, 75008 Paris. Brevo kann Öffnungs-/Klick-Tracking setzen – für unsere Mails AUSSCHALTEN (sonst TDDDG-Thema).
9. Telegram-Benachrichtigungen an den Betreiber enthalten laut Vorgabe keine personenbezogenen Daten (E-Mail höchstens maskiert – maskierte E-Mail kann
   noch personenbezogen sein! Empfehlung: gar keine E-Mail-Bestandteile senden).
10. Datenschutzbeauftragter: bei < 20 Personen, die ständig personenbezogene Daten automatisiert verarbeiten, keine Pflicht (§ 38 BDSG) – angenommen.
11. Anschrift der Aufsichtsbehörde HmbBfDI: Ludwig-Erhard-Str. 22, 20459 Hamburg – vor Livegang auf datenschutz-hamburg.de prüfen.
-->

# Datenschutzerklärung

Stand: 5. November 2026

Diese Erklärung beschreibt, welche personenbezogenen Daten wir verarbeiten, wenn Sie askmetry.ai nutzen – den Gratis-Schnell-Check, ein Kundenkonto oder einen kostenpflichtigen Bericht.

## 1. Verantwortlicher

lindotech GmbH
c/o Max Fabian Uth
Eppendorfer Weg 151
20253 Hamburg, Deutschland
Geschäftsführer: Max Fabian Uth
E-Mail: [hallo@askmetry.ai](mailto:hallo@askmetry.ai)

Für alle Fragen zum Datenschutz und zur Ausübung Ihrer Rechte erreichen Sie uns unter dieser E-Mail-Adresse. Einen Datenschutzbeauftragten haben wir nicht bestellt, weil wir dazu gesetzlich nicht verpflichtet sind.

## 2. Das Wichtigste in Kürze

- Wir messen, wie Marken in KI-Antworten vorkommen. Dafür lesen wir **öffentliche Webseiten** und stellen **Fragen an KI-Dienste**. Ihre E-Mail-Adresse und Ihr Name gehen dabei **nicht** an die KI-Dienste.
- Wir setzen **keine Analyse-, Tracking- oder Werbe-Cookies** ein und versenden **keinen Newsletter**.
- Unsere Server stehen in **Deutschland** (Hetzner). Einige Dienstleister sitzen in den USA oder verarbeiten Daten dort; dafür gibt es die unten genannten Garantien.

## 3. Aufruf der Website und Server-Logs

Beim Aufruf von askmetry.ai verarbeitet unser Server technisch notwendige Daten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Statuscode, übertragene Datenmenge, Referrer-URL und Browserkennung (User-Agent).

- **Zweck:** Auslieferung der Website, Stabilität, Fehlersuche und Abwehr von Angriffen.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am sicheren und stabilen Betrieb).
- **Speicherdauer:** Server-Logs werden nach **14 Tagen** gelöscht. Einzelne Einträge bewahren wir länger auf, wenn sie zur Aufklärung eines konkreten Sicherheitsvorfalls nötig sind, bis dieser abgeschlossen ist.

## 4. Gratis-Schnell-Check

### 4.1 Website lesen und analysieren

Sie geben die Adresse einer Website ein. Unser eigener Crawler (Kennung „Askmetry-SiteCheck“) ruft daraufhin öffentlich zugängliche Seiten dieser Website ab, außerdem z. B. das Website-Icon und technische Dateien wie `robots.txt` und `sitemap.xml`. Daraus ermitteln wir per KI das Markenprofil, mögliche Wettbewerber und typische Kundenfragen. Diese Fragen stellen wir anschließend KI-Diensten (siehe Abschnitt 8) und werten die Antworten aus: Wird die Marke genannt, an welcher Stelle, welche Quellen werden zitiert?

Auf öffentlichen Webseiten können personenbezogene Daten stehen, etwa Namen im Impressum. Solche Angaben werten wir nicht gezielt aus; sie können aber in den abgerufenen Inhalten oder in KI-Antworten vorkommen.

- **Zweck:** Erstellung des von Ihnen angeforderten Schnell-Checks.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO (Erbringung des angefragten Gratis-Dienstes); soweit Daten Dritter auf öffentlichen Seiten betroffen sind, Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der Analyse öffentlich zugänglicher Informationen).
- **Wiederverwendung:** Das Ergebnis eines Checks verwenden wir für dieselbe Domain bis zu **30 Tage** wieder. Wer in dieser Zeit dieselbe Domain prüft, sieht dasselbe Ergebnis. Es enthält Angaben zur Marke und zu KI-Antworten, aber keine Kontaktdaten des ursprünglichen Anfragenden.

### 4.2 Optionale Benachrichtigung per E-Mail (Double-Opt-in)

Für den Schnell-Check brauchen wir keine E-Mail-Adresse: Das Ergebnis erscheint direkt auf der Seite des Checks. Während der Check läuft, können Sie freiwillig eine E-Mail-Adresse angeben, damit wir Ihnen Bescheid geben, sobald das Ergebnis fertig ist. Wir speichern die Adresse zum Check und senden Ihnen einen Bestätigungslink (24 Stunden gültig). Erst nach dem Klick schicken wir die Fertig-Mail mit dem Link zu Ihrem Ergebnis. Den Bestätigungscode speichern wir nur als Hashwert. Werbung senden wir an diese Adresse nicht.

- **Zweck:** Benachrichtigung, wenn das Ergebnis fertig ist; Nachweis, dass die Adresse Ihnen gehört; Schutz vor Missbrauch (Begrenzung je Adresse).
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO (von Ihnen gewünschte Benachrichtigung); für die Missbrauchsabwehr Art. 6 Abs. 1 lit. f DSGVO.
- **Speicherdauer:** Eine nicht bestätigte Adresse löschen wir nach **7 Tagen**. Eine bestätigte Adresse bleibt beim Check gespeichert, bis der Check gelöscht wird (**90 Tage** nach dem Check, wenn Sie keinen Bericht kaufen; siehe Abschnitt 4.5).

### 4.3 Missbrauchsschutz: IP-Hash und Begrenzungen

Wir begrenzen die Zahl der Checks je IP-Adresse pro Tag (und die Zahl der Benachrichtigungen je E-Mail-Adresse). Dazu speichern wir **nicht Ihre IP-Adresse**, sondern nur einen kryptografischen Hashwert davon (mit einem geheimen Schlüssel gebildet; bei IPv6-Adressen aus dem Netzpräfix, den ersten 64 Bit).

- **Zweck:** Verhinderung von Massenabfragen und Kostenmissbrauch.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. f DSGVO.
- **Speicherdauer:** Der IP-Hash wird nach **7 Tagen** gelöscht.

### 4.4 Bot-Schutz mit Cloudflare Turnstile

Beim Absenden der Website-Adresse und, falls Sie eine Benachrichtigung wünschen, beim Absenden der E-Mail-Adresse prüfen wir mit **Cloudflare Turnstile**, ob ein Mensch die Anfrage stellt. Turnstile verarbeitet dazu u. a. Ihre IP-Adresse und technische Merkmale Ihres Browsers und kann dafür Informationen in Ihrem Browser lesen oder speichern. Anbieter ist Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA.

- **Zweck:** Schutz des Gratis-Dienstes vor automatisierten Anfragen.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. f DSGVO; der Zugriff auf Ihr Endgerät ist nach § 25 Abs. 2 Nr. 2 TDDDG zulässig, weil er für den von Ihnen gewünschten, gegen Missbrauch geschützten Dienst unbedingt erforderlich ist.
- **Drittland:** USA, auf Grundlage des EU-US Data Privacy Framework (Angemessenheitsbeschluss der EU-Kommission vom 10.07.2023) sowie Standardvertragsklauseln.

### 4.5 Speicherdauer beim Schnell-Check

- Den IP-Hash löschen wir nach **7 Tagen**, eine nicht bestätigte E-Mail-Adresse (samt Bestätigungscode) ebenfalls nach **7 Tagen**.
- Ohne anschließenden Kauf löschen wir den Check **90 Tage** nach seiner Erstellung vollständig: Zugangslink, eine bestätigte E-Mail-Adresse und die Messergebnisse. Bis dahin können die Messergebnisse zur Marke (ohne Ihre Kontaktdaten) für den 30-Tage-Cache genutzt werden (Abschnitt 4.1).
- Kaufen Sie einen Bericht, wird der Check Teil Ihres Kundenkontos (Abschnitt 5).

## 5. Kundenkonto

Für einen Kauf legen Sie ein Konto an: E-Mail-Adresse, Name und Passwort. Das Passwort speichern wir nur als sicheren Hashwert. Zum Konto gehören Ihre Arbeitsbereiche mit Marken, Wettbewerbern, Fragen, Messergebnissen und Berichten.

- **Zweck:** Bereitstellung des Kontos und der gekauften Berichte.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO.
- **Speicherdauer:** Bis Sie das Konto löschen (oder uns um Löschung bitten). Danach löschen wir Konto, Arbeitsbereiche und Berichte innerhalb von **30 Tagen**; aus Backups verschwinden die Daten mit deren Rotation spätestens nach weiteren **30 Tagen**. Daten, die wir aufbewahren müssen (Abschnitt 6), sperren wir nur.

### Eigene Eingaben

Sie können eigene Fragen, Marken- und Wettbewerberangaben eingeben. Diese Inhalte senden wir an die KI-Dienste, um die Messung durchzuführen. Bitte geben Sie dort **keine personenbezogenen Daten** ein, wenn das für Ihre Messung nicht nötig ist. Tun Sie es doch, verarbeiten wir diese Daten in Ihrem Auftrag nach unserem [Auftragsverarbeitungsvertrag](/avv).

## 6. Kauf, Bezahlung und Rechnung

Beim Kauf werden Sie zu **Stripe Checkout** weitergeleitet. Stripe verarbeitet Ihre Zahlungsdaten (z. B. Kartendaten), Rechnungsadresse, Firmenname, ggf. USt-IdNr. und E-Mail-Adresse und erstellt die Rechnung. Wir erhalten von Stripe die Bestätigung der Zahlung, die Rechnungsangaben und Referenznummern, **nicht** Ihre vollständigen Karten- oder Kontodaten. Außerdem speichern wir, wann Sie bestätigt haben, als Unternehmer zu kaufen, und wann Sie welcher Fassung der AGB zugestimmt haben.

Anbieter: Stripe Payments Europe, Limited, 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, D02 H210, Irland. Für die Zahlungsabwicklung selbst, die Betrugsprävention und eigene gesetzliche Pflichten ist Stripe eigenständig verantwortlich; Details in der [Datenschutzerklärung von Stripe](https://stripe.com/de/privacy). Stripe kann Daten auch an Stripe, Inc. in den USA übermitteln (EU-US Data Privacy Framework, Standardvertragsklauseln).

- **Zweck:** Abwicklung des Kaufs, Rechnungsstellung, Buchhaltung.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO (Vertrag); Art. 6 Abs. 1 lit. c DSGVO (handels- und steuerrechtliche Aufbewahrungspflichten).
- **Speicherdauer:** Rechnungen und Buchungsbelege **8 Jahre**, Handelsbücher **10 Jahre** (§ 147 AO, § 257 HGB), jeweils ab Ende des Kalenderjahres.

## 7. E-Mails

Wir senden E-Mails nur, wenn sie zu Ihrem Check oder Kauf gehören: Bestätigungslink, „Ergebnis ist fertig“, Kontobestätigung und Passwort-Zurücksetzen, Bericht als PDF mit Link.

**Erinnerung an die Nachmessung:** Etwa 8 Wochen nach einem fertigen Bericht senden wir Ihnen **einmalig** eine Erinnerung, dass eine Nachmessung möglich ist. Das ist Werbung für ein ähnliches Angebot an Bestandskunden nach § 7 Abs. 3 UWG. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Direktwerbung). Sie können dem **jederzeit widersprechen** – über den Abmeldelink in jeder Mail oder per E-Mail an uns –, ohne dass dafür andere als die Übermittlungskosten nach den Basistarifen entstehen. Abgemeldete Adressen speichern wir in einer Sperrliste, damit wir Ihnen keine Erinnerung mehr schicken; diese Liste führen wir, solange das dafür nötig ist.

Für den Versand nutzen wir **Brevo** (Sendinblue SAS, 106 boulevard Haussmann, 75008 Paris, Frankreich) als Auftragsverarbeiter. Öffnungs- und Klickverfolgung setzen wir nicht ein.

## 8. KI-Dienste und Suchdaten

Für die Messung stellen wir Fragen an KI-Dienste und lassen Antworten auswerten. Übermittelt werden die Fragen, Marken- und Wettbewerbernamen, Domains sowie Inhalte der geprüften öffentlichen Website – **nicht** Ihr Name, Ihre E-Mail-Adresse oder Zahlungsdaten. Personenbezogene Daten gelangen nur dorthin, wenn sie in diesen Inhalten stehen (z. B. weil Sie sie selbst eingegeben haben).

| Dienst | Anbieter | Verarbeitung auch in |
|---|---|---|
| ChatGPT-API mit Websuche | OpenAI Ireland Ltd, Dublin, Irland | USA (OpenAI-Konzern) |
| Claude-API mit Websuche (auch für Auswertung, Profil und Maßnahmen) | Anthropic Ireland, Limited, Dublin, Irland | USA (Anthropic, PBC) |
| Gemini-API mit Google-Suche | Google (Google Cloud EMEA Ltd, Irland, bzw. Google LLC) | USA |
| Google-Ergebnisseiten inkl. AI Overviews und AI Mode | DataForSEO OÜ, Tallinn, Estland | siehe [Unterauftragnehmer](/unterauftragnehmer) |

Die Anbieter verarbeiten die Daten als unsere Auftragsverarbeiter und nutzen sie nach ihren Vertragsbedingungen nicht zum Training ihrer Modelle. Sie können Anfragen für eine begrenzte Zeit zur Missbrauchserkennung speichern.

- **Zweck:** Durchführung der Messung und Auswertung.
- **Rechtsgrundlage:** Art. 6 Abs. 1 lit. b DSGVO; für Daten Dritter auf öffentlichen Seiten Art. 6 Abs. 1 lit. f DSGVO.
- **Drittland:** Übermittlungen in die USA erfolgen auf Grundlage des EU-US Data Privacy Framework, soweit der Empfänger zertifiziert ist, im Übrigen auf Grundlage von Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO).

## 9. Hosting

Website, Datenbank und Messung laufen auf Servern der **Hetzner Online GmbH**, Industriestr. 25, 91710 Gunzenhausen, in Rechenzentren in Deutschland (Auftragsverarbeitung nach Art. 28 DSGVO). Die DNS-Auflösung der Domain läuft über Cloudflare.

## 10. Nutzungsstatistik ohne Tracking

Um zu verstehen, ob der Ablauf funktioniert, zählen wir Schritte wie „Check gestartet“, „E-Mail bestätigt“ oder „Bericht gekauft“ in unserer eigenen Datenbank. Diese Einträge verweisen intern auf den Check bzw. das Konto, enthalten aber keine E-Mail-Adresse und werden nicht mit Dritten geteilt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (Verbesserung unseres Angebots). Wir löschen sie oder entfernen den Personenbezug nach **24 Monaten**.

## 11. Cookies und Speicher im Browser

Wir verwenden nur technisch notwendige Cookies (§ 25 Abs. 2 Nr. 2 TDDDG); eine Einwilligung ist dafür nicht erforderlich:

| Cookie | Zweck | Dauer |
|---|---|---|
| Sitzungs-Cookie (better-auth) | hält Sie nach dem Anmelden angemeldet | bis zu 30 Tage oder bis zur Abmeldung |
| `askmetry_locale` | merkt sich die gewählte Sprache | 1 Jahr |

Hinzu kommt der Bot-Schutz Cloudflare Turnstile beim Schnell-Check (Abschnitt 4.4). Analyse-, Tracking- oder Werbe-Cookies setzen wir nicht ein.

## 12. Empfänger im Überblick

Personenbezogene Daten erhalten nur die in dieser Erklärung genannten Dienstleister und, wenn wir dazu verpflichtet sind, Behörden sowie unsere Steuerberatung. Eine vollständige Liste unserer Unterauftragnehmer finden Sie [hier](/unterauftragnehmer). Wir verkaufen keine Daten.

## 13. Keine automatisierte Entscheidung

Wir treffen keine Entscheidungen, die ausschließlich auf automatisierter Verarbeitung beruhen und Ihnen gegenüber rechtliche Wirkung entfalten oder Sie in ähnlicher Weise erheblich beeinträchtigen (Art. 22 DSGVO). Die automatischen Begrenzungen beim Gratis-Check dienen nur dem Missbrauchsschutz; bei Problemen helfen wir per E-Mail.

## 14. Pflicht zur Bereitstellung

Für den Schnell-Check ist keine E-Mail-Adresse nötig; ohne sie können wir Sie nur nicht benachrichtigen, wenn das Ergebnis fertig ist. Ohne Konto- und Rechnungsangaben ist kein Kauf möglich. Eine gesetzliche Pflicht zur Angabe besteht nicht.

## 15. Ihre Rechte

Sie haben das Recht auf

- **Auskunft** über Ihre Daten (Art. 15 DSGVO),
- **Berichtigung** (Art. 16 DSGVO),
- **Löschung** (Art. 17 DSGVO),
- **Einschränkung der Verarbeitung** (Art. 18 DSGVO),
- **Datenübertragbarkeit** (Art. 20 DSGVO),
- **Widerspruch** gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21 DSGVO).

**Widerspruchsrecht:** Soweit wir Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO verarbeiten, können Sie aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit widersprechen. Der Verwendung Ihrer E-Mail-Adresse für die Erinnerung an die Nachmessung (Direktwerbung) können Sie jederzeit ohne Angabe von Gründen widersprechen.

Schreiben Sie uns dazu an [hallo@askmetry.ai](mailto:hallo@askmetry.ai).

## 16. Beschwerderecht

Sie können sich bei einer Datenschutz-Aufsichtsbehörde beschweren. Für uns zuständig ist:

Der Hamburgische Beauftragte für Datenschutz und Informationsfreiheit
Ludwig-Erhard-Str. 22, 20459 Hamburg
[datenschutz-hamburg.de](https://datenschutz-hamburg.de)

## 17. Sicherheit

Wir übertragen Daten verschlüsselt (TLS), speichern Passwörter nur als Hashwert, trennen die Daten verschiedener Kunden und beschränken Zugriffe auf das Nötige.

## 18. Änderungen

Wir passen diese Erklärung an, wenn sich unser Angebot oder die Rechtslage ändert. Es gilt die jeweils hier veröffentlichte Fassung.
