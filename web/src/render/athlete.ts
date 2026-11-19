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
// Uniform texture atlas (128x128 per player)
// ---------------------------------------------------------------------------

type Region = [number, number, number, number];
export const ATLAS = {
  jersey: [0, 0, 128, 56] as Region,
  pads: [0, 56, 64, 16] as Region,
  sleeve: [64, 56, 64, 16] as Region,
  pants: [0, 72, 64, 24] as Region,
  sock: [64, 72, 32, 24] as Region,
  skin: [96, 72, 32, 24] as Region,
  shoe: [0, 96, 32, 16] as Region,
  glove: [32, 96, 32, 16] as Region,
  belt: [64, 96, 32, 16] as Region,
  knee: [96, 96, 32, 16] as Region,
};

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

export const SKIN_TONES = ['#f1c9a5', '#e0ac7e', '#c58c62', '#a8714a', '#8d5a3b', '#5a3a26'];

let fontFamily = 'Arial Black, Impact, sans-serif';
/** Use the bundled condensed font for jersey numbers once it has loaded. */
export function setNumberFont(f: string) {
  fontFamily = f;
}

/**
 * Paint a uniform atlas. `number` < 0 paints a plain warm-up jacket (sideline players).
 */
export function paintUniform(u: UniformColors, number: number, skin: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  let seed = number * 7919 + 17;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const fill = (r: Region, c: string) => {
    g.fillStyle = c;
    g.fillRect(r[0], r[1], r[2], r[3]);
  };
  const noise = (r: Region, amt: number) => {
    const img = g.getImageData(r[0], r[1], r[2], r[3]);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * amt;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, r[0], r[1]);
  };

  // Jersey: fabric shading wraps around the torso (u = around, sides are at u=0 and 0.5).
  const [jx, jy, jw, jh] = ATLAS.jersey;
  for (let x = 0; x < jw; x++) {
    const side = Math.abs(Math.cos((x / jw) * Math.PI * 2)); // 1 at the sides
    const f = 1.0 - side * 0.22;
    g.fillStyle = shadeHex(u.jersey, f);
    g.fillRect(jx + x, jy, 1, jh);
  }
  // Darker toward the waist, plus mesh texture and a collar.
  const grad = g.createLinearGradient(0, jy, 0, jy + jh);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = grad;
  g.fillRect(jx, jy, jw, jh);
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = jy; y < jy + jh; y += 3) for (let x = jx + ((y / 3) % 2); x < jx + jw; x += 3) g.fillRect(x, y, 1, 1);
  fill([jx, jy, jw, 3], u.trim);
  // Side panels.
  g.fillStyle = shadeHex(u.trim, 0.9);
  g.fillRect(jx, jy + 18, 3, jh - 18);
  g.fillRect(jx + 61, jy + 18, 6, jh - 18);
  g.fillRect(jx + 125, jy + 18, 3, jh - 18);
  if (number >= 0) {
    g.font = `800 34px ${fontFamily}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    for (const cx of [32, 96]) {
      g.strokeStyle = u.numOutline;
      g.strokeText(String(number), jx + cx, jy + 30);
      g.fillStyle = u.num;
      g.fillText(String(number), jx + cx, jy + 30);
    }
  } else {
    // Warm-up jacket: zipper and chest logo stripe.
    g.fillStyle = shadeHex(u.jersey, 0.6);
    g.fillRect(jx + 31, jy, 2, jh);
    fill([jx + 10, jy + 14, 16, 3], u.trim);
  }
  noise(ATLAS.jersey, 10);

  // Pads & sleeves with stripes.
  fill(ATLAS.pads, shadeHex(u.jersey, 1.05));
  fill([ATLAS.pads[0], ATLAS.pads[1] + 9, ATLAS.pads[2], 2], u.trim);
  fill(ATLAS.sleeve, u.jersey);
  fill([ATLAS.sleeve[0], ATLAS.sleeve[1] + 3, ATLAS.sleeve[2], 2], u.trim);
  fill([ATLAS.sleeve[0], ATLAS.sleeve[1] + 7, ATLAS.sleeve[2], 2], u.trim);
  noise(ATLAS.pads, 8);

  // Pants with side stripes (sides of the cylinder are at u=0 and u=0.5).
  const [px, py, pw, ph] = ATLAS.pants;
  for (let x = 0; x < pw; x++) {
    const side = Math.abs(Math.cos((x / pw) * Math.PI * 2));
    g.fillStyle = shadeHex(u.pants, 1.0 - side * 0.15);
    g.fillRect(px + x, py, 1, ph);
  }
  g.fillStyle = u.pantsStripe;
  g.fillRect(px, py, 2, ph);
  g.fillRect(px + pw / 2 - 2, py, 4, ph);
  g.fillRect(px + pw - 2, py, 2, ph);
  noise(ATLAS.pants, 8);

  // Socks with a band, skin, cleats, gloves, belt, knee pads.
  fill(ATLAS.sock, u.socks);
  fill([ATLAS.sock[0], ATLAS.sock[1] + 6, ATLAS.sock[2], 4], '#f4f4f0');
  fill([ATLAS.sock[0], ATLAS.sock[1] + 18, ATLAS.sock[2], 6], '#f4f4f0');
  fill(ATLAS.skin, skin);
  noise(ATLAS.skin, 6);
  fill(ATLAS.shoe, '#161616');
  fill([ATLAS.shoe[0], ATLAS.shoe[1] + 6, ATLAS.shoe[2], 3], '#e8e8e8');
  fill(ATLAS.glove, u.glove);
  fill(ATLAS.belt, '#1a1a1a');
  fill(ATLAS.knee, shadeHex(u.pants, 1.12));
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
  add(cyl(0.165, 0.18, 0.24, 8), { bone: BONE.hips, region: A.pants, pos: [0, 1.0, 0], scale: [0.85, 1, 1.15] });
  add(cyl(0.172, 0.172, 0.04, 8), { bone: BONE.hips, region: A.belt, pos: [0, 1.115, 0], scale: [0.87, 1, 1.16] });
  // V-shaped torso.
  add(cyl(0.235, 0.17, 0.52, 8), { bone: BONE.spine, region: A.jersey, pos: [0, 1.38, 0], scale: [0.78, 1, 1.18] });
  // Shoulder pads: a wide yoke plus rounded caps over each shoulder.
  add(cyl(0.2, 0.27, 0.15, 8), { bone: BONE.spine, region: A.pads, pos: [0, 1.7, 0], scale: [0.85, 1, 1.45] });
  for (const z of [0.31, -0.31]) {
    add(sph(0.125, 7, 5), { bone: BONE.spine, region: A.pads, pos: [0, 1.69, z], scale: [1, 0.78, 1] });
  }
  // Neck.
  add(cyl(0.065, 0.075, 0.13, 6), { bone: BONE.spine, region: A.skin, pos: [0, 1.81, 0] });
  // Arms.
  for (const [sh, el, z] of [[BONE.shL, BONE.elL, 0.31], [BONE.shR, BONE.elR, -0.31]] as const) {
    add(cyl(0.078, 0.062, 0.3, 6), { bone: sh, region: A.sleeve, pos: [0, 1.51, z] });
    add(cyl(0.06, 0.047, 0.26, 6), { bone: el, region: A.skin, pos: [0, 1.23, z] });
    add(sph(0.06, 6, 4), { bone: el, region: A.glove, pos: [0.01, 1.07, z], scale: [1.1, 1.25, 0.8] });
  }
  // Legs.
  for (const [th, kn, z] of [[BONE.thL, BONE.knL, 0.11], [BONE.thR, BONE.knR, -0.11]] as const) {
    add(cyl(0.108, 0.08, 0.47, 7), { bone: th, region: A.pants, pos: [0, 0.745, z] });
    add(sph(0.072, 6, 4), { bone: kn, region: A.knee, pos: [0.035, 0.52, z], scale: [0.9, 1.1, 1] });
    add(cyl(0.072, 0.05, 0.43, 6), { bone: kn, region: A.sock, pos: [0, 0.295, z] });
    add(box(0.26, 0.085, 0.115), { bone: kn, region: A.shoe, pos: [0.055, 0.043, z] });
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
