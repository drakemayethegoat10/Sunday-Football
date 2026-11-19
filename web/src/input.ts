// Keyboard + mouse/touchpad input, merged with the gamepad by main.ts.

export const BTN = { Sprint: 1, Action: 2, Spin: 4, Stiff: 8, Switch: 16, FairCatch: 32 } as const;

export interface FrameInput {
  ix: number;
  iy: number;
  buttons: number;
  throwTo: number;
  throwKind: number;
}

/** Hold time (seconds) → throw type: tap = bullet, short hold = touch, long hold = lob. */
export function throwKindFor(held: number): number {
  return held < 0.18 ? 0 : held < 0.42 ? 1 : 2;
}

export class Input {
  private keys = new Set<string>();
  private edges = 0;
  private hold: { icon: number; t0: number } | null = null;
  private pendingThrow: { icon: number; kind: number } | null = null;
  /** Gamepad contributions for this frame (set by main.ts). */
  padMove: [number, number] = [0, 0];
  padSprint = false;
  enabled = false;

  constructor(
    canvas: HTMLCanvasElement,
    /** Return true if the key was handled by menus / global shortcuts. */
    private onKey: (e: KeyboardEvent) => boolean,
    /** Receiver icon (1–5) under a screen point, or 0. */
    private pickIcon: (clientX: number, clientY: number) => number,
  ) {
    window.addEventListener('keydown', (e) => {
      if (this.onKey(e)) {
        e.preventDefault();
        return;
      }
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'Space': this.edges |= BTN.Action; break;
        case 'KeyQ': this.edges |= BTN.Spin; break;
        case 'KeyE': this.edges |= BTN.Stiff; break;
        case 'Tab': this.edges |= BTN.Switch; break;
        case 'KeyF': this.edges |= BTN.FairCatch; break;
      }
      const m = /^Digit([1-5])$/.exec(e.code) ?? /^Numpad([1-5])$/.exec(e.code);
      if (m) this.beginHold(Number(m[1]));
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const m = /^Digit([1-5])$/.exec(e.code) ?? /^Numpad([1-5])$/.exec(e.code);
      if (m) this.endHold(Number(m[1]));
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.hold = null;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      const icon = this.pickIcon(e.clientX, e.clientY);
      if (icon > 0) this.beginHold(icon);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.hold) this.endHold(this.hold.icon);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Start holding a throw to receiver icon 1–5 (key, mouse or controller button). */
  beginHold(icon: number) {
    if (!this.enabled || this.hold) return;
    this.hold = { icon, t0: performance.now() };
  }

  endHold(icon: number) {
    if (!this.hold || this.hold.icon !== icon) return;
    const held = (performance.now() - this.hold.t0) / 1000;
    this.pendingThrow = { icon, kind: throwKindFor(held) };
    this.hold = null;
  }

  /** Add edge-triggered buttons from the gamepad. */
  press(bits: number) {
    if (this.enabled) this.edges |= bits;
  }

  /** 0–1 progress of a throw being held (for the meter), or -1 when not holding. */
  holdProgress(): number {
    if (!this.hold) return -1;
    return Math.min(1, (performance.now() - this.hold.t0) / 1000 / 0.6);
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Read this frame's input. Edge-triggered buttons are cleared after the first read. */
  consume(): FrameInput {
    let ix = 0;
    let iy = 0;
    if (this.down('KeyW', 'ArrowUp')) iy += 1;
    if (this.down('KeyS', 'ArrowDown')) iy -= 1;
    if (this.down('KeyD', 'ArrowRight')) ix += 1;
    if (this.down('KeyA', 'ArrowLeft')) ix -= 1;
    if (Math.hypot(this.padMove[0], this.padMove[1]) > Math.hypot(ix, iy)) [ix, iy] = this.padMove;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    let buttons = this.edges;
    if (this.down('ShiftLeft', 'ShiftRight') || this.padSprint) buttons |= BTN.Sprint;
    this.edges = 0;
    const t = this.pendingThrow;
    this.pendingThrow = null;
    return { ix, iy, buttons, throwTo: t?.icon ?? 0, throwKind: t?.kind ?? 0 };
  }

  reset() {
    this.keys.clear();
    this.edges = 0;
    this.hold = null;
    this.pendingThrow = null;
  }
}
