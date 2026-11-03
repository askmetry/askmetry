// Standard-Einstellungen je Engine – Ergebnis des Kosten-Experiments vom 31.10.2026
// (spike/experiment.mjs, Auswertung in SPEC.md Kapitel 9).
// Ziel: ~20 Prompts × 2 Wiederholungen × wöchentlich unter 50 €/Monat.

export const engineDefaults = {
  // gpt-5.5 mit wenig Suchkontext + niedriger Denktiefe: ~0,10 $/Anfrage statt ~0,22 $.
  // Abweichung zur teuren Einstellung so groß wie die normale Schwankung zwischen zwei Läufen.
  // Mini-Modelle liefern deutlich andere Antworten → nicht verwenden.
  // flex (Qualitätstest 03.11.2026, 20 Prompts × 2): gleiches Modell zu Batch-Preisen, ~0,065 $ statt ~0,26 $ (alte
  // Standard-Einstellung). Abweichung zur teuren Referenz (Marken 0,38) so groß wie die Schwankung zwischen
  // zwei Läufen derselben Einstellung (0,42). Ohne freie flex-Kapazität: Rückfall auf den Normalpreis.
  chatgpt: { model: 'gpt-5.5', searchContextSize: 'low', reasoningEffort: 'low', serviceTier: 'flex' },
  // Grounding bis 5.000 Suchanfragen/Monat kostenlos, danach 14 $/1.000.
  gemini: { model: 'gemini-3.5-flash' },
  // Sonnet 5.5 (claude.ai-Standardmodell-Klasse) statt Opus: ~0,08 $ statt ~0,19 $.
  // Ohne Anweisung sucht Sonnet oft gar nicht im Web → Systemanweisung setzen.
  claude: {
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    maxSearches: 3,
    system: 'Recherchiere vor deiner Antwort im Web nach aktuellen Informationen und stütze dich auf die gefundenen Quellen.',
    // Geplante Messungen über die Message Batches API: gleiche Anfrage (ohne Server-Fallback), Tokens −50 %.
    // Manuelle Messungen („Jetzt messen“) bleiben immer synchron. false = auch geplante Messungen synchron.
    batch: true,
  },
  perplexity: { model: 'sonar', searchContextSize: 'low' },
  // DataForSEO Live: AI Overviews ~0,004 $ (inkl. Nachladen), AI Mode ~0,004 $
  google_aio: {},
  google_ai_mode: {},
  // Auswertung der Antworten (Marken, Position, Tonalität)
  analyzer: { model: 'claude-haiku-5-5', effort: 'low' },
} as const;

// Listenpreise in USD (Stand 31.10.2026, Quellen siehe SPEC.md). Pro 1 Mio. Tokens bzw. pro Suche.
export const prices = {
  'gpt-5.5': { input: 5, output: 30, perSearch: 0.01 },
  // Modell der ChatGPT-App. Ob die Suche als „non-reasoning“ (25 $/1.000, Suchinhalte frei) oder wie gpt-5.5
  // (10 $/1.000 + Suchinhalte zum Modellpreis) abgerechnet wird, ist unklar → vorsichtig: Suchinhalte + 25 $/1.000.
  'chat-latest': { input: 5, output: 30, perSearch: 0.025 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, perSearch: 0.01 },
  'gemini-3.5-flash': { input: 0.75, output: 3.75, perSearch: 0 }, // Grounding im Freikontingent
  'claude-opus-5-5': { input: 4, output: 20, perSearch: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, perSearch: 0.01 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, perSearch: 0.01 },
  sonar: { input: 0.25, output: 2.5, perSearch: 0.005 },
} as const;

// Schätzwerte pro Anfrage für die Budgetprüfung vor einem Run (aus dem Experiment)
export const estimatedCostPerRun: Record<string, number> = {
  chatgpt: 0.08, // flex, gemessen 03.11.2026: Ø 0,065 $ (Puffer für Rückfall auf Normalpreis)
  gemini: 0.012,
  claude: 0.09,
  // Claude über die Batches API: Tokens −50 % (~0,06 $ → 0,03 $), Suchen (bis 3 × 0,01 $) unverändert
  claude_batch: 0.06,
  perplexity: 0.008,
  google_aio: 0.004,
  google_ai_mode: 0.004,
  mock: 0,
};
