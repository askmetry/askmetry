// End-to-End-Test der gehosteten Version als Testkunde (Chrome via playwright-core, Mock-KIs, Fake-Zahlung, Mail-Outbox):
// Startseite → URL → sofort /check/<token> mit Agent-Checkliste (ohne E-Mail) → optional „per Mail benachrichtigen“ +
// bestätigen → Teaser (1 freie Maßnahme) + Fertig-Mail → Registrieren + bestätigen → Kaufformular → Test-Kasse → Bericht
// starten → PDF + Mail → Nachmessung kaufen, messen, PDF. Prüft unterwegs, dass gesperrte Maßnahmen nicht im Teaser-HTML stehen.
// Voraussetzung: scripts/dev-hosted.sh web UND scripts/dev-hosted.sh worker laufen (Repo-Root). Für Screenshots der
// laufenden Checkliste den Worker mit Wartezeit starten: ASKMETRY_MOCK_DELAY_MS=2500 scripts/dev-hosted.sh worker
// Aufruf (Repo-Root): node e2e/hosted-flow.mjs   ·  Umgebung: E2E_BASE, E2E_URL (zu prüfende Website), E2E_SHOTS, ASKMETRY_MAIL_OUTBOX
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3010';
const SITE = process.env.E2E_URL ?? 'https://example.com';
const SHOTS = process.env.E2E_SHOTS ?? path.resolve('e2e/shots/hosted');
const OUTBOX = process.env.ASKMETRY_MAIL_OUTBOX ?? path.resolve('.mail-outbox');
fs.mkdirSync(SHOTS, { recursive: true });

const pg = createRequire(path.resolve('packages/db/package.json'))('pg');
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://askmetry:askmetry@localhost:5433/askmetry';
async function sql(text, params = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(text, params)).rows; } finally { await c.end(); }
}

const stamp = Date.now();
const email = `e2e-${stamp}@askmetry.test`;
const password = `E2e-${stamp}-pw!`;
const domain = new URL(SITE).hostname.replace(/^www\./, '');
let step = 0;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { throw new Error(m); };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${String(++step).padStart(2, '0')}-${name}.png`), fullPage: true });

/** Neueste Mail an `to`, deren Betreff/Link passt (wartet bis zu `ms`). */
async function waitMail(to, test, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fs.existsSync(OUTBOX)) {
      const files = fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.json')).sort().reverse();
      for (const f of files) {
        const m = JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8'));
        const rcpt = Array.isArray(m.to) ? m.to.join(',') : String(m.to);
        if (rcpt.includes(to) && test(m)) return m;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`Keine passende Mail an ${to} innerhalb ${ms / 1000}s`);
}
const linkWith = (m, part) => m.links.find((l) => l.includes(part)) ?? fail(`Link mit ${part} fehlt in Mail „${m.subject}“`);
const local = (u) => { const x = new URL(u); return `${BASE}${x.pathname}${x.search}`; };

/** Seite neu laden, bis `cond()` stimmt (Status-Seiten mit Auto-Refresh). */
async function until(page, cond, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await shot(page, `timeout-${what}`);
  fail(`Zeitüberschreitung: ${what}`);
}

// Frischer Lauf: frühere Checks dieser Domain samt Check-Arbeitsbereich entfernen (sonst greift der 30-Tage-Cache)
await sql(`delete from workspace where id in (select workspace_id from check_request where domain = $1) and hosted_kind = 'check'`, [domain]);
await sql(`delete from check_request where domain = $1`, [domain]);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
await context.addCookies([{ name: 'askmetry_locale', value: 'de', url: BASE }]);
const page = await context.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  // 1. Startseite + URL
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  if (!(await page.getByText('79').first().isVisible())) fail('Preis auf der Startseite fehlt');
  await page.locator('input[name="url"]').first().fill(SITE);
  await page.locator('form:has(input[name="url"]) button[type="submit"]').first().click();
  await page.waitForURL(/\/check\/[^/]+$/, { timeout: 30_000 });
  const checkUrl = page.url();
  const token = checkUrl.split('/check/')[1];
  ok(`Check gestartet (${domain})`);
  await shot(page, 'check-start');

  // 2. Agent-Checkliste ohne E-Mail-Gate; optional per Mail benachrichtigen lassen
  await page.locator('[data-testid="agent-checklist"]').waitFor({ timeout: 15_000 });
  if (await page.locator('#check-email').count() === 0) fail('Benachrichtigungs-Feld fehlt in der Warteansicht');
  await page.locator('[data-testid="check-live"]').waitFor({ timeout: 30_000 });
  await page.locator('#check-email').fill(email);
  if (await page.locator('[data-testid="check-consent"]').isChecked()) fail('Einwilligung ist vorangekreuzt');
  await page.locator('[data-testid="check-consent"]').check();
  await page.locator('[data-testid="check-email-form"] button[type="submit"]').click();
  await page.locator('[data-testid="check-email-sent"]').waitFor({ timeout: 15_000 });
  const verifyMail = await waitMail(email, (m) => m.links.some((l) => l.includes('/bestaetigen')));
  ok(`Benachrichtigung angefordert, Bestätigungsmail: „${verifyMail.subject}“`);
  // Checkliste mitten in der Messung festhalten (läuft, sobald eine KI-Suche Antworten hat)
  const t0 = Date.now();
  let midShot = false;
  while (Date.now() - t0 < 180_000) {
    const status = (await sql(`select status from check_request where token = $1`, [token]))[0]?.status;
    if (status === 'ready') break;
    const current = await page.locator('[data-testid="agent-checklist"] li[data-state="current"]').count();
    const answered = await page.locator('[data-testid="agent-checklist"] li[data-step="gemini"] span.tabular-nums').first().textContent().catch(() => null);
    if (status === 'measuring' && current > 0 && answered && !answered.startsWith('0/')) { await shot(page, 'check-agent-messung'); midShot = true; break; }
    const discovering = await page.locator('[data-testid="agent-checklist"] li[data-step="brand"][data-state="current"], [data-testid="agent-checklist"] li[data-step="competitors"][data-state="current"]').count();
    if (discovering && step === 1) await shot(page, 'check-agent-discovery');
    await page.waitForTimeout(700);
  }
  ok(midShot ? 'Agent-Checkliste während der Messung festgehalten' : 'Messung war zu schnell für einen Zwischen-Screenshot (Worker ohne ASKMETRY_MOCK_DELAY_MS?)');
  await page.goto(local(linkWith(verifyMail, '/bestaetigen')), { waitUntil: 'domcontentloaded' });
  ok('E-Mail bestätigt (Check lief unabhängig davon weiter)');

  // 3. Teaser
  await until(page, async () => (await sql(`select status from check_request where token = $1`, [token]))[0]?.status === 'ready', 300_000, 'Teaser fertig');
  ok(`Check fertig nach ${Math.round((Date.now() - t0) / 1000)} s (Mock)`);
  await page.goto(checkUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="buy-strategy"]').waitFor({ timeout: 30_000 });
  await shot(page, 'teaser');
  const [chk] = await sql(`select workspace_id, summary from check_request where token = $1`, [token]);
  const free = new Set(chk.summary.freeRecommendationIds);
  if (free.size !== 1) fail(`Teaser soll genau 1 freie Maßnahme zeigen, hat ${free.size}`);
  const recs = await sql(`select id, title, why from recommendation where workspace_id = $1 and active`, [chk.workspace_id]);
  const html = await page.content();
  const leaked = recs.filter((r) => !free.has(r.id) && (html.includes(r.title) || html.includes(r.why)));
  if (leaked.length) fail(`${leaked.length} gesperrte Maßnahmen im Teaser-HTML sichtbar`);
  if (![...free].every((id) => html.includes(recs.find((r) => r.id === id)?.title ?? '§§'))) fail('freie Maßnahme fehlt im Teaser');
  if (await page.locator('[data-rec]').count() !== 1) fail('Teaser zeigt nicht genau eine Maßnahmen-Karte');
  if (await page.locator('[data-testid="teaser-ranking"], [data-testid="teaser-domains"], [data-testid="teaser-areas"]').count()) fail('Teaser zeigt noch Wettbewerber/Quellen/Bereiche');
  if (!(await page.locator('article[data-tier="strategy"][data-recommended]').count())) fail('Strategiebericht ist nicht als empfohlen markiert');
  ok(`Teaser: ${recs.length} Maßnahmen, 1 frei, keine gesperrten Texte im HTML, Strategiebericht empfohlen`);
  await page.locator('[data-testid="check-findings"]').waitFor({ timeout: 10_000 });
  const [cons] = await sql(`select marketing_consent_at is not null as ok from check_request where token = $1`, [token]);
  if (!cons?.ok) fail('Einwilligung wurde nicht gespeichert');
  // Fragen vor dem Kauf ändern: eine eigene Frage hinzufügen (vorher eine entfernen, falls schon 20)
  const ownQ = `E2E-Testfrage: Welcher Anbieter passt für ein kleines Café ${Date.now() % 10000}?`;
  const qBox = page.locator('[data-testid="question-editor"]');
  if (await page.locator('[data-testid="question-editor-toggle"]').count()) await page.locator('[data-testid="question-editor-toggle"]').click();
  const addInput = qBox.locator('input[name="text"][required]');
  if (await addInput.count() === 0) {
    await qBox.locator('form:has(input[name="action"][value="delete"]) button').last().click();
    await page.waitForTimeout(1500);
  }
  await qBox.locator('input[name="text"][required]').fill(ownQ);
  await qBox.locator('input[name="text"][required]').press('Enter');
  await until(page, async () => ((await sql(`select prompts from check_request where token = $1`, [token]))[0]?.prompts ?? []).includes(ownQ), 15_000, 'Frage gespeichert');
  ok('Konkrete Befunde sichtbar, Einwilligung gespeichert, eigene Frage vor dem Kauf hinzugefügt');
  await shot(page, 'check-fragen');
  const readyMail = await waitMail(email, (m) => m.links.some((l) => l.includes(`/check/${token}`)) && !m.links.some((l) => l.includes('/bestaetigen')));
  ok(`Fertig-Mail: „${readyMail.subject}“`);

  // 4. Kauf: Registrierung mit Bestätigung, dann Kaufformular
  await page.locator('[data-testid="buy-compact"]').click();
  // nicht angemeldet: /kaufen leitet zur Registrierung weiter (oder zeigt einen Link dorthin)
  await page.waitForURL((u) => u.pathname === '/signup', { timeout: 15_000 })
    .catch(() => page.getByRole('link', { name: /registrier|konto anlegen/i }).first().click());
  await page.waitForURL((u) => u.pathname === '/signup', { timeout: 30_000 });
  await shot(page, 'signup');
  if (await page.locator('#name').count()) await page.locator('#name').fill('E2E Testkunde');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('form button[type="submit"]').first().click();
  const authMail = await waitMail(email, (m) => /verif|bestätig/i.test(m.subject) && m.links.some((l) => l.includes('/api/auth/verify-email')));
  ok(`Konto-Bestätigungsmail: „${authMail.subject}“`);
  await page.goto(local(linkWith(authMail, '/api/auth/verify-email')), { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => u.pathname === '/kaufen', { timeout: 30_000 }).catch(async () => {
    await page.goto(`${BASE}/kaufen?tier=compact&check=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' });
  });
  await page.locator('[data-testid="buy-form"]').waitFor({ timeout: 30_000 });
  await shot(page, 'kaufen');
  // ohne Häkchen: Browser verhindert das Absenden (required) – serverseitige Prüfung decken Unit-Tests ab
  await page.locator('input[name="b2b"]').check();
  await page.locator('input[name="terms"]').check();
  await page.locator('[data-testid="buy-form"] button[type="submit"]').click();
  await page.waitForURL(/\/kasse\//, { timeout: 30_000 });
  await shot(page, 'kasse');
  await page.locator('form:has(input[name="sessionId"]) button[type="submit"]').first().click();
  await page.waitForURL(/\/w\/[^/]+\/bericht\/[^/?]+/, { timeout: 30_000 });
  const reportUrl = page.url().split('?')[0];
  const reportId = reportUrl.split('/bericht/')[1];
  const slug = reportUrl.split('/w/')[1].split('/')[0];
  ok(`Testzahlung abgeschlossen → Bericht ${reportId}`);

  // 5. Messung startet von selbst → fertig → PDF + Mail
  await until(page, async () => ['measuring', 'ready'].includes((await sql(`select status from report where id = $1`, [reportId]))[0]?.status), 60_000, 'Messung läuft (Auto-Start)');
  const [rp] = await sql(`select r.status, exists(select 1 from prompt p where p.workspace_id = r.workspace_id and p.active and p.text = $2) as has_q from report r where r.id = $1`, [reportId, ownQ]);
  if (!rp.has_q) fail('Vor dem Kauf hinzugefügte Frage fehlt im Bericht');
  if (rp.status === 'measuring') {
    await page.goto(reportUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="report-measuring"]').waitFor({ timeout: 15_000 }).catch(() => {});
    await shot(page, 'bericht-messung');
  }
  ok('Messung nach der Zahlung automatisch gestartet, eigene Frage übernommen');
  await until(page, async () => (await sql(`select status from report where id = $1`, [reportId]))[0]?.status === 'ready', 600_000, 'Bericht fertig');
  await page.goto(reportUrl, { waitUntil: 'domcontentloaded' });
  await shot(page, 'bericht-fertig');
  const pdfHref = await page.locator('[data-testid="report-pdf"]').getAttribute('href');
  const pdf = await page.request.get(BASE + pdfHref);
  const buf = await pdf.body();
  if (pdf.status() !== 200 || buf.subarray(0, 4).toString() !== '%PDF') fail(`PDF-Download fehlgeschlagen (${pdf.status()})`);
  fs.writeFileSync(path.join(SHOTS, 'bericht.pdf'), buf);
  ok(`PDF heruntergeladen (${Math.round(buf.length / 1024)} KB)`);
  const reportMail = await waitMail(email, (m) => (m.attachments ?? []).some((a) => /\.pdf$/i.test(a.filename)));
  ok(`Bericht-Mail mit PDF-Anhang: „${reportMail.subject}“`);

  // 6. Sperren im Kunden-Arbeitsbereich
  await page.goto(`${BASE}/w/${slug}`, { waitUntil: 'domcontentloaded' });
  if (await page.getByRole('button', { name: /jetzt messen/i }).count()) fail('„Jetzt messen“ ist im Kunden-Arbeitsbereich sichtbar');
  const sched = await page.request.get(`${BASE}/w/${slug}/settings/messung`, { maxRedirects: 0 });
  ok(`Kunden-Arbeitsbereich ohne „Jetzt messen“ (Messplan-Seite: HTTP ${sched.status()})`);
  await shot(page, 'arbeitsbereich');

  // 7. Nachmessung kaufen, messen, PDF
  await page.goto(`${BASE}/w/${slug}/berichte?nachmessung=${reportId}`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'nachmessung-angebot');
  await page.getByRole('link', { name: /nachmessung/i }).first().click();
  await page.locator('[data-testid="buy-form"]').waitFor({ timeout: 30_000 });
  await page.locator('input[name="b2b"]').check();
  await page.locator('input[name="terms"]').check();
  await page.locator('[data-testid="buy-form"] button[type="submit"]').click();
  await page.waitForURL(/\/kasse\//, { timeout: 30_000 });
  await page.locator('form:has(input[name="sessionId"]) button[type="submit"]').first().click();
  await page.waitForURL(/\/bericht\//, { timeout: 30_000 });
  const reUrl = page.url().split('?')[0];
  const reId = reUrl.split('/bericht/')[1];
  await until(page, async () => (await sql(`select status from report where id = $1`, [reId]))[0]?.status === 'ready', 600_000, 'Nachmessung fertig');
  const [same] = await sql(`select (select plan->'promptIds' from collection where id = a.collection_id) = (select plan->'promptIds' from collection where id = b.collection_id) as same, b.previous_report_id = a.id as linked
    from report a, report b where a.id = $1 and b.id = $2`, [reportId, reId]);
  if (!same?.same || !same?.linked) fail('Nachmessung nutzt nicht dieselben Fragen bzw. ist nicht mit dem Vorbericht verknüpft');
  await page.goto(reUrl, { waitUntil: 'domcontentloaded' });
  await shot(page, 'nachmessung-fertig');
  ok('Nachmessung fertig, gleiche Fragen, mit Vorbericht verknüpft');

  if (errors.length) fail(`JavaScript-Fehler im Browser: ${errors.slice(0, 3).join(' | ')}`);
  console.log(`\nAlles grün. Screenshots + PDF: ${SHOTS}`);
} catch (e) {
  await shot(page, 'fehler').catch(() => {});
  console.error(`✗ ${e.message}\n  Seite: ${page.url()}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
