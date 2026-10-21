#!/usr/bin/env python3
"""Cut the MegaMan.EXE overworld sheet into a uniform 8-direction, 7-column atlas.

Columns: 0 = idle (standing), 1..6 = walk cycle.
Rows: S, SE, E, NE, N, NW, W, SW (clockwise from screen-south).

Direction order was derived from the sheet itself:
  * row 2 holds the 8 idle facings; its frames are mirror pairs 1<->7, 2<->6, 3<->5,
    frame 0 is face-centred (down) and frame 4 is back-facing (no skin pixels).
  * rows 3..6 hold 12 walk frames each, ordered as two 6-frame direction blocks:
    row3 = S,SE | row4 = E,NE | row5 = N,NW | row6 = W,SW. Independent confirmation:
    rows 5 and 6 are exact pixel mirrors of rows 4 and 3 (six byte-identical
    mirror matches), and the skin-pixel centroid flips sign between them.
"""
import json
from PIL import Image

SRC = 'public/sprites/MM_EXE1-3_overworld.png'
OUT_PNG = 'public/sprites/megaman-atlas.png'
OUT_JSON = 'public/sprites/megaman-atlas.json'
MAGENTA = (248, 0, 248)
CELL_W, CELL_H = 32, 48
COLS, ROWS = 7, 8
DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']
WALK_SRC = {'S': (3, 0), 'SE': (3, 6), 'E': (4, 0), 'NE': (4, 6),
            'N': (5, 0), 'NW': (5, 6), 'W': (6, 0), 'SW': (6, 6)}


def opaque(px):
    r, g, b, a = px
    return a > 0 and (r, g, b) != MAGENTA


im = Image.open(SRC).convert('RGBA')
w, h = im.size
px = im.load()


def row_runs():
    runs, start = [], None
    for y in range(h):
        filled = any(opaque(px[x, y]) for x in range(w))
        if filled and start is None:
            start = y
        elif not filled and start is not None:
            runs.append((start, y - 1))
            start = None
    if start is not None:
        runs.append((start, h - 1))
    return runs


def split_frames(y0, y1, gap=3):
    cols = [any(opaque(px[x, y]) for y in range(y0, y1 + 1)) for x in range(w)]
    frames, start, blank = [], None, 0
    for x in range(w):
        if cols[x]:
            if start is None:
                start = x
            blank = 0
        elif start is not None:
            blank += 1
            if blank >= gap:
                frames.append((start, x - blank))
                start = None
    if start is not None:
        frames.append((start, w - 1))
    out = []
    for fx0, fx1 in frames:
        ys = [y for y in range(y0, y1 + 1) if any(opaque(px[x, y]) for x in range(fx0, fx1 + 1))]
        xs = [x for x in range(fx0, fx1 + 1) if any(opaque(px[x, y]) for y in range(y0, y1 + 1))]
        if ys:
            out.append((xs[0], ys[0], xs[-1] - xs[0] + 1, ys[-1] - ys[0] + 1))
    return out


runs = row_runs()
rows = {i: split_frames(a, b) for i, (a, b) in enumerate(runs)}
assert len(rows[2]) == 8, 'idle row must have 8 facings'

# Per-row walk blocks contain 12 frames left-to-right, but the sheet's frame order
# inside a block is interleaved by the original rip; use the per-block frames as-is.
atlas = Image.new('RGBA', (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
manifest = {
    'image': 'sprites/megaman-atlas.png',
    'cell': {'w': CELL_W, 'h': CELL_H},
    'columns': COLS,
    'rows': ROWS,
    'layout': {'idle': 0, 'walk': [1, 2, 3, 4, 5, 6]},
    'order': DIRS,
    'anchor': 'bottom-center',
    'source': 'https://sprites-inc.com/sprite.php?local=/EXE/Megaman/OverworldEXE123/',
    'sheet': {'w': w, 'h': h},
    'directions': {},
}

for row_index, d in enumerate(DIRS):
    src_row, off = WALK_SRC[d]
    idle = rows[2][row_index]
    walk = rows[src_row][off:off + 6]
    assert len(walk) == 6, (d, len(walk))

    def place(fr, col):
        sx, sy, fw, fh = fr
        assert fw <= CELL_W and fh <= CELL_H, (d, fw, fh)
        crop = im.crop((sx, sy, sx + fw, sy + fh))
        dx = col * CELL_W + (CELL_W - fw) // 2
        dy = row_index * CELL_H + (CELL_H - fh)  # bottom aligned
        atlas.paste(crop, (dx, dy))

    place(idle, 0)
    for i, fr in enumerate(walk):
        place(fr, i + 1)
    manifest['directions'][d] = {
        'row': row_index,
        'idle': {'col': 0, 'source': {'x': idle[0], 'y': idle[1], 'w': idle[2], 'h': idle[3]}},
        'walk': [{'col': i + 1, 'source': {'x': f[0], 'y': f[1], 'w': f[2], 'h': f[3]}}
                 for i, f in enumerate(walk)],
    }

atlas.save(OUT_PNG)
json.dump(manifest, open(OUT_JSON, 'w'), indent=1)
print(f'wrote {OUT_PNG} ({atlas.width}x{atlas.height}) and {OUT_JSON}')
