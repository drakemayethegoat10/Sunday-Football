// On-field guides drawn on the turf:
//  * KickAim: the kick's aim arrow (a flowing chevron strip) and a ring where it lands.
//  * TargetMarker: where a thrown pass (gold) or a kick (cyan) is coming down, with a
//    dotted line along the rest of the ball's flight. It tightens as the ball arrives.
// Core coordinates (x, y) map to three.js (x, -y) on the ground.

import * as THREE from 'three';

const GRAVITY = 10.72;
/** Height the ball is caught at (matches the core's arrival heights). */
const CATCH_Z = 1.45;

function chevronTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, 64, 64);
  // One chevron pointing along +u (the strip's length).
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.moveTo(14, 6);
  c.lineTo(40, 32);
  c.lineTo(14, 58);
  c.lineTo(26, 58);
  c.lineTo(52, 32);
  c.lineTo(26, 6);
  c.closePath();
  c.fill();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flat(geo: THREE.BufferGeometry, color: string, opacity: number, order: number): THREE.Mesh {
  const m = new THREE.Mesh(
    geo.rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false }),
  );
  m.renderOrder = order;
  return m;
}

export class KickAim {
  readonly group = new THREE.Group();
  private strip: THREE.Mesh;
  private stripTex: THREE.CanvasTexture;
  private ring: THREE.Group;
  private ringColor: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.stripTex = chevronTexture();
    const mat = new THREE.MeshBasicMaterial({ map: this.stripTex, color: '#7dffb0', transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
    // Unit strip along +x from the origin; scaled to the kick's length.
    const geo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
    this.strip = new THREE.Mesh(geo, mat);
    this.strip.renderOrder = 6;
    this.ring = new THREE.Group();
    const outline = flat(new THREE.RingGeometry(1.7, 2.45, 48), '#000000', 0.45, 6);
    const ring = flat(new THREE.RingGeometry(1.8, 2.3, 48), '#7dffb0', 0.95, 7);
    this.ringColor = ring.material as THREE.MeshBasicMaterial;
    const dot = flat(new THREE.CircleGeometry(0.45, 20), '#ffffff', 0.9, 7);
    this.ring.add(outline, ring, dot);
    this.group.add(this.strip, this.ring);
    this.group.visible = false;
    scene.add(this.group);
  }

  hide() {
    this.group.visible = false;
  }

  /**
   * Draw the arrow from the kick spot to the landing spot. `showLanding`: show the ring
   * (once power is being chosen). `good`: green, otherwise red (field goal short / wide).
   */
  show(ox: number, oy: number, lx: number, ly: number, showLanding: boolean, good: boolean, time: number) {
    this.group.visible = true;
    const dx = lx - ox;
    const dy = ly - oy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const color = good ? '#7dffb0' : '#ff5a4a';
    this.strip.position.set(ox, 0.05, -oy);
    this.strip.rotation.set(0, Math.atan2(dy, dx), 0);
    this.strip.scale.set(len, 1, 1.6);
    this.stripTex.repeat.set(len / 2.6, 1);
    this.stripTex.offset.x = -time * 1.6;
    (this.strip.material as THREE.MeshBasicMaterial).color.set(color);
    (this.strip.material as THREE.MeshBasicMaterial).opacity = showLanding ? 1 : 0.8;
    this.ring.visible = showLanding;
    this.ring.position.set(lx, 0.06, -ly);
    const pulse = 1 + Math.sin(time * 7) * 0.06;
    this.ring.scale.set(pulse, 1, pulse);
    this.ringColor.color.set(color);
  }
}

export class TargetMarker {
  readonly group = new THREE.Group();
  private reticle: THREE.Group;
  private ringMat: THREE.MeshBasicMaterial;
  private dotMat: THREE.MeshBasicMaterial;
  private dots: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private static readonly DOTS = 18;

  constructor(scene: THREE.Scene) {
    this.reticle = new THREE.Group();
    // Dark outline first so the marker stands out on green turf and white paint alike.
    const outline = flat(new THREE.RingGeometry(0.78, 1.22, 40), '#000000', 0.5, 8);
    const ring = flat(new THREE.RingGeometry(0.85, 1.1, 40), '#ffe14a', 1, 9);
    this.ringMat = ring.material as THREE.MeshBasicMaterial;
    const dot = flat(new THREE.CircleGeometry(0.22, 20), '#ffe14a', 1, 9);
    this.dotMat = dot.material as THREE.MeshBasicMaterial;
    this.reticle.add(outline, ring, dot);
    // Crosshair ticks.
    for (let i = 0; i < 4; i++) {
      const tick = flat(new THREE.PlaneGeometry(0.42, 0.12).translate(1.38, 0, 0), '#ffe14a', 1, 9);
      tick.material = this.ringMat;
      tick.rotation.y = (i * Math.PI) / 2;
      this.reticle.add(tick);
    }
    this.dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 6, 4),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
      TargetMarker.DOTS,
    );
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 9;
    this.group.add(this.reticle, this.dots);
    this.group.visible = false;
    scene.add(this.group);
  }

  /**
   * Update from the snapshot's ball block. `kind`: 0 none, 1 pass, 2 kick.
   * (bx, by, bz): ball now; (tx, ty): where it comes down; `tleft`: seconds until then.
   */
  update(kind: number, bx: number, by: number, bz: number, tx: number, ty: number, tleft: number, time: number) {
    if (kind <= 0 || !Number.isFinite(tx) || !Number.isFinite(ty)) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const color = kind === 1 ? '#ffe14a' : '#5fe8ff';
    this.ringMat.color.set(color);
    this.dotMat.color.set(color);
    // Big while the ball is far off, tightening as it arrives.
    const s = (1 + Math.min(tleft, 2) * 0.35) * (1 + Math.sin(time * 10) * 0.05);
    this.reticle.position.set(tx, 0.06, -ty);
    this.reticle.scale.set(s, 1, s);
    this.reticle.rotation.y = time * 0.8;

    // Dotted flight path for the rest of the ball's trip.
    const T = Math.max(tleft, 0.001);
    const vz = (CATCH_Z - bz + 0.5 * GRAVITY * T * T) / T;
    const d = this.dummy;
    for (let i = 0; i < TargetMarker.DOTS; i++) {
      const f = (i + 1) / (TargetMarker.DOTS + 1);
      const t = f * T;
      const x = bx + (tx - bx) * f;
      const y = by + (ty - by) * f;
      const z = bz + vz * t - 0.5 * GRAVITY * t * t;
      d.position.set(x, Math.max(0.1, z), -y);
      const visible = tleft > 0.05;
      d.scale.setScalar(visible ? 1 : 0);
      d.updateMatrix();
      this.dots.setMatrixAt(i, d.matrix);
    }
    this.dots.instanceMatrix.needsUpdate = true;
  }

  hide() {
    this.group.visible = false;
  }
}
