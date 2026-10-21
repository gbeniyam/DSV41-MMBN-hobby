import { expect, test, type Page } from '@playwright/test';

interface GameState {
  x: number;
  y: number;
  z: number;
  dir: string;
  frame: number;
  moving: boolean;
}

async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => (window as unknown as { game: { state: GameState } }).game.state);
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { game?: { ready: boolean } }).game?.ready === true);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await ready(page);
  expect(errors, 'no uncaught page errors').toEqual([]);
});

test('renders a non-blank WebGL canvas', async ({ page }) => {
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(100);

  const webgl = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  });
  expect(webgl).toBe(true);

  // Non-blank: sample the framebuffer and require more than one distinct color.
  const shot = await page.screenshot();
  expect(shot.byteLength).toBeGreaterThan(20_000);

  const distinct = await page.evaluate(() =>
    (window as unknown as { game: { sampleColors: () => number } }).game.sampleColors(),
  );
  expect(distinct, 'canvas should contain rendered variety, not a flat fill').toBeGreaterThan(3);
});

test('WASD moves the player in all four screen directions', async ({ page }) => {
  const start = await state(page);

  const press = async (key: string) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(220);
    await page.keyboard.up(key);
    await page.waitForTimeout(60);
    return state(page);
  };

  const right = await press('KeyD');
  expect(right.x).toBeGreaterThan(start.x);

  const left = await press('KeyA');
  expect(left.x).toBeLessThan(right.x);

  const up = await press('KeyW');
  expect(up.z).toBeLessThan(left.z);

  const down = await press('KeyS');
  expect(down.z).toBeGreaterThan(up.z);
});

test('each of the 8 facings resolves to its own sprite row', async ({ page }) => {
  const rows = new Map<string, string>();
  const combos: Array<[string, string, string]> = [
    ['KeyS', '', 'S'],
    ['KeyS', 'KeyD', 'SE'],
    ['KeyD', '', 'E'],
    ['KeyW', 'KeyD', 'NE'],
    ['KeyW', '', 'N'],
    ['KeyW', 'KeyA', 'NW'],
    ['KeyA', '', 'W'],
    ['KeyS', 'KeyA', 'SW'],
  ];

  for (const [a, b, expected] of combos) {
    await page.keyboard.down(a);
    if (b) await page.keyboard.down(b);
    await page.waitForTimeout(140);
    const s = await state(page);
    if (b) await page.keyboard.up(b);
    await page.keyboard.up(a);
    await page.waitForTimeout(40);
    expect(s.dir, `${a}+${b || '-'} should face ${expected}`).toBe(expected);
    expect(s.moving).toBe(true);
    rows.set(expected, s.dir);
  }
  expect(rows.size).toBe(8);
});

test('walk animation cycles frames while idle holds the standing frame', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { game: { setInput: (x: number, y: number) => void } }).game.setInput(1, 0));
  const frames = new Set<number>();
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(50);
    frames.add((await state(page)).frame);
  }
  expect(frames.size, 'walk cycle should show multiple frames').toBeGreaterThan(2);

  await page.evaluate(() => (window as unknown as { game: { setInput: (x: number, y: number) => void } }).game.setInput(0, 0));
  await page.waitForTimeout(120);
  const idle = await state(page);
  expect(idle.moving).toBe(false);
  expect(idle.frame).toBe(0);
});

test('the player can never leave the walkable platform', async ({ page }) => {
  // Hold each screen direction long enough to reach the boundary, checking every frame.
  const escaped = await page.evaluate(async () => {
    const g = (window as unknown as {
      game: {
        setInput: (x: number, y: number) => void;
        onPlatform: () => boolean;
        state: { x: number; z: number };
      };
    }).game;
    const dirs: Array<[number, number]> = [[-1, 0], [1, 0], [0, 1], [0, -1], [-1, -1], [1, 1]];
    const bad: Array<{ dir: string; x: number; z: number }> = [];
    for (const [dx, dy] of dirs) {
      g.setInput(dx, dy);
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 16));
        if (!g.onPlatform()) bad.push({ dir: `${dx},${dy}`, x: g.state.x, z: g.state.z });
      }
      g.setInput(0, 0);
      await new Promise((r) => setTimeout(r, 60));
    }
    return bad;
  });
  expect(escaped, 'player must stay on walkable cells for every direction').toEqual([]);
});

test('collision keeps the player out of solid props', async ({ page }) => {
  // Approach each blocker from four sides using the same screen-to-world mapping the
  // game uses, and assert the player never overlaps a footprint or leaves the platform.
  // Boxes come from the live world, so this cannot go stale when the map changes.
  const violations = await page.evaluate(async () => {
    const g = (window as unknown as {
      game: {
        state: { x: number; z: number };
        setInput: (x: number, y: number) => void;
        onPlatform: () => boolean;
        blockers: () => Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
      };
    }).game;
    const boxes = g.blockers();
    if (boxes.length === 0) return [{ error: 'no blockers exposed' }];

    const bad: Array<{ what: string; x: number; z: number; box: number }> = [];
    const overlapping = (
      x: number, z: number,
      b: { minX: number; maxX: number; minZ: number; maxZ: number },
    ) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;

    // Screen input (sx, sy) -> world delta, matching Player.update: up is world -Z.
    const dirs: Array<[number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      for (const [sx, sy] of dirs) {
        // Placement offset in world space: opposite the approach direction.
        const wx = (sx - sy) * Math.SQRT1_2;
        const wz = (-sx - sy) * Math.SQRT1_2;
        g.state.x = cx - wx * 3;
        g.state.z = cz - wz * 3;
        if (!g.onPlatform()) continue; // skip approaches that start over the void
        g.setInput(sx, sy);
        for (let k = 0; k < 70; k++) {
          await new Promise((r) => setTimeout(r, 16));
          if (overlapping(g.state.x, g.state.z, b)) bad.push({ what: 'overlap', x: g.state.x, z: g.state.z, box: i });
          if (!g.onPlatform()) bad.push({ what: 'offPlatform', x: g.state.x, z: g.state.z, box: i });
        }
        g.setInput(0, 0);
      }
    }
    return bad;
  });
  expect(violations, 'player must never overlap a solid prop or leave the platform').toEqual([]);
});

test('all three plazas are reachable from the entrance', async ({ page }) => {
  // Flood-fill on the player's own collision predicate (not the tile array): proves the
  // square's three platforms are genuinely connected for a body of the player's radius.
  const result = await page.evaluate(() => {
    const g = (window as unknown as {
      game: {
        walkableAt: (x: number, z: number) => boolean;
        landmarks: { plazas: Array<{ x: number; z: number }>; entrance: { x: number; z: number } };
      };
    }).game;
    const step = 0.5;
    const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
    const start = g.landmarks.entrance;
    const seen = new Set<string>([key(start.x, start.z)]);
    const queue: Array<[number, number]> = [[start.x, start.z]];
    let expanded = 0;
    while (queue.length && expanded < 200_000) {
      const [x, z] = queue.pop()!;
      expanded++;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const nx = x + dx;
        const nz = z + dz;
        const k = key(nx, nz);
        if (seen.has(k) || !g.walkableAt(nx, nz)) continue;
        seen.add(k);
        queue.push([nx, nz]);
      }
    }
    const reached = g.landmarks.plazas.map((p) =>
      [...Array(9).keys()].some((i) =>
        seen.has(key(p.x + ((i % 3) - 1) * step, p.z + (Math.floor(i / 3) - 1) * step)),
      ),
    );
    return { reached, cells: seen.size, plazas: g.landmarks.plazas.length };
  });

  expect(result.plazas, 'three plazas defined').toBe(3);
  expect(result.reached, 'every plaza reachable from the entrance').toEqual([true, true, true]);
  expect(result.cells, 'flood fill explored a substantial area').toBeGreaterThan(200);
});

test('plaza layout matches the documented ACDC Square triangle', async ({ page }) => {
  // The three plazas must form a non-degenerate triangle with one plaza above the
  // centre row and two below, and the entrance must sit above the north plaza.
  const geo = await page.evaluate(() => {
    const g = (window as unknown as {
      game: {
        landmarks: { plazas: Array<{ x: number; z: number }>; entrance: { x: number; z: number } };
      };
    }).game;
    return g.landmarks;
  });

  const [a, b, c] = geo.plazas;
  expect(geo.plazas).toHaveLength(3);

  const area = Math.abs((b!.x - a!.x) * (c!.z - a!.z) - (c!.x - a!.x) * (b!.z - a!.z)) / 2;
  expect(area, 'plazas must not be collinear').toBeGreaterThan(20);

  const above = geo.plazas.filter((p) => p.z < 0).length;
  const below = geo.plazas.filter((p) => p.z > 0).length;
  expect([above, below], 'one plaza above, two below').toEqual([1, 2]);

  // Entrance arm is at the top of the square: north of every plaza.
  const minPlazaZ = Math.min(...geo.plazas.map((p) => p.z));
  expect(geo.entrance.z, 'entrance sits above the plazas').toBeLessThan(minPlazaZ);
});

test('captures an isometric scene screenshot', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { game: { setInput: (x: number, y: number) => void } }).game.setInput(1, 1));
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as unknown as { game: { setInput: (x: number, y: number) => void } }).game.setInput(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/scene.png', fullPage: false });
});
