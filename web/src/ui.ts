// DOM overlay: title screen, score bug, banners, ticker, play-call menu, pause and final screens.

import type { Hud, MenuItem, TeamInfo } from './types';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function teamLabel(t: TeamInfo): string {
  return `${t.city.toUpperCase()}<small>${t.name}</small>`;
}

function fmtClock(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function ordinal(n: number): string {
  return ['', '1st', '2nd', '3rd', '4th'][n] ?? `${n}th`;
}

export interface TitleChoice {
  home: number;
  away: number;
  quarterMinutes: number;
  quality: string;
}

export class UI {
  private bannerTimer = 0;
  private tickerTimer = 0;
  private menu: MenuItem[] = [];
  private sel = 0;
  private onPick: ((idx: number) => void) | null = null;
  menuOpen = false;
  pauseOpen = false;

  constructor(private teams: TeamInfo[]) {}

  // ---------------------------------------------------------------- title

  initTitle(defaultHome: number, onStart: (c: TitleChoice) => void) {
    let home = defaultHome;
    let away = (defaultHome + 1 + Math.floor(Math.random() * (this.teams.length - 1))) % this.teams.length;
    const paint = (id: string, idx: number) => {
      const t = this.teams[idx];
      const el = $(`#${id} .team-name`);
      el.innerHTML = teamLabel(t);
      el.style.background = `linear-gradient(180deg, rgba(255,255,255,.4) 0%, rgba(255,255,255,.1) 48%, rgba(0,0,0,0) 52%, rgba(0,0,0,.3) 100%), linear-gradient(180deg, ${t.primary}, ${t.secondary})`;
    };
    const step = (which: 'home' | 'away', d: number) => {
      const n = this.teams.length;
      if (which === 'home') {
        home = (home + d + n) % n;
        if (home === away) home = (home + d + n) % n;
      } else {
        away = (away + d + n) % n;
        if (away === home) away = (away + d + n) % n;
      }
      paint('pick-home', home);
      paint('pick-away', away);
    };
    document.querySelectorAll<HTMLButtonElement>('#pick-home .arrow').forEach((b) => (b.onclick = () => step('home', Number(b.dataset.dir))));
    document.querySelectorAll<HTMLButtonElement>('#pick-away .arrow').forEach((b) => (b.onclick = () => step('away', Number(b.dataset.dir))));
    paint('pick-home', home);
    paint('pick-away', away);
    const start = () =>
      onStart({
        home,
        away,
        quarterMinutes: Number(($('#opt-quarter') as HTMLSelectElement).value),
        quality: ($('#opt-quality') as HTMLSelectElement).value,
      });
    $('#kickoff').onclick = start;
    this.titleStart = start;
  }

  titleStart: () => void = () => {};

  showTitle(show: boolean) {
    $('#title').hidden = !show;
    $('#hud').hidden = show;
  }

  setLoadStatus(text: string) {
    $('#load-status').textContent = text;
  }

  // ---------------------------------------------------------------- HUD

  updateHud(h: Hud, teams: [TeamInfo, TeamInfo]) {
    const side = (el: HTMLElement, i: number) => {
      el.style.setProperty('--team', teams[i].primary);
      (el.querySelector('.sb-abbr') as HTMLElement).textContent = h.abbr[i];
      (el.querySelector('.sb-score') as HTMLElement).textContent = String(h.score[i]);
      el.classList.toggle('has-ball', h.possession === i && h.phase !== 'final');
    };
    side($('#sb-away'), 1);
    side($('#sb-home'), 0);
    $('#sb-q').textContent = h.phase === 'final' ? 'FINAL' : `Q${h.quarter}`;
    $('#sb-time').textContent = h.phase === 'final' ? '' : fmtClock(h.clock);
    $('#sb-down').textContent = h.phase === 'final' ? '' : `${ordinal(h.down)} & ${h.to_go} · ${h.spot}`;
  }

  hint(text: string) {
    const el = $('#hint');
    if (el.textContent !== text) el.textContent = text;
  }

  banner(text: string, style: string) {
    const el = $('#banner');
    el.textContent = text;
    el.className = `show ${style}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (el.className = style), 1600);
  }

  ticker(text: string) {
    $('#ticker').textContent = text;
    const bar = $('#lower-third');
    bar.classList.add('show');
    clearTimeout(this.tickerTimer);
    this.tickerTimer = window.setTimeout(() => bar.classList.remove('show'), 5200);
  }

  throwMeter(p: number) {
    const el = $('#throw-meter');
    el.classList.toggle('show', p >= 0);
    if (p >= 0) (el.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  }

  fps(text: string | null) {
    const el = $('#fps');
    el.hidden = text === null;
    if (text !== null) el.textContent = text;
  }

  // ---------------------------------------------------------------- play call

  openMenu(items: MenuItem[], h: Hud, teams: [TeamInfo, TeamInfo], onPick: (idx: number) => void) {
    this.menu = items;
    this.onPick = onPick;
    if (this.sel >= items.length) this.sel = 0;
    const off = h.user_side === 'offense';
    const team = teams[h.possession];
    $('#playcall .pc-title').textContent = off ? `${team.city} ${team.name} · Offense` : 'Call your defense';
    $('#playcall .pc-sit').textContent = `${ordinal(h.down)} & ${h.to_go} at ${h.spot} · Q${h.quarter} ${fmtClock(h.clock)}`;
    const grid = $('#playcall .pc-grid');
    grid.innerHTML = '';
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'pc-card';
      b.innerHTML = `<div class="cat cat-${it.cat}">${it.cat}</div><div class="nm">${it.name}</div><div class="fm">${it.formation}</div>`;
      b.onclick = () => this.pick(i);
      b.onmouseenter = () => this.select(i);
      grid.appendChild(b);
    });
    $('#playcall').hidden = false;
    this.menuOpen = true;
    this.select(this.sel);
  }

  closeMenu() {
    $('#playcall').hidden = true;
    this.menuOpen = false;
  }

  private select(i: number) {
    this.sel = Math.max(0, Math.min(this.menu.length - 1, i));
    document.querySelectorAll('#playcall .pc-card').forEach((c, k) => c.classList.toggle('sel', k === this.sel));
  }

  private pick(i: number) {
    const it = this.menu[i];
    if (!it || !this.onPick) return;
    this.sel = i;
    const cb = this.onPick;
    this.closeMenu();
    cb(it.idx);
  }

  /** Arrow keys / Enter while the play-call menu is open. */
  menuKey(code: string): boolean {
    if (!this.menuOpen) return false;
    const cols = Math.max(1, Math.floor(($('#playcall .pc-grid').clientWidth + 8) / 158));
    switch (code) {
      case 'ArrowLeft': case 'KeyA': this.select(this.sel - 1); return true;
      case 'ArrowRight': case 'KeyD': this.select(this.sel + 1); return true;
      case 'ArrowUp': case 'KeyW': this.select(this.sel - cols); return true;
      case 'ArrowDown': case 'KeyS': this.select(this.sel + cols); return true;
      case 'Enter': case 'Space': this.pick(this.sel); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- pause / final

  showPause(show: boolean, labels: { camera: string; quality: string; mute: string }, onAct?: (act: string) => void) {
    this.pauseOpen = show;
    $('#pause').hidden = !show;
    $('#cam-name').textContent = labels.camera;
    $('#q-name').textContent = labels.quality;
    $('#mute-name').textContent = labels.mute;
    if (onAct) {
      document.querySelectorAll<HTMLButtonElement>('#pause [data-act]').forEach((b) => (b.onclick = () => onAct(b.dataset.act!)));
    }
  }

  showFinal(h: Hud, teams: [TeamInfo, TeamInfo] | null, onAgain?: () => void) {
    $('#final').hidden = !teams;
    if (!teams) return;
    $('#final-score').innerHTML = `${teams[1].city} ${h.score[1]}<br>${teams[0].city} ${h.score[0]}`;
    if (onAgain) $('#again').onclick = onAgain;
  }
}
