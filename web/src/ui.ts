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

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage blocked */
  }
}

export interface TitleChoice {
  home: number;
  away: number;
  quarterMinutes: number;
  quality: string;
  difficulty: number;
  penalties: number;
  overtime: boolean;
}

export interface TeamStatLine {
  rush_att: number;
  rush_yds: number;
  pass_att: number;
  comp: number;
  pass_yds: number;
  ints: number;
  sacks: number;
  fg_made: number;
  fg_att: number;
  penalties: number;
  penalty_yds: number;
}

export class UI {
  private bannerTimer = 0;
  private tickerTimer = 0;
  private menu: MenuItem[] = [];
  private groups: string[] = [];
  private tab = 0;
  private tabMemory: Record<string, number> = {};
  private memKey = '';
  private sel = 0;
  private onPick: ((idx: number) => void) | null = null;
  private onTimeout: (() => void) | null = null;
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
    // Remember settings between visits.
    for (const [id, key, def] of [
      ['#opt-quarter', 'sf.opt.quarter', '5'],
      ['#opt-difficulty', 'sf.opt.difficulty', '1'],
      ['#opt-penalties', 'sf.opt.penalties', '1'],
      ['#opt-ot', 'sf.opt.ot', '1'],
    ] as const) {
      const el = $(id) as HTMLSelectElement;
      el.value = loadPref(key, def);
      el.onchange = () => savePref(key, el.value);
    }
    const start = () =>
      onStart({
        home,
        away,
        quarterMinutes: Number(($('#opt-quarter') as HTMLSelectElement).value),
        quality: ($('#opt-quality') as HTMLSelectElement).value,
        difficulty: Number(($('#opt-difficulty') as HTMLSelectElement).value),
        penalties: Number(($('#opt-penalties') as HTMLSelectElement).value),
        overtime: ($('#opt-ot') as HTMLSelectElement).value === '1',
      });
    $('#kickoff').onclick = start;
    this.titleStart = start;
    this.titleStep = step;
  }

  titleStart: () => void = () => {};
  titleStep: (which: 'home' | 'away', d: number) => void = () => {};

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
      el.classList.toggle('has-ball', h.possession === i && h.phase !== 'final' && h.situation === 'scrimmage');
      const pips = el.querySelector('.sb-tos') as HTMLElement;
      const n = h.timeouts[i];
      const html = [0, 1, 2].map((k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('');
      if (pips.innerHTML !== html) pips.innerHTML = html;
    };
    side($('#sb-away'), 1);
    side($('#sb-home'), 0);
    $('#sb-q').textContent = h.phase === 'final' ? 'FINAL' : h.quarter_label;
    $('#sb-time').textContent = h.phase === 'final' ? '' : fmtClock(h.clock);
    let down = '';
    if (h.phase !== 'final') {
      if (h.situation === 'kickoff') down = 'KICKOFF';
      else if (h.situation === 'try') down = 'TRY';
      else if (h.situation === 'two_point') down = `2-PT TRY · ${h.spot}`;
      else down = `${ordinal(h.down)} & ${h.to_go} · ${h.spot}`;
    }
    $('#sb-down').textContent = down;
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

  openMenu(items: MenuItem[], h: Hud, teams: [TeamInfo, TeamInfo], onPick: (idx: number) => void, onTimeout: (() => void) | null) {
    this.menu = items;
    this.onPick = onPick;
    this.onTimeout = onTimeout;
    this.groups = [...new Set(items.map((i) => i.group))];
    const memKey = `${h.user_side}|${this.groups.join(',')}`;
    this.memKey = memKey;
    this.tab = Math.min(this.tabMemory[memKey] ?? 0, this.groups.length - 1);
    const off = h.user_side === 'offense';
    const team = teams[h.possession];
    let title = off ? `${team.city} ${team.name} · Offense` : 'Call your defense';
    if (h.situation === 'kickoff') title = 'Kickoff';
    if (h.situation === 'try') title = 'Touchdown! Choose your try';
    if (h.situation === 'two_point') title = off ? 'Two-point try' : 'Stop the two-point try';
    $('#playcall .pc-title').textContent = title;
    $('#playcall .pc-sit').textContent =
      h.situation === 'scrimmage' || h.situation === 'two_point'
        ? `${ordinal(h.down)} & ${h.to_go} at ${h.spot} · ${h.quarter_label} ${fmtClock(h.clock)}`
        : `${h.quarter_label} ${fmtClock(h.clock)}`;
    const to = $('#pc-timeout') as HTMLButtonElement;
    const left = h.user_side === 'none' ? 0 : h.timeouts[h.user_side === 'offense' ? h.possession : 1 - h.possession];
    to.hidden = !onTimeout || h.situation !== 'scrimmage';
    to.disabled = left <= 0;
    to.textContent = `Timeout (${left}) · T / Y`;
    to.onclick = () => this.onTimeout?.();
    this.renderTabs();
    $('#playcall').hidden = false;
    this.menuOpen = true;
  }

  private renderTabs() {
    const tabs = $('#playcall .pc-tabs');
    tabs.hidden = this.groups.length <= 1;
    tabs.innerHTML = '';
    this.groups.forEach((g, i) => {
      const b = document.createElement('button');
      b.className = 'pc-tab' + (i === this.tab ? ' on' : '');
      b.textContent = g;
      b.onclick = () => this.setTab(i);
      tabs.appendChild(b);
    });
    this.tabMemory[this.memKey] = this.tab;
    this.renderGrid();
  }

  private setTab(i: number) {
    const n = this.groups.length;
    this.tab = ((i % n) + n) % n;
    this.sel = 0;
    this.renderTabs();
  }

  private visible(): MenuItem[] {
    const g = this.groups[this.tab];
    return this.menu.filter((m) => m.group === g);
  }

  private renderGrid() {
    const grid = $('#playcall .pc-grid');
    grid.innerHTML = '';
    const items = this.visible();
    if (this.sel >= items.length) this.sel = 0;
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'pc-card';
      b.innerHTML = `<div class="cat cat-${it.cat}">${it.cat}</div><div class="nm">${it.name}</div><div class="fm">${it.formation}</div>`;
      b.onclick = () => this.pick(i);
      b.onmouseenter = () => this.select(i);
      grid.appendChild(b);
    });
    this.select(this.sel);
  }

  closeMenu() {
    $('#playcall').hidden = true;
    this.menuOpen = false;
  }

  private select(i: number) {
    const n = this.visible().length;
    this.sel = Math.max(0, Math.min(n - 1, i));
    document.querySelectorAll('#playcall .pc-card').forEach((c, k) => c.classList.toggle('sel', k === this.sel));
  }

  private pick(i: number) {
    const it = this.visible()[i];
    if (!it || !this.onPick) return;
    this.sel = i;
    const cb = this.onPick;
    this.closeMenu();
    cb(it.idx);
  }

  /** Menu navigation from keyboard or gamepad. */
  menuNav(action: 'left' | 'right' | 'up' | 'down' | 'select' | 'tabPrev' | 'tabNext' | 'timeout'): boolean {
    if (!this.menuOpen) return false;
    const cols = Math.max(1, Math.floor(($('#playcall .pc-grid').clientWidth + 8) / 176));
    switch (action) {
      case 'left': this.select(this.sel - 1); return true;
      case 'right': this.select(this.sel + 1); return true;
      case 'up': this.select(this.sel - cols); return true;
      case 'down': this.select(this.sel + cols); return true;
      case 'select': this.pick(this.sel); return true;
      case 'tabPrev': this.setTab(this.tab - 1); return true;
      case 'tabNext': this.setTab(this.tab + 1); return true;
      case 'timeout': this.onTimeout?.(); return true;
    }
  }

  menuKey(code: string): boolean {
    const map: Record<string, Parameters<UI['menuNav']>[0]> = {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      Enter: 'select', Space: 'select', KeyQ: 'tabPrev', BracketLeft: 'tabPrev', PageUp: 'tabPrev',
      KeyE: 'tabNext', BracketRight: 'tabNext', PageDown: 'tabNext', KeyT: 'timeout',
    };
    const a = map[code];
    return a ? this.menuNav(a) : false;
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

  showFinal(h: Hud, teams: [TeamInfo, TeamInfo] | null, stats?: TeamStatLine[], onAgain?: () => void) {
    $('#final').hidden = !teams;
    if (!teams) return;
    const tie = h.score[0] === h.score[1];
    $('#final-score').innerHTML = `${teams[1].city} ${h.score[1]}<br>${teams[0].city} ${h.score[0]}${tie ? '<br><small>TIE</small>' : ''}`;
    const box = $('#final-box');
    if (stats && stats.length === 2) {
      const row = (label: string, f: (s: TeamStatLine) => string) =>
        `<tr><td>${f(stats[1])}</td><th>${label}</th><td>${f(stats[0])}</td></tr>`;
      box.innerHTML = `<table><tr><td><b>${h.abbr[1]}</b></td><th></th><td><b>${h.abbr[0]}</b></td></tr>
        ${row('Passing', (s) => `${s.comp}/${s.pass_att}, ${Math.round(s.pass_yds)} yds`)}
        ${row('Rushing', (s) => `${s.rush_att} for ${Math.round(s.rush_yds)}`)}
        ${row('Turnovers', (s) => `${s.ints}`)}
        ${row('Sacks allowed', (s) => `${s.sacks}`)}
        ${row('Field goals', (s) => `${s.fg_made}/${s.fg_att}`)}
        ${row('Penalties', (s) => `${s.penalties}-${Math.round(s.penalty_yds)}`)}
      </table>`;
    } else {
      box.innerHTML = '';
    }
    if (onAgain) $('#again').onclick = onAgain;
  }
}
