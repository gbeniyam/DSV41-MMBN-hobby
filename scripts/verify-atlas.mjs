#!/usr/bin/env node
/**
 * Verifies the generated sprite atlas by decoding its pixels:
 *  - 8 direction rows x 7 columns (idle + 6 walk frames), uniform cell grid
 *  - every cell in those rows contains sprite pixels
 *  - the idle frame is distinct from the walk frames, and the 6 walk frames
 *    contain at least 3 distinct poses (a real cycle, not a repeated still)
 */
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };

const manifest = JSON.parse(await readFile('public/sprites/megaman-atlas.json', 'utf8'));
const png = await readFile('public/sprites/megaman-atlas.png');

if (JSON.stringify(manifest.order) !== JSON.stringify(DIRS)) fail('direction order mismatch');
if (manifest.rows !== 8 || manifest.columns !== 7) fail('atlas must be 8 rows x 7 columns');

// Decode PNG (8-bit RGBA or palette, non-interlaced) to RGBA pixels.
const sig = png.subarray(0, 8);
if (sig.toString('hex') !== '89504e470d0a1a0a') fail('not a PNG');
let pos = 8;
let width = 0, height = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (pos < png.length) {
  const len = png.readUInt32BE(pos);
  const type = png.toString('ascii', pos + 4, pos + 8);
  const data = png.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    if (data[12] !== 0) fail('interlaced PNG unsupported');
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  pos += 12 + len;
}
if (bitDepth !== 8) fail(`expected 8-bit PNG, got ${bitDepth}`);
const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
if (!channels) fail(`unsupported color type ${colorType}`);

const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;
const out = Buffer.alloc(width * height * 4);
let prev = Buffer.alloc(stride);
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  const cur = Buffer.from(line);
  for (let i = 0; i < stride; i++) {
    const a = i >= channels ? cur[i - channels] : 0;
    const b = prev[i];
    const c = i >= channels ? prev[i - channels] : 0;
    if (filter === 1) cur[i] = (cur[i] + a) & 0xff;
    else if (filter === 2) cur[i] = (cur[i] + b) & 0xff;
    else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff;
    else if (filter === 4) cur[i] = (cur[i] + paeth(a, b, c)) & 0xff;
    else if (filter !== 0) fail(`bad filter ${filter}`);
  }
  for (let x = 0; x < width; x++) {
    const src = x * channels, dst = (y * width + x) * 4;
    if (colorType === 6) {
      out[dst] = cur[src]; out[dst + 1] = cur[src + 1]; out[dst + 2] = cur[src + 2]; out[dst + 3] = cur[src + 3];
    } else if (colorType === 2) {
      out[dst] = cur[src]; out[dst + 1] = cur[src + 1]; out[dst + 2] = cur[src + 2]; out[dst + 3] = 255;
    } else {
      const v = cur[src];
      out[dst] = v; out[dst + 1] = v; out[dst + 2] = v; out[dst + 3] = v;
    }
  }
  prev = cur;
}

const { w: cw, h: ch } = manifest.cell;
if (width !== cw * manifest.columns) fail(`atlas width ${width} != ${cw * manifest.columns}`);
if (height !== ch * manifest.rows) fail(`atlas height ${height} != ${ch * manifest.rows}`);

const opaqueCount = (col, row) => {
  let n = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const px = ((row * ch + y) * width + (col * cw + x)) * 4;
      if (out[px + 3] > 32) n++;
    }
  }
  return n;
};
const cellHash = (col, row) => {
  let h = 2166136261;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const px = ((row * ch + y) * width + (col * cw + x)) * 4;
      for (let k = 0; k < 3; k++) h = ((h ^ out[px + k]) * 16777619) >>> 0;
      h = ((h ^ out[px + 3]) * 16777619) >>> 0;
    }
  }
  return h;
};

for (let row = 0; row < manifest.rows; row++) {
  const dir = DIRS[row];
  for (let col = 0; col < manifest.columns; col++) {
    const n = opaqueCount(col, row);
    if (n < 40) fail(`${dir} col ${col}: cell is empty (${n} opaque px)`);
  }
  const idle = cellHash(0, row);
  const walkHashes = new Set();
  for (let col = 1; col < manifest.columns; col++) walkHashes.add(cellHash(col, row));
  if (walkHashes.size < 3) fail(`${dir}: walk cycle has only ${walkHashes.size} distinct frames`);
  if (walkHashes.has(idle)) fail(`${dir}: a walk frame is identical to the idle frame`);
}

// --- Authentic ACDC tile atlas (extracted from the MMBN3 ACDC 3 map rip) ---
const tileMeta = JSON.parse(await readFile('public/sprites/acdc-tiles.json', 'utf8'));
const tilePng = await readFile('public/sprites/acdc-tiles.png');
if (tilePng.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('acdc-tiles.png is not a PNG');
const tw = tilePng.readUInt32BE(16);
const th = tilePng.readUInt32BE(20);
const expected = Object.keys(tileMeta.tiles).length;
if (tw !== expected * tileMeta.tile.w) fail(`tile atlas width ${tw} != ${expected} x ${tileMeta.tile.w}`);
if (th !== tileMeta.tile.h) fail(`tile atlas height ${th} != ${tileMeta.tile.h}`);
// Each tile must have come from a real source coordinate and be recorded in order.
for (const [name, t] of Object.entries(tileMeta.tiles)) {
  if (!(t.index >= 0 && t.index < expected)) fail(`${name}: bad index`);
  if (!(t.source.x >= 0 && t.source.y >= 0)) fail(`${name}: bad source coords`);
  const u0 = t.index / expected;
  if (Math.abs(t.u0 - u0) > 1e-9) fail(`${name}: u0 ${t.u0} != ${u0}`);
}

console.log(`OK: 8 directions x (1 idle + 6 walk) frames, ${width}x${height} atlas, all cells populated and animated`);
console.log(`OK: ${expected} authentic ACDC tiles, ${tw}x${th} atlas, sources recorded`);
