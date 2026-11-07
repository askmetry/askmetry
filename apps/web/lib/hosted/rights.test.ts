import { describe, expect, it } from 'vitest';
import { isHiddenWorkspace, scopeLimits, startProblem, strategyPreparing, topicsEnabled, workspaceRights } from './rights';

describe('workspaceRights', () => {
  it('selbst gehostet: alles wie bisher', () => {
    expect(workspaceRights({ hosted: false, hostedKind: 'customer' })).toEqual({ measureNow: true, measureSettings: true, costs: true, editPromptsAndCompetitors: true, reports: false, lockReason: null, promptTextLocked: false });
    expect(workspaceRights({ hosted: true, hostedKind: null }).measureNow).toBe(true);
  });
  it('Kunden-Workspace: Messen nur über Berichte', () => {
    const r = workspaceRights({ hosted: true, hostedKind: 'customer', reportStatuses: ['paid'] });
    expect(r).toEqual({ measureNow: false, measureSettings: false, costs: false, editPromptsAndCompetitors: true, reports: true, lockReason: null, promptTextLocked: false });
  });
  it('nach dem ersten fertigen Bericht: Wortlaut der Fragen fest', () => {
    expect(workspaceRights({ hosted: true, hostedKind: 'customer', reportStatuses: ['ready'] }).promptTextLocked).toBe(true);
    expect(workspaceRights({ hosted: false, hostedKind: 'customer', reportStatuses: ['ready'] }).promptTextLocked).toBe(false);
  });
  it('Fragen/Wettbewerber gesperrt, solange ein Bericht misst', () => {
    expect(workspaceRights({ hosted: true, hostedKind: 'customer', reportStatuses: ['ready', 'measuring'] }).editPromptsAndCompetitors).toBe(false);
    const re = workspaceRights({ hosted: true, hostedKind: 'customer', reportStatuses: ['ready', 'paid'], remeasurePaid: true });
    expect([re.editPromptsAndCompetitors, re.lockReason]).toEqual([false, 'remeasure']);
  });
  it('Check-Workspaces sind unsichtbar', () => {
    expect(isHiddenWorkspace('check')).toBe(true);
    expect(isHiddenWorkspace('customer')).toBe(false);
    expect(isHiddenWorkspace(null)).toBe(false);
  });
});

describe('scopeLimits', () => {
  it('größter bezahlter Umfang gewinnt', () => {
    expect(scopeLimits([])).toEqual({ prompts: 20, competitors: 3 });
    expect(scopeLimits([{ tier: 'compact', status: 'ready' }, { tier: 'strategy', status: 'paid' }])).toEqual({ prompts: 60, competitors: 5 });
    expect(scopeLimits([{ tier: 'strategy', status: 'pending_payment' }])).toEqual({ prompts: 20, competitors: 3 });
  });
});

describe('startProblem', () => {
  const base = { status: 'paid', tier: 'compact' as const, kind: 'initial', activePrompts: 20, competitors: 3 };
  it('alles passt', () => expect(startProblem(base)).toBeNull());
  it('falscher Status', () => expect(startProblem({ ...base, status: 'measuring' })).toBe('wrongState'));
  it('zu viele Fragen oder Wettbewerber', () => {
    expect(startProblem({ ...base, activePrompts: 21 })).toBe('tooManyPrompts');
    expect(startProblem({ ...base, competitors: 4 })).toBe('tooManyCompetitors');
  });
  it('weniger Fragen sind erlaubt, keine nicht', () => {
    expect(startProblem({ ...base, activePrompts: 12 })).toBeNull();
    expect(startProblem({ ...base, activePrompts: 0 })).toBe('tooFewPrompts');
  });
  it('Strategiebericht wartet auf Zusatzfragen', () => {
    expect(startProblem({ ...base, tier: 'strategy', activePrompts: 20, preparing: true })).toBe('preparing');
    expect(startProblem({ ...base, tier: 'strategy', activePrompts: 60, competitors: 5 })).toBeNull();
  });
  it('Nachmessung prüft nichts', () => expect(startProblem({ ...base, kind: 'remeasure', activePrompts: 99 })).toBeNull());
});

describe('strategyPreparing', () => {
  it('folgt dem Kern-Flag', () => {
    expect(strategyPreparing({ promptsPreparing: true })).toBe(true);
    expect(strategyPreparing({ promptsPreparing: false })).toBe(false);
  });
});

describe('topicsEnabled', () => {
  it('Standortbestimmung: keine Themen; Strategiebericht und Selbsthosting: Themen', () => {
    expect(topicsEnabled({ hosted: false, hostedKind: 'customer' })).toBe(true);
    expect(topicsEnabled({ hosted: true, hostedKind: null })).toBe(true);
    expect(topicsEnabled({ hosted: true, hostedKind: 'customer', reports: [{ tier: 'compact', status: 'ready' }] })).toBe(false);
    expect(topicsEnabled({ hosted: true, hostedKind: 'customer', reports: [] })).toBe(false);
    expect(topicsEnabled({ hosted: true, hostedKind: 'customer', reports: [{ tier: 'strategy', status: 'pending_payment' }] })).toBe(false);
    expect(topicsEnabled({ hosted: true, hostedKind: 'customer', reports: [{ tier: 'compact', status: 'ready' }, { tier: 'strategy', status: 'paid' }] })).toBe(true);
  });
});
