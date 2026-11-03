import { safeUrl } from './url';
// Maßnahmen: reine Helfer (Labels, Normalisierung der Belege, Sortierung/Gruppierung) – ohne DB, testbar.

export const REC_STATUSES = ['open', 'in_progress', 'done', 'dismissed'] as const;
export type RecStatus = (typeof REC_STATUSES)[number];
export const isRecStatus = (s: unknown): s is RecStatus => typeof s === 'string' && (REC_STATUSES as readonly string[]).includes(s);

export const STATUS_LABEL: Record<RecStatus, string> = { open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', dismissed: 'Verworfen' };

export const REC_TYPES = ['outreach', 'name_on_own_page', 'content_gap', 'technical', 'community', 'positioning', 'sentiment'] as const;
export const TYPE_LABEL: Record<string, string> = {
  outreach: 'Outreach',
  name_on_own_page: 'Eigene Seiten',
  content_gap: 'Content-Lücke',
  technical: 'Technik',
  community: 'Community',
  positioning: 'Positionierung',
  sentiment: 'Tonalität',
};
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

/** 1 gering · 2 mittel · 3 hoch (Werte außerhalb werden begrenzt). */
export function levelLabel(n: number | null | undefined): 'gering' | 'mittel' | 'hoch' {
  const v = Math.round(Number(n) || 2);
  return v <= 1 ? 'gering' : v >= 3 ? 'hoch' : 'mittel';
}

export type RecExample = { prompt: string | null; promptId: string | null; engine: string | null; url: string | null; title: string | null; snippet: string | null };
/** Kennzahl der Wirkungsmessung (CONTRACT „Maßnahmen“): evidence.baseline/current/previous und Spalte baseline. */
export type MetricSnap = { label: string; value: number | null; num: number | null; den: number | null; higherIsBetter: boolean; denLabel: string | null };
/** missing = KI-Suchen (Keys), in denen die eigene Marke bei dieser Frage fehlt */
export type RecPrompt = { id: string; text: string; missing: string[] };
export type RecUrl = { url: string; title: string | null; count: number | null; kind: 'cited' | 'searched' | null };
export type RecEvidence = {
  examples: RecExample[];
  prompts: RecPrompt[];
  urls: RecUrl[];
  competitors: { name: string; count: number | null }[];
  titleSuggestion: string | null;
  source: string | null;
  basePage: string | null;
  baseline: MetricSnap | null;
  current: MetricSnap | null;
  previous: MetricSnap | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Record<string, unknown> => !!x) : []);


/** Kennzahl-Objekt lesen; ohne Label oder ohne Wert/Zähler → null. */
export function parseMetric(raw: unknown): MetricSnap | null {
  const o = obj(raw);
  if (!o) return null;
  const label = str(o.label);
  const value = num(o.value);
  const n = num(o.num);
  const d = num(o.den);
  if (!label || (value === null && d === null)) return null;
  return { label, value: value === null ? null : Math.max(0, Math.min(1, value)), num: n, den: d, higherIsBetter: o.higherIsBetter !== false, denLabel: str(o.denLabel) || null };
}

const normText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** evidence-JSON robust lesen: fehlende oder falsch typisierte Felder werden zu leeren Werten. */
export function parseEvidence(raw: unknown): RecEvidence {
  const o = obj(raw) ?? {};
  const prompts: RecPrompt[] = arr(o.prompts).flatMap((p) => (isUuid(p.id) && str(p.text)
    ? [{ id: p.id, text: str(p.text)!, missing: Array.isArray(p.missing) ? p.missing.filter((x): x is string => typeof x === 'string') : [] }]
    : []));
  const promptByText = new Map(prompts.map((p) => [normText(p.text), p.id]));
  return {
    prompts,
    examples: arr(o.examples).map((e) => {
      const prompt = str(e.prompt) ?? str(e.promptText);
      return {
        prompt,
        promptId: isUuid(e.promptId) ? e.promptId : prompt ? promptByText.get(normText(prompt)) ?? null : null,
        engine: str(e.engine),
        url: safeUrl(e.url),
        title: str(e.title),
        snippet: str(e.snippet),
      };
    }).filter((e) => e.prompt || e.url || e.snippet),
    urls: arr(o.urls).flatMap((u) => {
      const url = safeUrl(u.url);
      return url ? [{ url, title: str(u.title), count: num(u.count), kind: u.kind === 'cited' || u.kind === 'searched' ? u.kind : null }] : [];
    }),
    competitors: arr(o.competitors).flatMap((c) => (str(c.name) ? [{ name: str(c.name)!, count: num(c.count) }] : [])),
    titleSuggestion: str(o.titleSuggestion),
    source: str(o.source),
    basePage: safeUrl(o.basePage),
    baseline: parseMetric(o.baseline),
    current: parseMetric(o.current),
    previous: parseMetric(o.previous),
  };
}

/** Veränderung bewerten: 'better' | 'worse' | 'same' | null (nicht vergleichbar). */
export function trend(before: MetricSnap | null, now: MetricSnap | null): 'better' | 'worse' | 'same' | null {
  if (!before || !now || before.value === null || now.value === null) return null;
  const d = now.value - before.value;
  if (Math.abs(d) < 1e-9) return 'same';
  return (d > 0) === now.higherIsBetter ? 'better' : 'worse';
}

export type RecLike = { id: string; status: string; priority: string | number; active: boolean; impact: number; effort: number; title: string; type: string };

/** Nach Priorität absteigend; bei Gleichstand höhere Wirkung, geringerer Aufwand, dann Titel. */
export function sortRecs<T extends RecLike>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) =>
    Number(b.priority) - Number(a.priority) || b.impact - a.impact || a.effort - b.effort || a.title.localeCompare(b.title, 'de'));
}

/** Die nächsten Schritte: Top-n offene, aktive Maßnahmen. */
export function nextUp<T extends RecLike>(xs: readonly T[], n = 3): T[] {
  return sortRecs(xs.filter((r) => r.active && r.status === 'open')).slice(0, n);
}

/** Aktive Maßnahmen nach Status gruppieren (feste Reihenfolge), optional nach Typ/Status gefiltert. */
export function groupRecs<T extends RecLike>(xs: readonly T[], f: { status?: string | null; type?: string | null } = {}) {
  const active = sortRecs(xs.filter((r) => r.active));
  const filtered = active.filter((r) => (!f.type || r.type === f.type) && (!f.status || r.status === f.status));
  const counts = Object.fromEntries(REC_STATUSES.map((s) => [s, active.filter((r) => (!f.type || r.type === f.type) && r.status === s).length])) as Record<RecStatus, number>;
  const groups = REC_STATUSES.map((s) => ({ status: s, label: STATUS_LABEL[s], items: filtered.filter((r) => r.status === s) })).filter((g) => g.items.length);
  const types = [...new Set(active.map((r) => r.type))].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b), 'de'));
  return { groups, counts, total: filtered.length, types, inactive: sortRecs(xs.filter((r) => !r.active)) };
}

/** Erlaubte Statuswechsel je Ausgangsstatus (für die Buttons). */
export function statusActions(s: string): { to: RecStatus; label: string; primary?: boolean }[] {
  switch (s) {
    case 'open': return [{ to: 'in_progress', label: 'Starten', primary: true }, { to: 'done', label: 'Erledigt' }, { to: 'dismissed', label: 'Verwerfen' }];
    case 'in_progress': return [{ to: 'done', label: 'Erledigt', primary: true }, { to: 'dismissed', label: 'Verwerfen' }, { to: 'open', label: 'Wieder öffnen' }];
    case 'done':
    case 'dismissed': return [{ to: 'open', label: 'Wieder öffnen' }];
    default: return [];
  }
}

/**
 * Spalte baseline beim Statuswechsel (Format wie evidence.current):
 * - Start/Erledigt aus „Offen“/„Verworfen“ oder bei leerer Baseline → evidence.current (= Stand bei Umsetzungsbeginn).
 * - „Wieder öffnen“ → zurück auf evidence.baseline (Stand bei Entstehung, wie vom Generator gesetzt), sonst null.
 * - sonst (z. B. In Arbeit → Erledigt, Verwerfen) unverändert.
 * Rückgabe undefined = Feld nicht ändern.
 */
export function nextBaseline(from: string, to: RecStatus, current: unknown, evidence: unknown): unknown {
  const e = obj(evidence) ?? {};
  if (to === 'open') return parseMetric(e.baseline) ? e.baseline : null;
  if (to !== 'in_progress' && to !== 'done') return undefined;
  if (from === 'in_progress' && parseMetric(current)) return undefined;
  if (parseMetric(e.current)) return e.current;
  return parseMetric(current) ? undefined : parseMetric(e.baseline) ? e.baseline : undefined;
}

/** Betrifft eine Maßnahme diese Frage? Schlüssel „content_gap:<id>“ oder die Frage steht in evidence.prompts / promptIds. */
export function recTouchesPrompt(key: string, evidence: unknown, promptId: string): boolean {
  if (key === `content_gap:${promptId}`) return true;
  const ev = evidence && typeof evidence === 'object' ? (evidence as Record<string, unknown>) : {};
  if (Array.isArray(ev.promptIds) && ev.promptIds.includes(promptId)) return true;
  return Array.isArray(ev.prompts) && ev.prompts.some((p) => p && typeof p === 'object' && (p as { id?: unknown }).id === promptId);
}

/** „17 von 50 Antworten (34 %)“ – Nenner mit Bezeichnung aus dem Core (denLabel), sonst „Antworten“. */
export function metricText(m: Pick<MetricSnap, 'num' | 'den' | 'value' | 'denLabel'>): string | null {
  if (m.num === null || m.den === null) return null;
  const unit = m.denLabel ?? (m.den === 1 ? 'Antwort' : 'Antworten');
  const pct = m.value === null ? '' : ` (${Math.round(m.value * 100)} %)`;
  return `${m.num} von ${m.den} ${unit}${pct}`;
}

/** Ganze Zeile „Paylindo genannt: 2 von 17 Antworten mit deiner Website als Quelle (12 %)“ – ohne die Basis doppelt zu nennen. */
export function metricLine(m: Pick<MetricSnap, 'label' | 'num' | 'den' | 'value' | 'denLabel'>): string {
  const t = metricText(m);
  if (!t) return m.label;
  let label = m.label;
  if (m.denLabel) {
    const tail = m.denLabel.replace(/^Antworten\s*/, '');
    const i = tail ? label.indexOf(` in Antworten ${tail}`) : -1;
    if (i > 0) label = label.slice(0, i);
  }
  return `${label}: ${t}`;
}
