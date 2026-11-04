# GEO-Checkliste: Was wirklich hilft, in KI-Antworten genannt zu werden

Stand: November 2026. Recherche-Grundlage: Studien von Ahrefs, Semrush, Peec AI, Seer Interactive und Vercel, das Princeton-GEO-Paper sowie die Dokus von OpenAI, Google und Anthropic.

**Vorbehalte:**
- Fast alle Zahlen stammen von Tool-Anbietern, betreffen englischsprachige Fragen und zeigen Zusammenhänge, keine bewiesenen Ursachen.
- Für deutschsprachige Fragen gibt es keine unabhängige Studie.
- Askmetry misst deshalb selbst und leitet Maßnahmen nur aus den eigenen Daten ab.

**Bewertung:** Wirkung ●●● hoch · ●● mittel · ● gering. Realismus für ein kleines Team: ✅ realistisch · ⚠️ bedingt · ❌ unrealistisch.

---

## 0. Zuerst: Voraussetzungen (einmalig, Webagentur)

| ✓ | Maßnahme | Wirkung | Realismus | Beleg |
|---|---|---|---|---|
| ☐ | **KI-Such-Crawler nicht sperren:** OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot, Googlebot, auch in Cloudflare oder der Firewall | ●●● Voraussetzung | ✅ 30 Min. | OpenAI-Doku: Wer OAI-SearchBot sperrt, fehlt in ChatGPT Search |
| ☐ | **Text ohne JavaScript ausliefern** (Server-Rendering) | ●●● Voraussetzung | ✅ bis ⚠️ je nach System | Vercel 2024: Die Crawler von ChatGPT, Claude und Perplexity führen kein JavaScript aus |
| ☐ | **In Bing (und Brave) indexiert sein:** Bing Webmaster Tools, IndexNow | ●●● | ✅ 1 Std. | Seer 2024: 87 % der ChatGPT-Zitate stehen in den Bing-Top-Ergebnissen; Claude sucht über Brave |
| ☐ | Organization-Schema mit sameAs-Links zu Profilen | ● Grundpflege | ✅ 2 Std. | Ahrefs 2026: Nachträgliches Schema bringt keinen messbaren Zitations-Effekt |

## 1. Eigene Inhalte (du schreibst)

| ✓ | Maßnahme | Wirkung | Realismus | Für wen |
|---|---|---|---|---|
| ☐ | **„Beste X für Y“-Listen** zur eigenen Kategorie, die die eigene Marke offen mit aufführen und jährlich aktualisiert werden | ●●● | ✅ | Portal: Kerngeschäft. Anbieter: nur ehrlich, mit Alternativen. Ahrefs 2025: 44 % aller von ChatGPT zitierten Seiten sind solche Listen |
| ☐ | **Vergleichsseiten „X vs. Y“ und „Alternativen zu X“** | ●●–●●● | ✅ | beide |
| ☐ | **Answer first:** Frage als Überschrift, darunter die Antwort in 2–3 Sätzen, dann Details | ●● | ✅ | beide |
| ☐ | **Zahlen, Quellen, Zitate** im Text (eigene Daten mit Stand-Datum) | ●● | ✅ | beide. Princeton-Paper: bis +40 % Sichtbarkeit im Labortest |
| ☐ | **Aktuell halten:** Preis- und Gebührentabellen quartalsweise echt aktualisieren, Datum sichtbar | ●● | ✅ | beide. Ahrefs: ChatGPT zitiert jüngere Inhalte. Nur das Datum zu ändern bringt nichts |
| ☐ | **Klar sagen, wer du bist:** ein gleichlautender Satz „Marke + Kategorie + für wen“ auf Startseite, Über-uns-Seite und allen Profilen | ●● | ✅ | Portal besonders, damit die KI es nicht für einen Anbieter hält |
| ☐ | **Eigene Daten benennen:** „Paylindo-Kostenvergleich 2026“ statt „unsere Tabelle“ | ●● | ✅ | beide. Zitierfähige Zahlen werden mit Quelle übernommen |
| ☐ | Preis- und Use-Case-Seiten („EC-Terminal für Food-Trucks“, „Dienstplan für MFA-Teilzeit“) | ●● | ✅ | Anbieter: Preisseite. Beide: Use Cases |

## 2. Auf anderen Seiten (Externe anschreiben)

| ✓ | Maßnahme | Wirkung | Realismus | Für wen |
|---|---|---|---|---|
| ☐ | **Bewertungsportale:** Profil auf G2, Capterra, OMR Reviews oder Trustpilot, Kunden um ehrliche Bewertungen bitten | ●●● | ✅ | Anbieter (Software): Pflicht. Portal: Trustpilot |
| ☐ | **In Vergleichsportalen listen lassen** (Anbieterformular, Partner- oder Affiliate-Programm, bezahlte Listung) | ●●● | ✅ | nur Anbieter |
| ☐ | **Autoren von Ratgebern und Blogs Fakten anbieten:** Datenblatt, Testzugang, Gebührentabelle zum Übernehmen | ●● | ✅ bis ⚠️ | beide |
| ☐ | **Digital PR mit eigenen Daten:** eine Zahl mit Nachrichtenwert an Fachmedien schicken („So viel zahlen kleine Läden für Kartenzahlung“) | ●●● wenn aufgegriffen | ⚠️ Erfolg unsicher | Portal: ideal, weil die Daten schon vorliegen |
| ☐ | Partner statt Konkurrenten ansprechen (Kassensystem-Anbieter, Steuerberater-Blogs, Praxisberater, Verbände) | ●● | ✅ | beide |
| ☐ | Branchenverzeichnisse (Kammern, Verbände) | ● | ✅ Pflichtprogramm | beide |
| ☐ | Gastbeiträge in Fachmedien | ●–●● | ✅ | eher Anbieter |

Beleg für den ganzen Bereich: Ahrefs 2025 (75.000 Marken). Erwähnungen auf fremden Seiten hängen am stärksten mit KI-Sichtbarkeit zusammen (0,66), Backlinks nur schwach (0,22).

## 3. Community (mitdiskutieren)

| ✓ | Maßnahme | Wirkung | Realismus | Hinweis |
|---|---|---|---|---|
| ☐ | **LinkedIn:** Gründer und Experten posten fachlich | ●● | ✅ | Semrush 2026: rund 13 % der Zitate in ChatGPT und Google AI Mode |
| ☐ | **Reddit / Fachforen:** offen als Anbieter antworten, wo die KIs nachweislich mitlesen | ●● | ⚠️ | Nur dort, wo Askmetry die Threads als Quelle misst. Im DACH-Nischen-B2B ist auf Reddit oft wenig los |
| ☐ | YouTube: Demos, Unboxings, Erklärvideos | ●● | ⚠️ | Google AIO und AI Mode zitieren YouTube häufig |

## 4. Mythen und unrealistische Maßnahmen (macht Askmetry bewusst nicht)

| Maßnahme | Warum nicht |
|---|---|
| ❌ **Einen Wettbewerber bitten, dich in seinem Listicle zu nennen** | Er hat keinen Anreiz. Realistisch sind fremde, neutrale Listen (siehe 2.) oder die eigene Liste (siehe 1.) |
| ❌ **Markenname in jeden Artikel-Titel** | Kein Beleg, wirkt wie Keyword-Stuffing (im Princeton-Paper wirkungslos). Stattdessen: Marke einmal im ersten Absatz mit Kategorie, eigene Daten benennen, Title-Tag-Suffix „… \| Marke“ |
| ❌ **llms.txt** | Ahrefs 2026: 97 % der Dateien bekamen keinen einzigen KI-Abruf. Google unterstützt sie nicht |
| ❌ **FAQ- oder Schema-Markup als Zitations-Hebel** | Ahrefs 2026: kein messbarer Effekt. Organization-Schema nur als Grundpflege |
| ❌ **Wikipedia-Artikel über die eigene Firma** | Die Relevanzkriterien der deutschen Wikipedia sind für kleine Firmen kaum erreichbar. Höchstens Wikidata |
| ❌ **„Google-Top-10 reicht“** | Der Anteil der AIO-Zitate aus den Top 10 fiel laut Ahrefs von ca. 76 % auf ca. 38 % |
| ❌ **Gekaufte Reddit-Posts, Zweitkonten** | Werden gelöscht und schaden der Marke |

## 5. Wie Askmetry priorisiert

1. **Voraussetzungen** (Abschnitt 0) prüft der Website-Check automatisch.
2. **Eigene Inhalte** für die Fragen, bei denen Wettbewerber genannt werden, du aber nicht.
3. **Quellen-Lücken:** Welche fremden Seiten nutzen die KIs bei diesen Fragen? Je Seitenart gibt es die passende Ansprache:

   | Seitenart | Ansprache für Anbieter | Ansprache für Vergleichsportale |
   |---|---|---|
   | Bewertungsportal | Profil anlegen, Bewertungen sammeln | Profil anlegen, Bewertungen sammeln |
   | Vergleichsportal | Listung beantragen | **ausgeblendet**, weil direkter Wettbewerber |
   | Medium | Daten oder Experten-Zitat anbieten | eigene Auswertung als Story anbieten |
   | Ratgeber / Blog | Autor Fakten und Testzugang anbieten | Vergleichsdaten als Quelle anbieten |

   Websites von Anbietern und Wettbewerbern werden nie als Ziel vorgeschlagen.
4. **Community** nur dort, wo die KIs die Threads nachweislich lesen.

Jede Maßnahme ist an konkrete Quellen-URLs und Zahlen aus der eigenen Messung gebunden. Ihre Wirkung prüft die nächste Messung.

## Quellen

- Ahrefs: Listicles in ChatGPT-Zitaten – https://ahrefs.com/blog/best-lists-research/
- Ahrefs: Marken-Erwähnungen vs. AI Overviews – https://ahrefs.com/blog/ai-overview-brand-correlation/
- Ahrefs: Aktualität – https://ahrefs.com/blog/do-ai-assistants-prefer-to-cite-fresh-content/
- Princeton GEO-Paper (KDD 2024) – https://arxiv.org/abs/2311.09735
- Peec AI: meistzitierte Domains – https://docs.peec.ai/research/most-cited-domains-in-ai-search
- Semrush: meistzitierte Domains – https://www.semrush.com/blog/most-cited-domains-ai/
- OpenAI: Crawler-Doku – https://developers.openai.com/docs/gptbot
- Vercel: KI-Crawler und JavaScript – https://vercel.com/blog/the-rise-of-the-ai-crawler
- Seer Interactive: ChatGPT und Bing – https://www.seerinteractive.com/insights/87-percent-of-searchgpt-citations-match-bings-top-results
- Simon Willison: Claude nutzt Brave – https://simonwillison.net/2025/Mar/21/anthropic-use-brave/
- llms.txt-Nutzung – https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/
- Schema-Test – https://analyzify.com/hub/schema-markup-ai-citations-research
