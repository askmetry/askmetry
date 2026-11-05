import { describe, expect, it } from 'vitest';
import { extractToc, idMaker, slugify, splitTitle, stripComments } from './legal-markdown';

describe('stripComments', () => {
  it('entfernt mehrzeilige Entwurfs-Kommentare', () => {
    expect(stripComments('<!--\nENTWURF – intern\n-->\n\n# Impressum\nText <!-- x --> da')).toBe('# Impressum\nText  da');
  });
  it('entfernt auch einen nicht geschlossenen Kommentar bis zum Ende', () => {
    expect(stripComments('A\n<!-- offen')).toBe('A\n');
  });
});

describe('splitTitle', () => {
  it('löst die erste h1 heraus', () => {
    expect(splitTitle('# Datenschutz**erklärung**\n\nText\n## 1. A')).toEqual({ title: 'Datenschutzerklärung', body: 'Text\n## 1. A' });
  });
  it('ohne h1 bleibt alles', () => {
    expect(splitTitle('## A\nB')).toEqual({ title: null, body: '## A\nB' });
  });
});

describe('slugify / idMaker', () => {
  it('Umlaute und Satzzeichen', () => {
    expect(slugify('4.3 Missbrauchsschutz: IP-Hash & Begrenzungen')).toBe('4-3-missbrauchsschutz-ip-hash-begrenzungen');
    expect(slugify('Ihre Rechte über Größe')).toBe('ihre-rechte-ueber-groesse');
    expect(slugify('§§')).toBe('abschnitt');
  });
  it('gleiche Überschriften bekommen Zähler', () => {
    const id = idMaker();
    expect([id('Kosten'), id('Kosten'), id('Andere')]).toEqual(['kosten', 'kosten-2', 'andere']);
  });
});

describe('extractToc', () => {
  it('nur h2, IDs zählen h3 mit, Codeblöcke ignoriert', () => {
    const md = '## Eins\n### Eins\n```\n## kein\n```\n## [Zwei](http://x)\n';
    expect(extractToc(md)).toEqual([{ id: 'eins', text: 'Eins' }, { id: 'zwei', text: 'Zwei' }]);
  });
});
