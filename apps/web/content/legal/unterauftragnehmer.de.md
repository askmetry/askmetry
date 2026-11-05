<!--
ENTWURF – Stand 05.11.2026. Nicht rechtsverbindlich geprüft; Freigabe durch Gründer/Anwalt erforderlich.

Recherche (WebFetch/WebSearch, 05.11.2026) und Unsicherheiten:
- OpenAI: Laut OpenAI-DPA (gültig ab 01.01.2026) verarbeitet OpenAI Ireland Limited EWR-Daten; Weitergabe an OpenAI-Konzerngesellschaften/Dritte
  außerhalb EWR über SCC. Services Agreement selbst nicht abrufbar (403). DPF-Status der US-Gesellschaft (OpenAI OpCo, LLC) NICHT verifiziert.
  Adresse aus Erinnerung (Liffey Trust Centre) – bitte gegen openai.com prüfen. DPA im OpenAI-Dashboard aktiv ausführen!
- Anthropic: Commercial Terms: Vertragspartner für Kunden im EWR/CH/UK ist Anthropic Ireland, Limited; sonst Anthropic, PBC.
  DPF-Zertifizierung von Anthropic, PBC nur in Drittquellen behauptet – NICHT verifiziert; daher hier nur „SCC“ angegeben.
- Google Gemini API: Bezahlte Nutzung über Cloud Billing; „Google“ i. S. d. Bedingungen laut cloud.google.com/terms/google-entity
  (Seite nicht vollständig lesbar). Für EWR-Kunden vermutlich Google Cloud EMEA Limited, Dublin. Verarbeitung unter dem Cloud Data Processing Addendum;
  Google LLC DPF-zertifiziert (allgemein bekannt, nicht gegengeprüft). Wichtig: nur Paid Tier – Free Tier nutzt Prompts zur Produktverbesserung.
- DataForSEO: Laut Datenschutzerklärung DataForSEO OÜ, Reg.-Nr. 14502291, Estland (Adressen Tallinn und Charkiw/Ukraine).
  Nutzt eigene Unterauftragnehmer u. a. Hetzner, Google, AWS, Azure. Ob Personal in der Ukraine Zugriff hat (kein Angemessenheitsbeschluss), unklar →
  DPA anfordern. Übermittelt werden nur Suchfragen.
- Brevo: Sendinblue SAS, 106 boulevard Haussmann, 75008 Paris – aus Kenntnis, gegen brevo.com/legal prüfen. Tracking (Öffnen/Klicks) deaktivieren.
- Cloudflare, Inc.: DPF-zertifiziert (bekannt, nicht gegengeprüft). Nur DNS + Turnstile angenommen; bei aktivem Proxy Zweck/Daten erweitern.
- Stripe: Eigenständig Verantwortlicher für Zahlungsabwicklung; daher nicht als Unterauftragnehmer im Sinne des AVV geführt.
- Telegram: nicht aufgeführt, weil laut Vorgabe keine personenbezogenen Daten übermittelt werden (Telegram FZ-LLC, Dubai, wäre sonst Drittland ohne
  Angemessenheitsbeschluss!). Bitte im Code sicherstellen (auch keine maskierten E-Mails).
- Speicherfristen bei KI-Anbietern (z. B. OpenAI bis 30 Tage Missbrauchsüberwachung, Anthropic-Batch-Ergebnisse 29 Tage) bewusst nicht als feste
  Zahl genannt – Anbieterbedingungen ändern sich.
-->

# Unterauftragnehmer und Dienstleister

Stand: 5. November 2026

Diese Liste nennt die Dienstleister, die wir für Askmetry einsetzen. **Unterauftragnehmer** im Sinne unseres [Auftragsverarbeitungsvertrags](/avv) sind die Dienste in Tabelle 1. Über Änderungen informieren wir Kunden mindestens 30 Tage vorher per E-Mail.

## 1. Unterauftragnehmer

| Dienst | Firma und Sitz | Zweck | Daten | Übermittlungsgrundlage |
|---|---|---|---|---|
| Hosting | Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Deutschland | Server, Datenbank, Backups (Rechenzentren in Deutschland) | alle bei Askmetry gespeicherten Daten | EU – keine Drittlandübermittlung |
| ChatGPT-API mit Websuche | OpenAI Ireland Ltd, Dublin, Irland | Fragen an ChatGPT stellen (Messung) | Fragen, Marken- und Wettbewerbernamen, ggf. darin enthaltene personenbezogene Daten | Verarbeitung auch in den USA durch den OpenAI-Konzern: EU-Standardvertragsklauseln |
| Claude-API mit Websuche | Anthropic Ireland, Limited, Dublin, Irland | Fragen an Claude stellen (Messung); Auswertung der Antworten, Markenprofil, Wettbewerber, Fragen und Maßnahmen | Fragen, Marken- und Wettbewerberangaben, Inhalte der geprüften öffentlichen Website, KI-Antworten | Verarbeitung auch in den USA durch Anthropic, PBC: EU-Standardvertragsklauseln |
| Gemini-API mit Google-Suche | Google Cloud EMEA Limited, Dublin, Irland, mit Google LLC, Mountain View, USA | Fragen an Gemini stellen (Messung) | Fragen, Marken- und Wettbewerbernamen | USA: EU-US Data Privacy Framework (Google LLC) und Standardvertragsklauseln |
| Google-Ergebnisseiten (AI Overviews, AI Mode) | DataForSEO OÜ, Tallinn, Estland | Abruf der Google-Suchergebnisse zu den Fragen | Fragen (Suchbegriffe), Land und Sprache | EU-Unternehmen; Übermittlungen an eigene Dienstleister außerhalb der EU nach Angabe von DataForSEO über Standardvertragsklauseln bzw. Angemessenheitsbeschlüsse |
| E-Mail-Versand | Sendinblue SAS (Brevo), 106 boulevard Haussmann, 75008 Paris, Frankreich | Versand von Bestätigungs-, Ergebnis- und Bericht-Mails | E-Mail-Adresse, Name, Mailinhalt inkl. PDF-Bericht | EU – keine Drittlandübermittlung |
| DNS, Bot-Schutz | Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA | DNS-Auflösung der Domain; Turnstile-Bot-Schutz beim Gratis-Check | IP-Adresse, technische Browser-Merkmale (Turnstile) | USA: EU-US Data Privacy Framework und Standardvertragsklauseln |

Die KI-Anbieter nutzen die übermittelten Daten nach ihren Bedingungen für API-Kunden nicht zum Training ihrer Modelle. Sie können Anfragen für eine begrenzte Zeit zur Missbrauchserkennung speichern. Für die Websuche können sie Suchbegriffe an Suchdienste weitergeben.

## 2. Weitere Empfänger (keine Unterauftragnehmer)

| Dienst | Firma und Sitz | Rolle | Daten |
|---|---|---|---|
| Zahlung und Rechnung | Stripe Payments Europe, Limited, 1 Grand Canal Street Lower, Grand Canal Dock, Dublin, D02 H210, Irland | eigenständig Verantwortlicher für die Zahlungsabwicklung; Übermittlung an Stripe, Inc. (USA) auf Grundlage des EU-US Data Privacy Framework und von Standardvertragsklauseln | Name, Firma, E-Mail, Rechnungsadresse, USt-IdNr., Zahlungsdaten |

Interne Betriebsmeldungen an uns (z. B. „neuer Kauf“, Fehler) enthalten keine personenbezogenen Daten.
