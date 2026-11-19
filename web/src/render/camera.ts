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

  /** Jump instantly on the next update (new game, big teleports). */
  cut() {
    this.snapNext = true;
  }

  /**
   * @param fx, fy focus point in core field coordinates
   * @param dir +1 if the offense attacks toward x = 120
   */
  update(dt: number, fx: number, fy: number, dir: number) {
    const p = CAMERA_PRESETS[this.preset];
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

    const z = this.zoom;
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
