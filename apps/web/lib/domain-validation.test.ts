import { describe, expect, it } from 'vitest';
import { validateDomains } from './domain-validation';

describe('validateDomains', () => {
  it('akzeptiert öffentliche Domains und normalisiert', () => {
    expect(validateDomains('https://www.Paylindo.de/x, sumup.com')).toEqual({ domains: ['paylindo.de', 'sumup.com'] });
  });
  it.each(['localhost', '127.0.0.1', '169.254.169.254', '[::1]', 'intranet', 'db.internal', 'nas.local', 'metadata.google.internal'])('lehnt %s ab', (d) => {
    expect('error' in validateDomains(d)).toBe(true);
  });
  it('begrenzt die Anzahl', () => {
    expect('error' in validateDomains(Array.from({ length: 11 }, (_, i) => `d${i}.de`).join(','))).toBe(true);
  });
});

describe('validateDomains (Sprache)', () => {
  it('liefert Fehlermeldungen in der gewünschten Sprache', () => {
    expect(validateDomains('localhost')).toEqual({ error: '„localhost“ ist keine öffentliche Domain (Punkt fehlt, z. B. beispiel.de).' });
    expect(validateDomains('localhost', 'en')).toEqual({ error: '“localhost” isn’t a public domain (missing a dot, e.g. example.com).' });
    expect(validateDomains('127.0.0.1', 'en')).toEqual({ error: '“127.0.0.1”: please enter a domain instead of an IP address.' });
  });
});
