// Low-poly, PS2-era players with procedural animation. Every joint blends toward a
// target pose each frame, so transitions (run → juke → tackle) stay smooth.

import * as THREE from 'three';
import { ANIM, FLAG, LineupEntry, N, STRIDE, TeamInfo } from '../types';

const SKIN = ['#f1c9a5', '#e0ac7e', '#c58c62', '#a8714a', '#8d5a3b', '#5a3a26'];
const ICON_COLORS = ['#2f7bff', '#ff4040', '#2fcf5a', '#ffc400', '#b05cff'];

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

interface UniformColors {
  jersey: string;
  pants: string;
  helmet: string;
  stripe: string;
  socks: string;
  num: string;
  numOutline: string;
}

export function uniformFor(team: TeamInfo, home: boolean): UniformColors {
  if (home) {
    const numDark = luminance(team.primary) > 0.55;
    return {
      jersey: team.primary,
      pants: luminance(team.secondary) > 0.6 ? team.secondary : '#e9e6dc',
      helmet: team.primary,
      stripe: team.secondary,
      socks: team.primary,
      num: numDark ? '#111111' : '#ffffff',
      numOutline: team.secondary,
    };
  }
  return {
    jersey: '#f2f2ee',
    pants: team.secondary,
    helmet: team.primary,
    stripe: team.secondary,
    socks: team.primary,
    num: team.primary,
    numOutline: luminance(team.secondary) > 0.8 ? '#222222' : team.secondary,
  };
}

// ---------------------------------------------------------------------------
// Shared geometry and textures
// ---------------------------------------------------------------------------

function boxDown(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0);
  return g;
}

const GEO = {
  pelvis: new THREE.BoxGeometry(0.3, 0.24, 0.4),
  torso: new THREE.BoxGeometry(0.34, 0.56, 0.44),
  pads: new THREE.BoxGeometry(0.42, 0.2, 0.68),
  thigh: boxDown(0.17, 0.46, 0.17),
  shin: boxDown(0.13, 0.44, 0.13),
  foot: new THREE.BoxGeometry(0.26, 0.08, 0.12),
  upper: boxDown(0.13, 0.32, 0.13),
  fore: boxDown(0.1, 0.3, 0.1),
  helmet: new THREE.SphereGeometry(0.17, 8, 6),
  mask: new THREE.BoxGeometry(0.06, 0.12, 0.22),
  stripe: new THREE.BoxGeometry(0.33, 0.025, 0.05),
  number: new THREE.PlaneGeometry(0.3, 0.3),
  shadow: new THREE.CircleGeometry(0.45, 10),
};

const MAT_SHARED = {
  mask: new THREE.MeshLambertMaterial({ color: '#9aa0a8', flatShading: true }),
  shoe: new THREE.MeshLambertMaterial({ color: '#141414', flatShading: true }),
  shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }),
  skins: SKIN.map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true })),
};

const numberTexCache = new Map<string, THREE.CanvasTexture>();
function numberTexture(n: number, fill: string, outline: string): THREE.CanvasTexture {
  const key = `${n}|${fill}|${outline}`;
  let t = numberTexCache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.font = 'bold 44px Arial Black, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = outline;
  g.strokeText(String(n), 32, 35);
  g.fillStyle = fill;
  g.fillText(String(n), 32, 35);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  numberTexCache.set(key, t);
  return t;
}

const numberMatCache = new Map<string, THREE.MeshBasicMaterial>();
function numberMaterial(n: number, fill: string, outline: string): THREE.MeshBasicMaterial {
  const key = `${n}|${fill}|${outline}`;
  let m = numberMatCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: numberTexture(n, fill, outline), transparent: true, alphaTest: 0.3 });
    numberMatCache.set(key, m);
  }
  return m;
}

function iconTexture(i: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.beginPath();
  g.arc(32, 32, 27, 0, Math.PI * 2);
  g.fillStyle = ICON_COLORS[i - 1];
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 34px Arial Black, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(i), 32, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class TeamMats {
  jersey: THREE.MeshLambertMaterial;
  pants: THREE.MeshLambertMaterial;
  helmet: THREE.MeshLambertMaterial;
  stripe: THREE.MeshLambertMaterial;
  socks: THREE.MeshLambertMaterial;
  constructor(public colors: UniformColors) {
    const m = (c: string) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    this.jersey = m(colors.jersey);
    this.pants = m(colors.pants);
    this.helmet = m(colors.helmet);
    this.stripe = m(colors.stripe);
    this.socks = m(colors.socks);
  }
}

// ---------------------------------------------------------------------------
// One player rig
// ---------------------------------------------------------------------------

type Pose = {
  hipsY: number; leanZ: number; leanX: number; bodyX: number;
  legL: number; legR: number; kneeL: number; kneeR: number;
  armL: number; armR: number; armLx: number; armRx: number; elbL: number; elbR: number;
};

const ZERO_POSE: Pose = {
  hipsY: 1.0, leanZ: 0, leanX: 0, bodyX: 0,
  legL: 0, legR: 0, kneeL: 0, kneeR: 0,
  armL: 0, armR: 0, armLx: -0.15, armRx: 0.15, elbL: 0.3, elbR: 0.3,
};

class Rig {
  root = new THREE.Group();
  body = new THREE.Group();
  hips = new THREE.Group();
  torso = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  kneeL = new THREE.Group();
  kneeR = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  elbL = new THREE.Group();
  elbR = new THREE.Group();
  head = new THREE.Group();
  meshes: Record<string, THREE.Mesh[]> = { jersey: [], pants: [], helmet: [], stripe: [], socks: [], skin: [] };
  numFront: THREE.Mesh;
  numBack: THREE.Mesh;
  shadow: THREE.Mesh;
  pose: Pose = { ...ZERO_POSE };
  phase = Math.random() * 6;
  facing = 0;
  downSide = 1;
  build = 1;

  constructor() {
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, slot: string | THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, typeof slot === 'string' ? MAT_SHARED.mask : slot);
      m.position.set(x, y, z);
      if (typeof slot === 'string') this.meshes[slot].push(m);
      parent.add(m);
      return m;
    };
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 1.0;
    add(this.hips, GEO.pelvis, 'pants', 0, 0.02, 0);

    for (const [leg, knee, z] of [[this.legL, this.kneeL, 0.11], [this.legR, this.kneeR, -0.11]] as const) {
      leg.position.set(0, -0.05, z);
      this.hips.add(leg);
      add(leg, GEO.thigh, 'pants');
      knee.position.y = -0.46;
      leg.add(knee);
      add(knee, GEO.shin, 'socks');
      add(knee, GEO.foot, MAT_SHARED.shoe, 0.06, -0.44, 0);
    }

    this.torso.position.y = 0.06;
    this.hips.add(this.torso);
    add(this.torso, GEO.torso, 'jersey', 0, 0.3, 0);
    add(this.torso, GEO.pads, 'jersey', 0, 0.58, 0);
    this.numFront = add(this.torso, GEO.number, MAT_SHARED.mask, 0.172, 0.3, 0);
    this.numFront.rotation.y = Math.PI / 2;
    this.numBack = add(this.torso, GEO.number, MAT_SHARED.mask, -0.172, 0.33, 0);
    this.numBack.rotation.y = -Math.PI / 2;

    for (const [arm, elb, z] of [[this.armL, this.elbL, 0.33], [this.armR, this.elbR, -0.33]] as const) {
      arm.position.set(0, 0.56, z);
      this.torso.add(arm);
      add(arm, GEO.upper, 'jersey');
      elb.position.y = -0.32;
      arm.add(elb);
      add(elb, GEO.fore, 'skin');
    }

    this.head.position.y = 0.8;
    this.torso.add(this.head);
    add(this.head, GEO.helmet, 'helmet');
    add(this.head, GEO.mask, MAT_SHARED.mask, 0.15, -0.04, 0);
    add(this.head, GEO.stripe, 'stripe', 0, 0.165, 0);

    this.shadow = new THREE.Mesh(GEO.shadow, MAT_SHARED.shadow);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = 2;
    this.root.add(this.shadow);
  }

  skin(mats: TeamMats, e: LineupEntry) {
    for (const k of ['jersey', 'pants', 'helmet', 'stripe', 'socks'] as const) {
      for (const m of this.meshes[k]) m.material = mats[k];
    }
    for (const m of this.meshes.skin) m.material = MAT_SHARED.skins[e.skin % SKIN.length];
    const nm = numberMaterial(e.number, mats.colors.num, mats.colors.numOutline);
    this.numFront.material = nm;
    this.numBack.material = nm;
    this.build = e.build;
    const s = [0.88, 1.0, 1.2][e.build] ?? 1;
    this.body.scale.set(s, 1, s);
    this.downSide = e.number % 2 ? 1 : -1;
  }

  /** Compute the target pose for this frame and blend toward it. */
  animate(dt: number, anim: number, speed: number, carrier: boolean, time: number, lateral: number) {
    const a = Math.min(1, Math.max(0.15, speed / 8.5));
    this.phase += dt * (2.2 + speed * 1.55);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const t: Pose = { ...ZERO_POSE };

    const run = (amp: number) => {
      t.legL = s * 0.95 * amp;
      t.legR = -s * 0.95 * amp;
      t.kneeL = -0.25 * amp - Math.max(0, -Math.sin(this.phase + 0.7)) * 1.3 * amp;
      t.kneeR = -0.25 * amp - Math.max(0, Math.sin(this.phase + 0.7)) * 1.3 * amp;
      t.armL = -s * 0.85 * amp;
      t.armR = s * 0.85 * amp;
      t.elbL = 1.2;
      t.elbR = 1.2;
      t.leanZ = -0.1 - 0.22 * amp;
      t.hipsY = 1.0 - 0.05 * amp + Math.abs(c) * 0.07 * amp;
    };

    switch (anim) {
      case ANIM.Stance:
        if (this.build === 2) {
          // Three-point stance.
          Object.assign(t, { hipsY: 0.74, leanZ: -0.95, legL: 0.75, legR: 0.2, kneeL: -1.45, kneeR: -1.1, armR: 1.15, elbR: 0.1, armL: 0.5, elbL: 0.6 });
        } else {
          Object.assign(t, { hipsY: 0.9, leanZ: -0.35, legL: 0.35, legR: 0.1, kneeL: -0.7, kneeR: -0.55, armL: 0.5, armR: 0.5, elbL: 0.6, elbR: 0.6 });
        }
        break;
      case ANIM.Idle:
        t.hipsY = 0.99 + Math.sin(time * 2 + this.phase) * 0.008;
        t.leanZ = -0.06;
        t.elbL = t.elbR = 0.35;
        break;
      case ANIM.Run:
      case ANIM.Juke:
      case ANIM.Spin:
        run(a);
        // Core "left" is three.js -Z, which is a negative roll about X.
        if (anim === ANIM.Juke) t.leanX = -Math.sign(lateral || 1) * 0.45;
        if (anim === ANIM.Spin) Object.assign(t, { armL: 0.4, armR: 0.4, elbL: 2.0, elbR: 2.0 });
        break;
      case ANIM.Block:
        run(0.35);
        this.phase += dt * 6;
        Object.assign(t, { leanZ: -0.5, hipsY: 0.88, armL: 1.45, armR: 1.45, elbL: 0.35, elbR: 0.35, armLx: 0.1, armRx: -0.1 });
        break;
      case ANIM.Throw:
        Object.assign(t, { armR: 2.9, elbR: 0.35, armL: 1.0, elbL: 0.8, leanZ: -0.05, legL: 0.35, legR: -0.25 });
        break;
      case ANIM.Catch:
        run(a * 0.6);
        Object.assign(t, { armL: 2.3, armR: 2.3, elbL: 0.5, elbR: 0.5, armLx: 0.25, armRx: -0.25 });
        break;
      case ANIM.Dive:
        Object.assign(t, { leanZ: -1.4, hipsY: 0.6, armL: 3.0, armR: 3.0, elbL: 0.1, elbR: 0.1, legL: -0.35, legR: -0.5, kneeL: -0.2, kneeR: -0.2, bodyX: -0.4 });
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
        Object.assign(t, { hipsY: 1.0 + j * 0.25, armL: 3.0, armR: 3.0, armLx: -0.35, armRx: 0.35, elbL: 0.2, elbR: 0.2, legL: j * 0.3, legR: -j * 0.2, kneeL: -j * 0.6, kneeR: -j * 0.5 });
        break;
      }
    }

    if (carrier && anim !== ANIM.Down && anim !== ANIM.Throw && anim !== ANIM.Stiff && anim !== ANIM.Celebrate) {
      // Tuck the ball.
      t.armR = 0.7;
      t.elbR = 2.0;
      t.armRx = -0.2;
    }

    const k = 1 - Math.exp(-dt * (anim === ANIM.Down || anim === ANIM.Dive ? 9 : 16));
    const p = this.pose;
    for (const key of Object.keys(p) as (keyof Pose)[]) {
      p[key] += (t[key] - p[key]) * k;
    }

    this.hips.position.y = p.hipsY;
    this.body.rotation.z = p.leanZ;
    this.body.rotation.x = p.leanX;
    this.body.position.x = p.bodyX;
    this.body.position.y = anim === ANIM.Down ? 0.15 : 0;
    this.legL.rotation.z = p.legL;
    this.legR.rotation.z = p.legR;
    this.kneeL.rotation.z = p.kneeL;
    this.kneeR.rotation.z = p.kneeR;
    this.armL.rotation.z = p.armL;
    this.armR.rotation.z = p.armR;
    this.armL.rotation.x = p.armLx;
    this.armR.rotation.x = p.armRx;
    this.elbL.rotation.z = p.elbL;
    this.elbR.rotation.z = p.elbR;
  }
}

// ---------------------------------------------------------------------------
// All 22 players + ball + markers
// ---------------------------------------------------------------------------

function lerpAngle(a: number, b: number, t: number): number {
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : 0;
  if (!Number.isFinite(b)) return a;
  const TAU = Math.PI * 2;
  const d = ((((b - a) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  return a + d * t;
}

export class Players {
  readonly group = new THREE.Group();
  private rigs: Rig[] = [];
  private icons: THREE.Sprite[] = [];
  private iconMats: THREE.SpriteMaterial[] = [];
  private ring: THREE.Mesh;
  private ball: THREE.Group;
  private ballShadow: THREE.Mesh;
  private mats: [TeamMats, TeamMats];
  private ballSpin = 0;
  /** Facing angle (core space) of each rig, for the camera and input. */
  facings: number[] = new Array(N).fill(0);
  positions: THREE.Vector3[] = Array.from({ length: N }, () => new THREE.Vector3());
  userIndex = -1;
  ballPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, home: TeamInfo, away: TeamInfo) {
    this.mats = [new TeamMats(uniformFor(home, true)), new TeamMats(uniformFor(away, false))];
    for (let i = 0; i < N; i++) {
      const r = new Rig();
      this.rigs.push(r);
      this.group.add(r.root);
    }
    for (let i = 1; i <= 5; i++) {
      this.iconMats.push(new THREE.SpriteMaterial({ map: iconTexture(i), depthTest: false }));
    }
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(this.iconMats[0]);
      s.scale.set(0.95, 0.95, 1);
      s.visible = false;
      s.renderOrder = 10;
      this.icons.push(s);
      this.group.add(s);
    }
    const ringGeo = new THREE.RingGeometry(0.55, 0.78, 20);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 3;
    this.group.add(this.ring);

    // Ball: a prolate spheroid with a lace stripe.
    this.ball = new THREE.Group();
    const leather = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshLambertMaterial({ color: '#7a3d1a', flatShading: true }));
    leather.scale.set(1.65, 1, 1);
    const laces = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.025), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    laces.position.y = 0.11;
    this.ball.add(leather, laces);
    this.group.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), MAT_SHARED.shadow);
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.02;
    this.group.add(this.ballShadow);

    scene.add(this.group);
  }

  setLineup(lineup: LineupEntry[]) {
    lineup.forEach((e, i) => this.rigs[i]?.skin(this.mats[e.team] ?? this.mats[0], e));
  }

  update(prev: Float32Array, cur: Float32Array, alpha: number, dt: number, time: number) {
    this.userIndex = -1;
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
      rig.root.position.set(x, z, -y);
      // Smooth facing a little more on top of the sim's turn rate.
      rig.facing = lerpAngle(rig.facing, facing, 1 - Math.exp(-dt * 20));
      rig.root.rotation.y = rig.facing;
      this.facings[i] = rig.facing;
      this.positions[i].set(x, z, -y);
      // Lateral velocity sign (for juke lean).
      const vx = cur[o] - prev[o];
      const vy = cur[o + 1] - prev[o + 1];
      const lateral = -Math.sin(facing) * vx + Math.cos(facing) * vy;
      rig.animate(dt, anim, speed, (flags & FLAG.Carrier) !== 0, time, lateral);

      const ic = this.icons[i];
      if (icon > 0) {
        ic.visible = true;
        ic.material = this.iconMats[icon - 1];
        ic.position.set(x, 2.75, -y);
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
    this.ring.visible = this.userIndex >= 0;

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
      // In the air: point along the flight path and spiral.
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

  /** Index of the receiver icon nearest a ground point (core coordinates), or 0. */
  iconNear(cur: Float32Array, px: number, py: number, maxDist = 4.5): number {
    let best = 0;
    let bestD = maxDist;
    for (let i = 0; i < N; i++) {
      const o = i * STRIDE;
      const icon = cur[o + 7];
      if (icon <= 0) continue;
      const d = Math.hypot(cur[o] - px, cur[o + 1] - py);
      if (d < bestD) {
        bestD = d;
        best = icon;
      }
    }
    return best;
  }
}
