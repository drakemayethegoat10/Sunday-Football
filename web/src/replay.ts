// Instant replay: records every simulation step of a play (player snapshot + ragdoll
// bodies) and plays the last completed play back with cinematic cameras.

export interface ReplayFrame {
  snap: Float32Array;
  rag: Float32Array;
}

export interface ReplayClip {
  frames: ReplayFrame[];
  lineup: string;
}

const MAX_FRAMES = 60 * 30;

export class Replay {
  private cur: ReplayFrame[] = [];
  private curLineup = '';
  last: ReplayClip | null = null;
  active = false;
  /** Playback position in frames. */
  t = 0;
  speed = 1;
  paused = false;
  cam = 0;
  time = 0;

  /** A new play is being lined up: keep the previous one if it was a real play. */
  begin(lineup: string) {
    if (this.cur.length > 45) this.last = { frames: this.cur, lineup: this.curLineup };
    this.cur = [];
    this.curLineup = lineup;
  }

  record(snap: Float32Array, rag: Float32Array) {
    if (this.cur.length < MAX_FRAMES) this.cur.push({ snap: snap.slice(), rag: rag.slice() });
  }

  get available(): boolean {
    return !!this.last && this.last.frames.length > 45;
  }

  enter(): boolean {
    if (!this.available) return false;
    this.active = true;
    this.t = 0;
    this.speed = 1;
    this.paused = false;
    this.time = 0;
    return true;
  }

  exit() {
    this.active = false;
  }

  get length(): number {
    return this.last?.frames.length ?? 0;
  }

  advance(dt: number) {
    this.time += dt;
    if (this.paused) return;
    this.t += dt * 60 * this.speed;
    if (this.t >= this.length - 1) {
      this.t = this.length - 1;
      this.paused = true;
    }
  }

  scrub(seconds: number) {
    this.t = Math.max(0, Math.min(this.length - 1, this.t + seconds * 60));
  }

  /** Frames around the playback position and the blend between them. */
  frames(): { a: ReplayFrame; b: ReplayFrame; alpha: number } | null {
    if (!this.last) return null;
    const f = this.last.frames;
    const i = Math.min(f.length - 1, Math.floor(this.t));
    const j = Math.min(f.length - 1, i + 1);
    return { a: f[i], b: f[j], alpha: this.t - i };
  }
}
