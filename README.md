# ACDC Square — MMBN3 fan scene

An isometric fan recreation of **ACDC Square** from *Mega Man Battle Network 3*, built with
Three.js. MegaMan.EXE runs around a floating cyber plaza at 8-directional WASD control with
collision against platform edges and solid props.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:4173
```

`WASD` / arrow keys move; diagonals work. The character faces its movement direction and
plays a stitched walk cycle, standing still on the idle frame when you release the keys.

## Verify

```bash
npm run build          # tsc --noEmit + vite build -> dist/
npm run assets         # regenerate both atlases from the game rips (python3 + Pillow)
npx playwright test    # movement, facings, animation, collision, traversal, layout
node scripts/verify-atlas.mjs   # decodes both atlases and checks every cell
```

Playwright captures `test-results/scene.png` for visual review.

## How the sprites were derived

`scripts/make-atlas.py` cuts the game's overworld sheet into a uniform
**8 rows x 7 columns** atlas (`public/sprites/megaman-atlas.png`): column 0 is the idle
frame, columns 1-6 the walk cycle. Row order is clockwise from screen-south:
`S, SE, E, NE, N, NW, W, SW`.

The sheet does not label its rows, so the mapping was derived from the pixels:

- The eight idle facings sit in one row. That row is symmetric in mirror pairs
  (1<->7, 2<->6, 3<->5); frame 0 has its head skin centred (front) and frame 4 has
  no skin pixels at all (back). That pins the compass order and its starting point.
- The walk rows contain two 6-frame direction blocks each. Blocks were assigned by
  matching silhouette and colour against the eight idle anchors, and cross-checked
  against the skin-pixel centroid, whose sign flips between left- and right-facing
  blocks.
- Six frames across the walk rows are byte-identical pixel mirrors of frames in
  another row, confirming the left/right pairing.

`src/sprites.ts` turns movement input into a facing; `src/player.ts` animates and
collides; `src/world.ts` holds the tile map.

## The platform

The scene recreates **ACDC Square**, which lives in ACDC 3 in MMBN3 (per the
[MMBN3 map guide](https://www.therockmanexezone.com/wiki/Map_Guide_(MMBN3))). Its
documented structure — three polygon platforms joined in a triangle, entrance arm at
the top, platform elevated off the void, BBS terminals in the lower-left plaza — is
encoded as the `MAP` string table in `src/world.ts`, with the plaza/hub/entrance
positions as named constants.

Three tests keep it honest:

- every walkable cell is reachable from the entrance (flood fill on the player's own
  collision predicate, so it tests gameplay not just the array),
- the plaza centroids form a non-degenerate triangle with one plaza above and two
  below, and the entrance sits north of all of them,
- the player cannot overlap a prop from any of four approach directions.

### Tiles

`scripts/make-tiles.py` extracts the tile art from the ACDC 3 map rip
(`public/sprites/source/ACDC3.png`). The rip is a scenic screenshot rather than a
tilesheet, so the script segments it into the 262 cells that are clear of the
background colour, using the rip's measured 32x16 self-similarity period — the GBA's
2:1 isometric tile. Those cells are clustered by dominant colour and one representative
per surface family is written to `public/sprites/acdc-tiles.png`.

## Assets

Character sprites: [Sprites INC — MMBN overworld](https://sprites-inc.com/sprite.php?local=/EXE/Megaman/OverworldEXE123/).
Area map art: [Sprites INC — MMBN3 Net maps](https://sprites-inc.com/sprite.php?local=/EXE/EXE3/Maps/Net/) (`ACDC3.png`).
Mega Man and Mega Man Battle Network are trademarks of Capcom. This is a non-commercial
fan project; no affiliation with or endorsement by Capcom is implied.
