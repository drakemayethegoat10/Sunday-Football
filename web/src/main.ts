// Sunday Football web client: boots the WebAssembly core, renders with Three.js,
// and wires input, UI and audio together.

import './style.css';
import * as THREE from 'three';
import init, { WebGame } from './wasm/sf_wasm.js';
import teamsData from '../../data/teams.json';
import { Stadium } from './render/stadium';
import { Players } from './render/players';
import { CameraRig } from './render/camera';
import { Input } from './input';
import { UI, type TitleChoice } from './ui';
import { Sfx } from './audio';
import { Quality, type QualityMode } from './quality';
import { FLAG, N, STRIDE, type GameEvent, type Hud, type LineupEntry, type MenuItem, type TeamInfo } from './types';

const TEAMS = (teamsData as { teams: TeamInfo[] }).teams;
const STEP = 1 / 60;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = new UI(TEAMS);
const sfx = new Sfx();
const quality = new Quality();

interface Session {
  attract: boolean;
  game: WebGame;
  scene: THREE.Scene;
  stadium: Stadium;
  players: Players;
  cam: CameraRig;
  teams: [TeamInfo, TeamInfo];
  prev: Float32Array;
  cur: Float32Array;
  hud: Hud;
  lineup: number;
  menuDelay: number;
  finalDelay: number;
  paused: boolean;
}

let renderer: THREE.WebGLRenderer | null = null;
let session: Session | null = null;
let acc = 0;
let last = performance.now();
let time = 0;
let showFps = false;
let fpsFrames = 0;
let fpsTime = 0;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeRenderer(): THREE.WebGLRenderer | null {
  try {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.setPixelRatio(quality.pixelRatio());
    return r;
  } catch (err) {
    console.error(err);
    return null;
  }
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
  });
}

function newSession(home: TeamInfo, away: TeamInfo, quarterMinutes: number, attract: boolean): Session {
  if (session) disposeScene(session.scene);
  const scene = new THREE.Scene();
  const stadium = new Stadium(scene, home, away, renderer!.capabilities.getMaxAnisotropy());
  const players = new Players(scene, home, away);
  const cam = new CameraRig(window.innerWidth / window.innerHeight);
  if (attract) cam.preset = 1;
  const seed = (Math.random() * 0x7fffffff) | 0;
  const game = new WebGame(seed, home.id, away.id, quarterMinutes, attract ? -1 : 0);
  const cur = game.snapshot();
  const s: Session = {
    attract,
    game,
    scene,
    stadium,
    players,
    cam,
    teams: [home, away],
    prev: cur.slice(),
    cur,
    hud: JSON.parse(game.hud()) as Hud,
    lineup: -1,
    menuDelay: 0,
    finalDelay: 0,
    paused: false,
  };
  applyLineup(s);
  cam.cut();
  acc = 0;
  return s;
}

function applyLineup(s: Session) {
  const lineup = JSON.parse(s.game.lineup()) as LineupEntry[];
  s.players.setLineup(lineup);
  s.lineup = s.hud.lineup;
  s.prev.set(s.cur);
}

function startAttract() {
  const a = Math.floor(Math.random() * TEAMS.length);
  let b = Math.floor(Math.random() * TEAMS.length);
  if (b === a) b = (a + 1) % TEAMS.length;
  session = newSession(TEAMS[a], TEAMS[b], 5, true);
}

function startGame(c: TitleChoice) {
  sfx.start();
  quality.setMode(c.quality as QualityMode);
  renderer?.setPixelRatio(quality.pixelRatio());
  session = newSession(TEAMS[c.home], TEAMS[c.away], c.quarterMinutes, false);
  ui.showTitle(false);
  ui.showFinal(session.hud, null);
  input.reset();
  input.enabled = true;
}

function quitToTitle() {
  ui.showPause(false, labels());
  ui.closeMenu();
  ui.showFinal(session!.hud, null);
  input.enabled = false;
  startAttract();
  ui.showTitle(true);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function labels() {
  return {
    camera: session?.cam.presetName ?? '',
    quality: quality.label,
    mute: sfx.muted ? 'OFF' : 'ON',
  };
}

function togglePause() {
  const s = session;
  if (!s || s.attract) return;
  s.paused = !s.paused;
  input.reset();
  ui.showPause(s.paused, labels(), (act) => {
    switch (act) {
      case 'resume':
        togglePause();
        break;
      case 'camera':
        s.cam.cyclePreset();
        break;
      case 'quality':
        quality.cycle();
        renderer?.setPixelRatio(quality.pixelRatio());
        break;
      case 'mute':
        sfx.toggleMute();
        break;
      case 'quit':
        quitToTitle();
        return;
    }
    if (s.paused) ui.showPause(true, labels());
  });
}

function onKey(e: KeyboardEvent): boolean {
  const s = session;
  if (!s || s.attract) {
    if (e.code === 'Enter' && !e.repeat) {
      ui.titleStart();
      return true;
    }
    return false;
  }
  if (ui.menuOpen && !s.paused && ui.menuKey(e.code)) {
    sfx.ui();
    return true;
  }
  switch (e.code) {
    case 'Escape':
    case 'KeyP':
    case 'KeyH':
      if (!e.repeat) togglePause();
      return true;
    case 'KeyV':
      if (!e.repeat) {
        s.cam.cyclePreset();
        ui.banner(s.cam.presetName.toUpperCase() + ' CAM', 'info');
      }
      return true;
    case 'Minus':
    case 'NumpadSubtract':
      s.cam.zoomBy(1.1);
      return true;
    case 'Equal':
    case 'NumpadAdd':
      s.cam.zoomBy(1 / 1.1);
      return true;
    case 'KeyM':
      if (!e.repeat) sfx.toggleMute();
      return true;
    case 'KeyF':
      if (!e.repeat) showFps = !showFps;
      return true;
  }
  return s.paused;
}

const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pickIcon(clientX: number, clientY: number): number {
  const s = session;
  if (!s || s.attract) return 0;
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, s.cam.camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(ground, hit)) return 0;
  return s.players.iconNear(s.cur, hit.x, -hit.z);
}

const input = new Input(canvas, onKey, pickIcon);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function handleEvents(s: Session, events: GameEvent[]) {
  for (const e of events) {
    if (s.attract) continue;
    switch (e.type) {
      case 'banner':
        ui.banner(String(e.text), String(e.style));
        break;
      case 'ticker':
        ui.ticker(String(e.text));
        break;
      case 'snap':
        sfx.snap();
        break;
      case 'throw':
        sfx.throwBall();
        break;
      case 'catch':
        sfx.catchBall();
        sfx.roar(0.15);
        break;
      case 'interception':
        sfx.catchBall();
        sfx.roar(0.6);
        break;
      case 'tackle':
        sfx.hit(Boolean(e.big));
        sfx.whistle();
        if (e.big) sfx.roar(0.35);
        break;
      case 'broken_tackle':
        sfx.hit(false);
        sfx.roar(0.2);
        break;
      case 'incomplete':
      case 'out_of_bounds':
        sfx.whistle();
        break;
      case 'touchdown':
        sfx.whistle();
        sfx.roar(1.0);
        break;
      case 'sack':
        sfx.roar(0.4);
        break;
      case 'first_down':
        sfx.roar(0.12);
        break;
      case 'field_goal':
        sfx.roar(e.good ? 0.6 : 0.1);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function contextHint(s: Session): string {
  const h = s.hud;
  if (h.phase !== 'inplay') return '';
  const u = s.players.userIndex;
  const flags = u >= 0 ? s.cur[u * STRIDE + 6] : 0;
  const iconsUp = Array.from({ length: N }, (_, i) => s.cur[i * STRIDE + 7]).some((v) => v > 0);
  if (h.play_phase === 'presnap') {
    return h.user_side === 'offense' ? 'SPACE  snap the ball' : 'TAB  switch player  ·  waiting for the snap';
  }
  if (h.play_phase === 'over') return '';
  if (flags & FLAG.Carrier && !iconsUp) return 'SHIFT sprint  ·  SPACE juke  ·  Q spin  ·  E stiff arm';
  if (iconsUp) return '1–5 or click a receiver to throw  ·  tap = bullet, hold = lob';
  if (h.user_side === 'defense' || !(flags & FLAG.Offense)) return 'TAB switch  ·  SPACE dive  ·  SHIFT sprint';
  return 'SHIFT sprint';
}

function loop(now: number) {
  requestAnimationFrame(loop);
  frame(now);
}

function frame(now: number, draw = true) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  time += dt;
  const s = session;
  if (!s || !renderer) return;

  // Fixed-step simulation.
  if (!s.paused) {
    acc += dt;
    let first = true;
    while (acc >= STEP) {
      const fi = input.consume();
      const [mx, my] = s.cam.screenToField(fi.ix, fi.iy);
      s.prev.set(s.cur);
      s.game.step(STEP, mx, my, first ? fi.buttons : fi.buttons & 1, first ? fi.throwTo : 0, fi.throwKind);
      s.cur = s.game.snapshot();
      acc -= STEP;
      first = false;
    }
  }
  const alpha = s.paused ? 1 : Math.min(1, acc / STEP);

  s.hud = JSON.parse(s.game.hud()) as Hud;
  if (s.hud.lineup !== s.lineup) applyLineup(s);
  handleEvents(s, JSON.parse(s.game.events()) as GameEvent[]);

  s.players.update(s.prev, s.cur, alpha, dt, time);
  s.stadium.setMarkers(s.hud.los_x, s.hud.first_down_x, s.hud.to_go !== 'Goal');

  // Camera focus: the line of scrimmage before the snap, the ball once it's live.
  const h = s.hud;
  let fx: number;
  let fy: number;
  if (h.phase !== 'inplay' || h.play_phase === 'presnap') {
    fx = h.los_x - h.dir * 3;
    fy = h.ball_y;
  } else {
    fx = s.players.ballPos.x;
    fy = -s.players.ballPos.z;
  }
  s.cam.update(dt, fx, fy, h.dir);

  if (!s.attract) {
    ui.updateHud(h, s.teams);
    ui.hint(contextHint(s));
    ui.throwMeter(input.holdProgress());

    // Play calling.
    if (h.phase === 'playcall' && h.user_side !== 'none' && !s.paused) {
      s.menuDelay += dt;
      if (!ui.menuOpen && s.menuDelay > 0.9) {
        const items = JSON.parse(s.game.menu()) as MenuItem[];
        ui.openMenu(items, h, s.teams, (idx) => {
          sfx.ui();
          s.game.call_play(idx);
        });
      }
    } else {
      s.menuDelay = 0;
      if (ui.menuOpen && h.phase !== 'playcall') ui.closeMenu();
    }

    if (h.phase === 'final') {
      s.finalDelay += dt;
      if (s.finalDelay > 2.5 && s.finalDelay - dt <= 2.5) {
        input.enabled = false;
        ui.showFinal(h, s.teams, () => quitToTitle());
      }
    }

    if (quality.sample(dt)) renderer.setPixelRatio(quality.pixelRatio());
    sfx.update(dt);
  }

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    ui.fps(showFps ? `${Math.round(fpsFrames / fpsTime)} fps · ${quality.label}` : null);
    fpsFrames = 0;
    fpsTime = 0;
  }

  if (draw) renderer.render(s.scene, s.cam.camera);
}

window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setPixelRatio(quality.pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  session?.cam.setAspect(window.innerWidth / window.innerHeight);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  ui.showTitle(true);
  ui.setLoadStatus('Loading game engine…');
  const kick = document.getElementById('kickoff') as HTMLButtonElement;
  kick.disabled = true;
  renderer = makeRenderer();
  if (!renderer) {
    ui.setLoadStatus('This device could not start 3D graphics (WebGL). Try another browser or turn on hardware acceleration.');
    return;
  }
  try {
    await init();
  } catch (err) {
    console.error(err);
    ui.setLoadStatus('The game engine failed to load. Try refreshing the page.');
    return;
  }
  const home = Math.max(0, TEAMS.findIndex((t) => t.id === 'SAR'));
  ui.initTitle(home, (c) => startGame(c));
  kick.disabled = false;
  ui.setLoadStatus('');
  (document.getElementById('opt-quality') as HTMLSelectElement).value = quality.mode;
  startAttract();
  requestAnimationFrame(loop);
}

void boot();

// Dev-only test hook: advance the game by N seconds even when the tab is in the
// background (browsers pause requestAnimationFrame for hidden tabs).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__sf = {
    hud: () => session?.hud,
    tick(seconds: number) {
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) frame(last + 1000 / 60, false);
      last = performance.now(); // don't leave the real loop's clock in the future
    },
  };
}
