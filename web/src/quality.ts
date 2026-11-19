// Graphics quality. The retro look comes partly from rendering at a low internal
// resolution and scaling up, which is also what keeps weak Chromebooks at 60 fps.

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualityMode = QualityLevel | 'auto';

const LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
/** Internal render height in pixels (null = native resolution). */
const HEIGHT: Record<QualityLevel, number | null> = { low: 360, medium: 540, high: 720, ultra: null };

export class Quality {
  mode: QualityMode = 'auto';
  level: QualityLevel = 'medium';
  private frames = 0;
  private time = 0;
  private settled = false;
  /** Highest level auto mode may try (lowered after a downgrade so it never oscillates). */
  private maxIdx = 2;

  constructor() {
    try {
      const m = localStorage.getItem('sf.quality') as QualityMode | null;
      if (m && (m === 'auto' || LEVELS.includes(m as QualityLevel))) this.setMode(m);
    } catch {
      /* ignore */
    }
  }

  setMode(m: QualityMode) {
    this.mode = m;
    this.level = m === 'auto' ? 'medium' : m;
    this.frames = 0;
    this.time = 0;
    this.settled = false;
    this.maxIdx = 2;
    try {
      localStorage.setItem('sf.quality', m);
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
    return this.mode === 'auto' ? `Auto (${this.level})` : this.level;
  }

  pixelRatio(): number {
    const h = HEIGHT[this.level];
    const dpr = window.devicePixelRatio || 1;
    return h ? Math.min(dpr, h / Math.max(1, window.innerHeight)) : dpr;
  }

  /** Feed frame times while playing. Returns true if the level changed (re-apply pixel ratio). */
  sample(dt: number): boolean {
    if (this.mode !== 'auto' || this.settled) return false;
    this.frames++;
    this.time += dt;
    if (this.time < 4) return false;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    const i = LEVELS.indexOf(this.level);
    if (fps < 45 && i > 0) {
      this.level = LEVELS[i - 1];
      this.maxIdx = i - 1;
      return true;
    }
    if (fps > 57 && i < this.maxIdx) {
      // Plenty of headroom: try one level up, and stop probing if that's too much.
      this.level = LEVELS[i + 1];
      return true;
    }
    this.settled = fps >= 45 || i === 0;
    return false;
  }
}
