import { describe, expect, it } from 'vitest';
import { encodePng, toPdfLogo } from '../src/logos.ts';

const ico = (entries: Buffer[], bpp = 32) => {
  const dir = Buffer.alloc(6 + 16 * entries.length);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let off = dir.length;
  entries.forEach((img, i) => {
    const o = 6 + i * 16;
    dir[o] = 16; dir[o + 1] = 16; dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(bpp, o + 6);
    dir.writeUInt32LE(img.length, o + 8); dir.writeUInt32LE(off, o + 12);
    off += img.length;
  });
  return Buffer.concat([dir, ...entries]);
};

describe('toPdfLogo', () => {
  it('lässt PNG und JPG durch', () => {
    const png = encodePng(3, 3, Buffer.alloc(36, 200));
    expect(toPdfLogo('image/png', png)).toEqual({ format: 'png', data: png });
    // SOI, APP0 (Länge 4), SOF0 mit 8×8
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
    expect(toPdfLogo('image/jpeg', jpg)?.format).toBe('jpg');
    // nur Signatur, kein Bildkopf → Initiale statt leerer Kachel
    expect(toPdfLogo('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]))).toBeNull();
  });
  it('lehnt 16-Bit- und interlaced PNG ab (png-js)', () => {
    const png = encodePng(3, 3, Buffer.alloc(36, 200));
    const deep = Buffer.from(png); deep[24] = 16;
    expect(toPdfLogo('image/png', deep)).toBeNull();
    const inter = Buffer.from(png); inter[28] = 1;
    expect(toPdfLogo('image/png', inter)).toBeNull();
  });
  it('schneidet SVG auf <svg zu und lehnt Text/Styles ab', () => {
    const svg = '<?xml version="1.0"?>\n<!-- x --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#099"/></svg>';
    const l = toPdfLogo('image/svg+xml', Buffer.from(svg))!;
    expect(l.format).toBe('svg');
    expect(l.data.toString('utf8').startsWith('<svg')).toBe(true);
    expect(toPdfLogo('image/svg+xml', Buffer.from('<svg viewBox="0 0 1 1"><style>.a{}</style></svg>'))).toBeNull();
    expect(toPdfLogo('image/svg+xml', Buffer.from('<svg><path d="M0 0"/></svg>'))).toBeNull();
  });
  it('holt aus ICO das eingebettete PNG oder wandelt BMP um', () => {
    const png = encodePng(16, 16, Buffer.alloc(16 * 16 * 4, 255));
    expect(toPdfLogo('image/x-icon', ico([png]))).toEqual({ format: 'png', data: png });

    // 8-Bit-BMP mit Palette (2 Farben) und AND-Maske: linke Hälfte transparent
    const w = 16, h = 16;
    const hdr = Buffer.alloc(40);
    hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(w, 4); hdr.writeInt32LE(h * 2, 8); hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(8, 14); hdr.writeUInt32LE(2, 32);
    const pal = Buffer.from([0, 0, 255, 0, 255, 0, 0, 0]); // Index 0 = rot, 1 = blau (BGRA)
    const xor = Buffer.alloc(w * h, 1);
    const and = Buffer.alloc(4 * h);
    for (let y = 0; y < h; y++) and[y * 4] = 0xff; // erste 8 Pixel jeder Zeile transparent
    const out = toPdfLogo('image/x-icon', ico([Buffer.concat([hdr, pal, xor, and])], 8))!;
    expect(out.format).toBe('png');
    expect(out.data.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(out.data.readUInt32BE(16)).toBe(16);
  });
  it('WebP, GIF und Unsinn → null (Initiale)', () => {
    expect(toPdfLogo('image/webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 xxxx'))).toBeNull();
    expect(toPdfLogo('image/gif', Buffer.from('GIF89a\x01\0\x01\0'))).toBeNull();
    expect(toPdfLogo('image/x-icon', Buffer.from([0, 0, 1, 0, 1, 0, 0, 0, 0, 0]))).toBeNull();
    expect(toPdfLogo(null, null)).toBeNull();
  });
});
