// GEO-Leitfaden/FAQ für den PDF-Bericht: Inhalt kommt aus einer Markdown-Datei je Sprache, das Layout aus pdf.tsx.
//
// Andocken: Datei `packages/report/src/guide/geo-leitfaden.<de|en>.md` anlegen (liegt unter src/, damit sie mit ins
// Worker-Image kommt – siehe Dockerfile). Fehlt die Datei für die Berichtssprache, entfällt das Kapitel.
//
// Unterstütztes Markdown (bewusst klein, damit PDF und App dieselbe Quelle nutzen können):
//   # Titel                → Seitentitel (sonst „GEO-Leitfaden“ / „GEO guide“)
//   Absatz direkt nach # → Einleitung (grau)
//   ## Abschnitt           → Zwischenüberschrift
//   ### Frage              → FAQ-Frage / Unterüberschrift (fett), der folgende Absatz ist die Antwort
//   - Punkt / 1. Punkt     → Liste
//   **fett**               → fett; Links [Text](url) → „Text (url)“
//   <!-- Kommentar -->      → wird ignoriert
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Lang } from '@askmetry/core/present';

export type GuideBlock =
  | { kind: 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] };

export interface ReportGuide { title: string | null; intro: string | null; blocks: GuideBlock[] }

/** Pfad der Leitfaden-Datei einer Sprache. */
export const guidePath = (lang: Lang) => fileURLToPath(new URL(`./guide/geo-leitfaden.${lang}.md`, import.meta.url));

/** Inline-Markdown vereinfachen: Links ausschreiben, Code-Markierungen entfernen (fett bleibt als **…** für das Layout). */
const inline = (s: string) => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t: string, u: string) => (t === u ? u : `${t} (${u.replace(/^https?:\/\//, '')})`))
  .replace(/`([^`]+)`/g, '$1')
  .trim();

/** Markdown (Teilmenge, siehe oben) in Blöcke zerlegen. Leerer Inhalt → null. */
export function parseGuide(md: string): ReportGuide | null {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
  let title: string | null = null;
  let intro: string | null = null;
  const blocks: GuideBlock[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) {
      const text = inline(para.join(' '));
      if (text) {
        if (title !== null && intro === null && blocks.length === 0) intro = text;
        else blocks.push({ kind: 'p', text });
      }
      para = [];
    }
    if (list) { blocks.push(list); list = null; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line.trim());
    if (h) {
      flush();
      if (h[1].length === 1 && title === null && blocks.length === 0) title = inline(h[2]);
      else blocks.push({ kind: h[1].length <= 2 ? 'h2' : 'h3', text: inline(h[2]) });
      continue;
    }
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      if (para.length) flush();
      const kind = li[1] ? 'ul' : 'ol';
      if (list && list.kind !== kind) flush();
      list ??= { kind, items: [] };
      list.items.push(inline(li[3]));
      continue;
    }
    // Fortsetzungszeile eines Listenpunkts
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${inline(line)}`; continue; }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  if (!title && !intro && !blocks.length) return null;
  return { title, intro, blocks };
}

/** Leitfaden der Berichtssprache laden (null, wenn es keinen gibt). */
export function loadGuide(lang: Lang): ReportGuide | null {
  const p = guidePath(lang);
  if (!existsSync(p)) return null;
  try {
    return parseGuide(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
