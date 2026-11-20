// On-field players (skinned low-poly athletes with procedural animation), sideline
// squads, the ball, grounded shadows and the user/receiver markers.

import * as THREE from 'three';
import { ANIM, FIELD_W, FLAG, LineupEntry, N, RAGDOLL_STRIDE, STRIDE, TeamInfo } from '../types';
import {
  BONE,
  HIPS_REST_Y,
  SKIN_TONES,
  UniformColors,
  buildBodyGeometry,
  buildHelmetGeometry,
  makeSkeleton,
  paintUniform,
} from './athlete';

const ICON_COLORS = ['#2f7bff', '#ff4040', '#2fcf5a', '#ffc400', '#b05cff'];

/** Horizontal direction (three.js x/z) that floodlight shadows fall toward. */
export const SHADOW_DIR = new THREE.Vector2(0.55, 0.835).normalize();

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function uniformFor(team: TeamInfo, home: boolean): UniformColors {
  const lightHelmet = luminance(team.primary) > 0.5;
  const mask = lightHelmet ? '#2b2f36' : '#c9ced4';
  if (home) {
    return {
      jersey: team.primary,
      trim: team.secondary,
      pants: luminance(team.secondary) > 0.55 ? team.secondary : '#e6e2d6',
      pantsStripe: team.primary,
      helmet: team.primary,
      stripe: team.secondary,
      mask,
      socks: team.primary,
      num: luminance(team.primary) > 0.55 ? '#141414' : '#ffffff',
      numOutline: team.secondary,
      glove: team.secondary,
    };
  }
  return {
    jersey: '#f1f0ea',
    trim: team.primary,
    pants: team.primary,
    pantsStripe: luminance(team.secondary) > 0.85 ? team.accent : team.secondary,
    helmet: team.primary,
    stripe: team.secondary,
    mask,
    socks: team.primary,
    num: team.primary,
    numOutline: luminance(team.secondary) > 0.85 ? '#1d1d1d' : team.secondary,
    glove: team.primary,
  };
}

function softTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.45, '#b3b3b3');
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

const PAD_LABELS = ['A', 'B', 'X', 'Y', 'RB'];
const PAD_COLORS = ['#2fbf4a', '#e0362f', '#2f7bff', '#f2c200', '#6b7380'];

function iconTexture(i: number, pad = false): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.beginPath();
  g.arc(32, 32, 27, 0, Math.PI * 2);
  g.fillStyle = pad ? PAD_COLORS[i - 1] : ICON_COLORS[i - 1];
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  const label = pad ? PAD_LABELS[i - 1] : String(i);
  g.font = `bold ${label.length > 1 ? 24 : 34}px Arial Black, Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 32, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let BODY_GEO: THREE.BufferGeometry | null = null;
function bodyGeo(): THREE.BufferGeometry {
  return (BODY_GEO ??= buildBodyGeometry());
}
const HELMET_MAT = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: new THREE.Color('#8a8a8a') });

const bodyMatCache = new Map<string, THREE.MeshLambertMaterial>();
function bodyMaterial(u: UniformColors, number: number, skin: number): THREE.MeshLambertMaterial {
  const key = `${u.jersey}|${u.pants}|${u.trim}|${number}|${skin}`;
  let m = bodyMatCache.get(key);
  if (!m) {
    const tex = new THREE.CanvasTexture(paintUniform(u, number, SKIN_TONES[skin % SKIN_TONES.length]));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    m = new THREE.MeshLambertMaterial({ map: tex });
    bodyMatCache.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// One animated player
// ---------------------------------------------------------------------------

type Pose = {
  hipsY: number; leanZ: number; leanX: number; bodyX: number; twist: number; headZ: number;
  legL: number; legR: number; kneeL: number; kneeR: number; legLx: number; legRx: number;
  armL: number; armR: number; armLx: number; armRx: number; elbL: number; elbR: number;
};

/** Default: an athletic ready stance with bent knees. */
const REST: Pose = {
  hipsY: 0.97, leanZ: -0.08, leanX: 0, bodyX: 0, twist: 0, headZ: 0,
  legL: 0.12, legR: 0.05, kneeL: -0.28, kneeR: -0.22, legLx: 0, legRx: 0,
  armL: 0.1, armR: 0.1, armLx: -0.2, armRx: 0.2, elbL: 0.45, elbR: 0.45,
};

// Core (z-up) -> three.js (y-up) rotation: q3 = C * q * C^-1, C = -90° about X.
const Q_C = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const Q_CI = Q_C.clone().invert();
const tmpQ = Array.from({ length: 11 }, () => new THREE.Quaternion());
const tmpInv = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
/** Ragdoll part order from the core (see physics.rs). */
const RP = { Pelvis: 0, Torso: 1, Head: 2, UpperArmL: 3, ForeArmL: 4, UpperArmR: 5, ForeArmR: 6, ThighL: 7, ShinL: 8, ThighR: 9, ShinR: 10 };

class Rig {
  root = new THREE.Group();
  bones: THREE.Bone[];
  body: THREE.SkinnedMesh;
  helmet: THREE.SkinnedMesh;
  pose: Pose = { ...REST };
  phase = Math.random() * 6;
  facing = 0;
  downSide = 1;
  build = 1;
  number = 0;
  ragdolled = false;
  private lastAnim = -1;
  private animT = 0;

  constructor(helmetGeo: THREE.BufferGeometry) {
    const { bones, skeleton } = makeSkeleton();
    this.bones = bones;
    this.body = new THREE.SkinnedMesh(bodyGeo(), new THREE.MeshLambertMaterial({ color: '#888888' }));
    this.body.add(bones[0]);
    this.body.bind(skeleton);
    this.helmet = new THREE.SkinnedMesh(helmetGeo, HELMET_MAT);
    this.helmet.bind(skeleton);
    this.body.frustumCulled = false;
    this.helmet.frustumCulled = false;
    this.root.add(this.body, this.helmet);
  }

  skin(u: UniformColors, helmetGeo: THREE.BufferGeometry, e: LineupEntry) {
    this.body.material = bodyMaterial(u, e.number, e.skin);
    this.helmet.geometry = helmetGeo;
    this.build = e.build;
    this.number = e.number;
    this.ragdolled = false;
    const sx = [0.93, 1.0, 1.13][e.build] ?? 1;
    const sz = [0.9, 1.0, 1.2][e.build] ?? 1;
    this.bones[BONE.root].scale.set(sx, 1, sz);
    this.downSide = e.number % 2 ? 1 : -1;
  }

  animate(dt: number, anim: number, speed: number, carrier: boolean, time: number, lateral: number, forward: number) {
    this.ragdolled = false;
    if (anim !== this.lastAnim) {
      this.lastAnim = anim;
      this.animT = 0;
    }
    this.animT += dt;
    const a = Math.min(1, Math.max(0.15, speed / 8.5));
    this.phase += dt * (2.2 + speed * 1.55);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const t: Pose = { ...REST };

    const run = (amp: number) => {
      t.legL = s * 0.95 * amp;
      t.legR = -s * 0.95 * amp;
      t.kneeL = -0.3 * amp - Math.max(0, -Math.sin(this.phase + 0.7)) * 1.35 * amp;
      t.kneeR = -0.3 * amp - Math.max(0, Math.sin(this.phase + 0.7)) * 1.35 * amp;
      t.armL = -s * 0.85 * amp;
      t.armR = s * 0.85 * amp;
      t.elbL = 1.25;
      t.elbR = 1.25;
      t.leanZ = -0.12 - 0.24 * amp;
      t.twist = s * 0.12 * amp;
      t.hipsY = 0.99 - 0.06 * amp + Math.abs(c) * 0.07 * amp;
      t.headZ = 0.12 * amp;
    };

    switch (anim) {
      case ANIM.Stance:
        if (this.build === 2) {
          // Three-point stance: hand down, flat back, knees bent.
          Object.assign(t, { hipsY: 0.72, leanZ: -1.05, legL: 0.85, legR: 0.3, kneeL: -1.55, kneeR: -1.2, armR: 1.2, elbR: 0.05, armL: 0.55, elbL: 0.7, headZ: 0.75 });
        } else {
          // Two-point athletic stance.
          Object.assign(t, { hipsY: 0.86, leanZ: -0.42, legL: 0.42, legR: 0.12, kneeL: -0.85, kneeR: -0.65, armL: 0.55, armR: 0.55, elbL: 0.7, elbR: 0.7, headZ: 0.3 });
        }
        break;
      case ANIM.Idle:
        t.hipsY = 0.96 + Math.sin(time * 2 + this.phase) * 0.008;
        break;
      case ANIM.Run:
      case ANIM.Juke:
      case ANIM.Spin:
        run(a);
        if (anim === ANIM.Run && speed > 1.2 && forward < -0.35 * speed) {
          // Backpedal: upright, short choppy steps, arms ready.
          Object.assign(t, { leanZ: 0.05, legL: -s * 0.55 * a, legR: s * 0.55 * a, armL: 0.5, armR: 0.5, elbL: 1.4, elbR: 1.4, hipsY: 0.93 });
        } else if (anim === ANIM.Run && speed > 1.2 && Math.abs(lateral) > 0.75 * speed) {
          // Side shuffle: legs open and close, hips low.
          const w = Math.abs(s) * 0.38;
          Object.assign(t, { leanZ: -0.15, legL: 0.15, legR: 0.15, legLx: -w, legRx: w, kneeL: -0.5, kneeR: -0.5, hipsY: 0.9, armL: 0.45, armR: 0.45, elbL: 1.0, elbR: 1.0 });
        }
        // Core "left" is three.js -Z, which is a negative roll about X.
        if (anim === ANIM.Juke) t.leanX = -Math.sign(lateral || 1) * 0.45;
        if (anim === ANIM.Spin) Object.assign(t, { armL: 0.4, armR: 0.4, elbL: 2.0, elbR: 2.0 });
        break;
      case ANIM.Block:
        run(0.35);
        this.phase += dt * 6;
        Object.assign(t, { leanZ: -0.55, hipsY: 0.86, armL: 1.45, armR: 1.45, elbL: 0.35, elbR: 0.35, armLx: 0.12, armRx: -0.12, headZ: 0.4 });
        break;
      case ANIM.Throw: {
        // Release then follow-through: the arm whips over the top and comes down across.
        const k = Math.min(1, this.animT / 0.35);
        Object.assign(t, {
          armR: 2.9 - k * 1.6, elbR: 0.35 + k * 0.4, armL: 1.0 - k * 0.6, elbL: 0.8,
          leanZ: -0.05 - k * 0.35, legL: 0.35, legR: -0.25 - k * 0.2, twist: -0.45 + k * 0.7,
        });
        break;
      }
      case ANIM.Catch:
        run(a * 0.6);
        Object.assign(t, { armL: 2.3, armR: 2.3, elbL: 0.5, elbR: 0.5, armLx: 0.25, armRx: -0.25, headZ: -0.2 });
        break;
      case ANIM.Dive:
        Object.assign(t, { leanZ: -1.4, hipsY: 0.6, armL: 3.0, armR: 3.0, elbL: 0.1, elbR: 0.1, legL: -0.35, legR: -0.5, kneeL: -0.2, kneeR: -0.2, bodyX: -0.4, headZ: -0.3 });
        break;
      case ANIM.Down:
        Object.assign(t, {
          leanZ: -1.52 * this.downSide, hipsY: 1.0, bodyX: -0.95 * this.downSide,
          armL: 2.6, armR: 2.2, elbL: 0.4, elbR: 0.9, legL: 0.15, legR: -0.1, kneeL: -0.3, kneeR: -0.6,
        });
        break;
      case ANIM.Stiff:
        run(a);
        Object.assign(t, { armL: 1.6, elbL: 0.0, armLx: 0.2 });
        break;
      case ANIM.Celebrate: {
        const j = Math.abs(Math.sin(time * 7 + this.phase));
        switch (this.number % 4) {
          case 0: // jump, both arms up
            Object.assign(t, { hipsY: 1.0 + j * 0.25, armL: 3.0, armR: 3.0, armLx: -0.35, armRx: 0.35, elbL: 0.2, elbR: 0.2, legL: j * 0.3, legR: -j * 0.2, kneeL: -j * 0.6, kneeR: -j * 0.5, headZ: -0.3 });
            break;
          case 1: // point to the sky
            Object.assign(t, { armL: 3.1, elbL: 0.0, armR: 0.3, elbR: 1.6, headZ: -0.5, hipsY: 0.98 + j * 0.05 });
            break;
          case 2: // flex
            Object.assign(t, { armL: 0.2, armR: 0.2, armLx: -1.5, armRx: 1.5, elbL: 2.3, elbR: 2.3, leanZ: 0.08, hipsY: 0.95 + j * 0.06 });
            break;
          default: { // high-knee dance
            const h = Math.sin(time * 9 + this.phase);
            Object.assign(t, { legL: Math.max(0, h) * 1.4, kneeL: -Math.max(0, h) * 1.8, legR: Math.max(0, -h) * 1.4, kneeR: -Math.max(0, -h) * 1.8, armL: 1.2 + h * 0.6, armR: 1.2 - h * 0.6, elbL: 1.2, elbR: 1.2, hipsY: 1.0 });
          }
        }
        break;
      }
      case ANIM.Wrap:
        // Wrapped up on the ball carrier: arms around him, driving the legs.
        run(0.4);
        Object.assign(t, { leanZ: -0.75, hipsY: 0.84, armL: 1.55, armR: 1.55, armLx: 0.55, armRx: -0.55, elbL: 1.1, elbR: 1.1, headZ: 0.5 });
        break;
      case ANIM.Hurdle:
        Object.assign(t, { legL: 1.45, kneeL: -2.1, legR: -0.5, kneeR: -0.7, armL: 1.3, armR: 0.8, elbL: 0.5, elbR: 1.8, leanZ: -0.3, hipsY: 1.0 });
        break;
      case ANIM.Truck:
        run(a);
        Object.assign(t, { leanZ: -0.8, leanX: 0.2, hipsY: 0.86, armL: 0.7, elbL: 1.9, armLx: -0.1, headZ: 0.6 });
        break;
      case ANIM.Stagger:
        run(a * 0.7);
        t.leanX = Math.sin(time * 13 + this.phase) * 0.28;
        t.leanZ = -0.42;
        t.armL = 1.6;
        t.armLx = -0.9;
        break;
    }

    if (carrier && anim !== ANIM.Down && anim !== ANIM.Throw && anim !== ANIM.Stiff && anim !== ANIM.Celebrate && anim !== ANIM.Hurdle) {
      t.armR = 0.7;
      t.elbR = 2.0;
      t.armRx = -0.2;
    }

    const k = 1 - Math.exp(-dt * (anim === ANIM.Down || anim === ANIM.Dive ? 9 : 16));
    const p = this.pose;
    for (const key of Object.keys(p) as (keyof Pose)[]) p[key] += (t[key] - p[key]) * k;

    const B = this.bones;
    B[BONE.root].rotation.set(p.leanX, 0, p.leanZ);
    B[BONE.root].position.set(p.bodyX, anim === ANIM.Down ? 0.15 : 0, 0);
    B[BONE.hips].position.y = HIPS_REST_Y + (p.hipsY - 1.0);
    B[BONE.spine].rotation.set(0, p.twist, 0);
    B[BONE.head].rotation.set(0, 0, p.headZ);
    B[BONE.hips].rotation.set(0, 0, 0);
    B[BONE.hips].position.set(0, HIPS_REST_Y + (p.hipsY - 1.0), 0);
    B[BONE.thL].rotation.set(p.legLx, 0, p.legL);
    B[BONE.thR].rotation.set(p.legRx, 0, p.legR);
    B[BONE.knL].rotation.z = p.kneeL;
    B[BONE.knR].rotation.z = p.kneeR;
    B[BONE.shL].rotation.set(p.armLx, 0, p.armL);
    B[BONE.shR].rotation.set(p.armRx, 0, p.armR);
    B[BONE.elL].rotation.z = p.elbL;
    B[BONE.elR].rotation.z = p.elbR;
  }

  /** Pose the skeleton straight from the physics ragdoll (parts in core coordinates). */
  applyRagdoll(buf: Float32Array, o: number) {
    this.ragdolled = true;
    this.lastAnim = ANIM.Ragdoll;
    for (let k = 0; k < 11; k++) {
      const b = o + 1 + k * 7;
      tmpQ[k].set(buf[b + 3], buf[b + 4], buf[b + 5], buf[b + 6]).premultiply(Q_C).multiply(Q_CI);
    }
    const pb = o + 1 + RP.Pelvis * 7;
    const B = this.bones;
    const qp = tmpQ[RP.Pelvis];
    // Root so that the hips bone sits exactly on the pelvis body.
    tmpV.set(0, HIPS_REST_Y, 0).applyQuaternion(qp);
    B[BONE.root].quaternion.copy(qp);
    B[BONE.root].position.set(buf[pb] - tmpV.x, buf[pb + 2] - tmpV.y, -buf[pb + 1] - tmpV.z);
    B[BONE.hips].quaternion.identity();
    B[BONE.hips].position.set(0, HIPS_REST_Y, 0);
    const local = (bone: number, parent: THREE.Quaternion, child: THREE.Quaternion) => {
      tmpInv.copy(parent).invert();
      B[bone].quaternion.copy(tmpInv.multiply(child));
    };
    // The skeleton's "L" bones sit on three.js +Z, which is the ragdoll's right side.
    local(BONE.spine, qp, tmpQ[RP.Torso]);
    local(BONE.head, tmpQ[RP.Torso], tmpQ[RP.Head]);
    local(BONE.shL, tmpQ[RP.Torso], tmpQ[RP.UpperArmR]);
    local(BONE.elL, tmpQ[RP.UpperArmR], tmpQ[RP.ForeArmR]);
    local(BONE.shR, tmpQ[RP.Torso], tmpQ[RP.UpperArmL]);
    local(BONE.elR, tmpQ[RP.UpperArmL], tmpQ[RP.ForeArmL]);
    local(BONE.thL, qp, tmpQ[RP.ThighR]);
    local(BONE.knL, tmpQ[RP.ThighR], tmpQ[RP.ShinR]);
    local(BONE.thR, qp, tmpQ[RP.ThighL]);
    local(BONE.knR, tmpQ[RP.ThighL], tmpQ[RP.ShinL]);
  }
}

// ---------------------------------------------------------------------------
// Everything player-related in the scene
// ---------------------------------------------------------------------------

function lerpAngle(a: number, b: number, t: number): number {
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : 0;
  if (!Number.isFinite(b)) return a;
  const TAU = Math.PI * 2;
  const d = ((((b - a) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  return a + d * t;
}

interface Squad {
  bodies: THREE.InstancedMesh;
  helmets: THREE.InstancedMesh;
  spots: { x: number; z: number; rot: number; phase: number }[];
}

export class Players {
  readonly group = new THREE.Group();
  private rigs: Rig[] = [];
  private icons: THREE.Sprite[] = [];
  private iconMats: THREE.SpriteMaterial[] = [];
  private iconMatsPad: THREE.SpriteMaterial[] = [];
  /** Show controller button labels (A/B/X/Y/RB) instead of numbers on receivers. */
  padIcons = false;
  private ring: THREE.Mesh;
  private ball: THREE.Group;
  private ballShadow: THREE.Mesh;
  private ao: THREE.InstancedMesh;
  private cast: THREE.InstancedMesh;
  private uniforms: [UniformColors, UniformColors];
  private helmets: [THREE.BufferGeometry, THREE.BufferGeometry];
  private squads: Squad[] = [];
  private dummy = new THREE.Object3D();
  private ballSpin = 0;
  userIndex = -1;
  ballPos = new THREE.Vector3();
  /** 0–1: makes the sideline squads bounce after big plays. */
  excitement = 0;

  constructor(scene: THREE.Scene, home: TeamInfo, away: TeamInfo) {
    this.uniforms = [uniformFor(home, true), uniformFor(away, false)];
    this.helmets = [
      buildHelmetGeometry(this.uniforms[0].helmet, this.uniforms[0].stripe, this.uniforms[0].mask),
      buildHelmetGeometry(this.uniforms[1].helmet, this.uniforms[1].stripe, this.uniforms[1].mask),
    ];
    for (let i = 0; i < N; i++) {
      const r = new Rig(this.helmets[0]);
      this.rigs.push(r);
      this.group.add(r.root);
    }

    // Grounded shadows: a soft AO blob under each player plus a stretched floodlight shadow.
    const soft = softTexture();
    this.ao = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1.25, 1.25).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: soft, transparent: true, opacity: 0.6, depthWrite: false }),
      N,
    );
    this.cast = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: soft, transparent: true, opacity: 0.42, depthWrite: false }),
      N,
    );
    for (const m of [this.ao, this.cast]) {
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.group.add(m);
    }

    for (let i = 1; i <= 5; i++) {
      this.iconMats.push(new THREE.SpriteMaterial({ map: iconTexture(i), depthTest: false }));
      this.iconMatsPad.push(new THREE.SpriteMaterial({ map: iconTexture(i, true), depthTest: false }));
    }
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(this.iconMats[0]);
      s.scale.set(0.95, 0.95, 1);
      s.visible = false;
      s.renderOrder = 10;
      this.icons.push(s);
      this.group.add(s);
    }
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.78, 24),
      new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 3;
    this.group.add(this.ring);

    // Ball: glossy leather spheroid with laces.
    this.ball = new THREE.Group();
    const leather = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 8),
      new THREE.MeshPhongMaterial({ color: '#7a3b18', shininess: 40, specular: new THREE.Color('#5a4030') }),
    );
    leather.scale.set(1.65, 1, 1);
    const laces = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.025), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    laces.position.y = 0.11;
    this.ball.add(leather, laces);
    this.group.add(this.ball);
    this.ballShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.45).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: soft, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.ballShadow.position.y = 0.02;
    this.group.add(this.ballShadow);

    this.buildSidelines();
    scene.add(this.group);
  }

  /** Each team's reserves standing on its own sideline in warm-up jackets. */
  private buildSidelines() {
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const team of [0, 1]) {
      const u = this.uniforms[team];
      const jacket: UniformColors = { ...u, jersey: team === 0 ? u.jersey : u.trim, trim: team === 0 ? u.trim : '#f1f0ea' };
      const count = 16;
      const tex = new THREE.CanvasTexture(paintUniform(jacket, -1, SKIN_TONES[2]));
      tex.colorSpace = THREE.SRGBColorSpace;
      const bodies = new THREE.InstancedMesh(bodyGeo(), new THREE.MeshLambertMaterial({ map: tex }), count);
      const helmets = new THREE.InstancedMesh(this.helmets[team], HELMET_MAT, count);
      const spots: Squad['spots'] = [];
      for (let i = 0; i < count; i++) {
        const x = 38 + (i / (count - 1)) * 44 + (rnd() - 0.5) * 1.6;
        const coreY = team === 0 ? -5.2 - rnd() * 2.2 : FIELD_W + 5.2 + rnd() * 2.2;
        const facing = team === 0 ? Math.PI / 2 : -Math.PI / 2;
        spots.push({ x, z: -coreY, rot: facing + (rnd() - 0.5) * 0.9, phase: rnd() * 6 });
      }
      for (const m of [bodies, helmets]) {
        m.frustumCulled = false;
        this.group.add(m);
      }
      this.squads.push({ bodies, helmets, spots });
    }
  }

  setLineup(lineup: LineupEntry[]) {
    lineup.forEach((e, i) => {
      const t = e.team === 1 ? 1 : 0;
      this.rigs[i]?.skin(this.uniforms[t], this.helmets[t], e);
    });
  }

  update(prev: Float32Array, cur: Float32Array, alpha: number, dt: number, time: number, rag?: Float32Array) {
    this.userIndex = -1;
    const d = this.dummy;
    // Which actors are ragdolls this frame (actor index -> buffer offset).
    const ragAt = new Map<number, number>();
    if (rag) for (let o = 0; o + RAGDOLL_STRIDE <= rag.length; o += RAGDOLL_STRIDE) ragAt.set(rag[o], o);
    for (let i = 0; i < N; i++) {
      const o = i * STRIDE;
      const x = prev[o] + (cur[o] - prev[o]) * alpha;
      const y = prev[o + 1] + (cur[o + 1] - prev[o + 1]) * alpha;
      const z = prev[o + 2] + (cur[o + 2] - prev[o + 2]) * alpha;
      const facing = lerpAngle(prev[o + 3], cur[o + 3], alpha);
      const anim = cur[o + 4];
      const speed = cur[o + 5];
      const flags = cur[o + 6];
      const icon = cur[o + 7];
      const rig = this.rigs[i];
      const ro = ragAt.get(i);
      if (ro !== undefined && rag) {
        rig.root.position.set(0, 0, 0);
        rig.root.rotation.set(0, 0, 0);
        rig.applyRagdoll(rag, ro);
      } else {
        rig.root.position.set(x, z, -y);
        rig.facing = lerpAngle(rig.facing, facing, 1 - Math.exp(-dt * 20));
        rig.root.rotation.y = rig.facing;
        // Velocity relative to facing (per sim step -> yards/second).
        const vx = (cur[o] - prev[o]) * 60;
        const vy = (cur[o + 1] - prev[o + 1]) * 60;
        const lateral = -Math.sin(facing) * vx + Math.cos(facing) * vy;
        const forward = Math.cos(facing) * vx + Math.sin(facing) * vy;
        rig.animate(dt, anim, speed, (flags & FLAG.Carrier) !== 0, time, lateral, forward);
      }

      // AO blob centered on the body (longer when lying down).
      const down = anim === ANIM.Down || anim === ANIM.Dive;
      d.position.set(x, 0.021, -y);
      d.rotation.set(0, rig.facing, 0);
      d.scale.set(down ? 2.0 : 1, 1, down ? 0.9 : 1);
      d.updateMatrix();
      this.ao.setMatrixAt(i, d.matrix);
      // Floodlight shadow stretched away from the key light.
      const len = down ? 1.6 : 2.3;
      d.position.set(x + SHADOW_DIR.x * len * 0.42, 0.02, -y + SHADOW_DIR.y * len * 0.42);
      d.rotation.set(0, -Math.atan2(SHADOW_DIR.y, SHADOW_DIR.x), 0);
      d.scale.set(len, 1, 0.8);
      d.updateMatrix();
      this.cast.setMatrixAt(i, d.matrix);

      const ic = this.icons[i];
      if (icon > 0) {
        ic.visible = true;
        ic.material = (this.padIcons ? this.iconMatsPad : this.iconMats)[icon - 1];
        ic.position.set(x, 2.85, -y);
      } else {
        ic.visible = false;
      }
      if (flags & FLAG.User) {
        this.userIndex = i;
        this.ring.position.set(x, 0.04, -y);
        const pulse = 1 + Math.sin(time * 8) * 0.08;
        this.ring.scale.set(pulse, pulse, pulse);
      }
    }
    this.ao.instanceMatrix.needsUpdate = true;
    this.cast.instanceMatrix.needsUpdate = true;
    this.ring.visible = this.userIndex >= 0;

    // Sideline squads sway, and bounce when the crowd is excited.
    for (const sq of this.squads) {
      sq.spots.forEach((s, i) => {
        const bounce = this.excitement > 0.25 ? Math.abs(Math.sin(time * 6 + s.phase)) * 0.12 * this.excitement : 0;
        d.position.set(s.x, bounce, s.z);
        d.rotation.set(0, s.rot + Math.sin(time * 0.6 + s.phase) * 0.15, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        sq.bodies.setMatrixAt(i, d.matrix);
        sq.helmets.setMatrixAt(i, d.matrix);
      });
      sq.bodies.instanceMatrix.needsUpdate = true;
      sq.helmets.instanceMatrix.needsUpdate = true;
    }

    // Ball.
    const b = N * STRIDE;
    const bx = prev[b] + (cur[b] - prev[b]) * alpha;
    const by = prev[b + 1] + (cur[b + 1] - prev[b + 1]) * alpha;
    const bz = prev[b + 2] + (cur[b + 2] - prev[b + 2]) * alpha;
    const state = cur[b + 3];
    const holder = cur[b + 4];
    this.ball.position.set(bx, Math.max(0.1, bz), -by);
    this.ballPos.copy(this.ball.position);
    if (state === 2) {
      const vx = cur[b + 5];
      const vy = cur[b + 6];
      this.ball.rotation.set(0, Math.atan2(vy, vx), 0);
      this.ballSpin += dt * 30;
      this.ball.rotateX(this.ballSpin);
    } else if (state === 1 && holder >= 0) {
      this.ball.rotation.set(0, this.rigs[holder].facing + 0.4, -0.3);
    } else {
      this.ball.rotation.set(0, 0, 0);
    }
    this.ballShadow.position.set(bx, 0.02, -by);
    this.ballShadow.visible = bz > 0.4;
  }

  /** Receiver icon (1–5) nearest a ground point in core coordinates, or 0. */
  iconNear(cur: Float32Array, px: number, py: number, maxDist = 4.5): number {
    let best = 0;
    let bestD = maxDist;
    for (let i = 0; i < N; i++) {
      const o = i * STRIDE;
      const icon = cur[o + 7];
      if (icon <= 0) continue;
      const dd = Math.hypot(cur[o] - px, cur[o + 1] - py);
      if (dd < bestD) {
        bestD = dd;
        best = icon;
      }
    }
    return best;
  }
}
