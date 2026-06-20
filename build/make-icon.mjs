// Generates a square 1024x1024 PNG app icon for the Tauri build.
// Pure Node (zlib only) — no native deps. Run: node build/make-icon.mjs
// Output: src-tauri/icon-source.png  (feed to `tauri icon` to produce all sizes).
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const S = 1024;
const buf = Buffer.alloc(S * S * 4);

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function setPx(x, y, r, g, b, a) {
  const i = (y * S + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

// Membership test for a rounded rectangle [x0,y0]-[x1,y1] with corner radius rad.
function inRoundRect(x, y, x0, y0, x1, y1, rad) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + rad ? x0 + rad : (x > x1 - rad ? x1 - rad : x);
  const cy = y < y0 + rad ? y0 + rad : (y > y1 - rad ? y1 - rad : y);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

// Card geometry: a centered "document" with an amber header bar and slate text lines.
const CARD = { x0: 312, y0: 232, x1: 712, y1: 792, r: 56 };
const HEADER_BOTTOM = 340;
const LINE_YS = [410, 494, 578, 662];
const LINE = { x0: 360, x1: 664, h: 40 };

for (let y = 0; y < S; y++) {
  const t = y / S;
  // Vertical blue gradient (#3b82f6 top -> #1d4ed8 bottom), matches the editor accent.
  const bgR = lerp(0x3b, 0x1d, t), bgG = lerp(0x82, 0x4e, t), bgB = lerp(0xf6, 0xd8, t);
  for (let x = 0; x < S; x++) {
    let r = bgR, g = bgG, b = bgB;
    if (inRoundRect(x, y, CARD.x0, CARD.y0, CARD.x1, CARD.y1, CARD.r)) {
      if (y < HEADER_BOTTOM) { r = 0xf5; g = 0x9e; b = 0x0b; }      // amber header
      else {
        r = 0xff; g = 0xff; b = 0xff;                               // white page
        for (const ly of LINE_YS) {
          if (y >= ly && y < ly + LINE.h && x >= LINE.x0 && x <= LINE.x1) {
            r = 0xcb; g = 0xd5; b = 0xe1;                           // slate-300 text line
          }
        }
      }
    }
    setPx(x, y, r, g, b, 255);
  }
}

// Encode as a minimal RGBA PNG (filter type 0 per scanline, single IDAT).
const stride = S * 4 + 1;
const raw = Buffer.alloc(S * stride);
for (let y = 0; y < S; y++) {
  raw[y * stride] = 0; // filter: none
  buf.copy(raw, y * stride + 1, y * S * 4, y * S * 4 + S * 4);
}
const idat = deflateSync(raw, { level: 9 });

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);

const out = new URL("../src-tauri/icon-source.png", import.meta.url);
writeFileSync(out, png);
console.log("wrote src-tauri/icon-source.png (" + png.length + " bytes, " + S + "x" + S + ")");
