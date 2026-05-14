// Procedural icon generator. Draws an RGBA 128×128 image (rounded-square card
// + mauve→sapphire gradient ring + center spark), downsamples to 48/32/16,
// encodes each as a true transparent PNG (RGBA, alpha=0 outside the artwork).
//
// No native deps — uses only Node's built-in zlib.

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import { SRC, ICONS, ensureDir, log } from './common.mjs';

const PALETTE = {
  mauve:    [203, 166, 247, 255],
  sapphire: [116, 199, 236, 255],
  lavender: [180, 190, 254, 255],
  text:     [205, 214, 244, 255],
  base:     [30,   30,  46, 220],
  border:   [180, 190, 254, 110],
};

async function main() {
  await ensureDir(ICONS);

  const big = draw(128);
  await writePng(path.join(ICONS, 'icon-128.png'), big, 128, 128);
  for (const size of [48, 32, 16]) {
    const small = downsample(big, 128, size);
    await writePng(path.join(ICONS, `icon-${size}.png`), small, size, size);
  }
  log('icons', `wrote icon-{16,32,48,128}.png`);
}

main().catch((e) => { console.error(e); process.exit(1); });

// ───── Drawing ─────────────────────────────────────────────────────────────

function draw(size) {
  const buf = new Uint8ClampedArray(size * size * 4);   // fully transparent

  // Geometry
  const cx = size / 2;
  const cy = size / 2;
  const cardR = size * 0.46;
  const cardCornerR = size * 0.18;
  const ringOuter = size * 0.40;
  const ringInner = size * 0.30;
  const sparkR    = size * 0.10;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);

      // Rounded square card (drawn as superellipse-ish for soft corners).
      const sqDist = roundedSquareDistance(x, y, cx, cy, cardR, cardCornerR);
      if (sqDist <= 0) {
        // Glass base fill with subtle vertical gradient.
        const t = (y / size);
        const base = mix(PALETTE.base, [49, 50, 68, 220], t);
        blend(buf, x, y, size, base);

        // Subtle inner border at the card edge.
        if (sqDist > -2) {
          blend(buf, x, y, size, PALETTE.border);
        }
      }

      // Ring (radial mauve→sapphire gradient).
      if (d <= ringOuter && d >= ringInner) {
        const angle = Math.atan2(dy, dx);          // -PI..PI
        const t = (angle + Math.PI) / (2 * Math.PI);
        const col = mix(PALETTE.mauve, PALETTE.sapphire, t);
        col[3] = 255;
        blend(buf, x, y, size, col);
      }

      // Center spark (filled circle + soft halo).
      if (d <= sparkR) {
        const t = d / sparkR;
        const col = mix(PALETTE.lavender, PALETTE.sapphire, t);
        col[3] = 255;
        blend(buf, x, y, size, col);
      } else if (d <= sparkR * 1.6) {
        const t = (d - sparkR) / (sparkR * 0.6);
        const halo = [...PALETTE.mauve];
        halo[3] = Math.round(120 * (1 - t));
        blend(buf, x, y, size, halo);
      }
    }
  }

  return buf;
}

function roundedSquareDistance(x, y, cx, cy, half, cornerR) {
  // Signed distance to a rounded square centered at (cx,cy) with half-size
  // `half` and corner radius `cornerR`. <=0 inside.
  const dx = Math.abs(x - cx) - (half - cornerR);
  const dy = Math.abs(y - cy) - (half - cornerR);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  const inside = Math.min(Math.max(dx, dy), 0);
  return Math.sqrt(outsideX * outsideX + outsideY * outsideY) + inside - cornerR;
}

function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

function blend(buf, x, y, size, col) {
  const idx = (y * size + x) * 4;
  const srcA = col[3] / 255;
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  buf[idx + 0] = Math.round((col[0] * srcA + buf[idx + 0] * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round((col[1] * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
  buf[idx + 2] = Math.round((col[2] * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function downsample(src, srcSize, dstSize) {
  const dst = new Uint8ClampedArray(dstSize * dstSize * 4);
  const scale = srcSize / dstSize;
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      // Box filter — average all source pixels covered by this dst pixel.
      const x0 = Math.floor(x * scale);
      const y0 = Math.floor(y * scale);
      const x1 = Math.min(srcSize, Math.floor((x + 1) * scale));
      const y1 = Math.min(srcSize, Math.floor((y + 1) * scale));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcSize + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const idx = (y * dstSize + x) * 4;
      dst[idx]     = Math.round(r / n);
      dst[idx + 1] = Math.round(g / n);
      dst[idx + 2] = Math.round(b / n);
      dst[idx + 3] = Math.round(a / n);
    }
  }
  return dst;
}

// ───── PNG encoder (RGBA, no filter, zlib-compressed IDAT) ─────────────────

async function writePng(filepath, pixels, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;        // bit depth
  ihdr[9]  = 6;        // color type RGBA
  ihdr[10] = 0;        // compression
  ihdr[11] = 0;        // filter
  ihdr[12] = 0;        // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT — prepend a filter byte (0 = None) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  await fs.writeFile(filepath, Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]));
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
