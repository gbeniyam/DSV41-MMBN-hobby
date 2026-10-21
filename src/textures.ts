import * as THREE from 'three';
import { PAL } from './palette';

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Greyscale cyber floor panel; tinted per-instance so one texture covers the whole plate. */
export function floorTileTexture(): THREE.CanvasTexture {
  return canvasTexture(32, (ctx, s) => {
    ctx.fillStyle = '#8d8d8d';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(1, 1, s - 2, s - 2);
    ctx.fillStyle = '#ababab';
    ctx.fillRect(2, 2, s - 4, 2);
    ctx.fillRect(2, 2, 2, s - 4);
    ctx.fillStyle = '#565656';
    ctx.fillRect(2, s - 4, s - 4, 2);
    ctx.fillRect(s - 4, 2, 2, s - 4);
    ctx.fillStyle = '#cfcfcf';
    ctx.fillRect(5, 5, 2, 2);
    ctx.fillRect(s - 7, 5, 2, 2);
    ctx.fillRect(5, s - 7, 2, 2);
    ctx.fillRect(s - 7, s - 7, 2, 2);
    ctx.fillStyle = '#7e7e7e';
    ctx.fillRect(9, 9, s - 18, 1);
    ctx.fillRect(9, s - 10, s - 18, 1);
    ctx.fillRect(9, 9, 1, s - 18);
    ctx.fillRect(s - 10, 9, 1, s - 18);
  });
}

/** Wide void plate that fades the arena into darkness. */
export function voidTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    const c = s / 2;
    ctx.fillStyle = '#04060e';
    ctx.fillRect(0, 0, s, s);
    const grd = ctx.createRadialGradient(c, c, s * 0.05, c, c, s * 0.5);
    grd.addColorStop(0, 'rgba(28,152,208,0.40)');
    grd.addColorStop(0.45, 'rgba(18,48,88,0.22)');
    grd.addColorStop(1, 'rgba(4,6,14,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(56,224,255,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= s; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
  });
}

/** Soft radial blob used for the player's contact shadow. */
export function shadowTexture(): THREE.CanvasTexture {
  return canvasTexture(64, (ctx, s) => {
    const grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.22)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, s, s);
  });
}

export const PALETTE = PAL;

/**
 * Loads the authentic ACDC tile atlas extracted from the MMBN3 ACDC 3 map rip.
 * Four 32x16 tiles: floor, floorAlt, frame, accent.
 */
export function loadAcdaTileAtlas(renderer: THREE.WebGLRenderer): THREE.Texture {
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const img = new Image();
  img.onload = () => {
    tex.image = img;
    tex.needsUpdate = true;
  };
  img.src = `${import.meta.env.BASE_URL}sprites/acdc-tiles.png`;
  void renderer;
  return tex;
}
