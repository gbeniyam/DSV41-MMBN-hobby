import * as THREE from 'three';
import { dirFromScreen, type AtlasManifest, type Dir } from './sprites';
import { shadowTexture } from './textures';
import { SPAWN, surfaceHeightAt, type WorldData } from './world';

export const SPEED = 6.5;
export const PLAYER_RADIUS = 0.62;
const WALK_FPS = 11;
// A 48px cell at 0.068 = ~3.3 world units, a little over one 2-unit tile: the
// character-to-tile ratio the GBA overworld uses, readable at full-square framing.
const SPRITE_SCALE = 0.068;

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  dir: Dir;
  frame: number;
  moving: boolean;
}

/**
 * Screen-space to world-space basis for the isometric camera at (1,1,1):
 *   screen right -> ( 1, 0, -1) / sqrt2
 *   screen up    -> (-1, 0, -1) / sqrt2   (ground-projected)
 */
const S = Math.SQRT1_2;

export class Player {
  readonly group = new THREE.Group();
  readonly state: PlayerState = {
    x: SPAWN.x,
    y: 0,
    z: SPAWN.z,
    dir: 'S',
    frame: 0,
    moving: false,
  };

  private readonly sprite: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly shadow: THREE.Mesh;
  private readonly manifest: AtlasManifest;
  private animTime = 0;

  constructor(manifest: AtlasManifest, texture: THREE.Texture) {
    this.manifest = manifest;
    const { w, h } = manifest.cell;

    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.4,
      depthWrite: false,
    });
    this.sprite = new THREE.Mesh(new THREE.PlaneGeometry(w * SPRITE_SCALE, h * SPRITE_SCALE), this.material);
    this.sprite.position.y = (h * SPRITE_SCALE) / 2;
    this.sprite.renderOrder = 10;
    this.group.add(this.sprite);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = 5;
    this.group.add(this.shadow);

    this.setCell('S', 0);
  }

  private setCell(dir: Dir, col: number): void {
    const { columns, rows } = this.manifest;
    const row = this.manifest.directions[dir].row;
    this.material.map!.offset.set(col / columns, 1 - (row + 1) / rows);
    this.state.dir = dir;
    this.state.frame = col;
  }

  /** Height of the floor under the player, or null over the void. */
  heightUnder(world: WorldData): number | null {
    return surfaceHeightAt(world, this.state.x, this.state.z);
  }

  /** True when a circle of PLAYER_RADIUS at (x,z) would overlap a blocker or leave the platform. */
  blocked(world: WorldData, x: number, z: number): boolean {
    if (surfaceHeightAt(world, x, z) === null) return true;
    for (const box of world.blockers) {
      const nx = Math.max(box.min.x, Math.min(x, box.max.x));
      const nz = Math.max(box.min.y, Math.min(z, box.max.y));
      const dx = x - nx;
      const dz = z - nz;
      if (dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS) return true;
    }
    return false;
  }

  /** Axis-separated movement so the player slides along walls instead of sticking. */
  move(world: WorldData, dx: number, dz: number): boolean {
    let moved = false;
    if (dx !== 0 && !this.blocked(world, this.state.x + dx, this.state.z)) {
      this.state.x += dx;
      moved = true;
    }
    if (dz !== 0 && !this.blocked(world, this.state.x, this.state.z + dz)) {
      this.state.z += dz;
      moved = true;
    }
    return moved;
  }

  update(dt: number, inputX: number, inputY: number, world: WorldData): void {
    const moving = inputX !== 0 || inputY !== 0;

    if (moving) {
      const wx = (inputX - inputY) * S;
      const wz = (-inputX - inputY) * S;
      const len = Math.hypot(wx, wz) || 1;
      const step = SPEED * dt;
      this.move(world, (wx / len) * step, (wz / len) * step);

      const dir = dirFromScreen(inputX, inputY);
      this.animTime += dt;
      const walk = this.manifest.layout.walk;
      const col = walk[Math.floor(this.animTime * WALK_FPS) % walk.length]!;
      this.setCell(dir, col);
      this.state.moving = true;
    } else {
      this.animTime = 0;
      if (this.state.moving || this.state.frame !== this.manifest.layout.idle) {
        this.setCell(this.state.dir, this.manifest.layout.idle);
      }
      this.state.moving = false;
    }

    const ground = this.heightUnder(world);
    this.state.y = ground ?? this.state.y;
    this.group.position.set(this.state.x, this.state.y, this.state.z);
  }

  /** Billboards the sprite to the isometric camera; the shadow stays flat on the floor. */
  faceCamera(camera: THREE.Camera): void {
    this.sprite.quaternion.copy(camera.quaternion);
  }
}
