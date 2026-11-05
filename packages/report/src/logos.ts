// Markenlogos für den PDF-Bericht: aus der DB (brand.logo_data hat Vorrang vor domain_logo), ohne Netzwerkabruf.
// react-pdf kann nur PNG, JPG und SVG. ICO wird hier umgewandelt (eingebettetes PNG oder BMP → PNG), WebP/GIF fallen
// auf den Initialen-Kreis zurück. Rein bis auf loadBrandLogos (DB).
import { deflateSync } from 'node:zlib';
import { brand, db, domainLogo } from '@askmetry/db';
import { and, eq, inArray } from 'drizzle-orm';

/** Logo, wie es react-pdf direkt rendern kann. */
export interface PdfLogo { format: 'png' | 'jpg' | 'svg'; data: Buffer }

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.length > 24 && b.subarray(0, 8).equals(PNG_SIG);
const isJpg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Bild (Bytes + MIME-Typ) in ein Format bringen, das react-pdf rendert; null = nicht darstellbar (dann Initiale). */
export function toPdfLogo(contentType: string | null | undefined, bytes: Buffer | Uint8Array | null | undefined): PdfLogo | null {
  if (!bytes || bytes.length < 8) return null;
  const b = Buffer.from(bytes);
  const t = (contentType ?? '').toLowerCase();
  try {
    if (isPng(b)) return pngOk(b) ? { format: 'png', data: b } : null;
    if (isJpg(b)) return jpgOk(b) ? { format: 'jpg', data: b } : null;
    if (t.includes('svg')) return svgLogo(b);
    if (t.includes('icon') || (b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1)) return icoToPng(b);
  } catch {
    return null;
  }
  return null; // WebP, GIF, Unbekanntes
}

/** JPG mit lesbarem Bildkopf (SOF-Marker mit Breite/Höhe > 0); react-pdf schluckt Decodierfehler sonst still (leere Kachel). */
function jpgOk(b: Buffer): boolean {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return false;
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    // SOF0–SOF15 außer DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return b.readUInt16BE(i + 5) > 0 && b.readUInt16BE(i + 7) > 0;
    }
    if (len < 2) return false;
    i += 2 + len;
  }
  return false;
}

/** PNG-Varianten, die png-js (react-pdf) sicher kann: 8 Bit je Kanal, nicht interlaced. */
function pngOk(b: Buffer): boolean {
  // IHDR: Breite(4) Höhe(4) Bittiefe(1) Farbtyp(1) Kompression(1) Filter(1) Interlace(1) ab Byte 16
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const depth = b[24], interlace = b[28];
  return w > 0 && h > 0 && w <= 4096 && h <= 4096 && depth <= 8 && interlace === 0;
}

/** SVG so zuschneiden, dass es mit <svg beginnt (react-pdf erkennt es sonst nicht). Inhalt ist beim Abruf geprüft (sniffImage). */
function svgLogo(b: Buffer): PdfLogo | null {
  const s = b.toString('utf8');
  const i = s.search(/<svg[\s>]/i);
  if (i < 0) return null;
  const svg = s.slice(i);
  // ohne viewBox und Größe kann react-pdf nicht skalieren
  if (!/viewBox\s*=/.test(svg) && !(/\bwidth\s*=/.test(svg) && /\bheight\s*=/.test(svg))) return null;
  // Text, Bilder, Verweise und eingebettete Styles rendert react-pdf nicht verlässlich – lieber die Initiale
  if (/<(text|image|use|style|filter|mask|pattern|foreignObject)\b/i.test(svg)) return null;
  return { format: 'svg', data: Buffer.from(svg, 'utf8') };
}

// ---------------------------------------------------------------------------
// ICO → PNG
// ---------------------------------------------------------------------------

/** Größtes Bild einer ICO-Datei als PNG (eingebettetes PNG direkt, BMP-Einträge umgewandelt). */
export function icoToPng(b: Buffer): PdfLogo | null {
  if (b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) return null;
  const n = b.readUInt16LE(4);
  const entries: { w: number; bpp: number; size: number; offset: number }[] = [];
  for (let i = 0; i < n && 6 + i * 16 + 16 <= b.length; i++) {
    const o = 6 + i * 16;
    entries.push({ w: b[o] || 256, bpp: b.readUInt16LE(o + 6), size: b.readUInt32LE(o + 8), offset: b.readUInt32LE(o + 12) });
  }
  // größtes zuerst, bei gleicher Größe mehr Farbtiefe
  entries.sort((x, y) => y.w - x.w || y.bpp - x.bpp);
  for (const e of entries) {
    if (e.offset + e.size > b.length || e.size < 40) continue;
    const img = b.subarray(e.offset, e.offset + e.size);
    if (isPng(img)) { if (pngOk(img)) return { format: 'png', data: Buffer.from(img) }; continue; }
    const rgba = bmpToRgba(img);
    if (rgba) return { format: 'png', data: encodePng(rgba.w, rgba.h, rgba.px) };
  }
  return null;
}

/** BMP-Eintrag einer ICO-Datei (BITMAPINFOHEADER, Höhe doppelt wegen AND-Maske) → RGBA. 1/4/8/24/32 Bit. */
function bmpToRgba(d: Buffer): { w: number; h: number; px: Buffer } | null {
  const hs = d.readUInt32LE(0);
  if (hs < 40) return null;
  const w = d.readInt32LE(4);
  // Höhe ist doppelt (Farbe + Maske); negative Höhe (oben nach unten) oder ungerade Werte kommen in ICOs praktisch nicht vor → ablehnen
  const h = d.readInt32LE(8) / 2;
  if (!Number.isInteger(h)) return null;
  const bpp = d.readUInt16LE(14);
  const compression = d.readUInt32LE(16);
  if (w <= 0 || h <= 0 || w > 512 || h > 512 || compression !== 0 || ![1, 4, 8, 24, 32].includes(bpp)) return null;
  const colors = bpp <= 8 ? (d.readUInt32LE(32) || 1 << bpp) : 0;
  const pal = hs;
  const xorOff = hs + colors * 4;
  const xorStride = Math.ceil((w * bpp) / 32) * 4;
  const andOff = xorOff + xorStride * h;
  const andStride = Math.ceil(w / 32) * 4;
  if (xorOff + xorStride * h > d.length) return null;
  const hasAnd = andOff + andStride * h <= d.length;
  const px = Buffer.alloc(w * h * 4);
  let anyAlpha = false;
  for (let y = 0; y < h; y++) {
    const row = xorOff + (h - 1 - y) * xorStride; // BMP: unten nach oben
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, bl = 0, a = 255;
      if (bpp === 32) { bl = d[row + x * 4]; g = d[row + x * 4 + 1]; r = d[row + x * 4 + 2]; a = d[row + x * 4 + 3]; if (a) anyAlpha = true; }
      else if (bpp === 24) { bl = d[row + x * 3]; g = d[row + x * 3 + 1]; r = d[row + x * 3 + 2]; }
      else {
        const bit = x * bpp;
        const byte = d[row + (bit >> 3)];
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const p = pal + idx * 4;
        if (p + 3 > xorOff) return null;
        bl = d[p]; g = d[p + 1]; r = d[p + 2];
      }
      px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = a;
    }
  }
  // Transparenz: 32 Bit mit Alphakanal nutzt ihn; sonst (oder wenn Alpha überall 0 ist) die AND-Maske
  if (bpp !== 32 || !anyAlpha) {
    for (let y = 0; y < h; y++) {
      const row = andOff + (h - 1 - y) * andStride;
      for (let x = 0; x < w; x++) {
        const transparent = hasAnd && ((d[row + (x >> 3)] >> (7 - (x & 7))) & 1) === 1;
        px[(y * w + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  }
  return { w, h, px };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const x of buf) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** RGBA-Pixel als PNG (8 Bit, Farbtyp 6, ohne Filter). */
export function encodePng(w: number, h: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Laden (DB)
// ---------------------------------------------------------------------------

/**
 * Logos aller Marken eines Arbeitsbereichs, Schlüssel = brand.id. Reihenfolge: selbst hochgeladenes Logo der Marke,
 * sonst das gespeicherte Website-Logo der Hauptdomain. Marken ohne darstellbares Logo fehlen in der Map.
 */
export async function loadBrandLogos(workspaceId: string): Promise<Record<string, PdfLogo>> {
  const brands = await db.select({ id: brand.id, domains: brand.domains, logoData: brand.logoData, logoType: brand.logoType })
    .from(brand).where(eq(brand.workspaceId, workspaceId));
  const mainDomain = (ds: string[]) => (ds[0] ?? '').toLowerCase().replace(/^www\./, '');
  const domains = [...new Set(brands.map((b) => mainDomain(b.domains)).filter(Boolean))];
  const rows = domains.length
    ? await db.select({ domain: domainLogo.domain, contentType: domainLogo.contentType, data: domainLogo.data }).from(domainLogo)
      .where(and(inArray(domainLogo.domain, domains), eq(domainLogo.status, 'ok')))
    : [];
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  const out: Record<string, PdfLogo> = {};
  for (const b of brands) {
    const own = b.logoData ? toPdfLogo(b.logoType, Buffer.from(b.logoData, 'base64')) : null;
    const site = byDomain.get(mainDomain(b.domains));
    const logo = own ?? (site?.data ? toPdfLogo(site.contentType, Buffer.from(site.data, 'base64')) : null);
    if (logo) out[b.id] = logo;
  }
  return out;
}
