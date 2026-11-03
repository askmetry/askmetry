// Entwicklungsdaten: Workspace „demo“ mit synthetischen, aber realistischen Messungen.
// Aufruf: pnpm --filter @opengeo/web fixture   (idempotent: ersetzt den Demo-Workspace)
// Zugangsdaten landen in apps/web/.dev-credentials (gitignored) und werden nicht ausgegeben.
import { config } from 'dotenv';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env'), quiet: true });

const { hashPassword } = await import('better-auth/crypto');
const { eq, inArray } = await import('drizzle-orm');
const S = await import('@opengeo/db');
const { db, closeDb } = S;

// Deterministischer Zufall
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
const shuffle = <T,>(xs: T[]) => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

const USERS = [
  { email: 'demo@opengeo.test', name: 'Demo Nutzerin' },
  { email: 'other@opengeo.test', name: 'Andere Person' },
];

async function upsertUser(email: string, name: string, password: string) {
  const existing = await db.select().from(S.user).where(eq(S.user.email, email));
  if (existing[0]) await db.delete(S.user).where(eq(S.user.id, existing[0].id));
  const id = randomUUID().replace(/-/g, '');
  await db.insert(S.user).values({ id, email, name, emailVerified: true });
  await db.insert(S.account).values({ id: randomUUID().replace(/-/g, ''), accountId: id, providerId: 'credential', userId: id, password: await hashPassword(password) });
  return id;
}

const password = randomBytes(12).toString('base64url');
const [demoId, otherId] = [await upsertUser(USERS[0]!.email, USERS[0]!.name, password), await upsertUser(USERS[1]!.email, USERS[1]!.name, password)];
writeFileSync(path.resolve(here, '../.dev-credentials'),
  `# Nur für die lokale Entwicklung (gitignored)\n${USERS.map((u) => `${u.email} ${password}`).join('\n')}\n`, { mode: 0o600 });

// Workspaces neu anlegen
const oldWs = await db.select({ id: S.workspace.id }).from(S.workspace).where(inArray(S.workspace.slug, ['demo', 'andere']));
if (oldWs.length) await db.delete(S.workspace).where(inArray(S.workspace.id, oldWs.map((w) => w.id)));

const engines = ['chatgpt', 'gemini', 'claude', 'google_aio', 'google_ai_mode'];
const [ws] = await db.insert(S.workspace).values({ name: 'Demo – Kartenzahlung', slug: 'demo', engines, repetitions: 2, monthlyBudgetUsd: '50' }).returning();
await db.insert(S.workspaceMember).values({ workspaceId: ws!.id, userId: demoId, role: 'owner' });
const [ws2] = await db.insert(S.workspace).values({ name: 'Andere Firma', slug: 'andere', engines: ['chatgpt'] }).returning();
await db.insert(S.workspaceMember).values({ workspaceId: ws2!.id, userId: otherId, role: 'owner' });
await db.insert(S.brand).values({ workspaceId: ws2!.id, name: 'Andere GmbH', domains: ['andere.example'], isOwn: true });

const brandDefs = [
  { key: 'own', name: 'Paylindo', aliases: ['paylindo.de'], domains: ['paylindo.de'], isOwn: true, description: 'Vergleichsportal für Kartenzahlung und EC-Terminals' },
  { key: 'sumup', name: 'SumUp', aliases: [], domains: ['sumup.com'], isOwn: false },
  { key: 'zettle', name: 'Zettle', aliases: ['Zettle by PayPal', 'iZettle'], domains: ['zettle.com'], isOwn: false },
  { key: 'payone', name: 'Payone', aliases: ['PAYONE'], domains: ['payone.com'], isOwn: false },
  { key: 'mypos', name: 'myPOS', aliases: [], domains: ['mypos.com'], isOwn: false },
  { key: 'klv', name: 'kartenleservergleich.de', aliases: ['Kartenleservergleich'], domains: ['kartenleservergleich.de'], isOwn: false },
];
const brands = await db.insert(S.brand).values(brandDefs.map(({ key: _k, ...b }) => ({ ...b, workspaceId: ws!.id }))).returning();
const B = Object.fromEntries(brandDefs.map((d, i) => [d.key, brands[i]!]));
const untracked = ['Bezahlexperten', 'Qonto', 'Flatpay', 'Nexi', 'girocard', 'Viva Wallet'];

const topics = await db.insert(S.topic).values(['Gerätewahl', 'Kosten & Gebühren', 'Anbietervergleich'].map((name) => ({ workspaceId: ws!.id, name }))).returning();
const T = { geraet: topics[0]!, kosten: topics[1]!, vergleich: topics[2]! };
const promptDefs = [
  { t: T.geraet, text: 'Welches EC-Kartengerät ist für ein kleines Café am günstigsten?', ownP: 0.25 },
  { t: T.geraet, text: 'Welches Kartenterminal eignet sich für einen Friseursalon?', ownP: 0.15 },
  { t: T.kosten, text: 'Was kostet Kartenzahlung für Händler in Deutschland an Gebühren?', ownP: 0.1 },
  { t: T.kosten, text: 'EC-Terminal kaufen oder mieten – was lohnt sich für einen Einzelhändler?', ownP: 0.2 },
  { t: T.vergleich, text: 'Wo kann ich Anbieter für Kartenzahlungsgeräte in Deutschland vergleichen?', ownP: 0.55 },
  { t: T.vergleich, text: 'SumUp oder Zettle – welches Kartenlesegerät ist besser?', ownP: 0.05 },
  { t: T.vergleich, text: 'Payone Erfahrungen und Gebühren für kleine Händler', ownP: 0.05 },
  { t: T.kosten, text: 'Kartenzahlungspflicht 2027 – was muss ich als Händler jetzt tun?', ownP: 0 },
];
const prompts = await db.insert(S.prompt).values(promptDefs.map((p) => ({ workspaceId: ws!.id, topicId: p.t.id, text: p.text }))).returning();
// Ein inaktiver Prompt zum Testen der Einstellungen
await db.insert(S.prompt).values({ workspaceId: ws!.id, topicId: T.geraet.id, text: 'Bestes Kassensystem mit Kartenterminal für Food-Trucks', active: false });

const engineBias: Record<string, number> = { chatgpt: 0.5, gemini: 0.9, claude: 0.6, google_aio: 1.4, google_ai_mode: 0.8 };
const blurbs: Record<string, string[]> = {
  SumUp: ['keine Grundgebühr, 1,39 % pro Transaktion', 'sehr einfache Einrichtung per App'],
  Zettle: ['gute Kassen-App, gehört zu PayPal', 'faire Gebühren für kleine Umsätze'],
  Payone: ['Sparkassen-Tochter, eher für höhere Umsätze', 'Tarife mit Grundgebühr, dafür niedrigere Disagio'],
  myPOS: ['sofortige Auszahlung auf das myPOS-Konto', 'Geräte mit eigener SIM-Karte'],
  'kartenleservergleich.de': ['listet Tarife verschiedener Anbieter', 'unabhängiger Vergleich mit Rechner'],
  Paylindo: ['vergleicht EC-Terminals und Gebühren nach Branche', 'Gebührenrechner für Händler'],
  Bezahlexperten: ['Beratung zu Kartenterminals', 'Ratgeberartikel zu Gebühren'],
  Qonto: ['Geschäftskonto mit Kartenzahlungs-Ratgeber', 'Übersicht zu Terminalkosten'],
  Flatpay: ['Flatrate-Modell ohne Transaktionsgebühren', 'neuer Anbieter aus Dänemark'],
  Nexi: ['großer europäischer Zahlungsdienstleister', 'klassische Terminals zur Miete'],
  girocard: ['die deutsche Debitkarte – meist günstigste Akzeptanz', 'am weitesten verbreitet im Handel'],
  'Viva Wallet': ['Tap to Pay auf dem Smartphone', 'Auszahlung in Echtzeit'],
};
const domainPool = ['kassensystemevergleich.de', 'future-payments.de', 'bezahlexperten.de', 'qonto.com', 'de.mobiletransaction.org', 'handelsblatt.com', 'gruendung.de', 'kartenkosten.de', 'zahlungskompass.de', 'ordio.com'];
const ownPaths = ['/blog/sumup-alternativen', '/kartenterminal-kosten', '/blog/kartenzahlung-kosten-fuer-haendler', '/branchen/kartenlesegeraet-friseur', '/blog/payone-gebuehren-2025'];
const compDomain: Record<string, string> = { SumUp: 'sumup.com', Zettle: 'zettle.com', Payone: 'payone.com', myPOS: 'mypos.com', 'kartenleservergleich.de': 'kartenleservergleich.de' };

async function makeCollection(daysAgo: number, shift: number) {
  const created = new Date(Date.now() - daysAgo * 86400_000);
  const [col] = await db.insert(S.collection).values({
    workspaceId: ws!.id, status: 'done', trigger: daysAgo > 3 ? 'scheduled' : 'manual', createdAt: created, startedAt: created,
    finishedAt: new Date(created.getTime() + 14 * 60_000),
  }).returning();
  let total = 0;
  for (const [pi, p] of prompts.entries()) {
    const def = promptDefs[pi]!;
    for (const engine of engines) {
      for (let rep = 1; rep <= 2; rep++) {
        const cost = engine.startsWith('google') ? 0.004 + rnd() * 0.004 : 0.03 + rnd() * 0.2;
        total += cost;
        const [r] = await db.insert(S.run).values({
          collectionId: col!.id, workspaceId: ws!.id, promptId: p.id, engine, repetition: rep, status: 'done', attempts: 1,
          costUsd: cost.toFixed(4), model: { chatgpt: 'gpt-5.5', gemini: 'gemini-3.5-flash', claude: 'claude-opus-5-5', google_aio: 'serp', google_ai_mode: 'serp' }[engine],
          startedAt: created, finishedAt: created,
        }).returning();
        // Google zeigt nicht immer eine AI Overview
        if (engine === 'google_aio' && rnd() < 0.1) {
          await db.insert(S.response).values({ runId: r!.id, workspaceId: ws!.id, answer: '', answerType: 'empty', noAiAnswer: true });
          continue;
        }
        const ownMentioned = rnd() < Math.min(0.95, def.ownP * engineBias[engine]! + shift);
        const pool = shuffle([...new Set(['SumUp', 'Zettle', 'Payone', 'myPOS', ...(def.text.includes('vergleichen') ? ['kartenleservergleich.de', 'Bezahlexperten'] : []), ...shuffle(untracked).slice(0, 2)])]);
        let names = pool.slice(0, 3 + Math.floor(rnd() * 3));
        if (def.text.includes('SumUp oder Zettle')) names = ['SumUp', 'Zettle', ...names.filter((n) => n !== 'SumUp' && n !== 'Zettle')].slice(0, 4);
        if (def.text.includes('Payone')) names = ['Payone', ...names.filter((n) => n !== 'Payone')].slice(0, 3);
        if (def.text.includes('Kartenzahlungspflicht')) names = ['girocard', ...shuffle(['Nexi', 'SumUp']).slice(0, 1)];
        if (ownMentioned) names.splice(Math.min(names.length, Math.floor(rnd() * 3)), 0, 'Paylindo');
        const intro = pick([
          `Kurz gesagt: Es kommt auf Ihren Umsatz und die Zahl der Kartenzahlungen an. Diese Optionen werden häufig empfohlen:`,
          `Für kleine Betriebe sind vor allem Anbieter ohne monatliche Grundgebühr interessant. Ein Überblick:`,
          `Hier eine Einordnung der gängigsten Lösungen in Deutschland (Stand 2026):`,
        ]);
        const lines = names.map((n, i) => `${i + 1}. **${n}** – ${pick(blurbs[n] ?? ['wird häufig genannt'])}.`);
        const outro = pick([
          'Tipp: Vergleichen Sie die effektiven Kosten pro Monat, nicht nur die Transaktionsgebühr. Achten Sie auf Vertragslaufzeiten und Gerätekosten.',
          'Wichtig ist außerdem, ob girocard, Kreditkarten und Apple Pay/Google Pay akzeptiert werden.',
          'Bei geringem Kartenumsatz lohnt sich meist ein Gerät ohne Grundgebühr; ab etwa 3.000 € Kartenumsatz im Monat können Tarife mit Grundgebühr günstiger sein.',
        ]);
        const answer = `${intro}\n\n${lines.join('\n')}\n\n${outro}`;
        const [resp] = await db.insert(S.response).values({
          runId: r!.id, workspaceId: ws!.id, answer, answerType: 'list',
          usage: { input_tokens: 800 + Math.floor(rnd() * 400), output_tokens: 300 + Math.floor(rnd() * 300) },
        }).returning();
        const mentionRows = names.map((n, i) => {
          const b = Object.values(B).find((x) => x.name === n);
          return {
            responseId: resp!.id, workspaceId: ws!.id, brandId: b?.id ?? null, name: n, position: i + 1,
            sentiment: (rnd() < 0.8 ? 'neutral' : rnd() < 0.8 ? 'positive' : 'negative') as 'neutral' | 'positive' | 'negative',
            recommended: i === 0 || (i === 1 && rnd() < 0.4), snippet: lines[i]!.replace(/\*\*/g, ''),
          };
        });
        await db.insert(S.mention).values(mentionRows);
        // Quellen
        const kind = engine === 'claude' ? 'searched' : 'cited';
        const urls: string[] = [];
        for (const d of shuffle(domainPool).slice(0, 2 + Math.floor(rnd() * 3))) urls.push(`https://www.${d}/${pick(['ratgeber', 'blog', 'vergleich'])}/${pick(['kartenterminal', 'ec-geraet-kosten', 'gebuehren-2026'])}`);
        for (const n of names) if (compDomain[n] && rnd() < 0.4) urls.push(`https://${compDomain[n]}/de-de/preise`);
        // Paylindo wird oft als Quelle genutzt – auch wenn die Marke nicht genannt wird
        if (rnd() < (ownMentioned ? 0.7 : 0.35)) urls.push(`https://paylindo.de${pick(ownPaths)}`);
        const uniq = [...new Set(urls)];
        if (engine !== 'google_ai_mode' || rnd() < 0.8) {
          await db.insert(S.citation).values(uniq.map((u, i) => ({
            responseId: resp!.id, workspaceId: ws!.id, url: u, domain: new URL(u).hostname.replace(/^www\./, ''),
            title: `${new URL(u).hostname.replace(/^www\./, '')} – Ratgeber`, position: i + 1, kind: kind as 'cited' | 'searched',
          })));
        }
      }
    }
  }
  await db.update(S.collection).set({ costUsd: total.toFixed(4) }).where(eq(S.collection.id, col!.id));
}

await makeCollection(14, -0.05);
await makeCollection(7, 0);
await makeCollection(1, 0.08);
await closeDb();
console.log('Demo-Workspace „demo“ angelegt (3 Messungen). Zugangsdaten: apps/web/.dev-credentials');
