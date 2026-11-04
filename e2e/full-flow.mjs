// End-to-End-Test im echten Browser (Chrome via playwright-core).
// Phasen:
//   node e2e/full-flow.mjs login     – Testkonto anlegen bzw. anmelden
//   node e2e/full-flow.mjs check     – alle Seiten der Workspaces paylindo + medishift prüfen (+ Statuswechsel/„gelesen“ in e2e-test,
//                                      Fixture: pnpm --filter @askmetry/web exec tsx scripts/dev-recommendations.ts e2e-test)
//   node e2e/full-flow.mjs create    – Workspace „E2E Test“ anlegen, Marke/Prompt/Einstellungen, „Jetzt messen“
//   node e2e/full-flow.mjs verify    – Ergebnis der Messung im E2E-Workspace prüfen
//   node e2e/full-flow.mjs i18n      – Sprachumschalter: Oberfläche auf Englisch (paylindo), danach zurück auf Deutsch
// Alle Phasen laufen auf Deutsch (Accept-Language de + Sprach-Cookie), damit die Text-Prüfungen stimmen.
// Zugangsdaten: .e2e-credentials (E2E_EMAIL, E2E_PASSWORD). Screenshots: E2E_SHOTS oder ./e2e/shots
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3010';
const SHOTS = process.env.E2E_SHOTS ?? path.resolve('e2e/shots');
const STATE = path.resolve('e2e/.auth-state.json');
const creds = Object.fromEntries(fs.readFileSync('.e2e-credentials', 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
fs.mkdirSync(SHOTS, { recursive: true });

const phase = process.argv[2];

// DB-Zugriff nur, um den Statuswechsel-Test exakt zurückzusetzen und zu prüfen (Werte werden nie ausgegeben)
const envUrl = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') : undefined;
const pg = createRequire(path.resolve('packages/db/package.json'))('pg');
async function sql(text, params = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? envUrl ?? 'postgres://askmetry:askmetry@localhost:5433/askmetry' });
  await c.connect();
  try { return (await c.query(text, params)).rows; } finally { await c.end(); }
}
const recRow = async (id) => (await sql(`select status, baseline, evidence->'current' as current, evidence->'baseline' as ev_baseline, status_changed_at from recommendation where id = $1`, [id]))[0];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }, locale: 'de-DE',
  ...(phase !== 'login' && fs.existsSync(STATE) && { storageState: STATE }),
});
// Oberfläche fest auf Deutsch (Cookie hat Vorrang vor Accept-Language; ein im Auth-State gespeichertes Cookie wird überschrieben)
await context.addCookies([{ name: 'askmetry_locale', value: 'de', url: BASE }]);
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await context.newPage();
const errors = [];
// absichtlich aufgerufene 404-Seite nicht als Fehler werten
page.on('console', (m) => m.type() === 'error' && !page.url().includes('/gibt-es-nicht') && errors.push(`${page.url()}: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));

let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
}
async function visit(url, name, expect = []) {
  const res = await page.goto(BASE + url, { waitUntil: 'networkidle' });
  const text = await page.innerText('body');
  check(res.status() === 200, `${url} → ${res.status()}`);
  for (const e of expect) check(text.includes(e), `${url} enthält „${e}“`);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  return text;
}

/** Eigenes Logo hochladen, prüfen, ablehnen (SVG mit Skript) und wieder entfernen – nur im Fixture-Workspace. */
async function logoUploadRoundTrip(ws) {
  if (ws !== 'e2e-test') throw new Error('Logo-Upload-Test nur im Fixture-Workspace e2e-test');
  const [b] = await sql(`select b.id, b.logo_type from brand b join workspace w on w.id = b.workspace_id where w.slug = $1 and b.is_own`, [ws]);
  if (b.logo_type) { check(false, 'e2e-test hat schon ein eigenes Logo – Test übersprungen'); return; }
  // 1×1-PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  try {
    await page.goto(`${BASE}/w/${ws}/settings/marke`, { waitUntil: 'networkidle' });
    const form = page.locator('form', { has: page.locator('input[name=logo]') });
    await form.locator('input[name=logo]').setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    await form.locator('button', { hasText: 'Hochladen' }).click();
    await page.waitForTimeout(1500);
    check(/ohne Skripte/.test(await page.innerText('body')), `${ws}: SVG mit Skript wird abgelehnt`);
    await form.locator('input[name=logo]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await form.locator('button', { hasText: 'Hochladen' }).click();
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    check((await page.innerText('[data-testid=logo-source]')).includes('Eigenes Logo'), `${ws}: eigenes Logo gespeichert`);
    const src = await page.locator('header img').first().getAttribute('src');
    check(/\/markenlogo\//.test(src ?? ''), `${ws}: Kopfzeile zeigt das eigene Logo`);
    const res = await page.request.get(BASE + src);
    check(res.status() === 200 && res.headers()['content-type'] === 'image/png', `${ws}: Upload-Logo wird als PNG ausgeliefert`);
    check(/sandbox/.test(res.headers()['content-security-policy'] ?? '') && res.headers()['x-content-type-options'] === 'nosniff', `${ws}: Upload-Logo mit CSP sandbox und nosniff`);
    const other = await page.request.get(`${BASE}/w/paylindo/markenlogo/${b.id}`);
    check(other.status() === 404, `${ws}: Upload-Logo nicht über einen anderen Workspace abrufbar`);
    const anon = await (await browser.newContext()).request.get(BASE + src);
    check(anon.status() === 401, `${ws}: Upload-Logo ohne Anmeldung gesperrt`);
    await page.click('button:has-text("Wieder Website-Logo verwenden")');
    await page.waitForTimeout(1500);
    const [after] = await sql(`select logo_type from brand where id = $1`, [b.id]);
    check(after.logo_type === null, `${ws}: zurück zum Website-Logo`);
  } finally {
    await sql(`update brand set logo_data = null, logo_type = null, logo_updated_at = null where id = $1`, [b.id]);
  }
}

/** Statuswechsel hin und zurück auf der Detailseite – nur im Fixture-Workspace. Die Zeile wird vorher gesichert und im finally exakt zurückgeschrieben. */
async function statusRoundTrip(ws, id) {
  if (ws !== 'e2e-test') throw new Error('Statuswechsel-Test nur im Fixture-Workspace e2e-test');
  // status_changed_at als Text lesen/schreiben – sonst gehen Mikrosekunden verloren
  const [saved] = await sql(`select status, baseline, status_changed_at::text as status_changed_at, done_steps from recommendation where id = $1`, [id]);
  const click = async (status) => {
    await page.locator(`[data-rec-actions="${id}"] button[data-to="${status}"]`).click();
    await page.locator(`[data-rec-actions="${id}"] button[data-to="${status}"][aria-pressed="true"]`).waitFor({ timeout: 15000 }).catch(() => {});
  };
  const pressed = async (status) => (await page.locator(`[data-rec-actions="${id}"] button[data-to="${status}"]`).getAttribute('aria-pressed')) === 'true';
  try {
    await click('in_progress');
    check(await pressed('in_progress'), `${ws}: Statuswechsel Offen → In Arbeit`);
    const mid = await recRow(id);
    check(mid.status === 'in_progress' && (!mid.current || same(mid.baseline, mid.current)), `${ws}: Baseline beim Start = evidence.current`);
    await page.screenshot({ path: path.join(SHOTS, `${ws}-massnahme-status.png`), fullPage: true });
    await click('open');
    check(await pressed('open'), `${ws}: zurück auf Offen`);
    const reopened = await recRow(id);
    check(same(reopened.baseline, reopened.ev_baseline ?? null), `${ws}: Wieder öffnen setzt Baseline auf evidence.baseline`);
    // Checkliste: Schritt abhaken → in der Datenbank (done_steps), nach Neuladen weiter abgehakt
    const box = page.locator('input[data-step="0"]');
    if (await box.count()) {
      const was = await box.isChecked();
      await box.click();
      await page.waitForFunction((w) => document.querySelector('input[data-step="0"]')?.checked === !w && !document.body.innerText.includes('speichert …'), was, { timeout: 15000 }).catch(() => {});
      const [st] = await sql(`select done_steps from recommendation where id = $1`, [id]);
      check(st.done_steps.includes(0) === !was, `${ws}: Schritt abhaken wird gespeichert (done_steps)`);
      await page.reload({ waitUntil: 'networkidle' });
      check(await page.locator('input[data-step="0"]').isChecked() === !was, `${ws}: abgehakter Schritt bleibt nach Neuladen`);
      check(!(await page.innerText('body')).includes('nur in diesem Browser'), `${ws}: kein Hinweis „nur in diesem Browser“`);
    } else check(false, `${ws}: Checkliste vorhanden`);
  } finally {
    await sql(`update recommendation set status = $2, baseline = $3, status_changed_at = $4::timestamptz, done_steps = $5 where id = $1`,
      [id, saved.status, saved.baseline === null ? null : JSON.stringify(saved.baseline), saved.status_changed_at, saved.done_steps]);
  }
  const after = (await sql(`select status, baseline, status_changed_at::text as status_changed_at, done_steps from recommendation where id = $1`, [id]))[0];
  check(after.status === saved.status && same(after.baseline, saved.baseline) && after.status_changed_at === saved.status_changed_at && same(after.done_steps, saved.done_steps),
    `${ws}: Maßnahme exakt im Ausgangszustand (Status, Baseline, Zeitstempel auf die Mikrosekunde, Schritte)`);
}

/** Markenprofil-Banner: erkanntes Profil bestätigen und selbst eintragen, danach exakt zurücksetzen – nur im Fixture-Workspace. */
async function brandBannerRoundTrip(ws) {
  if (ws !== 'e2e-test') throw new Error('Banner-Test nur im Fixture-Workspace e2e-test');
  const [b] = await sql(`select b.id, b.description, b.kind, b.profile_source, b.profile_checked_at::text as checked from brand b join workspace w on w.id = b.workspace_id where w.slug = $1 and b.is_own`, [ws]);
  try {
    // 1) automatisch erkannt → „Passt“
    await sql(`update brand set description = 'Paylindo ist ein Vergleichsportal für EC-Kartenterminals.', kind = 'portal', profile_source = 'auto', profile_checked_at = now() where id = $1`, [b.id]);
    await page.goto(`${BASE}/w/${ws}`, { waitUntil: 'networkidle' });
    let banner = page.locator('[data-testid=brand-banner]');
    check(await banner.count() === 1 && await banner.getAttribute('data-state') === 'auto'
      && (await banner.textContent()).includes('Von deiner Website erkannt') && (await banner.textContent()).includes('Vergleichsportal'), `${ws}: Banner zeigt erkanntes Profil zum Bestätigen`);
    await banner.getByRole('button', { name: 'Passt' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=brand-banner]'), null, { timeout: 15000 }).catch(() => {});
    let [after] = await sql(`select profile_source from brand where id = $1`, [b.id]);
    check(after.profile_source === 'user' && await page.locator('[data-testid=brand-banner]').count() === 0, `${ws}: „Passt“ übernimmt das Profil, Banner verschwindet`);
    // 2) leer → selbst eintragen (ohne „Von Website erkennen“: kein echter Abruf im Test)
    await sql(`update brand set description = null, kind = null, profile_source = null where id = $1`, [b.id]);
    await page.goto(`${BASE}/w/${ws}`, { waitUntil: 'networkidle' });
    banner = page.locator('[data-testid=brand-banner]');
    check(await banner.getAttribute('data-state') === 'empty' && await banner.getByRole('button', { name: 'Von Website erkennen' }).count() === 1, `${ws}: leeres Profil bietet „Von Website erkennen“ an`);
    await banner.getByText('Lieber selbst eintragen').click();
    await banner.locator('input[name=description]').fill('Testbeschreibung: EC-Terminals für Cafés');
    await banner.locator('select[name=kind]').selectOption('provider');
    await banner.getByRole('button', { name: 'Speichern' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=brand-banner]') || document.body.innerText.includes('Gespeichert'), null, { timeout: 15000 }).catch(() => {});
    [after] = await sql(`select description, kind, profile_source from brand where id = $1`, [b.id]);
    check(after.description === 'Testbeschreibung: EC-Terminals für Cafés' && after.kind === 'provider' && after.profile_source === 'user', `${ws}: Banner speichert Beschreibung und Markentyp als eigene Angabe`);
  } finally {
    await sql(`update brand set description = $2, kind = $3, profile_source = $4, profile_checked_at = $5::timestamptz where id = $1`, [b.id, b.description, b.kind, b.profile_source, b.checked]);
  }
  const [r] = await sql(`select description, kind, profile_source, profile_checked_at::text as checked from brand where id = $1`, [b.id]);
  check(r.description === b.description && r.kind === b.kind && r.profile_source === b.profile_source && r.checked === b.checked, `${ws}: Marke exakt im Ausgangszustand`);
}

/** Kopier-Knopf klicken und prüfen, dass die Zwischenablage den Markennamen enthält. */
async function copyCheck(selector, brand, label) {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.locator(selector).first().click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip.length > 100 && clip.includes(brand), `${label}: Zwischenablage enthält Prompt mit „${brand}“ (${clip.length} Zeichen)`);
  check(await page.locator(selector).first().innerText() === 'Kopiert ✓', `${label}: Rückmeldung „Kopiert ✓“`);
}

/** Seite auf 390 px Breite ohne horizontales Scrollen. */
async function mobile(url, name, label) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${label}: 390 px ohne horizontales Scrollen (${overflow}px)`);
  await page.screenshot({ path: path.join(SHOTS, `${name}-mobil.png`), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function redirects(ws, from, to) {
  await page.goto(BASE + from, { waitUntil: 'networkidle' });
  check(page.url() === BASE + to, `${from} leitet weiter auf ${to}`);
}

try {
  if (phase === 'login') {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', creds.E2E_EMAIL);
    await page.fill('#password', creds.E2E_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForTimeout(2000);
    if (!page.url().includes('/w')) {
      await page.goto(`${BASE}/signup`);
      await page.fill('#name', 'E2E Test');
      await page.fill('#email', creds.E2E_EMAIL);
      await page.fill('#password', creds.E2E_PASSWORD);
      await page.click('button[type=submit]');
      await page.waitForURL('**/w', { timeout: 15000 });
    }
    check(page.url().endsWith('/w'), 'Angemeldet, Workspace-Liste erreicht');
    await context.storageState({ path: STATE });
  }

  if (phase === 'check') {
    for (const ws of ['paylindo', 'medishift', 'e2e-test']) {
      const own = ws === 'medishift' ? 'MediShift' : 'Paylindo';
      // Übersicht: Score, Top-Maßnahmen, Lagebericht
      const home = await visit(`/w/${ws}`, `${ws}-uebersicht`, ['KI-Sichtbarkeit', 'Das bringt dich nach vorn', 'Fang hier an', 'Tiefer einsteigen', 'Lagebericht kopieren']);
      check(await page.locator('article[data-hero] [data-testid=copy-prompt]').count() === 1, `${ws}: erste Maßnahme groß mit „Prompt kopieren“`);
      check(await page.locator('svg[aria-label^="KI-Sichtbarkeit "][aria-label$=" von 100"]').count() === 1, `${ws}: Score-Ring mit KI-Sichtbarkeit 0–100`);
      const cards = await page.locator('article[data-rec]').count();
      check(cards > 0 && cards <= 3, `${ws}: Übersicht zeigt ${cards} Maßnahmen-Karte(n) (max. 3)`);
      check(!/[{}]\s*"|\[object Object\]|undefined|NaN/.test(home), `${ws}: keine Rohdaten/JSON auf der Übersicht`);
      if (cards > 0) await copyCheck('[data-testid=copy-prompt]', own, `${ws}: „Prompt kopieren“ auf der Karte`);
      await copyCheck('[data-testid=copy-brief]', own, `${ws}: Lagebericht`);
      await mobile(`/w/${ws}`, `${ws}-uebersicht`, `${ws}: Übersicht`);

      // Maßnahmen-Liste und Detail
      const list = await visit(`/w/${ws}/massnahmen`, `${ws}-massnahmen`, ['Maßnahmen', 'Prompt kopieren']);
      check(!/[{}]\s*"|\[object Object\]|undefined|NaN/.test(list), `${ws}: keine Rohdaten/JSON auf der Maßnahmen-Seite`);
      const target = ws === 'e2e-test' ? 'article[data-rec][data-status="open"]' : 'article[data-rec]';
      const recId = await page.locator(target).first().getAttribute('data-rec');
      check(!!recId, `${ws}: Maßnahme für die Detailseite gefunden`);
      if (ws === 'e2e-test') {
        const [{ n }] = await sql(`select count(*)::int as n from collection c join workspace w on w.id = c.workspace_id where w.slug = $1 and c.status = 'done'`, [ws]);
        check(list.includes('Nicht mehr aktuell') === (n > 1), `e2e-test: „Nicht mehr aktuell“ nur ab der zweiten Messung (${n} Messung(en))`);
      }
      await mobile(`/w/${ws}/massnahmen`, `${ws}-massnahmen`, `${ws}: Maßnahmen`);
      if (recId) {
        const detail = await visit(`/w/${ws}/massnahmen/${recId}`, `${ws}-massnahme-detail`, ['Mit KI umsetzen', 'Prompt kopieren', 'ChatGPT, Claude oder Gemini', 'Wer macht’s', 'Warum', 'Belege']);
        check(!/[{}]\s*"|\[object Object\]|undefined|NaN/.test(detail), `${ws}: keine Rohdaten/JSON auf der Detailseite`);
        await copyCheck('[data-testid=copy-prompt-main]', own, `${ws}: „Prompt kopieren“ auf der Detailseite`);
        if (ws !== 'e2e-test') {
          // Seiten aus den Belegen sind klickbar: Liste „Seiten dazu“ und Links in den Schritten, alle http(s) im neuen Tab
          const hrefs = await page.locator('main a[target=_blank]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
          const inSteps = await page.locator('main li label a[target=_blank]').count();
          check(hrefs.length > 0 && hrefs.every((h) => /^https?:\/\//.test(h)) && inSteps > 0, `${ws}: Links zu Seiten in Schritten und „Seiten dazu“ klickbar (${inSteps} in Schritten)`);
        }
        // Statuswechsel nur im Fixture-Workspace; echte Workspaces werden nur lesend geprüft
        if (ws === 'e2e-test') await statusRoundTrip(ws, recId);
        else check(await page.locator(`[data-rec-actions="${recId}"] button[data-to]`).count() === 4, `${ws}: Status-Menü mit 4 Optionen vorhanden (nur lesend geprüft)`);
        await mobile(`/w/${ws}/massnahmen/${recId}`, `${ws}-massnahme-detail`, `${ws}: Maßnahmen-Detail`);
      }

      if (ws === 'e2e-test') {
        await brandBannerRoundTrip(ws);
        await logoUploadRoundTrip(ws);
        await visit(`/w/${ws}/quellen`, `${ws}-quellen`, ['Von KI gelesen, aber nicht zitiert']);
        // „Gelesen, nicht zitiert“ ist eingeklappt – aufklappen und Inhalt prüfen
        await page.click('#gelesen summary');
        const read = await page.innerText('#gelesen');
        check(read.includes('r/selbststaendig') && read.includes('Community-Plattformen'), `${ws}: Gelesen-Abschnitt aufklappbar mit Community-Plattformen`);
        continue;
      }

      // Fragen
      const fragen = await visit(`/w/${ws}/fragen`, `${ws}-fragen`, ['Fragen ohne dich', 'ChatGPT', 'G-Übersicht', 'KI-Suchen']);
      check(await page.locator('li[data-question]').count() > 0 && !fragen.includes('Noch keine'), `${ws}: Fragenliste hat Daten`);
      check(!fragen.includes('Google AI Overviews'), `${ws}: Engine-Namen auf Deutsch`);
      const qLink = await page.locator('li[data-question] a').first().getAttribute('href');
      await visit(qLink, `${ws}-frage-detail`, ['Die Antworten']);
      check(await page.locator('[data-testid=fazit]').count() === 1, `${ws}: Frage-Detail beginnt mit dem Fazit`);
      await mobile(`/w/${ws}/fragen`, `${ws}-fragen`, `${ws}: Fragen`);
      await mobile(qLink, `${ws}-frage-detail`, `${ws}: Frage-Detail`);
      await visit(`/w/${ws}/fragen?ohne=1`, `${ws}-fragen-ohne`, ['Fragen ohne dich']);
      // „Fragen ohne dich“ = in keiner KI-Suche genannt
      const notAll = await page.locator('li[data-question]').evaluateAll((els) => els.filter((e) => !/Fehlt in (\d+) von \1 KI-Suchen/.test(e.textContent)).length);
      check(notAll === 0, `${ws}: „Fragen ohne dich“ zeigt nur Fragen ohne jede Nennung`);

      // Tiefer einsteigen
      const analyse = await visit(`/w/${ws}/analyse`, `${ws}-analyse`, ['KI-Sichtbarkeit', 'Anteil an allen Nennungen', own]);
      check(!/Kosten/.test(analyse), `${ws}: Analyse ohne Kostenspalte`);
      check(await page.locator('[data-testid=analyse-kpis]').count() === 1, `${ws}: Analyse mit einer Hauptzahl`);
      check(await page.locator('table.data button', { hasText: 'Wettbewerber' }).count() === 0, `${ws}: keine „+ Wettbewerber“-Knöpfe je Zeile`);
      await mobile(`/w/${ws}/analyse`, `${ws}-analyse`, `${ws}: Analyse`);
      const sources = await visit(`/w/${ws}/quellen`, `${ws}-quellen`, [ws === 'paylindo' ? 'paylindo.de' : 'medishift.com', 'Von KI gelesen, aber nicht zitiert']);
      // Gleiche Zahlenbasis wie die Übersicht: Anteil der eigenen Website = Wert aus der „Wichtigsten Erkenntnis“
      const ownDomain = ws === 'paylindo' ? 'paylindo.de' : 'medishift.com';
      const insightPct = home.match(/nutzen \S+ in (\d+)\s%/)?.[1];
      const row = await page.locator('table.data tr', { hasText: ownDomain }).first().innerText().catch(() => '');
      if (insightPct) check(new RegExp(`\\b${insightPct}\\s%`).test(row), `${ws}: ${ownDomain}-Anteil auf Quellen = ${insightPct} % wie auf der Übersicht`);
      else check(/\d+\s?%/.test(row), `${ws}: ${ownDomain} mit Anteil in den Quellen`);
      check(await page.locator('a[data-rec-link]').count() > 0, `${ws}: Quellen mit vorhandener Maßnahme markiert („→ Maßnahme“)`);
      await mobile(`/w/${ws}/quellen`, `${ws}-quellen`, `${ws}: Quellen`);
      // Einstellungen: eigene Unterseiten mit Seitenleiste
      await redirects(ws, `/w/${ws}/settings`, `/w/${ws}/settings/marke`);
      await page.goto(`${BASE}/w/${ws}/settings#messen`); await page.waitForURL('**/settings/messung', { timeout: 10000 }).catch(() => {});
      check(page.url().endsWith('/settings/messung'), `${ws}: alter Link /settings#messen öffnet Messung`);
      await visit(`/w/${ws}/settings/marke`, `${ws}-settings-marke`, ['Was du anbietest', 'Verbessert Maßnahmen und KI-Prompts', 'Name und Website']);
      await visit(`/w/${ws}/settings/wettbewerber`, `${ws}-settings-wettbewerber`, ['Wettbewerber', '+ Wettbewerber']);
      check(await page.locator('[data-testid=competitor-list] li').count() >= 3, `${ws}: Wettbewerber als Liste`);
      check(await page.locator('[data-testid=competitor-list] img[src*="/logo/"]').count() >= 3, `${ws}: Wettbewerber mit Logos`);
      await visit(`/w/${ws}/settings/fragen`, `${ws}-settings-fragen`, ['Frage hinzufügen', 'Themen']);
      await visit(`/w/${ws}/settings/messung`, `${ws}-settings-messung`, ['Jetzt messen', 'Messplan', 'Bisherige Messungen']);
      await visit(`/w/${ws}/settings/kosten`, `${ws}-settings-kosten`, ['Ausgaben im', 'Kosten je KI-Suche']);
      await visit(`/w/${ws}/settings/workspace`, `${ws}-settings-workspace`, ['Land', 'Sprache']);
      await mobile(`/w/${ws}/settings/wettbewerber`, `${ws}-settings-wettbewerber`, `${ws}: Einstellungen Wettbewerber`);

      // Logos: Übersicht + Kopfzeile, Auslieferung nur für Marken des Workspace
      await page.goto(`${BASE}/w/${ws}`, { waitUntil: 'networkidle' });
      check(await page.locator('main ol img[src*="/logo/"]').count() >= 2, `${ws}: Ranking mit Logos`);
      check(await page.locator('header img[src*="/logo/"]').count() === 1, `${ws}: eigenes Logo in der Kopfzeile`);
      const ownLogo = await page.request.get(`${BASE}/w/${ws}/logo/${ws === 'paylindo' ? 'paylindo.de' : 'medishift.com'}`);
      check(ownLogo.status() === 200 && /^image\//.test(ownLogo.headers()['content-type'] ?? '') && ownLogo.headers()['x-content-type-options'] === 'nosniff', `${ws}: Logo-Route liefert Bild`);
      const foreign = await page.request.get(`${BASE}/w/${ws}/logo/google.com`);
      check(foreign.status() === 404, `${ws}: Logo-Route verweigert fremde Domain`);

      // Alte Adressen leiten weiter
      await redirects(ws, `/w/${ws}/prompts`, `/w/${ws}/fragen`);
      await redirects(ws, `/w/${ws}/luecken`, `/w/${ws}/fragen?ohne=1`);
      await redirects(ws, `/w/${ws}/sources`, `/w/${ws}/quellen`);
    }
    const res = await page.goto(`${BASE}/w/gibt-es-nicht`);
    check(res.status() === 404, 'Fremder/unbekannter Workspace → 404');
  }

  if (phase === 'create') {
    await page.goto(`${BASE}/w`);
    await page.fill('#ws-name', 'E2E Test');
    await page.fill('#ws-brand', 'Paylindo');
    await page.fill('#ws-domains', 'paylindo.de');
    await page.click('text=Workspace anlegen');
    await page.waitForURL(/\/w\/[^/]+$/, { timeout: 15000 });
    const slug = page.url().match(/\/w\/([^/?#]+)/)[1];
    fs.writeFileSync('e2e/.slug', slug);
    check(!!slug, `Workspace angelegt: ${slug}`);
    check(await page.locator('[data-testid=onboarding] li').count() === 3, 'Neuer Workspace zeigt 3 Schritte');

    // Wettbewerber
    await page.goto(`${BASE}/w/${slug}/settings/wettbewerber`, { waitUntil: 'networkidle' });
    await page.click('[data-testid=add-competitor] summary');
    const add = page.locator('[data-testid=add-competitor]');
    await add.locator('input[name=name]').fill('SumUp');
    await add.locator('input[name=domains]').fill('sumup.com, sumup.de');
    await add.locator('button', { hasText: 'Hinzufügen' }).click();
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    check(await page.locator('[data-testid=competitor-list]', { hasText: 'SumUp' }).count() > 0, 'Wettbewerber gespeichert');
    // Frage
    await page.goto(`${BASE}/w/${slug}/settings/fragen`, { waitUntil: 'networkidle' });
    await page.fill('input[aria-label="Neue Frage"]', 'Welches EC-Kartengerät ist für ein kleines Café am günstigsten?');
    await page.click('button:has-text("Frage hinzufügen")');
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    check(await page.locator('[data-testid=prompt-list] li').count() === 1, 'Frage gespeichert');
    // Budget 2 $ (eigene Seite) – Messplan bleibt dabei unverändert
    await page.goto(`${BASE}/w/${slug}/settings/kosten`, { waitUntil: 'networkidle' });
    await page.fill('#w-budget', '2,00');
    await page.locator('form', { has: page.locator('#w-budget') }).locator('button', { hasText: 'Speichern' }).click();
    await page.waitForTimeout(1500);
    // Messplan: 1 Durchgang, Zeitplan aus
    await page.goto(`${BASE}/w/${slug}/settings/messung`, { waitUntil: 'networkidle' });
    await page.fill('#w-rep', '1');
    const sched = page.locator('input[name=scheduleEnabled]');
    if (await sched.isChecked()) await sched.uncheck();
    await page.locator('form', { has: page.locator('#w-rep') }).locator('button', { hasText: 'Speichern' }).click();
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    check((await page.inputValue('#w-rep')) === '1', 'Wiederholungen = 1 gespeichert');
    check(!(await sched.isChecked()), 'Zeitplan ausgeschaltet');
    const [wsRow] = await sql(`select monthly_budget_usd::text as b, name from workspace where slug = $1`, [slug]);
    check(wsRow.b === '2.00' && wsRow.name === 'E2E Test', 'Budget gespeichert, Name unverändert (Teil-Speichern)');
    await page.click('button:has-text("Jetzt messen")');
    await page.waitForTimeout(2000);
    const after = await page.innerText('body');
    check(/in Warteschlange|wartet auf den Worker/.test(after), 'Messung in Warteschlange');
    await page.screenshot({ path: path.join(SHOTS, 'e2e-settings-queued.png'), fullPage: true });
  }

  if (phase === 'verify') {
    const slug = fs.readFileSync('e2e/.slug', 'utf8').trim();
    await visit(`/w/${slug}/settings/messung`, 'e2e-settings-done', ['abgeschlossen']);
    const overview = await visit(`/w/${slug}`, 'e2e-uebersicht', ['KI-Sichtbarkeit']);
    check(!overview.includes('Noch keine Messung'), 'Übersicht zeigt Messdaten');
    await visit(`/w/${slug}/massnahmen`, 'e2e-massnahmen', ['Maßnahmen']);
    await visit(`/w/${slug}/analyse`, 'e2e-analyse', ['KI-Sichtbarkeit', 'SumUp']);
    await visit(`/w/${slug}/fragen`, 'e2e-fragen', ['Café']);
    const link = await page.locator('li[data-question] a').first().getAttribute('href');
    const detail = await visit(link, 'e2e-frage-detail', ['ChatGPT', 'Gemini', 'Claude']);
    check(/https?:\/\//.test(detail) || detail.includes('.de'), 'Detailseite zeigt Quellen');
    await visit(`/w/${slug}/quellen`, 'e2e-quellen', []);
  }
  if (phase === 'i18n') {
    const ws = 'paylindo';
    const lang = () => page.getAttribute('html', 'lang');
    await page.goto(`${BASE}/w/${ws}`, { waitUntil: 'networkidle' });
    check(await lang() === 'de', 'Standard: Oberfläche auf Deutsch');
    // Umschalter im Konto-Menü
    await page.click('[data-testid=user-menu] summary');
    await page.locator('[data-testid=locale-switcher] button', { hasText: 'en' }).click();
    await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 10000 });
    const nav = await page.innerText('header nav');
    check(['Overview', 'Actions', 'Questions'].every((x) => nav.includes(x)), 'Navigation auf Englisch');
    await page.screenshot({ path: path.join(SHOTS, `${ws}-uebersicht-en.png`), fullPage: true });
    const cookie = (await context.cookies(BASE)).find((c) => c.name === 'askmetry_locale');
    check(cookie?.value === 'en', 'Sprach-Cookie gesetzt');
    for (const [url, expect] of [
      [`/w/${ws}/settings/marke`, ['Brand', 'What you offer']],
      [`/w/${ws}/settings/wettbewerber`, ['Competitors', '+ Competitor']],
      [`/w/${ws}/settings/fragen`, ['Add question', 'Topics']],
      [`/w/${ws}/settings/messung`, ['Measure now', 'Schedule', 'Past measurements']],
      [`/w/${ws}/settings/kosten`, ['Spent in', 'Cost per AI engine']],
      [`/w/${ws}/settings/workspace`, ['Country', 'Language']],
    ]) {
      const text = await visit(url, `${url.split('/').pop()}-en`, expect);
      // nur UI-Wörter prüfen – Fragen, Markenbeschreibung usw. sind Daten des Workspaces (Deutsch)
      check(!/\b(Einstellungen|Speichern|Hinzufügen|Wettbewerber|Bisherige|Durchgänge|Nur lesen)\b/.test(text), `${url}: keine deutschen UI-Texte`);
    }
    // Login-Seite (ohne Anmeldung) folgt dem Cookie
    const anon = await browser.newContext({ locale: 'de-DE' });
    await anon.addCookies([{ name: 'askmetry_locale', value: 'en', url: BASE }]);
    const p2 = await anon.newPage();
    await p2.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    check((await p2.innerText('body')).includes('Sign in'), 'Login auf Englisch per Cookie (trotz Accept-Language de)');
    await anon.close();
    // zurück auf Deutsch
    await page.goto(`${BASE}/w/${ws}`, { waitUntil: 'networkidle' });
    await page.click('[data-testid=user-menu] summary');
    await page.locator('[data-testid=locale-switcher] button', { hasText: 'de' }).click();
    await page.waitForFunction(() => document.documentElement.lang === 'de', null, { timeout: 10000 });
    check((await page.innerText('header nav')).includes('Übersicht'), 'Zurück auf Deutsch');
  }
} catch (e) {
  // Absturz zählt als Fehlschlag (vorher verschluckte process.exit im finally den Fehler)
  check(false, `Abbruch: ${e?.stack ?? e}`);
} finally {
  if (errors.length) { console.log(`\nKonsolenfehler (${errors.length}):`); errors.slice(0, 10).forEach((e) => console.log('  ' + e)); }
  check(errors.length === 0, 'Keine Konsolenfehler');
  await browser.close();
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
  process.exit(failures ? 1 : 0);
}
