import type { ExtractedBrand, Sentiment } from './analyze.ts';
import { norm } from './util.ts';

export interface WorkspaceBrand {
  id: string;
  name: string;
  aliases?: string[] | null;
}

export interface CanonicalMention {
  brandId: string | null;
  name: string;
  position: number;
  sentiment: Sentiment;
  recommended: boolean;
  snippet: string | null;
  /** direkter Wettbewerber der eigenen Marke? null = unbekannt */
  isCompetitor: boolean | null;
}

/**
 * Extrahierte Marken einer Antwort auf Workspace-Marken abbilden (Name/Aliase, Groß-/Kleinschreibung egal)
 * und zusammenfassen: jede Marke höchstens einmal, beste (kleinste) Position, empfohlen wenn irgendwo empfohlen.
 */
export function canonicalizeMentions(extracted: ExtractedBrand[], brands: WorkspaceBrand[]): CanonicalMention[] {
  const lookup = new Map<string, WorkspaceBrand>();
  for (const b of brands) {
    for (const n of [b.name, ...(b.aliases ?? [])]) {
      const k = norm(n);
      if (k && !lookup.has(k)) lookup.set(k, b);
    }
  }
  const merged = new Map<string, CanonicalMention>();
  for (const e of [...extracted].sort((a, b) => a.position - b.position)) {
    const b = (e.tracked && lookup.get(norm(e.tracked))) || lookup.get(norm(e.name)) || null;
    const name = b ? b.name : e.name.trim();
    if (!name) continue;
    const key = b ? `id:${b.id}` : `name:${norm(name)}`;
    const prev = merged.get(key);
    if (prev) {
      prev.position = Math.min(prev.position, e.position);
      prev.recommended ||= !!e.recommended;
    } else {
      merged.set(key, {
        brandId: b?.id ?? null,
        name,
        position: Number.isFinite(e.position) && e.position > 0 ? Math.round(e.position) : merged.size + 1,
        sentiment: (['positive', 'neutral', 'negative'] as const).includes(e.sentiment) ? e.sentiment : 'neutral',
        recommended: !!e.recommended,
        snippet: e.snippet ? e.snippet.slice(0, 500) : null,
        isCompetitor: typeof e.is_competitor === 'boolean' ? e.is_competitor : null,
      });
    }
  }
  return [...merged.values()].sort((a, b) => a.position - b.position);
}
