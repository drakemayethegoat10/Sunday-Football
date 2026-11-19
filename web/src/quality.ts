// Graphics quality. The 3D scene renders at a fixed internal resolution (640x448 is the
// PS2 look) and is upscaled with bilinear filtering. Lower levels exist for weak
// Chromebooks; higher ones for the PC.

export type QualityLevel = 'low' | 'ps2' | 'high' | 'ultra';
export type QualityMode = QualityLevel | 'auto';

const LEVELS: QualityLevel[] = ['low', 'ps2', 'high', 'ultra'];
/** Internal render size (null = native resolution). */
const SIZE: Record<QualityLevel, [number, number] | null> = {
  low: [512, 358],
  ps2: [640, 448],
  high: [960, 672],
  ultra: null,
};
const LABEL: Record<QualityLevel, string> = {
  low: 'Low 512×358',
  ps2: 'PS2 640×448',
  high: 'High 960×672',
  ultra: 'Ultra (native)',
};

export class Quality {
  mode: QualityMode = 'auto';
  level: QualityLevel = 'ps2';
  private frames = 0;
  private time = 0;
  private settled = false;

  constructor() {
    try {
      const m = localStorage.getItem('sf.quality');
      if (m === 'auto' || LEVELS.includes(m as QualityLevel)) this.setMode(m as QualityMode);
    } catch {
      /* storage unavailable */
    }
  }

  setMode(m: QualityMode) {
    this.mode = LEVELS.includes(m as QualityLevel) || m === 'auto' ? m : 'auto';
    this.level = this.mode === 'auto' ? 'ps2' : (this.mode as QualityLevel);
    this.frames = 0;
    this.time = 0;
    this.settled = false;
    try {
      localStorage.setItem('sf.quality', this.mode);
    } catch {
      /* ignore */
    }
  }

  cycle(): QualityMode {
    const order: QualityMode[] = ['auto', ...LEVELS];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
    return this.mode;
  }

  get label(): string {
    return this.mode === 'auto' ? `Auto (${LABEL[this.level]})` : LABEL[this.level];
  }

  get internalSize(): [number, number] | null {
    return SIZE[this.level];
  }

  /** Canvas pixel ratio for the final upscale pass (cheap: one textured quad). */
  pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  /** Feed frame times while playing. Returns true if the level changed. */
  sample(dt: number): boolean {
    if (this.mode !== 'auto' || this.settled) return false;
    this.frames++;
    this.time += dt;
    if (this.time < 4) return false;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    if (fps < 45 && this.level !== 'low') {
      this.level = 'low';
      this.settled = true;
      return true;
    }
    this.settled = true;
    return false;
  }
}
