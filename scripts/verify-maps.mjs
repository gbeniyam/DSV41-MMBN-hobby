// Independent static verification of every built-in area: connectivity, prop
// placement, portal destinations, and landmark occlusion.
import { readFileSync } from 'node:fs';
const src = readFileSync('src/world.ts', 'utf8');
const grab = (n) => {
  const m = src.match(new RegExp(`${n} = \\[([\\s\\S]*?)\\];`));
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const maps = {
  'acdc-square': grab('ACDC_SQUARE_TILES'),
  'acdc-1': grab('ACDC_1_TILES'),
  undernet: grab('UNDERNET_TILES'),
};
const props = { 'acdc-square': [[3,13],[5,13],[8,4],[15,14]], 'acdc-1': [[2,4],[10,9]], undernet: [[8,4],[6,5]] };
const portals = { 'acdc-square': [[9,1],[9,15]], 'acdc-1': [[7,12]], undernet: [[8,2]] };
const landmarks = { 'acdc-square': [[9,4],[4,14],[14,14],[9,0]], 'acdc-1': [[4,6],[7,0]], undernet: [[8,5],[8,1]] };

let allOk = true;
for (const [id, rows] of Object.entries(maps)) {
  const W = rows[0].length, H = rows.length;
  const walk = (x, z) => z >= 0 && z < H && x >= 0 && x < W && rows[z][x] !== '.';
  const errs = [];
  rows.forEach((r, i) => { if (r.length !== W) errs.push(`row ${i} ragged`); });
  for (const [x, z] of props[id]) if (!walk(x, z)) errs.push(`prop ${x},${z} not on floor`);
  for (const [x, z] of portals[id]) if (!walk(x, z)) errs.push(`portal ${x},${z} not on floor`);
  for (const [x, z] of landmarks[id]) {
    if (!walk(x, z)) errs.push(`landmark ${x},${z} not on floor`);
    if (props[id].some(([px, pz]) => px === x && pz === z)) errs.push(`landmark ${x},${z} covered by prop`);
  }
  // BFS from entrance
  const [sx, sz] = landmarks[id][landmarks[id].length - 1];
  const seen = new Set([`${sx},${sz}`]); const st = [[sx, sz]];
  while (st.length) {
    const [x, z] = st.pop();
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, nz = z + dz, k = `${nx},${nz}`;
      if (!walk(nx, nz) || seen.has(k)) continue;
      seen.add(k); st.push([nx, nz]);
    }
  }
  let tot = 0;
  for (const r of rows) for (const c of r) if (c !== '.') tot++;
  const ok = seen.size === tot;
  if (!ok) errs.push(`connectivity ${seen.size}/${tot}`);
  console.log(`${id.padEnd(12)} ${W}x${H} walkable=${tot} reached=${seen.size} ${ok ? 'CONNECTED' : 'DISCONNECTED'} ${errs.length ? '| ' + errs.join('; ') : ''}`);
  if (errs.length) allOk = false;
}
console.log(allOk ? '\nALL AREAS VALID' : '\nPROBLEMS FOUND');
process.exit(allOk ? 0 : 1);
