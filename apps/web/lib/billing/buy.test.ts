import { describe, expect, it, vi } from 'vitest';
import { hostedConfig, TERMS_VERSION, type HostedConfig } from '@askmetry/core/hosted/config';
import { buyReportWith, type BuyDeps } from './buy';
import { parseBuyForm } from './form';

class Redirect extends Error { constructor(public url: string) { super('NEXT_REDIRECT'); } }
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab';

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const full = (o: Record<string, string> = {}) => form({ tier: 'compact', kind: 'initial', checkToken: TOKEN, b2b: 'on', terms: 'on', ...o });

function deps(over: Partial<BuyDeps> = {}, cfgOver: Partial<HostedConfig> = {}) {
  const calls: string[] = [];
  const d = {
    config: () => ({ ...hostedConfig(), hosted: true, payments: 'fake', publicUrl: 'https://askmetry.test', ...cfgOver }) as HostedConfig,
    currentUser: vi.fn(async () => ({ id: 'u1', email: 'kauf@firma.de' })),
    locale: async () => 'de' as const,
    message: async (c: string) => `msg:${c}`,
    findCheck: vi.fn(async () => ({ id: 'check1' })),
    editorWorkspace: vi.fn(async (): Promise<{ id: string } | 'denied' | null> => ({ id: 'ws1' })),
    prepareReport: vi.fn(async () => { calls.push('prepare'); return { reportId: 'rep1', workspaceId: 'ws9', slug: 'firma' }; }),
    createCheckout: vi.fn(async () => { calls.push('checkout'); return { url: 'https://askmetry.test/kasse/fake_cs_x', sessionId: 'fake_cs_x' }; }),
    attachCheckoutSession: vi.fn(async () => { calls.push('attach'); }),
    trackEvent: vi.fn(async () => { calls.push('track'); }),
    redirect: (url: string): never => { throw new Redirect(url); },
    now: () => new Date('2026-11-05T10:00:00Z'),
    log: vi.fn(),
    ...over,
  };
  return Object.assign(d, { calls });
}
const run = async (d: BuyDeps, f: FormData) => {
  try { return { state: await buyReportWith(d, f) }; } catch (e) { if (e instanceof Redirect) return { redirect: e.url }; throw e; }
};

describe('parseBuyForm', () => {
  it('akzeptiert Check-Kauf und Arbeitsbereich-Kauf', () => {
    expect(parseBuyForm(full())).toMatchObject({ ok: true, form: { tier: 'compact', kind: 'initial', target: { checkToken: TOKEN }, b2b: true, terms: true } });
    expect(parseBuyForm(form({ tier: 'strategy', kind: 'remeasure', workspaceSlug: 'firma-2' }))).toMatchObject({ ok: true, form: { target: { workspaceSlug: 'firma-2' }, b2b: false, terms: false } });
  });
  it('lehnt ungültige Felder ab', () => {
    for (const f of [
      full({ tier: 'gold' }), full({ kind: 'abo' }), form({ tier: 'compact', b2b: 'on', terms: 'on' }),
      full({ workspaceSlug: 'firma' }), full({ checkToken: '../../x' }), full({ kind: 'remeasure' }),
      form({ tier: 'compact', workspaceSlug: 'Firma Ä' }),
    ]) expect(parseBuyForm(f)).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('buyReport', () => {
  it('Erfolg: prepareReport → createCheckout → attach → track → redirect zum Checkout', async () => {
    const d = deps();
    const r = await run(d, full());
    expect(r).toEqual({ redirect: 'https://askmetry.test/kasse/fake_cs_x' });
    expect(d.calls).toEqual(['prepare', 'checkout', 'attach', 'track']);
    expect(d.prepareReport).toHaveBeenCalledWith({
      userId: 'u1', tier: 'compact', kind: 'initial', checkId: 'check1', workspaceId: undefined,
      amountCents: hostedConfig().priceCents.compact, b2bConfirmedAt: new Date('2026-11-05T10:00:00Z'),
      termsAcceptedAt: new Date('2026-11-05T10:00:00Z'), termsVersion: TERMS_VERSION, provider: 'fake',
    });
    expect(d.createCheckout).toHaveBeenCalledWith({
      reportId: 'rep1', tier: 'compact', kind: 'initial', customerEmail: 'kauf@firma.de', locale: 'de',
      successUrl: 'https://askmetry.test/w/firma/bericht/rep1?checkout=done',
      cancelUrl: `https://askmetry.test/check/${TOKEN}?checkout=canceled`,
    });
    expect(d.attachCheckoutSession).toHaveBeenCalledWith('rep1', 'fake_cs_x');
    expect(d.trackEvent).toHaveBeenCalledWith('checkout_started', expect.objectContaining({ reportId: 'rep1', userId: 'u1', checkId: 'check1' }));
  });
  it('Nachmessung im Arbeitsbereich: Mitgliedschaft geprüft, Preis der Nachmessung', async () => {
    const d = deps({}, { payments: 'stripe' });
    const r = await run(d, form({ tier: 'strategy', kind: 'remeasure', workspaceSlug: 'firma', b2b: 'on', terms: 'on' }));
    expect(r.redirect).toBeDefined();
    expect(d.editorWorkspace).toHaveBeenCalledWith('firma');
    expect(d.findCheck).not.toHaveBeenCalled();
    expect(d.prepareReport).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws1', checkId: undefined, kind: 'remeasure', amountCents: hostedConfig().priceCents.remeasure_strategy, provider: 'stripe' }));
    expect(d.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ cancelUrl: 'https://askmetry.test/w/firma?checkout=canceled' }));
  });
  it('ohne Anmeldung → Registrierung mit Rücksprung', async () => {
    const d = deps({ currentUser: vi.fn(async () => null) });
    expect(await run(d, full({ b2b: '', terms: '' }))).toEqual({ redirect: `/signup?next=${encodeURIComponent(`/check/${TOKEN}`)}` });
    expect(d.prepareReport).not.toHaveBeenCalled();
  });
  it('Pflicht-Häkchen fehlen → Fehler, nichts angelegt', async () => {
    const d = deps();
    expect((await run(d, full({ b2b: '' }))).state).toEqual({ code: 'b2bRequired', error: 'msg:b2bRequired' });
    expect((await run(d, full({ terms: '' }))).state).toEqual({ code: 'termsRequired', error: 'msg:termsRequired' });
    expect(d.prepareReport).not.toHaveBeenCalled();
  });
  it('ungültiges Formular, Hosted aus, unbekannter Check, Leserecht', async () => {
    expect((await run(deps(), full({ tier: 'x' }))).state?.code).toBe('invalid');
    expect((await run(deps({}, { hosted: false }), full())).state?.code).toBe('unavailable');
    expect((await run(deps({ findCheck: vi.fn(async () => null) }), full())).state?.code).toBe('notFound');
    const ws = form({ tier: 'compact', kind: 'initial', workspaceSlug: 'firma', b2b: 'on', terms: 'on' });
    expect((await run(deps({ editorWorkspace: vi.fn(async () => 'denied' as const) }), ws)).state?.code).toBe('noPermission');
    expect((await run(deps({ editorWorkspace: vi.fn(async () => null) }), ws)).state?.code).toBe('notFound');
  });
  it('Fehler beim Checkout → failed bzw. unavailable (Konfiguration), ohne Redirect; Log ohne Personendaten', async () => {
    const boom = deps({ createCheckout: vi.fn(async () => { throw Object.assign(new Error('Invalid email kauf@firma.de'), { code: 'email_invalid' }); }) });
    expect((await run(boom, full())).state?.code).toBe('failed');
    expect(boom.attachCheckoutSession).not.toHaveBeenCalled();
    expect(JSON.stringify((boom.log as any).mock.calls)).not.toContain('firma.de');
    const cfgErr = deps({ createCheckout: vi.fn(async () => { const e = new Error('Stripe-Preis fehlt'); e.name = 'BillingConfigError'; throw e; }) });
    expect((await run(cfgErr, full())).state?.code).toBe('unavailable');
  });
  it('Funnel-Fehler blockiert den Kauf nicht', async () => {
    const d = deps({ trackEvent: vi.fn(async () => { throw new Error('db'); }) });
    expect((await run(d, full())).redirect).toBe('https://askmetry.test/kasse/fake_cs_x');
  });
});
