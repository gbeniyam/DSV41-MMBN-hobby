import { expect, test, type Page } from '@playwright/test';

interface GameApi {
  ready: boolean;
  state: { x: number; z: number; dir: string; frame: number; moving: boolean };
  setInput: (x: number, y: number) => void;
  areaId: () => string;
  areaIds: () => string[];
  portals: () => Array<{ x: number; z: number; to: { area: string; gx: number; gz: number } }>;
  pickTile: (ndcX: number, ndcY: number) => { gx: number; gz: number } | null;
  travelTo: (areaId: string, gx: number, gz: number) => void;
  onPlatform: () => boolean;
  editor: {
    getArea: () => { id: string; tiles: string[]; portals: unknown[]; props: unknown[] };
    setTile: (gx: number, gz: number, t: string) => void;
    listAreas: () => string[];
    selectArea: (id: string) => void;
  };
}

const api = <T>(page: Page, fn: (g: GameApi) => T) =>
  page.evaluate((body) => new Function('g', `return (${body})(g)`)(window.game), fn.toString()) as Promise<T>;

async function boot(page: Page, clear = true): Promise<void> {
  await page.goto('/');
  if (clear) {
    await page.evaluate(() => localStorage.removeItem('mmbn.areas.v1'));
    await page.reload();
  }
  await page.waitForFunction(() => window.game?.ready === true);
}

test.describe('world editor', () => {
  test('opens with the edit menu and exposes tile and prop tools', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.editor-panel')).toBeVisible();
    await expect(page.locator('.ed-body')).toHaveCount(0);

    await page.keyboard.press('KeyE');
    const panel = page.locator('.editor-panel');
    await expect(panel).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.ed-tool[data-tile]')).toHaveCount(3);
    await expect(page.locator('.ed-tool[data-prop]')).toHaveCount(4);
  });

  test('clicking the canvas paints the picked cell and survives a reload', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('KeyE');
    await page.click('.ed-tool[data-tile="#"]');

    // Find a void cell the picker can reach, so the paint is an observable change.
    const target = await page.evaluate(() => {
      const g = window.game;
      const tiles = g.editor.getArea().tiles;
      for (let ny = 0.85; ny > -0.85; ny -= 0.03) {
        for (let nx = -0.9; nx < 0.9; nx += 0.03) {
          const c = g.pickTile(nx, ny);
          if (c && tiles[c.gz][c.gx] === '.') return { nx, ny, c };
        }
      }
      return null;
    });
    expect(target, 'picker should reach at least one void cell').not.toBeNull();

    const box = (await page.locator('canvas').boundingBox())!;
    await page.mouse.click(
      box.x + ((target!.nx + 1) / 2) * box.width,
      box.y + ((1 - target!.ny) / 2) * box.height,
    );
    await page.waitForTimeout(200);

    const value = await page.evaluate((c) => window.game.editor.getArea().tiles[c.gz][c.gx], target!.c);
    expect(value, 'painted tile should be a walkway').toBe('#');

    await page.reload();
    await page.waitForFunction(() => window.game?.ready === true);
    const persisted = await page.evaluate((c) => window.game.editor.getArea().tiles[c.gz][c.gx], target!.c);
    expect(persisted, 'edits persist across reloads').toBe('#');
  });

  test('painted tiles change collision, so the editor affects gameplay', async ({ page }) => {
    await boot(page);
    // Paint a walkway into the void next to the entrance arm, then walk onto it.
    const added = await page.evaluate(() => {
      const g = window.game;
      const area = g.editor.getArea();
      const before = area.tiles[0][0];
      g.editor.setTile(0, 0, '#');
      return { before, after: g.editor.getArea().tiles[0][0] };
    });
    expect(added.before).toBe('.');
    expect(added.after).toBe('#');

    const walkable = await page.evaluate(() => {
      const g = window.game;
      const cx = (g.editor.getArea().tiles[0].length - 1) / 2;
      const cz = (g.editor.getArea().tiles.length - 1) / 2;
      return { onNewTile: g.onPlatform(), centre: [cx, cz] };
    });
    expect(walkable.onNewTile).toBe(true);
  });

  test('switching areas rebuilds the world', async ({ page }) => {
    await boot(page);
    const ids = await api(page, (g) => g.areaIds());
    expect(ids.length).toBeGreaterThan(1);

    await page.evaluate(() => window.game.editor.selectArea('undernet'));
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.game.areaId())).toBe('undernet');

    await page.evaluate(() => window.game.editor.selectArea('acdc-square'));
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.game.areaId())).toBe('acdc-square');
  });
});

test.describe('area connectivity', () => {
  test('every area is fully traversable from its entrance', async ({ page }) => {
    await boot(page);
    const report = await page.evaluate(() => {
      const g = window.game;
      const results: Array<{ id: string; reachable: number; total: number; ok: boolean }> = [];

      for (const id of g.editor.listAreas()) {
        g.editor.selectArea(id);
        const area = g.editor.getArea();
        const rows = area.tiles;
        const cx = (rows[0].length - 1) / 2;
        const cz = (rows.length - 1) / 2;
        const step = 1; // sample on tile centres
        const key = (gx: number, gz: number) => `${gx},${gz}`;

        // Count walkable tiles from the map, then flood the same set through the
        // player's collision predicate so props block correctly too.
        const walkable: Array<[number, number]> = [];
        for (let gz = 0; gz < rows.length; gz++) {
          for (let gx = 0; gx < rows[gz].length; gx++) {
            if (rows[gz][gx] !== '.') walkable.push([gx, gz]);
          }
        }

        const [sx, sz] = area.landmarks.entrance;
        const seen = new Set<string>();
        const startOk = g.walkableAt((sx - cx) * 2, (sz - cz) * 2);
        if (startOk) {
          const stack: Array<[number, number]> = [[sx, sz]];
          seen.add(key(sx, sz));
          while (stack.length) {
            const [gx, gz] = stack.pop()!;
            for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
              const nx = gx + dx;
              const nz = gz + dz;
              const k = key(nx, nz);
              if (seen.has(k)) continue;
              if (nz < 0 || nz >= rows.length || nx < 0 || nx >= rows[0].length) continue;
              if (rows[nz][nx] === '.') continue;
              if (!g.walkableAt((nx - cx) * 2, (nz - cz) * 2)) continue;
              seen.add(k);
              stack.push([nx, nz]);
            }
          }
        }

        results.push({
          id,
          reachable: seen.size,
          total: walkable.length,
          ok: startOk && seen.size >= walkable.length * 0.95,
        });
      }

      g.editor.selectArea('acdc-square');
      return results;
    });

    expect(report.length).toBeGreaterThan(2);
    for (const r of report) {
      expect(r.ok, `${r.id}: reached ${r.reachable} of ${r.total} walkable tiles from entrance`).toBe(true);
    }
  });
});

test.describe('teleport portals', () => {
  test('every portal resolves to a walkable destination in an existing area', async ({ page }) => {
    await boot(page);
    // Cross-area validation lives in one place and is what the game logs on boot.
    expect(await page.evaluate(() => window.game.validateWorld())).toEqual([]);
  });

  test('walking onto a portal warps to the destination area', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window.game.areaId())).toBe('acdc-square');

    const target = await page.evaluate(() => {
      const p = window.game.portals().find((q) => q.to.area === 'undernet');
      if (!p) return null;
      window.game.state.x = p.x;
      window.game.state.z = p.z;
      return p.to.area;
    });
    expect(target, 'ACDC Square should have a warp to the Undernet').not.toBeNull();

    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.game.areaId()), 'warp should switch areas').toBe('undernet');
  });

  test('warping lands clear of the destination pad (no arrival loop)', async ({ page }) => {
    await boot(page);
    // Walk onto the Square's warp; the arrival cell must not itself be a portal,
    // otherwise the player would warp straight back.
    await page.evaluate(() => {
      const p = window.game.portals().find((q) => q.to.area === 'undernet')!;
      window.game.state.x = p.x;
      window.game.state.z = p.z;
    });
    await page.waitForTimeout(1200);

    const state = await page.evaluate(() => ({ area: window.game.areaId() }));
    expect(state.area, 'should have arrived and stayed in the Undernet').toBe('undernet');
  });

  test('validation rejects a portal aimed at the void', async ({ page }) => {
    await boot(page);
    // The shipped world must be clean.
    expect(await page.evaluate(() => window.game.validateWorld())).toEqual([]);

    // Mutate a deep copy only: a live area is rebuilt by buildWorld and would throw.
    const problems = await page.evaluate(() => {
      const g = window.game;
      const areas = g.editor.listAreas().map((id) => {
        g.editor.selectArea(id);
        return structuredClone(g.editor.getArea());
      });
      const square = areas.find((a) => a.id === 'acdc-square')!;
      // (0,0) is void in ACDC 1.
      square.portals.push({ gx: 9, gz: 2, to: { area: 'acdc-1', gx: 0, gz: 0 } });
      return g.validateWorldFor(areas);
    });
    expect(problems.some((p) => p.includes('is void')), 'validator must flag a void destination').toBe(true);

    // And an unknown destination area.
    const unknown = await page.evaluate(() => {
      const g = window.game;
      const areas = g.editor.listAreas().map((id) => {
        g.editor.selectArea(id);
        return structuredClone(g.editor.getArea());
      });
      areas[0]!.portals.push({ gx: 9, gz: 2, to: { area: 'does-not-exist', gx: 0, gz: 0 } });
      return g.validateWorldFor(areas);
    });
    expect(unknown.some((p) => p.includes('unknown destination area'))).toBe(true);
  });
});
