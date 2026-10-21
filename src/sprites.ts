import * as THREE from 'three';

export const DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export type Dir = (typeof DIRS)[number];

export interface AtlasFrame {
  col: number;
  source: { x: number; y: number; w: number; h: number };
}

export interface AtlasManifest {
  image: string;
  cell: { w: number; h: number };
  columns: number;
  rows: number;
  layout: { idle: number; walk: number[] };
  order: Dir[];
  anchor: string;
  directions: Record<Dir, { row: number; idle: AtlasFrame; walk: AtlasFrame[] }>;
}

/** Screen-space unit vectors for each facing (x right, y up), used to pick a facing from velocity. */
export const DIR_VECTORS: Record<Dir, { x: number; y: number }> = {
  S: { x: 0, y: -1 },
  SE: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  E: { x: 1, y: 0 },
  NE: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  N: { x: 0, y: 1 },
  NW: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  W: { x: -1, y: 0 },
  SW: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
};

/** Turns a screen-space direction into one of the 8 sprite facings. */
export function dirFromScreen(sx: number, sy: number): Dir {
  const angle = Math.atan2(sx, -sy);
  const idx = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return DIRS[idx]!;
}

export class SpriteAtlas {
  readonly texture: THREE.Texture;
  readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, manifest: AtlasManifest) {
    this.renderer = renderer;
    const tex = new THREE.Texture();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1 / manifest.columns, 1 / manifest.rows);
    this.texture = tex;

    const image = new Image();
    image.onload = () => {
      tex.image = image;
      tex.needsUpdate = true;
      tex.repeat.set(1 / manifest.columns, 1 / manifest.rows);
    };
    image.src = `${import.meta.env.BASE_URL}${manifest.image}`;
  }

  /** Points the shared atlas texture at one cell (column, row). */
  setCell(col: number, row: number, columns: number, rows: number): void {
    this.texture.offset.set(col / columns, 1 - (row + 1) / rows);
  }
}
