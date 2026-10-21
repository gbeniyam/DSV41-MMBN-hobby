import * as THREE from 'three';
import { PAL } from './palette';
import { loadAcdaTileAtlas, voidTexture } from './textures';

export const TILE = 2;

/**
 * ACDC Square, matching the game's documented layout (MMBN3 map guide +
 * ACDC Square description): three polygon platforms joined in a triangle, the
 * entrance arm at the top (north), the platform elevated off the void, and the
 * BBS terminals in the lower-left plaza.
 *   '.' void   '#' low walkway   '@' raised plaza
 * Rows run north -> south, columns west -> east. Verified fully connected: every
 * walkable cell is reachable from the north entrance (119/119).
 */
const MAP = [
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

const MAP_W = MAP[0]!.length;
const MAP_H = MAP.length;
/** Grid coordinate that maps to world origin. */
const CENTER_X = (MAP_W - 1) / 2;
const CENTER_Z = (MAP_H - 1) / 2;

/** Grid positions of the three plaza centres (north, south-west, south-east). */
const PLAZAS: Array<[number, number]> = [
  [9, 4],
  [4, 14],
  [14, 14],
];
/** North entrance, on the arm at the top of the square. */
const ENTRANCE: [number, number] = [9, 0];
/** Central hub where the three plazas meet. */
const HUB: [number, number] = [9, 9];

const HEIGHTS: Record<number, number> = { 0: 0, 1: 0.5, 2: 1.1 };

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
}

function parseMap(): number[][] {
  return MAP.map((row) => [...row].map((ch) => (ch === '@' ? 2 : ch === '#' ? 1 : 0)));
}

export function gridToWorld(gx: number, gz: number): { x: number; z: number } {
  return { x: (gx - CENTER_X) * TILE, z: (gz - CENTER_Z) * TILE };
}

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer): WorldData {
  const group = new THREE.Group();
  scene.add(group);

  const tileAtlas = loadAcdaTileAtlas(renderer);
  const cells = new Map<string, Cell>();
  const blockers: THREE.Box2[] = [];
  const layout = parseMap();

  const half = TILE / 2;
  const bodyGeo = new THREE.BoxGeometry(TILE * 0.96, 1, TILE * 0.96);
  const podiumGeo = new THREE.BoxGeometry(TILE * 0.9, 0.3, TILE * 0.9); // unit is 0.3 tall; scaled per skirt
  const podiumMat = new THREE.MeshLambertMaterial({ color: PAL.panel });

  // Each surface kind maps onto one cell of the authentic 4-tile ACDC atlas.
  // Tiles are 32x16, i.e. exactly one isometric diamond, so one tile covers one deck.
  const deckMat = new Map<number, THREE.MeshLambertMaterial>();
  const deckFor = (kind: number): THREE.MeshLambertMaterial => {
    let m = deckMat.get(kind);
    if (!m) {
      const tileIndex = kind === 2 ? 0 : 1;
      const tint = kind === 2 ? 0xffffff : 0xc8d8ea;
      // offset/repeat live on the texture, so each surface needs its own clone.
      const tex = tileAtlas.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1 / 4, 1);
      tex.offset.set(tileIndex / 4, 0);
      m = new THREE.MeshLambertMaterial({ color: tint, map: tex });
      deckMat.set(kind, m);
    }
    return m;
  };

  // Neon edge strips kept as one shared material per kind.
  const edgeMat = new Map<number, THREE.MeshBasicMaterial>();
  const edgeFor = (kind: number): THREE.MeshBasicMaterial => {
    let m = edgeMat.get(kind);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: kind === 2 ? PAL.neon : PAL.gridLine });
      edgeMat.set(kind, m);
    }
    return m;
  };

  const edgeGeoLong = new THREE.BoxGeometry(TILE * 0.96, 0.05, 0.09);
  const edgeGeoShort = new THREE.BoxGeometry(0.09, 0.05, TILE * 0.96);

  for (let gz = 0; gz < MAP_H; gz++) {
    for (let gx = 0; gx < MAP_W; gx++) {
      const kind = layout[gz]![gx]!;
      const { x, z } = gridToWorld(gx, gz);
      const cell: Cell = {
        gx,
        gz,
        height: HEIGHTS[kind]!,
        kind: kind === 0 ? 'void' : kind === 2 ? 'plaza' : 'walk',
      };
      cells.set(`${gx},${gz}`, cell);

      if (kind === 0) {
        // Open void: render nothing; the plate below reads as the cyber abyss.
        continue;
      }

      const h = cell.height;

      // Deck slab: the walkable surface.
      const deck = new THREE.Mesh(bodyGeo, deckFor(kind));
      deck.position.set(x, h - 0.5, z);
      deck.matrixAutoUpdate = false;
      deck.updateMatrix();
      group.add(deck);

      // Short skirt under each deck tile: just enough thickness to read as a slab.
      const skirtH = 0.55;
      const skirt = new THREE.Mesh(podiumGeo, podiumMat);
      skirt.position.set(x, h - 0.5 - skirtH / 2, z);
      skirt.scale.y = skirtH / 0.3;
      skirt.matrixAutoUpdate = false;
      skirt.updateMatrix();
      group.add(skirt);

      // Neon edging only where the neighbouring tile is void or lower.
      const edge = edgeFor(kind);
      const neighbourBelow = (nx: number, nz: number): boolean => {
        if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) return true;
        return HEIGHTS[layout[nz]![nx]!]! < h;
      };
      const strips: Array<[THREE.BufferGeometry, number, number]> = [];
      if (neighbourBelow(gx, gz - 1)) strips.push([edgeGeoLong, 0, -half]);
      if (neighbourBelow(gx, gz + 1)) strips.push([edgeGeoLong, 0, half]);
      if (neighbourBelow(gx - 1, gz)) strips.push([edgeGeoShort, -half, 0]);
      if (neighbourBelow(gx + 1, gz)) strips.push([edgeGeoShort, half, 0]);
      for (const [geo, ox, oz] of strips) {
        const strip = new THREE.Mesh(geo, edge);
        strip.position.set(x + ox, h + 0.01, z + oz);
        strip.matrixAutoUpdate = false;
        strip.updateMatrix();
        group.add(strip);
      }
    }
  }

  // Void plate: never shows the clear color, and frames the square.
  const voidPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(640, 640),
    new THREE.MeshBasicMaterial({ map: voidTexture() }),
  );
  voidPlate.rotation.x = -Math.PI / 2;
  voidPlate.position.y = -3.2;
  group.add(voidPlate);

  // Terminal pylons at the heart of each plaza — the BBS stations and nav posts.
  const pylonMat = new THREE.MeshLambertMaterial({
    color: PAL.trim,
    emissive: PAL.trim,
    emissiveIntensity: 0.4,
  });
  const pylonGeo = new THREE.BoxGeometry(1.15, 2.8, 1.15);
  const capGeo = new THREE.BoxGeometry(1.55, 0.2, 1.55);
  const capMat = new THREE.MeshBasicMaterial({ color: PAL.neon });
  // Two BBS terminals sit in the lower-left plaza, as in the game; the north
  // plaza carries the nav post beside the entrance.
  // Props sit off the plaza centres so each plaza centre stays walkable and the
  // three-platform topology can be traversed and tested.
  const pylonCells: Array<[number, number]> = [
    [PLAZAS[1]![0] - 1, PLAZAS[1]![1] - 1],
    [PLAZAS[1]![0] + 1, PLAZAS[1]![1] - 1],
    [PLAZAS[0]![0] - 1, PLAZAS[0]![1]],
  ];
  for (const [gx, gz] of pylonCells) {
    const { x, z } = gridToWorld(gx, gz);
    const base = HEIGHTS[2]!;
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    pylon.position.set(x, base + 1.4, z);
    group.add(pylon);

    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(x, base + 2.9, z);
    group.add(cap);

    const glow = new THREE.PointLight(PAL.neon, 5, 12, 2);
    glow.position.set(x, base + 2.2, z);
    group.add(glow);

    blockers.push(new THREE.Box2(
      new THREE.Vector2(x - 0.85, z - 0.85),
      new THREE.Vector2(x + 0.85, z + 0.85),
    ));
  }

  // Hub crystal: the square's data core.
  const hub = gridToWorld(HUB[0], HUB[1]);
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85, 0),
    new THREE.MeshLambertMaterial({
      color: PAL.crystal,
      emissive: PAL.crystal,
      emissiveIntensity: 0.7,
    }),
  );
  crystal.position.set(hub.x, HEIGHTS[2]! + 1.3, hub.z);
  crystal.scale.y = 1.6;
  group.add(crystal);

  const crystalLight = new THREE.PointLight(PAL.crystal, 9, 20, 2);
  crystalLight.position.set(hub.x, HEIGHTS[2]! + 2.4, hub.z);
  group.add(crystalLight);
  blockers.push(new THREE.Box2(
    new THREE.Vector2(hub.x - 0.8, hub.z - 0.8),
    new THREE.Vector2(hub.x + 0.8, hub.z + 0.8),
  ));

  return { group, cells, blockers };
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
  const gx = Math.round(x / TILE + CENTER_X);
  const gz = Math.round(z / TILE + CENTER_Z);
  const cell = world.cells.get(`${gx},${gz}`);
  if (!cell || cell.kind === 'void') return null;
  return cell.height;
}

/** World position of the square's entrance, on the north arm. */
export const SPAWN = gridToWorld(ENTRANCE[0], ENTRANCE[1]);

/** World positions of the three plaza centres, for tests and camera framing. */
export const PLAZA_POINTS = PLAZAS.map(([gx, gz]) => gridToWorld(gx, gz));
