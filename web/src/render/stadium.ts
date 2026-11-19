// Field, stadium, lighting, sky and sideline props. Everything is generated in code
// (no image files) in a mid-2000s console style.

import * as THREE from 'three';
import { FIELD_LEN, FIELD_W, Hud, TeamInfo } from '../types';
import { UniformColors, buildBodyGeometry, paintUniform, SKIN_TONES } from './athlete';
import { SHADOW_DIR } from './players';

const PX = 16; // field texture pixels per yard
const MARGIN = 4; // yards of border painted around the playing field
export const UI_FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** Smooth value noise in [0,1] for blotchy turf patterns. */
function valueNoise(seed: number) {
  const r = rng(seed);
  const SIZE = 64;
  const grid = Array.from({ length: SIZE * SIZE }, () => r());
  const at = (x: number, y: number) => grid[((y & 63) * SIZE + (x & 63)) | 0];
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// ---------------------------------------------------------------------------
// Turf
// ---------------------------------------------------------------------------

function fieldTexture(home: TeamInfo, away: TeamInfo, maxAniso: number): THREE.CanvasTexture {
  const W = (FIELD_LEN + MARGIN * 2) * PX;
  const H = Math.round((FIELD_W + MARGIN * 2) * PX);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const X = (x: number) => (x + MARGIN) * PX;
  const Y = (y: number) => (FIELD_W + MARGIN - y) * PX;

  // 1. Grass: mowing stripes, blotchy color patches and blade speckle.
  const n1 = valueNoise(11);
  const n2 = valueNoise(23);
  const img = g.createImageData(W, H);
  const r = rng(1337);
  // Wear: a dirt mask concentrated between the hashes and in front of each goal.
  const wearAt = (fx: number, fy: number): number => {
    const mid = Math.abs(fy - FIELD_W / 2);
    let w = 0;
    if (fx > 8 && fx < 112) {
      const between = Math.max(0, 1 - mid / 5.2); // between the hashes
      const center = 1 - Math.min(1, Math.abs(fx - 60) / 52); // worst at midfield
      w = between * (0.35 + 0.65 * center);
    }
    // Goal-mouth wear.
    for (const gx of [10, 110]) {
      const d = Math.hypot((fx - gx) * 0.7, fy - FIELD_W / 2);
      w = Math.max(w, Math.max(0, 1 - d / 6) * 0.85);
    }
    const blotch = n1(fx * 0.35, fy * 0.35) * 0.6 + n2(fx * 1.3, fy * 1.3) * 0.4;
    return Math.max(0, Math.min(1, w * 1.6 * blotch - 0.18));
  };
  for (let py = 0; py < H; py++) {
    const fy = FIELD_W + MARGIN - py / PX;
    for (let px = 0; px < W; px++) {
      const fx = px / PX - MARGIN;
      const stripe = fx >= 0 && fx < FIELD_LEN ? (Math.floor(fx / 5) % 2 === 0 ? 1.06 : 0.94) : 0.9;
      const patch = 0.82 + n1(fx * 0.12, fy * 0.12) * 0.3 + n2(fx * 0.6, fy * 0.6) * 0.1;
      const blade = (r() - 0.5) * 0.16;
      let gr = (0.2 + blade * 0.4) * patch * stripe;
      let gg = (0.47 + blade) * patch * stripe;
      let gb = (0.17 + blade * 0.3) * patch * stripe;
      const wear = fx > -1 && fx < FIELD_LEN + 1 ? wearAt(fx, fy) : 0;
      if (wear > 0) {
        const dirt = 0.85 + (r() - 0.5) * 0.25;
        gr = gr * (1 - wear) + 0.46 * dirt * wear;
        gg = gg * (1 - wear) + 0.36 * dirt * wear;
        gb = gb * (1 - wear) + 0.22 * dirt * wear;
      }
      const i = (py * W + px) * 4;
      img.data[i] = Math.min(255, gr * 255);
      img.data[i + 1] = Math.min(255, gg * 255);
      img.data[i + 2] = Math.min(255, gb * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // 2. End zones (painted, slightly translucent so the turf shows through).
  const ez = (x0: number, team: TeamInfo, flip: boolean) => {
    g.globalAlpha = 0.82;
    g.fillStyle = shade(team.primary, 0.8);
    g.fillRect(X(x0), Y(FIELD_W), 10 * PX, FIELD_W * PX);
    g.globalAlpha = 1;
    g.save();
    g.translate(X(x0 + 5), Y(FIELD_W / 2));
    g.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
    g.font = `italic 800 ${Math.round(PX * 6.4)}px ${UI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = PX * 0.55;
    g.lineJoin = 'round';
    g.strokeStyle = team.secondary;
    g.fillStyle = '#f4f2ea';
    const text = team.name.toUpperCase();
    g.strokeText(text, 0, 0, FIELD_W * PX * 0.88);
    g.fillText(text, 0, 0, FIELD_W * PX * 0.88);
    g.restore();
  };
  ez(0, home, false);
  ez(110, away, true);

  // 3. Paint: border, yard lines, hashes, numbers, midfield logo.
  g.fillStyle = '#f2f1ea';
  const B = 2;
  g.fillRect(X(-B), Y(FIELD_W + B), (FIELD_LEN + 2 * B) * PX, B * PX);
  g.fillRect(X(-B), Y(0), (FIELD_LEN + 2 * B) * PX, B * PX);
  g.fillRect(X(-B), Y(FIELD_W + B), B * PX, (FIELD_W + 2 * B) * PX);
  g.fillRect(X(FIELD_LEN), Y(FIELD_W + B), B * PX, (FIELD_W + 2 * B) * PX);
  for (let x = 10; x <= 110; x += 5) {
    const w = x === 10 || x === 110 ? 0.25 : 0.12;
    g.fillRect(X(x) - (w * PX) / 2, Y(FIELD_W), w * PX, FIELD_W * PX);
  }
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    for (const hy of [0.4, 23.58, 29.75, FIELD_W - 1.1]) g.fillRect(X(x) - 1, Y(hy + 0.7), 2, 0.7 * PX);
  }
  g.fillRect(X(12) - 1, Y(FIELD_W / 2 + 0.5), 2, PX);
  g.fillRect(X(108) - 1, Y(FIELD_W / 2 + 0.5), 2, PX);

  g.font = `700 ${Math.round(PX * 2.3)}px ${UI_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let x = 20; x <= 100; x += 10) {
    const n = x <= 60 ? x - 10 : 110 - x;
    const label = String(n);
    for (const [cy, rot] of [[8, 0], [FIELD_W - 8, Math.PI]] as const) {
      g.save();
      g.translate(X(x), Y(cy));
      g.rotate(rot);
      g.fillText(label.length === 2 ? label[0] + '   ' + label[1] : label, 0, 0);
      if (n !== 50) {
        const toLeft = x < 60;
        const ax = (toLeft ? -1 : 1) * (rot ? -1 : 1) * PX * 2.0;
        const bx = ax + (ax > 0 ? -PX * 0.35 : PX * 0.35);
        g.beginPath();
        g.moveTo(bx, -PX * 0.6);
        g.lineTo(ax, -PX * 0.8);
        g.lineTo(bx, -PX * 1.0);
        g.fill();
      }
      g.restore();
    }
  }
  g.save();
  g.translate(X(60), Y(FIELD_W / 2));
  g.beginPath();
  g.arc(0, 0, PX * 4.3, 0, Math.PI * 2);
  g.fillStyle = 'rgba(12, 30, 72, 0.8)';
  g.fill();
  g.lineWidth = PX * 0.4;
  g.strokeStyle = '#ffcc33';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `italic 800 ${Math.round(PX * 3.3)}px ${UI_FONT}`;
  g.fillText('SFL', 0, PX * 0.15);
  g.restore();

  // 4. Scuff the paint where the turf is worn.
  const wearImg = g.getImageData(0, 0, W, H);
  const r2 = rng(77);
  for (let py = 0; py < H; py += 1) {
    const fy = FIELD_W + MARGIN - py / PX;
    for (let px = 0; px < W; px += 1) {
      const fx = px / PX - MARGIN;
      const i = (py * W + px) * 4;
      const bright = wearImg.data[i] > 200 && wearImg.data[i + 1] > 200;
      if (!bright) continue;
      const wear = fx > -1 && fx < FIELD_LEN + 1 ? wearAt(fx, fy) : 0;
      if (r2() < 0.12 + wear * 0.6) {
        const k = 0.55 + r2() * 0.25;
        wearImg.data[i] *= k;
        wearImg.data[i + 1] *= k * 1.05;
        wearImg.data[i + 2] *= k * 0.85;
      }
    }
  }
  g.putImageData(wearImg, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ---------------------------------------------------------------------------
// Crowd, billboards, jumbotron
// ---------------------------------------------------------------------------

function crowdTexture(home: TeamInfo, away: TeamInfo): THREE.CanvasTexture {
  // Big, saturated "people" with little dark gap between them, so the stands read as a
  // colorful crowd (mostly in home colors) instead of grey noise once mipmapped.
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#3b404b';
  g.fillRect(0, 0, 256, 128);
  const palette = [
    home.primary, home.primary, home.primary, home.primary, home.secondary, home.secondary, home.accent,
    away.primary, away.primary, away.secondary, '#f2efe6', '#f2efe6', '#e04a3a', '#3f6fe0', '#ffd23f', '#2b2b30',
  ];
  const skins = ['#f1c9a5', '#e0ac7e', '#c58c62', '#8d5a3b', '#5a3a26'];
  const r = rng(99);
  for (let row = 0; row < 16; row++) {
    const y = row * 8;
    g.fillStyle = '#2a2e37';
    g.fillRect(0, y + 7, 256, 1);
    for (let x = (row % 2) * 2; x < 256; x += 4) {
      if (r() < 0.04) continue; // empty seat
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      g.fillRect(x, y + 3, 4, 4);
      g.fillStyle = skins[Math.floor(r() * skins.length)];
      g.fillRect(x + 1, y + 1, 2, 2);
      if (r() < 0.14) {
        g.fillStyle = r() < 0.5 ? skins[Math.floor(r() * skins.length)] : home.secondary;
        g.fillRect(x + (r() < 0.5 ? 0 : 3), y - 1, 1, 3); // raised arm / foam finger
      }
      if (r() < 0.18) {
        g.fillStyle = r() < 0.6 ? home.primary : '#f2efe6'; // caps
        g.fillRect(x + 1, y + 0.5, 2, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Ribbon board: league/team names in their colors (fictional only, no real brands). */
function ribbonTexture(teams: TeamInfo[]): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 32;
  const g = cv.getContext('2d')!;
  let x = 0;
  const panels: [string, string, string][] = [
    ['SUNDAY FOOTBALL', '#0d2a66', '#ffcc33'],
    ...teams.map((t) => [`${t.city.toUpperCase()} ${t.name.toUpperCase()}`, t.primary, '#ffffff'] as [string, string, string]),
    ['MAKE SOME NOISE!', '#b3121b', '#ffffff'],
    ['SFL', '#111111', '#ffcc33'],
    ['DEFENSE!', '#14316b', '#ffffff'],
  ];
  g.font = `italic 800 22px ${UI_FONT}`;
  g.textBaseline = 'middle';
  for (const [text, bg, fg] of panels) {
    const w = g.measureText(text).width + 36;
    if (x + w > 1024) break;
    const grad = g.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, shade(bg, 1.35));
    grad.addColorStop(0.5, bg);
    grad.addColorStop(1, shade(bg, 0.6));
    g.fillStyle = grad;
    g.fillRect(x, 0, w, 32);
    g.fillStyle = fg;
    g.fillText(text, x + 18, 17);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x + w - 2, 0, 2, 32);
    x += w;
  }
  g.fillStyle = '#0b0b10';
  g.fillRect(x, 0, 1024 - x, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function softGlowTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,230,1)');
  grad.addColorStop(0.25, 'rgba(255,240,200,0.55)');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lampBankTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 32;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#3a3d44';
  g.fillRect(0, 0, 64, 32);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = '#fffbea';
      g.beginPath();
      g.arc(4 + x * 8, 4 + y * 8, 3.1, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------

function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#1d3f7a') },
      mid: { value: new THREE.Color('#6f9fd6') },
      horizon: { value: new THREE.Color('#f2d2a6') },
      ground: { value: new THREE.Color('#3a3f35') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 ground;
      varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0
          ? mix(mix(horizon, mid, smoothstep(0.0, 0.22, y)), top, smoothstep(0.22, 0.85, y))
          : mix(horizon, ground, smoothstep(0.0, 0.08, -y));
        // Soft streaky clouds.
        if (y > 0.02) {
          vec2 uv = vDir.xz / (y + 0.25) * 2.2;
          float cl = n(uv) * 0.6 + n(uv * 2.7) * 0.3 + n(uv * 6.1) * 0.1;
          cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.02, 0.25, y) * 0.55;
          c = mix(c, vec3(1.0, 0.95, 0.9), cl);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 14), mat);
  m.position.set(FIELD_LEN / 2, 0, -FIELD_W / 2);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------------------
// Stadium
// ---------------------------------------------------------------------------

export class Stadium {
  readonly group = new THREE.Group();
  private los: THREE.Mesh;
  private fd: THREE.Mesh;
  private crowdTex: THREE.CanvasTexture[] = [];
  private jumbo: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string } | null = null;
  private chain: {
    rear: THREE.Group;
    front: THREE.Group;
    link: THREE.Mesh;
    box: THREE.Group;
    boxTex: THREE.CanvasTexture;
    boxCanvas: HTMLCanvasElement;
    crew: THREE.InstancedMesh;
    caps: THREE.InstancedMesh;
    down: number;
  };
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, private home: TeamInfo, private away: TeamInfo, allTeams: TeamInfo[], maxAniso: number) {
    scene.background = new THREE.Color('#6f9fd6');
    scene.fog = new THREE.Fog('#d9c7ad', 110, 520);
    this.group.add(skyDome());

    // Floodlighting: warm key from the far corner (matches the players' cast shadows),
    // cooler fill from the opposite side, a rim light from behind, and sky/ground bounce.
    const hemi = new THREE.HemisphereLight('#dfe9ff', '#4d5a3a', 1.1);
    const key = new THREE.DirectionalLight('#fff1d6', 2.4);
    key.position.set(FIELD_LEN / 2 - SHADOW_DIR.x * 60, 75, -FIELD_W / 2 - SHADOW_DIR.y * 60);
    key.target.position.set(FIELD_LEN / 2, 0, -FIELD_W / 2);
    const fill = new THREE.DirectionalLight('#cfe0ff', 0.9);
    fill.position.set(FIELD_LEN / 2 + 50, 45, -FIELD_W / 2 + 60);
    fill.target.position.copy(key.target.position);
    const rim = new THREE.DirectionalLight('#ffe7c2', 0.6);
    rim.position.set(FIELD_LEN + 60, 30, -FIELD_W / 2);
    rim.target.position.copy(key.target.position);
    this.group.add(hemi, key, key.target, fill, fill.target, rim, rim.target);

    // Surrounding turf.
    const aroundTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d')!;
      const r = rng(5);
      for (let i = 0; i < 128 * 128; i++) {
        const v = 0.85 + r() * 0.3;
        g.fillStyle = `rgb(${38 * v | 0},${84 * v | 0},${36 * v | 0})`;
        g.fillRect(i % 128, (i / 128) | 0, 1, 1);
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(40, 30);
      return t;
    })();
    const around = new THREE.Mesh(new THREE.PlaneGeometry(260, 190), new THREE.MeshLambertMaterial({ map: aroundTex }));
    around.rotation.x = -Math.PI / 2;
    around.position.set(FIELD_LEN / 2, -0.02, -FIELD_W / 2);
    this.group.add(around);

    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_LEN + MARGIN * 2, FIELD_W + MARGIN * 2),
      new THREE.MeshLambertMaterial({ map: fieldTexture(home, away, maxAniso) }),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.set(FIELD_LEN / 2, 0, -FIELD_W / 2);
    this.group.add(field);

    const lineGeo = new THREE.PlaneGeometry(0.28, FIELD_W);
    const mk = (color: string) => {
      const m = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.03, -FIELD_W / 2);
      m.renderOrder = 1;
      this.group.add(m);
      return m;
    };
    this.los = mk('#3a7bff');
    this.fd = mk('#ffd200');

    this.buildGoalposts();
    this.buildStands(allTeams);
    this.buildLightTowers();
    this.buildJumbotron();
    this.buildSidelineProps();
    this.chain = this.buildChainGang();
    scene.add(this.group);
  }

  private buildGoalposts() {
    const mat = new THREE.MeshPhongMaterial({ color: '#f5d000', shininess: 60, specular: new THREE.Color('#555533') });
    const pad = new THREE.MeshLambertMaterial({ color: this.home.primary });
    for (const [x, back] of [[0, -1], [FIELD_LEN, 1]] as const) {
      const post = new THREE.Group();
      const r = 0.09;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.6, r * 1.6, 3.33, 8), mat);
      base.position.set(back * 2, 3.33 / 2, 0);
      const padding = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2, 8), pad);
      padding.position.set(back * 2, 1, 0);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2, 8), mat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(back * 1, 3.33, 0);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 6.17, 8), mat);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(0, 3.33, 0);
      post.add(base, padding, arm, bar);
      for (const s of [-1, 1]) {
        const up = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 10, 6), mat);
        up.position.set(0, 3.33 + 5, (s * 6.17) / 2);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.2), new THREE.MeshBasicMaterial({ color: '#ff5a1f', side: THREE.DoubleSide }));
        flag.position.set(back * 0.12, 13.0, (s * 6.17) / 2);
        post.add(up, flag);
      }
      post.position.set(x, 0, -FIELD_W / 2);
      this.group.add(post);
    }
  }

  /** Two-tier stands with a glowing ribbon board between the decks. */
  private buildStands(allTeams: TeamInfo[]) {
    const concrete = new THREE.MeshLambertMaterial({ color: '#6b707a' });
    const darkSteel = new THREE.MeshLambertMaterial({ color: '#2e3138' });
    const ribbon = ribbonTexture(allTeams);
    const crowdBase = crowdTexture(this.home, this.away);

    const tier = (g: THREE.Group, length: number, y0: number, z0: number, depth: number, rise: number) => {
      const slope = Math.hypot(depth, rise);
      const tex = crowdBase.clone();
      tex.needsUpdate = true;
      tex.repeat.set(length / 9, slope / 4.2);
      this.crowdTex.push(tex);
      const seats = new THREE.Mesh(new THREE.PlaneGeometry(length, slope), new THREE.MeshLambertMaterial({ map: tex }));
      seats.rotation.x = -Math.atan2(depth, rise);
      seats.position.set(0, y0 + rise / 2, z0 - depth / 2);
      g.add(seats);
    };

    const addStand = (length: number, place: (g: THREE.Group) => void, big: boolean) => {
      const g = new THREE.Group();
      const lowerDepth = big ? 22 : 16;
      const lowerRise = big ? 14 : 10;
      // Front wall with padding.
      const wall = new THREE.Mesh(new THREE.BoxGeometry(length, 1.6, 0.5), darkSteel);
      wall.position.set(0, 0.8, 0.25);
      g.add(wall);
      tier(g, length, 1.4, 0, lowerDepth, lowerRise);
      // Ribbon board fascia (bright, so it blooms).
      const rt = ribbon.clone();
      rt.needsUpdate = true;
      rt.repeat.set(length / 70, 1);
      const fascia = new THREE.Mesh(new THREE.PlaneGeometry(length, 2.2), new THREE.MeshBasicMaterial({ map: rt, color: '#ffffff' }));
      fascia.position.set(0, 1.4 + lowerRise + 3.0, -lowerDepth - 0.5);
      g.add(fascia);
      const club = new THREE.Mesh(new THREE.BoxGeometry(length, 4, 3), concrete);
      club.position.set(0, 1.4 + lowerRise + 2.0, -lowerDepth - 2.2);
      g.add(club);
      if (big) {
        tier(g, length, 1.4 + lowerRise + 4.2, -lowerDepth - 3.2, 18, 15);
        const rimWall = new THREE.Mesh(new THREE.BoxGeometry(length, 4, 1), concrete);
        rimWall.position.set(0, 1.4 + lowerRise + 4.2 + 15 + 2, -lowerDepth - 3.2 - 18 - 0.5);
        g.add(rimWall);
        // Roof overhang.
        const roof = new THREE.Mesh(new THREE.BoxGeometry(length, 0.6, 10), darkSteel);
        roof.position.set(0, 1.4 + lowerRise + 4.2 + 15 + 6, -lowerDepth - 3.2 - 18 + 3);
        g.add(roof);
      } else {
        const back = new THREE.Mesh(new THREE.BoxGeometry(length, 3, 1), concrete);
        back.position.set(0, 1.4 + lowerRise + 5.5, -lowerDepth - 3.5);
        g.add(back);
      }
      place(g);
      this.group.add(g);
    };

    addStand(152, (g) => g.position.set(FIELD_LEN / 2, 0, -(FIELD_W + 11)), true);
    addStand(152, (g) => {
      g.rotation.y = Math.PI;
      g.position.set(FIELD_LEN / 2, 0, 11);
    }, true);
    addStand(66, (g) => {
      g.rotation.y = Math.PI / 2;
      g.position.set(-11, 0, -FIELD_W / 2);
    }, false);
    addStand(66, (g) => {
      g.rotation.y = -Math.PI / 2;
      g.position.set(FIELD_LEN + 11, 0, -FIELD_W / 2);
    }, false);
  }

  private buildLightTowers() {
    const steel = new THREE.MeshLambertMaterial({ color: '#7d828c' });
    const bankMat = new THREE.MeshBasicMaterial({ map: lampBankTexture() });
    const glowMat = new THREE.SpriteMaterial({ map: softGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const center = new THREE.Vector3(FIELD_LEN / 2, 0, -FIELD_W / 2);
    for (const [x, z] of [[-16, 16], [FIELD_LEN + 16, 16], [-16, -FIELD_W - 16], [FIELD_LEN + 16, -FIELD_W - 16]]) {
      const tower = new THREE.Group();
      // Lattice: three legs plus cross braces.
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 52, 5), steel);
        leg.position.set(Math.cos(a) * 1.4, 26, Math.sin(a) * 1.4);
        tower.add(leg);
      }
      for (let h = 6; h < 52; h += 6) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 3, 6), steel);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = h;
        tower.add(ring);
      }
      const head = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.6), steel);
      const bank = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.4), bankMat);
      bank.position.z = 0.31;
      head.add(frame, bank);
      head.position.set(0, 54, 0);
      tower.add(head);
      tower.position.set(x, 0, z);
      this.group.add(tower);
      head.lookAt(center.x, 10, center.z);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(20, 13, 1);
      const p = new THREE.Vector3(0, 54, 0).add(new THREE.Vector3(center.x - x, 0, center.z - z).normalize().multiplyScalar(1.2));
      glow.position.set(x + p.x, p.y, z + p.z);
      this.group.add(glow);
    }
  }

  private buildJumbotron() {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshBasicMaterial({ map: tex }));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(28, 15, 1.5), new THREE.MeshLambertMaterial({ color: '#1f2229' }));
    const legGeo = new THREE.BoxGeometry(1.2, 30, 1.2);
    const legMat = new THREE.MeshLambertMaterial({ color: '#5f646d' });
    const g = new THREE.Group();
    screen.position.z = 0.8;
    g.add(frame, screen);
    for (const s of [-8, 8]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(s, -15, -0.5);
      g.add(leg);
    }
    g.position.set(FIELD_LEN + 36, 38, -FIELD_W / 2);
    g.rotation.y = -Math.PI / 2;
    this.group.add(g);
    this.jumbo = { canvas: cv, tex, key: '' };
  }

  /** Redraw the jumbotron when the score or clock changes. */
  setScoreboard(h: Hud) {
    if (!this.jumbo) return;
    const secs = Math.max(0, Math.ceil(h.clock));
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const key = `${h.score}|${h.quarter}|${clock}|${h.phase}`;
    if (key === this.jumbo.key) return;
    this.jumbo.key = key;
    const g = this.jumbo.canvas.getContext('2d')!;
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, 256, 128);
    const half = (x: number, team: TeamInfo, abbr: string, score: number) => {
      const grad = g.createLinearGradient(0, 8, 0, 74);
      grad.addColorStop(0, shade(team.primary, 1.3));
      grad.addColorStop(1, shade(team.primary, 0.7));
      g.fillStyle = grad;
      g.fillRect(x, 8, 116, 66);
      g.fillStyle = '#ffffff';
      g.font = `italic 800 26px ${UI_FONT}`;
      g.textAlign = 'center';
      g.fillText(abbr, x + 58, 34);
      g.font = `800 36px ${UI_FONT}`;
      g.fillStyle = '#ffd34a';
      g.fillText(String(score), x + 58, 68);
    };
    half(8, this.away, h.abbr[1], h.score[1]);
    half(132, this.home, h.abbr[0], h.score[0]);
    g.fillStyle = '#ffffff';
    g.font = `700 26px ${UI_FONT}`;
    g.textAlign = 'center';
    g.fillText(h.phase === 'final' ? 'FINAL' : `Q${h.quarter}   ${clock}`, 128, 106);
    // LED dot grid.
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < 128; y += 3) g.fillRect(0, y, 256, 1);
    for (let x = 0; x < 256; x += 3) g.fillRect(x, 0, 1, 128);
    this.jumbo.tex.needsUpdate = true;
  }

  private buildSidelineProps() {
    // Team benches behind each sideline.
    const benchGeo = new THREE.BoxGeometry(10, 0.5, 0.8);
    for (const [team, coreY] of [[this.home, -9.2], [this.away, FIELD_W + 9.2]] as const) {
      const benches = new THREE.InstancedMesh(benchGeo, new THREE.MeshLambertMaterial({ color: team.primary }), 4);
      for (let i = 0; i < 4; i++) {
        this.dummy.position.set(42 + i * 12, 0.45, -coreY);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        benches.setMatrixAt(i, this.dummy.matrix);
      }
      this.group.add(benches);
      // Coolers (generic, unbranded) and a cup table near each bench area.
      const coolerGeo = new THREE.CylinderGeometry(0.42, 0.38, 0.9, 10);
      const coolers = new THREE.InstancedMesh(coolerGeo, new THREE.MeshPhongMaterial({ color: '#ff7a1a', shininess: 50 }), 4);
      const lids = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.44, 0.44, 0.12, 10), new THREE.MeshLambertMaterial({ color: '#f2f2f2' }), 4);
      for (let i = 0; i < 4; i++) {
        const x = 36 + i * 15;
        this.dummy.position.set(x, 0.45, -coreY + (coreY < 0 ? -0.8 : 0.8));
        this.dummy.updateMatrix();
        coolers.setMatrixAt(i, this.dummy.matrix);
        this.dummy.position.y = 0.96;
        this.dummy.updateMatrix();
        lids.setMatrixAt(i, this.dummy.matrix);
      }
      this.group.add(coolers, lids);
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: '#d9d9d9' }));
      table.position.set(60, 0.4, -coreY + (coreY < 0 ? -0.9 : 0.9));
      this.group.add(table);
    }
  }

  private buildChainGang() {
    const r = new THREE.Group();
    const f = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: '#202020' });
    const flagMat = new THREE.MeshBasicMaterial({ color: '#ff6a1a' });
    for (const g of [r, f]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.3;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), flagMat);
      top.position.y = 2.7;
      g.add(pole, top);
      this.group.add(g);
    }
    const link = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: '#d9d9d9' }));
    link.position.y = 0.5;
    this.group.add(link);

    const boxCanvas = document.createElement('canvas');
    boxCanvas.width = boxCanvas.height = 64;
    const boxTex = new THREE.CanvasTexture(boxCanvas);
    boxTex.colorSpace = THREE.SRGBColorSpace;
    const box = new THREE.Group();
    const bpole = new THREE.Mesh(poleGeo, poleMat);
    bpole.position.y = 1.3;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.7, 0.7), [
      flagMat, flagMat, flagMat, flagMat,
      new THREE.MeshBasicMaterial({ map: boxTex }), new THREE.MeshBasicMaterial({ map: boxTex }),
    ]);
    sign.position.y = 2.75;
    sign.rotation.y = Math.PI / 2;
    box.add(bpole, sign);
    this.group.add(box);

    // Crew in orange vests (same athlete body, unskinned) with caps instead of helmets.
    const crewU: UniformColors = {
      jersey: '#ff7a1a', trim: '#111111', pants: '#1a1a1a', pantsStripe: '#1a1a1a', helmet: '#111111',
      stripe: '#111111', mask: '#111111', socks: '#111111', num: '#111111', numOutline: '#111111', glove: '#ffffff',
    };
    const crewTex = new THREE.CanvasTexture(paintUniform(crewU, -1, SKIN_TONES[1]));
    crewTex.colorSpace = THREE.SRGBColorSpace;
    const crew = new THREE.InstancedMesh(buildBodyGeometry(), new THREE.MeshLambertMaterial({ map: crewTex }), 3);
    const capGeo = new THREE.SphereGeometry(0.15, 8, 6);
    capGeo.translate(0, 1.93, 0);
    const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshLambertMaterial({ color: '#141414' }), 3);
    crew.frustumCulled = false;
    caps.frustumCulled = false;
    this.group.add(crew, caps);
    return { rear: r, front: f, link, box, boxTex, boxCanvas, crew, caps, down: -1 };
  }

  setMarkers(losX: number, fdX: number, showFd: boolean, down: number, dir: number) {
    this.los.position.x = losX;
    this.fd.position.x = fdX;
    this.fd.visible = showFd;

    // Chain gang on the far sideline: rear stake at the start of the series, front stake
    // at the line to gain, down box at the line of scrimmage.
    const c = this.chain;
    const z = -(FIELD_W + 2.4);
    const frontX = showFd ? fdX : losX + dir * 10;
    const rearX = frontX - dir * 10;
    c.rear.position.set(rearX, 0, z);
    c.front.position.set(frontX, 0, z);
    c.link.position.set((rearX + frontX) / 2, 0.5, z);
    c.link.scale.x = Math.abs(frontX - rearX);
    c.box.position.set(losX, 0, z);
    if (c.down !== down) {
      c.down = down;
      const g = c.boxCanvas.getContext('2d')!;
      g.fillStyle = '#ff6a1a';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#111111';
      g.font = `800 50px ${UI_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(Math.max(1, Math.min(4, down))), 32, 35);
      c.boxTex.needsUpdate = true;
    }
    const d = this.dummy;
    [rearX, frontX, losX].forEach((x, i) => {
      d.position.set(x, 0, z - 0.6);
      d.rotation.set(0, -Math.PI / 2, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      c.crew.setMatrixAt(i, d.matrix);
      c.caps.setMatrixAt(i, d.matrix);
    });
    c.crew.instanceMatrix.needsUpdate = true;
    c.caps.instanceMatrix.needsUpdate = true;
  }

  /** Crowd bounces (texture shimmy) when excited, 0–1. */
  update(time: number, excitement: number) {
    const bounce = excitement > 0.2 ? Math.abs(Math.sin(time * 9)) * 0.012 * excitement : Math.sin(time * 1.3) * 0.0015;
    for (const t of this.crowdTex) t.offset.y = bounce;
  }
}
