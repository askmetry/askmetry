import { describe, expect, it } from 'vitest';
import { checkFormError, clientIp, formatEuro, precheckUrl } from './format';

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe('formatEuro', () => {
  it('ganze Beträge ohne Nachkommastellen', () => {
    expect(formatEuro(7900, 'de')).toBe('79 €');
    expect(formatEuro(7900, 'en')).toBe('€79');
    expect(formatEuro(150000, 'de')).toBe('1.500 €');
    expect(formatEuro(150000, 'en')).toBe('€1,500');
  });
  it('Cent-Beträge mit zwei Stellen', () => {
    expect(formatEuro(3950, 'de')).toBe('39,50 €');
    expect(formatEuro(3950, 'en')).toBe('€39.50');
  });
});

describe('checkFormError', () => {
  it('bekannte Codes bleiben, alles andere wird generic', () => {
    expect(checkFormError('rate_limited')).toBe('rate_limited');
    expect(checkFormError('disabled')).toBe('disabled');
    expect(checkFormError('wrong_state')).toBe('generic');
    expect(checkFormError(null)).toBe('generic');
  });
});

describe('clientIp', () => {
  it('bevorzugt cf-connecting-ip, dann x-real-ip', () => {
    expect(clientIp(h({ 'cf-connecting-ip': '203.0.113.9', 'x-real-ip': '10.0.0.2', 'x-forwarded-for': '1.1.1.1' }))).toBe('203.0.113.9');
    expect(clientIp(h({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '1.1.1.1' }))).toBe('198.51.100.2');
  });
  it('nimmt sonst den letzten (vom Proxy angehängten) x-forwarded-for-Eintrag – der erste ist fälschbar', () => {
    expect(clientIp(h({ 'x-forwarded-for': ' 6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientIp(h({}))).toBeNull();
  });
});

describe('precheckUrl', () => {
  it('erkennt leere und offensichtlich falsche Eingaben', () => {
    expect(precheckUrl('  ')).toBe('empty');
    expect(precheckUrl('meine firma')).toBe('invalid_url');
    expect(precheckUrl('localhost')).toBe('invalid_url');
  });
  it('lässt normale Adressen durch', () => {
    expect(precheckUrl('beispiel.de')).toBeNull();
    expect(precheckUrl('https://www.beispiel.de/preise?x=1')).toBeNull();
    expect(precheckUrl('www.beispiel.co.uk')).toBeNull();
  });
});
