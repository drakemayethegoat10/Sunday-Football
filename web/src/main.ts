// Sunday Football web client: boots the WebAssembly core, renders with Three.js,
// and wires input (keyboard, mouse, Xbox controller), UI and audio together.

import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/800-italic.css';
import './style.css';
import * as THREE from 'three';
import init, { WebGame } from './wasm/sf_wasm.js';
import teamsData from '../../data/teams.json';
import { Stadium, UI_FONT } from './render/stadium';
import { Ps2Pipeline } from './render/pipeline';
import { setNumberFont } from './render/athlete';
import { Players } from './render/players';
import { CameraRig } from './render/camera';
import { BTN, Input } from './input';
import { Gamepads, PAD, type PadState } from './gamepad';
import { KickMeter } from './kickmeter';
import { Replay } from './replay';
import { UI, type TeamStatLine, type TitleChoice } from './ui';
import { Sfx } from './audio';
import { Quality, type QualityMode } from './quality';
import { FLAG, N, STRIDE, type GameEvent, type Hud, type LineupEntry, type MenuItem, type TeamInfo } from './types';

const TEAMS = (teamsData as { teams: TeamInfo[] }).teams;
const STEP = 1 / 60;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = new UI(TEAMS);
const sfx = new Sfx();
const quality = new Quality();
const pads = new Gamepads();

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
  finalShown: boolean;
  paused: boolean;
  difficulty: number;
  rag: Float32Array;
  ballVel: THREE.Vector3;
  lastBall: THREE.Vector3;
}

let renderer: THREE.WebGLRenderer | null = null;
let pipeline: Ps2Pipeline | null = null;
let session: Session | null = null;
let acc = 0;
let last = performance.now();
let time = 0;
let showFps = false;
let fpsFrames = 0;
let fpsTime = 0;
let usingPad = false;
const replay = new Replay();

const meter = new KickMeter((power, accuracy) => {
  session?.game.kick(power, accuracy);
  sfx.ui();
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function applyQuality() {
  if (!renderer || !pipeline) return;
  renderer.setPixelRatio(quality.pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  pipeline.setInternalSize(quality.internalSize);
}

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

interface SessionOpts {
  quarterMinutes: number;
  attract: boolean;
  difficulty: number;
  penalties: number;
  overtime: boolean;
}

function newSession(home: TeamInfo, away: TeamInfo, o: SessionOpts): Session {
  if (session) disposeScene(session.scene);
  const scene = new THREE.Scene();
  const stadium = new Stadium(scene, home, away, TEAMS, renderer!.capabilities.getMaxAnisotropy());
  const players = new Players(scene, home, away);
  const cam = new CameraRig(window.innerWidth / window.innerHeight);
  if (o.attract) cam.preset = 1;
  const seed = (Math.random() * 0x7fffffff) | 0;
  const game = new WebGame(seed, home.id, away.id, o.quarterMinutes, o.attract ? -1 : 0, o.difficulty, o.penalties, o.overtime);
  const cur = game.snapshot();
  const s: Session = {
    attract: o.attract,
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
    finalShown: false,
    paused: false,
    difficulty: o.difficulty,
    rag: new Float32Array(0),
    ballVel: new THREE.Vector3(),
    lastBall: new THREE.Vector3(),
  };
  meter.fillTime = [1.25, 0.95, 0.8, 0.68][o.difficulty] ?? 0.95;
  applyLineup(s);
  cam.cut();
  acc = 0;
  return s;
}

function applyLineup(s: Session) {
  const json = s.game.lineup();
  const lineup = JSON.parse(json) as LineupEntry[];
  if (!s.attract) replay.begin(json);
  s.players.setLineup(lineup);
  s.lineup = s.hud.lineup;
  s.prev.set(s.cur);
  s.stadium.clearFlags();
  meter.reset();
}

function startAttract() {
  const a = Math.floor(Math.random() * TEAMS.length);
  let b = Math.floor(Math.random() * TEAMS.length);
  if (b === a) b = (a + 1) % TEAMS.length;
  session = newSession(TEAMS[a], TEAMS[b], { quarterMinutes: 5, attract: true, difficulty: 1, penalties: 1, overtime: true });
}

function startGame(c: TitleChoice) {
  sfx.start();
  quality.setMode(c.quality as QualityMode);
  applyQuality();
  session = newSession(TEAMS[c.home], TEAMS[c.away], {
    quarterMinutes: c.quarterMinutes,
    attract: false,
    difficulty: c.difficulty,
    penalties: c.penalties,
    overtime: c.overtime,
  });
  ui.showTitle(false);
  ui.showFinal(session.hud, null);
  input.reset();
  input.enabled = true;
}

function quitToTitle() {
  ui.showPause(false, labels());
  ui.closeMenu();
  if (session) ui.showFinal(session.hud, null);
  meter.show(false);
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
        applyQuality();
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

function cycleCamera(s: Session) {
  s.cam.cyclePreset();
  ui.banner(s.cam.presetName.toUpperCase() + ' CAM', 'info');
}

function callTimeout(s: Session) {
  if (s.game.timeout()) {
    sfx.whistle();
    if (ui.menuOpen) {
      ui.closeMenu();
      s.menuDelay = 0.6; // reopen with the updated count
    }
  }
}

function enterReplay(s: Session) {
  if (!replay.enter()) return;
  ui.closeMenu();
  s.players.setLineup(JSON.parse(replay.last!.lineup) as LineupEntry[]);
  s.cam.cut();
  setReplayBar(true);
  sfx.ui();
}

function exitReplay(s: Session) {
  replay.exit();
  s.players.setLineup(JSON.parse(s.game.lineup()) as LineupEntry[]);
  s.menuDelay = 0.5;
  s.cam.cut();
  setReplayBar(false);
}

function setReplayBar(show: boolean) {
  const el = document.getElementById('replay-bar')!;
  el.hidden = !show;
}

function replayKey(s: Session, code: string): boolean {
  switch (code) {
    case 'Space': replay.paused = !replay.paused; return true;
    case 'ArrowLeft': case 'KeyA': replay.scrub(-1); return true;
    case 'ArrowRight': case 'KeyD': replay.scrub(1); return true;
    case 'KeyS': replay.speed = replay.speed === 1 ? 0.3 : 1; return true;
    case 'KeyV': replay.cam++; s.cam.cut(); return true;
    case 'KeyR': case 'Escape': case 'Enter': case 'Backspace': exitReplay(s); return true;
  }
  return true;
}

function meterActive(s: Session | null): boolean {
  return !!s && !s.attract && s.hud.user_kicking && !s.paused;
}

function onKey(e: KeyboardEvent): boolean {
  usingPad = false;
  const s = session;
  if (!s || s.attract) {
    if (e.code === 'Enter' && !e.repeat) {
      ui.titleStart();
      return true;
    }
    return false;
  }
  if (s.finalShown) {
    if (e.code === 'Enter' && !e.repeat) quitToTitle();
    return true;
  }
  if (replay.active) {
    if (!e.repeat) replayKey(s, e.code);
    return true;
  }
  if (ui.menuOpen && !s.paused) {
    if (e.code === 'KeyR' && !e.repeat) {
      enterReplay(s);
      return true;
    }
    if (e.code === 'KeyT') {
      callTimeout(s);
      return true;
    }
    if (ui.menuKey(e.code)) {
      sfx.ui();
      return true;
    }
  }
  if (meterActive(s) && e.code === 'Space') {
    if (!e.repeat) meter.press();
    return true;
  }
  switch (e.code) {
    case 'Escape':
    case 'KeyP':
    case 'KeyH':
      if (!e.repeat) togglePause();
      return true;
    case 'KeyV':
      if (!e.repeat) cycleCamera(s);
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
    case 'Backquote':
      if (!e.repeat) showFps = !showFps;
      return true;
    case 'KeyT':
      if (!e.repeat && s.hud.play_phase === 'presnap') callTimeout(s);
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

const ICON_BUTTONS = [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.RB];

function iconsUp(s: Session): boolean {
  for (let i = 0; i < N; i++) if (s.cur[i * STRIDE + 7] > 0) return true;
  return false;
}

function userFlags(s: Session): number {
  const u = s.players.userIndex;
  return u >= 0 ? s.cur[u * STRIDE + 6] : 0;
}

/** Controller handling for every screen. */
function handlePad(p: PadState, s: Session | null) {
  input.padMove = [0, 0];
  input.padSprint = false;
  if (!p.connected) return;
  if (p.active) usingPad = true;
  if (!s || s.attract) {
    if (p.pressed.has(PAD.Menu) || p.pressed.has(PAD.A)) ui.titleStart();
    if (p.nav === 'left') ui.titleStep('away', -1);
    if (p.nav === 'right') ui.titleStep('away', 1);
    if (p.pressed.has(PAD.LB)) ui.titleStep('home', -1);
    if (p.pressed.has(PAD.RB)) ui.titleStep('home', 1);
    return;
  }
  if (s.finalShown) {
    if (p.pressed.has(PAD.A) || p.pressed.has(PAD.Menu)) quitToTitle();
    return;
  }
  if (replay.active) {
    if (p.pressed.has(PAD.A)) replay.paused = !replay.paused;
    if (p.pressed.has(PAD.X)) replay.speed = replay.speed === 1 ? 0.3 : 1;
    if (p.pressed.has(PAD.View)) {
      replay.cam++;
      s.cam.cut();
    }
    if (p.nav === 'left') replay.scrub(-1);
    if (p.nav === 'right') replay.scrub(1);
    if (p.pressed.has(PAD.B) || p.pressed.has(PAD.Menu)) exitReplay(s);
    return;
  }
  if (p.pressed.has(PAD.Menu)) {
    togglePause();
    return;
  }
  if (s.paused) {
    if (p.pressed.has(PAD.B) || p.pressed.has(PAD.A)) togglePause();
    if (p.pressed.has(PAD.View)) cycleCamera(s);
    return;
  }
  if (p.pressed.has(PAD.View)) cycleCamera(s);
  if (ui.menuOpen) {
    if (p.nav) ui.menuNav(p.nav);
    if (p.pressed.has(PAD.A)) ui.menuNav('select');
    if (p.pressed.has(PAD.LB)) ui.menuNav('tabPrev');
    if (p.pressed.has(PAD.RB)) ui.menuNav('tabNext');
    if (p.pressed.has(PAD.Y)) callTimeout(s);
    if (p.pressed.has(PAD.X)) enterReplay(s);
    if (p.nav || p.pressed.size) sfx.ui();
    return;
  }
  if (meterActive(s)) {
    if (p.pressed.has(PAD.A)) meter.press();
    return;
  }
  input.padMove = [p.ix, p.iy];
  input.padSprint = p.sprint;
  if (iconsUp(s)) {
    ICON_BUTTONS.forEach((b, i) => {
      if (p.pressed.has(b)) input.beginHold(i + 1);
      if (p.released.has(b)) input.endHold(i + 1);
    });
    return;
  }
  const flags = userFlags(s);
  const carrier = (flags & FLAG.Carrier) !== 0;
  const engaged = (flags & FLAG.Engaged) !== 0;
  if (p.pressed.has(PAD.A)) input.press(BTN.Action);
  if (p.pressed.has(PAD.X)) input.press(BTN.Spin);
  if (p.pressed.has(PAD.B)) input.press(carrier || engaged ? BTN.Stiff : BTN.Switch);
  if (p.pressed.has(PAD.Y)) input.press(BTN.FairCatch | BTN.Hurdle);
  if (p.pressed.has(PAD.RB)) input.press(BTN.Truck);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function handleEvents(s: Session, events: GameEvent[]) {
  for (const e of events) {
    if (e.type === 'flag') s.stadium.addFlag(Number(e.x), Number(e.y));
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
      case 'kick':
        sfx.hit(false);
        sfx.roar(0.2);
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
      case 'wrap':
        sfx.hit(false);
        break;
      case 'big_hit':
        sfx.hit(true);
        sfx.roar(0.45);
        s.cam.shake(0.35);
        break;
      case 'truck':
        sfx.hit(true);
        sfx.roar(0.5);
        s.cam.shake(0.3);
        break;
      case 'hurdle':
        sfx.roar(0.25);
        break;
      case 'fumble':
        sfx.roar(0.8);
        s.cam.shake(0.2);
        break;
      case 'incomplete':
      case 'out_of_bounds':
      case 'touchback':
      case 'fair_catch':
      case 'two_minute_warning':
      case 'flag':
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
      case 'extra_point':
        sfx.roar(e.good ? 0.6 : 0.1);
        break;
      case 'overtime':
        sfx.roar(0.5);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function contextHint(s: Session): string {
  const h = s.hud;
  const pad = usingPad;
  if (h.phase !== 'inplay') return '';
  if (meterActive(s)) return '';
  const flags = userFlags(s);
  const up = iconsUp(s);
  if (h.play_phase === 'presnap') {
    if (h.special) return h.user_side === 'offense' ? '' : 'Get ready…';
    return h.user_side === 'offense'
      ? `${pad ? 'A' : 'SPACE'}  snap the ball  ·  ${pad ? '' : 'T  timeout'}`
      : `${pad ? 'B' : 'TAB'}  switch player  ·  waiting for the snap`;
  }
  if (h.play_phase === 'over') return '';
  if (h.kneel_window) return `${pad ? 'A' : 'SPACE'}  take a knee (touchback)`;
  if ((h.special === 'punt' || h.special === 'kickoff') && h.user_side === 'defense' && !(flags & FLAG.Carrier)) {
    return h.special === 'punt' ? `Get under it  ·  ${pad ? 'Y' : 'F'}  fair catch` : 'Get under the kick!';
  }
  if (flags & FLAG.Carrier && !up)
    return pad ? 'RT sprint · A juke · X spin · B stiff arm · Y hurdle · RB truck' : 'SHIFT sprint · SPACE juke · Q spin · E stiff arm · C hurdle · R truck';
  if (flags & FLAG.Engaged && h.user_side === 'defense') return pad ? 'A swim · X spin · B bull rush' : 'SPACE swim · Q spin · E bull rush';
  if (up) return pad ? 'A B X Y RB throw · tap bullet, hold lob · stick places the ball' : '1–5 / click to throw · tap bullet, hold lob · hold a direction to place it';
  if (h.user_side === 'defense' || !(flags & FLAG.Offense)) return pad ? 'B switch  ·  A dive  ·  RT sprint' : 'TAB switch  ·  SPACE dive  ·  SHIFT sprint';
  return pad ? 'RT sprint' : 'SHIFT sprint';
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
  handlePad(pads.poll(dt), s);
  if (!s || !renderer) return;
  if (replay.active) {
    replayFrame(s, dt, draw);
    return;
  }

  // Fixed-step simulation.
  if (!s.paused) {
    acc += dt;
    let first = true;
    while (acc >= STEP) {
      const fi = input.consume();
      const [mx, my] = s.cam.screenToField(fi.ix, fi.iy);
      s.prev.set(s.cur);
      s.game.step(STEP, mx, my, first ? fi.buttons : fi.buttons & BTN.Sprint, first ? fi.throwTo : 0, fi.throwKind);
      s.cur = s.game.snapshot();
      s.rag = s.game.ragdolls();
      if (!s.attract && s.hud.phase === 'inplay') replay.record(s.cur, s.rag);
      acc -= STEP;
      first = false;
    }
  }
  const alpha = s.paused ? 1 : Math.min(1, acc / STEP);

  s.hud = JSON.parse(s.game.hud()) as Hud;
  if (s.hud.lineup !== s.lineup) applyLineup(s);
  handleEvents(s, JSON.parse(s.game.events()) as GameEvent[]);

  s.players.padIcons = usingPad;
  s.players.update(s.prev, s.cur, alpha, dt, time, s.rag);
  const scrimmageLines = s.hud.situation !== 'kickoff' && !s.hud.special;
  s.stadium.setMarkers(s.hud.los_x, s.hud.first_down_x, scrimmageLines && s.hud.to_go !== 'Goal', s.hud.down, s.hud.dir);
  s.stadium.setScoreboard(s.hud);
  s.players.excitement = sfx.level;
  s.stadium.update(time, s.attract ? 0.1 : sfx.level);

  // Camera focus: the line of scrimmage before the snap, the ball once it's live.
  const h = s.hud;
  let fx: number;
  let fy: number;
  if (h.phase !== 'inplay' || h.play_phase === 'presnap') {
    fx = h.los_x - h.dir * 3;
    fy = h.ball_y;
  } else {
    // Look a little ahead of where the ball is going.
    fx = s.players.ballPos.x + s.ballVel.x * 0.3;
    fy = -(s.players.ballPos.z + s.ballVel.z * 0.3);
  }
  if (dt > 0) {
    const v = new THREE.Vector3().subVectors(s.players.ballPos, s.lastBall).divideScalar(dt);
    if (v.length() < 40) s.ballVel.lerp(v, 1 - Math.exp(-dt * 4));
    s.lastBall.copy(s.players.ballPos);
  }
  // Pull back for kicks and deep balls.
  const bz = s.players.ballPos.y;
  const boost = h.play_phase === 'live' ? (h.special && bz > 2.5 ? 1.35 : 1 + Math.min(Math.max(bz - 3, 0), 12) / 40) : 1;
  s.cam.update(dt, fx, fy, h.dir, boost);

  if (!s.attract) {
    ui.updateHud(h, s.teams);
    ui.hint(contextHint(s));
    ui.throwMeter(input.holdProgress());

    // Kick meter for the user's kicks.
    const kicking = meterActive(s);
    const title = { kickoff: 'KICKOFF', punt: 'PUNT', fg: 'FIELD GOAL', pat: 'EXTRA POINT', '': 'KICK' }[h.special] ?? 'KICK';
    meter.show(kicking, title);
    if (kicking) meter.update(dt);

    // Play calling.
    if (h.phase === 'playcall' && h.user_choosing && !s.paused) {
      s.menuDelay += dt;
      if (!ui.menuOpen && s.menuDelay > 0.9) {
        const items = JSON.parse(s.game.menu()) as MenuItem[];
        if (items.length) {
          ui.openMenu(
            items,
            h,
            s.teams,
            (idx) => {
              sfx.ui();
              s.game.call_play(idx);
            },
            h.situation === 'scrimmage' ? () => callTimeout(s) : null,
          );
        }
      }
    } else {
      s.menuDelay = Math.min(s.menuDelay, 0);
      if (ui.menuOpen && (h.phase !== 'playcall' || !h.user_choosing)) ui.closeMenu();
    }

    if (h.phase === 'final' && !s.finalShown) {
      s.finalDelay += dt;
      if (s.finalDelay > 2.5) {
        s.finalShown = true;
        input.enabled = false;
        const stats = JSON.parse(s.game.stats()) as TeamStatLine[];
        ui.showFinal(h, s.teams, stats, () => quitToTitle());
      }
    }

    if (quality.sample(dt)) applyQuality();
    sfx.update(dt);
  }

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    ui.fps(showFps ? `${Math.round(fpsFrames / fpsTime)} fps · ${quality.label}` : null);
    fpsFrames = 0;
    fpsTime = 0;
  }

  if (draw) pipeline!.render(s.scene, s.cam.camera);
}

function replayFrame(s: Session, dt: number, draw: boolean) {
  replay.advance(dt);
  const f = replay.frames();
  if (!f) {
    exitReplay(s);
    return;
  }
  s.players.update(f.a.snap, f.b.snap, f.alpha, dt * replay.speed, time, f.b.rag);
  s.cam.replay(dt, s.players.ballPos, replay.cam, replay.time);
  const pct = replay.length > 1 ? replay.t / (replay.length - 1) : 0;
  (document.querySelector('#replay-bar .rb-fill') as HTMLElement).style.width = `${Math.round(pct * 100)}%`;
  (document.querySelector('#replay-bar .rb-state') as HTMLElement).textContent =
    (replay.paused ? 'PAUSED' : replay.speed < 1 ? 'SLOW-MO' : 'PLAYING') + ` · CAM ${(replay.cam % 4) + 1}`;
  ui.hint('');
  if (draw) pipeline!.render(s.scene, s.cam.camera);
}

window.addEventListener('resize', () => {
  applyQuality();
  session?.cam.setAspect(window.innerWidth / window.innerHeight);
});
window.addEventListener('gamepadconnected', () => {
  usingPad = true;
  if (session && !session.attract) ui.banner('CONTROLLER CONNECTED', 'info');
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
  pipeline = new Ps2Pipeline(renderer);
  applyQuality();
  try {
    await init();
    // Canvas textures (numbers, scoreboards) need the bundled font loaded first.
    await Promise.race([
      Promise.all(['700 32px', 'italic 700 32px', '800 32px', 'italic 800 32px'].map((f) => document.fonts.load(`${f} "Barlow Condensed"`))),
      new Promise((r) => setTimeout(r, 2500)),
    ]).catch(() => undefined);
    setNumberFont(UI_FONT);
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

// Installable offline app: cache the game after the first visit.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err));
  });
}

// Dev-only test hooks: advance the game by N seconds even when the tab is in the
// background (browsers pause requestAnimationFrame for hidden tabs).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__sf = {
    hud: () => session?.hud,
    game: () => session?.game,
    replay: () => replay,
    /** Show a painted uniform atlas full-size on the page (for checking textures). */
    async atlas(teamIdx = 0, number = 27, home = true) {
      const { paintUniform, SKIN_TONES } = await import('./render/athlete');
      const { uniformFor } = await import('./render/players');
      const cv = paintUniform(uniformFor(TEAMS[teamIdx], home), number, SKIN_TONES[2]);
      cv.style.cssText = 'position:fixed;left:10px;top:60px;width:512px;height:512px;z-index:99;image-rendering:pixelated;border:2px solid #fff';
      cv.id = 'atlas-debug';
      document.getElementById('atlas-debug')?.remove();
      document.body.appendChild(cv);
    },
    tick(seconds: number) {
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) frame(last + 1000 / 60, false);
      last = performance.now(); // don't leave the real loop's clock in the future
    },
  };
}
