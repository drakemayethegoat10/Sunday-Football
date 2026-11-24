// Procedural animation for the on-field players.
//
// Each frame `targetPose` turns what the core reports about a player (animation state,
// the puck's velocity and acceleration, the ball) into a pose, and the rig eases toward
// it. Nothing here moves a player: the puck underneath is the truth; the body follows.
//
// Legs are solved with two-bone IK from where each foot should be. While running, the
// planted foot moves backward under the body exactly as fast as the puck moves forward,
// so the feet don't slide; stances are written as foot spots plus a hip height.
//
// Angle conventions (the model faces +X with +Y up; the player's left is -Z):
//   *Z (legs, arms, elbows, knees, feet): positive swings the limb forward / up.
//   hipZ, spineZ, chestZ, leanZ: positive tips the body back; headZ: positive looks up.
//   *X on limbs: positive swings the limb toward the player's left.
//   leanX: positive rolls the body to his right.
//   Yaw (hipYaw, twist, chestTwist, headY, arm *Y): positive turns toward his left.

import { ANIM } from '../types';

export interface Pose {
  hipsY: number; drop: number; leanZ: number; leanX: number; bodyX: number;
  hipZ: number; hipYaw: number; spineZ: number; twist: number; chestZ: number; chestTwist: number;
  headZ: number; headY: number;
  legL: number; legR: number; kneeL: number; kneeR: number; legLx: number; legRx: number; footL: number; footR: number;
  armL: number; armR: number; armLx: number; armRx: number; armLy: number; armRy: number;
  elbL: number; elbR: number; handL: number; handR: number;
}

export const POSE_KEYS: (keyof Pose)[] = [
  'hipsY', 'drop', 'leanZ', 'leanX', 'bodyX', 'hipZ', 'hipYaw', 'spineZ', 'twist', 'chestZ', 'chestTwist',
  'headZ', 'headY', 'legL', 'legR', 'kneeL', 'kneeR', 'legLx', 'legRx', 'footL', 'footR',
  'armL', 'armR', 'armLx', 'armRx', 'armLy', 'armRy', 'elbL', 'elbR', 'handL', 'handR',
];

export function restPose(): Pose {
  const p = {} as Pose;
  for (const k of POSE_KEYS) p[k] = 0;
  p.hipsY = 0.98;
  p.armLx = 0.12;
  p.armRx = -0.12;
  p.elbL = 0.35;
  p.elbR = 0.35;
  return p;
}

/** What the rig knows about one player this frame. */
export interface AnimCtx {
  anim: number;
  /** Seconds in the current animation state. */
  animT: number;
  time: number;
  speed: number;
  /** Puck velocity relative to the facing: forward, and toward the player's left. */
  fwd: number;
  lat: number;
  /** Smoothed puck acceleration: forward, left. */
  accF: number;
  accL: number;
  /** Stride phase (radians; one step per pi). */
  phase: number;
  carrier: boolean;
  /** Carry the ball in the left arm (the sideline side). */
  carryLeft: boolean;
  pos: string;
  build: number;
  number: number;
  /** Before the snap (stances). */
  presnap: boolean;
  /** After the whistle / between plays (players catch their breath). */
  between: boolean;
  /** Quarterback lined up right behind the ball (under center). */
  underCenter: boolean;
  offense: boolean;
  engaged: boolean;
  /** Where to look, relative to the body: yaw (left +) and pitch (up +), or null. */
  look: { yaw: number; pitch: number } | null;
  /** Pass about to arrive near this player: direction from his chest and urgency 0–1. */
  reach: { yaw: number; pitch: number; w: number } | null;
  /** Seconds since he started getting up off the turf, or -1. */
  getUp: number;
  /** 1 or -1: which way he fell. */
  downSide: number;
  /** Which leg he juked off (1 = cut to his left). */
  cutSide: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const frac = (v: number) => v - Math.floor(v);

const THIGH = 0.47;
const SHIN = 0.42;
const ANKLE = 0.09;

/**
 * Two-bone leg IK. Foot spot relative to the hip joint: `fx` forward, `fz` toward the
 * player's left; `fy` ankle height off the turf; `pitch` the foot's angle to the ground
 * (negative: toes down).
 */
function leg(p: Pose, left: boolean, fx: number, fy: number, fz: number, pitch: number) {
  const hj = p.hipsY - 0.02;
  const ab = Math.asin(clamp(fz / 0.86, -0.75, 0.75));
  const dy = (hj - fy) / Math.cos(ab);
  const D = clamp(Math.hypot(fx, dy), 0.15, THIGH + SHIN - 0.002);
  const flex = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - D * D) / (2 * THIGH * SHIN), -1, 1));
  const alpha = Math.atan2(fx, dy);
  const beta = Math.acos(clamp((THIGH * THIGH + D * D - SHIN * SHIN) / (2 * THIGH * D), -1, 1));
  const thighW = alpha + beta;
  const thigh = thighW - p.hipZ;
  const foot = pitch - (thighW - flex);
  if (left) {
    p.legL = thigh;
    p.kneeL = -flex;
    p.legLx = ab;
    p.footL = foot;
  } else {
    p.legR = thigh;
    p.kneeR = -flex;
    p.legRx = ab;
    p.footR = foot;
  }
}

/**
 * Point a (nearly straight) arm along a direction in the chest's frame: `dx` forward,
 * `dy` up, `dz` toward the player's left (unit-ish).
 */
function aimArm(p: Pose, left: boolean, dx: number, dy: number, dz: number, elbow = 0.25) {
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  // Raise the arm forward-and-up for high targets in front, out to the side otherwise.
  const h = Math.hypot(dy, dz);
  const k = dy > 0.2 && Math.abs(dz) < 0.7 ? h : -h;
  const c = Math.atan2(dx, -k);
  // Arm direction = (sin c, -cos c cos a, -cos c sin a) in three.js axes, where
  // three.js z = -left: solve with k = -cos c.
  const a = Math.abs(k) < 1e-4 ? 0 : Math.atan2(-dz / k, dy / k);
  if (left) {
    p.armL = c;
    p.armLx = a;
    p.armLy = 0;
    p.elbL = elbow;
  } else {
    p.armR = c;
    p.armRx = a;
    p.armRy = 0;
    p.elbR = elbow;
  }
}

/**
 * Aim an arm along a direction given in the world (relative to the facing): `wx`
 * forward, `wy` up, `wz` left. Undoes the trunk's current bend and turn first.
 */
function aimWorld(p: Pose, left: boolean, wx: number, wy: number, wz: number, elbow = 0.25) {
  const pitch = p.leanZ + p.hipZ + p.spineZ + p.chestZ;
  const yaw = p.hipYaw + p.twist + p.chestTwist;
  // three.js frame: z is to the right, so "left" is -z.
  let x = wx;
  let z = -wz;
  // Undo the yaw (rotate by -yaw about +Y), then the pitch (by -pitch about +Z).
  const cy = Math.cos(-yaw);
  const sy = Math.sin(-yaw);
  const x1 = x * cy + z * sy;
  z = -x * sy + z * cy;
  x = x1;
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  const x2 = x * cp - wy * sp;
  const y2 = x * sp + wy * cp;
  aimArm(p, left, x2, y2, -z, elbow);
}

/** Both feet planted under the hips (a standing base); `wide` spreads them. */
function planted(p: Pose, wide = 0.03, stagger = 0, heelR = 0) {
  leg(p, true, stagger, ANKLE, wide, 0);
  leg(p, false, -stagger, ANKLE + heelR, -wide, heelR > 0 ? -heelR * 4 : 0);
}

// ---------------------------------------------------------------------------
// Locomotion
// ---------------------------------------------------------------------------

interface Gait {
  /** 0 walk .. 1 sprint. */
  g: number;
  /** Fraction of the cycle a foot is on the turf, and how far it travels while there. */
  duty: number;
  stance: number;
  lift: number;
}

function gait(v: number): Gait {
  const cadence = 1.6 + 0.35 * v; // steps per second
  const step = v / cadence;
  const duty = Math.min(clamp(0.62 - 0.04 * v, 0.26, 0.62), 0.9 / Math.max(2 * step, 1e-3));
  const g = clamp((v - 1.5) / 7, 0, 1);
  return { g, duty, stance: 2 * step * duty, lift: lerp(0.06, 0.4, g) };
}

/** Where one foot is along the line of motion (u), its height and pitch. */
function footPath(q: number, gt: Gait): [number, number, number] {
  const S = gt.stance;
  if (q < gt.duty) {
    const s = q / gt.duty;
    const heel = smooth(0.55, 1, s) * (0.03 + 0.11 * gt.g);
    return [S * (0.4 - s), ANKLE + heel, -heel * 4];
  }
  const s = (q - gt.duty) / (1 - gt.duty);
  const late = 0.12 * gt.g;
  const e = smooth(0, 1, clamp((s - late) / (1 - late), 0, 1));
  const h = gt.lift * Math.sin(Math.PI * Math.pow(s, 0.75));
  const pitch = s < 0.5 ? -0.6 * (1 - s * 2) : 0.2 * (s - 0.5) * 2;
  return [S * (-0.6 + e), ANKLE + h, pitch];
}

/**
 * Running, jogging, backpedaling, shuffling and crossover runs, from the puck's
 * velocity. `amp` scales the upper-body motion (0.4 for players fighting a block).
 */
function locomote(p: Pose, c: AnimCtx, amp = 1, hips?: number, hipPitch?: number) {
  const v = c.speed;
  if (v < 0.35) {
    if (hips !== undefined) p.hipsY = hips;
    if (hipPitch !== undefined) p.hipZ = hipPitch;
    planted(p, 0.035);
    return;
  }
  const gt = gait(v);
  const g = gt.g;
  const motion = Math.atan2(c.lat, c.fwd); // + = toward his left
  const back = Math.abs(motion) > 2.2;
  const side = !back && Math.abs(motion) > 0.8;
  const shuffle = side && v < 4.5;

  // Hips turn toward the motion (fully on a crossover run); the chest stays square.
  let hipYaw = 0;
  if (back) hipYaw = (motion - Math.sign(motion) * Math.PI) * 0.4;
  else if (shuffle) hipYaw = 0;
  else hipYaw = clamp(motion, -1.2, 1.2) * (side ? 0.9 : 0.5);
  const along = motion - hipYaw; // motion direction relative to the hips
  const ca = Math.cos(along);
  const sa = Math.sin(along);

  const qL = frac(c.phase / (2 * Math.PI));
  const qR = frac(qL + 0.5);
  const [uL, hL, pL] = footPath(qL, gt);
  const [uR, hR, pR] = footPath(qR, gt);
  const width = shuffle ? 0.11 : 0.01;
  // Pelvis height: running bobs lowest at mid-stance, walking highest.
  const bobPhase = Math.cos(4 * Math.PI * (qL - gt.duty / 2));
  const bob = v < 2 ? 0.012 * bobPhase : -0.022 * (0.5 + g) * bobPhase;
  p.hipsY = (hips ?? (back || shuffle ? 0.9 : lerp(0.965, 0.9, g))) + bob;
  p.hipZ = hipPitch ?? (back ? -0.28 : shuffle ? -0.3 : -0.05 - 0.13 * g);
  p.spineZ = back ? -0.22 : shuffle ? -0.15 : -0.04 - 0.1 * g;
  p.chestZ = -0.04 * g;
  // Lean with the puck: forward when it speeds up, back when it brakes, into turns.
  const lean = clamp(c.accF * 0.02, -0.2, 0.26);
  p.spineZ -= lean * 0.6;
  p.hipZ -= lean * 0.3;
  p.leanX = clamp(-c.accL * 0.022, -0.3, 0.3);
  p.hipYaw = hipYaw - 0.1 * g * (uL / Math.max(gt.stance * 0.5, 0.05)) * amp;
  leg(p, true, uL * ca, hL * (shuffle ? 0.6 : 1), uL * sa + width, pL);
  leg(p, false, uR * ca, hR * (shuffle ? 0.6 : 1), uR * sa - width, pR);

  // Arms swing against the legs; the chest counter-rotates against the hips.
  const nL = clamp(uL / Math.max(gt.stance * 0.5, 0.05), -1.5, 1.5);
  const nR = clamp(uR / Math.max(gt.stance * 0.5, 0.05), -1.5, 1.5);
  const A = (back || shuffle ? 0.25 : 0.25 + 0.6 * g) * amp;
  p.armR = 0.12 + A * nL;
  p.armL = 0.12 + A * nR;
  const bend = back || shuffle ? 1.3 : lerp(0.45, 1.55, g);
  p.elbL = bend + 0.25 * Math.max(0, nR) * g;
  p.elbR = bend + 0.25 * Math.max(0, nL) * g;
  p.armLx = 0.1;
  p.armRx = -0.1;
  p.armLy = 0;
  p.armRy = 0;
  p.chestTwist = 0.16 * g * nL * amp - p.hipYaw;
  p.headZ = -(p.spineZ + p.hipZ) * 0.7;
}

// ---------------------------------------------------------------------------
// The pose for this frame
// ---------------------------------------------------------------------------

/** Kneeling on one knee, about to stand (get-up). */
function kneel(p: Pose) {
  p.hipsY = 0.56;
  p.hipZ = -0.25;
  p.spineZ = -0.25;
  p.headZ = 0.3;
  leg(p, true, 0.42, ANKLE, 0.02, 0);
  // Right knee on the turf, shin trailing.
  p.legR = -0.25;
  p.kneeR = -2.35;
  p.legRx = 0;
  p.footR = -0.4;
  p.armL = 0.55;
  p.elbL = 0.9;
  p.armR = 0.9;
  p.elbR = 0.3;
  p.armRx = -0.2;
}

function throwPose(p: Pose, t: number) {
  // The ball leaves the hand at t = 0 (the core throws on the button press), so the arm
  // starts already cocked behind the ear and whips through, then follows across.
  const k1 = smooth(0, 0.07, t);
  const k2 = smooth(0.05, 0.3, t);
  planted(p, 0.05);
  leg(p, true, 0.32, ANKLE, 0.04, 0); // stepped toward the target
  leg(p, false, -0.28, ANKLE + 0.08 * k2, -0.06, -0.4 * k2);
  p.hipsY = 0.93;
  p.armRx = lerp(-1.4, -0.65, k2);
  p.armRy = lerp(-1.5, 0, k1);
  p.armR = lerp(0.0, 1.05, k2);
  p.elbR = lerp(1.7, 0.45, k1) + 0.2 * k2;
  p.handR = -0.5 * k1;
  p.armL = lerp(1.1, 0.3, k2);
  p.elbL = lerp(0.9, 1.7, k2);
  p.armLx = lerp(0.1, -0.1, k2);
  p.chestTwist = lerp(-0.55, 0.5, smooth(0, 0.2, t));
  p.hipYaw = lerp(-0.3, 0.35, smooth(0, 0.25, t));
  p.spineZ = lerp(0.05, -0.38, k2);
  p.headZ = 0.15;
  p.headY = -p.chestTwist - p.hipYaw;
}

function kickPose(p: Pose, t: number, punter: boolean) {
  // Contact at t = 0, then the kicking (right) leg follows through high.
  const k = smooth(0, 0.3, t);
  p.hipsY = lerp(0.95, 1.0, k);
  p.hipZ = lerp(0.05, 0.22, k);
  p.spineZ = lerp(0.05, 0.12, k);
  leg(p, true, 0.05, ANKLE + 0.06 * k, 0.04, -0.5 * k); // plant foot rises onto the toes
  p.legR = lerp(0.45, punter ? 2.05 : 1.75, k);
  p.kneeR = lerp(-0.45, -0.05, k);
  p.legRx = -0.05;
  p.footR = punter ? -0.65 : -0.3;
  p.armL = lerp(0.6, 1.2, k);
  p.armLx = 0.9;
  p.elbL = 0.4;
  p.armR = punter ? lerp(1.0, 0.2, k) : -0.3;
  p.armRx = -0.7;
  p.elbR = 0.5;
  p.chestTwist = lerp(0.15, -0.2, k);
  p.headZ = -0.35;
}

function stance(p: Pose, c: AnimCtx) {
  const pos = c.pos;
  const line = pos === 'OL' || pos === 'DL' || (pos === 'TE' && c.offense);
  if (line) {
    // Three-point stance: flat back, weight forward, one hand down.
    p.hipsY = pos === 'TE' ? 0.7 : 0.66;
    p.hipZ = -1.12;
    p.spineZ = -0.08;
    p.chestZ = 0.05;
    p.headZ = 1.05;
    leg(p, true, 0.1, ANKLE, 0.06, 0);
    leg(p, false, -0.16, ANKLE + 0.1, -0.06, -0.45);
    aimWorld(p, false, 0.12, -1, -0.05, 0.08);
    p.handR = 0.6;
    if (pos === 'DL' && c.number % 3 === 0) {
      aimWorld(p, true, 0.12, -1, 0.05, 0.08); // four-point
      p.handL = 0.6;
    } else {
      p.armL = 0.75;
      p.elbL = 1.1;
      p.armLx = -0.1;
    }
    return;
  }
  if (pos === 'QB') {
    if (c.underCenter) {
      p.hipsY = 0.85;
      p.hipZ = -0.5;
      p.spineZ = -0.2;
      p.headZ = 0.55;
      planted(p, 0.07);
      aimWorld(p, true, 0.55, -0.8, -0.1, 0.35);
      aimWorld(p, false, 0.55, -0.8, 0.1, 0.35);
      p.handL = 0.5;
      p.handR = 0.5;
    } else {
      p.hipsY = 0.93;
      p.hipZ = -0.18;
      p.spineZ = -0.08;
      planted(p, 0.06, 0.06);
      p.armL = 0.55;
      p.armR = 0.55;
      p.elbL = 1.5;
      p.elbR = 1.5;
      p.armLx = -0.2;
      p.armRx = 0.2;
    }
    return;
  }
  if (pos === 'RB' || pos === 'TE' || pos === 'LB') {
    // Two-point, hands resting just above the knees.
    p.hipsY = 0.86;
    p.hipZ = -0.6;
    p.spineZ = -0.12;
    p.headZ = 0.6;
    planted(p, 0.08);
    aimWorld(p, true, 0.22, -1, 0.02, 0.15);
    aimWorld(p, false, 0.22, -1, -0.02, 0.15);
    return;
  }
  if (pos === 'K' || pos === 'P') {
    p.hipsY = 0.97;
    planted(p, 0.04, 0.05);
    if (pos === 'P') {
      // Punter: hands out, waiting for the snap.
      aimWorld(p, true, 1, -0.3, 0.1, 0.35);
      aimWorld(p, false, 1, -0.3, -0.1, 0.35);
    }
    return;
  }
  // Receivers and everyone else: staggered stance, inside foot back on the toes.
  p.hipsY = 0.88;
  p.hipZ = -0.48;
  p.spineZ = -0.15;
  p.headZ = 0.45;
  leg(p, true, 0.26, ANKLE, 0.02, 0);
  leg(p, false, -0.3, ANKLE + 0.1, -0.02, -0.55);
  p.armL = -0.35;
  p.elbL = 1.2;
  p.armR = 0.65;
  p.elbR = 1.35;
}

/** Defenders waiting for the snap, and everyone between plays. */
function idle(p: Pose, c: AnimCtx) {
  const t = c.time + c.number * 1.7;
  const breathe = Math.sin(t * 2.1) * 0.025;
  if (c.presnap && !c.offense) {
    const db = c.pos === 'CB' || c.pos === 'S';
    // Ready position: knees bent, weight on the balls of the feet, hands up.
    p.hipsY = db ? 0.88 : 0.86 + Math.sin(t * 3) * 0.01;
    p.hipZ = db ? -0.38 : -0.5;
    p.spineZ = -0.12;
    p.headZ = 0.4;
    planted(p, db ? 0.05 : 0.09, db ? 0.1 : 0, db ? 0.04 : 0);
    p.armL = 0.6;
    p.armR = 0.6;
    p.elbL = 1.25;
    p.elbR = 1.25;
    p.chestZ = breathe;
    return;
  }
  if (!c.between) {
    // Standing still during a play: balanced, knees bent, hands ready.
    p.hipsY = 0.93;
    p.hipZ = -0.22;
    p.spineZ = -0.08;
    p.headZ = 0.2;
    planted(p, 0.07);
    p.armL = 0.45;
    p.armR = 0.45;
    p.elbL = 1.1;
    p.elbR = 1.1;
    p.chestZ = breathe;
    return;
  }
  planted(p, 0.05);
  p.hipsY = 0.975;
  p.chestZ = breathe;
  p.headZ = 0.05 + Math.sin(t * 0.7) * 0.06;
  switch (c.number % 3) {
    case 0: // hands on hips
      p.armL = -0.2;
      p.armLx = 0.75;
      p.armLy = -1.2;
      p.elbL = 1.6;
      p.armR = -0.2;
      p.armRx = -0.75;
      p.armRy = 1.2;
      p.elbR = 1.6;
      break;
    case 1: // arms loose, shifting weight
      p.armL = 0.05;
      p.armR = 0.1;
      p.elbL = 0.3;
      p.elbR = 0.4;
      p.hipYaw = Math.sin(t * 0.5) * 0.12;
      break;
    default: // hands on the knees, catching his breath
      p.hipsY = 0.9;
      p.hipZ = -0.55;
      p.spineZ = -0.25;
      p.headZ = 0.55;
      planted(p, 0.09);
      aimWorld(p, true, 0.28, -1, 0.04, 0.12);
      aimWorld(p, false, 0.28, -1, -0.04, 0.12);
      p.chestZ = breathe * 2;
  }
}

function celebrate(p: Pose, c: AnimCtx) {
  const t = c.time + c.number;
  const j = Math.abs(Math.sin(t * 7));
  planted(p, 0.06);
  switch (c.number % 5) {
    case 0: // jump, both arms up
      p.drop = j * 0.28;
      aimArm(p, true, 0.2, 1, 0.35, 0.2);
      aimArm(p, false, 0.2, 1, -0.35, 0.2);
      p.headZ = 0.4;
      leg(p, true, 0.05, ANKLE + j * 0.12, 0.05, -0.5 * j);
      leg(p, false, -0.05, ANKLE + j * 0.12, -0.05, -0.5 * j);
      break;
    case 1: // point to the sky
      aimArm(p, true, 0.3, 1, 0.1, 0);
      p.armR = 0.3;
      p.elbR = 1.6;
      p.headZ = 0.6;
      p.hipsY = 0.98 + j * 0.02;
      break;
    case 2: // flex
      p.armLx = 1.45;
      p.armRx = -1.45;
      p.armLy = 1.5;
      p.armRy = -1.5;
      p.elbL = 2.0;
      p.elbR = 2.0;
      p.spineZ = 0.1;
      p.headZ = 0.3;
      p.hipsY = 0.95 + j * 0.04;
      break;
    case 3: // high-knee dance
    {
      const h = Math.sin(t * 9);
      leg(p, true, 0.2 * Math.max(0, h), ANKLE + 0.35 * Math.max(0, h), 0.05, 0);
      leg(p, false, 0.2 * Math.max(0, -h), ANKLE + 0.35 * Math.max(0, -h), -0.05, 0);
      p.armL = 1.2 + h * 0.6;
      p.armR = 1.2 - h * 0.6;
      p.elbL = 1.3;
      p.elbR = 1.3;
      p.drop = 0.03;
      break;
    }
    default: // chest bump stance, arms wide
      aimArm(p, true, 0.3, 0.2, 1, 0.5);
      aimArm(p, false, 0.3, 0.2, -1, 0.5);
      p.spineZ = 0.25;
      p.chestZ = 0.15;
      p.headZ = 0.4;
  }
}

/** Ball tucked high and tight in one arm, the hand covering the point. */
function carry(p: Pose, left: boolean) {
  if (left) {
    p.armL = 0.3;
    p.armLx = -0.22;
    p.armLy = 0.15;
    p.elbL = 2.2;
    p.handL = 0.5;
  } else {
    p.armR = 0.3;
    p.armRx = 0.22;
    p.armRy = -0.15;
    p.elbR = 2.2;
    p.handR = 0.5;
  }
}

export function targetPose(c: AnimCtx): Pose {
  const p = restPose();
  const anim = c.anim;
  const kicker = c.pos === 'K' || c.pos === 'P';

  switch (anim) {
    case ANIM.Stance:
      stance(p, c);
      break;
    case ANIM.Idle:
      idle(p, c);
      break;
    case ANIM.Run:
      locomote(p, c);
      break;
    case ANIM.Juke: {
      locomote(p, c);
      // Plant the outside foot wide and push off it, body leaning into the cut.
      const s = c.cutSide;
      const k = 1 - smooth(0.15, 0.35, c.animT);
      leg(p, s < 0, 0.05, ANKLE, -s * 0.38 * k, 0);
      p.leanX = -s * 0.42 * k;
      p.hipsY -= 0.06 * k;
      p.chestTwist += s * 0.2 * k;
      break;
    }
    case ANIM.Spin:
      locomote(p, c, 0.5);
      p.armL = 0.7;
      p.armR = 0.7;
      p.elbL = 2.0;
      p.elbR = 2.0;
      p.armLx = -0.3;
      p.armRx = 0.3;
      p.hipsY -= 0.04;
      break;
    case ANIM.Stiff:
      locomote(p, c);
      // Free arm locked out toward the tackler.
      aimArm(p, !c.carryLeft, 1, 0.05, c.carryLeft ? -0.35 : 0.35, 0.02);
      if (c.carryLeft) p.handR = -0.7;
      else p.handL = -0.7;
      p.chestTwist += c.carryLeft ? -0.25 : 0.25;
      break;
    case ANIM.Truck:
      locomote(p, c);
      // Shoulder lowered, forearm up to deliver the blow.
      p.spineZ -= 0.45;
      p.chestZ -= 0.2;
      p.headZ = 0.75;
      p.chestTwist += c.carryLeft ? -0.4 : 0.4;
      if (c.carryLeft) {
        p.armR = 0.9;
        p.elbR = 1.9;
        p.armRx = 0.1;
      } else {
        p.armL = 0.9;
        p.elbL = 1.9;
        p.armLx = -0.1;
      }
      break;
    case ANIM.Stagger: {
      locomote(p, c, 0.6);
      const w = Math.sin(c.time * 13 + c.number);
      p.leanX = w * 0.22;
      p.spineZ -= 0.3;
      aimArm(p, true, 0.3, -0.2, 1, 0.4);
      aimArm(p, false, 0.3, -0.2 + w * 0.3, -1, 0.4);
      break;
    }
    case ANIM.Block: {
      const pass = c.offense && c.fwd < 0.3;
      p.hipsY = pass ? 0.87 : 0.82;
      p.hipZ = pass ? -0.35 : -0.6;
      if (c.speed > 0.7) locomote(p, c, 0.4, p.hipsY, p.hipZ);
      else {
        // Short choppy steps while the hands fight.
        const ch = c.time * 9 + c.number;
        leg(p, true, 0.08 + 0.04 * Math.sin(ch), ANKLE + Math.max(0, Math.sin(ch)) * 0.05, 0.1, 0);
        leg(p, false, -0.12 + 0.04 * Math.sin(ch + Math.PI), ANKLE + Math.max(0, Math.sin(ch + Math.PI)) * 0.05, -0.1, 0);
      }
      p.spineZ = -0.12;
      p.headZ = 0.55;
      const f = c.time * 8 + c.number * 0.7;
      aimWorld(p, true, 1, 0.08 + 0.08 * Math.sin(f), 0.05, 0.75 + 0.25 * Math.sin(f));
      aimWorld(p, false, 1, 0.08 + 0.08 * Math.sin(f + 2.1), -0.05, 0.75 + 0.25 * Math.sin(f + 2.1));
      p.handL = -0.6;
      p.handR = -0.6;
      break;
    }
    case ANIM.Throw:
      if (kicker) kickPose(p, c.animT, c.pos === 'P');
      else throwPose(p, c.animT);
      break;
    case ANIM.Catch:
      // Securing the catch: ball pulled into the chest with both arms.
      locomote(p, c, 0.4);
      p.armL = 0.75;
      p.armR = 0.75;
      p.elbL = 2.0;
      p.elbR = 2.0;
      p.armLx = -0.35;
      p.armRx = 0.35;
      p.spineZ -= 0.12;
      p.headZ = -0.2;
      break;
    case ANIM.Dive:
      // Laid out flat, arms reaching, legs trailing.
      Object.assign(p, {
        leanZ: -1.42, hipsY: 0.62, bodyX: -0.35, hipZ: 0, spineZ: 0.1, chestZ: 0.05, headZ: 0.5,
        legL: -0.2, legR: -0.35, kneeL: -0.3, kneeR: -0.15, legLx: 0.1, legRx: -0.1, footL: -0.7, footR: -0.7,
        armL: 3.0, armR: 3.0, armLx: -0.15, armRx: 0.15, elbL: 0.1, elbR: 0.1,
      });
      break;
    case ANIM.Down: {
      const s = c.downSide;
      Object.assign(p, {
        leanZ: -1.52 * s, hipsY: 1.0, drop: 0.15, bodyX: -0.95 * s, hipZ: 0, spineZ: 0.05 * s, headZ: 0.35 * s,
        legL: 0.15, legR: -0.1, kneeL: -0.3, kneeR: -0.65, legLx: 0.12, legRx: -0.05, footL: -0.5, footR: -0.3,
        armL: s > 0 ? 2.6 : 0.6, armR: s > 0 ? 2.2 : 0.9, armLx: 0.4, armRx: -0.5, elbL: 0.4, elbR: 0.9,
      });
      p.chestZ = Math.sin(c.time * 2.4 + c.number) * 0.02;
      break;
    }
    case ANIM.Celebrate:
      celebrate(p, c);
      break;
    case ANIM.Wrap:
      // Arms around the ball carrier, head up, legs driving.
      locomote(p, c, 0.3, 0.86, -0.55);
      p.spineZ = -0.2;
      p.headZ = 0.7;
      p.armL = 1.4;
      p.armR = 1.4;
      p.armLx = -0.5;
      p.armRx = 0.5;
      p.elbL = 1.25;
      p.elbR = 1.25;
      break;
    case ANIM.Hurdle:
      Object.assign(p, {
        hipsY: 1.0, hipZ: -0.25, spineZ: -0.2, headZ: 0.5,
        legL: 1.45, kneeL: -2.1, legR: -0.6, kneeR: -0.8, footL: 0.1, footR: -0.6,
        armL: 1.3, armR: 0.7, elbL: 0.5, elbR: 1.8,
      });
      break;
  }

  // Ball carrier: tucked high and tight, or both hands at the chest in the pocket.
  const tuckable = anim !== ANIM.Down && anim !== ANIM.Throw && anim !== ANIM.Celebrate && anim !== ANIM.Hurdle && anim !== ANIM.Dive && anim !== ANIM.Catch;
  if (c.carrier && tuckable) {
    if (c.pos === 'QB' && c.speed < 4.5 && (anim === ANIM.Idle || anim === ANIM.Run || anim === ANIM.Stance)) {
      // Both hands on the ball: at the chest while dropping back, then up by the
      // throwing shoulder once he's set, ready to let it go.
      const set = anim !== ANIM.Stance && c.speed < 1.6 ? 1 : 0;
      // Left hand reaches across to the ball at the right shoulder.
      const q = { ...p };
      aimWorld(q, true, 0.75, 0.05, -0.65, 0.4);
      p.armL = lerp(0.6, q.armL, set);
      p.armLx = lerp(-0.3, q.armLx, set);
      p.armLy = 0;
      p.elbL = lerp(1.9, q.elbL, set);
      p.armR = lerp(0.6, 0.45, set);
      p.elbR = lerp(1.9, 2.2, set);
      p.armRx = lerp(0.3, 0.05, set);
      p.armRy = lerp(0, -0.25, set);
    } else {
      carry(p, c.carryLeft);
    }
  }

  // Reaching for a pass that is about to arrive.
  if (c.reach && c.reach.w > 0 && !c.carrier && anim !== ANIM.Down && anim !== ANIM.Dive && anim !== ANIM.Block) {
    const r = c.reach;
    const w = r.w;
    const dx = Math.cos(r.pitch) * Math.cos(r.yaw);
    const dz = Math.cos(r.pitch) * Math.sin(r.yaw);
    const dy = Math.sin(r.pitch);
    const q = restPose();
    aimArm(q, true, dx, dy, dz + 0.12, 0.35);
    aimArm(q, false, dx, dy, dz - 0.12, 0.35);
    for (const k of ['armL', 'armR', 'armLx', 'armRx', 'armLy', 'armRy', 'elbL', 'elbR'] as const) p[k] = lerp(p[k], q[k], w);
    p.chestTwist = lerp(p.chestTwist, clamp(r.yaw * 0.5, -0.6, 0.6) - p.hipYaw, w);
  }

  // Head: follow the ball (or whatever the rig picked), within what a neck can do.
  if (c.look && anim !== ANIM.Down && anim !== ANIM.Dive && anim !== ANIM.Throw && anim !== ANIM.Celebrate) {
    const chestYaw = p.hipYaw + p.twist + p.chestTwist;
    const want = c.look.yaw - chestYaw;
    p.headY = clamp(want, -1.25, 1.25);
    // Turn the shoulders a little too when the neck runs out.
    const extra = clamp(want - p.headY, -0.5, 0.5);
    p.chestTwist += extra;
    p.headZ = clamp(p.headZ * 0.4 + c.look.pitch * 0.8, -0.5, 1.1);
  }

  // Getting up off the turf: through a kneel, then up.
  if (c.getUp >= 0 && c.getUp < 0.7) {
    const q = restPose();
    kneel(q);
    const w = 1 - smooth(0.3, 0.7, c.getUp);
    for (const k of POSE_KEYS) p[k] = lerp(p[k], q[k], w);
  }
  return p;
}
