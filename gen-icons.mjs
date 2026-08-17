// Generates PNG icons (tier-stripe mark) without external deps.
import { writeFileSync } from "node:fs";
import zlib from "node:zlib";
const CRC_T = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = ~0; for (const x of b) c = CRC_T[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const stripes = [[0xfb, 0x71, 0x85], [0x34, 0xd3, 0x99], [0x38, 0xbd, 0xf8], [0xfb, 0xbf, 0x24]];
  const pad = Math.round(size * 0.16), gap = Math.round(size * 0.03);
  const bandH = Math.floor((size - 2 * pad - 3 * gap) / 4);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1); px[row] = 0;
    let band = -1;
    for (let b = 0; b < 4; b++) { const top = pad + b * (bandH + gap); if (y >= top && y < top + bandH) band = b; }
    for (let x = 0; x < size; x++) {
      const o = row + 1 + x * 4;
      let [r, g, bl, a] = [2, 6, 23, 255]; // slate-950
      const inX = x >= pad && x < size - pad && !(band === 3 && x >= size - pad - Math.round(size * 0.14));
      if (band >= 0 && inX) [r, g, bl] = stripes[band];
      px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(px)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
writeFileSync("public/icons/icon-192.png", png(192));
writeFileSync("public/icons/icon-512.png", png(512));
console.log("icons ok");
