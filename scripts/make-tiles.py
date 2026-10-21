#!/usr/bin/env python3
"""Extract an authentic ACDC cyber tileset from the MMBN3 ACDC 3 map rip.

Source: https://sprites-inc.com/files/EXE/EXE3/Maps/Net/ACDC3.png
(ACDC Square lives in ACDC 3 per the MMBN3 map guide.)

Method: the rip is a scenic screenshot, not a tilesheet. It was segmented by
finding every 32x16 cell fully clear of the background colour (#202810) -- 32x16
is the rip's measured self-similarity period, i.e. the GBA's 2:1 isometric tile.
Those 262 clean cells were clustered by dominant colour, and one representative
per surface family was kept. Output is a 4x1 atlas of 32x16 tiles:
  0 mint floor   1 pale floor   2 grey frame   3 blue accent
"""
from PIL import Image
import json

SRC = 'public/sprites/source/ACDC3.png'
OUT = 'public/sprites/acdc-tiles.png'
META = 'public/sprites/acdc-tiles.json'
BG = (0x20, 0x28, 0x10)
TW, TH = 32, 16

# Cells chosen by clustering the clean cells by dominant colour and ranking each
# family by edge detail (distinct colours on the tile border), then uniqueness.
PICKS = [
    ('floor', 192, 288),   # mint #98f8d8
    ('floorAlt', 288, 240),  # pale #f0f8f8
    ('frame', 416, 80),    # grey #707070
    ('accent', 736, 528),  # blue #0088e0
]

im = Image.open(SRC).convert('RGB')
px = im.load()
w, h = im.size

def clean(x0, y0):
    return all(px[x, y] != BG for y in range(y0, y0 + TH) for x in range(x0, x0 + TW))

atlas = Image.new('RGB', (TW * len(PICKS), TH), BG)
meta = {'image': 'sprites/acdc-tiles.png', 'tile': {'w': TW, 'h': TH}, 'tiles': {}}

for i, (name, x, y) in enumerate(PICKS):
    assert clean(x, y), f'{name} cell at ({x},{y}) is not clear of background'
    tile = im.crop((x, y, x + TW, y + TH))
    colors = {p for p in tile.getdata()}
    assert len(colors) >= 8, f'{name} tile looks flat ({len(colors)} colours)'
    atlas.paste(tile, (i * TW, 0))
    meta['tiles'][name] = {'index': i, 'u0': i / len(PICKS), 'u1': (i + 1) / len(PICKS), 'source': {'x': x, 'y': y}}

atlas.save(OUT)
json.dump(meta, open(META, 'w'), indent=1)
print(f'wrote {OUT} ({atlas.width}x{atlas.height}) with {len(PICKS)} authentic tiles')
for n, d in meta['tiles'].items():
    print(f'  {n:9s} index={d["index"]} source=({d["source"]["x"]},{d["source"]["y"]})')
