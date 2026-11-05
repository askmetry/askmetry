// Aufbereitung der Rechtstexte (Markdown aus content/legal). Rein, ohne Dateisystem – getestet in legal-markdown.test.ts.

export const LEGAL_DOCS = ['impressum', 'datenschutz', 'agb', 'avv', 'unterauftragnehmer'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/** HTML-Kommentare (z. B. „<!-- ENTWURF … -->“-Hinweise) entfernen – sie dürfen nie sichtbar werden. */
export function stripComments(md: string): string {
  return md.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/^\s+/, '');
}

/** Erste Überschrift „# …“ als Seitentitel herauslösen (die Seite setzt selbst die h1). */
export function splitTitle(md: string): { title: string | null; body: string } {
  const m = md.match(/^#[ \t]+(.+?)[ \t#]*$/m);
  if (!m || m.index === undefined) return { title: null, body: md };
  return { title: plain(m[1]!), body: (md.slice(0, m.index) + md.slice(m.index + m[0].length)).replace(/^\s+/, '') };
}

/** Inline-Markdown zu reinem Text (Links, Hervorhebungen, Code). */
export function plain(s: string): string {
  return s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
}

/** Anker-ID aus Überschriftentext: Kleinbuchstaben, Umlaute ausgeschrieben, sonst nur a–z/0–9/-. */
export function slugify(s: string): string {
  return plain(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'abschnitt';
}

/** Vergibt eindeutige IDs in Dokument-Reihenfolge (gleicher Text → „-2“, „-3“ …). */
export function idMaker() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

/** Inhaltsverzeichnis aus den „## “-Überschriften (Codeblöcke werden übersprungen). IDs passen zu idMaker() über h2+h3. */
export function extractToc(md: string): { id: string; text: string }[] {
  const id = idMaker();
  const toc: { id: string; text: string }[] = [];
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = line.match(/^(#{2,3})[ \t]+(.+?)[ \t#]*$/);
    if (!m) continue;
    const text = plain(m[2]!);
    const anchor = id(text);
    if (m[1] === '##') toc.push({ id: anchor, text });
  }
  return toc;
}
