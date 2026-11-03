'use server';
// Alle ändernden Aktionen eines Workspaces. Jede prüft Mitgliedschaft + Schreibrecht (requireEditor)
// und schränkt Updates/Deletes zusätzlich auf workspace_id ein.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { brand, collection, db, prompt, topic, workspace } from '@opengeo/db';
import { normName, parseList, SELECTABLE_ENGINES } from '@/lib/metrics';
import { maxBudgetUsd } from '@/lib/limits';
import { isNoPermission, requireEditor } from '@/lib/session';
import { getI18n } from '@/lib/i18n/server';
import { validateDomains } from '@/lib/domain-validation';
import { isValidCron } from '@opengeo/core/schedule';
import { autofillBrandProfile, claudeBatchWaiting, refreshLogos } from '@opengeo/core';
import type { FormState } from './workspaces';

function isUniqueViolation(e: unknown): boolean {
  for (let cur: any = e, i = 0; cur && i < 5; cur = cur.cause, i++) if (cur.code === '23505') return true;
  return false;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
/** Logos neuer/geänderter Websites im Hintergrund holen (Fehler egal – dann bleibt die Initiale). */
const logosLater = (wsId: string) => after(() => refreshLogos(wsId).then(() => {}, () => {}));
const done = (slug: string, ok: string): FormState => {
  revalidatePath(`/w/${slug}`, 'layout');
  return { ok };
};
async function guard(f: FormData) {
  const slug = str(f, 'slug');
  const { t, f: fmt, locale } = await getI18n();
  try {
    return { slug, t: t.settings, fmt, locale, ...(await requireEditor(slug)) };
  } catch (e) {
    if (isNoPermission(e)) return { slug, denied: t.common.noPermission } as const;
    throw e;
  }
}

/** Bisher ungetrackte Nennungen (brand_id null) der Marke zuordnen – höchstens eine pro Antwort. */
async function backfillMentions(workspaceId: string, brandId: string, names: string[]) {
  const lowered = [...new Set(names.map(normName).filter(Boolean))];
  if (!lowered.length) return;
  await db.execute(sql`
    update mention set brand_id = ${brandId}
    where id in (
      select distinct on (m.response_id) m.id from mention m
      where m.workspace_id = ${workspaceId} and m.brand_id is null
        and lower(regexp_replace(trim(m.name), '\\s+', ' ', 'g')) in (${sql.join(lowered.map((n) => sql`${n}`), sql`, `)})
        and not exists (select 1 from mention m2 where m2.response_id = m.response_id and m2.brand_id = ${brandId})
      order by m.response_id, m.position
    )`);
}

export async function addCompetitor(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  const name = str(f, 'name');
  if (!name) return { error: g.t.errors.nameMissing };
  const existing = await db.select({ id: brand.id }).from(brand)
    .where(and(eq(brand.workspaceId, g.ws.id), sql`lower(${brand.name}) = ${name.toLowerCase()}`));
  const id = existing[0]?.id ?? (await db.insert(brand).values({ workspaceId: g.ws.id, name, isOwn: false }).returning({ id: brand.id }))[0]!.id;
  await backfillMentions(g.ws.id, id, [name]);
  return done(g.slug, g.t.ok.tracked(name));
}

/** Mehrere Namen auf einmal (Analyse: „Alle hinzufügen“). Höchstens 10, ohne Website. */
export async function addCompetitors(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  const names = f.getAll('name').map((n) => String(n).replace(/\s+/g, ' ').trim()).filter((n) => n && n.length <= 80).slice(0, 10);
  if (!names.length) return { error: g.t.errors.nameMissing };
  const existing = await db.select({ name: brand.name, aliases: brand.aliases }).from(brand).where(eq(brand.workspaceId, g.ws.id));
  const have = new Set(existing.flatMap((b) => [b.name, ...b.aliases]).map(normName));
  let n = 0;
  for (const name of names) {
    if (have.has(normName(name))) continue;
    have.add(normName(name)); // auch Dubletten innerhalb der Liste (Foo/foo) überspringen
    const id = (await db.insert(brand).values({ workspaceId: g.ws.id, name, isOwn: false }).returning({ id: brand.id }))[0]!.id;
    await backfillMentions(g.ws.id, id, [name]);
    n++;
  }
  return done(g.slug, n ? g.t.ok.addedMany(n) : g.t.ok.allTracked);
}

export async function saveBrand(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  const id = str(f, 'id');
  const name = str(f, 'name');
  if (!name) return { error: g.t.errors.enterName };
  const dom = validateDomains(str(f, 'domains'), g.locale);
  if ('error' in dom) return { error: dom.error };
  // Beschreibung/Typ pflegt nur saveBrandProfile (bzw. die automatische Erkennung) – hier nie überschreiben
  const values = {
    name,
    aliases: parseList(str(f, 'aliases')),
    domains: dom.domains,
  };
  let brandId = id;
  if (id) {
    const [before] = await db.select({ domains: brand.domains, isOwn: brand.isOwn, profileSource: brand.profileSource }).from(brand)
      .where(and(eq(brand.id, id), eq(brand.workspaceId, g.ws.id)));
    if (!before) return { error: g.t.errors.brandNotFound };
    // Neue Website der eigenen Marke → automatisch erkanntes Profil verwerfen und neu erkennen lassen (von Hand gesetztes bleibt)
    const sameDomains = [...before.domains].sort().join() === [...dom.domains].sort().join();
    const reprofile = before.isOwn && !sameDomains && before.profileSource !== 'user'
      ? { profileCheckedAt: null, ...(before.profileSource === 'auto' ? { description: null, kind: null, profileSource: null } : {}) }
      : {};
    const r = await db.update(brand).set({ ...values, ...reprofile }).where(and(eq(brand.id, id), eq(brand.workspaceId, g.ws.id))).returning({ id: brand.id });
    if (!r.length) return { error: g.t.errors.brandNotFound };
    if (before.isOwn && !sameDomains && before.profileSource !== 'user') after(() => autofillBrandProfile(g.ws.id).then(() => {}, () => {}));
    if (!sameDomains) logosLater(g.ws.id);
  } else {
    brandId = (await db.insert(brand).values({ ...values, workspaceId: g.ws.id, isOwn: false }).returning({ id: brand.id }))[0]!.id;
    if (dom.domains.length) logosLater(g.ws.id);
  }
  await backfillMentions(g.ws.id, brandId, [values.name, ...values.aliases]);
  return done(g.slug, id ? g.t.ok.saved : g.t.ok.competitorCreated(name));
}

export async function deleteBrand(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  const r = await db.delete(brand).where(and(eq(brand.id, str(f, 'id')), eq(brand.workspaceId, g.ws.id), eq(brand.isOwn, false))).returning({ id: brand.id });
  if (!r.length) return { error: g.t.errors.cannotDeleteOwn };
  return done(g.slug, g.t.ok.competitorRemoved);
}

async function validTopic(workspaceId: string, topicId: string) {
  if (!topicId) return null;
  const t = await db.select({ id: topic.id }).from(topic).where(and(eq(topic.id, topicId), eq(topic.workspaceId, workspaceId)));
  return t[0]?.id ?? null;
}

export async function savePrompt(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  const id = str(f, 'id');
  const text = str(f, 'text');
  if (text.length < 5) return { error: g.t.errors.fullQuestion };
  const values = { text, topicId: await validTopic(g.ws.id, str(f, 'topicId')), active: f.get('active') === 'on' };
  if (id) {
    const r = await db.update(prompt).set(values).where(and(eq(prompt.id, id), eq(prompt.workspaceId, g.ws.id))).returning({ id: prompt.id });
    if (!r.length) return { error: g.t.errors.promptNotFound };
  } else {
    await db.insert(prompt).values({ ...values, workspaceId: g.ws.id, language: g.ws.language, country: g.ws.country });
  }
  return done(g.slug, id ? g.t.ok.saved : g.t.ok.promptAdded);
}

export async function deletePrompt(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  await db.delete(prompt).where(and(eq(prompt.id, str(f, 'id')), eq(prompt.workspaceId, g.ws.id)));
  return done(g.slug, g.t.ok.promptDeleted);
}

export async function saveTopic(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  const id = str(f, 'id');
  const name = str(f, 'name');
  if (!name) return { error: g.t.errors.enterName };
  if (id) await db.update(topic).set({ name }).where(and(eq(topic.id, id), eq(topic.workspaceId, g.ws.id)));
  else await db.insert(topic).values({ workspaceId: g.ws.id, name });
  return done(g.slug, id ? g.t.ok.saved : g.t.ok.topicCreated(name));
}

export async function deleteTopic(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  await db.delete(topic).where(and(eq(topic.id, str(f, 'id')), eq(topic.workspaceId, g.ws.id)));
  return done(g.slug, g.t.ok.topicDeleted);
}

/**
 * Workspace-Einstellungen speichern. Die Einstellungs-Unterseiten senden je einen Teil (`part`):
 * messung (Messplan, KI-Suchen, Durchgänge), kosten (Budget), workspace (Name, Land, Sprache).
 * Ohne `part` werden alle Felder erwartet.
 */
export async function saveWorkspaceSettings(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  const part = str(f, 'part');
  const has = (p: string) => !part || part === p;
  const set: Partial<typeof workspace.$inferInsert> = {};
  if (has('messung')) {
    const engines = f.getAll('engines').map(String).filter((e) => (SELECTABLE_ENGINES as readonly string[]).includes(e));
    const repetitions = Number(str(f, 'repetitions'));
    const cron = str(f, 'scheduleCron').replace(/\s+/g, ' ');
    if (!engines.length) return { error: g.t.errors.pickEngine };
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) return { error: g.t.errors.reps };
    if (!/^(\S+ ){4}\S+$/.test(cron) || !/^[\d*/,\- ]+$/.test(cron) || !isValidCron(cron)) return { error: g.t.errors.cron };
    const scheduleEnabled = f.get('scheduleEnabled') === 'on';
    // Messplan geändert oder eingeschaltet → Änderungszeitpunkt merken, damit nicht sofort gemessen wird
    // (der Scheduler wartet auf den nächsten Cron-Zeitpunkt nach dieser Änderung).
    const scheduleChanged = cron !== g.ws.scheduleCron || scheduleEnabled !== g.ws.scheduleEnabled;
    Object.assign(set, { engines, repetitions, scheduleEnabled, scheduleCron: cron, ...(scheduleChanged ? { scheduleUpdatedAt: new Date() } : {}) });
  }
  if (has('kosten')) {
    const budget = Number(str(f, 'monthlyBudgetUsd').replace(',', '.'));
    if (!Number.isFinite(budget) || budget < 0) return { error: g.t.errors.budget };
    const maxBudget = maxBudgetUsd();
    if (budget > maxBudget) return { error: g.t.errors.budgetMax(g.fmt.usd(maxBudget)) };
    set.monthlyBudgetUsd = budget.toFixed(2);
  }
  if (has('workspace')) {
    if (!str(f, 'name')) return { error: g.t.errors.enterName };
    const country = (str(f, 'country') || 'DE').toUpperCase();
    const language = (str(f, 'language') || 'de').toLowerCase();
    if (!['DE', 'AT', 'CH'].includes(country) || !['de', 'en'].includes(language)) return { error: g.t.errors.countryLanguage };
    Object.assign(set, { name: str(f, 'name'), country, language });
  }
  if (!Object.keys(set).length) return { error: g.t.errors.nothing };
  await db.update(workspace).set(set).where(eq(workspace.id, g.ws.id));
  return done(g.slug, g.t.ok.saved);
}

export async function startCollection(_p: FormState, f: FormData): Promise<FormState> {
  const g = await guard(f);
  if ('denied' in g) return { error: g.denied };
  const activePrompts = await db.select({ id: prompt.id }).from(prompt).where(and(eq(prompt.workspaceId, g.ws.id), eq(prompt.active, true))).limit(1);
  if (!activePrompts.length) return { error: g.t.errors.noActivePrompts };
  const running = await db.select({ id: collection.id }).from(collection)
    .where(and(eq(collection.workspaceId, g.ws.id), inArray(collection.status, ['queued', 'running']))).limit(1);
  if (running.length) {
    // wartet die laufende Messung nur noch auf gebündelte Claude-Abfragen (Batch), die Wartezeit erklären
    const waiting = await claudeBatchWaiting(g.ws.id);
    return { error: waiting ? `${g.t.errors.alreadyRunning} ${(await getI18n()).t.common.batchWaiting(waiting)}` : g.t.errors.alreadyRunning };
  }
  try {
    await db.insert(collection).values({ workspaceId: g.ws.id, status: 'queued', trigger: 'manual' });
  } catch (e) {
    // Unique-Index collection_one_active_idx: parallel wurde schon eine Messung eingereiht
    if (isUniqueViolation(e)) return { error: g.t.errors.alreadyRunning };
    throw e;
  }
  return done(g.slug, g.t.ok.queued);
}
