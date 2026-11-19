//! A full game: downs, clock, quarters, scoring, play calling and special teams.

use crate::events::Event;
use crate::math::clamp;
use crate::player::{gen_team, Pos, Team};
use crate::playbook::{PlayKind, DEFENSE, OFFENSE};
use crate::rng::Rng;
use crate::sim::{EndKind, Input, Play, PlayPhase, PlayResult, PlaySetup, FIELD_W, HASH_HI, HASH_LO};
use serde::Serialize;

#[derive(Clone, Debug)]
pub struct Settings {
    /// Seconds per quarter.
    pub quarter_len: f32,
    /// Seconds run off the clock between plays when it is running (accelerated clock).
    pub runoff: f32,
    /// Which team the human controls (`None` = CPU vs CPU).
    pub user_team: Option<u8>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { quarter_len: 300.0, runoff: 15.0, user_team: Some(0) }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Waiting for a play call.
    PlayCall,
    /// A play is lined up or running.
    InPlay,
    Final,
}

#[derive(Serialize)]
pub struct Hud {
    pub phase: &'static str,
    pub play_phase: &'static str,
    pub user_side: &'static str,
    pub abbr: [String; 2],
    pub score: [u16; 2],
    pub quarter: u8,
    pub clock: f32,
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
}

#[derive(Serialize)]
pub struct MenuItem {
    pub idx: usize,
    pub name: &'static str,
    pub cat: &'static str,
    pub formation: &'static str,
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

pub struct Game {
    pub settings: Settings,
    pub rng: Rng,
    pub teams: [Team; 2],
    pub score: [u16; 2],
    pub quarter: u8,
    pub clock: f32,
    pub clock_running: bool,
    pub possession: u8,
    /// Ball position in yards from the offense's own goal line (0–100).
    pub ball_yd: f32,
    pub ball_y: f32,
    pub down: u8,
    pub to_go: f32,
    pub opening_receiver: u8,
    pub phase: Phase,
    pub play: Play,
    pub lineup: u32,
    pub events: Vec<Event>,
    pub last_play: String,
    pub user_def_slot: usize,
    pub plays_run: u32,
    pub stats: [TeamStats; 2],
}

impl Game {
    pub fn new(seed: u64, settings: Settings, abbr: [&str; 2], strength: [f32; 2]) -> Game {
        let mut rng = Rng::new(seed);
        let teams = [gen_team(&mut rng, abbr[0], strength[0], 1000), gen_team(&mut rng, abbr[1], strength[1], 2000)];
        let opening_receiver = rng.below(2) as u8;
        let mut g = Game {
            settings,
            rng,
            teams,
            score: [0, 0],
            quarter: 1,
            clock: 0.0,
            clock_running: false,
            possession: opening_receiver,
            ball_yd: 25.0,
            ball_y: FIELD_W * 0.5,
            down: 1,
            to_go: 10.0,
            opening_receiver,
            phase: Phase::PlayCall,
            play: Play::placeholder(),
            lineup: 0,
            events: Vec::new(),
            last_play: String::new(),
            user_def_slot: 5,
            plays_run: 0,
            stats: [TeamStats::default(), TeamStats::default()],
        };
        g.clock = g.settings.quarter_len;
        g.play = g.build_play(0, 0, 999.0);
        let recv = g.teams[opening_receiver as usize].abbr.clone();
        g.events.push(Event::Banner { text: format!("{} RECEIVES", recv), style: "info".into() });
        g
    }

    // -----------------------------------------------------------------------
    // Geometry
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
        self.yd_to_x(self.possession, self.ball_yd)
    }

    pub fn first_down_x(&self) -> f32 {
        self.yd_to_x(self.possession, (self.ball_yd + self.to_go).min(100.0))
    }

    pub fn user_on_offense(&self) -> Option<bool> {
        self.settings.user_team.map(|u| u == self.possession)
    }

    // -----------------------------------------------------------------------
    // Play calling
    // -----------------------------------------------------------------------

    pub fn menu(&self) -> Vec<MenuItem> {
        match self.user_on_offense() {
            Some(true) => OFFENSE
                .iter()
                .enumerate()
                .map(|(i, p)| MenuItem { idx: i, name: p.name, cat: p.category(), formation: p.formation.name })
                .collect(),
            Some(false) => DEFENSE
                .iter()
                .enumerate()
                .map(|(i, p)| MenuItem { idx: i, name: p.name, cat: if p.blitz { "BLITZ" } else { "COVERAGE" }, formation: "Nickel" })
                .collect(),
            None => Vec::new(),
        }
    }

    /// The human picks a play (offense or defense, whichever side they're on).
    pub fn call_play(&mut self, idx: usize) {
        if self.phase != Phase::PlayCall {
            return;
        }
        let (off, def) = match self.user_on_offense() {
            Some(true) => (idx.min(OFFENSE.len() - 1), self.cpu_defense()),
            Some(false) => (self.cpu_offense(), idx.min(DEFENSE.len() - 1)),
            None => (self.cpu_offense(), self.cpu_defense()),
        };
        self.start_play(off, def);
    }

    pub fn set_user_def_slot(&mut self, slot: usize) {
        self.user_def_slot = slot.min(10);
    }

    fn start_play(&mut self, off: usize, def: usize) {
        match OFFENSE[off].kind {
            PlayKind::Punt => return self.punt(),
            PlayKind::FieldGoal => return self.field_goal(),
            PlayKind::Kneel => return self.kneel(),
            _ => {}
        }
        let snap_delay = 1.2 + self.rng.f32() * 1.2;
        self.play = self.build_play(off, def, snap_delay);
        self.phase = Phase::InPlay;
        self.plays_run += 1;
    }

    fn build_play(&mut self, off: usize, def: usize, snap_delay: f32) -> Play {
        self.lineup += 1;
        let setup = PlaySetup {
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
        };
        let mut rng = self.rng.clone();
        let p = Play::new(setup, &mut rng);
        self.rng = rng;
        p
    }

    fn cpu_offense(&mut self) -> usize {
        let find = |name: &str| OFFENSE.iter().position(|p| p.name == name).unwrap_or(0);
        if self.down == 4 {
            let fg_dist = 100.0 - self.ball_yd + 17.0;
            if fg_dist <= 53.0 && !(self.to_go <= 1.5 && self.ball_yd > 60.0 && fg_dist > 35.0) {
                return find("Field Goal");
            }
            if self.ball_yd < 55.0 || self.to_go > 3.0 {
                return find("Punt");
            }
        }
        let pass_p = if self.to_go >= 7.0 {
            0.78
        } else if self.to_go <= 2.0 {
            0.3
        } else {
            0.52
        };
        let runs: Vec<usize> = OFFENSE.iter().enumerate().filter(|(_, p)| matches!(p.kind, PlayKind::Run { .. })).map(|(i, _)| i).collect();
        let passes: Vec<usize> = OFFENSE.iter().enumerate().filter(|(_, p)| matches!(p.kind, PlayKind::Pass { .. })).map(|(i, _)| i).collect();
        if self.rng.chance(pass_p) {
            *self.rng.pick(&passes)
        } else {
            *self.rng.pick(&runs)
        }
    }

    fn cpu_defense(&mut self) -> usize {
        let weights: [f32; 5] = if self.to_go >= 8.0 {
            [0.35, 0.35, 0.2, 0.05, 0.05]
        } else if self.to_go <= 2.0 {
            [0.1, 0.1, 0.25, 0.2, 0.35]
        } else {
            [0.25, 0.25, 0.25, 0.1, 0.15]
        };
        let total: f32 = weights.iter().sum();
        let mut roll = self.rng.f32() * total;
        for (i, w) in weights.iter().enumerate() {
            if roll < *w {
                return i.min(DEFENSE.len() - 1);
            }
            roll -= w;
        }
        0
    }

    // -----------------------------------------------------------------------
    // Step
    // -----------------------------------------------------------------------

    pub fn step(&mut self, dt: f32, input: &Input) {
        match self.phase {
            Phase::Final => {}
            Phase::PlayCall => {
                if self.settings.user_team.is_none() {
                    self.call_play(0);
                }
            }
            Phase::InPlay => {
                let mut rng = self.rng.clone();
                self.play.step(dt, input, &mut rng);
                self.rng = rng;
                if self.play.phase == PlayPhase::Live {
                    self.clock = (self.clock - dt).max(0.0);
                }
                if self.play.phase == PlayPhase::PreSnap {
                    if let Some(u) = self.play.user {
                        if u >= 11 {
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

    fn other(t: u8) -> u8 {
        1 - t
    }

    fn new_possession(&mut self, team: u8, yd: f32) {
        self.possession = team;
        self.ball_yd = clamp(yd, 1.0, 99.0);
        self.down = 1;
        self.to_go = (100.0 - self.ball_yd).min(10.0);
        self.ball_y = FIELD_W * 0.5;
        self.clock_running = false;
    }

    fn kicker_rating(&self, team: u8, pos: Pos) -> (f32, f32) {
        let t = &self.teams[team as usize];
        let i = t.starter(pos, 0);
        let r = t.players[i].ratings;
        (r.kick_power as f32, r.kick_acc as f32)
    }

    fn score_td(&mut self, team: u8) {
        self.score[team as usize] += 6;
        let abbr = self.teams[team as usize].abbr.clone();
        self.events.push(Event::Banner { text: "TOUCHDOWN!".into(), style: "good".into() });
        let (_, acc) = self.kicker_rating(team, Pos::K);
        let good = self.rng.chance(0.88 + acc * 0.001);
        if good {
            self.score[team as usize] += 1;
        }
        self.events.push(Event::ExtraPoint { good });
        self.events.push(Event::Ticker {
            text: format!("{} extra point is {}.", abbr, if good { "GOOD" } else { "NO GOOD" }),
        });
        self.new_possession(Self::other(team), 25.0);
    }

    fn resolve(&mut self, r: PlayResult) {
        let off = self.possession;
        self.last_play = r.text.clone();
        self.events.push(Event::Ticker { text: r.text.clone() });
        let mut stop_clock = true;
        self.record_stats(off, &r);

        match r.kind {
            EndKind::Touchdown => self.score_td(r.carrier_team),
            EndKind::Safety => {
                let scorer = Self::other(r.carrier_team);
                self.score[scorer as usize] += 2;
                self.events.push(Event::Banner { text: "SAFETY!".into(), style: "bad".into() });
                self.new_possession(scorer, 35.0);
            }
            EndKind::Touchback => {
                self.events.push(Event::Banner { text: "TOUCHBACK".into(), style: "info".into() });
                self.new_possession(r.carrier_team, 20.0);
            }
            EndKind::Incomplete => {
                self.events.push(Event::Banner { text: "INCOMPLETE".into(), style: "info".into() });
                self.advance_down(0.0);
            }
            EndKind::Down | EndKind::OutOfBounds => {
                if r.turnover {
                    let yd = self.x_to_yd(r.carrier_team, r.spot.x);
                    self.events.push(Event::Banner { text: "INTERCEPTED!".into(), style: "bad".into() });
                    self.new_possession(r.carrier_team, if yd <= 0.0 { 20.0 } else { yd });
                    self.ball_y = clamp(r.spot.y, HASH_LO, HASH_HI);
                } else {
                    let new_yd = self.x_to_yd(off, r.spot.x);
                    let gained = new_yd - self.ball_yd;
                    self.ball_y = clamp(r.spot.y, HASH_LO, HASH_HI);
                    if r.sack {
                        self.events.push(Event::Banner { text: "SACKED!".into(), style: "bad".into() });
                    }
                    self.advance_down(gained);
                    stop_clock = r.kind == EndKind::OutOfBounds;
                }
            }
        }
        self.clock_running = !stop_clock && self.possession == off;
        self.after_play();
    }

    fn record_stats(&mut self, off: u8, r: &PlayResult) {
        let yards = (r.spot.x - self.play.los_x) * self.play.dir;
        let st = &mut self.stats[off as usize];
        if r.sack {
            st.sacks += 1;
        } else if self.play.thrown {
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
        if r.kind == EndKind::Touchdown && !r.turnover {
            st.tds += 1;
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
                self.new_possession(Self::other(self.possession), yd);
                self.ball_y = y;
            }
        }
    }

    fn after_play(&mut self) {
        if self.clock_running && self.clock > 0.0 {
            self.clock = (self.clock - self.settings.runoff).max(0.0);
        }
        if self.clock <= 0.0 {
            self.end_quarter();
        }
        if self.phase != Phase::Final {
            self.phase = Phase::PlayCall;
            // Line both teams up at the new spot while the next play is called.
            self.play = self.build_play(4, 0, 999.0);
        }
    }

    fn end_quarter(&mut self) {
        let q = self.quarter;
        self.quarter += 1;
        self.clock = self.settings.quarter_len;
        self.clock_running = false;
        match q {
            2 => {
                self.events.push(Event::Halftime);
                self.events.push(Event::Banner { text: "HALFTIME".into(), style: "info".into() });
                self.new_possession(Self::other(self.opening_receiver), 25.0);
            }
            4 => {
                self.phase = Phase::Final;
                self.clock = 0.0;
                self.quarter = 4;
                self.events.push(Event::Final);
                self.events.push(Event::Banner { text: "FINAL".into(), style: "info".into() });
            }
            _ => {
                self.events.push(Event::QuarterEnd { quarter: q });
                self.events.push(Event::Banner { text: format!("END OF Q{}", q), style: "info".into() });
            }
        }
    }

    // -----------------------------------------------------------------------
    // Special teams (auto-resolved until milestone 1)
    // -----------------------------------------------------------------------

    fn punt(&mut self) {
        let team = self.possession;
        let (pow, acc) = self.kicker_rating(team, Pos::P);
        let gross = (36.0 + pow * 0.13 + self.rng.normal() * 5.0 * (1.2 - acc / 120.0)).round();
        let ret = (self.rng.f32() * 9.0 + self.rng.normal() * 2.0).max(0.0).round();
        let land = self.ball_yd + gross;
        let abbr = self.teams[team as usize].abbr.clone();
        let recv = Self::other(team);
        let text;
        if land >= 100.0 {
            text = format!("{} punts {} yards into the end zone. Touchback.", abbr, gross);
            self.new_possession(recv, 20.0);
        } else {
            let net = (gross - ret).max(5.0);
            text = format!("{} punts {} yards, returned {} yards.", abbr, gross, ret);
            self.new_possession(recv, 100.0 - (self.ball_yd + net));
        }
        self.events.push(Event::Punt { yards: gross as i32 });
        self.events.push(Event::Banner { text: "PUNT".into(), style: "info".into() });
        self.events.push(Event::Ticker { text: text.clone() });
        self.last_play = text;
        self.clock = (self.clock - 8.0).max(0.0);
        self.after_play();
    }

    fn field_goal(&mut self) {
        let team = self.possession;
        let dist = (100.0 - self.ball_yd + 17.0).round();
        let (pow, acc) = self.kicker_rating(team, Pos::K);
        let max_range = 50.0 + pow * 0.12;
        let mut p = 1.13 - (dist - 20.0).max(0.0) * 0.012 - (99.0 - acc) * 0.004;
        if dist > max_range {
            p *= 0.15;
        }
        let good = self.rng.chance(clamp(p, 0.01, 0.99));
        let abbr = self.teams[team as usize].abbr.clone();
        let text = format!("{} {}-yard field goal is {}.", abbr, dist, if good { "GOOD" } else { "NO GOOD" });
        self.events.push(Event::FieldGoal { good, dist: dist as i32 });
        self.events.push(Event::Banner { text: if good { "FIELD GOAL IS GOOD".into() } else { "NO GOOD".into() }, style: if good { "good".into() } else { "bad".into() } });
        self.events.push(Event::Ticker { text: text.clone() });
        self.last_play = text;
        let recv = Self::other(team);
        if good {
            self.score[team as usize] += 3;
            self.new_possession(recv, 25.0);
        } else {
            let spot = 100.0 - (self.ball_yd - 7.0);
            self.new_possession(recv, spot.max(20.0));
        }
        self.clock = (self.clock - 5.0).max(0.0);
        self.after_play();
    }

    fn kneel(&mut self) {
        let qb = self.teams[self.possession as usize].starter(Pos::QB, 0);
        let name = self.teams[self.possession as usize].players[qb].short_name();
        let text = format!("{} kneels.", name);
        self.events.push(Event::Ticker { text: text.clone() });
        self.last_play = text;
        self.advance_down(-1.0);
        self.clock_running = true;
        self.clock = (self.clock - self.settings.runoff).max(0.0);
        self.after_play();
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
            let yd = self.ball_yd.round() as i32;
            let abbr_own = &self.teams[self.possession as usize].abbr;
            let abbr_opp = &self.teams[Self::other(self.possession) as usize].abbr;
            if yd == 50 {
                "50".to_string()
            } else if yd < 50 {
                format!("{} {}", abbr_own, yd)
            } else {
                format!("{} {}", abbr_opp, 100 - yd)
            }
        };
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
            user_side: match self.user_on_offense() {
                Some(true) => "offense",
                Some(false) => "defense",
                None => "none",
            },
            abbr: [self.teams[0].abbr.clone(), self.teams[1].abbr.clone()],
            score: self.score,
            quarter: self.quarter,
            clock: self.clock,
            down: self.down,
            to_go,
            spot,
            possession: self.possession,
            los_x: self.los_x(),
            first_down_x: self.first_down_x(),
            ball_y: self.ball_y,
            dir: self.team_dir(self.possession),
            lineup: self.lineup,
            off_play: OFFENSE[self.play.off_play].name.to_string(),
            def_play: DEFENSE[self.play.def_play].name.to_string(),
            last_play: self.last_play.clone(),
            user_def_slot: self.user_def_slot,
        }
    }

    pub fn lineup_info(&self) -> Vec<LineupEntry> {
        self.play
            .actors
            .iter()
            .map(|a| LineupEntry {
                team: a.team,
                number: a.number,
                pos: a.pos.label(),
                name: a.name.clone(),
                skin: a.skin,
                build: a.pos.build(),
            })
            .collect()
    }

    pub fn snapshot(&self, out: &mut Vec<f32>) {
        self.play.snapshot(out);
    }

    pub fn drain_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }
}

impl Play {
    /// An empty play used only while the first real one is built.
    pub fn placeholder() -> Play {
        Play {
            actors: Vec::new(),
            ball: crate::sim::Ball::Loose(crate::math::V3::default()),
            off_team: 0,
            dir: 1.0,
            los_x: 35.0,
            ball_y: FIELD_W * 0.5,
            first_down_x: 45.0,
            kind: PlayKind::Kneel,
            off_play: 0,
            def_play: 0,
            phase: PlayPhase::PreSnap,
            t: 0.0,
            over_t: 0.0,
            snap_delay: 0.0,
            user_team: None,
            user: None,
            user_touched: false,
            handoff: false,
            thrown: false,
            scramble: false,
            carrier: None,
            poss_team: 0,
            drop_time: 0.0,
            route_actors: Vec::new(),
            int_in_endzone: false,
            thrower_name: String::new(),
            target_name: String::new(),
            last_tackler: None,
            result: None,
            events: Vec::new(),
            idle_t: 0.0,
            catch_spot: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cpu_game(seed: u64) -> Game {
        let s = Settings { quarter_len: 300.0, runoff: 15.0, user_team: None };
        Game::new(seed, s, ["SAR", "HOU"], [2.0, 0.0])
    }

    #[test]
    fn cpu_vs_cpu_game_finishes() {
        for seed in 1..=4 {
            let mut g = cpu_game(seed);
            let input = Input::default();
            let mut steps = 0u64;
            let mut snap = Vec::new();
            let (mut tk, mut bt) = (0, 0);
            while g.phase != Phase::Final && steps < 2_000_000 {
                g.step(1.0 / 60.0, &input);
                if steps % 30 == 0 {
                    g.snapshot(&mut snap);
                    assert!(snap.iter().all(|v| v.is_finite()), "non-finite snapshot");
                }
                for e in g.drain_events() {
                    match e {
                        Event::Tackle { .. } => tk += 1,
                        Event::BrokenTackle => bt += 1,
                        _ => {}
                    }
                }
                steps += 1;
            }
            assert_eq!(g.phase, Phase::Final, "seed {seed}: game did not finish");
            assert!(g.plays_run > 40, "seed {seed}: only {} plays", g.plays_run);
            let total = g.score[0] + g.score[1];
            assert!(total < 150, "seed {seed}: silly score {:?}", g.score);
            println!("seed {seed}: {} - {} in {} plays | tackles {} broken {}", g.score[0], g.score[1], g.plays_run, tk, bt);
            for st in &g.stats {
                println!(
                    "   rush {}/{:.0} ({:.1} ypc) | pass {}/{} {:.0} yds ({:.1} ypa, air {:.0}) int {} sack {} | TD {} | 20+ {}",
                    st.rush_att, st.rush_yds, st.rush_yds / st.rush_att.max(1) as f32,
                    st.comp, st.pass_att, st.pass_yds, st.pass_yds / st.pass_att.max(1) as f32, st.air_yds,
                    st.ints, st.sacks, st.tds, st.explosive
                );
            }
        }
    }

    #[test]
    fn first_down_and_turnover_on_downs() {
        let mut g = cpu_game(9);
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
        let mut g = cpu_game(3);
        g.possession = 0;
        g.ball_yd = 20.0;
        g.quarter = 1;
        assert_eq!(g.los_x(), 30.0);
        g.quarter = 2;
        assert_eq!(g.los_x(), 90.0);
    }
}
