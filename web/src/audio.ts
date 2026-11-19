// Synthesized sound effects (no audio files): crowd bed, whistle, hits, roars.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private excitement = 0;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('sf.muted') === '1';
    } catch {
      /* ignore */
    }
  }

  /** Must be called from a user gesture (click / key press). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    // White noise buffer shared by everything.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Crowd: looping band-passed noise.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    src.connect(bp).connect(lp).connect(this.crowdGain).connect(this.master);
    src.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    try {
      localStorage.setItem('sf.muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    return this.muted;
  }

  /** Call every frame: crowd swells after big moments and settles back down. */
  update(dt: number) {
    if (!this.crowdGain || !this.ctx) return;
    this.excitement = Math.max(0, this.excitement - dt * 0.35);
    this.crowdGain.gain.setTargetAtTime(0.05 + this.excitement * 0.22, this.ctx.currentTime, 0.15);
  }

  /** Current crowd excitement, 0 (calm) to ~1 (going wild). */
  get level(): number {
    return this.excitement;
  }

  roar(amount: number) {
    this.excitement = Math.min(1.2, this.excitement + amount);
  }

  private burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = 'lowpass') {
    if (!this.ctx || !this.noise || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slide = 1) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  whistle() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 2900;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 38;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(o.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
    g.gain.setValueAtTime(0.13, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.45);
    lfo.stop(t + 0.45);
  }

  hit(big: boolean) {
    this.burst(big ? 260 : 380, 0.8, big ? 0.32 : 0.18, big ? 0.9 : 0.5);
    this.tone(big ? 75 : 95, big ? 0.25 : 0.14, big ? 0.6 : 0.35, 'sine', 0.5);
  }

  snap() {
    this.burst(900, 2, 0.06, 0.25, 'bandpass');
  }

  catchBall() {
    this.tone(180, 0.08, 0.25, 'sine', 0.6);
  }

  throwBall() {
    this.burst(1800, 1.2, 0.12, 0.12, 'bandpass');
  }

  ui() {
    this.tone(660, 0.05, 0.08, 'square', 1.2);
  }
}
