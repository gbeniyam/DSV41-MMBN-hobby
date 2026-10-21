export interface InputState {
  x: number;
  y: number;
  keys: Set<string>;
}

const KEY_MAP: Record<string, { x: number; y: number }> = {
  KeyW: { x: 0, y: 1 },
  ArrowUp: { x: 0, y: 1 },
  KeyS: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: -1 },
  KeyA: { x: -1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

export class Input {
  readonly state: InputState = { x: 0, y: 0, keys: new Set() };
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!(e.code in KEY_MAP)) return;
    e.preventDefault();
    this.state.keys.add(e.code);
    this.recompute();
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (!(e.code in KEY_MAP)) return;
    e.preventDefault();
    this.state.keys.delete(e.code);
    this.recompute();
  };
  private readonly onBlur = () => {
    this.state.keys.clear();
    this.recompute();
  };

  private recompute(): void {
    let x = 0;
    let y = 0;
    for (const code of this.state.keys) {
      const v = KEY_MAP[code];
      if (!v) continue;
      x += v.x;
      y += v.y;
    }
    this.state.x = Math.sign(x);
    this.state.y = Math.sign(y);
  }

  attach(target: Window): void {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(target: Window): void {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }

  /** Programmatic input for tests. */
  set(x: number, y: number): void {
    this.state.x = Math.sign(x);
    this.state.y = Math.sign(y);
    this.state.keys.clear();
    if (y > 0) this.state.keys.add('KeyW');
    if (y < 0) this.state.keys.add('KeyS');
    if (x < 0) this.state.keys.add('KeyA');
    if (x > 0) this.state.keys.add('KeyD');
  }
}
