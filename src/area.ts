/**
 * Area definitions: the serializable world model the editor edits and the game loads.
 *
 * A tile map is an array of equal-length strings using the MMBN net-area legend:
 *   '.' void (no floor)   '#' walkway   '@' raised plaza
 *
 * Props and portals are placed on grid coordinates. Portals link one area to another
 * (the game's warp points / Square exits); props are scenery and obstacles.
 */

export type Tile = '.' | '#' | '@';

export type PropType = 'bbs' | 'mystery' | 'pylon' | 'avatar';

export interface PropDef {
  type: PropType;
  gx: number;
  gz: number;
}

export interface PortalDef {
  gx: number;
  gz: number;
  /** Destination. Rendered as a warp pad; entering it teleports the player. */
  to: { area: string; gx: number; gz: number };
  label?: string;
}

export interface Landmarks {
  plazas: Array<[number, number]>;
  entrance: [number, number];
}

export interface AreaDef {
  id: string;
  name: string;
  /** Optional flavour line shown in the editor's area list. */
  note?: string;
  tiles: string[];
  props: PropDef[];
  portals: PortalDef[];
  /** Named grid points the player spawns at and tests assert against. */
  landmarks: Landmarks;
}

export const TILE_CHARS: Tile[] = ['.', '#', '@'];

/** Height (world units) of each tile kind. Void carries none. */
export const TILE_HEIGHT: Record<Tile, number> = { '.': 0, '#': 0.5, '@': 1.1 };

export function isWalkable(t: Tile): boolean {
  return t !== '.';
}

/** Validates an area, returning a list of problems (empty when valid). */
export function validateArea(a: AreaDef): string[] {
  const problems: string[] = [];
  if (!a.id) problems.push('area has no id');
  if (a.tiles.length === 0) problems.push(`${a.id}: no tiles`);
  const w = a.tiles[0]?.length ?? 0;
  a.tiles.forEach((row, i) => {
    if (row.length !== w) problems.push(`${a.id}: row ${i} is ${row.length} wide, expected ${w}`);
    for (const ch of row) {
      if (!TILE_CHARS.includes(ch as Tile)) problems.push(`${a.id}: row ${i} has unknown tile '${ch}'`);
    }
  });

  const inBounds = (gx: number, gz: number) => gz >= 0 && gz < a.tiles.length && gx >= 0 && gx < w;
  const walkable = (gx: number, gz: number) =>
    inBounds(gx, gz) && isWalkable(a.tiles[gz]![gx] as Tile);

  for (const p of a.props) {
    if (!walkable(p.gx, p.gz)) problems.push(`${a.id}: prop ${p.type} at ${p.gx},${p.gz} is not on a floor tile`);
  }
  for (const p of a.portals) {
    if (!walkable(p.gx, p.gz)) problems.push(`${a.id}: portal at ${p.gx},${p.gz} is not on a floor tile`);
    if (!p.to.area) problems.push(`${a.id}: portal at ${p.gx},${p.gz} has no destination area`);
  }
  for (const [gx, gz] of [...a.landmarks.plazas, a.landmarks.entrance]) {
    if (!walkable(gx, gz)) problems.push(`${a.id}: landmark ${gx},${gz} is not walkable`);
    // A solid prop on a landmark makes it unreachable no matter how open the map is.
    const blocker = a.props.find((p) => p.gx === gx && p.gz === gz && p.type !== 'mystery');
    if (blocker) problems.push(`${a.id}: landmark ${gx},${gz} is covered by a ${blocker.type}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Artwork/tile helper for editing
// ---------------------------------------------------------------------------

export function blankArea(id: string, name: string, w: number, h: number): AreaDef {
  const tiles = Array.from({ length: h }, () => '.'.repeat(w));
  return {
    id,
    name,
    tiles,
    props: [],
    portals: [],
    landmarks: { plazas: [], entrance: [Math.floor(w / 2), Math.floor(h / 2)] },
  };
}

/** Sets one tile, returning a new area (immutable, so undo/redo stays cheap). */
export function setTile(a: AreaDef, gx: number, gz: number, t: Tile): AreaDef {
  if (gz < 0 || gz >= a.tiles.length) return a;
  const row = a.tiles[gz]!;
  if (gx < 0 || gx >= row.length) return a;
  if (row[gx] === t) return a;
  const next = [...a.tiles];
  next[gz] = row.slice(0, gx) + t + row.slice(gx + 1);
  return { ...a, tiles: next };
}

export function addProp(a: AreaDef, type: PropType, gx: number, gz: number): AreaDef {
  const props = a.props.filter((p) => !(p.gx === gx && p.gz === gz));
  return { ...a, props: [...props, { type, gx, gz }] };
}

export function addPortal(a: AreaDef, p: PortalDef): AreaDef {
  const portals = a.portals.filter((q) => !(q.gx === p.gx && q.gz === p.gz));
  return { ...a, portals: [...portals, p] };
}

export function removeAt(a: AreaDef, gx: number, gz: number): AreaDef {
  return {
    ...a,
    props: a.props.filter((p) => !(p.gx === gx && p.gz === gz)),
    portals: a.portals.filter((p) => !(p.gx === gx && p.gz === gz)),
  };
}
