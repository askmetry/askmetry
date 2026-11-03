import { describe, expect, it } from 'vitest';
import { sniffImage } from '../../src/logo.ts';

const svg = (s: string) => sniffImage(new TextEncoder().encode(s));

describe('sniffImage', () => {
  it('erkennt Rasterformate an den Bytes', () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(svg('<html><body>kein Bild</body></html>')).toBeNull();
  });
  it('lässt harmlose SVGs zu (auch mit internen #-Verweisen)', () => {
    expect(svg('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use xlink:href="#g"/><use href=\'#g\'/></svg>')).toBe('image/svg+xml');
  });
  it('lehnt SVGs mit Skripten, Handlern, Entities oder externen Verweisen ab', () => {
    for (const bad of [
      '<svg><script>alert(1)</script></svg>',
      '<svg/onload=alert(1)>',
      '<svg><a href="jav&#x61;script:x">x</a></svg>',
      '<svg xmlns:x="http://www.w3.org/2000/svg"><x:script>1</x:script></svg>',
      '<svg><svg:foreignObject/></svg>',
      '<svg><use href="https://evil.example/a.svg#x"/></svg>',
      '<svg><image xlink:href="https://evil.example/x.png"/></svg>',
      '<svg><style>@import url(https://evil.example/a.css)</style></svg>',
      '<svg><rect style="fill:url(https://evil.example/x)"/></svg>',
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg>&a;</svg>',
    ]) expect(svg(bad), bad).toBeNull();
  });
});
