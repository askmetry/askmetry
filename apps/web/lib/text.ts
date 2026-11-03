// Kleine Texthelfer (rein, auch im Browser nutzbar).

/** Erster Satz für kurze Begründungen. Abkürzungen wie „z. B.“ beenden keinen Satz (Satzende braucht ≥ 30 Zeichen und danach einen Großbuchstaben). */
export function firstSentence(s: string): string {
  const t = s.trim();
  const re = /[.!?](?=\s+[A-ZÄÖÜ„"])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) if (m.index + 1 >= 30) return t.slice(0, m.index + 1);
  return t;
}

/** Markennamen für Vergleiche normalisieren (girocard = Girocard, Leerzeichen, Bindestriche). */
export const brandKey = (name: string) => name.trim().toLowerCase().replace(/[\s\-–]+/g, ' ');

/** Gleiche Namen (nach brandKey) zusammenfassen; Schreibweise der ersten Nennung mit Großbuchstaben bevorzugen. */
export function uniqueBrandNames(names: readonly string[]): string[] {
  const by = new Map<string, string>();
  for (const n of names) {
    const k = brandKey(n);
    const cur = by.get(k);
    if (!cur || (cur[0] === cur[0]!.toLowerCase() && n[0] !== n[0]!.toLowerCase())) by.set(k, n.trim());
  }
  return [...by.values()];
}

/** Fachwort „Prompt(s)“ für Nutzer als „Frage(n)“ zeigen – „KI-Prompt“ und „Prompt kopieren“ bleiben. */
export function plainTerms(s: string): string {
  return s.replace(/(?<![-\p{L}])(Prompts|Prompt)(?![-\p{L}])(?! (kopieren|ansehen|ausblenden|für (deine|eine|dein) KI))/gu, (m) => (m === 'Prompts' ? 'Fragen' : 'Frage'));
}

/** „1 von 45“ → „1 von 45 Antworten“ (Nenner erklären). */
export const ofAnswers = (num: number, den: number) => `${num} von ${den} ${den === 1 ? 'Antwort' : 'Antworten'}`;
