// Mock-Engine: deterministisch, ohne Netzwerk. Liefert eine realistische deutsche Antwort,
// die einige Marken des Workspace nennt und deren Domains zitiert. Variiert mit Prompt, Engine und Wiederholung.
import type { BrandRef, Engine, EngineCitation } from '../types.ts';
import { sha } from '../util.ts';

function rng(seed: string) {
  let a = parseInt(sha(seed, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const phrases = [
  'überzeugt mit transparenten Konditionen und einfacher Einrichtung',
  'bietet ein gutes Preis-Leistungs-Verhältnis für kleine Betriebe',
  'ist bekannt für einen zuverlässigen Kundenservice',
  'punktet mit flexiblen Tarifen ohne lange Vertragslaufzeit',
  'eignet sich vor allem für Teams mit wechselnden Schichten',
  'hat eine übersichtliche App und gute Bewertungen',
];
const generic: EngineCitation[] = [
  { url: 'https://de.wikipedia.org/wiki/Vergleichsportal', title: 'Vergleichsportal – Wikipedia', kind: 'cited' },
  { url: 'https://www.test.de/Ratgeber-im-Vergleich/', title: 'Ratgeber im Vergleich – Stiftung Warentest', kind: 'cited' },
  { url: 'https://www.reddit.com/r/selbststaendig/comments/mock/', title: 'Erfahrungen? : r/selbststaendig', kind: 'cited' },
  { url: 'https://t3n.de/news/mock-vergleich/', title: 'Die besten Tools im Vergleich – t3n', kind: 'cited' },
];

export function mockAnswer(prompt: string, brands: BrandRef[], seedParts: { engine: string; repetition: number }) {
  const r = rng(`${prompt}|${seedParts.engine}|${seedParts.repetition}`);
  const pool = brands.length ? [...brands] : [{ name: 'Anbieter A' }, { name: 'Anbieter B' }, { name: 'Anbieter C' }];
  // Fisher-Yates mit Seed
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const own = pool.find((b) => b.isOwn);
  let picked = pool.slice(0, Math.min(pool.length, 2 + Math.floor(r() * 3)));
  // eigene Marke in etwa der Hälfte der Antworten
  if (own && r() < 0.5 && !picked.includes(own)) picked = [own, ...picked].slice(0, Math.max(2, picked.length));
  if (own && picked.includes(own) && r() < 0.25) picked = picked.filter((b) => b !== own);
  const noAiAnswer = seedParts.engine === 'google_aio' && r() < 0.15;
  if (noAiAnswer) return { answer: '', citations: [] as EngineCitation[], noAiAnswer };

  const lines = picked.map((b, i) => `${i + 1}. **${b.name}** – ${phrases[Math.floor(r() * phrases.length)]}.`);
  const top = picked[0];
  const answer = [
    `Zu Ihrer Frage „${prompt}“ gibt es in Deutschland mehrere gute Optionen:`,
    '',
    ...lines,
    '',
    top ? `Für die meisten Betriebe ist ${top.name} eine gute Wahl, die ich empfehlen würde.` : '',
    'Prüfen Sie die aktuellen Konditionen vor einer Entscheidung direkt beim Anbieter, da sie sich häufig ändern.',
  ].join('\n');

  const citations: EngineCitation[] = [];
  for (const b of picked) {
    const d = b.domains?.[0];
    if (d) citations.push({ url: `https://www.${d}/preise/`, title: `${b.name} – Preise und Tarife`, kind: 'cited' });
  }
  // gelegentlich wird die eigene Seite zitiert, ohne dass die Marke genannt wird
  if (own?.domains?.[0] && !picked.includes(own) && r() < 0.3) {
    citations.push({ url: `https://${own.domains[0]}/ratgeber/`, title: `Ratgeber – ${own.name}`, kind: 'cited' });
  }
  const g = Math.floor(r() * generic.length);
  citations.push(generic[g], generic[(g + 1) % generic.length]);
  return { answer, citations, noAiAnswer };
}

export const mock: Engine = {
  key: 'mock',
  provider: 'mock',
  enabled: () => true,
  async run(prompt, ctx) {
    const engine = ctx.engineKey ?? 'mock';
    // Entwicklung/E2E: realistische Wartezeit (ASKMETRY_MOCK_DELAY_MS, Standard 0), leicht gestreut
    const delay = Number(process.env.ASKMETRY_MOCK_DELAY_MS ?? 0);
    if (Number.isFinite(delay) && delay > 0) await new Promise((r) => setTimeout(r, Math.min(60_000, delay * (0.6 + Math.random() * 0.8))));
    const { answer, citations, noAiAnswer } = mockAnswer(prompt, ctx.brands ?? [], { engine, repetition: ctx.repetition ?? 1 });
    const o = (ctx.options ?? {}) as { costUsd?: number };
    const costUsd = o.costUsd ?? Number(process.env.ASKMETRY_MOCK_COST_USD ?? 0);
    const usage = { input_tokens: Math.ceil(prompt.length / 4), output_tokens: Math.ceil(answer.length / 4) };
    return {
      engine, model: 'mock', answer, citations, noAiAnswer, usage, costUsd,
      raw: { mock: true, engine, repetition: ctx.repetition ?? 1 },
    };
  },
};
