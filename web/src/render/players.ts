// On-field players (skinned low-poly athletes with procedural animation), sideline
// squads, the ball, grounded shadows and the user/receiver markers.

import * as THREE from 'three';
import { ANIM, FIELD_W, FLAG, LineupEntry, N, RAGDOLL_STRIDE, STRIDE, TeamInfo } from '../types';
import { AnimCtx, POSE_KEYS, Pose, restPose, targetPose } from './anim';
import {
  BONE,
  Gear,
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

const BODY_GEO = new Map<string, THREE.BufferGeometry>();
/** Body mesh with a player's gear; `detail` < 1 for the sideline squads. */
function bodyGeo(gear: Gear = 0, detail = 1): THREE.BufferGeometry {
  const key = `${gear}|${detail}`;
  let g = BODY_GEO.get(key);
  if (!g) {
    g = buildBodyGeometry(gear, detail);
    BODY_GEO.set(key, g);
  }
  return g;
}
function gearFor(pos: string): Gear {
  if (pos === 'OL' || pos === 'DL') return 2;
  if (pos === 'QB' || pos === 'RB' || pos === 'WR') return 1;
  return 0;
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

// Core (z-up) -> three.js (y-up) rotation: q3 = C * q * C^-1, C = -90° about X.
const Q_C = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const Q_CI = Q_C.clone().invert();
const tmpQ = Array.from({ length: 11 }, () => new THREE.Quaternion());
const tmpInv = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const WHITE = new THREE.Color('#ffffff');
/** The ball's long axis (x) laid along a forearm bone (y). */
const BALL_ALONG_FOREARM = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
/** Ragdoll part order from the core (see physics.rs). */
const RP = { Pelvis: 0, Torso: 1, Head: 2, UpperArmL: 3, ForeArmL: 4, UpperArmR: 5, ForeArmR: 6, ThighL: 7, ShinL: 8, ThighR: 9, ShinR: 10 };
const SPIN_TIME = 0.5;

/** Per-frame facts about one player, gathered by `Players.update` for the rig. */
export type RigInput = Omit<AnimCtx, 'animT' | 'phase' | 'getUp' | 'downSide' | 'cutSide' | 'carryLeft' | 'pos' | 'build' | 'number'>;

class Rig {
  root = new THREE.Group();
  bones: THREE.Bone[];
  body: THREE.SkinnedMesh;
  helmet: THREE.SkinnedMesh;
  pose: Pose = restPose();
  /** Stride phase: one step per pi, advanced by distance covered. */
  phase = Math.random() * 6;
  facing = 0;
  downSide = 1;
  build = 1;
  number = 0;
  pos = '';
  /** Radius of this player's puck (his true body on the turf), in yards. */
  radius = 0.35;
  ragdolled = false;
  /** Velocity last frame and smoothed acceleration (forward, left) of the puck. */
  lastV = new THREE.Vector2();
  accel = new THREE.Vector2();
  /** Ball in the left arm (the one nearer the sideline he's running along). */
  carryLeft = false;
  private carrySwitch = 0;
  private wasCarrier = false;
  private lastAnim = -1;
  private animT = 0;
  private getUp = -1;
  private cutSide = 1;
  private spinDir = 1;

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
    this.body.geometry = bodyGeo(gearFor(e.pos));
    this.body.material = bodyMaterial(u, e.number, e.skin);
    this.helmet.geometry = helmetGeo;
    this.build = e.build;
    this.number = e.number;
    this.pos = e.pos;
    this.radius = e.radius ?? 0.35;
    this.ragdolled = false;
    this.carryLeft = false;
    const sx = [0.93, 1.0, 1.13][e.build] ?? 1;
    const sz = [0.9, 1.0, 1.2][e.build] ?? 1;
    this.bones[BONE.root].scale.set(sx, 1, sz);
    this.downSide = e.number % 2 ? 1 : -1;
  }

  /**
   * Keep the ball in the arm nearer the sideline the carrier is running along, so it's
   * away from the pursuit in the middle of the field. Hysteresis stops it flip-flopping.
   */
  updateCarryArm(dt: number, carrier: boolean, y: number, facing: number) {
    this.carrySwitch = Math.max(0, this.carrySwitch - dt);
    if (!carrier) {
      this.wasCarrier = false;
      return;
    }
    // His left in core coordinates is (-sin f, cos f); toward the y = 0 sideline when cos f < 0.
    const c = Math.cos(facing);
    let want = this.carryLeft;
    if (y < FIELD_W / 2 - 4 && Math.abs(c) > 0.3) want = c < 0;
    else if (y > FIELD_W / 2 + 4 && Math.abs(c) > 0.3) want = c > 0;
    if (!this.wasCarrier) {
      this.carryLeft = want;
      this.wasCarrier = true;
    } else if (want !== this.carryLeft && this.carrySwitch <= 0) {
      this.carryLeft = want;
      this.carrySwitch = 1.2;
    }
  }

  /** Pose the body on top of its puck: the body follows the puck, never the other way. */
  animate(dt: number, input: RigInput) {
    this.ragdolled = false;
    const anim = input.anim;
    if (anim !== this.lastAnim) {
      const wasDown = this.lastAnim === ANIM.Down || this.lastAnim === ANIM.Dive || this.lastAnim === ANIM.Ragdoll;
      const upright = anim !== ANIM.Down && anim !== ANIM.Dive && anim !== ANIM.Ragdoll;
      this.getUp = wasDown && upright && input.speed < 3.5 && this.lastAnim !== -1 ? 0 : -1;
      if (anim === ANIM.Juke) this.cutSide = Math.sign(this.accel.y || input.lat || 1);
      if (anim === ANIM.Spin) this.spinDir = Math.sign(input.lat || -this.accel.y || 1);
      this.lastAnim = anim;
      this.animT = 0;
    }
    this.animT += dt;
    if (this.getUp >= 0) {
      this.getUp += dt;
      if (this.getUp > 0.7) this.getUp = -1;
    }
    // Stride phase from distance covered, so planted feet keep pace with the puck.
    if (input.speed > 0.35) this.phase += Math.PI * (1.6 + 0.35 * input.speed) * dt;

    const t = targetPose({
      ...input,
      animT: this.animT,
      phase: this.phase,
      getUp: this.getUp,
      downSide: this.downSide,
      cutSide: this.cutSide,
      carryLeft: this.carryLeft,
      pos: this.pos,
      build: this.build,
      number: this.number,
    });

    const moving = anim === ANIM.Run || anim === ANIM.Juke || anim === ANIM.Spin || anim === ANIM.Stiff || anim === ANIM.Truck || anim === ANIM.Wrap;
    const rate = anim === ANIM.Down || anim === ANIM.Dive ? 9 : anim === ANIM.Throw ? 24 : moving ? 26 : 14;
    const k = 1 - Math.exp(-dt * rate);
    const p = this.pose;
    for (const key of POSE_KEYS) p[key] += (t[key] - p[key]) * k;

    const B = this.bones;
    const spin = anim === ANIM.Spin ? this.spinDir * Math.PI * 2 * Math.min(1, this.animT / SPIN_TIME) : 0;
    B[BONE.root].rotation.set(p.leanX, spin, p.leanZ);
    B[BONE.root].position.set(p.bodyX, p.drop, 0);
    B[BONE.hips].position.set(0, HIPS_REST_Y + (p.hipsY - 1.0), 0);
    B[BONE.hips].rotation.set(0, p.hipYaw, p.hipZ);
    B[BONE.spine].rotation.set(0, p.twist, p.spineZ);
    B[BONE.chest].rotation.set(0, p.chestTwist, p.chestZ);
    B[BONE.head].rotation.set(0, p.headY, p.headZ);
    B[BONE.thL].rotation.set(p.legLx, 0, p.legL);
    B[BONE.thR].rotation.set(p.legRx, 0, p.legR);
    B[BONE.knL].rotation.set(0, 0, p.kneeL);
    B[BONE.knR].rotation.set(0, 0, p.kneeR);
    B[BONE.footL].rotation.set(0, 0, p.footL);
    B[BONE.footR].rotation.set(0, 0, p.footR);
    B[BONE.shL].rotation.set(p.armLx, p.armLy, p.armL);
    B[BONE.shR].rotation.set(p.armRx, p.armRy, p.armR);
    B[BONE.elL].rotation.set(0, 0, p.elbL);
    B[BONE.elR].rotation.set(0, 0, p.elbR);
    B[BONE.handL].rotation.set(0, 0, p.handL);
    B[BONE.handR].rotation.set(0, 0, p.handR);
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
    // Bones the ragdoll doesn't have stay straight.
    for (const b of [BONE.chest, BONE.footL, BONE.footR, BONE.handL, BONE.handR]) B[b].quaternion.identity();
    const local = (bone: number, parent: THREE.Quaternion, child: THREE.Quaternion) => {
      tmpInv.copy(parent).invert();
      B[bone].quaternion.copy(tmpInv.multiply(child));
    };
    // Skeleton "L" bones are on the player's left (three.js -Z), like the ragdoll's.
    local(BONE.spine, qp, tmpQ[RP.Torso]);
    local(BONE.head, tmpQ[RP.Torso], tmpQ[RP.Head]);
    local(BONE.shL, tmpQ[RP.Torso], tmpQ[RP.UpperArmL]);
    local(BONE.elL, tmpQ[RP.UpperArmL], tmpQ[RP.ForeArmL]);
    local(BONE.shR, tmpQ[RP.Torso], tmpQ[RP.UpperArmR]);
    local(BONE.elR, tmpQ[RP.UpperArmR], tmpQ[RP.ForeArmR]);
    local(BONE.thL, qp, tmpQ[RP.ThighL]);
    local(BONE.knL, tmpQ[RP.ThighL], tmpQ[RP.ShinL]);
    local(BONE.thR, qp, tmpQ[RP.ThighR]);
    local(BONE.knR, tmpQ[RP.ThighR], tmpQ[RP.ShinR]);
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
  private ring: THREE.Group;
  private circles: THREE.InstancedMesh;
  /** Show every player's puck (the circle that is his true body on the turf). */
  showCircles = false;
  private ball: THREE.Group;
  private ballShadow: THREE.Mesh;
  private ao: THREE.InstancedMesh;
  private cast: THREE.InstancedMesh;
  private uniforms: [UniformColors, UniformColors];
  private helmets: [THREE.BufferGeometry, THREE.BufferGeometry];
  /** Lighter helmets for the sideline squads. */
  private helmetsLow: [THREE.BufferGeometry, THREE.BufferGeometry];
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
    this.helmetsLow = [
      buildHelmetGeometry(this.uniforms[0].helmet, this.uniforms[0].stripe, this.uniforms[0].mask, 0.5),
      buildHelmetGeometry(this.uniforms[1].helmet, this.uniforms[1].stripe, this.uniforms[1].mask, 0.5),
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
    // User marker: a ring on the edge of his puck with a notch showing which way he faces.
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.95, depthWrite: false });
    this.ring = new THREE.Group();
    const band = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.32, 32).rotateX(-Math.PI / 2), ringMat);
    const notch = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1.38, 0, -0.42), new THREE.Vector3(1.38, 0, 0.42), new THREE.Vector3(2.0, 0, 0)]),
      ringMat,
    );
    notch.geometry.setIndex([0, 1, 2]);
    notch.geometry.computeVertexNormals();
    (notch.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    for (const m of [band, notch]) m.renderOrder = 3;
    this.ring.add(band, notch);
    this.group.add(this.ring);
    this.circles = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.7, 1.0, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
      N,
    );
    this.circles.frustumCulled = false;
    this.circles.renderOrder = 3;
    this.circles.visible = false;
    this.group.add(this.circles);

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
      const bodies = new THREE.InstancedMesh(bodyGeo(0, 0.6), new THREE.MeshLambertMaterial({ map: tex }), count);
      const helmets = new THREE.InstancedMesh(this.helmetsLow[team], HELMET_MAT, count);
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
    const col = new THREE.Color();
    lineup.forEach((e, i) => {
      const t = e.team === 1 ? 1 : 0;
      this.rigs[i]?.skin(this.uniforms[t], this.helmets[t], e);
      col.set(t === 0 ? this.uniforms[0].jersey : this.uniforms[1].trim).lerp(WHITE, 0.4);
      this.circles.setColorAt(i, col);
    });
    if (this.circles.instanceColor) this.circles.instanceColor.needsUpdate = true;
  }

  /**
   * @param presnap the play hasn't been snapped yet (players in their stances)
   * @param between the whistle has blown (players catch their breath)
   */
  update(prev: Float32Array, cur: Float32Array, alpha: number, dt: number, time: number, rag?: Float32Array, presnap = false, between = false) {
    this.userIndex = -1;
    const d = this.dummy;
    // The ball, for heads to follow and hands to reach for.
    const bo = N * STRIDE;
    const bxs = prev[bo] + (cur[bo] - prev[bo]) * alpha;
    const bys = prev[bo + 1] + (cur[bo + 1] - prev[bo + 1]) * alpha;
    const bzs = prev[bo + 2] + (cur[bo + 2] - prev[bo + 2]) * alpha;
    const bState = cur[bo + 3];
    const bHolder = cur[bo + 4];
    const bMark = cur[bo + 7];
    const btx = cur[bo + 8];
    const bty = cur[bo + 9];
    const bLeft = cur[bo + 10];
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
        // Puck velocity relative to facing (per sim step -> yards/second), and its
        // acceleration, which the body leans with.
        const vx = (cur[o] - prev[o]) * 60;
        const vy = (cur[o + 1] - prev[o + 1]) * 60;
        const lateral = -Math.sin(facing) * vx + Math.cos(facing) * vy;
        const forward = Math.cos(facing) * vx + Math.sin(facing) * vy;
        if (dt > 0) {
          const ax = (forward - rig.lastV.x) / Math.max(dt, 1 / 60);
          const ay = (lateral - rig.lastV.y) / Math.max(dt, 1 / 60);
          const k = 1 - Math.exp(-dt * 8);
          if (Number.isFinite(ax) && Number.isFinite(ay) && Math.abs(ax) < 80 && Math.abs(ay) < 80) {
            rig.accel.x += (ax - rig.accel.x) * k;
            rig.accel.y += (ay - rig.accel.y) * k;
          }
          rig.lastV.set(forward, lateral);
        }
        const carrier = (flags & FLAG.Carrier) !== 0;
        rig.updateCarryArm(dt, carrier, y, facing);
        rig.animate(dt, {
          anim,
          time,
          speed,
          fwd: forward,
          lat: lateral,
          accF: rig.accel.x,
          accL: rig.accel.y,
          carrier,
          presnap,
          between,
          underCenter: presnap && rig.pos === 'QB' && Math.hypot(bxs - x, bys - y) < 1.6,
          offense: (flags & FLAG.Offense) !== 0,
          engaged: (flags & FLAG.Engaged) !== 0,
          look: this.lookFor(i, rig, anim, carrier, presnap, x, y, facing, time, bxs, bys, bzs, bState, bHolder),
          reach: this.reachFor(i, carrier, x, y, facing, bxs, bys, bzs, bState, bMark, btx, bty, bLeft),
        });
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
        this.ring.rotation.y = rig.facing;
        const r = (rig.radius + 0.06) * (1 + Math.sin(time * 8) * 0.05);
        this.ring.scale.set(r, 1, r);
      }
      // Engine view: every player's puck.
      if (this.showCircles) {
        d.position.set(x, 0.035, -y);
        d.rotation.set(0, 0, 0);
        d.scale.set(rig.radius, 1, rig.radius);
        d.updateMatrix();
        this.circles.setMatrixAt(i, d.matrix);
      }
    }
    this.ao.instanceMatrix.needsUpdate = true;
    this.cast.instanceMatrix.needsUpdate = true;
    this.ring.visible = this.userIndex >= 0;
    this.circles.visible = this.showCircles;
    if (this.showCircles) this.circles.instanceMatrix.needsUpdate = true;

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
    } else if (state === 1 && holder >= 0 && this.rigs[holder] && !this.rigs[holder].ragdolled && cur[holder * STRIDE + 4] !== ANIM.Throw && cur[holder * STRIDE + 4] !== ANIM.Down) {
      // In the carrying arm: along the forearm, tucked against the chest (the quarterback
      // in the pocket holds it in both hands, on his right forearm).
      const rig = this.rigs[holder];
      rig.root.updateMatrixWorld(true);
      const left = rig.carryLeft && !(rig.pos === 'QB' && cur[holder * STRIDE + 5] < 4.5);
      const fore = rig.bones[left ? BONE.elL : BONE.elR];
      fore.localToWorld(this.ball.position.set(0.03, -0.14, left ? 0.035 : -0.035));
      fore.getWorldQuaternion(this.ball.quaternion).multiply(BALL_ALONG_FOREARM);
      this.ballPos.copy(this.ball.position);
    } else if (state === 1 && holder >= 0) {
      this.ball.rotation.set(0, this.rigs[holder].facing + 0.4, -0.3);
    } else {
      this.ball.rotation.set(0, 0, 0);
    }
    this.ballShadow.position.set(bx, 0.02, -by);
    this.ballShadow.visible = bz > 0.4;
  }

  /** Where a player's head turns: the ball (or its carrier), within reason. */
  private lookFor(
    i: number, rig: Rig, anim: number, carrier: boolean, presnap: boolean, x: number, y: number, facing: number, time: number,
    bx: number, by: number, bz: number, state: number, holder: number,
  ): { yaw: number; pitch: number } | null {
    if (anim === ANIM.Block || anim === ANIM.Wrap || anim === ANIM.Down || anim === ANIM.Dive) return null;
    if (carrier) {
      // The quarterback scans the field in the pocket; runners look where they're going.
      return rig.pos === 'QB' && anim !== ANIM.Run ? { yaw: Math.sin(time * 0.9 + i) * 0.75, pitch: 0 } : null;
    }
    if (presnap && (rig.pos === 'OL' || rig.pos === 'QB' || rig.pos === 'K' || rig.pos === 'P')) return null;
    if (state === 1 && holder === i) return null;
    const dx = bx - x;
    const dy = by - y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.4) return null;
    let yaw = Math.atan2(dy, dx) - facing;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    return { yaw, pitch: Math.atan2(bz - 1.85, dist) };
  }

  /** A pass (or kick) about to come down near this player: reach for it. */
  private reachFor(
    i: number, carrier: boolean, x: number, y: number, facing: number,
    bx: number, by: number, bz: number, state: number, mark: number, tx: number, ty: number, tleft: number,
  ): { yaw: number; pitch: number; w: number } | null {
    if (carrier || state !== 2 || mark <= 0 || !(tleft < 0.75)) return null;
    const dTarget = Math.hypot(tx - x, ty - y);
    if (dTarget > 2.4) return null;
    // Aim at the ball itself once it's close, before that at where it will be caught.
    const close = tleft < 0.3;
    const px = close ? bx : tx;
    const py = close ? by : ty;
    const pz = close ? bz : 1.45;
    const dx = px - x;
    const dy = py - y;
    const horiz = Math.hypot(dx, dy);
    let yaw = Math.atan2(dy, dx) - facing;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const w = (1 - Math.min(1, Math.max(0, (tleft - 0.12) / 0.6))) * (1 - dTarget / 2.4);
    void i;
    return { yaw, pitch: Math.atan2(pz - 1.55, Math.max(horiz, 0.3)), w: Math.min(1, w * 1.6) };
  }

  /** Where a player's body is (three.js coordinates; for dev close-ups). */
  rigPosition(i: number): THREE.Vector3 {
    const r = this.rigs[i];
    if (!r) return new THREE.Vector3();
    if (r.ragdolled) return r.bones[BONE.hips].getWorldPosition(new THREE.Vector3()).setY(0);
    return r.root.position.clone();
  }

  rigFacing(i: number): number {
    return this.rigs[i]?.facing ?? 0;
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
