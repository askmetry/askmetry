// STUB – wird vom Backend-Agenten implementiert (Signaturen verbindlich, siehe HOSTED.md).
import type { CheckError, CheckView } from './types.ts';

const todo = (): never => { throw new Error('hosted/checks: noch nicht implementiert'); };

export function hashIp(_ip: string): string { return todo(); }
export async function startCheck(_input: { url: string; locale: 'de' | 'en'; ipHash: string | null }): Promise<{ token: string } | { error: CheckError }> { return todo(); }
export async function submitCheckEmail(_token: string, _email: string, _opts?: { turnstileToken?: string | null; ip?: string | null }): Promise<{ ok: true } | { error: CheckError }> { return todo(); }
export async function verifyCheckEmail(_token: string, _code: string): Promise<{ ok: true } | { error: CheckError }> { return todo(); }
export async function getCheckView(_token: string): Promise<CheckView | null> { return todo(); }
export async function processChecks(_opts: { log?: (m: string) => void; shouldStop?: () => boolean } = {}): Promise<void> { return todo(); }
