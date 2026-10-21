import * as THREE from 'three';
import { createIsoCamera, FRUSTUM_HEIGHT } from './camera';
import { Input } from './input';
import { Player } from './player';
import { SpriteAtlas, type AtlasManifest } from './sprites';
import {
  BUILTIN_AREAS,
  buildWorld,
  validateWorld,
  gridToWorld,
  surfaceHeightAt,
  type WorldData,
} from './world';
import type { AreaDef } from './area';
import { mountEditor } from './editor';

/**
 * Converts normalized device coords to a grid cell by raycasting the camera onto the
 * y=0 plane, then rounding to the nearest cell centre. Used by the editor to paint.
 */
function ndcToCell(
  ndcX: number,
  ndcY: number,
  cam: THREE.Camera,
  area: AreaDef,
): { gx: number; gz: number } | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
  const hit = new THREE.Vector3();
  const ok = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
  if (!ok) return null;
  const rows = area.tiles;
  const cx = (rows[0]!.length - 1) / 2;
  const cz = (rows.length - 1) / 2;
  const gx = Math.round(hit.x / 2 + cx);
  const gz = Math.round(hit.z / 2 + cz);
  if (gz < 0 || gz >= rows.length || gx < 0 || gx >= rows[0]!.length) return null;
  return { gx, gz };
}
import './style.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x04060e, 1);
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x04060e, 46, 90);

const camera = createIsoCamera(window.innerWidth / window.innerHeight);
scene.add(new THREE.AmbientLight(0x8fb6ff, 1.35));
const keyLight = new THREE.DirectionalLight(0xcfe6ff, 1.9);
keyLight.position.set(12, 26, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x1c98d0, 0.9);
rimLight.position.set(-14, 10, -12);
scene.add(rimLight);

const manifest = (await fetch(`${import.meta.env.BASE_URL}sprites/megaman-atlas.json`).then((r) =>
  r.json(),
)) as AtlasManifest;
const atlas = new SpriteAtlas(renderer, manifest);
const player = new Player(manifest, atlas.texture);
scene.add(player.group);

const input = new Input();
input.attach(window);

// --- Area state ------------------------------------------------------------
const areas = new Map<string, AreaDef>(BUILTIN_AREAS.map((a) => [a.id, a]));
let activeId = 'acdc-square';
let world: WorldData;
/** Seconds before another portal may fire; prevents arrival loops. */
let travelCooldown = 0;
const AREA_STORAGE_KEY = 'mmbn.areas.v1';

interface SavedAreas {
  version: 1;
  areas: AreaDef[];
  activeId: string;
}

function loadSaved(): void {
  try {
    const raw = localStorage.getItem(AREA_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as SavedAreas;
    if (saved.version !== 1 || !Array.isArray(saved.areas)) return;
    for (const a of saved.areas) areas.set(a.id, a);
    if (saved.activeId && areas.has(saved.activeId)) activeId = saved.activeId;
  } catch {
    // Corrupt or unavailable storage must never block the game from starting.
  }
}

function persist(): void {
  try {
    const payload: SavedAreas = { version: 1, areas: [...areas.values()], activeId };
    localStorage.setItem(AREA_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private-mode failures are non-fatal.
  }
}

function disposeWorld(w: WorldData): void {
  scene.remove(w.group);
  w.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

function loadArea(id: string): void {
  const area = areas.get(id);
  if (!area) return;
  if (world) disposeWorld(world);
  world = buildWorld(scene, renderer, area);
  activeId = id;
  player.spawnAt(world);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  persist();
  refreshEditor();
}

/**
 * Teleports to another area, placing the player on the portal's destination cell.
 * The cooldown is set here (not only in the frame loop) so a direct jump onto a pad
 * cannot immediately re-trigger the portal you arrived on.
 */
function travelTo(areaId: string, gx: number, gz: number): void {
  const area = areas.get(areaId);
  if (!area) return;
  disposeWorld(world);
  world = buildWorld(scene, renderer, area);
  activeId = areaId;
  const p = gridToWorld(area, gx, gz);
  player.state.x = p.x;
  player.state.z = p.z;
  player.state.dir = 'S';
  const ground = surfaceHeightAt(world, p.x, p.z);
  player.state.y = ground ?? 0;
  player.group.position.set(p.x, player.state.y, p.z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  travelCooldown = 0.8;
  persist();
  refreshEditor();
}

// --- Editor integration ----------------------------------------------------
let refreshEditor: () => void = () => {};

const uiRoot = document.createElement('div');
uiRoot.id = 'editor-root';
document.body.appendChild(uiRoot);

mountEditor({
  container: uiRoot,
  getAreas: () => [...areas.values()],
  getActiveId: () => activeId,
  onSelectArea: (id) => {
    loadArea(id);
  },
  onAreasChanged: (next) => {
    const problems = validateWorld(next);
    if (problems.length > 0) {
      console.error('world validation failed:\n  ' + problems.join('\n  '));
    }
    areas.clear();
    for (const a of next) areas.set(a.id, a);
    loadArea(activeId);
  },
  onJump: (areaId, gx, gz) => travelTo(areaId, gx, gz),
  pickTile: (ndcX, ndcY) => ndcToCell(ndcX, ndcY, camera, areas.get(activeId)!),
  registerRefresh: (fn) => {
    refreshEditor = fn;
  },
});

// --- Debug / test surface --------------------------------------------------
interface DebugApi {
  state: typeof player.state;
  setInput: (x: number, y: number) => void;
  tile: number;
  ready: boolean;
  onPlatform: () => boolean;
  blockers: () => Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  walkableAt: (x: number, z: number) => boolean;
  landmarks: { plazas: Array<{ x: number; z: number }>; entrance: { x: number; z: number } };
  sampleColors: () => number;
  areaId: () => string;
  areaIds: () => string[];
  portals: () => Array<{ x: number; z: number; to: { area: string; gx: number; gz: number } }>;
  travelTo: (areaId: string, gx: number, gz: number) => void;
  /** Screen NDC -> grid cell, for canvas painting and tests. */
  pickTile: (ndcX: number, ndcY: number) => { gx: number; gz: number } | null;
  /** Cross-area portal validation, so tests assert the real invariant. */
  validateWorld: () => string[];
  /** Same validator over an arbitrary area set, so tests can prove it rejects bad data. */
  validateWorldFor: (areas: AreaDef[]) => string[];
  /** Editor hooks, exercised by the tests. */
  editor: {
    getArea: () => AreaDef;
    setTile: (gx: number, gz: number, t: string) => void;
    listAreas: () => string[];
    selectArea: (id: string) => void;
  };
}
const debug: DebugApi = {
  state: player.state,
  setInput: (x, y) => input.set(x, y),
  tile: 2,
  ready: false,
  onPlatform: () => surfaceHeightAt(world, player.state.x, player.state.z) !== null,
  blockers: () => world.blockers.map((b) => ({ minX: b.min.x, maxX: b.max.x, minZ: b.min.y, maxZ: b.max.y })),
  walkableAt: (x, z) => !player.blocked(world, x, z),
  get landmarks() {
    // Derived from the active area so tests follow the map, not a stale constant.
    const area = areas.get(activeId)!;
    return {
      plazas: area.landmarks.plazas.map(([gx, gz]) => gridToWorld(area, gx, gz)),
      entrance: gridToWorld(area, area.landmarks.entrance[0], area.landmarks.entrance[1]),
    };
  },
  sampleColors: () => {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = 96;
    const h = 96;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(
      Math.max(0, Math.floor(renderer.domElement.width / 2 - w / 2)),
      Math.max(0, Math.floor(renderer.domElement.height / 2 - h / 2)),
      w,
      h,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    );
    const seen = new Set<number>();
    for (let i = 0; i < px.length; i += 4) {
      seen.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    }
    return seen.size;
  },
  areaId: () => activeId,
  areaIds: () => [...areas.keys()],
  portals: () => world.portals.map((p) => ({ x: p.x, z: p.z, to: p.to })),
  travelTo,
  pickTile: (ndcX, ndcY) => ndcToCell(ndcX, ndcY, camera, areas.get(activeId)!),
  validateWorld: () => validateWorld([...areas.values()]),
  validateWorldFor: (list) => validateWorld(list),
  editor: {
    getArea: () => areas.get(activeId)!,
    setTile: (gx, gz, t) => {
      const area = areas.get(activeId)!;
      const rows = [...area.tiles];
      const row = rows[gz];
      if (!row || gx < 0 || gx >= row.length) return;
      rows[gz] = row.slice(0, gx) + t + row.slice(gx + 1);
      areas.set(activeId, { ...area, tiles: rows });
      loadArea(activeId);
    },
    listAreas: () => [...areas.keys()],
    selectArea: (id) => loadArea(id),
  },
};
declare global {
  interface Window {
    /** Test/debug handle; the Playwright harness drives the game through this. */
    game: DebugApi;
  }
}
window.game = debug;

// --- Boot ------------------------------------------------------------------
loadSaved();
const bootProblems = validateWorld([...areas.values()]);
if (bootProblems.length > 0) {
  console.error('world validation failed:\n  ' + bootProblems.join('\n  '));
}
loadArea(activeId);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  player.update(dt, input.state.x, input.state.y, world);
  player.faceCamera(camera);

  // Entering a portal pad warps to its destination. The cooldown stops the player
  // from immediately re-entering the pad they arrive on.
  travelCooldown = Math.max(0, travelCooldown - dt);
  if (travelCooldown === 0) {
    const portal = player.portalAt(world);
    if (portal) {
      travelTo(portal.to.area, portal.to.gx, portal.to.gz);
      travelCooldown = 0.8;
    }
  }
  renderer.render(scene, camera);
  debug.ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = (-FRUSTUM_HEIGHT * aspect) / 2;
  camera.right = (FRUSTUM_HEIGHT * aspect) / 2;
  camera.top = FRUSTUM_HEIGHT / 2;
  camera.bottom = -FRUSTUM_HEIGHT / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
