# Askmetry – Design-Leitplanken

Grundlage: Design-Review (Apple-Stil) und Einsteiger-Review (Marketerin ohne GEO-Vorwissen), 2026-11-02.

## Leitplanke 1: Answer first, radikal einfach

Wer reinkommt, sieht in 5 Sekunden **wo er steht** und **was er als Nächstes tut**. Alles andere ist eine Ebene tiefer.

- Erst die Antwort, dann die Begründung, dann die Daten. Text nur, wo eine Grafik nicht reicht.
- Eine Hauptzahl statt vier gleich großer Kacheln. Jede Zahl mit Maßstab (Vergleich zum Spitzenreiter) und Urteil in Worten.
- Karten zeigen höchstens 5 Zeilen. Details (Schritte, Belege, Prompt) erst beim Öffnen.
- Alltagssprache, kein Jargon auf der ersten Ebene. Fachbegriffe nur mit Ein-Satz-Erklärung (Tooltip „?“).
- Durchgehend „du“. Maximal 3 Schriftgrößen (Hero, Titel 17 px semibold, Text 15 px), Grautext nie kleiner als 13 px.
- Rot nur für echte Verschlechterung. „Nicht genannt“ ist ein leerer grauer Kreis, kein roter Chip.
- Viel Weißraum: Inhaltsbreite ca. 1080 px, 48 px Abstand zwischen Sektionen, Karten ohne harte Rahmen.

## Leitplanke 2: KI-ready (anbieterneutral)

Alles, was die App empfiehlt, lässt sich mit einem Klick an einen KI-Assistenten übergeben – ChatGPT, Claude, Gemini oder für Code Claude Code, Codex, Cursor. Die UI sagt „deine KI“ und nennt Beispiele nur als Hinweis.

- Jede Maßnahme hat **„Prompt kopieren“**. Der Prompt ist vollständig und eigenständig: Markenkontext, Ziel als Messgröße, alle Belege (URLs, Fragen, Wettbewerber, Zitate), ein klar benanntes Ergebnis je Kategorie, „Fertig, wenn …“, die Bitte, fehlende Fakten erst zu erfragen, und das Verbot, Zahlen zu erfinden.
- Die Übersicht hat **„Lagebericht kopieren“**: Markdown mit Stand, Vergleich, wichtigster Erkenntnis, Top-Maßnahmen und nächster Messung. Er dient für den Chef und als Kontext für die eigene KI.
- Später: lesende API bzw. MCP-Server, damit KI-Assistenten (z. B. Claude Code) Maßnahmen direkt abrufen und Status setzen kann. Die Prompt-Bausteine liegen deshalb in `packages/core`, nicht in der UI.

## Leitplanke 3: Nur realistische Maßnahmen

Jede Maßnahme muss für ein kleines Team umsetzbar und durch Belege gestützt sein. Grundlage ist [GEO-PLAYBOOK.md](GEO-PLAYBOOK.md).

- Nie vorschlagen: Wettbewerber um Nennung bitten, Markennamen in jeden Titel, llms.txt, Schema als Zitations-Hebel.
- Die Outreach-Ansprache richtet sich nach der Art der Quelle (Bewertungsportal, Vergleichsportal, Medium, Ratgeber). Für Vergleichsportale sind andere Vergleichsportale Wettbewerber.
- Das Markenprofil (ein Satz plus Markentyp) erkennt die App selbst von der Website. Der Nutzer bestätigt es nur mit „Passt“.

## Links

Seiten, Threads und Domains aus den Belegen sind überall klickbar (neuer Tab). Verlinkt wird nur, was in den Belegen der Maßnahme steht; Pfade bleiben deshalb in den Texten wörtlich stehen.

## Begriffe

| Intern | In der UI |
|---|---|
| Sichtbarkeit (mention rate) | **KI-Sichtbarkeit**, Score 0–100: „in X von Y Antworten genannt“ |
| Empfehlungsrate | **Empfohlen** |
| Share of Voice | **Anteil an allen Nennungen** (nur Details) |
| Ø Position | **Platz in der Antwort**, ausgeblendet bei weniger als 5 Nennungen |
| Engine | **KI-Suche** (ChatGPT, Gemini, Claude, Google-Übersicht = AI Overviews, Google KI-Modus = AI Mode) |
| Prompt | **Frage** |
| Lücken | Filter **„Fragen ohne dich“** |
| cited / searched | **zitiert** / **gelesen** („Die KI hat die Seite geöffnet, nennt sie aber nicht als Quelle.“) |

Englisch (UI-Sprache `en`, natürliches SaaS-Englisch, „you“, Satz-Großschreibung): Übersicht **Overview** · Maßnahmen **Actions** · Fragen **Questions** · Quellen **Sources** · Analyse **Analysis** · Einstellungen **Settings** · KI-Sichtbarkeit **AI visibility** · Empfohlen **Recommended** · Anteil an allen Nennungen **Share of voice** · Platz in der Antwort **Position in answer** · KI-Suche **AI search** / **AI engines** (Chips) · Fragen ohne dich **Questions without you** · zitiert/gelesen **cited/read** · Lagebericht **Status report** · „Prompt kopieren“ **Copy prompt** · Kategorien **Your content · Other websites · Community · Technical**. Score-Urteile: Barely visible · Rarely visible · Clearly visible · Highly visible.

Urteil zum Score: 0–9 „Kaum sichtbar“, 10–29 „Selten sichtbar“, 30–59 „Gut sichtbar“, ab 60 „Sehr präsent“.

## Maßnahmen-Kategorien

Vier Arten, jede mit eigenem Icon, eigener Farbe und eigener Zuständigkeit. Akzentblau bleibt Links und Aktionen vorbehalten.

| Kategorie | Wer macht's | Icon | Farbe | Typen |
|---|---|---|---|---|
| **Eigene Inhalte** | Du schreibst | Dokument | Indigo | name_on_own_page, content_gap, positioning, sentiment |
| **Auf anderen Seiten** | Externe anschreiben | Globus | Teal | outreach |
| **Community** | Mitdiskutieren | Sprechblase | Orange | community |
| **Technik** | Webagentur | Zahnrad | Schiefergrau | technical |

Auf der Karte steht nur die **Wirkung** als Stufen-Balken mit Wort („Kleine / Mittlere / Große Wirkung“, `ImpactBadge`, Feld `impact` 1–3) – lesbar auch ohne Farbe. Keine Aufwandsangabe (Entscheidung 05.11.2026, das Datenfeld bleibt). Die Zuständigkeit („Wer macht's“) steht nicht neben Überschriften, sondern nur dezent in der Detailansicht („Wer: Webagentur“).

## Informationsarchitektur

Navigation: **Übersicht · Maßnahmen · Fragen** und ⚙ Einstellungen. Analyse und Quellen erreicht man über „Tiefer einsteigen“.

### Übersicht (`/w/[slug]`)

1. **Kopfzeile:** Marke, „Gemessen am 31.10. · Neu messen“, „Lagebericht kopieren“.
2. **Hero:**
   - Ring mit KI-Sichtbarkeit (0–100), Ampel und Urteil.
   - Ein Satz Einordnung, z. B. „In 2 von 50 Antworten genannt – SumUp in 41.“
   - Darunter die Veränderung zur Vormessung.
3. **Wichtigste Erkenntnis** (eine Zeile), z. B. „KIs nutzen paylindo.de in 34 % der Antworten als Quelle – nennen Paylindo aber fast nie.“
4. **KI-Suchen:** 5 Engine-Chips mit Füllpunkt (○ nie, ◐ teils, ● oft) und Prozentwert.
5. **„Wer in der KI-Suche vorne liegt“:** Balken-Ranking, eigene Marke hervorgehoben, Top 5 plus „Du“.
6. **„Das bringt dich nach vorn“:** 3 Karten, möglichst aus verschiedenen Kategorien. Darunter eine Zeile „Nach Art: Eigene Inhalte 6 · Auf anderen Seiten 5 · …“ mit Links.
7. **„Tiefer einsteigen“:** drei kleine Link-Kacheln: Ergebnisse je KI-Suche (Analyse), Quellen, Fragen ohne dich.

### Maßnahmen (`/w/[slug]/massnahmen`)

- Nach Kategorie gruppiert (Sektionen), innerhalb nach Priorität.
- Filter-Chips: Offen · In Arbeit · Erledigt. Erledigte und ausgeblendete sind eingeklappt.
- Karte: Kategorie-Streifen und Label, Titel, Wirkungs-Badge (`ImpactBadge`), Status-Punkt (nur wenn nicht offen) und der Button „Prompt kopieren“.
- Klick auf die Karte öffnet die **Detailansicht** (eigene Route oder Seitenpanel). Reihenfolge darin:
  1. Kategorie, Titel, Status-Menü (Offen · In Arbeit · Erledigt · Ausblenden).
  2. **Warum** in einem Satz, mit Mini-Grafik oder Engine-Punkten.
  3. **„Mit KI umsetzen“:** Prompt-Vorschau (3 Zeilen, ausklappbar) und ein großer Button „Prompt kopieren“, danach „Kopiert ✓“.
  4. Schritte als Checkliste.
  5. Fortschritt „vorher → jetzt“, sobald die Maßnahme gestartet ist.
  6. Belege, eingeklappt.

### Fragen (`/w/[slug]/fragen`)

- Liste der Fragen mit 5 Engine-Punkten je Frage. Filter „Fragen ohne dich“ (ersetzt die Seite „Lücken“).
- Klick führt zur Antwortansicht. Oben steht ein Fazit: „Paylindo fehlt in 5 von 5 KI-Suchen. Genannt wurden SumUp, Zettle … Geprägt von: kassensystemevergleich.de, r/Kartenzahlung.“ Darunter die Antworten.

### Einstellungen (⚙)

- Eigene Unterseiten mit Seitenleiste (mobil: Reiter-Zeile), kein Springen und Scrollen auf einer langen Seite: `settings/marke` · `wettbewerber` · `fragen` · `messung` · `kosten` · `workspace`. `/settings` leitet auf `marke` weiter.
- Jede Seite: Titel, eine Zeile Erklärung, Hauptaktion rechts oben („+ Wettbewerber“, „Jetzt messen“). Darunter Gruppen mit kleiner grauer Überschrift über einer Karte.
- Wettbewerber als ruhige Zeilen (Logo 24 px, Name, Website, „Bearbeiten“ klappt das Formular auf, ⋯ zum Entfernen). Darunter „Oft genannt, aber nicht verglichen“ mit „Hinzufügen“.
- Jedes Formular speichert nur seinen Teil (`part` in `saveWorkspaceSettings`).
- Messplan in Klartext („Jeden Montag, 3 Uhr“), kein Cron-Ausdruck.
- Die Kosten je KI-Suche stehen nur hier, nicht in der Analyse.
- Konto (E-Mail, Workspaces, Abmelden) steckt im runden Avatar-Menü rechts in der Kopfzeile.

### Neuer Workspace

- Nach dem Anlegen landet man auf der Übersicht. Bis zur ersten Messung zeigt sie eine Checkliste mit drei Schritten (Wettbewerber, Fragen, Messung), abgehakt nach echtem Stand, plus das erkannte Markenprofil zum Bestätigen.

## Logos

- Logos holt Askmetry selbst von der Website der Marke (Icons aus `<link rel=icon|apple-touch-icon>`, sonst `/apple-touch-icon.png`, `/favicon.ico`). Gespeichert je Domain in `domain_logo`, Auslieferung über `/w/[slug]/logo/[domain]` nur an Mitglieder und nur für Domains von Marken dieses Workspaces.
- Darstellung (`BrandMark`): Quadrat mit Radius 22 %, weiße Platte, feiner Rand, 10 % Innenabstand. Ohne Logo die Initiale (eigene Marke in `--own`, sonst grau).
- Orte: Kopfzeile vor dem Workspace-Namen (20 px), Übersicht-Kopf (40 px), Rangliste (20 px), Analyse „Alle Marken“ (20 px), Wettbewerber-Liste (24 px), Workspace-Liste (32 px).
- Nicht in Fragen-Listen, Maßnahmen-Karten, Quellen-Domains oder KI-Such-Chips: Dort würden sie nur Unruhe bringen.
- Eigenes Logo: unter Einstellungen → Marke hochladen (PNG, JPG, WebP, GIF, ICO oder SVG ohne Skripte, ≤ 200 KB). Es gilt nur für diese Marke (`brand.logo_data`), hat Vorrang vor dem Website-Logo und wird über `/w/[slug]/markenlogo/[id]` ausgeliefert. „Wieder Website-Logo verwenden“ entfernt es.
- Das Markenprofil-Banner („Von deiner Website erkannt … Passt“) steht nur auf der Übersicht.

## Analyse und Quellen

- Analyse: eine Hauptzahl (KI-Sichtbarkeit), darunter eine Zeile mit Platz, Empfohlen, Anteil Nennungen und eigener Seite als Quelle. Der Verlauf erscheint erst ab zwei Messungen. Ungetrackte Marken stehen als ein Satz unter der Tabelle („Oft genannt, aber nicht verglichen: … [+ Alle hinzufügen]“), nicht als Knopf in jeder Zeile.
- Quellen (answer first): 1. „Hier stehen Wettbewerber, du nicht“ (5, Rest aufklappbar), 2. „Deine Seite ist Quelle, deine Marke fehlt“ (5), 3. Meistgenutzte Quellen (10), 4. „Von KI gelesen, aber nicht zitiert“ eingeklappt. Kein „?“ je Zeile: Der Grund für eine fehlende Maßnahme steht als Tooltip an der gepunktet unterstrichenen Domain.
- Fragen: Die KI-Suchen stehen einmal als Legende über der Liste, auch mobil; „Fragen bearbeiten“ führt in die Einstellungen.
