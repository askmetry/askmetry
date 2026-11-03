import { describe, expect, it } from 'vitest';
import { safeUrl } from './url';

describe('safeUrl', () => {
  it('lässt nur http/https zu', () => {
    expect(safeUrl('https://chip.de/x')).toBe('https://chip.de/x');
    expect(safeUrl(' http://a.de ')).toBe('http://a.de/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('/relativ')).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});
