// Rücksprung-Ziele (?next=…) absichern: nur relative Pfade dieser App, keine fremden Hosts (Open Redirect).

/** Gültiger interner Pfad oder null. Erlaubt Query-Strings; verbietet //host, /\host, Protokolle und Steuerzeichen. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string' || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  try {
    const u = new URL(raw, 'http://x.invalid');
    if (u.host !== 'x.invalid') return null;
    // nach der Normalisierung erneut prüfen: /.//evil.com oder /a/..//evil.com wird sonst zu //evil.com
    const out = u.pathname + u.search;
    if (out.startsWith('//') || out.startsWith('/\\')) return null;
    return out;
  } catch {
    return null;
  }
}

/** Check-Token aus einem Rücksprung-Ziel wie /kaufen?tier=compact&check=<token> oder /check/<token> (für die Vorbelegung der E-Mail). */
export function checkTokenFromNext(next: string | null): string | null {
  if (!next) return null;
  const u = new URL(next, 'http://x.invalid');
  const t = u.searchParams.get('check') ?? /^\/check\/([A-Za-z0-9_-]+)/.exec(u.pathname)?.[1] ?? null;
  return t && /^[A-Za-z0-9_-]{16,128}$/.test(t) ? t : null;
}
