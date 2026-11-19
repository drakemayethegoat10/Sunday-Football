// Classic three-press kick meter:
//   press 1 — power starts filling (and falls back if you wait too long)
//   press 2 — lock power; the accuracy needle sweeps across
//   press 3 — lock accuracy (center = straight; early = hook, late = slice)

export type MeterStage = 'idle' | 'power' | 'accuracy' | 'done';

export class KickMeter {
  stage: MeterStage = 'idle';
  power = 0;
  accuracy = -1;
  private t = 0;
  private el: HTMLElement;
  private fill: HTMLElement;
  private needle: HTMLElement;
  private label: HTMLElement;
  /** Seconds for the power bar to fill (difficulty scales this). */
  fillTime = 0.95;

  constructor(private onKick: (power: number, accuracy: number) => void) {
    this.el = document.getElementById('kick-meter')!;
    this.fill = this.el.querySelector('.km-fill') as HTMLElement;
    this.needle = this.el.querySelector('.km-needle') as HTMLElement;
    this.label = this.el.querySelector('.km-label') as HTMLElement;
  }

  reset() {
    this.stage = 'idle';
    this.power = 0;
    this.accuracy = -1;
    this.t = 0;
    this.render();
  }

  show(visible: boolean, title = '') {
    this.el.hidden = !visible;
    if (title) (this.el.querySelector('.km-title') as HTMLElement).textContent = title;
    if (!visible && this.stage !== 'done') this.reset();
  }

  /** Space / A. Returns true if the press was used. */
  press(): boolean {
    switch (this.stage) {
      case 'idle':
        this.stage = 'power';
        this.t = 0;
        break;
      case 'power':
        this.stage = 'accuracy';
        this.t = 0;
        break;
      case 'accuracy':
        this.finish();
        break;
      default:
        return false;
    }
    this.render();
    return true;
  }

  private finish() {
    this.stage = 'done';
    this.onKick(this.power, this.accuracy);
  }

  update(dt: number) {
    if (this.stage === 'power') {
      this.t += dt;
      const u = this.t / this.fillTime;
      // Rise to full, then fall back down if you wait.
      this.power = u <= 1 ? u : Math.max(0, 2 - u);
      if (u >= 2) {
        this.stage = 'accuracy';
        this.t = 0;
      }
    } else if (this.stage === 'accuracy') {
      this.t += dt;
      this.accuracy = -1 + (this.t / (this.fillTime * 0.9)) * 2;
      if (this.accuracy >= 1) {
        this.accuracy = 1;
        this.finish();
      }
    }
    this.render();
  }

  private render() {
    this.fill.style.width = `${Math.round(this.power * 100)}%`;
    this.needle.style.left = `${((this.accuracy + 1) / 2) * 100}%`;
    this.needle.style.visibility = this.stage === 'accuracy' || this.stage === 'done' ? 'visible' : 'hidden';
    this.label.textContent =
      this.stage === 'idle' ? 'PRESS SPACE / A TO START' : this.stage === 'power' ? 'SET POWER' : this.stage === 'accuracy' ? 'SET ACCURACY' : 'KICK!';
  }
}
