//! A full game: downs, clock rules, timeouts, quarters, overtime, scoring, penalties,
//! play calling and special teams.

use crate::events::Event;
use crate::math::clamp;
use crate::player::{gen_team, Pos, Team};
use crate::playbook::{defense_index, offense_index, PlayKind, DEFENSE, OFFENSE};
use crate::rng::Rng;
use crate::sim::{EndKind, Foul, Input, KickParams, Play, PlayPhase, PlayResult, PlaySetup, FIELD_W, HASH_HI, HASH_LO};
use crate::special::{KickStyle, SpecialSetup, StKind};
use serde::Serialize;

/// Menu codes for non-scrimmage choices.
pub const MENU_KICK_DEEP: usize = 1000;
pub const MENU_KICK_SQUIB: usize = 1001;
pub const MENU_KICK_ONSIDE: usize = 1002;
pub const MENU_PAT: usize = 1100;
pub const MENU_TWO_POINT: usize = 1101;

#[derive(Clone, Debug)]
pub struct Settings {
    /// Seconds per quarter.
    pub quarter_len: f32,
    /// Seconds run off between plays when the clock is running (accelerated clock).
    pub runoff: f32,
    /// Which team the human controls (`None` = CPU vs CPU).
    pub user_team: Option<u8>,
    /// 0 Rookie, 1 Pro, 2 All-Pro, 3 Legend.
    pub difficulty: u8,
    /// Penalty frequency (0 = off, 1 = normal, 2 = strict).
    pub penalties: f32,
    pub overtime: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { quarter_len: 300.0, runoff: 15.0, user_team: Some(0), difficulty: 1, penalties: 1.0, overtime: true }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    PlayCall,
    InPlay,
    Final,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Situation {
    Scrimmage,
    /// `team` kicks off from its own `from_yd` yard line (35, or 20 after a safety).
    Kickoff { team: u8, from_yd: f32 },
    /// After a touchdown: `team` chooses an extra point or a 2-point try.
    Try { team: u8 },
    /// 2-point try in progress (a scrimmage play from the 2).
    TwoPoint { team: u8 },
}

/// What kind of play is running (for resolution).
#[derive(Clone, Copy, Debug, PartialEq)]
enum Current {
    Scrimmage,
    Kickoff { team: u8 },
    Punt { team: u8 },
    FieldGoal { team: u8, pat: bool },
}

#[derive(Clone, Copy, Debug)]
struct OtState {
    had_ball: [bool; 2],
}

#[derive(Serialize)]
pub struct Hud {
    pub phase: &'static str,
    pub play_phase: &'static str,
    pub user_side: &'static str,
    pub situation: &'static str,
    pub special: &'static str,
    pub user_kicking: bool,
    pub user_choosing: bool,
    pub abbr: [String; 2],
    pub score: [u16; 2],
    pub quarter: u8,
    pub quarter_label: String,
    pub clock: f32,
    pub clock_running: bool,
    pub timeouts: [u8; 2],
    pub down: u8,
    pub to_go: String,
    pub spot: String,
    pub possession: u8,
    pub los_x: f32,
    pub first_down_x: f32,
    pub ball_y: f32,
    pub dir: f32,
    pub lineup: u32,
    pub off_play: String,
    pub def_play: String,
    pub last_play: String,
    pub user_def_slot: usize,
    pub kneel_window: bool,
}

#[derive(Serialize)]
pub struct MenuItem {
    pub idx: usize,
    pub name: &'static str,
    pub cat: &'static str,
    pub formation: &'static str,
    pub group: &'static str,
}

#[derive(Serialize)]
pub struct LineupEntry {
    pub team: u8,
    pub number: u8,
    pub pos: &'static str,
    pub name: String,
    pub skin: u8,
    pub build: u8,
}

/// Per-team box-score totals (the franchise stat book grows from this).
#[derive(Clone, Debug, Default, Serialize)]
pub struct TeamStats {
    pub rush_att: u32,
    pub rush_yds: f32,
    pub pass_att: u32,
    pub comp: u32,
    pub pass_yds: f32,
    pub ints: u32,
    pub sacks: u32,
    pub tds: u32,
    pub explosive: u32,
    pub air_yds: f32,
    pub penalties: u32,
    pub penalty_yds: f32,
    pub fg_made: u32,
    pub fg_att: u32,
    pub punts: u32,
    pub punt_yds: f32,
    pub kr_yds: f32,
    pub kr: u32,
    pub fumbles_lost: u32,
}

pub struct Game {
    pub settings: Settings,
    pub rng: Rng,
    pub teams: [Team; 2],
    pub score: [u16; 2],
    pub quarter: u8,
    pub clock: f32,
    pub clock_running: bool,
    pub timeouts: [u8; 2],
    pub possession: u8,
    /// Ball position in yards from the offense's own goal line (0–100).
    pub ball_yd: f32,
    pub ball_y: f32,
    pub down: u8,
    pub to_go: f32,
    pub opening_kicker: u8,
    pub phase: Phase,
    pub situation: Situation,
    pub play: Play,
    pub lineup: u32,
    pub events: Vec<Event>,
    pub last_play: String,
    pub user_def_slot: usize,
    pub plays_run: u32,
    pub stats: [TeamStats; 2],
    current: Current,
    pending_kick: Option<KickParams>,
    auto_t: f32,
    tmw_done: bool,
    tmw_pending: bool,
    cpu_to_checked: bool,
    ot: Option<OtState>,
}

fn other(t: u8) -> u8 {
    1 - t
}

impl Game {
    pub fn new(seed: u64, settings: Settings, abbr: [&str; 2], strength: [f32; 2]) -> Game {
        let mut rng = Rng::new(seed);
        let mut strength = strength;
        if let Some(u) = settings.user_team {
            let cpu = other(u) as usize;
            strength[cpu] += [-4.0, 0.0, 3.0, 6.0][settings.difficulty.min(3) as usize];
        }
        let teams = [gen_team(&mut rng, abbr[0], strength[0], 1000), gen_team(&mut rng, abbr[1], strength[1], 2000)];
        let opening_kicker = rng.below(2) as u8;
        let mut g = Game {
            clock: settings.quarter_len,
            settings,
            rng,
            teams,
            score: [0, 0],
            quarter: 1,
            clock_running: false,
            timeouts: [3, 3],
            possession: other(opening_kicker),
            ball_yd: 25.0,
            ball_y: FIELD_W * 0.5,
            down: 1,
            to_go: 10.0,
            opening_kicker,
            phase: Phase::PlayCall,
            situation: Situation::Kickoff { team: opening_kicker, from_yd: 35.0 },
            play: Play::empty(),
            lineup: 0,
            events: Vec::new(),
            last_play: String::new(),
            user_def_slot: 5,
            plays_run: 0,
            stats: [TeamStats::default(), TeamStats::default()],
            current: Current::Scrimmage,
            pending_kick: None,
            auto_t: 0.0,
            tmw_done: false,
            tmw_pending: false,
            cpu_to_checked: false,
            ot: None,
        };
        g.preview();
        let recv = g.teams[other(opening_kicker) as usize].abbr.clone();
        g.events.push(Event::Banner { text: format!("{} RECEIVES", recv), style: "info".into() });
        g
    }

    // -----------------------------------------------------------------------
    // Geometry & situation helpers
    // -----------------------------------------------------------------------

    /// +1 if `team` attacks toward x = 120 this quarter.
    pub fn team_dir(&self, team: u8) -> f32 {
        let t0 = if self.quarter % 2 == 1 { 1.0 } else { -1.0 };
        if team == 0 {
            t0
        } else {
            -t0
        }
    }

    fn yd_to_x(&self, team: u8, yd: f32) -> f32 {
        if self.team_dir(team) > 0.0 {
            10.0 + yd
        } else {
            110.0 - yd
        }
    }

    fn x_to_yd(&self, team: u8, x: f32) -> f32 {
        if self.team_dir(team) > 0.0 {
            x - 10.0
        } else {
            110.0 - x
        }
    }

    pub fn los_x(&self) -> f32 {
        match self.situation {
            Situation::Kickoff { team, from_yd } => self.yd_to_x(team, from_yd),
            _ => self.yd_to_x(self.possession, self.ball_yd),
        }
    }

    pub fn first_down_x(&self) -> f32 {
        self.yd_to_x(self.possession, (self.ball_yd + self.to_go).min(100.0))
    }

    pub fn user_on_offense(&self) -> Option<bool> {
        self.settings.user_team.map(|u| u == self.possession)
    }

    fn tmw_mark(&self) -> f32 {
        if self.settings.quarter_len >= 240.0 {
            120.0
        } else {
            self.settings.quarter_len * 0.4
        }
    }

    /// Late in a half: out-of-bounds stops the clock, hurry-up matters.
    fn late_window(&self) -> bool {
        match self.quarter {
            2 | 5 => self.clock <= self.tmw_mark(),
            4 => self.clock <= (self.tmw_mark() * 2.5).min(self.settings.quarter_len * 0.5),
            _ => false,
        }
    }

    fn lead(&self, team: u8) -> i32 {
        self.score[team as usize] as i32 - self.score[other(team) as usize] as i32
    }

    /// The team that has to make the next choice, if a choice is needed.
    fn decider(&self) -> Option<u8> {
        match self.situation {
            Situation::Scrimmage | Situation::TwoPoint { .. } => self.settings.user_team,
            Situation::Kickoff { team, .. } => Some(team),
            Situation::Try { team } => Some(team),
        }
    }

    pub fn user_must_choose(&self) -> bool {
        self.phase == Phase::PlayCall
            && match self.situation {
                Situation::Scrimmage | Situation::TwoPoint { .. } => self.settings.user_team.is_some(),
                _ => self.decider().is_some() && self.decider() == self.settings.user_team,
            }
    }

    // -----------------------------------------------------------------------
    // Menus & calls
    // -----------------------------------------------------------------------

    pub fn menu(&self) -> Vec<MenuItem> {
        if !self.user_must_choose() {
            return Vec::new();
        }
        match self.situation {
            Situation::Kickoff { .. } => vec![
                MenuItem { idx: MENU_KICK_DEEP, name: "Deep Kick", cat: "SPECIAL", formation: "Kickoff", group: "Kickoff" },
                MenuItem { idx: MENU_KICK_SQUIB, name: "Squib Kick", cat: "SPECIAL", formation: "Kickoff", group: "Kickoff" },
                MenuItem { idx: MENU_KICK_ONSIDE, name: "Onside Kick", cat: "SPECIAL", formation: "Kickoff", group: "Kickoff" },
            ],
            Situation::Try { .. } => vec![
                MenuItem { idx: MENU_PAT, name: "Extra Point", cat: "SPECIAL", formation: "Field Goal", group: "Try" },
                MenuItem { idx: MENU_TWO_POINT, name: "Go For Two", cat: "PASS", formation: "From the 2", group: "Try" },
            ],
            Situation::Scrimmage | Situation::TwoPoint { .. } => match self.user_on_offense() {
                Some(true) => OFFENSE
                    .iter()
                    .enumerate()
                    .filter(|(_, p)| !(matches!(self.situation, Situation::TwoPoint { .. }) && p.is_special()))
                    .map(|(i, p)| MenuItem {
                        idx: i,
                        name: p.name,
                        cat: p.category(),
                        formation: p.formation.name,
                        group: if p.is_special() { "Special" } else { p.formation.name },
                    })
                    .collect(),
                Some(false) => DEFENSE
                    .iter()
                    .enumerate()
                    .map(|(i, p)| MenuItem {
                        idx: i,
                        name: p.name,
                        cat: if p.blitz { "BLITZ" } else { "COVERAGE" },
                        formation: p.personnel,
                        group: p.personnel,
                    })
                    .collect(),
                None => Vec::new(),
            },
        }
    }

    /// The human makes a call (offense/defense play, kickoff type, or try choice).
    pub fn call_play(&mut self, idx: usize) {
        if self.phase != Phase::PlayCall || !self.user_must_choose() {
            return;
        }
        match self.situation {
            Situation::Kickoff { .. } => {
                let style = match idx {
                    MENU_KICK_SQUIB => KickStyle::Squib,
                    MENU_KICK_ONSIDE => KickStyle::Onside,
                    _ => KickStyle::Deep,
                };
                self.start_kickoff(style);
            }
            Situation::Try { team } => {
                if idx == MENU_TWO_POINT {
                    self.begin_two_point(team);
                } else {
                    self.start_field_goal(true);
                }
            }
            Situation::Scrimmage | Situation::TwoPoint { .. } => {
                let (off, def) = match self.user_on_offense() {
                    Some(true) => {
                        let off = idx.min(OFFENSE.len() - 1);
                        (off, self.cpu_defense(off))
                    }
                    _ => {
                        let off = self.cpu_offense();
                        (off, idx.min(DEFENSE.len() - 1))
                    }
                };
                self.start_scrimmage(off, def);
            }
        }
    }

    /// CPU makes whatever call is needed right now.
    fn auto_call(&mut self) {
        match self.situation {
            Situation::Kickoff { team, .. } => {
                let style = self.cpu_kick_style(team);
                self.start_kickoff(style);
            }
            Situation::Try { team } => {
                if self.cpu_go_for_two(team) {
                    self.begin_two_point(team);
                } else {
                    self.start_field_goal(true);
                }
            }
            Situation::Scrimmage | Situation::TwoPoint { .. } => {
                let off = self.cpu_offense();
                let def = self.cpu_defense(off);
                self.start_scrimmage(off, def);
            }
        }
    }

    pub fn set_user_def_slot(&mut self, slot: usize) {
        self.user_def_slot = slot.min(10);
    }

    /// The user's kick meter result for the next kick.
    pub fn set_kick(&mut self, power: f32, accuracy: f32) {
        self.pending_kick = Some(KickParams { power: clamp(power, 0.0, 1.0), accuracy: clamp(accuracy, -1.0, 1.0) });
    }

    /// Call a timeout for `team` (between plays or before the snap). Returns true if granted.
    pub fn call_timeout(&mut self, team: u8) -> bool {
        let can = matches!(self.phase, Phase::PlayCall)
            || (self.phase == Phase::InPlay && self.play.phase == PlayPhase::PreSnap && self.play.special.is_none());
        if !can || self.timeouts[team as usize] == 0 || self.situation != Situation::Scrimmage {
            return false;
        }
        self.timeouts[team as usize] -= 1;
        self.clock_running = false;
        let abbr = self.teams[team as usize].abbr.clone();
        self.events.push(Event::Timeout { team });
        self.events.push(Event::Banner { text: format!("TIMEOUT {}", abbr), style: "info".into() });
        self.events.push(Event::Ticker { text: format!("Timeout, {}. {} left.", abbr, self.timeouts[team as usize]) });
        true
    }

    // -----------------------------------------------------------------------
    // Starting plays
    // -----------------------------------------------------------------------

    fn base_setup(&self, off: usize, def: usize, snap_delay: f32) -> PlaySetup<'_> {
        PlaySetup {
            off_team: self.possession,
            dir: self.team_dir(self.possession),
            los_x: self.los_x(),
            ball_y: self.ball_y,
            first_down_x: self.first_down_x(),
            off_play: off,
            def_play: def,
            teams: &self.teams,
            user_team: self.settings.user_team,
            user_def_slot: self.user_def_slot,
            snap_delay,
            penalty_rate: self.settings.penalties,
        }
    }

    /// Line both teams up at the spot while the next call is made.
    fn preview(&mut self) {
        self.lineup += 1;
        let mut rng = self.rng.clone();
        self.play = match self.situation {
            Situation::Kickoff { team, .. } => {
                let s = SpecialSetup {
                    kind: StKind::Kickoff(KickStyle::Deep),
                    kick_team: team,
                    dir: self.team_dir(team),
                    los_x: self.los_x(),
                    ball_y: FIELD_W * 0.5,
                    teams: &self.teams,
                    user_team: self.settings.user_team,
                    snap_delay: 999.0,
                };
                Play::new_special(s, &mut rng)
            }
            _ => {
                let setup = self.base_setup(offense_index("Slant Flat"), 0, 999.0);
                Play::new(setup, &mut rng)
            }
        };
        self.rng = rng;
    }

    fn apply_runoff(&mut self) {
        if !self.clock_running || self.clock <= 0.0 {
            return;
        }
        let off = self.possession;
        let mut r = self.settings.runoff;
        if self.late_window() {
            let lead = self.lead(off);
            if self.quarter == 2 || lead <= 0 {
                r = 7.0; // hurry-up
            } else if self.quarter >= 4 && lead > 0 {
                r = self.settings.runoff + 10.0; // milk the clock
            }
        }
        let before = self.clock;
        self.clock = (self.clock - r).max(1.0f32.min(self.clock));
        self.check_two_minute(before);
    }

    fn check_two_minute(&mut self, before: f32) {
        let mark = self.tmw_mark();
        if !self.tmw_done && matches!(self.quarter, 2 | 4) && before > mark && self.clock <= mark {
            self.clock = mark;
            self.tmw_done = true;
            self.clock_running = false;
            self.events.push(Event::TwoMinuteWarning);
            self.events.push(Event::Banner { text: "TWO-MINUTE WARNING".into(), style: "info".into() });
        }
    }

    fn start_scrimmage(&mut self, off: usize, def: usize) {
        match OFFENSE[off].kind {
            PlayKind::Punt => return self.start_punt(),
            PlayKind::FieldGoal => return self.start_field_goal(false),
            PlayKind::Kneel => return self.kneel(),
            PlayKind::Spike => return self.spike(),
            _ => {}
        }
        self.apply_runoff();
        // Pre-snap fouls: no play.
        let rate = self.settings.penalties;
        if rate > 0.0 {
            if self.rng.chance(0.012 * rate) {
                return self.pre_snap_foul(Foul::FalseStart);
            }
            if self.rng.chance(0.008 * rate) {
                return self.pre_snap_foul(Foul::Offside);
            }
        }
        let snap_delay = 1.2 + self.rng.f32() * 1.2;
        self.lineup += 1;
        let mut rng = self.rng.clone();
        let setup = self.base_setup(off, def, snap_delay);
        self.play = Play::new(setup, &mut rng);
        self.rng = rng;
        self.current = Current::Scrimmage;
        self.phase = Phase::InPlay;
        self.plays_run += 1;
    }

    fn start_special(&mut self, kind: StKind, kick_team: u8) {
        let mut rng = self.rng.clone();
        let snap_delay = 1.0 + rng.f32() * 0.6;
        let s = SpecialSetup {
            kind,
            kick_team,
            dir: self.team_dir(kick_team),
            los_x: self.los_x(),
            ball_y: if matches!(kind, StKind::Kickoff(_)) { FIELD_W * 0.5 } else { self.ball_y },
            teams: &self.teams,
            user_team: self.settings.user_team,
            snap_delay,
        };
        self.lineup += 1;
        self.play = Play::new_special(s, &mut rng);
        self.rng = rng;
        self.phase = Phase::InPlay;
        self.plays_run += 1;
    }

    fn start_kickoff(&mut self, style: KickStyle) {
        let Situation::Kickoff { team, .. } = self.situation else { return };
        self.current = Current::Kickoff { team };
        self.start_special(StKind::Kickoff(style), team);
    }

    fn start_punt(&mut self) {
        self.apply_runoff();
        let team = self.possession;
        self.current = Current::Punt { team };
        self.start_special(StKind::Punt, team);
    }

    fn start_field_goal(&mut self, pat: bool) {
        let team = match self.situation {
            Situation::Try { team } => team,
            _ => self.possession,
        };
        if pat {
            self.possession = team;
            self.ball_yd = 85.0;
            self.ball_y = FIELD_W * 0.5;
        } else {
            self.apply_runoff();
        }
        self.current = Current::FieldGoal { team, pat };
        self.start_special(StKind::FieldGoal { pat }, team);
    }

    fn begin_two_point(&mut self, team: u8) {
        self.situation = Situation::TwoPoint { team };
        self.possession = team;
        self.ball_yd = 98.0;
        self.ball_y = FIELD_W * 0.5;
        self.down = 1;
        self.to_go = 2.0;
        self.events.push(Event::Banner { text: "GOING FOR TWO".into(), style: "info".into() });
        self.phase = Phase::PlayCall;
        self.auto_t = 0.0;
        self.preview();
    }

    // -----------------------------------------------------------------------
    // Step
    // -----------------------------------------------------------------------

    pub fn step(&mut self, dt: f32, input: &Input) {
        match self.phase {
            Phase::Final => {}
            Phase::PlayCall => {
                if !self.cpu_to_checked {
                    self.cpu_to_checked = true;
                    self.cpu_timeouts();
                }
                if !self.user_must_choose() {
                    self.auto_t += dt;
                    let wait = if self.settings.user_team.is_some() { 1.4 } else { 0.0 };
                    if self.auto_t >= wait {
                        self.auto_call();
                    }
                }
            }
            Phase::InPlay => {
                if self.play.phase == PlayPhase::PreSnap && self.pending_kick.is_some() {
                    self.play.kick_input = self.pending_kick.take();
                }
                let mut rng = self.rng.clone();
                self.play.step(dt, input, &mut rng);
                self.rng = rng;
                if self.play.phase == PlayPhase::Live {
                    let before = self.clock;
                    self.clock = (self.clock - dt).max(0.0);
                    let mark = self.tmw_mark();
                    if !self.tmw_done && matches!(self.quarter, 2 | 4) && before > mark && self.clock <= mark {
                        self.tmw_pending = true;
                    }
                }
                if self.play.phase == PlayPhase::PreSnap {
                    if let Some(u) = self.play.user {
                        if u >= 11 && self.play.special.is_none() {
                            self.user_def_slot = u - 11;
                        }
                    }
                }
                self.events.append(&mut self.play.events);
                if self.play.phase == PlayPhase::Over && self.play.over_t >= 1.7 {
                    if let Some(r) = self.play.result.clone() {
                        self.resolve(r);
                    }
                }
            }
        }
    }

    fn new_possession(&mut self, team: u8, yd: f32) {
        if team != self.possession {
            if let Some(ot) = self.ot.as_mut() {
                ot.had_ball[self.possession as usize] = true;
            }
        }
        self.possession = team;
        self.ball_yd = clamp(yd, 1.0, 99.0);
        self.down = 1;
        self.to_go = (100.0 - self.ball_yd).min(10.0);
        self.ball_y = FIELD_W * 0.5;
        self.clock_running = false;
        self.situation = Situation::Scrimmage;
    }

    fn kicker_rating(&self, team: u8) -> (f32, f32) {
        let t = &self.teams[team as usize];
        let i = t.starter(Pos::K, 0);
        let r = t.players[i].ratings;
        (r.kick_power as f32, r.kick_acc as f32)
    }

    fn score_td(&mut self, team: u8) {
        self.score[team as usize] += 6;
        self.stats[team as usize].tds += 1;
        self.events.push(Event::Banner { text: "TOUCHDOWN!".into(), style: "good".into() });
        if let Some(ot) = self.ot.as_mut() {
            ot.had_ball[self.possession as usize] = true;
        }
        self.possession = team;
        self.situation = Situation::Try { team };
        self.clock_running = false;
    }

    fn kickoff_by(&mut self, team: u8, from_yd: f32) {
        self.situation = Situation::Kickoff { team, from_yd };
        self.possession = other(team);
        self.clock_running = false;
    }

    fn resolve(&mut self, r: PlayResult) {
        self.last_play = r.text.clone();
        self.events.push(Event::Ticker { text: r.text.clone() });
        let tmw = std::mem::take(&mut self.tmw_pending);
        match self.current {
            Current::Scrimmage => self.resolve_scrimmage(&r),
            Current::Kickoff { team } => self.resolve_kick(&r, team, true),
            Current::Punt { team } => self.resolve_kick(&r, team, false),
            Current::FieldGoal { team, pat } => self.resolve_fg(&r, team, pat),
        }
        if tmw && !self.tmw_done && self.phase != Phase::Final {
            self.clock = self.clock.min(self.tmw_mark()).max(self.clock);
            self.tmw_done = true;
            self.clock_running = false;
            self.events.push(Event::TwoMinuteWarning);
            self.events.push(Event::Banner { text: "TWO-MINUTE WARNING".into(), style: "info".into() });
        }
        self.after_play();
    }

    fn resolve_scrimmage(&mut self, r: &PlayResult) {
        let off = self.possession;
        let two_pt = matches!(self.situation, Situation::TwoPoint { .. });
        if !two_pt && self.enforce_penalties(r) {
            return;
        }
        if !two_pt {
            self.record_stats(off, r);
        }
        if two_pt {
            let team = off;
            let good = r.kind == EndKind::Touchdown && r.carrier_team == team;
            if good {
                self.score[team as usize] += 2;
            }
            self.events.push(Event::Banner { text: if good { "TWO-POINT TRY GOOD".into() } else { "TRY FAILS".into() }, style: if good { "good".into() } else { "bad".into() } });
            self.kickoff_by(team, 35.0);
            self.ot_after_score(team);
            return;
        }
        let mut stop_clock = true;
        match r.kind {
            EndKind::Touchdown => {
                self.score_td(r.carrier_team);
                if r.carrier_team != off {
                    self.ot_defensive_score(r.carrier_team);
                }
            }
            EndKind::Safety => {
                let scorer = other(r.carrier_team);
                self.score[scorer as usize] += 2;
                self.events.push(Event::Banner { text: "SAFETY!".into(), style: "bad".into() });
                self.kickoff_by(r.carrier_team, 20.0);
                self.ot_defensive_score(scorer);
            }
            EndKind::Touchback => {
                self.events.push(Event::Banner { text: "TOUCHBACK".into(), style: "info".into() });
                self.new_possession(r.carrier_team, 20.0);
                self.ot_after_change();
            }
            EndKind::Incomplete => {
                self.events.push(Event::Banner { text: "INCOMPLETE".into(), style: "info".into() });
                self.advance_down(0.0);
            }
            EndKind::Down | EndKind::OutOfBounds => {
                if r.turnover {
                    let yd = self.x_to_yd(r.carrier_team, r.spot.x);
                    let text = if r.fumble { "FUMBLE LOST" } else { "INTERCEPTED!" };
                    self.events.push(Event::Banner { text: text.into(), style: "bad".into() });
                    if r.fumble {
                        self.stats[off as usize].fumbles_lost += 1;
                    }
                    self.new_possession(r.carrier_team, if yd <= 0.0 { 20.0 } else { yd });
                    self.ball_y = clamp(r.spot.y, HASH_LO, HASH_HI);
                    self.ot_after_change();
                } else {
                    let new_yd = self.x_to_yd(off, r.spot.x);
                    let gained = new_yd - self.ball_yd;
                    self.ball_y = clamp(r.spot.y, HASH_LO, HASH_HI);
                    if r.sack {
                        self.events.push(Event::Banner { text: "SACKED!".into(), style: "bad".into() });
                    }
                    self.advance_down(gained);
                    stop_clock = r.kind == EndKind::OutOfBounds && self.late_window();
                }
            }
        }
        self.clock_running = !stop_clock && self.possession == off && self.situation == Situation::Scrimmage;
    }

    fn resolve_kick(&mut self, r: &PlayResult, kt: u8, kickoff: bool) {
        let rt = other(kt);
        if !kickoff {
            let st = &mut self.stats[kt as usize];
            st.punts += 1;
            if let Some(c) = self.play.special.as_ref().and_then(|s| if s.kicked { Some(s.land) } else { None }) {
                st.punt_yds += ((c.x - self.play.los_x) * self.play.dir).abs();
            }
        } else if r.carrier_team == rt && r.kind != EndKind::Touchback {
            if let Some(cs) = self.play.catch_spot {
                let dir = self.team_dir(rt);
                let st = &mut self.stats[rt as usize];
                st.kr += 1;
                st.kr_yds += (r.spot.x - cs.x) * dir;
            }
        }
        match r.kind {
            EndKind::Touchdown => {
                // Return touchdowns count as a possession; overtime is checked after the try.
                self.score_td(r.carrier_team);
            }
            EndKind::Safety => {
                let scorer = other(r.carrier_team);
                self.score[scorer as usize] += 2;
                self.events.push(Event::Banner { text: "SAFETY!".into(), style: "bad".into() });
                self.kickoff_by(r.carrier_team, 20.0);
                self.ot_defensive_score(scorer);
            }
            EndKind::Touchback => {
                self.events.push(Event::Banner { text: "TOUCHBACK".into(), style: "info".into() });
                self.new_possession(rt, if kickoff { 25.0 } else { 20.0 });
            }
            _ if r.kick_oob => {
                self.events.push(Event::Banner { text: "KICK OUT OF BOUNDS".into(), style: "bad".into() });
                self.new_possession(rt, 40.0);
            }
            _ => {
                let team = r.carrier_team;
                let yd = self.x_to_yd(team, r.spot.x);
                if team == kt {
                    self.events.push(Event::Banner { text: "KICKING TEAM RECOVERS".into(), style: "good".into() });
                }
                self.new_possession(team, if yd <= 0.0 { 20.0 } else { yd });
                self.ball_y = clamp(r.spot.y, HASH_LO, HASH_HI);
            }
        }
        if !kickoff && self.ot.is_some() && self.situation == Situation::Scrimmage {
            self.ot_after_change();
        }
    }

    fn resolve_fg(&mut self, r: &PlayResult, team: u8, pat: bool) {
        let good = r.fg.unwrap_or(false);
        if !pat {
            self.stats[team as usize].fg_att += 1;
        }
        let abbr = self.teams[team as usize].abbr.clone();
        if pat {
            if good {
                self.score[team as usize] += 1;
            }
            self.events.push(Event::ExtraPoint { good });
            self.events.push(Event::Banner { text: if good { "EXTRA POINT GOOD".into() } else { "EXTRA POINT NO GOOD".into() }, style: if good { "good".into() } else { "bad".into() } });
            self.kickoff_by(team, 35.0);
            self.ot_after_score(team);
            return;
        }
        let dist = (100.0 - self.ball_yd + 17.0).round() as i32;
        self.events.push(Event::FieldGoal { good, dist });
        if good {
            self.stats[team as usize].fg_made += 1;
            self.score[team as usize] += 3;
            self.events.push(Event::Banner { text: "FIELD GOAL IS GOOD".into(), style: "good".into() });
            self.events.push(Event::Ticker { text: format!("{} {}-yard field goal is GOOD.", abbr, dist) });
            self.kickoff_by(team, 35.0);
            self.ot_after_score(team);
        } else {
            self.events.push(Event::Banner { text: "NO GOOD".into(), style: "bad".into() });
            let spot = 100.0 - (self.ball_yd - 7.0);
            self.new_possession(other(team), spot.max(20.0));
            self.ot_after_change();
        }
    }

    /// Returns true if an accepted penalty replaced the play's result.
    fn enforce_penalties(&mut self, r: &PlayResult) -> bool {
        if r.flags.is_empty() {
            return false;
        }
        let off = self.possession;
        let off_flag = r.flags.iter().find(|f| f.team == off).cloned();
        let def_flag = r.flags.iter().find(|f| f.team != off).cloned();
        let play_yds = if r.turnover { -99.0 } else { self.x_to_yd(off, r.spot.x) - self.ball_yd };
        let play_td = r.kind == EndKind::Touchdown;
        if off_flag.is_some() && def_flag.is_some() {
            self.events.push(Event::Banner { text: "OFFSETTING PENALTIES".into(), style: "info".into() });
            self.events.push(Event::Ticker { text: "Offsetting penalties. Replay the down.".into() });
            return true;
        }
        if let Some(f) = off_flag {
            // Defense declines if the play went worse for the offense than the penalty.
            let decline = (r.turnover && r.carrier_team != off) || (play_yds <= -10.0 && !play_td) || (r.kind == EndKind::Safety);
            let abbr = self.teams[off as usize].abbr.clone();
            if decline {
                self.events.push(Event::Ticker { text: format!("{} on {} {}, declined.", f.foul.label(), abbr, f.player) });
                return false;
            }
            let yards = 10.0f32.min(self.ball_yd / 2.0);
            self.ball_yd -= yards;
            self.to_go += yards;
            self.stats[off as usize].penalties += 1;
            self.stats[off as usize].penalty_yds += yards;
            let text = format!("{}, {} {}. {} yards, repeat {} down.", f.foul.label(), abbr, f.player, yards.round(), ordinal(self.down));
            self.events.push(Event::Banner { text: format!("FLAG: {}", f.foul.label().to_uppercase()), style: "bad".into() });
            self.events.push(Event::Penalty { text: text.clone() });
            self.events.push(Event::Ticker { text: text.clone() });
            self.last_play = text;
            self.clock_running = false;
            return true;
        }
        if let Some(f) = def_flag {
            let def = other(off);
            let abbr = self.teams[def as usize].abbr.clone();
            let yards = match f.foul {
                Foul::PassInterference => (self.x_to_yd(off, f.spot.x) - self.ball_yd).max(1.0),
                _ => 5.0,
            };
            // Offense declines if the play itself was better.
            let gained_first = play_yds >= self.to_go;
            let decline = play_td || (play_yds >= yards && gained_first && !r.turnover);
            if decline {
                self.events.push(Event::Ticker { text: format!("{} on {} {}, declined.", f.foul.label(), abbr, f.player) });
                return false;
            }
            let target = (self.ball_yd + yards).min(99.0);
            let target = if f.foul == Foul::PassInterference { target } else { target.min(self.ball_yd + (100.0 - self.ball_yd) / 2.0) };
            let moved = target - self.ball_yd;
            self.ball_yd = target;
            self.down = 1;
            self.to_go = (100.0 - self.ball_yd).min(10.0);
            self.stats[def as usize].penalties += 1;
            self.stats[def as usize].penalty_yds += moved;
            let text = format!("{}, {} {}. {} yards, automatic first down.", f.foul.label(), abbr, f.player, moved.round());
            self.events.push(Event::Banner { text: format!("FLAG: {}", f.foul.label().to_uppercase()), style: "good".into() });
            self.events.push(Event::Penalty { text: text.clone() });
            self.events.push(Event::Ticker { text: text.clone() });
            self.last_play = text;
            self.clock_running = false;
            return true;
        }
        false
    }

    fn pre_snap_foul(&mut self, foul: Foul) {
        let off = self.possession;
        let (team, text);
        if foul == Foul::FalseStart {
            team = off;
            let y = 5.0f32.min(self.ball_yd / 2.0);
            self.ball_yd -= y;
            self.to_go += y;
            text = format!("False start, {}. {} yards, replay {} down.", self.teams[off as usize].abbr, y.round(), ordinal(self.down));
        } else {
            team = other(off);
            let y = 5.0f32.min((100.0 - self.ball_yd) / 2.0);
            self.ball_yd += y;
            self.to_go -= y;
            if self.to_go <= 0.01 {
                self.down = 1;
                self.to_go = (100.0 - self.ball_yd).min(10.0);
            }
            text = format!("Offside, {}. {} yards.", self.teams[team as usize].abbr, y.round());
        }
        self.stats[team as usize].penalties += 1;
        self.stats[team as usize].penalty_yds += 5.0;
        let x = self.los_x();
        self.events.push(Event::Flag { x, y: self.ball_y });
        self.events.push(Event::Banner { text: format!("FLAG: {}", foul.label().to_uppercase()), style: if team == off { "bad".into() } else { "good".into() } });
        self.events.push(Event::Penalty { text: text.clone() });
        self.events.push(Event::Ticker { text: text.clone() });
        self.last_play = text;
        self.clock_running = false;
        self.after_play();
    }

    fn record_stats(&mut self, off: u8, r: &PlayResult) {
        let yards = (r.spot.x - self.play.los_x) * self.play.dir;
        let st = &mut self.stats[off as usize];
        if r.sack {
            st.sacks += 1;
        } else if self.play.thrown && !r.fumble {
            st.pass_att += 1;
            if r.turnover {
                st.ints += 1;
            } else if r.kind != EndKind::Incomplete {
                st.comp += 1;
                st.pass_yds += yards;
                if let Some(c) = self.play.catch_spot {
                    st.air_yds += (c.x - self.play.los_x) * self.play.dir;
                }
            }
        } else {
            st.rush_att += 1;
            st.rush_yds += yards;
        }
        if yards >= 20.0 && !r.turnover && r.kind != EndKind::Incomplete {
            st.explosive += 1;
        }
    }

    /// Move the chains (or not) after a play that gained `gained` yards.
    fn advance_down(&mut self, gained: f32) {
        self.ball_yd = clamp(self.ball_yd + gained, 0.5, 99.5);
        if gained >= self.to_go - 0.01 {
            self.down = 1;
            self.to_go = (100.0 - self.ball_yd).min(10.0);
            self.events.push(Event::FirstDown);
            self.events.push(Event::Banner { text: "FIRST DOWN".into(), style: "good".into() });
        } else {
            self.down += 1;
            self.to_go -= gained;
            if self.down > 4 {
                self.events.push(Event::TurnoverOnDowns);
                self.events.push(Event::Banner { text: "TURNOVER ON DOWNS".into(), style: "bad".into() });
                let yd = 100.0 - self.ball_yd;
                let y = self.ball_y;
                self.new_possession(other(self.possession), yd);
                self.ball_y = y;
                self.ot_after_change();
            }
        }
    }

    fn after_play(&mut self) {
        if self.phase == Phase::Final {
            return;
        }
        if self.clock <= 0.0 {
            self.end_quarter();
        }
        if self.phase != Phase::Final {
            self.phase = Phase::PlayCall;
            self.auto_t = 0.0;
            self.cpu_to_checked = false;
            self.preview();
        }
    }

    fn end_quarter(&mut self) {
        let q = self.quarter;
        let tied = self.score[0] == self.score[1];
        // A score on the final play of a half still gets its try.
        if matches!(self.situation, Situation::Try { .. } | Situation::TwoPoint { .. }) {
            return;
        }
        self.clock_running = false;
        match q {
            2 => {
                self.quarter = 3;
                self.clock = self.settings.quarter_len;
                self.tmw_done = false;
                self.timeouts = [3, 3];
                self.events.push(Event::Halftime);
                self.events.push(Event::Banner { text: "HALFTIME".into(), style: "info".into() });
                self.kickoff_by(other(self.opening_kicker), 35.0);
            }
            4 if tied && self.settings.overtime => {
                self.quarter = 5;
                self.clock = (self.settings.quarter_len * 2.0 / 3.0).max(60.0);
                self.tmw_done = false;
                self.timeouts = [2, 2];
                let kicker = self.rng.below(2) as u8;
                self.ot = Some(OtState { had_ball: [false, false] });
                self.events.push(Event::Overtime);
                self.events.push(Event::Banner { text: "OVERTIME".into(), style: "info".into() });
                self.kickoff_by(kicker, 35.0);
            }
            4 | 5 => self.finish(),
            _ => {
                self.quarter += 1;
                self.clock = self.settings.quarter_len;
                self.events.push(Event::QuarterEnd { quarter: q });
                self.events.push(Event::Banner { text: format!("END OF Q{}", q), style: "info".into() });
            }
        }
    }

    fn finish(&mut self) {
        self.phase = Phase::Final;
        self.clock = self.clock.max(0.0);
        self.events.push(Event::Final);
        let tie = self.score[0] == self.score[1];
        self.events.push(Event::Banner { text: if tie { "FINAL · TIE".into() } else { "FINAL".into() }, style: "info".into() });
    }

    // ---- Overtime: both teams get a possession, then sudden death ---------------------

    fn ot_after_score(&mut self, scorer: u8) {
        let Some(ot) = self.ot.as_mut() else { return };
        ot.had_ball[scorer as usize] = true;
        let both = ot.had_ball[0] && ot.had_ball[1];
        if both && self.score[0] != self.score[1] {
            self.finish();
        }
    }

    /// A defensive score (pick-six, safety) ends overtime immediately.
    fn ot_defensive_score(&mut self, _scorer: u8) {
        if self.ot.is_some() {
            self.finish();
        }
    }

    fn ot_after_change(&mut self) {
        let Some(ot) = self.ot.as_ref() else { return };
        if ot.had_ball[0] && ot.had_ball[1] && self.score[0] != self.score[1] {
            self.finish();
        }
    }

    // -----------------------------------------------------------------------
    // Clock plays
    // -----------------------------------------------------------------------

    fn kneel(&mut self) {
        let qb = self.teams[self.possession as usize].starter(Pos::QB, 0);
        let name = self.teams[self.possession as usize].players[qb].short_name();
        let text = format!("{} kneels.", name);
        self.events.push(Event::Ticker { text: text.clone() });
        self.last_play = text;
        if self.clock_running {
            self.clock = (self.clock - self.settings.runoff - 25.0).max(0.0);
        } else {
            self.clock = (self.clock - 4.0).max(0.0);
        }
        self.advance_down(-1.0);
        self.clock_running = true;
        self.after_play();
    }

    fn spike(&mut self) {
        let qb = self.teams[self.possession as usize].starter(Pos::QB, 0);
        let name = self.teams[self.possession as usize].players[qb].short_name();
        let text = format!("{} spikes the ball to stop the clock.", name);
        self.events.push(Event::Ticker { text: text.clone() });
        self.events.push(Event::Banner { text: "SPIKE".into(), style: "info".into() });
        self.last_play = text;
        if self.clock_running {
            self.clock = (self.clock - 3.0).max(0.0);
        }
        self.advance_down(0.0);
        self.clock_running = false;
        self.after_play();
    }

    // -----------------------------------------------------------------------
    // CPU decisions
    // -----------------------------------------------------------------------

    fn cpu_timeouts(&mut self) {
        if self.situation != Situation::Scrimmage || !self.clock_running || !self.late_window() {
            return;
        }
        for team in [0u8, 1u8] {
            if Some(team) == self.settings.user_team || self.timeouts[team as usize] == 0 {
                continue;
            }
            let trailing = self.lead(team) < 0 || (self.lead(team) == 0 && self.quarter == 2);
            let on_defense = self.possession != team;
            let late = self.clock < self.tmw_mark() * if self.quarter == 4 { 1.5 } else { 0.9 };
            // Save time when behind: defense stops the clock; offense too in a two-minute drill.
            if trailing && late && (on_defense || self.clock < self.tmw_mark() * 0.5) {
                self.call_timeout(team);
                return;
            }
        }
    }

    fn cpu_kick_style(&mut self, team: u8) -> KickStyle {
        let lead = self.lead(team);
        let late = self.quarter >= 4 && self.clock < self.tmw_mark() * 1.2;
        if late && (-16..=-1).contains(&lead) {
            KickStyle::Onside
        } else if self.clock < 15.0 && lead > 0 && self.rng.chance(0.5) {
            KickStyle::Squib
        } else {
            KickStyle::Deep
        }
    }

    fn cpu_go_for_two(&mut self, team: u8) -> bool {
        if self.quarter < 4 {
            return false;
        }
        // The try's value given the score after the touchdown.
        matches!(self.lead(team), -2 | -5 | -10 | 1 | 5 | 12)
    }

    fn cpu_offense(&mut self) -> usize {
        let find = offense_index;
        let lead = self.lead(self.possession);
        let late = self.late_window();
        let two_pt = matches!(self.situation, Situation::TwoPoint { .. });

        // Victory formation.
        if !two_pt && self.quarter >= 4 && lead > 0 && self.clock_running {
            let downs_left = 4u8.saturating_sub(self.down) as f32 + 1.0;
            if self.clock <= downs_left * (self.settings.runoff + 25.0) && self.timeouts[other(self.possession) as usize] == 0 {
                return find("QB Kneel");
            }
        }
        // Two-minute drill: spike to stop a running clock with no timeouts.
        if !two_pt && late && lead <= 0 && self.clock_running && self.clock < 25.0 && self.timeouts[self.possession as usize] == 0 && self.down < 4 {
            return find("Spike Ball");
        }
        if self.down == 4 && !two_pt {
            let (kp, _) = self.kicker_rating(self.possession);
            let fg_dist = 100.0 - self.ball_yd + 17.0;
            let range = 50.0 + (kp - 75.0) * 0.25;
            let desperate = self.quarter >= 4 && lead < 0 && (late || lead < -8);
            let go_short = self.to_go <= 1.5 && self.ball_yd > 45.0 && self.rng.chance(0.4);
            if !desperate && fg_dist <= range && !(go_short && fg_dist > 40.0) {
                return find("Field Goal");
            }
            if !desperate && !go_short && (self.ball_yd < 60.0 || self.to_go > 3.0) {
                return find("Punt");
            }
        }
        let short = self.to_go <= 1.5;
        let goal_line = self.ball_yd >= 95.0;
        let mut pass_p = if self.to_go >= 7.0 {
            0.8
        } else if short {
            0.25
        } else {
            0.52
        };
        if late && lead <= 0 {
            pass_p = 0.85;
        }
        if self.quarter >= 4 && lead > 0 && late {
            pass_p = 0.2;
        }
        let pass = self.rng.chance(pass_p);
        let pool: Vec<usize> = OFFENSE
            .iter()
            .enumerate()
            .filter(|(_, p)| match p.kind {
                PlayKind::Run { carrier, .. } => {
                    !pass && (carrier != crate::playbook::OSlot::QB || self.to_go <= 1.0)
                        && (!goal_line || p.formation.name.starts_with("I-Form"))
                        && (!short || matches!(p.formation.personnel, "21" | "12") || self.rng.f32() < 0.3)
                }
                PlayKind::Pass { screen, .. } => pass && (!goal_line || p.name.contains("Fade") || p.name.contains("Slant") || p.name.contains("Stick")) && (!screen || self.to_go < 12.0),
                _ => false,
            })
            .map(|(i, _)| i)
            .collect();
        if pool.is_empty() {
            return find(if pass { "Slant Flat" } else { "Inside Zone" });
        }
        *self.rng.pick(&pool)
    }

    fn cpu_defense(&mut self, off: usize) -> usize {
        let personnel = OFFENSE[off].formation.personnel;
        let lead_def = -self.lead(self.possession);
        let late = self.late_window();
        let group = if self.ball_yd >= 96.0 && matches!(personnel, "21" | "12") {
            "Goal Line"
        } else if late && lead_def > 8 && self.ball_yd < 60.0 {
            return defense_index("Prevent");
        } else if self.to_go >= 9.0 && self.down >= 3 {
            "Dime"
        } else if matches!(personnel, "21" | "12") {
            "4-3 Base"
        } else {
            "Nickel"
        };
        let pool: Vec<usize> = DEFENSE
            .iter()
            .enumerate()
            .filter(|(_, d)| d.personnel == group && d.name != "Prevent")
            .map(|(i, _)| i)
            .collect();
        if pool.is_empty() {
            return 0;
        }
        // Lean blitz on 3rd and medium, coverage on long yardage.
        let blitzy = self.down == 3 && (3.0..8.0).contains(&self.to_go);
        let mut best = *self.rng.pick(&pool);
        if blitzy && !DEFENSE[best].blitz && self.rng.chance(0.4) {
            if let Some(&b) = pool.iter().find(|&&i| DEFENSE[i].blitz) {
                best = b;
            }
        }
        best
    }

    // -----------------------------------------------------------------------
    // Output
    // -----------------------------------------------------------------------

    pub fn hud(&self) -> Hud {
        let to_go = if self.ball_yd + self.to_go >= 100.0 - 0.01 {
            "Goal".to_string()
        } else {
            format!("{}", (self.to_go.round() as i32).max(1))
        };
        let spot = {
            let (team, yd) = match self.situation {
                Situation::Kickoff { team, from_yd } => (team, from_yd),
                _ => (self.possession, self.ball_yd),
            };
            let yd = yd.round() as i32;
            let own = &self.teams[team as usize].abbr;
            let opp = &self.teams[other(team) as usize].abbr;
            if yd == 50 {
                "50".to_string()
            } else if yd < 50 {
                format!("{} {}", own, yd)
            } else {
                format!("{} {}", opp, 100 - yd)
            }
        };
        let special = match self.play.special.as_ref().map(|s| s.kind) {
            Some(StKind::Kickoff(_)) => "kickoff",
            Some(StKind::Punt) => "punt",
            Some(StKind::FieldGoal { pat: true }) => "pat",
            Some(StKind::FieldGoal { pat: false }) => "fg",
            None => "",
        };
        let user_kicking = self.phase == Phase::InPlay
            && self.play.phase == PlayPhase::PreSnap
            && self.play.special.as_ref().map(|s| Some(s.kick_team) == self.settings.user_team).unwrap_or(false);
        let kneel_window = self
            .play
            .special
            .as_ref()
            .map(|s| s.in_ez_catch && self.play.carrier.is_some() && self.play.carrier == self.play.user && self.play.t - s.caught_t < 1.2)
            .unwrap_or(false)
            && self.play.phase == PlayPhase::Live;
        Hud {
            phase: match self.phase {
                Phase::PlayCall => "playcall",
                Phase::InPlay => "inplay",
                Phase::Final => "final",
            },
            play_phase: match self.play.phase {
                PlayPhase::PreSnap => "presnap",
                PlayPhase::Live => "live",
                PlayPhase::Over => "over",
            },
            user_side: match self.settings.user_team {
                None => "none",
                Some(u) => {
                    let off_team = if self.play.special.is_some() { self.play.off_team } else { self.possession };
                    if u == off_team {
                        "offense"
                    } else {
                        "defense"
                    }
                }
            },
            situation: match self.situation {
                Situation::Scrimmage => "scrimmage",
                Situation::Kickoff { .. } => "kickoff",
                Situation::Try { .. } => "try",
                Situation::TwoPoint { .. } => "two_point",
            },
            special,
            user_kicking,
            user_choosing: self.user_must_choose(),
            abbr: [self.teams[0].abbr.clone(), self.teams[1].abbr.clone()],
            score: self.score,
            quarter: self.quarter,
            quarter_label: if self.quarter >= 5 { "OT".into() } else { format!("Q{}", self.quarter) },
            clock: self.clock,
            clock_running: self.clock_running,
            timeouts: self.timeouts,
            down: self.down,
            to_go,
            spot,
            possession: self.possession,
            los_x: self.los_x(),
            first_down_x: self.first_down_x(),
            ball_y: self.ball_y,
            dir: if self.play.special.is_some() { self.play.dir } else { self.team_dir(self.possession) },
            lineup: self.lineup,
            off_play: OFFENSE[self.play.off_play.min(OFFENSE.len() - 1)].name.to_string(),
            def_play: DEFENSE[self.play.def_play.min(DEFENSE.len() - 1)].name.to_string(),
            last_play: self.last_play.clone(),
            user_def_slot: self.user_def_slot,
            kneel_window,
        }
    }

    pub fn lineup_info(&self) -> Vec<LineupEntry> {
        self.play
            .actors
            .iter()
            .map(|a| LineupEntry { team: a.team, number: a.number, pos: a.pos.label(), name: a.name.clone(), skin: a.skin, build: a.pos.build() })
            .collect()
    }

    pub fn snapshot(&self, out: &mut Vec<f32>) {
        self.play.snapshot(out);
    }

    /// Ragdoll bodies for the renderer (see `physics::RAGDOLL_STRIDE`).
    pub fn ragdolls(&self, out: &mut Vec<f32>) {
        self.play.ragdoll_buffer(out);
    }

    pub fn drain_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }
}

fn ordinal(n: u8) -> &'static str {
    match n {
        1 => "1st",
        2 => "2nd",
        3 => "3rd",
        _ => "4th",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cpu_game(seed: u64, penalties: f32) -> Game {
        let s = Settings { quarter_len: 300.0, runoff: 15.0, user_team: None, difficulty: 1, penalties, overtime: true };
        Game::new(seed, s, ["SAR", "HOU"], [2.0, 0.0])
    }

    #[test]
    fn cpu_vs_cpu_game_finishes() {
        for seed in 1..=6 {
            let mut g = cpu_game(seed, 1.0);
            let input = Input::default();
            let mut steps = 0u64;
            let mut snap = Vec::new();
            let (mut tk, mut bt, mut flags, mut kicks) = (0, 0, 0, 0);
            while g.phase != Phase::Final && steps < 3_000_000 {
                g.step(1.0 / 60.0, &input);
                if steps % 30 == 0 {
                    g.snapshot(&mut snap);
                    assert!(snap.iter().all(|v| v.is_finite()), "non-finite snapshot");
                }
                for e in g.drain_events() {
                    match e {
                        Event::Tackle { .. } => tk += 1,
                        Event::BrokenTackle => bt += 1,
                        Event::Penalty { .. } => flags += 1,
                        Event::Kick => kicks += 1,
                        _ => {}
                    }
                }
                steps += 1;
            }
            assert_eq!(g.phase, Phase::Final, "seed {seed}: game did not finish");
            assert!(g.plays_run > 50, "seed {seed}: only {} plays", g.plays_run);
            let total = g.score[0] + g.score[1];
            assert!(total < 120, "seed {seed}: silly score {:?}", g.score);
            println!(
                "seed {seed}: {} - {} (q{}) in {} plays | tackles {} broken {} | penalties {} | kicks {}",
                g.score[0], g.score[1], g.quarter, g.plays_run, tk, bt, flags, kicks
            );
            for st in &g.stats {
                println!(
                    "   rush {}/{:.0} ({:.1}) | pass {}/{} {:.0} ({:.1} ypa) int {} sk {} | FG {}/{} | punts {} avg {:.0} | KR {} avg {:.0} | pen {} | fum {}",
                    st.rush_att, st.rush_yds, st.rush_yds / st.rush_att.max(1) as f32,
                    st.comp, st.pass_att, st.pass_yds, st.pass_yds / st.pass_att.max(1) as f32,
                    st.ints, st.sacks, st.fg_made, st.fg_att, st.punts, st.punt_yds / st.punts.max(1) as f32,
                    st.kr, st.kr_yds / st.kr.max(1) as f32, st.penalties, st.fumbles_lost
                );
            }
        }
    }

    #[test]
    fn first_down_and_turnover_on_downs() {
        let mut g = cpu_game(9, 0.0);
        g.situation = Situation::Scrimmage;
        g.possession = 0;
        g.ball_yd = 30.0;
        g.down = 1;
        g.to_go = 10.0;
        g.advance_down(4.0);
        assert_eq!((g.down, g.to_go.round() as i32), (2, 6));
        g.advance_down(7.0);
        assert_eq!((g.down, g.to_go.round() as i32), (1, 10));
        assert_eq!(g.ball_yd.round() as i32, 41);
        g.down = 4;
        g.to_go = 3.0;
        g.advance_down(1.0);
        assert_eq!(g.possession, 1);
        assert_eq!(g.ball_yd.round() as i32, 58);
    }

    #[test]
    fn field_direction_flips_each_quarter() {
        let mut g = cpu_game(3, 0.0);
        g.situation = Situation::Scrimmage;
        g.possession = 0;
        g.ball_yd = 20.0;
        g.quarter = 1;
        assert_eq!(g.los_x(), 30.0);
        g.quarter = 2;
        assert_eq!(g.los_x(), 90.0);
    }

    #[test]
    fn timeouts_and_two_minute_warning() {
        let mut g = cpu_game(4, 0.0);
        g.situation = Situation::Scrimmage;
        g.settings.user_team = Some(0);
        g.phase = Phase::PlayCall;
        g.clock_running = true;
        assert!(g.call_timeout(0));
        assert_eq!(g.timeouts[0], 2);
        assert!(!g.clock_running);
        g.quarter = 2;
        g.clock = 130.0;
        g.clock_running = true;
        g.apply_runoff();
        assert_eq!(g.clock, 120.0, "runoff should stop at the two-minute warning");
        assert!(!g.clock_running);
    }

    #[test]
    fn overtime_happens_when_tied() {
        let mut g = cpu_game(5, 0.0);
        g.situation = Situation::Scrimmage;
        g.quarter = 4;
        g.clock = 0.0;
        g.score = [10, 10];
        g.end_quarter();
        assert_eq!(g.quarter, 5);
        assert!(matches!(g.situation, Situation::Kickoff { .. }));
        assert_ne!(g.phase, Phase::Final);
        // A field goal on the first possession doesn't end it...
        g.possession = 0;
        g.ot.as_mut().unwrap().had_ball = [false, false];
        g.score = [13, 10];
        g.ot_after_score(0);
        assert_ne!(g.phase, Phase::Final);
        // ...but after both teams have had the ball, a lead wins it.
        g.ot.as_mut().unwrap().had_ball = [true, false];
        g.possession = 1;
        g.new_possession(0, 30.0);
        g.ot_after_change();
        assert_eq!(g.phase, Phase::Final);
    }
}
