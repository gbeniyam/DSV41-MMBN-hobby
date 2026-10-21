import * as THREE from 'three';
import { createIsoCamera, FRUSTUM_HEIGHT } from './camera';
import { Input } from './input';
import { Player } from './player';
import { SpriteAtlas, type AtlasManifest } from './sprites';
import { buildWorld, PLAZA_POINTS, SPAWN as SPAWN_POINT, surfaceHeightAt } from './world';
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
const key = new THREE.DirectionalLight(0xcfe6ff, 1.9);
key.position.set(12, 26, 8);
scene.add(key);
const rim = new THREE.DirectionalLight(0x1c98d0, 0.9);
rim.position.set(-14, 10, -12);
scene.add(rim);

const world = buildWorld(scene, renderer);

const manifest = (await fetch(`${import.meta.env.BASE_URL}sprites/megaman-atlas.json`).then((r) => r.json())) as AtlasManifest;
const atlas = new SpriteAtlas(renderer, manifest);
const player = new Player(manifest, atlas.texture);
scene.add(player.group);

const input = new Input();
input.attach(window);

// Test/debug handle; the browser harness uses it to assert movement and collision.
interface DebugApi {
  state: typeof player.state;
  setInput: (x: number, y: number) => void;
  tile: number;
  ready: boolean;
  /** True when the player's feet are on a walkable cell (never in the void). */
  onPlatform: () => boolean;
  /** Solid props as world XZ boxes, so tests assert against real geometry. */
  blockers: () => Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  /** The player's own collision predicate, so traversal can be proven, not assumed. */
  walkableAt: (x: number, z: number) => boolean;
  /** Grid positions of the three plaza centres and the entrance. */
  landmarks: { plazas: Array<{ x: number; z: number }>; entrance: { x: number; z: number } };
  /** Distinct colors in a center sample, rendered in-frame (drawing buffer is not preserved). */
  sampleColors: () => number;

}
(window as unknown as { game: DebugApi }).game = {
  state: player.state,
  setInput: (x, y) => input.set(x, y),
  tile: 2,
  ready: false,
  onPlatform: () => surfaceHeightAt(world, player.state.x, player.state.z) !== null,
  /** Solid props as world XZ boxes, so tests assert against real geometry. */
  blockers: () => world.blockers.map((b) => ({ minX: b.min.x, maxX: b.max.x, minZ: b.min.y, maxZ: b.max.y })),
  walkableAt: (x, z) => !player.blocked(world, x, z),
  landmarks: {
    plazas: PLAZA_POINTS,
    entrance: SPAWN_POINT,
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
};

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  player.update(dt, input.state.x, input.state.y, world);
  player.faceCamera(camera);
  renderer.render(scene, camera);
  (window as unknown as { game: DebugApi }).game.ready = true;
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
