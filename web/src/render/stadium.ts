// The field, stadium, goalposts and on-field markers. Everything is generated in code
// (no image files), in a deliberately low-res, mid-2000s console style.

import * as THREE from 'three';
import { FIELD_LEN, FIELD_W, TeamInfo } from '../types';

const PX = 16; // texture pixels per yard
const MARGIN = 4; // yards of border painted around the playing field

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

function fieldTexture(home: TeamInfo, away: TeamInfo, maxAniso: number): THREE.CanvasTexture {
  const W = (FIELD_LEN + MARGIN * 2) * PX;
  const H = Math.round((FIELD_W + MARGIN * 2) * PX);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  // Field coordinate (x, y) -> canvas pixels. Canvas top = far sideline (y = 53.3).
  const X = (x: number) => (x + MARGIN) * PX;
  const Y = (y: number) => (FIELD_W + MARGIN - y) * PX;

  // Grass with 5-yard mowing stripes.
  g.fillStyle = '#2f6e2c';
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < FIELD_LEN; x += 5) {
    g.fillStyle = Math.floor(x / 5) % 2 === 0 ? '#3d8a37' : '#367f31';
    g.fillRect(X(x), Y(FIELD_W), 5 * PX, FIELD_W * PX);
  }
  // Grainy turf noise (retro texture feel).
  const img = g.getImageData(0, 0, W, H);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);

  // End zones.
  const ez = (x0: number, team: TeamInfo, flip: boolean) => {
    g.fillStyle = shade(team.primary, 0.75);
    g.fillRect(X(x0), Y(FIELD_W), 10 * PX, FIELD_W * PX);
    g.save();
    g.translate(X(x0 + 5), Y(FIELD_W / 2));
    g.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
    g.font = `italic 900 ${Math.round(PX * 5.2)}px Arial Black, Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = PX * 0.5;
    g.strokeStyle = team.secondary;
    g.fillStyle = '#ffffff';
    const text = team.name.toUpperCase();
    g.strokeText(text, 0, 0, FIELD_W * PX * 0.9);
    g.fillText(text, 0, 0, FIELD_W * PX * 0.9);
    g.restore();
  };
  ez(0, home, false);
  ez(110, away, true);

  g.fillStyle = '#f4f4f0';
  // Border (6 ft) around the field.
  const B = 2;
  g.fillRect(X(-B), Y(FIELD_W + B), (FIELD_LEN + 2 * B) * PX, B * PX);
  g.fillRect(X(-B), Y(0), (FIELD_LEN + 2 * B) * PX, B * PX);
  g.fillRect(X(-B), Y(FIELD_W + B), B * PX, (FIELD_W + 2 * B) * PX);
  g.fillRect(X(FIELD_LEN), Y(FIELD_W + B), B * PX, (FIELD_W + 2 * B) * PX);

  // Yard lines every 5 yards, goal lines thicker.
  for (let x = 10; x <= 110; x += 5) {
    const w = x === 10 || x === 110 ? 0.25 : 0.12;
    g.fillRect(X(x) - (w * PX) / 2, Y(FIELD_W), w * PX, FIELD_W * PX);
  }
  // Hash marks every yard.
  const hashes = [0.4, 23.58, 29.75, FIELD_W - 1.1];
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    for (const hy of hashes) {
      g.fillRect(X(x) - 1, Y(hy + 0.7), 2, 0.7 * PX);
    }
  }
  // Two-point tries marks.
  g.fillRect(X(12) - 1, Y(FIELD_W / 2 + 0.5), 2, PX);
  g.fillRect(X(108) - 1, Y(FIELD_W / 2 + 0.5), 2, PX);

  // Yard numbers, read from the nearest sideline.
  g.font = `bold ${Math.round(PX * 2)}px Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let x = 20; x <= 100; x += 10) {
    const n = x <= 60 ? x - 10 : 110 - x;
    const label = String(n);
    for (const [cy, rot] of [[8, 0], [FIELD_W - 8, Math.PI]] as const) {
      g.save();
      g.translate(X(x), Y(cy));
      g.rotate(rot);
      g.fillText(label.length === 2 ? label[0] + '  ' + label[1] : label, 0, 0);
      // Direction arrow toward the nearer goal.
      if (n !== 50) {
        const toLeft = x < 60;
        const ax = (toLeft ? -1 : 1) * (rot ? -1 : 1) * PX * 1.9;
        const bx = ax + (ax > 0 ? -PX * 0.35 : PX * 0.35);
        g.beginPath();
        g.moveTo(bx, -PX * 0.55);
        g.lineTo(ax, -PX * 0.75);
        g.lineTo(bx, -PX * 0.95);
        g.fill();
      }
      g.restore();
    }
  }

  // Midfield logo.
  g.save();
  g.translate(X(60), Y(FIELD_W / 2));
  g.beginPath();
  g.arc(0, 0, PX * 4.2, 0, Math.PI * 2);
  g.fillStyle = 'rgba(10, 30, 70, 0.75)';
  g.fill();
  g.lineWidth = PX * 0.35;
  g.strokeStyle = '#ffcc33';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `italic 900 ${Math.round(PX * 2.6)}px Arial Black, Impact, sans-serif`;
  g.fillText('SFL', 0, PX * 0.1);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function crowdTexture(home: TeamInfo, away: TeamInfo): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#2a2d36';
  g.fillRect(0, 0, 128, 64);
  const palette = [home.primary, home.primary, home.secondary, home.accent, away.primary, '#e8e2d0', '#c9a37a', '#7a5136', '#3b3b44', '#d24b3e', '#4b6fd2', '#f2f2f2'];
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let row = 0; row < 16; row++) {
    const y = row * 4;
    g.fillStyle = row % 2 ? '#30343e' : '#262932';
    g.fillRect(0, y + 3, 128, 1);
    for (let x = 0; x < 128; x += 2) {
      if (rnd() < 0.08) continue; // empty seat
      g.fillStyle = palette[Math.floor(rnd() * palette.length)];
      g.fillRect(x, y + 1, 2, 2);
      g.fillStyle = ['#f1c9a5', '#c58c62', '#8d5a3b', '#5a3a26'][Math.floor(rnd() * 4)];
      g.fillRect(x, y, 2, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function wallTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 16;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#14316b';
  g.fillRect(0, 0, 256, 16);
  g.fillStyle = '#ffcc33';
  g.font = 'italic bold 11px Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('SUNDAY FOOTBALL', 8, 8.5);
  g.fillStyle = '#ffffff';
  g.fillText('SFL', 150, 8.5);
  g.fillText('★', 200, 8.5);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function skyTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3a74c4');
  grad.addColorStop(0.55, '#86b6e8');
  grad.addColorStop(1, '#cfe2f2');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Stadium {
  readonly group = new THREE.Group();
  private los: THREE.Mesh;
  private fd: THREE.Mesh;

  constructor(scene: THREE.Scene, home: TeamInfo, away: TeamInfo, maxAniso: number) {
    scene.background = skyTexture();
    scene.fog = new THREE.Fog('#bcd6ee', 140, 380);

    const hemi = new THREE.HemisphereLight('#e6f2ff', '#4f6b3e', 1.6);
    const sun = new THREE.DirectionalLight('#fff4dc', 2.0);
    sun.position.set(30, 80, 40);
    this.group.add(hemi, sun);

    // Surrounding turf/track.
    const around = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 190),
      new THREE.MeshLambertMaterial({ color: '#2a5e28' }),
    );
    around.rotation.x = -Math.PI / 2;
    around.position.set(FIELD_LEN / 2, -0.02, -FIELD_W / 2);
    this.group.add(around);

    // Playing field.
    const fw = FIELD_LEN + MARGIN * 2;
    const fh = FIELD_W + MARGIN * 2;
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fh),
      new THREE.MeshLambertMaterial({ map: fieldTexture(home, away, maxAniso) }),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.set(FIELD_LEN / 2, 0, -FIELD_W / 2);
    this.group.add(field);

    // Scrimmage (blue) and first-down (yellow) lines.
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
    this.buildStands(home, away);
    scene.add(this.group);
  }

  private buildGoalposts() {
    const mat = new THREE.MeshLambertMaterial({ color: '#f5d000' });
    for (const [x, back] of [[0, -1], [FIELD_LEN, 1]] as const) {
      const post = new THREE.Group();
      const r = 0.09;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.5, r * 1.5, 3.33, 6), mat);
      base.position.set(back * 2, 3.33 / 2, 0);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2, 6), mat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(back * 1, 3.33, 0);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 6.17, 6), mat);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(0, 3.33, 0);
      post.add(base, arm, bar);
      for (const s of [-1, 1]) {
        const up = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 10, 6), mat);
        up.position.set(0, 3.33 + 5, (s * 6.17) / 2);
        post.add(up);
      }
      post.position.set(x, 0, -FIELD_W / 2);
      this.group.add(post);
    }
  }

  private buildStands(home: TeamInfo, away: TeamInfo) {
    const crowd = crowdTexture(home, away);
    const wallTex = wallTexture();
    const concrete = new THREE.MeshLambertMaterial({ color: '#5b606b' });

    const addStand = (length: number, depth: number, rise: number, place: (m: THREE.Object3D) => void) => {
      const g = new THREE.Group();
      const slope = Math.hypot(depth, rise);
      const tex = crowd.clone();
      tex.needsUpdate = true;
      tex.repeat.set(length / 4.2, slope / 2.2);
      const seats = new THREE.Mesh(new THREE.PlaneGeometry(length, slope), new THREE.MeshLambertMaterial({ map: tex }));
      // Local frame: stand runs along X, rises toward -Z.
      seats.rotation.x = -Math.atan2(depth, rise);
      seats.position.set(0, 1.4 + rise / 2, -depth / 2);
      const back = new THREE.Mesh(new THREE.BoxGeometry(length, rise + 6, 1), concrete);
      back.position.set(0, (rise + 6) / 2, -depth - 0.5);
      const wt = wallTex.clone();
      wt.needsUpdate = true;
      wt.repeat.set(length / 16, 1);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(length, 1.4, 0.4), [
        concrete, concrete, concrete, concrete, new THREE.MeshLambertMaterial({ map: wt }), concrete,
      ]);
      wall.position.set(0, 0.7, 0.2);
      g.add(seats, back, wall);
      place(g);
      this.group.add(g);
    };

    // Sidelines.
    addStand(150, 26, 18, (g) => g.position.set(FIELD_LEN / 2, 0, -(FIELD_W + 9)));
    addStand(150, 26, 18, (g) => {
      g.rotation.y = Math.PI;
      g.position.set(FIELD_LEN / 2, 0, 9);
    });
    // End zones.
    addStand(70, 18, 12, (g) => {
      g.rotation.y = Math.PI / 2;
      g.position.set(-9, 0, -FIELD_W / 2);
    });
    addStand(70, 18, 12, (g) => {
      g.rotation.y = -Math.PI / 2;
      g.position.set(FIELD_LEN + 9, 0, -FIELD_W / 2);
    });

    // Light towers in the corners for some skyline.
    const towerMat = new THREE.MeshLambertMaterial({ color: '#8a8f99' });
    const lampMat = new THREE.MeshBasicMaterial({ color: '#fff8d8' });
    for (const [x, z] of [[-12, 14], [FIELD_LEN + 12, 14], [-12, -FIELD_W - 14], [FIELD_LEN + 12, -FIELD_W - 14]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 40, 6), towerMat);
      pole.position.set(x, 20, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 1), lampMat);
      head.position.set(x, 41, z);
      head.lookAt(FIELD_LEN / 2, 0, -FIELD_W / 2);
      this.group.add(pole, head);
    }
  }

  setMarkers(losX: number, fdX: number, showFd: boolean) {
    this.los.position.x = losX;
    this.fd.position.x = fdX;
    this.fd.visible = showFd;
  }
}
