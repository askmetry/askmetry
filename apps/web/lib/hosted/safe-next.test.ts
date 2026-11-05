import { describe, expect, it } from 'vitest';
import { checkTokenFromNext, safeNext } from './safe-next';

describe('safeNext', () => {
  it('erlaubt interne Pfade mit Query', () => {
    expect(safeNext('/kaufen?tier=compact&check=abc')).toBe('/kaufen?tier=compact&check=abc');
    expect(safeNext('/w')).toBe('/w');
  });
  it('verbietet fremde Ziele', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '/%0d%0aLocation:x', '', null, undefined, '/\u0000x', 'javascript:alert(1)']) {
      const r = safeNext(bad as string);
      if (r !== null) expect(r.startsWith('/') && !r.startsWith('//')).toBe(true);
      else expect(r).toBeNull();
    }
    expect(safeNext('//evil.com')).toBeNull();
    // Punkt-Segmente normalisieren sich sonst zu //evil.com
    for (const dot of ['/.//evil.com', '/x/..//evil.com', '/%2e//evil.com', '/./\\evil.com']) expect(safeNext(dot)).toBeNull();
    expect(safeNext('https://evil.com')).toBeNull();
  });
});

describe('checkTokenFromNext', () => {
  const tok = 'AbCdEfGhIjKlMnOpQrStUv';
  it('liest den Token aus /kaufen und /check', () => {
    expect(checkTokenFromNext(`/kaufen?tier=compact&check=${tok}`)).toBe(tok);
    expect(checkTokenFromNext(`/check/${tok}`)).toBe(tok);
    expect(checkTokenFromNext('/kaufen?check=x')).toBeNull();
    expect(checkTokenFromNext(null)).toBeNull();
  });
});
