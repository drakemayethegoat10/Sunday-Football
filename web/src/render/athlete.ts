// Low-poly football player model: one skinned body mesh (textured uniform) plus one
// skinned glossy helmet mesh, sharing a 17-bone skeleton, so each player costs two draw
// calls. Limbs and the torso are continuous tubes whose vertices blend between the bones
// on either side of a joint, so knees, elbows and the waist bend without gaps. Hands,
// cleats, a face behind the facemask and shoulder-pad numbers add the detail.
//
// Units are yards. The model faces +X with +Y up, so the player's left is -Z ("L" bones)
// and his right is +Z ("R" bones).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const BONE = {
  root: 0, hips: 1, spine: 2, head: 3,
  shL: 4, elL: 5, shR: 6, elR: 7,
  thL: 8, knL: 9, thR: 10, knR: 11,
  footL: 12, footR: 13, handL: 14, handR: 15, chest: 16,
} as const;

/**
 * Rest positions relative to parent, and parent index. World heights at rest: hips 1.02,
 * waist (spine) 1.08, chest 1.38, neck base 1.83, shoulders 1.66, elbows 1.36, wrists
 * 1.10, hip joints 0.98, knees 0.51, ankles 0.09.
 */
const BONE_DEFS: [number, [number, number, number]][] = [
  [-1, [0, 0, 0]], // root
  [0, [0, 1.02, 0]], // hips
  [1, [0, 0.06, 0]], // spine (waist)
  [16, [0, 0.45, 0]], // head (neck base)
  [16, [0, 0.28, -0.31]], // shoulder L
  [4, [0, -0.3, 0]], // elbow L
  [16, [0, 0.28, 0.31]], // shoulder R
  [6, [0, -0.3, 0]], // elbow R
  [1, [0, -0.04, -0.11]], // thigh L
  [8, [0, -0.47, 0]], // knee L
  [1, [0, -0.04, 0.11]], // thigh R
  [10, [0, -0.47, 0]], // knee R
  [9, [0, -0.42, 0]], // ankle L
  [11, [0, -0.42, 0]], // ankle R
  [5, [0, -0.26, 0]], // wrist L
  [7, [0, -0.26, 0]], // wrist R
  [2, [0, 0.3, 0]], // chest
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
  face: [64, 112, 32, 16] as Region, // head wrap: front (the face) at x = 72
  shnum: [96, 112, 32, 16] as Region, // shoulder-pad caps: number on the outside
  /** Sub-regions of the ones above. */
  sole: [0, 108, 32, 4] as Region,
  tape: [64, 90.4, 32, 5.6] as Region,
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

  // ---- Face (seen through the facemask): front at x = 72; chin at the bottom.
  const FC = ATLAS.face;
  wrapShade(FC, skin, 0.22);
  vgrad(FC, [[0, 'rgba(0,0,0,0.35)'], [0.35, 'rgba(0,0,0,0.05)'], [0.8, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']]);
  const fx = FC[0] + 8;
  g.fillStyle = shadeHex(skin, 0.62); // brow shadow
  g.fillRect(fx - 4, FC[1] + 6.2, 8, 1.4);
  g.fillStyle = '#16110d'; // eyes
  for (const ex of [-2, 2]) g.fillRect(fx + ex - 0.7, FC[1] + 7.8, 1.4, 0.8);
  if (rnd() < 0.6) {
    g.fillStyle = '#0d0d0d'; // eye black
    for (const ex of [-2, 2]) g.fillRect(fx + ex - 0.9, FC[1] + 9.1, 1.8, 0.6);
  }
  g.fillStyle = shadeHex(skin, 0.8); // nose shade
  g.fillRect(fx - 0.5, FC[1] + 8.4, 1, 2);
  g.fillStyle = shadeHex(skin, 0.5); // mouth
  g.fillRect(fx - 1.3, FC[1] + 12.2, 2.6, 0.45);

  // ---- Shoulder-pad caps: the jersey stretched over them, with the number on top.
  const SN = ATLAS.shnum;
  fill(SN, shadeHex(u.jersey, 1.04));
  vgrad(SN, [[0, 'rgba(255,255,255,0.3)'], [0.55, 'rgba(255,255,255,0.04)'], [1, 'rgba(0,0,0,0.32)']]);
  fill([SN[0], SN[1] + 12.2, SN[2], 1.3], u.trim);
  if (number >= 0) {
    g.font = `800 7.5px ${fontFamily}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 1.4;
    g.strokeStyle = u.numOutline;
    g.strokeText(String(number), SN[0] + 16, SN[1] + 6.6);
    g.fillStyle = u.num;
    g.fillText(String(number), SN[0] + 16, SN[1] + 6.6);
  }
  noise(SN, 6);
  return cv;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Skin weights for a vertex at world height y: [bone A, bone B, weight of B]. */
type Weigh = (y: number) => [number, number, number];
/** Bone `upper` above `top`, bone `lower` below `bot`, a smooth blend in between. */
function blend(upper: number, lower: number, top: number, bot: number): Weigh {
  return (y) => {
    const t = Math.min(1, Math.max(0, (top - y) / (top - bot)));
    return [upper, lower, t * t * (3 - 2 * t)];
  };
}

interface PartOpts {
  bone: number | Weigh;
  region?: Region;
  color?: string;
  pos: [number, number, number];
  scale?: [number, number, number];
  rot?: [number, number, number];
}

function setRegionUV(g: THREE.BufferGeometry, region: Region) {
  const [x, y, w, h] = region;
  const u0 = x / 128;
  const u1 = (x + w) / 128;
  const v0 = 1 - (y + h) / 128;
  const v1 = 1 - y / 128;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
}

function setWeights(g: THREE.BufferGeometry, bone: number | Weigh) {
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const wts = new Float32Array(n * 4);
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const [a, b, t] = typeof bone === 'number' ? [bone, bone, 0] : bone(pos.getY(i));
    idx[i * 4] = a;
    idx[i * 4 + 1] = b;
    wts[i * 4] = 1 - t;
    wts[i * 4 + 1] = t;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
}

function setColor(g: THREE.BufferGeometry, color: string) {
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
}

function finishPart(geo: THREE.BufferGeometry, o: PartOpts): THREE.BufferGeometry {
  const g = geo;
  if (o.scale) g.scale(o.scale[0], o.scale[1], o.scale[2]);
  if (o.rot) {
    if (o.rot[0]) g.rotateX(o.rot[0]);
    if (o.rot[1]) g.rotateY(o.rot[1]);
    if (o.rot[2]) g.rotateZ(o.rot[2]);
  }
  g.translate(o.pos[0], o.pos[1], o.pos[2]);
  if (o.region) setRegionUV(g, o.region);
  setWeights(g, o.bone);
  if (o.color) setColor(g, o.color);
  return g;
}

/**
 * One cross-section of a tube: an ellipse at height y with half-depth rx (front-back,
 * along x) and half-width rz (side to side), centered at (ox, y, oz).
 */
type Ring = [y: number, rx: number, rz: number, ox?: number];

/**
 * A closed tube through elliptical rings (listed bottom to top), with smooth normals
 * and no seam. u wraps around (front, +x, at u = 0.25 like the uniform atlas), v runs
 * bottom to top. Positions are in world space at the rest pose.
 */
function tube(rings: Ring[], segs: number, cx: number, cz: number): THREE.BufferGeometry {
  const cols = segs + 1;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const y0 = rings[0][0];
  const y1 = rings[rings.length - 1][0];
  rings.forEach((r, j) => {
    const [y, rx, rz, ox = 0] = r;
    const prev = rings[Math.max(0, j - 1)];
    const next = rings[Math.min(rings.length - 1, j + 1)];
    const dy = next[0] - prev[0] || 1e-3;
    // Slope of the (average) radius along the tube tilts the normal up or down.
    const slope = ((next[1] + next[2]) / 2 - (prev[1] + prev[2]) / 2) / dy;
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const sx = Math.sin(th);
      const cz2 = Math.cos(th);
      pos.push(cx + ox + rx * sx, y, cz + rz * cz2);
      let nx = sx / Math.max(rx, 1e-4);
      let nz = cz2 / Math.max(rz, 1e-4);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      const ny = -slope;
      const m = Math.hypot(nx, ny, nz) || 1;
      if (rx < 1e-4 && rz < 1e-4) nor.push(0, j === 0 ? -1 : 1, 0);
      else nor.push(nx / m, ny / m, nz / m);
      uv.push(i / segs, (y - y0) / (y1 - y0 || 1));
    }
  });
  const index: number[] = [];
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < segs; i++) {
      const a = (j + 1) * cols + i; // top row
      const b = j * cols + i; // bottom row
      const c = j * cols + i + 1;
      const d = (j + 1) * cols + i + 1;
      index.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

const cyl = (rt: number, rb: number, h: number, seg: number) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
const sph = (r: number, ws: number, hs: number) => new THREE.SphereGeometry(r, ws, hs);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Extra gear: 0 none, 1 skill player (towel at the belt), 2 lineman (neck roll). */
export type Gear = 0 | 1 | 2;

/**
 * The textured body (everything except the helmet). `detail` 1 is the on-field model;
 * lower values are for the sideline squads.
 */
export function buildBodyGeometry(gear: Gear = 0, detail = 1): THREE.BufferGeometry {
  const A = ATLAS;
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, o: PartOpts) => parts.push(finishPart(geo, o));
  const addTube = (rings: Ring[], segs: number, region: Region, bone: number | Weigh, cz = 0) => {
    const g = tube(rings, Math.max(6, Math.round(segs * detail)), 0, cz);
    setRegionUV(g, region);
    setWeights(g, bone);
    parts.push(g);
  };
  const seg = (n: number) => Math.max(5, Math.round(n * detail));

  // Pants: seat and hips (closed at the crotch), and the belt.
  addTube([[0.84, 0.05, 0.07], [0.875, 0.13, 0.175], [0.95, 0.158, 0.205, -0.012], [1.04, 0.152, 0.195], [1.125, 0.146, 0.186]], 14, A.pants, BONE.hips);
  addTube([[1.095, 0.153, 0.194], [1.145, 0.151, 0.191]], 14, A.belt, BONE.hips);

  // Torso under the jersey: bends at the waist and the chest.
  addTube(
    [[1.08, 0.142, 0.18], [1.17, 0.148, 0.188], [1.28, 0.16, 0.2, 0.008], [1.4, 0.172, 0.222, 0.014], [1.52, 0.18, 0.248, 0.012], [1.62, 0.176, 0.262], [1.72, 0.15, 0.24], [1.79, 0.1, 0.13]],
    16, A.jersey, blend(BONE.spine, BONE.chest, 1.22, 1.42),
  );
  // Shoulder pads: a broad yoke over the shoulders, open at the neck.
  addTube([[1.54, 0.186, 0.27], [1.59, 0.205, 0.315], [1.66, 0.214, 0.348], [1.72, 0.2, 0.345], [1.77, 0.16, 0.29], [1.805, 0.118, 0.17]], 16, A.pads, BONE.chest);
  // Raised caps on top of each shoulder, number on the outside.
  for (const side of [1, -1]) {
    // Most of a sphere, centered on the outside (u = 0.5 there, where the number is).
    const cap = new THREE.SphereGeometry(0.14, seg(12), seg(6), (side > 0 ? 0.5 : 1.5) * Math.PI - 0.65 * Math.PI, 1.3 * Math.PI, 0, 1.75);
    add(cap, { bone: BONE.chest, region: A.shnum, pos: [0, 1.7, side * 0.29], scale: [1.08, 0.72, 0.85] });
  }
  addTube([[1.775, 0.112, 0.135], [1.83, 0.088, 0.104]], 12, A.collar, BONE.chest);
  if (gear === 2) {
    // Neck roll riding on the back of the pads.
    const roll = new THREE.TorusGeometry(0.115, 0.034, seg(6), seg(12), Math.PI * 1.15);
    add(roll, { bone: BONE.chest, region: A.collar, pos: [-0.015, 1.82, 0], rot: [Math.PI / 2, -Math.PI * 0.425, 0] });
  }
  // Neck and head (the face shows through the facemask).
  addTube([[1.79, 0.064, 0.07], [1.86, 0.062, 0.066], [1.92, 0.06, 0.062]], 10, A.neck, blend(BONE.chest, BONE.head, 1.85, 1.89));
  addTube(
    [[1.85, 0.0, 0.0, 0.035], [1.855, 0.035, 0.04, 0.032], [1.875, 0.07, 0.07, 0.02], [1.91, 0.094, 0.084, 0.006], [1.96, 0.1, 0.09], [2.01, 0.095, 0.086, -0.005], [2.05, 0.07, 0.066, -0.01], [2.07, 0.0, 0.0, -0.01]],
    14, A.face, BONE.head,
  );
  add(box(0.03, 0.036, 0.026), { bone: BONE.head, region: A.neck, pos: [0.1, 1.94, 0], rot: [0, 0, 0.3] });

  // Arms: sleeve and biceps, forearm, gloved hand with a thumb; pad flaps on the deltoids.
  for (const [sh, el, hd, z] of [[BONE.shL, BONE.elL, BONE.handL, -0.31], [BONE.shR, BONE.elR, BONE.handR, 0.31]] as const) {
    const out = Math.sign(z);
    add(sph(0.11, seg(8), seg(6)), { bone: sh, region: A.pads, pos: [0, 1.62, z + out * 0.05], scale: [1.0, 1.1, 0.72] });
    const elbow = blend(sh, el, 1.42, 1.32);
    addTube([[1.36, 0.058, 0.058], [1.41, 0.066, 0.064], [1.5, 0.08, 0.075, 0.008], [1.6, 0.084, 0.08], [1.7, 0.075, 0.075]], 10, A.sleeve, elbow, z);
    addTube([[1.09, 0.04, 0.036], [1.12, 0.042, 0.038], [1.2, 0.052, 0.048], [1.29, 0.06, 0.055, 0.004], [1.36, 0.058, 0.058]], 10, A.skin, elbow, z);
    add(sph(0.048, seg(8), seg(6)), { bone: hd, region: A.glove, pos: [0.004, 1.055, z], scale: [0.8, 1.05, 0.52] });
    add(sph(0.044, seg(8), seg(5)), { bone: hd, region: A.glove, pos: [0.014, 0.99, z], scale: [0.82, 0.95, 0.44], rot: [0, 0, 0.18] });
    add(cyl(0.0145, 0.012, 0.052, 5), { bone: hd, region: A.glove, pos: [0.042, 1.06, z - out * 0.006], rot: [0, 0, 0.55] });
  }

  // Legs: pants over the thigh and knee pad, then the sock and calf; cleats on the ankle.
  for (const [th, kn, ft, z] of [[BONE.thL, BONE.knL, BONE.footL, -0.11], [BONE.thR, BONE.knR, BONE.footR, 0.11]] as const) {
    const knee = blend(th, kn, 0.56, 0.46);
    addTube([[0.49, 0.08, 0.078, 0.01], [0.55, 0.086, 0.082, 0.014], [0.62, 0.09, 0.088, 0.004], [0.72, 0.104, 0.1, 0.008], [0.84, 0.118, 0.112, 0.008], [0.95, 0.122, 0.12, -0.005], [1.04, 0.118, 0.118]], 12, A.pants, knee, z);
    addTube([[0.085, 0.046, 0.046], [0.13, 0.044, 0.044], [0.2, 0.05, 0.048, -0.004], [0.29, 0.066, 0.06, -0.01], [0.37, 0.078, 0.07, -0.016], [0.44, 0.074, 0.072, -0.004], [0.49, 0.08, 0.078, 0.01]], 12, A.sock, knee, z);
    add(cyl(0.052, 0.056, 0.075, seg(10)), { bone: ft, region: A.tape, pos: [0, 0.1, z] });
    add(sph(0.1, seg(10), seg(7)), { bone: ft, region: A.shoe, pos: [0.062, 0.062, z], scale: [1.42, 0.6, 0.58] });
    add(box(0.29, 0.024, 0.104), { bone: ft, region: A.sole, pos: [0.066, 0.012, z] });
  }
  if (gear === 1) {
    // Towel tucked into the front of the belt.
    add(box(0.085, 0.2, 0.012), { bone: BONE.hips, region: A.tape, pos: [0.14, 1.0, 0.075], rot: [0, -0.55, 0.12] });
  }
  return mergeGeometries(parts, false)!;
}

/** Flip a closed shape inside out (for the helmet's dark lining). */
function insideOut(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    idx.setX(i, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/**
 * Glossy helmet, colored per team with vertex colors: a shell open at the face with a
 * dark lining, a center stripe, ear holes, jaw pads, a back bumper, a chin strap and a
 * wire facemask.
 */
export function buildHelmetGeometry(shell: string, stripe: string, mask: string, detail = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = (v: number) => Math.max(3, Math.round(v * detail));
  const add = (geo: THREE.BufferGeometry, o: PartOpts) => {
    geo.deleteAttribute('uv');
    parts.push(finishPart(geo, o));
  };
  const H = BONE.head;
  const cy = 1.95;
  const sc: [number, number, number] = [1.12, 1.0, 0.98];
  const DARK = '#17181b';
  // Shell: the crown, then the sides and back, leaving the face open.
  add(new THREE.SphereGeometry(0.16, n(18), n(6), 0, Math.PI * 2, 0, 1.2), { bone: H, color: shell, pos: [-0.012, cy, 0], scale: sc });
  add(new THREE.SphereGeometry(0.16, n(16), n(6), Math.PI + 0.95, Math.PI * 2 - 1.9, 1.2, 1.05), { bone: H, color: shell, pos: [-0.012, cy, 0], scale: sc });
  add(insideOut(new THREE.SphereGeometry(0.153, n(12), n(8), 0, Math.PI * 2, 0, 2.3)), { bone: H, color: DARK, pos: [-0.012, cy, 0], scale: sc });
  // Stripe: two narrow longitude wedges running front-to-back over the crown.
  const back = new THREE.SphereGeometry(0.1625, 2, 8, -0.13, 0.26, 0, 1.75);
  const front = new THREE.SphereGeometry(0.1625, 2, 6, Math.PI - 0.13, 0.26, 0, 1.15);
  add(back, { bone: H, color: stripe, pos: [-0.012, cy, 0], scale: [1.125, 1.0, 0.985] });
  add(front, { bone: H, color: stripe, pos: [-0.012, cy, 0], scale: [1.125, 1.0, 0.985] });
  // Ear holes.
  for (const side of [1, -1]) {
    add(new THREE.CircleGeometry(0.017, 8), { bone: H, color: DARK, pos: [-0.02, 1.925, side * 0.1575], rot: [0, side > 0 ? 0 : Math.PI, 0] });
  }
  // Jaw pads, back bumper.
  for (const z of [0.122, -0.122]) add(box(0.09, 0.065, 0.03), { bone: H, color: shell, pos: [0.065, 1.84, z] });
  add(box(0.035, 0.026, 0.11), { bone: H, color: DARK, pos: [-0.19, 1.855, 0] });
  // Chin strap: a cup on the chin and two straps up to the jaw pads.
  add(sph(0.03, 8, 5), { bone: H, color: '#e6e6e2', pos: [0.112, 1.818, 0], scale: [0.8, 0.7, 1.15] });
  for (const side of [1, -1]) add(box(0.1, 0.012, 0.008), { bone: H, color: DARK, pos: [0.075, 1.832, side * 0.072], rot: [0, -side * 0.75, 0] });
  // Facemask: three bars wrapping round the face, joined by three uprights.
  const bar = (y: number, r: number, half: number) => {
    // An arc in the horizontal plane, centered on the front (+x).
    const t = new THREE.TorusGeometry(r, 0.0085, detail < 1 ? 3 : 4, n(14), half * 2).rotateX(Math.PI / 2).rotateY(half);
    add(t, { bone: H, color: mask, pos: [0.0, y, 0] });
  };
  bar(1.935, 0.188, 1.05);
  bar(1.885, 0.198, 0.95);
  bar(1.835, 0.17, 0.85);
  for (const a of [-0.55, 0, 0.55]) {
    const r = a === 0 ? 0.197 : 0.185;
    add(cyl(0.0085, 0.0085, 0.11, 4), { bone: H, color: mask, pos: [Math.cos(a) * r, 1.885, Math.sin(a) * r], rot: [0, 0, a === 0 ? -0.12 : 0] });
  }
  // Keep each part's own smooth normals (Gouraud-style shading, like the PS2).
  return mergeGeometries(parts, false)!;
}
