// Xbox-style controller support via the standard Gamepad API mapping
// (works for Xbox Series X|S and Xbox 360 pads in Chrome / ChromeOS).

export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  View: 8, Menu: 9, LS: 10, RS: 11, Up: 12, Down: 13, Left: 14, Right: 15,
} as const;

export interface PadState {
  connected: boolean;
  ix: number;
  iy: number;
  /** Buttons pressed this frame (edges). */
  pressed: Set<number>;
  /** Buttons released this frame (edges). */
  released: Set<number>;
  held: Set<number>;
  sprint: boolean;
  /** Menu navigation edges from the D-pad / left stick with key repeat. */
  nav: '' | 'up' | 'down' | 'left' | 'right';
  /** True if the pad was touched this frame. */
  active: boolean;
}

const DEADZONE = 0.22;

export class Gamepads {
  private prev = new Set<number>();
  private navDir = '';
  private navT = 0;

  poll(dt: number): PadState {
    const st: PadState = { connected: false, ix: 0, iy: 0, pressed: new Set(), released: new Set(), held: new Set(), sprint: false, nav: '', active: false };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads ?? []).find((p) => p && p.connected);
    if (!gp) {
      this.prev.clear();
      return st;
    }
    st.connected = true;
    gp.buttons.forEach((b, i) => {
      if (b.pressed || b.value > 0.5) st.held.add(i);
    });
    for (const b of st.held) if (!this.prev.has(b)) st.pressed.add(b);
    for (const b of this.prev) if (!st.held.has(b)) st.released.add(b);
    this.prev = new Set(st.held);

    let x = gp.axes[0] ?? 0;
    let y = -(gp.axes[1] ?? 0);
    const mag = Math.hypot(x, y);
    if (mag < DEADZONE) {
      x = 0;
      y = 0;
    } else {
      // Rescale so movement starts smoothly just past the deadzone.
      const k = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag;
      x *= k;
      y *= k;
    }
    if (st.held.has(PAD.Up)) y = 1;
    if (st.held.has(PAD.Down)) y = -1;
    if (st.held.has(PAD.Left)) x = -1;
    if (st.held.has(PAD.Right)) x = 1;
    st.ix = x;
    st.iy = y;
    st.sprint = (gp.buttons[PAD.RT]?.value ?? 0) > 0.25 || (gp.buttons[PAD.LT]?.value ?? 0) > 0.25;
    st.active = st.held.size > 0 || Math.hypot(x, y) > 0.3;

    // Menu navigation with repeat.
    const dir = Math.abs(x) > Math.abs(y) ? (x > 0.5 ? 'right' : x < -0.5 ? 'left' : '') : y > 0.5 ? 'up' : y < -0.5 ? 'down' : '';
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navT = 0.38;
      st.nav = dir as PadState['nav'];
    } else if (dir) {
      this.navT -= dt;
      if (this.navT <= 0) {
        this.navT = 0.12;
        st.nav = dir as PadState['nav'];
      }
    }
    return st;
  }
}
