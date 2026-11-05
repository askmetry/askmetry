// PDF-Layout (A4) mit @react-pdf/renderer: ruhig, viel Weißraum, eine Akzentfarbe, Kopf/Fuß mit Marke, Datum und Seitenzahl.
// Schrift: Inter (SIL OFL 1.1, eingebettet und automatisch auf die genutzten Zeichen reduziert) – Umlaute, €, →, ± sicher.
import { createRequire } from 'node:module';
import { Circle, Document, Font, Image, Page, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from '@react-pdf/renderer';
// React ausdrücklich importieren: Aufrufer (z. B. der Worker mit tsx) kompilieren JSX evtl. mit ihrer eigenen tsconfig (klassisch)
import React, { type ComponentProps, type ReactNode } from 'react';
void React;
import { isHosted, OPERATOR_LINE } from '@askmetry/core/hosted/config';
import type { DomainRow, ReportModel, ReportRec } from './data.ts';
import type { GuideBlock } from './guide.ts';
import {
  baseTierLabel, ciLine, comparisonSentence, engineExtremesLine, fmt, heroSentence, kindLabel, labels, methodParagraphs, placeLine, scopeLine, scopeNote, tierLabel,
} from './text.ts';

// ---------------------------------------------------------------------------
// Schrift
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const fontFile = (w: string) => require.resolve(`@expo-google-fonts/inter/${w}/Inter_${w}.ttf`);
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: 'Inter',
    fonts: [
      { src: fontFile('400Regular'), fontWeight: 400 },
      { src: fontFile('400Regular_Italic'), fontWeight: 400, fontStyle: 'italic' },
      { src: fontFile('600SemiBold'), fontWeight: 600 },
      { src: fontFile('700Bold'), fontWeight: 700 },
    ],
  });
  // keine (englische) Silbentrennung; lange URLs bekommen in clean() Umbruchstellen (Nullbreite-Leerzeichen)
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

/** Zeichen, die die Schrift nicht hat (Emojis, Steuerzeichen), entfernen. */
export function clean(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[‍️⃣]|\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    // lange Wörter/URLs: nach / . - ? & = umbrechbar machen (ohne Trennstrich)
    .replace(/\S{26,}/g, (w) => w.replace(/([/.?&=_-])(?=[^\s])/g, '$1\u200b'));
}

// ---------------------------------------------------------------------------
// Gestaltung
// ---------------------------------------------------------------------------

const C = {
  text: '#1d1d1f', muted: '#6b7079', faint: '#9aa0a8', line: '#e4e6ea', track: '#eef0f3', box: '#f6f7f9',
  accent: '#2b59c3', accentSoft: '#e8eefb', comp: '#a9afb8', bad: '#b42318',
};
/** Kategorie-Farben wie in der Web-App (DESIGN.md „Maßnahmen-Kategorien“); unbekannte Kategorien grau. */
const CAT: Record<string, string> = { content: '#4f46e5', offsite: '#0d9488', community: '#ea580c', technical: '#475569' };
const catColor = (cat: string) => CAT[cat] ?? C.faint;
const S = StyleSheet.create({
  // lineHeight nur an Texten (siehe T)
  page: { fontFamily: 'Inter', fontSize: 9.5, color: C.text, paddingTop: 64, paddingBottom: 60, paddingHorizontal: 56 },
  header: { position: 'absolute', top: 28, left: 56, right: 56, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: C.faint },
  footer: { position: 'absolute', bottom: 28, left: 56, right: 56, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: C.faint },
  hf: { fontSize: 8, color: C.faint, lineHeight: 1.2 },
  kicker: { fontSize: 8.5, fontWeight: 600, color: C.accent, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  h1: { fontSize: 20, fontWeight: 600, lineHeight: 1.25, marginBottom: 14 },
  h2: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, marginTop: 20, marginBottom: 8 },
  h3: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.35, marginBottom: 3 },
  p: { marginBottom: 6 },
  muted: { color: C.muted },
  small: { fontSize: 8, color: C.muted, lineHeight: 1.4 },
  row: { flexDirection: 'row' },
  th: { fontSize: 7.8, fontWeight: 600, color: C.muted, paddingVertical: 5, paddingRight: 6 },
  td: { fontSize: 8.8, paddingVertical: 5, paddingRight: 6 },
  trow: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: C.line },
  box: { backgroundColor: C.box, borderRadius: 6, padding: 12 },
});

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

type Style = NonNullable<ComponentProps<typeof View>['style']> extends infer U ? (U extends readonly unknown[] ? U[number] : U) : never;
type TextProps = { style?: Style | Style[]; children?: ReactNode; minPresenceAhead?: number; wrap?: boolean; fixed?: boolean };
/** Text mit Zeilenhöhe. Nie lineHeight an Page/View vererben: react-pdf 4.9 rechnet geerbte Zeilenhöhen falsch (riesige Abstände)
 *  und erzeugt zusammen mit render-Seitenzahlen kaputte Koordinaten. Schriftgröße/Farbe deshalb ebenfalls immer am Text. */
function T({ style, ...rest }: TextProps) {
  const list = (Array.isArray(style) ? style : style ? [style] : []) as Style[];
  return <Text style={[{ fontSize: 9.5, lineHeight: 1.4, color: C.text }, ...list] as Style[]} {...rest} />;
}

type Col<T> = { label: string; flex: number; align?: 'left' | 'right' | 'center'; cell: (r: T, i: number) => ReactNode };

function Table<T>({ cols, rows, highlight }: { cols: Col<T>[]; rows: T[]; highlight?: (r: T) => boolean }) {
  return (
    <View>
      <View style={[S.trow, { borderBottomColor: C.faint }]} minPresenceAhead={28}>
        {cols.map((c, i) => <T key={i} style={[S.th, { flex: c.flex, textAlign: c.align ?? 'left' }]}>{c.label}</T>)}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[S.trow, highlight?.(r) ? { backgroundColor: C.accentSoft } : {}]} wrap={false}>
          {cols.map((c, ci) => {
            const v = c.cell(r, ri);
            return typeof v === 'string' || typeof v === 'number'
              ? <T key={ci} style={[S.td, { flex: c.flex, textAlign: c.align ?? 'left' }, highlight?.(r) ? { fontWeight: 600 } : {}]}>{clean(String(v))}</T>
              : <View key={ci} style={[S.td, { flex: c.flex, justifyContent: 'flex-start', alignItems: c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start' }]}>{v}</View>;
          })}
        </View>
      ))}
    </View>
  );
}

function Bar({ value, own, width = 190 }: { value: number | null; own?: boolean; width?: number }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <View style={{ width, height: 7, backgroundColor: C.track, borderRadius: 3.5 }}>
      <View style={{ width: Math.max(v > 0 ? 3 : 0, width * v), height: 7, backgroundColor: own ? C.accent : C.comp, borderRadius: 3.5 }} />
    </View>
  );
}

/** Punkt für „genannt“: voll = immer, Ring = nie, Ring mit Akzent = teilweise. */
function Dot({ named, total }: { named: number; total: number }) {
  if (!total) return <T style={{ fontSize: 8, color: C.faint }}>–</T>;
  const all = named === total;
  const none = named === 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Svg width={8} height={8} viewBox="0 0 8 8">
        <Circle cx={4} cy={4} r={3.2} fill={all ? C.accent : 'none'} stroke={none ? C.comp : C.accent} strokeWidth={0.9} />
      </Svg>
      {total > 1 && <T style={{ fontSize: 7.2, color: none ? C.faint : C.text, marginLeft: 3 }}>{named}/{total}</T>}
    </View>
  );
}

const Section = ({ kicker, title, children, breakBefore = true }: { kicker?: string; title: string; children: ReactNode; breakBefore?: boolean }) => (
  <View break={breakBefore}>
    {kicker && <T style={S.kicker}>{kicker}</T>}
    <T style={S.h1}>{clean(title)}</T>
    {children}
  </View>
);

const P = ({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: Style }) => (
  <T style={[S.p, muted ? S.muted : {}, style ?? {}]}>{typeof children === 'string' ? clean(children) : children}</T>
);

/**
 * Wirkung als Stufen-Balken (1–3 gefüllte Balken, wie eine Signalanzeige) plus Wort – nicht nur über Farbe unterscheidbar.
 * Große Wirkung zusätzlich fett.
 */
export function ImpactMeter({ impact, label, size = 8 }: { impact: number; label: string; size?: number }) {
  const level = impact >= 3 ? 3 : impact === 2 ? 2 : 1;
  const bw = size * 0.32, gap = size * 0.16;
  const w = bw * 3 + gap * 2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Svg width={w} height={size} viewBox={`0 0 ${w} ${size}`}>
        {[0, 1, 2].map((i) => {
          const h = size * (0.45 + i * 0.275);
          return <Rect key={i} x={i * (bw + gap)} y={size - h} width={bw} height={h} rx={bw / 3} ry={bw / 3} fill={i < level ? C.text : C.line} />;
        })}
      </Svg>
      <T style={{ fontSize: size, lineHeight: 1.2, marginLeft: size * 0.45, color: level === 1 ? C.muted : C.text, fontWeight: level === 3 ? 600 : 400 }}>{label}</T>
    </View>
  );
}

/** Kategorie als Farbpunkt + Wort (Farbe nur ergänzend). */
function CategoryLabel({ r, extra }: { r: ReportRec; extra?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Svg width={6} height={6} viewBox="0 0 6 6"><Circle cx={3} cy={3} r={2.6} fill={catColor(r.category)} /></Svg>
      <T style={{ fontSize: 8, lineHeight: 1.2, color: C.muted, marginLeft: 4 }}>{clean(r.categoryLabel)}{extra ? ` · ${extra}` : ''}</T>
    </View>
  );
}

/**
 * Markenlogo als ruhige Kachel (Radius 22 %, weiße Platte, feiner Rand, 10 % Innenabstand – wie BrandMark in der Web-App).
 * Ohne darstellbares Logo die Initiale (eigene Marke in Akzentfarbe, sonst grau).
 */
export function BrandLogo({ m, id, name, own = false, size = 14 }: { m: ReportModel; id: string | null | undefined; name: string; own?: boolean; size?: number }) {
  const logo = id ? m.logos[id] : undefined;
  const box = { width: size, height: size, borderRadius: size * 0.22 };
  if (logo) {
    const pad = Math.max(0.8, size * 0.1);
    return (
      <View style={[box, { backgroundColor: '#ffffff', borderWidth: 0.5, borderColor: C.line, padding: pad, alignItems: 'center', justifyContent: 'center' }]}>
        <Image src={logo.format === 'svg' ? logo.data : { data: logo.data, format: logo.format }} style={{ width: size - 2 * pad - 1, height: size - 2 * pad - 1, objectFit: 'contain' }} />
      </View>
    );
  }
  const initial = (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  return (
    <View style={[box, { backgroundColor: own ? C.accentSoft : C.track, alignItems: 'center', justifyContent: 'center' }]}>
      <T style={{ fontSize: size * 0.5, lineHeight: 1, fontWeight: 600, color: own ? C.accent : C.muted }}>{initial}</T>
    </View>
  );
}

/** brand.id zu einem Markennamen (für Zeilen, die nur den Namen kennen). */
const brandIdByName = (m: ReportModel, name: string) => m.brands.find((b) => b.name.toLowerCase() === name.toLowerCase())?.id ?? null;

// ---------------------------------------------------------------------------
// Seiten
// ---------------------------------------------------------------------------

export function Cover({ m }: { m: ReportModel }) {
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const tier = tierLabel(m.tier, m.kind, m.lang);
  const note = scopeNote(m);
  return (
    <Page size="A4" style={[S.page, { paddingTop: 72, paddingBottom: 56 }]}>
      <T style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }}>Askmetry</T>
      <View style={{ marginTop: m.logos[m.own.id ?? ''] ? 140 : 200 }}>
        {m.logos[m.own.id ?? ''] && <View style={{ marginBottom: 20 }}><BrandLogo m={m} id={m.own.id} name={m.brand.name} own size={52} /></View>}
        <T style={[S.kicker, { fontSize: 10 }]}>{m.kind === 'remeasure' ? `${tier} · ${baseTierLabel(m.tier, m.lang)}` : tier}</T>
        <T style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15, marginBottom: 8 }}>{clean(m.brand.name)}</T>
        {m.brand.domains.length > 0 && <T style={{ fontSize: 12, color: C.muted }}>{clean(m.brand.domains.join(' · '))}</T>}
        <View style={{ width: 48, height: 2, backgroundColor: C.accent, marginTop: 28, marginBottom: 28 }} />
        <T style={{ fontSize: 11, marginBottom: 4 }}>{L.reportFrom} {f.date(m.date)}</T>
        <T style={{ fontSize: 11, marginBottom: 4 }}>{scopeLine(m)}</T>
        {note && <T style={{ fontSize: 9.5, color: C.muted }}>{note}</T>}
        {m.comparison && <T style={{ fontSize: 9.5, color: C.muted, marginTop: 4 }}>{L.comparedWith} {f.date(m.comparison.date)}</T>}
      </View>
      <View style={{ position: 'absolute', bottom: 56, left: 56, right: 56 }}>
        <T style={S.small}>{L.createdWith}</T>
        <T style={S.small}>{isHosted() ? `askmetry.ai · ${OPERATOR_LINE}` : 'askmetry.ai'}</T>
      </View>
    </Page>
  );
}

function RecLine({ r, n }: { r: ReportRec; n: number }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 10 }} wrap={false}>
      <T style={{ width: 18, fontWeight: 600, color: C.accent }}>{n}</T>
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: 600, marginBottom: 2 }}>{clean(r.title)}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ImpactMeter impact={r.impact} label={r.impactText} />
          <View style={{ marginLeft: 12 }}><CategoryLabel r={r} /></View>
        </View>
      </View>
    </View>
  );
}

export function Summary({ m }: { m: ReportModel }) {
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const ci = ciLine(m);
  const place = placeLine(m);
  const ext = engineExtremesLine(m);
  const bars = [...m.brands.filter((b) => !b.own).slice(0, 5), m.own].sort((a, b) => b.named - a.named || Number(b.own) - Number(a.own));
  const c = m.comparison;
  return (
    <Section kicker={L.s1} title={m.lang === 'en' ? `Where ${m.brand.name} stands in AI search` : `So steht ${m.brand.name} in KI-Suchen da`} breakBefore={false}>
      {c && (
        <View style={[S.box, { marginBottom: 16 }]} wrap={false}>
          <T style={S.h3}>{L.beforeAfter}</T>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 4, marginBottom: 6 }}>
            <View style={{ marginRight: 28 }}>
              <T style={S.small}>{L.before} · {f.dateShort(c.date)}</T>
              <T style={{ fontSize: 22, fontWeight: 600, color: C.muted }}>{c.before.rate == null ? '–' : Math.round(c.before.rate * 100)}</T>
              <T style={S.small}>{c.before.ci ? `${L.range} ${Math.round(c.before.ci.lo * 100)}–${Math.round(c.before.ci.hi * 100)}` : ''}</T>
            </View>
            <T style={{ fontSize: 18, color: C.faint, marginRight: 28, marginBottom: 14 }}>→</T>
            <View style={{ marginRight: 28 }}>
              <T style={S.small}>{L.now} · {f.dateShort(m.date)}</T>
              <T style={{ fontSize: 22, fontWeight: 600 }}>{c.after.rate == null ? '–' : Math.round(c.after.rate * 100)}</T>
              <T style={S.small}>{c.after.ci ? `${L.range} ${Math.round(c.after.ci.lo * 100)}–${Math.round(c.after.ci.hi * 100)}` : ''}</T>
            </View>
            <View>
              <T style={S.small}>{L.change}</T>
              <T style={{ fontSize: 22, fontWeight: 600, color: !c.withinNoise && (c.delta ?? 0) < 0 ? C.bad : !c.withinNoise ? C.accent : C.text }}>{f.pp(c.delta)}</T>
              <T style={S.small}> </T>
            </View>
          </View>
          <T style={{ fontSize: 8.8 }}>{clean(comparisonSentence(m))}</T>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
        <View style={{ width: 120 }}>
          <T style={S.small}>{L.visibility}</T>
          <T style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.05, color: C.accent }}>{m.score}</T>
          <T style={S.small}>{L.of100}</T>
        </View>
        <View style={{ flex: 1, paddingTop: 12 }}>
          <T style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{m.verdict.label}</T>
          <T style={{ fontSize: 10.5, marginBottom: 4 }}>{clean(heroSentence(m))}</T>
          {ci && <T style={S.small}>{ci}</T>}
          {place && <T style={S.small}>{place}</T>}
        </View>
      </View>
      {m.keyInsight?.kind === 'source_not_named' && (
        <View style={{ borderLeftWidth: 2, borderLeftColor: C.accent, paddingLeft: 10, marginTop: 10, marginBottom: 4 }}>
          <T style={{ fontSize: 10 }}>{clean(m.keyInsight.text)}</T>
        </View>
      )}

      <T style={S.h2} minPresenceAhead={70}>{L.vsCompetitors}</T>
      {bars.map((b, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }} wrap={false}>
          <BrandLogo m={m} id={b.id} name={b.name} own={b.own} size={13} />
          <T style={{ width: 122, marginLeft: 7, lineHeight: 1.2, fontWeight: b.own ? 600 : 400 }}>{clean(b.name)}{b.own ? ` (${L.you})` : ''}</T>
          <Bar value={b.rate} own={b.own} width={196} />
          <T style={{ marginLeft: 10, width: 40, lineHeight: 1.2, textAlign: 'right', fontWeight: b.own ? 600 : 400 }}>{f.pct(b.rate)}</T>
          <T style={[S.small, { marginLeft: 10, lineHeight: 1.2 }]}>{f.of(b.named, m.scope.responses)}</T>
        </View>
      ))}
      {ext && <T style={[S.small, { marginTop: 4 }]}>{ext}</T>}

      <T style={S.h2} minPresenceAhead={70}>{L.topActions}</T>
      {m.topRecs.length ? m.topRecs.map((r, i) => <RecLine key={i} r={r} n={i + 1} />) : <P muted>{L.noRecs}</P>}
    </Section>
  );
}

export function Engines({ m }: { m: ReportModel }) {
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const rows = m.engines.filter((e) => e.responses > 0 || e.noAiAnswer > 0);
  return (
    <Section kicker={L.s2} title={m.lang === 'en' ? 'How each AI engine answers' : 'So antwortet jede KI-Suche'}>
      <P muted>{m.lang === 'en'
        ? `Visibility = share of answers that mention ${m.brand.name}. Basis: ${m.scope.responses} evaluable answers.`
        : `Sichtbarkeit = Anteil der Antworten, die ${m.brand.name} nennen. Basis: ${m.scope.responses} auswertbare Antworten.`}</P>
      <Table
        rows={rows}
        cols={[
          { label: L.engine, flex: 1.5, cell: (e) => (
            <View>
              <T style={{ fontSize: 8.8 }}>{f.engine(e.engine)}</T>
              {e.noAiAnswer > 0 && <T style={{ fontSize: 7.2, color: C.muted }}>{L.noAi(e.noAiAnswer)}</T>}
            </View>
          ) },
          { label: L.named, flex: 1, align: 'right', cell: (e) => f.of(e.named, e.responses) },
          { label: L.vis, flex: 0.9, align: 'right', cell: (e) => f.pct(e.rate) },
          { label: L.avgPos, flex: 0.8, align: 'right', cell: (e) => f.num(e.avgPosition) },
          { label: L.ownSite, flex: 1.2, align: 'right', cell: (e) => f.of(e.ownSite, e.responses) },
          { label: L.leader, flex: 1.6, cell: (e) => (e.top ? `${e.top.name} · ${f.pct(e.top.rate)}` : '–') },
        ]}
      />
      {m.comparison && <ChangeDetail m={m} />}
      <T style={S.h2} minPresenceAhead={70}>{m.lang === 'en' ? 'All tracked brands' : 'Alle verglichenen Marken'}</T>
      <Table
        rows={m.brands}
        highlight={(b) => b.own}
        cols={[
          { label: L.brandCol, flex: 1.6, cell: (b) => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <BrandLogo m={m} id={b.id} name={b.name} own={b.own} size={11} />
              <T style={{ fontSize: 8.8, lineHeight: 1.2, marginLeft: 5, fontWeight: b.own ? 600 : 400 }}>{clean(b.name)}</T>
            </View>
          ) },
          { label: L.named, flex: 1, align: 'right', cell: (b) => f.of(b.named, m.scope.responses) },
          { label: L.vis, flex: 0.9, align: 'right', cell: (b) => f.pct(b.rate) },
          { label: L.avgPos, flex: 0.8, align: 'right', cell: (b) => f.num(b.avgPosition) },
          { label: L.recommended, flex: 0.9, align: 'right', cell: (b) => f.pct(b.recommendationRate) },
          { label: L.sov, flex: 1.1, align: 'right', cell: (b) => f.pct(b.sov) },
        ]}
      />
      <T style={[S.small, { marginTop: 6 }]}>{m.lang === 'en'
        ? 'Position: 1 = mentioned first; shown from 5 mentions. Recommended: share of answers that explicitly recommend the brand. Share of voice: share of all brand mentions in the answers, including brands not tracked.'
        : 'Platz: 1 = zuerst genannt; gezeigt ab 5 Nennungen. Empfohlen: Anteil der Antworten, die die Marke ausdrücklich empfehlen. Anteil an allen Nennungen: auch nicht verglichene Marken zählen mit.'}</T>
    </Section>
  );
}

/** Nachmessung: Veränderung je KI-Suche und je Wettbewerber. */
function ChangeDetail({ m }: { m: ReportModel }) {
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const c = m.comparison!;
  const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : b - a);
  const rows = [
    ...c.engines.map((e) => ({ name: f.engine(e.engine), before: e.before, after: e.after, own: false })),
  ];
  const comps = [{ name: m.brand.name, before: c.before.rate, after: c.after.rate, own: true }, ...c.competitors.slice(0, 5).map((x) => ({ ...x, own: false }))];
  const cols = (first: string) => [
    { label: first, flex: 2, cell: (r: typeof rows[number]) => (first === L.brandCol ? (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <BrandLogo m={m} id={r.own ? m.own.id : brandIdByName(m, r.name)} name={r.name} own={r.own} size={11} />
        <T style={{ fontSize: 8.8, lineHeight: 1.2, marginLeft: 5, fontWeight: r.own ? 600 : 400 }}>{clean(r.name)}</T>
      </View>
    ) : r.name) },
    { label: `${L.before} (${f.dateShort(c.date)})`, flex: 1.3, align: 'right' as const, cell: (r: typeof rows[number]) => f.pct(r.before) },
    { label: `${L.now} (${f.dateShort(m.date)})`, flex: 1.3, align: 'right' as const, cell: (r: typeof rows[number]) => f.pct(r.after) },
    { label: L.change, flex: 1.1, align: 'right' as const, cell: (r: typeof rows[number]) => f.pp(delta(r.before, r.after)) },
  ];
  const en = m.lang === 'en';
  return (
    <View>
      <T style={S.h2} minPresenceAhead={70}>{en ? `Change by AI engine – ${m.brand.name}` : `Veränderung je KI-Suche – ${m.brand.name}`}</T>
      <Table rows={rows} cols={cols(L.engine)} />
      <T style={S.h2} minPresenceAhead={70}>{en ? 'Change compared with competitors' : 'Veränderung im Vergleich mit den Wettbewerbern'}</T>
      <Table rows={comps} cols={cols(L.brandCol)} highlight={(r) => r.own} />
      <T style={[S.small, { marginTop: 6 }]}>{en
        ? `Questions where ${m.brand.name} is now mentioned for the first time: ${c.questionsGained}. No longer mentioned: ${c.questionsLost}. Per engine there are few answers – differences there vary even more than the total.`
        : `Fragen, bei denen ${m.brand.name} jetzt neu genannt wird: ${c.questionsGained}. Nicht mehr genannt: ${c.questionsLost}. Je KI-Suche gibt es nur wenige Antworten – dort schwanken Unterschiede noch stärker als beim Gesamtwert.`}</T>
    </View>
  );
}

export function Questions({ m }: { m: ReportModel }) {
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const engines = m.engines.filter((e) => e.responses > 0).map((e) => e.engine);
  const topics = new Set(m.questions.map((q) => q.topic ?? ''));
  const showTopic = topics.size > 1;
  const multi = m.scope.repetitions > 1;
  return (
    <Section kicker={L.s3} title={m.lang === 'en' ? `Where ${m.brand.name} is mentioned – and where not` : `Wo ${m.brand.name} genannt wird – und wo nicht`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Dot named={1} total={1} /><T style={[S.small, { marginLeft: 4, marginRight: 14 }]}>{L.legendYes}</T>
        <Dot named={0} total={1} /><T style={[S.small, { marginLeft: 4, marginRight: 14 }]}>{L.legendNo}</T>
        {multi && <><Dot named={1} total={2} /><T style={[S.small, { marginLeft: 4 }]}>{L.legendPart}</T></>}
      </View>
      {[...topics].map((t) => {
        const qs = m.questions.filter((q) => (q.topic ?? '') === t);
        return (
          <View key={t} style={{ marginBottom: 12 }}>
            {showTopic && <T style={S.h3}>{clean(t || (m.lang === 'en' ? 'Other questions' : 'Weitere Fragen'))}</T>}
            <Table
              rows={qs}
              cols={[
                { label: L.question, flex: 3.6, cell: (q) => (
                  <View>
                    <T style={{ fontSize: 8.6 }}>{clean(q.text)}</T>
                    {q.others.length > 0 && <T style={{ fontSize: 7.2, color: C.muted }}>{L.othersNamed}: {clean(q.others.map((o) => o.name).join(', '))}</T>}
                  </View>
                ) },
                ...engines.map((e) => ({ label: f.engine(e).replace(/^Google[- ]/, (g) => (g === 'Google-' ? 'Google-\n' : 'Google\n')), flex: 0.85, align: 'center' as const, cell: (q: typeof qs[number]) => <Dot named={q.cells[e]?.named ?? 0} total={q.cells[e]?.total ?? 0} /> })),
                { label: L.total, flex: 0.75, align: 'right' as const, cell: (q) => f.of(q.named, q.responses) },
              ]}
            />
          </View>
        );
      })}
    </Section>
  );
}

function domainType(d: DomainRow, L: ReturnType<typeof labels>) {
  return d.type === 'own' ? L.typeOwn : d.type === 'competitor' ? L.typeComp(d.brandName ?? '') : L.typeOther;
}

export function Sources({ m }: { m: ReportModel }) {
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const en = m.lang === 'en';
  const N = m.scope.responses;
  const s = m.sources;
  const ownDomain = m.brand.domains[0] ?? (en ? 'your website' : 'deine Website');
  return (
    <Section kicker={L.s4} title={en ? 'Which sources the AI engines rely on' : 'Auf welche Quellen sich die KIs stützen'}>
      <P muted>{L.sourcesNote}</P>
      <T style={S.h2} minPresenceAhead={70}>{L.ownSiteH}</T>
      <P>{en
        ? `${ownDomain} is a source in ${f.of(s.ownSite.responses, N)} answers (${f.pct(N ? s.ownSite.responses / N : null)}). ${m.brand.name} is mentioned in ${s.ownSite.named} of them.`
        : `${ownDomain} ist in ${f.of(s.ownSite.responses, N)} Antworten Quelle (${f.pct(N ? s.ownSite.responses / N : null)}). In ${s.ownSite.named} davon wird ${m.brand.name} auch genannt.`}</P>
      {s.ownSite.pages.length > 0 && (
        <Table rows={s.ownSite.pages} cols={[
          { label: en ? 'Page' : 'Seite', flex: 4, cell: (p) => (
            <View><T style={{ fontSize: 8.6 }}>{clean(p.title)}</T><T style={{ fontSize: 7.2, color: C.muted }}>{clean(p.url.replace(/^https?:\/\//, ''))}</T></View>
          ) },
          { label: L.answers, flex: 1, align: 'right', cell: (p) => String(p.responses) },
        ]} />
      )}

      <T style={S.h2} minPresenceAhead={70}>{L.compOnlyH}</T>
      {s.competitorOnly.length ? (
        <>
          <P muted>{en ? 'These sites are used in answers that mention competitors but not you – the most promising places to appear.' : 'Diese Seiten nutzen die KIs in Antworten, die Wettbewerber nennen, dich aber nicht – hier lohnt es sich am meisten, vorzukommen.'}</P>
          <Table rows={s.competitorOnly} cols={[
            { label: L.domain, flex: 2.2, cell: (d) => d.domain },
            { label: L.type, flex: 1.8, cell: (d) => domainType(d, L) },
            { label: L.compOnlyCol, flex: 1.6, align: 'right', cell: (d) => String(d.competitorOnly) },
          ]} />
        </>
      ) : <P muted>{en ? 'None in this measurement.' : 'Keine in dieser Messung.'}</P>}

      <T style={S.h2} minPresenceAhead={70}>{L.topSourcesH}</T>
      <Table rows={s.top.slice(0, 12)} highlight={(d) => d.type === 'own'} cols={[
        { label: L.domain, flex: 2.2, cell: (d) => d.domain },
        { label: L.type, flex: 1.8, cell: (d) => domainType(d, L) },
        { label: L.answers, flex: 1.1, align: 'right', cell: (d) => f.of(d.responses, N) },
        { label: '', flex: 1.3, cell: (d) => <View style={{ paddingTop: 3 }}><Bar value={d.share} own={d.type === 'own'} width={70} /></View> },
      ]} />

      {s.competitorSites.length > 0 && (
        <>
          <T style={S.h2} minPresenceAhead={70}>{L.compSitesH}</T>
          <P>{clean(s.competitorSites.map((c) => `${c.name} (${c.domain}): ${f.of(c.responses, N)}`).join(' · '))}</P>
        </>
      )}
    </Section>
  );
}

export function Recs({ m }: { m: ReportModel }) {
  const L = labels(m.lang);
  const en = m.lang === 'en';
  return (
    <Section kicker={L.s5} title={en ? 'What brings you forward' : 'Was dich nach vorn bringt'}>
      {m.recs.length === 0 && <P muted>{L.noRecs}</P>}
      {m.recs.length > 0 && <P muted>{en ? 'Sorted by priority – the bars show the expected impact. Each action has a ready-made prompt for your AI in the appendix.' : 'Sortiert nach Priorität – die Balken zeigen die erwartete Wirkung. Zu jeder Maßnahme gibt es im Anhang einen fertigen Prompt für deine KI.'}</P>}
      {m.recs.length > 0 && <ImpactLegend m={m} />}
      {m.recs.map((r, i) => (
        <View key={r.key} style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 0.6, borderTopColor: C.line }} wrap={r.steps.length > 8 || r.why.length > 900}>
          <View style={{ flexDirection: 'row' }}>
            <T style={{ width: 22, fontSize: 10.5, fontWeight: 600, color: C.accent }}>{i + 1}</T>
            <View style={{ flex: 1 }}>
              <View style={{ marginBottom: 3 }}><CategoryLabel r={r} extra={L.status[r.status] || undefined} /></View>
              <T style={S.h3}>{clean(r.title)}</T>
              <View style={{ marginTop: 1, marginBottom: 6 }}><ImpactMeter impact={r.impact} label={r.impactText} size={8.5} /></View>
              <T style={{ marginBottom: 5 }}>{clean(r.why)}</T>
              {r.steps.map((s, j) => (
                <View key={j} style={{ flexDirection: 'row', marginBottom: 2 }}>
                  <T style={{ width: 14, color: C.muted }}>{j + 1}.</T>
                  <T style={{ flex: 1 }}>{clean(s)}</T>
                </View>
              ))}
              <T style={[S.small, { marginTop: 4 }]}>{L.withAi}: {clean(r.deliverable.replace(/^(Deine KI liefert dir|Your AI delivers):\s*/, ''))} {L.promptRef(i + 1)}.</T>
            </View>
          </View>
        </View>
      ))}
    </Section>
  );
}

/** Strategiebericht: Ergebnisse je Thema. */
export function Topics({ m }: { m: ReportModel }) {
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const en = m.lang === 'en';
  if (!m.topics.length) return null;
  return (
    <Section kicker={L.s6} title={en ? 'Where you stand by topic' : 'Wo du je Thema stehst'}>
      <Table rows={m.topics} cols={[
        { label: L.topicCol, flex: 1.9, cell: (t) => t.name || (en ? 'Other questions' : 'Weitere Fragen') },
        { label: L.prompts, flex: 0.6, align: 'right', cell: (t) => String(t.prompts) },
        { label: L.vis, flex: 1.1, align: 'right', cell: (t) => (
          <View style={{ alignItems: 'flex-end' }}><T style={{ fontSize: 8.8 }}>{f.pct(t.rate)}</T><T style={{ fontSize: 7.2, color: C.muted }}>{f.of(t.named, t.responses)}</T></View>
        ) },
        { label: L.leader, flex: 1.4, cell: (t) => (t.top ? `${t.top.name} · ${f.pct(t.top.rate)}` : '–') },
        { label: L.topDomains, flex: 2.2, cell: (t) => t.domains.map((d) => d.domain).join(', ') || '–' },
      ]} />
    </Section>
  );
}

/** Legende der Wirkungs-Balken. */
function ImpactLegend({ m }: { m: ReportModel }) {
  const L = labels(m.lang);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
      <T style={[S.small, { marginRight: 8, lineHeight: 1.2 }]}>{L.impactH}:</T>
      {[1, 2, 3].map((lv) => (
        <View key={lv} style={{ marginRight: 12 }}><ImpactMeter impact={lv} label={L.impactLevels[lv - 1]} size={7.5} /></View>
      ))}
    </View>
  );
}

/**
 * 30-Tage-Plan (Strategiebericht): vier Wochen als Spalten auf einer Zeitleiste, je Woche wenige Karten
 * (Kategorie-Farbe, Titel, Wirkung, Verweis auf die Maßnahme). Danach die Nachmessung, darunter der Rest als eine Zeile.
 */
export function Plan({ m }: { m: ReportModel }) {
  const L = labels(m.lang);
  const p = m.plan;
  if (!p) return null;
  const idx = new Map(m.recs.map((r, i) => [r.key, i + 1]));
  const planned = p.weeks.reduce((a, w) => a + w.items.length, 0);
  const open = planned + p.later.length;
  return (
    <Section kicker={L.sPlan} title={L.planTitle}>
      {planned === 0 ? <P muted>{m.recs.length ? L.planAllDone : L.noRecs}</P> : (
        <>
          <P muted>{L.planIntro(planned, open)}</P>
          <View style={{ flexDirection: 'row', marginTop: 14 }}>
            {p.weeks.map((w, i) => (
              <View key={w.week} style={{ flex: 1, marginRight: i < 3 ? 8 : 0 }}>
                {/* Zeitleiste: Punkt + Linie bis zur nächsten Woche */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <Svg width={10} height={10} viewBox="0 0 10 10"><Circle cx={5} cy={5} r={4} fill={w.items.length ? C.accent : '#ffffff'} stroke={C.accent} strokeWidth={1.2} /></Svg>
                  <View style={{ flex: 1, height: 1.5, backgroundColor: i < 3 ? C.accent : C.line, marginRight: i < 3 ? -8 : 0 }} />
                </View>
                <T style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.2 }}>{L.week(w.week)}</T>
                <T style={[S.small, { marginBottom: 8 }]}>{L.weekDays(w.week)}</T>
                {w.items.length === 0 && <T style={[S.small, { color: C.faint }]}>{L.planEmptyWeek}</T>}
                {w.items.map((r) => (
                  <View key={r.key} style={{ backgroundColor: C.box, borderRadius: 5, borderLeftWidth: 2.5, borderLeftColor: catColor(r.category), padding: 7, marginBottom: 7 }} wrap={false}>
                    <T style={{ fontSize: 7.4, lineHeight: 1.2, color: C.muted, marginBottom: 3 }}>{clean(r.categoryLabel)}</T>
                    <T style={{ fontSize: 8.6, fontWeight: 600, lineHeight: 1.3, marginBottom: 5 }}>{clean(r.title)}</T>
                    <ImpactMeter impact={r.impact} label={r.impactText} size={7.5} />
                    <T style={{ fontSize: 7.2, lineHeight: 1.2, color: C.faint, marginTop: 4 }}>{L.actionRef(idx.get(r.key) ?? 0)}</T>
                  </View>
                ))}
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 10, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 10 }} wrap={false}>
            <Svg width={12} height={12} viewBox="0 0 12 12" style={{ marginTop: 1 }}>
              <Rect x={1} y={1} width={1.4} height={10} fill={C.accent} />
              <Rect x={2.4} y={1.4} width={8} height={5} rx={0.8} ry={0.8} fill={C.accent} />
            </Svg>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <T style={{ fontWeight: 600 }}>{L.planAfterH}</T>
              <T style={[S.small, { color: C.text }]}>{L.planAfter}</T>
              {p.later.length > 0 && <T style={[S.small, { marginTop: 4 }]}>{L.planLater(p.later.length)}</T>}
            </View>
          </View>
          <View style={{ marginTop: 14 }}><ImpactLegend m={m} /></View>
        </>
      )}
    </Section>
  );
}

/** Inline **fett** in Text-Teile zerlegen. */
function rich(text: string): ReactNode[] {
  return clean(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
    .map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <Text key={i} style={{ fontWeight: 600 }}>{part.slice(2, -2)}</Text> : part));
}

function GuideBlockView({ b }: { b: GuideBlock }) {
  switch (b.kind) {
    case 'h2': return <T style={S.h2} minPresenceAhead={60}>{rich(b.text)}</T>;
    case 'h3': return <T style={[S.h3, { marginTop: 6 }]} minPresenceAhead={40}>{rich(b.text)}</T>;
    case 'p': return <T style={S.p}>{rich(b.text)}</T>;
    case 'ul':
    case 'ol':
      return (
        <View style={{ marginBottom: 6 }}>
          {b.items.map((it, i) => (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 2 }} wrap={false}>
              <T style={{ width: 14, color: C.muted }}>{b.kind === 'ol' ? `${i + 1}.` : '•'}</T>
              <T style={{ flex: 1 }}>{rich(it)}</T>
            </View>
          ))}
        </View>
      );
  }
}

/** GEO-Leitfaden/FAQ: Inhalt aus `src/guide/geo-leitfaden.<lang>.md` (siehe guide.ts). Ohne Datei entfällt das Kapitel. */
export function Guide({ m }: { m: ReportModel }) {
  const L = labels(m.lang);
  const g = m.guide;
  if (!g || (!g.blocks.length && !g.intro)) return null;
  return (
    <Section kicker={L.sGuide} title={g.title ?? (m.lang === 'en' ? 'How AI search works – and what helps' : 'So funktioniert KI-Suche – und was hilft')}>
      {g.intro && <P muted>{rich(g.intro)}</P>}
      {g.blocks.map((b, i) => <GuideBlockView key={i} b={b} />)}
    </Section>
  );
}

export function Method({ m }: { m: ReportModel }) {
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const en = m.lang === 'en';
  const kind = kindLabel(m.brand.kind, m.lang);
  const models = m.models.map((x) => `${f.engine(x.engine)}: ${x.models.length ? x.models.join(', ') : x.engine.startsWith('google_') ? (en ? 'Google results page (DataForSEO)' : 'Google-Ergebnisseite (DataForSEO)') : '–'}`);
  return (
    <Section kicker={L.s7} title={en ? 'How we measured – and what the numbers can’t tell' : 'Wie wir gemessen haben – und was die Zahlen nicht sagen'}>
      {methodParagraphs(m).map((p, i) => (
        <View key={i} style={{ marginBottom: 10 }} wrap={false}>
          <T style={S.h3}>{p.title}</T>
          <T>{clean(p.text)}</T>
        </View>
      ))}
      <View style={[S.box, { marginTop: 8 }]} wrap={false}>
        <T style={S.small}><Text style={{ fontWeight: 600, color: C.text }}>{L.scope}: </Text>{scopeLine(m)}{scopeNote(m) ? ` ${scopeNote(m)}` : ''}</T>
        <T style={S.small}><Text style={{ fontWeight: 600, color: C.text }}>{L.period}: </Text>{f.dateShort(m.period.from)} – {f.dateShort(m.period.to)}</T>
        <T style={S.small}><Text style={{ fontWeight: 600, color: C.text }}>{L.models}: </Text>{clean(models.join(' · '))}</T>
        {kind && <T style={S.small}><Text style={{ fontWeight: 600, color: C.text }}>{L.kind}: </Text>{kind}</T>}
        {m.comparison && <T style={S.small}><Text style={{ fontWeight: 600, color: C.text }}>{L.comparedWith} </Text>{f.date(m.comparison.date)} ({m.comparison.responses} {en ? 'evaluable answers' : 'auswertbare Antworten'})</T>}
      </View>
    </Section>
  );
}

/** Markdown-Prompt leicht formatiert: Überschriften fett, Listen eingerückt, Markierungen (** _) entfernt. */
export function PromptText({ text, skipTitle }: { text: string; skipTitle?: boolean }) {
  const all = clean(text).split('\n');
  // die erste Überschrift (= Titel der Maßnahme) steht schon über dem Kasten
  const lines = skipTitle && /^#\s/.test(all[0] ?? '') ? all.slice(all[1]?.trim() ? 1 : 2) : all;
  return (
    <View>
      {lines.map((raw, i) => {
        const line = raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)_(.+?)_(?=\s|$|[.,;:])/g, '$1$2');
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;
        const h = /^(#{1,3})\s+(.*)$/.exec(line);
        if (h) return <T key={i} style={{ fontSize: h[1].length === 1 ? 9.5 : 8.6, fontWeight: 600, marginTop: h[1].length === 1 ? 0 : 3, marginBottom: 1 }}>{h[2]}</T>;
        const li = /^(\s*)(- \[ \]|-|\*|\d+\.)\s+(.*)$/.exec(line);
        if (li) {
          const mark = li[2] === '- [ ]' ? '[ ]' : /\d/.test(li[2]) ? li[2] : '•';
          return (
            <View key={i} style={{ flexDirection: 'row', marginLeft: li[1].length ? 10 : 0 }}>
              <T style={{ width: mark.length > 2 ? 16 : 10, fontSize: 8.2, color: C.muted }}>{mark}</T>
              <T style={{ flex: 1, fontSize: 8.2 }}>{li[3]}</T>
            </View>
          );
        }
        return <T key={i} style={{ fontSize: 8.2 }}>{line}</T>;
      })}
    </View>
  );
}

export function Appendix({ m }: { m: ReportModel }) {
  const L = labels(m.lang);
  if (!m.recs.length) return null;
  return (
    <Section kicker={L.s8} title={m.lang === 'en' ? 'Ready-made prompts' : 'Fertige Prompts'}>
      <P muted>{L.appendixIntro}</P>
      {m.recs.map((r, i) => (
        <View key={r.key} style={{ marginTop: 14 }}>
          <T style={S.h3}>A{i + 1} · {clean(r.title)}</T>
          <View style={[S.box, { padding: 10 }]}><PromptText text={r.prompt} skipTitle /></View>
        </View>
      ))}
    </Section>
  );
}

export function ReportDocument({ m: raw, pageNumbers = true }: { m: ReportModel; pageNumbers?: boolean }) {
  const m: ReportModel = { ...raw, brand: { ...raw.brand, name: clean(raw.brand.name) } };
  const f = fmt(m.lang);
  const L = labels(m.lang);
  const tier = tierLabel(m.tier, m.kind, m.lang);
  return (
    <Document title={`${m.brand.name} – ${tier}`} author="Askmetry" subject={tier} creator="Askmetry" producer="Askmetry" language={m.lang === 'en' ? 'en' : 'de'}>
      <Cover m={m} />
      <Page size="A4" style={S.page} wrap>
        <View style={S.header} fixed>
          <T style={S.hf}>{clean(m.brand.name)} · {tier}</T>
          <T style={S.hf}>{f.date(m.date)}</T>
        </View>
        <Summary m={m} />
        {m.tier === 'strategy' && <Plan m={m} />}
        <Engines m={m} />
        <Questions m={m} />
        <Sources m={m} />
        <Recs m={m} />
        {m.tier === 'strategy' && <Topics m={m} />}
        <Guide m={m} />
        <Method m={m} />
        <Appendix m={m} />
        {/* Seitenzahl ohne lineHeight: render-Texte mit Zeilenhöhe lösen in react-pdf 4.9 kaputte Koordinaten aus */}
        <View style={S.footer} fixed>
          <T style={S.hf}>Askmetry · askmetry.ai</T>
          {pageNumbers && <Text style={{ fontSize: 8, color: C.faint }} render={({ pageNumber, totalPages }) => L.page(pageNumber, totalPages)} />}
        </View>
      </Page>
    </Document>
  );
}

/** Bericht als PDF-Buffer rendern. */
export async function renderModelPdf(m: ReportModel): Promise<Buffer> {
  registerFonts();
  try {
    return await renderPages(m);
  } catch (e) {
    // Ein kaputtes Logo darf den Bericht nicht verhindern: dann ohne Logos (Initialen)
    if (!Object.keys(m.logos ?? {}).length) throw e;
    console.warn(`[report] PDF ohne Logos gerendert: ${String((e as Error)?.message ?? e)}`);
    return renderPages({ ...m, logos: {} });
  }
}

async function renderPages(m: ReportModel): Promise<Buffer> {
  try {
    return await renderToBuffer(<ReportDocument m={m} />);
  } catch (e) {
    // Bekannter Layout-Fehler von react-pdf mit dynamischen Seitenzahlen („unsupported number“) – lieber ohne Seitenzahlen als gar kein PDF
    if (!/unsupported number/i.test(String((e as Error)?.message))) throw e;
    console.warn('[report] PDF ohne Seitenzahlen gerendert (react-pdf: unsupported number)');
    return renderToBuffer(<ReportDocument m={m} pageNumbers={false} />);
  }
}
