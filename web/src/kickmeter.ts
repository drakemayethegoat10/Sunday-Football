// Arc kick meter with an aim arrow on the field.
//
//   aim      — left / right (A/D, arrows or the left stick) swings the arrow on the field
//   press 1  — the marker sweeps up the arc: that's your power (the landing ring on the
//              field slides out with it)
//   press 2  — lock the power; the marker swings back down toward the start
//   press 3  — stop it inside the bright sweet spot near the start. Early = hooks left,
//              late = slices right. Miss it completely and the kick is shanked.

export type MeterStage = 'idle' | 'power' | 'accuracy' | 'done';

/** Where the sweet spot sits on the arc (0 = start, 1 = full power), and its half-width. */
const SWEET = 0.08;
const SWEET_HALF = 0.035;
/** How far below the start the marker can swing before the kick is shanked. */
const OVERSHOOT = 0.12;

export class KickMeter {
  stage: MeterStage = 'idle';
  power = 0;
  accuracy = 0;
  /** -1 (left) .. 1 (right) of the kick's natural line. */
  aim = 0;
  /** Marker position along the arc. */
  private u = 0;
  private resultT = 0;
  private result = '';
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private label: HTMLElement;
  private title: HTMLElement;
  private info: HTMLElement;
  /** Seconds for the marker to sweep the whole arc (difficulty scales this). */
  fillTime = 0.95;
  /** Show controller glyphs instead of keys. */
  pad = false;
  /** Yards to the landing spot at the current power (from the core's kick preview). */
  distance = 0;
  /** Field goals: would this power clear the crossbar on this line? */
  clears = true;
  isFieldGoal = false;

  constructor(private onKick: (power: number, accuracy: number, aim: number) => void) {
    this.el = document.getElementById('kick-meter')!;
    this.canvas = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.label = this.el.querySelector('.km-label') as HTMLElement;
    this.title = this.el.querySelector('.km-title') as HTMLElement;
    this.info = this.el.querySelector('.km-info') as HTMLElement;
  }

  reset() {
    this.stage = 'idle';
    this.power = 0;
    this.accuracy = 0;
    this.aim = 0;
    this.u = 0;
    this.result = '';
    this.resultT = 0;
    this.render();
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(visible: boolean, title = '') {
    this.el.hidden = !visible;
    if (title) this.title.textContent = title;
    if (!visible && this.stage !== 'done') this.reset();
  }

  /** Power to preview on the field: the live marker while choosing power, else the locked one. */
  previewPower(): number {
    if (this.stage === 'idle') return 1;
    if (this.stage === 'power') return this.u;
    return this.power;
  }

  /** Swing the aim arrow (only before the kick starts). */
  steer(dx: number, dt: number) {
    if (this.stage !== 'idle' || Math.abs(dx) < 0.2) return;
    this.aim = Math.max(-1, Math.min(1, this.aim + dx * dt * 0.9));
  }

  /** Space / A. Returns true if the press was used. */
  press(): boolean {
    switch (this.stage) {
      case 'idle':
        this.stage = 'power';
        this.u = 0;
        break;
      case 'power':
        this.power = this.u;
        this.stage = 'accuracy';
        break;
      case 'accuracy':
        this.finish(Math.max(-1, Math.min(1, (SWEET - this.u) / 0.16)));
        break;
      default:
        return false;
    }
    this.render();
    return true;
  }

  private finish(accuracy: number) {
    this.accuracy = accuracy;
    this.stage = 'done';
    const a = Math.abs(accuracy);
    this.result = a <= SWEET_HALF / 0.16 + 0.02 ? 'PERFECT!' : a < 0.5 ? 'GOOD' : accuracy < 0 ? 'HOOKED LEFT' : 'SLICED RIGHT';
    if (accuracy >= 1) this.result = 'SHANKED!';
    this.resultT = 0;
    this.onKick(this.power, this.accuracy, this.aim);
  }

  update(dt: number) {
    const rate = 1 / this.fillTime;
    if (this.stage === 'power') {
      this.u += dt * rate;
      if (this.u >= 1) {
        // Waited too long: full power, and the marker starts back down.
        this.u = 1;
        this.power = 1;
        this.stage = 'accuracy';
      }
    } else if (this.stage === 'accuracy') {
      this.u -= dt * rate * 1.15;
      if (this.u <= -OVERSHOOT) {
        this.u = -OVERSHOOT;
        this.finish(1);
      }
    } else if (this.stage === 'done') {
      this.resultT += dt;
    }
    this.render();
  }

  private render() {
    const k = (s: string, p: string) => (this.pad ? p : s);
    const yd = this.distance > 0 ? `${Math.round(this.distance)} YD` : '';
    switch (this.stage) {
      case 'idle':
        this.label.innerHTML = `<b>${k('◀ ▶', 'LS')}</b> AIM &nbsp;·&nbsp; <b>${k('SPACE', 'A')}</b> START`;
        break;
      case 'power':
        this.label.innerHTML = `<b>${k('SPACE', 'A')}</b> SET POWER`;
        break;
      case 'accuracy':
        this.label.innerHTML = `<b>${k('SPACE', 'A')}</b> IN THE SWEET SPOT`;
        break;
      case 'done':
        this.label.innerHTML = `<b class="${this.result === 'PERFECT!' || this.result === 'GOOD' ? 'good' : 'bad'}">${this.result}</b>`;
        break;
    }
    let info = this.stage === 'idle' ? `MAX ${yd}` : yd;
    if (this.isFieldGoal) info = this.clears ? (this.stage === 'idle' ? 'IN RANGE' : 'GOOD DISTANCE') : this.stage === 'idle' ? 'OUT OF RANGE' : 'SHORT';
    this.info.textContent = info;
    this.info.className = `km-info ${this.isFieldGoal && !this.clears ? 'bad' : ''}`;
    this.draw();
  }

  // ---------------------------------------------------------------- drawing

  private draw() {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H - 18;
    const R = Math.min(W / 2 - 22, H - 36);
    const at = (u: number) => Math.PI + u * Math.PI; // 0 = left end, 1 = right end
    const arc = (u0: number, u1: number, width: number, style: string | CanvasGradient) => {
      c.beginPath();
      c.arc(cx, cy, R, at(u0), at(u1));
      c.lineWidth = width;
      c.strokeStyle = style;
      c.stroke();
    };
    c.lineCap = 'butt';

    // Track with a white rim.
    arc(-OVERSHOOT, 1, 26, '#ffffff');
    arc(-OVERSHOOT, 1, 22, '#08101f');
    // Shank stub below the start.
    arc(-OVERSHOOT, 0, 22, '#5a1010');

    // Power fill (green → gold → red).
    const fillTo = this.stage === 'power' ? this.u : this.stage === 'idle' ? 0 : this.power;
    if (fillTo > 0) {
      const g = c.createLinearGradient(cx - R, 0, cx + R, 0);
      g.addColorStop(0, '#3ddc84');
      g.addColorStop(0.55, '#ffd84a');
      g.addColorStop(1, '#ff5a2a');
      arc(0, fillTo, 18, g);
    }
    // Ticks every 25%.
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 2;
    for (const u of [0.25, 0.5, 0.75]) {
      const a = at(u);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - 13), cy + Math.sin(a) * (R - 13));
      c.lineTo(cx + Math.cos(a) * (R + 13), cy + Math.sin(a) * (R + 13));
      c.stroke();
    }
    // Sweet spot.
    const glow = this.stage === 'accuracy' ? 0.75 + 0.25 * Math.sin(performance.now() / 70) : 0.85;
    arc(SWEET - SWEET_HALF, SWEET + SWEET_HALF, 26, `rgba(255,255,255,${glow})`);
    arc(SWEET - 0.004, SWEET + 0.004, 26, '#ffcc33');

    // Locked power mark.
    if (this.stage === 'accuracy' || this.stage === 'done') {
      const a = at(this.power);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16));
      c.lineTo(cx + Math.cos(a) * (R + 16), cy + Math.sin(a) * (R + 16));
      c.stroke();
    }

    // Marker.
    if (this.stage !== 'idle') {
      const u = this.stage === 'done' ? SWEET - this.accuracy * 0.16 : this.u;
      const a = at(u);
      const mx = cx + Math.cos(a) * R;
      const my = cy + Math.sin(a) * R;
      c.fillStyle = '#ffffff';
      c.shadowColor = '#ffffff';
      c.shadowBlur = 10;
      c.beginPath();
      c.arc(mx, my, 9, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#0b1a2e';
      c.lineWidth = 3;
      c.stroke();
    }

    // Button glyph at the start of the arc.
    const bx = cx - R;
    const by = cy + 2;
    c.fillStyle = this.pad ? '#2fb24a' : '#e8edf5';
    c.beginPath();
    if (this.pad) c.arc(bx, by, 12, 0, Math.PI * 2);
    else c.roundRect(bx - 20, by - 10, 40, 20, 4);
    c.fill();
    c.fillStyle = this.pad ? '#ffffff' : '#0b1a2e';
    c.font = `800 ${this.pad ? 15 : 11}px "Barlow Condensed", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(this.pad ? 'A' : 'SPACE', bx, by + 1);

    // Power readout in the middle.
    const pct = Math.round((this.stage === 'power' ? this.u : this.power) * 100);
    c.fillStyle = '#ffffff';
    c.font = 'italic 800 30px "Barlow Condensed", sans-serif';
    c.fillText(this.stage === 'idle' ? '—' : `${pct}%`, cx, cy - R * 0.38);
    c.fillStyle = '#a9bdd6';
    c.font = '700 12px "Barlow Condensed", sans-serif';
    c.fillText('POWER', cx, cy - R * 0.38 + 22);
  }
}
