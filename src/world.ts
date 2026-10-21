import * as THREE from 'three';
import { PAL } from './palette';
import { loadAcdaTileAtlas, voidTexture } from './textures';
import {
  addProp,
  addPortal,
  blankArea,
  type AreaDef,
  type PortalDef,
  type PropType,
  type Tile,
  TILE_HEIGHT,
  isWalkable,
  setTile,
  validateArea,
} from './area';

export const TILE = 2;

export interface Cell {
  gx: number;
  gz: number;
  height: number;
  kind: 'void' | 'walk' | 'plaza';
}

export interface WorldData {
  group: THREE.Group;
  cells: Map<string, Cell>;
  /** Solid colliders in world XZ for things you walk around. */
  blockers: THREE.Box2[];
  portals: Array<PortalDef & { x: number; z: number }>;
  area: AreaDef;
}

// ---------------------------------------------------------------------------
// Built-in areas
// ---------------------------------------------------------------------------

/** ACDC Square tiles: three plazas in a triangle, entrance arm at the top. */
const ACDC_SQUARE_TILES = [
  '........###........',
  '........#@#........',
  '........@@@........',
  '.......@@@@@.......',
  '......@@@@@@@......',
  '.......@@@@@.......',
  '......#.@@@.#......',
  '......#.#@#.#......',
  '......#.@@@.#......',
  '......#@@@@@#......',
  '.....##.@@@.##.....',
  '....@##..@..##@....',
  '...@@@.......@@@...',
  '..@@@@@##.##@@@@@..',
  '.@@@@@@@...@@@@@@@.',
  '..@@@@@#####@@@@@..',
  '...@@@.......@@@...',
  '....@.........@....',
  '...................',
];

/** ACDC 1: a north-south corridor with a west plaza room and an east alcove. */
const ACDC_1_TILES = [
  '......###......',
  '......###......',
  '......###......',
  '......###......',
  '..#######......',
  '..#@@@###......',
  '..#@@@###......',
  '..#@@@###......',
  '..#######......',
  '......######...',
  '......######...',
  '......###......',
  '......###......',
];

/** Undernet: a dark ring around a central island, joined by four bridges. */
const UNDERNET_TILES = [
  '.................',
  '..#############..',
  '..#.....#.....#..',
  '..#..@@@#@@@..#..',
  '..#..@@@@@@@..#..',
  '..####@@@@@####..',
  '..#..@@@@@@@..#..',
  '..#..@@@#@@@..#..',
  '..#.....#.....#..',
  '..#############..',
  '.................',
];

function squareArea(): AreaDef {
  let a: AreaDef = {
    id: 'acdc-square',
    name: 'ACDC Square',
    note: 'Three plazas in a triangle; entrance at the top.',
    tiles: ACDC_SQUARE_TILES,
    props: [],
    portals: [],
    landmarks: { plazas: [[9, 4], [4, 14], [14, 14]], entrance: [9, 0] },
  };
  // BBS terminals in the lower-left plaza, nav post beside the north entrance.
  a = addProp(a, 'bbs', 3, 13);
  a = addProp(a, 'bbs', 5, 13);
  a = addProp(a, 'pylon', 8, 4);
  a = addProp(a, 'mystery', 15, 14);
  // Portal home: the entrance arm leads back out to ACDC 1.
  a = addPortal(a, { gx: 9, gz: 1, to: { area: 'acdc-1', gx: 7, gz: 9 }, label: 'Exit to ACDC 1' });
  // South plaza holds the warp to the Undernet.
  a = addPortal(a, { gx: 9, gz: 15, to: { area: 'undernet', gx: 8, gz: 1 }, label: 'Warp: Undernet' });
  return a;
}

function acdc1Area(): AreaDef {
  let a: AreaDef = {
    id: 'acdc-1',
    name: 'ACDC 1',
    note: 'Corridor linking ACDC 2 and the Square.',
    tiles: ACDC_1_TILES,
    props: [],
    portals: [],
    landmarks: { plazas: [[4, 6]], entrance: [7, 0] },
  };
  a = addProp(a, 'pylon', 2, 4);
  a = addProp(a, 'mystery', 10, 9);
  a = addPortal(a, { gx: 7, gz: 12, to: { area: 'acdc-square', gx: 9, gz: 2 }, label: 'To ACDC Square' });
  return a;
}

function undernetArea(): AreaDef {
  let a: AreaDef = {
    id: 'undernet',
    name: 'Undernet',
    note: 'Dark ring around a central island.',
    tiles: UNDERNET_TILES,
    props: [],
    portals: [],
    landmarks: { plazas: [[8, 5]], entrance: [8, 1] },
  };
  a = addProp(a, 'mystery', 8, 4);
  a = addProp(a, 'bbs', 6, 5);
  // Return pad sits on the north bridge; arrivals land on the ring above it.
  a = addPortal(a, { gx: 8, gz: 2, to: { area: 'acdc-square', gx: 8, gz: 15 }, label: 'Back to ACDC Square' });
  return a;
}

export const BUILTIN_AREAS: AreaDef[] = [squareArea(), acdc1Area(), undernetArea()];

// ---------------------------------------------------------------------------
// World building
// ---------------------------------------------------------------------------

const CENTER = (rows: string[]) => ({
  x: (rows[0]!.length - 1) / 2,
  z: (rows.length - 1) / 2,
});

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer, area: AreaDef): WorldData {
  const problems = validateArea(area);
  if (problems.length > 0) {
    throw new Error(`invalid area "${area.id}":\n  ${problems.join('\n  ')}`);
  }

  const group = new THREE.Group();
  scene.add(group);

  const tileAtlas = loadAcdaTileAtlas(renderer);
  const cells = new Map<string, Cell>();
  const blockers: THREE.Box2[] = [];
  const portals: Array<PortalDef & { x: number; z: number }> = [];
  const { x: cx, z: cz } = CENTER(area.tiles);

  const toWorld = (gx: number, gz: number) => ({ x: (gx - cx) * TILE, z: (gz - cz) * TILE });

  const half = TILE / 2;
  const bodyGeo = new THREE.BoxGeometry(TILE * 0.96, 1, TILE * 0.96);
  const skirtGeo = new THREE.BoxGeometry(TILE * 0.9, 0.3, TILE * 0.9);
  const skirtMat = new THREE.MeshLambertMaterial({ color: PAL.panel });

  // Tiles 0 = mint floor, 1 = pale plaza, 2 = grey frame.
  const deckMat = new Map<string, THREE.MeshLambertMaterial>();
  const deckFor = (kind: Tile): THREE.MeshLambertMaterial => {
    let m = deckMat.get(kind);
    if (m) return m;
    const tileIndex = kind === '@' ? 1 : 0;
    const tint = kind === '@' ? 0xffffff : 0xc8d8ea;
    const tex = tileAtlas.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1 / 4, 1);
    tex.offset.set(tileIndex / 4, 0);
    m = new THREE.MeshLambertMaterial({ color: tint, map: tex });
    deckMat.set(kind, m);
    return m;
  };

  const edgeMat = new Map<Tile, THREE.MeshBasicMaterial>();
  const edgeFor = (kind: Tile): THREE.MeshBasicMaterial => {
    let m = edgeMat.get(kind);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({ color: kind === '@' ? PAL.neon : PAL.gridLine });
    edgeMat.set(kind, m);
    return m;
  };

  const edgeLong = new THREE.BoxGeometry(TILE * 0.96, 0.05, 0.09);
  const edgeShort = new THREE.BoxGeometry(0.09, 0.05, TILE * 0.96);

  const rows = area.tiles;
  const width = rows[0]!.length;
  const heightAt = (gx: number, gz: number): number => {
    if (gz < 0 || gz >= rows.length || gx < 0 || gx >= width) return 0;
    return TILE_HEIGHT[rows[gz]![gx] as Tile];
  };

  for (let gz = 0; gz < rows.length; gz++) {
    const row = rows[gz]!;
    for (let gx = 0; gx < row.length; gx++) {
      const kind = row[gx] as Tile;
      const { x, z } = toWorld(gx, gz);
      const h = TILE_HEIGHT[kind];
      cells.set(`${gx},${gz}`, {
        gx,
        gz,
        height: h,
        kind: kind === '.' ? 'void' : kind === '@' ? 'plaza' : 'walk',
      });
      if (!isWalkable(kind)) continue;

      const deck = new THREE.Mesh(bodyGeo, deckFor(kind));
      deck.position.set(x, h - 0.5, z);
      deck.matrixAutoUpdate = false;
      deck.updateMatrix();
      group.add(deck);

      const skirtH = 0.55;
      const skirt = new THREE.Mesh(skirtGeo, skirtMat);
      skirt.position.set(x, h - 0.5 - skirtH / 2, z);
      skirt.scale.y = skirtH / 0.3;
      skirt.matrixAutoUpdate = false;
      skirt.updateMatrix();
      group.add(skirt);

      const edge = edgeFor(kind);
      const below = (nx: number, nz: number) => heightAt(nx, nz) < h;
      const strips: Array<[THREE.BufferGeometry, number, number]> = [];
      if (below(gx, gz - 1)) strips.push([edgeLong, 0, -half]);
      if (below(gx, gz + 1)) strips.push([edgeLong, 0, half]);
      if (below(gx - 1, gz)) strips.push([edgeShort, -half, 0]);
      if (below(gx + 1, gz)) strips.push([edgeShort, half, 0]);
      for (const [geo, ox, oz] of strips) {
        const strip = new THREE.Mesh(geo, edge);
        strip.position.set(x + ox, h + 0.01, z + oz);
        strip.matrixAutoUpdate = false;
        strip.updateMatrix();
        group.add(strip);
      }
    }
  }

  const voidPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(640, 640),
    new THREE.MeshBasicMaterial({ map: voidTexture() }),
  );
  voidPlate.rotation.x = -Math.PI / 2;
  voidPlate.position.y = -3.2;
  group.add(voidPlate);

  // --- Props -------------------------------------------------------------
  const propMats = {
    bbs: new THREE.MeshLambertMaterial({ color: 0x2bd6a0, emissive: 0x2bd6a0, emissiveIntensity: 0.45 }),
    mystery: new THREE.MeshLambertMaterial({ color: 0xf8f850, emissive: 0xf8f850, emissiveIntensity: 0.5 }),
    pylon: new THREE.MeshLambertMaterial({ color: PAL.trim, emissive: PAL.trim, emissiveIntensity: 0.4 }),
    avatar: new THREE.MeshLambertMaterial({ color: 0xd860b0, emissive: 0xd860b0, emissiveIntensity: 0.5 }),
  };
  const capMat = new THREE.MeshBasicMaterial({ color: PAL.neon });

  for (const prop of area.props) {
    const { x, z } = toWorld(prop.gx, prop.gz);
    const base = TILE_HEIGHT[rows[prop.gz]![prop.gx] as Tile];
    const mat = propMats[prop.type];
    const dims: Record<PropType, [number, number, number]> = {
      bbs: [1.2, 2.2, 1.2],
      mystery: [0.9, 0.9, 0.9],
      pylon: [1.15, 2.8, 1.15],
      avatar: [1, 1.6, 1],
    };
    const [w, hh, d] = dims[prop.type];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
    mesh.position.set(x, base + hh / 2, z);
    group.add(mesh);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.35, 0.16, d + 0.35), capMat);
    cap.position.set(x, base + hh + 0.08, z);
    group.add(cap);

    if (prop.type !== 'mystery') {
      const glow = new THREE.PointLight(mat.color, 4, 10, 2);
      glow.position.set(x, base + hh * 0.8, z);
      group.add(glow);
    }

    const solid = prop.type === 'mystery' ? 0.45 : 0.85;
    blockers.push(new THREE.Box2(
      new THREE.Vector2(x - solid, z - solid),
      new THREE.Vector2(x + solid, z + solid),
    ));
  }

  // --- Portals -----------------------------------------------------------
  const padGeo = new THREE.TorusGeometry(0.72, 0.1, 8, 24);
  const padMat = new THREE.MeshBasicMaterial({ color: PAL.crystal });
  const innerMat = new THREE.MeshBasicMaterial({
    color: PAL.crystal,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  for (const portal of area.portals) {
    const { x, z } = toWorld(portal.gx, portal.gz);
    const base = TILE_HEIGHT[rows[portal.gz]![portal.gx] as Tile];

    const ring = new THREE.Mesh(padGeo, padMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, base + 0.06, z);
    group.add(ring);

    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.66, 24), innerMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, base + 0.04, z);
    group.add(disc);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.66, 2.2, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: PAL.crystal,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.set(x, base + 1.1, z);
    group.add(beam);

    const light = new THREE.PointLight(PAL.crystal, 6, 9, 2);
    light.position.set(x, base + 1.2, z);
    group.add(light);

    portals.push({ ...portal, x, z });
  }

  return { group, cells, blockers, portals, area };
}

/**
 * Walkable height at a world position, or null over the void.
 *
 * Deck tiles are axis-aligned TILE-sized squares that tile the plane exactly, so the
 * containing cell is simply the nearest cell centre. (An extra "within 0.47*TILE of the
 * centre" guard leaves 0.06-unit dead bands between cells, which would make the player
 * stick at every boundary.)
 */
export function surfaceHeightAt(world: WorldData, x: number, z: number): number | null {
  const { x: cx, z: cz } = CENTER(world.area.tiles);
  const gx = Math.round(x / TILE + cx);
  const gz = Math.round(z / TILE + cz);
  const cell = world.cells.get(`${gx},${gz}`);
  if (!cell || cell.kind === 'void') return null;
  return cell.height;
}

export function worldFromArea(area: AreaDef): { x: number; z: number } {
  const { x: cx, z: cz } = CENTER(area.tiles);
  const [gx, gz] = area.landmarks.entrance;
  return { x: (gx - cx) * TILE, z: (gz - cz) * TILE };
}

export function gridToWorld(area: AreaDef, gx: number, gz: number): { x: number; z: number } {
  const { x: cx, z: cz } = CENTER(area.tiles);
  return { x: (gx - cx) * TILE, z: (gz - cz) * TILE };
}

/**
 * Validates portals across the whole world. A per-area check cannot see whether a
 * destination exists in another area, or whether it lands on the void, so this runs
 * once over all areas after any edit or load.
 */
export function validateWorld(areas: AreaDef[]): string[] {
  const problems: string[] = [];
  const byId = new Map(areas.map((a) => [a.id, a]));

  for (const area of areas) {
    for (const portal of area.portals) {
      const dest = byId.get(portal.to.area);
      const where = `${area.id} portal at ${portal.gx},${portal.gz}`;
      if (!dest) {
        problems.push(`${where}: unknown destination area "${portal.to.area}"`);
        continue;
      }
      const { gx, gz } = portal.to;
      const row = dest.tiles[gz];
      if (row === undefined || gx < 0 || gx >= row.length) {
        problems.push(`${where}: destination ${gx},${gz} is outside ${dest.id}`);
        continue;
      }
      if (!isWalkable(row[gx] as Tile)) {
        problems.push(`${where}: destination ${gx},${gz} in ${dest.id} is void`);
        continue;
      }
      // Landing on another portal would warp the player again on arrival.
      const stacked = dest.portals.find((q) => q.gx === gx && q.gz === gz);
      if (stacked) {
        problems.push(`${where}: destination ${gx},${gz} in ${dest.id} lands on another portal`);
      }
    }
  }
  return problems;
}

/** Named editor helpers re-exported so the UI has one import surface. */
export { addProp, addPortal, blankArea, setTile, validateArea, type AreaDef, type PortalDef };
