// Low-poly football player model: one skinned body mesh (textured uniform) plus one
// skinned glossy helmet mesh, sharing a 12-bone skeleton. Every vertex is rigidly bound
// to one bone, so it animates like the segmented PS2-era models while costing only two
// draw calls per player.
//
// Units are yards. The model faces +X; +Z is the player's left.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const BONE = {
  root: 0, hips: 1, spine: 2, head: 3,
  shL: 4, elL: 5, shR: 6, elR: 7,
  thL: 8, knL: 9, thR: 10, knR: 11,
} as const;

/** Rest positions relative to parent, and parent index. */
const BONE_DEFS: [number, [number, number, number]][] = [
  [-1, [0, 0, 0]], // root
  [0, [0, 1.02, 0]], // hips
  [1, [0, 0.06, 0]], // spine
  [2, [0, 0.75, 0]], // head (neck base)
  [2, [0, 0.58, 0.31]], // shoulder L
  [4, [0, -0.3, 0]], // elbow L
  [2, [0, 0.58, -0.31]], // shoulder R
  [6, [0, -0.3, 0]], // elbow R
  [1, [0, -0.04, 0.11]], // thigh L
  [8, [0, -0.47, 0]], // knee L
  [1, [0, -0.04, -0.11]], // thigh R
  [10, [0, -0.47, 0]], // knee R
];

export const HIPS_REST_Y = 1.02;

export function makeSkeleton(): { bones: THREE.Bone[]; skeleton: THREE.Skeleton } {
  const bones = BONE_DEFS.map(([, p]) => {
    const b = new THREE.Bone();
    b.position.set(p[0], p[1], p[2]);
    return b;
  });
  BONE_DEFS.forEach(([parent], i) => {
    if (parent >= 0) bones[parent].add(bones[i]);
  });
  bones[0].updateMatrixWorld(true);
  return { bones, skeleton: new THREE.Skeleton(bones) };
}

// ---------------------------------------------------------------------------
// Uniform texture atlas: regions are in a 128x128 layout, painted at 2x (256x256)
// ---------------------------------------------------------------------------

type Region = [number, number, number, number];
export const ATLAS = {
  jersey: [0, 0, 128, 56] as Region, // torso wrap: top = collar, bottom = waist
  pads: [0, 56, 64, 16] as Region, // shoulder pads, caps, chest/back plates
  sleeve: [64, 56, 64, 16] as Region, // upper arm: sleeve on top, bicep below
  pants: [0, 72, 64, 24] as Region, // hips and thighs: top = belt, bottom = knee
  sock: [64, 72, 32, 24] as Region, // shin: pants cuff, sock, ankle tape
  skin: [96, 72, 32, 24] as Region, // forearm: elbow to taped wrist
  shoe: [0, 96, 32, 16] as Region,
  glove: [32, 96, 32, 16] as Region,
  belt: [64, 96, 32, 16] as Region,
  knee: [96, 96, 32, 16] as Region,
  neck: [0, 112, 32, 16] as Region,
  collar: [32, 112, 32, 16] as Region,
};
const S = 2; // paint scale

export interface UniformColors {
  jersey: string;
  trim: string;
  pants: string;
  pantsStripe: string;
  helmet: string;
  stripe: string;
  mask: string;
  socks: string;
  num: string;
  numOutline: string;
  glove: string;
}

function shadeHex(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * f);
  c.g = Math.min(1, c.g * f);
  c.b = Math.min(1, c.b * f);
  return '#' + c.getHexString();
}

function luma(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export const SKIN_TONES = ['#f1c9a5', '#e0ac7e', '#c58c62', '#a8714a', '#8d5a3b', '#5a3a26'];

let fontFamily = 'Arial Black, Impact, sans-serif';
/** Use the bundled condensed font for jersey numbers once it has loaded. */
export function setNumberFont(f: string) {
  fontFamily = f;
}

/**
 * Paint a uniform atlas with baked folds, trim and shading.
 * `number` < 0 paints a plain warm-up jacket (sideline players, crew).
 */
export function paintUniform(u: UniformColors, number: number, skin: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128 * S;
  const g = cv.getContext('2d')!;
  g.scale(S, S);
  let seed = (number + 3) * 7919 + u.jersey.length * 31 + skin.charCodeAt(1);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const lightCloth = luma(u.jersey) > 0.6;

  const fill = (r: Region, c: string) => {
    g.fillStyle = c;
    g.fillRect(r[0], r[1], r[2], r[3]);
  };
  /** Base color with darkening toward the sides of the wrapped cylinder (u = 0 and 0.5). */
  const wrapShade = (r: Region, c: string, amp: number) => {
    for (let x = 0; x < r[2]; x += 0.5) {
      const side = Math.abs(Math.cos((x / r[2]) * Math.PI * 2));
      g.fillStyle = shadeHex(c, 1.0 - side * amp);
      g.fillRect(r[0] + x, r[1], 0.6, r[3]);
    }
  };
  const vgrad = (r: Region, stops: [number, string][]) => {
    const gr = g.createLinearGradient(0, r[1], 0, r[1] + r[3]);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr;
    g.fillRect(r[0], r[1], r[2], r[3]);
  };
  const noise = (r: Region, amt: number) => {
    const img = g.getImageData(r[0] * S, r[1] * S, r[2] * S, r[3] * S);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * amt;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, r[0] * S, r[1] * S);
  };
  /** A soft fabric fold: a dark crease with a light ridge beside it. */
  const fold = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w = 1.1, strength = 1) => {
    g.save();
    g.filter = 'blur(0.7px)';
    g.lineCap = 'round';
    g.lineWidth = w;
    g.strokeStyle = `rgba(0,0,0,${(lightCloth ? 0.16 : 0.42) * strength})`;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(cx, cy, x1, y1);
    g.stroke();
    g.strokeStyle = `rgba(255,255,255,${(lightCloth ? 0.35 : 0.17) * strength})`;
    g.lineWidth = w * 0.8;
    g.beginPath();
    g.moveTo(x0 + 0.9, y0 + 0.3);
    g.quadraticCurveTo(cx + 0.9, cy + 0.3, x1 + 0.9, y1 + 0.3);
    g.stroke();
    g.restore();
  };
  const stain = (x: number, y: number, rad: number, a: number) => {
    g.save();
    g.filter = 'blur(1.2px)';
    g.fillStyle = rnd() < 0.5 ? `rgba(90,70,40,${a})` : `rgba(60,95,40,${a})`;
    g.beginPath();
    g.ellipse(x, y, rad * (0.6 + rnd()), rad * (0.4 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };

  // ---- Jersey (torso wrap). Front is at x=32, back at x=96, sides at x=0/64/128.
  const J = ATLAS.jersey;
  wrapShade(J, u.jersey, 0.24);
  // Side panels under the arms.
  g.fillStyle = shadeHex(u.trim, 0.85);
  for (const sx of [0, 64, 128]) g.fillRect(sx - 4, J[1] + 12, 8, J[3] - 12);
  if (number >= 0) {
    g.font = `800 30px ${fontFamily}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const [cx, size] of [[32, 28], [96, 33]] as const) {
      g.font = `800 ${size}px ${fontFamily}`;
      g.lineWidth = 4.5;
      g.strokeStyle = u.numOutline;
      g.strokeText(String(number), cx, J[1] + 30);
      g.fillStyle = u.num;
      g.fillText(String(number), cx, J[1] + 30);
    }
  } else {
    g.fillStyle = shadeHex(u.jersey, 0.55);
    g.fillRect(31.4, J[1], 1.2, J[3]); // zipper
    g.fillStyle = u.trim;
    g.fillRect(10, J[1] + 14, 14, 2.5); // chest stripe
    g.fillRect(74, J[1] + 10, 44, 3); // back yoke stripe
  }
  // Mesh weave.
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = J[1]; y < J[1] + J[3]; y += 1.5) for (let x = J[0] + ((y / 1.5) % 2) * 0.75; x < J[2]; x += 1.5) g.fillRect(x, y, 0.5, 0.5);
  // Ambient occlusion under the shoulder pads, tuck shadow at the waist.
  vgrad(J, [[0, 'rgba(0,0,0,0.42)'], [0.12, 'rgba(0,0,0,0.12)'], [0.25, 'rgba(255,255,255,0.06)'], [0.7, 'rgba(0,0,0,0)'], [0.92, 'rgba(0,0,0,0.22)'], [1, 'rgba(0,0,0,0.45)']]);
  // Folds: from each armpit down toward the waist.
  for (const sx of [0, 64, 128]) {
    for (let k = 0; k < 4; k++) {
      for (const dir of [-1, 1]) {
        if ((sx === 0 && dir < 0) || (sx === 128 && dir > 0)) continue;
        const x0 = sx + dir * (3 + k * 2.5);
        const x1 = sx + dir * (9 + k * 4.5 + rnd() * 3);
        fold(x0, J[1] + 4 + k * 3, x0 + dir * 3, J[1] + 18 + k * 4, x1, J[1] + 32 + k * 5 + rnd() * 4, 1.0, 0.9 - k * 0.12);
      }
    }
  }
  // Bunching where the jersey tucks into the pants.
  for (let x = 2; x < 128; x += 5 + rnd() * 4) {
    const y = J[1] + 46 + rnd() * 6;
    fold(x, y, x + 2.5, y - 2 - rnd() * 2, x + 5 + rnd() * 2, y + 1, 0.9, 0.8);
  }
  // Stretch lines across the chest and back from the pads.
  for (const cx of [32, 96]) {
    for (let k = 0; k < 3; k++) {
      const y = J[1] + 7 + k * 2.5;
      fold(cx - 18 + rnd() * 4, y, cx, y + 1.8, cx + 18 - rnd() * 4, y, 0.7, 0.5);
    }
  }
  // Collar: trimmed V-neck in front, banded collar in back.
  if (number >= 0) {
    g.fillStyle = u.trim;
    g.beginPath();
    g.moveTo(32 - 9, J[1]);
    g.lineTo(32 + 9, J[1]);
    g.lineTo(32, J[1] + 11);
    g.closePath();
    g.fill();
    g.fillStyle = shadeHex(u.jersey, 0.45);
    g.beginPath();
    g.moveTo(32 - 6, J[1]);
    g.lineTo(32 + 6, J[1]);
    g.lineTo(32, J[1] + 7.5);
    g.closePath();
    g.fill();
  }
  g.fillStyle = u.trim;
  g.fillRect(84, J[1], 24, 2.6);
  // Occasional grass/dirt stains.
  for (let i = 0; i < 3; i++) if (rnd() < 0.35) stain(rnd() * 128, J[1] + 20 + rnd() * 34, 2.2, 0.25);
  noise(J, 9);

  // ---- Shoulder pads: jersey stretched tight, with shine, seams and shoulder stripes.
  const P = ATLAS.pads;
  fill(P, shadeHex(u.jersey, 1.04));
  vgrad(P, [[0, 'rgba(255,255,255,0.28)'], [0.45, 'rgba(255,255,255,0.05)'], [1, 'rgba(0,0,0,0.3)']]);
  fill([P[0], P[1] + 9, P[2], 1.6], u.trim);
  fill([P[0], P[1] + 11.8, P[2], 1.6], u.trim);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 0.4;
  g.setLineDash([1, 1]);
  for (const x of [16, 32, 48]) {
    g.beginPath();
    g.moveTo(x, P[1]);
    g.lineTo(x, P[1] + P[3]);
    g.stroke();
  }
  g.setLineDash([]);
  noise(P, 7);

  // ---- Upper arm: short sleeve with stripes and a cuff, bicep below.
  const A = ATLAS.sleeve;
  fill(A, u.jersey);
  wrapShade([A[0], A[1], A[2], 9], u.jersey, 0.2);
  fill([A[0], A[1] + 4.2, A[2], 1.4], u.trim);
  fill([A[0], A[1] + 6.4, A[2], 1.4], u.trim);
  fill([A[0], A[1] + 8.4, A[2], 0.8], shadeHex(u.jersey, 0.6)); // cuff hem
  wrapShade([A[0], A[1] + 9.2, A[2], A[3] - 9.2], skin, 0.18);
  vgrad([A[0], A[1] + 9.2, A[2], 2.5], [[0, 'rgba(0,0,0,0.4)'], [1, 'rgba(0,0,0,0)']]); // sleeve shadow on the arm
  for (let k = 0; k < 3; k++) fold(A[0] + 8 + k * 18, A[1] + 1, A[0] + 12 + k * 18, A[1] + 4, A[0] + 9 + k * 18, A[1] + 8, 0.8, 0.7);
  noise(A, 6);

  // ---- Pants: side stripes, belt shadow, hip folds and knee creases.
  const PT = ATLAS.pants;
  wrapShade(PT, u.pants, 0.17);
  g.fillStyle = u.pantsStripe;
  g.fillRect(PT[0], PT[1], 1.6, PT[3]);
  g.fillRect(PT[0] + 30.2, PT[1], 3.6, PT[3]);
  g.fillRect(PT[0] + 62.4, PT[1], 1.6, PT[3]);
  vgrad(PT, [[0, 'rgba(0,0,0,0.35)'], [0.15, 'rgba(0,0,0,0)'], [0.8, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.25)']]);
  for (const cx of [16, 48]) {
    fold(cx - 6, PT[1] + 2, cx - 4, PT[1] + 8, cx - 1, PT[1] + 12, 0.9, 0.7);
    fold(cx + 5, PT[1] + 3, cx + 3, PT[1] + 9, cx + 1, PT[1] + 14, 0.9, 0.6);
    for (let k = 0; k < 3; k++) {
      const y = PT[1] + 18.5 + k * 1.8;
      fold(cx - 7, y, cx, y + 1.2, cx + 7, y - 0.3, 0.7, 0.75); // knee creases
    }
  }
  if (rnd() < 0.55) stain(16 + (rnd() - 0.5) * 8, PT[1] + 20, 3, 0.35); // grass on the knees
  if (rnd() < 0.4) stain(48 + (rnd() - 0.5) * 8, PT[1] + 21, 2.6, 0.3);
  noise(PT, 8);

  // ---- Shin: pants cuff over the knee, striped game socks, taped ankles.
  const SK = ATLAS.sock;
  wrapShade([SK[0], SK[1], SK[2], 4.5], u.pants, 0.15);
  fill([SK[0], SK[1] + 4.5, SK[2], 0.9], 'rgba(0,0,0,0.45)'); // cuff hem shadow
  wrapShade([SK[0], SK[1] + 5.4, SK[2], 13], u.socks, 0.2);
  const band = lightCloth && luma(u.socks) > 0.6 ? u.trim : '#f4f3ee';
  fill([SK[0], SK[1] + 9, SK[2], 1.6], band);
  fill([SK[0], SK[1] + 11.4, SK[2], 1.6], band);
  for (let k = 0; k < 4; k++) fold(SK[0] + 3 + k * 8, SK[1] + 6, SK[0] + 5 + k * 8, SK[1] + 12, SK[0] + 4 + k * 8, SK[1] + 17, 0.6, 0.5);
  wrapShade([SK[0], SK[1] + 18.4, SK[2], 5.6], '#efeee8', 0.15); // tape / spats
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 0.4;
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    g.moveTo(SK[0] + k * 6, SK[1] + 18.4);
    g.lineTo(SK[0] + k * 6 + 4, SK[1] + 24);
    g.stroke();
  }
  noise(SK, 6);

  // ---- Forearm: skin with a taped wrist.
  const F = ATLAS.skin;
  wrapShade(F, skin, 0.16);
  wrapShade([F[0], F[1] + 19, F[2], 5], '#f1f0ea', 0.12);
  fill([F[0], F[1] + 18.6, F[2], 0.6], 'rgba(0,0,0,0.25)');
  noise(F, 6);
  wrapShade(ATLAS.neck, skin, 0.16);
  vgrad(ATLAS.neck, [[0, 'rgba(0,0,0,0.35)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);

  // ---- Collar ring, cleats, gloves, belt, knee pads.
  fill(ATLAS.collar, u.trim);
  vgrad(ATLAS.collar, [[0, 'rgba(255,255,255,0.25)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.4)']]);
  const SH = ATLAS.shoe;
  fill(SH, '#141414');
  fill([SH[0], SH[1] + 5, SH[2], 2.5], u.socks);
  fill([SH[0], SH[1] + 12, SH[2], 4], '#e9e9e4'); // sole
  const GL = ATLAS.glove;
  fill(GL, u.glove);
  fill([GL[0] + 8, GL[1], 16, GL[3]], shadeHex(u.glove, 0.7)); // palm
  fill([GL[0], GL[1] + 12, GL[2], 4], '#1a1a1a'); // wrist strap
  const BL = ATLAS.belt;
  fill(BL, '#161616');
  fill([BL[0] + 14, BL[1] + 4, 4, 8], '#8a8a8a');
  const KN = ATLAS.knee;
  wrapShade(KN, shadeHex(u.pants, 1.08), 0.2);
  vgrad(KN, [[0, 'rgba(255,255,255,0.2)'], [1, 'rgba(0,0,0,0.25)']]);
  if (rnd() < 0.5) stain(KN[0] + 8, KN[1] + 8, 3, 0.3);
  return cv;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface PartOpts {
  bone: number;
  region?: Region;
  color?: string;
  pos: [number, number, number];
  scale?: [number, number, number];
  rotZ?: number;
}

function finishPart(geo: THREE.BufferGeometry, o: PartOpts): THREE.BufferGeometry {
  const g = geo;
  if (o.scale) g.scale(o.scale[0], o.scale[1], o.scale[2]);
  if (o.rotZ) g.rotateZ(o.rotZ);
  g.translate(o.pos[0], o.pos[1], o.pos[2]);
  const n = g.attributes.position.count;
  if (o.region) {
    const [x, y, w, h] = o.region;
    const u0 = x / 128;
    const u1 = (x + w) / 128;
    const v0 = 1 - (y + h) / 128;
    const v1 = 1 - y / 128;
    const uv = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  }
  const idx = new Uint16Array(n * 4);
  const wts = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = o.bone;
    wts[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  if (o.color) {
    const c = new THREE.Color(o.color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  return g;
}

const cyl = (rt: number, rb: number, h: number, seg: number) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
const sph = (r: number, ws: number, hs: number) => new THREE.SphereGeometry(r, ws, hs);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** The textured body (everything except the helmet). Built once and shared. */
export function buildBodyGeometry(): THREE.BufferGeometry {
  const A = ATLAS;
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, o: PartOpts) => parts.push(finishPart(geo, o));

  // Hips / pants waist and belt.
  add(cyl(0.17, 0.185, 0.24, 10), { bone: BONE.hips, region: A.pants, pos: [0, 1.0, 0], scale: [0.86, 1, 1.15] });
  add(cyl(0.177, 0.177, 0.04, 10), { bone: BONE.hips, region: A.belt, pos: [0, 1.115, 0], scale: [0.88, 1, 1.16] });
  // V-shaped torso.
  add(cyl(0.24, 0.175, 0.52, 10), { bone: BONE.spine, region: A.jersey, pos: [0, 1.38, 0], scale: [0.8, 1, 1.18] });
  // Chest and back plates of the pads push the jersey out, so the torso isn't a plain tube.
  add(sph(0.2, 10, 6), { bone: BONE.spine, region: A.pads, pos: [0.075, 1.55, 0], scale: [0.62, 0.72, 1.32] });
  add(sph(0.2, 10, 6), { bone: BONE.spine, region: A.pads, pos: [-0.07, 1.57, 0], scale: [0.56, 0.68, 1.28] });
  // Shoulder pads: bulky yoke, raised caps and a collar ring.
  add(cyl(0.22, 0.3, 0.18, 10), { bone: BONE.spine, region: A.pads, pos: [0, 1.71, 0], scale: [0.98, 1, 1.47] });
  for (const z of [0.322, -0.322]) {
    add(sph(0.148, 9, 6), { bone: BONE.spine, region: A.pads, pos: [0, 1.715, z], scale: [1.08, 0.86, 1.0] });
  }
  add(cyl(0.105, 0.125, 0.055, 10), { bone: BONE.spine, region: A.collar, pos: [0, 1.81, 0], scale: [1.0, 1, 1.15] });
  // Neck.
  add(cyl(0.066, 0.076, 0.13, 7), { bone: BONE.spine, region: A.neck, pos: [0, 1.83, 0] });
  // Arms, with deltoid flaps of the pads riding on the upper arm.
  for (const [sh, el, z] of [[BONE.shL, BONE.elL, 0.31], [BONE.shR, BONE.elR, -0.31]] as const) {
    const out = Math.sign(z);
    add(sph(0.115, 8, 5), { bone: sh, region: A.pads, pos: [0, 1.6, z + out * 0.05], scale: [1.0, 1.15, 0.7] });
    add(cyl(0.085, 0.065, 0.3, 8), { bone: sh, region: A.sleeve, pos: [0, 1.51, z] });
    add(cyl(0.062, 0.048, 0.26, 7), { bone: el, region: A.skin, pos: [0, 1.23, z] });
    add(sph(0.062, 7, 4), { bone: el, region: A.glove, pos: [0.01, 1.07, z], scale: [1.1, 1.25, 0.8] });
  }
  // Legs.
  for (const [th, kn, z] of [[BONE.thL, BONE.knL, 0.11], [BONE.thR, BONE.knR, -0.11]] as const) {
    add(cyl(0.114, 0.083, 0.47, 9), { bone: th, region: A.pants, pos: [0, 0.745, z] });
    add(sph(0.075, 7, 5), { bone: kn, region: A.knee, pos: [0.036, 0.52, z], scale: [0.9, 1.1, 1] });
    add(cyl(0.076, 0.052, 0.43, 8), { bone: kn, region: A.sock, pos: [0, 0.295, z] });
    add(box(0.27, 0.09, 0.12), { bone: kn, region: A.shoe, pos: [0.055, 0.045, z] });
  }
  // Keep each part's own smooth normals (Gouraud-style shading, like the PS2).
  return mergeGeometries(parts, false)!;
}

/** Glossy helmet with facemask and stripe, colored per team with vertex colors. */
export function buildHelmetGeometry(shell: string, stripe: string, mask: string): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, o: PartOpts) => parts.push(finishPart(geo, o));
  const H = BONE.head;
  const cy = 1.95;
  add(sph(0.16, 10, 8), { bone: H, color: shell, pos: [-0.012, cy, 0], scale: [1.12, 1.0, 0.98] });
  // Stripe: two narrow longitude wedges running front-to-back over the crown.
  const back = new THREE.SphereGeometry(0.1625, 2, 8, -0.13, 0.26, 0, 1.75);
  const front = new THREE.SphereGeometry(0.1625, 2, 8, Math.PI - 0.13, 0.26, 0, 1.05);
  add(back, { bone: H, color: stripe, pos: [-0.012, cy, 0], scale: [1.125, 1.0, 0.985] });
  add(front, { bone: H, color: stripe, pos: [-0.012, cy, 0], scale: [1.125, 1.0, 0.985] });
  // Facemask cage.
  for (const [y, x] of [[1.925, 0.162], [1.875, 0.17], [1.825, 0.158]]) {
    add(box(0.028, 0.024, 0.25), { bone: H, color: mask, pos: [x, y, 0] });
  }
  for (const z of [0.11, -0.11]) add(box(0.03, 0.14, 0.024), { bone: H, color: mask, pos: [0.14, 1.88, z] });
  add(box(0.028, 0.1, 0.022), { bone: H, color: mask, pos: [0.17, 1.86, 0] });
  // Chin strap / jaw pads in the shell color.
  for (const z of [0.12, -0.12]) add(box(0.09, 0.06, 0.03), { bone: H, color: shell, pos: [0.06, 1.83, z] });
  // Keep each part's own smooth normals (Gouraud-style shading, like the PS2).
  return mergeGeometries(parts, false)!;
}
