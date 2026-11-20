// Broadcast-style camera that sits behind the offense, plus alternate presets.

import * as THREE from 'three';
import { FIELD_W } from '../types';

export const CAMERA_PRESETS = [
  { name: 'Broadcast', back: 14, height: 8.5, ahead: 8, side: 0 },
  { name: 'High', back: 21, height: 17, ahead: 7, side: 0 },
  { name: 'Close', back: 8.5, height: 4.2, ahead: 6, side: 0 },
  { name: 'Sideline', back: 0, height: 13, ahead: 0, side: 32 },
] as const;

function load(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : Number(v);
  } catch {
    return fallback;
  }
}
function save(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* storage unavailable (private window, managed device): ignore */
  }
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  preset = Math.min(CAMERA_PRESETS.length - 1, Math.max(0, load('sf.cam.preset', 0) | 0));
  zoom = Math.min(1.8, Math.max(0.6, load('sf.cam.zoom', 1)));
  private focus = new THREE.Vector3(35, 0, -FIELD_W / 2);
  private pos = new THREE.Vector3(20, 9, -FIELD_W / 2);
  private look = new THREE.Vector3(40, 0, -FIELD_W / 2);
  private angle = 0;
  private snapNext = true;
  private shakeAmt = 0;
  private shakeT = 0;
  private boost = 1;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.3, 700);
  }

  get presetName(): string {
    return CAMERA_PRESETS[this.preset].name;
  }

  cyclePreset() {
    this.preset = (this.preset + 1) % CAMERA_PRESETS.length;
    save('sf.cam.preset', this.preset);
  }

  zoomBy(f: number) {
    this.zoom = Math.min(1.8, Math.max(0.6, this.zoom * f));
    save('sf.cam.zoom', this.zoom);
  }

  /** Kick the camera on a big hit. */
  shake(amount: number) {
    this.shakeAmt = Math.min(0.6, this.shakeAmt + amount);
  }

  /** Jump instantly on the next update (new game, big teleports). */
  cut() {
    this.snapNext = true;
  }

  /**
   * @param fx, fy focus point in core field coordinates
   * @param dir +1 if the offense attacks toward x = 120
   */
  update(dt: number, fx: number, fy: number, dir: number, zoomBoost = 1) {
    const p = CAMERA_PRESETS[this.preset];
    this.boost += (zoomBoost - this.boost) * (1 - Math.exp(-dt * 1.8));
    const k = this.snapNext ? 1 : 1 - Math.exp(-dt * 3.2);
    const kPos = this.snapNext ? 1 : 1 - Math.exp(-dt * 2.6);

    // Swing around the side (not over the top) when possession changes.
    const target = dir > 0 ? 0 : Math.PI;
    let d = target - this.angle;
    if (Math.abs(d) > 1e-3) {
      const step = this.snapNext ? Math.abs(d) : Math.min(Math.abs(d), dt * 2.2);
      this.angle += Math.sign(d) * step;
    }
    const fwdX = Math.cos(this.angle);
    const fwdY = Math.sin(this.angle) * 0.3; // core y component (bias toward near sideline mid-swing)

    // Keep the view inside the stadium laterally.
    const fyClamped = Math.min(FIELD_W - 6, Math.max(6, fy));
    const focusY = fy * 0.75 + fyClamped * 0.25;
    this.focus.lerp(new THREE.Vector3(fx, 0, -focusY), k);

    const z = this.zoom * this.boost;
    const want = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
    if (p.side > 0) {
      want.set(this.focus.x - fwdX * 4, p.height * z, this.focus.z + p.side * z);
      lookAt.set(this.focus.x + fwdX * 3, 0, this.focus.z);
    } else {
      // Behind the offense: core "behind" = (-fwdX, -fwdY) -> three (x, -y).
      want.set(this.focus.x - fwdX * p.back * z, p.height * z, this.focus.z + fwdY * p.back * z);
      lookAt.set(this.focus.x + fwdX * p.ahead, 0, this.focus.z);
    }
    this.pos.lerp(want, kPos);
    this.look.lerp(lookAt, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.applyShake(dt);
    this.snapNext = false;
  }

  private applyShake(dt: number) {
    if (this.shakeAmt <= 0.001) return;
    this.shakeT += dt * 40;
    const a = this.shakeAmt;
    this.camera.position.x += Math.sin(this.shakeT * 1.3) * a * 0.35;
    this.camera.position.y += Math.sin(this.shakeT * 1.7 + 1) * a * 0.25;
    this.camera.rotateZ(Math.sin(this.shakeT * 1.1) * a * 0.02);
    this.shakeAmt *= Math.exp(-dt * 6);
  }

  /** Cinematic replay cameras around a focus point (three.js coordinates). */
  replay(dt: number, focus: THREE.Vector3, mode: number, t: number) {
    const k = 1 - Math.exp(-dt * 4);
    const want = new THREE.Vector3();
    switch (mode % 4) {
      case 0: { // slow orbit
        const a = t * 0.35;
        want.set(focus.x + Math.cos(a) * 9, 3.2, focus.z + Math.sin(a) * 9);
        break;
      }
      case 1: // low sideline
        want.set(focus.x - 4, 1.6, focus.z + 12);
        break;
      case 2: // end zone
        want.set(focus.x + 16, 4.5, focus.z + 1);
        break;
      default: // sky cam
        want.set(focus.x - 6, 18, focus.z + 6);
    }
    this.pos.lerp(want, this.snapNext ? 1 : k);
    this.look.lerp(focus.clone().setY(1.0), this.snapNext ? 1 : k * 1.5);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.applyShake(dt);
    this.snapNext = false;
  }

  /** Convert screen-relative stick input (ix right, iy up) into a core field vector. */
  screenToField(ix: number, iy: number): [number, number] {
    const f = new THREE.Vector3().subVectors(this.look, this.pos);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0);
    f.normalize();
    const rx = -f.z;
    const rz = f.x;
    const vx = f.x * iy + rx * ix;
    const vz = f.z * iy + rz * ix;
    return [vx, -vz];
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}
