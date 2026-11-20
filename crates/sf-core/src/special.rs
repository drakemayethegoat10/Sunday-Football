//! Special teams played on the field: kickoffs (deep, squib, onside), punts and field
//! goals / extra points, with real ball flight, returns, fair catches, touchbacks,
//! muffs, onside recoveries and blocked kicks.

use crate::events::Event;
use crate::math::*;
use crate::player::{Pos, Team};
use crate::playbook::PlayKind;
use crate::rng::Rng;
use crate::sim::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KickStyle {
    Deep,
    Squib,
    Onside,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StKind {
    Kickoff(KickStyle),
    Punt,
    FieldGoal { pat: bool },
}

#[derive(Clone, Debug)]
pub struct SpecialPlay {
    pub kind: StKind,
    pub kick_team: u8,
    pub kick_spot: V2,
    pub kicked: bool,
    /// Play time (since the snap / approach) at which the ball is kicked.
    pub kick_at: f32,
    pub snapped: bool,
    pub params: KickParams,
    /// The receiving team has touched the ball (anyone may recover it now).
    pub touched: bool,
    pub landed: bool,
    pub fg_result: Option<bool>,
    pub kick_oob: bool,
    pub returner: usize,
    pub land: V2,
    pub caught_t: f32,
    pub in_ez_catch: bool,
    pub recover_cd: f32,
    pub end_t: Option<f32>,
    pub stopped_t: f32,
    pub vel: V3,
    pub catch_spot: Option<V2>,
}

impl SpecialPlay {
    fn new(kind: StKind, kick_team: u8, kick_spot: V2) -> Self {
        SpecialPlay {
            kind,
            kick_team,
            kick_spot,
            kicked: false,
            kick_at: 0.9,
            snapped: false,
            params: KickParams::default(),
            touched: false,
            landed: false,
            fg_result: None,
            kick_oob: false,
            returner: 0,
            land: kick_spot,
            caught_t: 0.0,
            in_ez_catch: false,
            recover_cd: 0.0,
            end_t: None,
            stopped_t: 0.0,
            vel: V3::default(),
            catch_spot: None,
        }
    }
}

pub struct SpecialSetup<'a> {
    pub kind: StKind,
    pub kick_team: u8,
    /// Direction the kicking team attacks (+1 toward x = 120).
    pub dir: f32,
    /// Kick spot / line of scrimmage (x).
    pub los_x: f32,
    pub ball_y: f32,
    pub teams: &'a [Team; 2],
    pub user_team: Option<u8>,
    pub snap_delay: f32,
}

/// Where the receiving team's goal line is, as x.
/// Crossbar height and half the distance between the uprights, in yards.
pub const CROSSBAR_Z: f32 = 3.33;
pub const UPRIGHT_HALF: f32 = 3.08;

fn goal_x(recv_dir: f32) -> f32 {
    if recv_dir > 0.0 {
        110.0
    } else {
        10.0
    }
}

fn own_goal_x(team_dir: f32) -> f32 {
    if team_dir > 0.0 {
        10.0
    } else {
        110.0
    }
}

impl Play {
    pub fn new_special(s: SpecialSetup, rng: &mut Rng) -> Play {
        let mut p = Play::empty();
        let dir = s.dir;
        let los_x = s.los_x;
        let ball_y = s.ball_y;
        let to_world = |d: f32, l: f32| V2::new(los_x + dir * d, clamp(ball_y + dir * l, 0.8, FIELD_W - 0.8));
        let kface = if dir > 0.0 { 0.0 } else { std::f32::consts::PI };
        let rface = if dir > 0.0 { std::f32::consts::PI } else { 0.0 };
        let kt = s.kick_team;
        let rt = 1 - kt;
        let kteam = &s.teams[kt as usize];
        let rteam = &s.teams[rt as usize];
        let mut kused = Vec::new();
        let mut rused = Vec::new();
        let mut kick: Vec<(usize, V2, Task)> = Vec::new(); // (roster, pos, task) in slot order
        let mut recv: Vec<(usize, V2, Task)> = Vec::new();
        let pk = |w: &[(Pos, usize)], used: &mut Vec<usize>| pick_unused(kteam, w, used);
        let pr = |w: &[(Pos, usize)], used: &mut Vec<usize>| pick_unused(rteam, w, used);
        let mut sp = SpecialPlay::new(s.kind, kt, V2::new(los_x, ball_y));

        match s.kind {
            StKind::Kickoff(_) => {
                let lanes = [-22.0, -17.0, -12.0, -7.0, -2.5, 0.0, 2.5, 7.0, 12.0, 17.0, 22.0];
                let wants: [&[(Pos, usize)]; 11] = [
                    &[(Pos::LB, 2)], &[(Pos::LB, 3)], &[(Pos::S, 2)], &[(Pos::CB, 3)], &[(Pos::CB, 2)],
                    &[(Pos::K, 0)],
                    &[(Pos::LB, 0)], &[(Pos::S, 1)], &[(Pos::TE, 1)], &[(Pos::RB, 1)], &[(Pos::WR, 3)],
                ];
                for (k, w) in wants.iter().enumerate() {
                    let ri = pk(w, &mut kused);
                    if k == QB {
                        let pos = to_world(-6.5, 0.0);
                        kick.push((ri, pos, Task::Hold { spot: pos }));
                    } else {
                        let pos = to_world(-1.0, lanes[k]);
                        kick.push((ri, pos, Task::Hold { spot: pos }));
                    }
                }
                // Receiving team: front line, second line, two deep returners.
                let recv_goal_d = (goal_x(dir) - los_x) * dir; // distance to the receiving team's goal line
                let deep = (recv_goal_d - 5.0).max(20.0);
                let layout: [((Pos, usize), f32, f32); 11] = [
                    ((Pos::TE, 0), 11.5, -16.0), ((Pos::TE, 1), 11.5, -8.0), ((Pos::LB, 2), 11.5, 0.0),
                    ((Pos::LB, 3), 11.5, 8.0), ((Pos::OL, 5), 11.5, 16.0),
                    ((Pos::OL, 6), 25.0, -11.0), ((Pos::DL, 4), 25.0, -4.0), ((Pos::S, 2), 25.0, 4.0), ((Pos::CB, 3), 25.0, 11.0),
                    ((Pos::WR, 3), deep, 5.0), ((Pos::RB, 1), deep - 2.0, -5.0),
                ];
                for (k, &(w, d, l)) in layout.iter().enumerate() {
                    let ri = pr(&[w], &mut rused);
                    let pos = to_world(d, l);
                    let task = if k >= 9 {
                        Task::Hold { spot: pos }
                    } else {
                        let home_d = if k < 5 { (d + 22.0).min(deep - 12.0) } else { (d + 18.0).min(deep - 6.0) };
                        Task::ReturnBlock { home: to_world(home_d, l * 0.6) }
                    };
                    recv.push((ri, pos, task));
                }
                sp.kick_at = 0.95;
                p.kind = PlayKind::Punt;
            }
            StKind::Punt => {
                let protect: [((Pos, usize), f32, f32); 11] = [
                    ((Pos::OL, 0), -0.8, 2.6), ((Pos::OL, 1), -0.8, 1.3), ((Pos::OL, 2), -0.6, 0.0),
                    ((Pos::OL, 3), -0.8, -1.3), ((Pos::OL, 4), -0.8, -2.6),
                    ((Pos::P, 0), -14.0, 0.0),
                    ((Pos::LB, 2), -1.7, -3.8), ((Pos::TE, 1), -1.7, 3.8),
                    ((Pos::CB, 3), -0.6, 18.0), ((Pos::WR, 3), -0.6, -18.0),
                    ((Pos::S, 2), -5.5, 0.8),
                ];
                for (k, &(w, d, l)) in protect.iter().enumerate() {
                    let ri = pk(&[w], &mut kused);
                    let pos = to_world(d, l);
                    let task = match k {
                        QB => Task::Hold { spot: pos },
                        8 | 9 => Task::Cover { lane: l * 0.8 },
                        _ => Task::Block { home: pos - V2::new(dir * 1.0, 0.0) },
                    };
                    kick.push((ri, pos, task));
                }
                let recv_goal_d = (goal_x(dir) - los_x) * dir;
                let ret_d = (recv_goal_d - 8.0).clamp(18.0, 42.0);
                let layout: [((Pos, usize), f32, f32); 11] = [
                    ((Pos::DL, 4), 1.0, -5.0), ((Pos::DL, 5), 1.0, -3.0), ((Pos::LB, 2), 1.0, -1.0),
                    ((Pos::LB, 3), 1.0, 1.0), ((Pos::TE, 1), 1.0, 3.0), ((Pos::OL, 5), 1.0, 5.0),
                    ((Pos::CB, 2), 1.2, 18.0), ((Pos::CB, 3), 1.2, -18.0),
                    ((Pos::S, 2), 16.0, 0.0), ((Pos::RB, 1), ret_d - 10.0, 4.0),
                    ((Pos::WR, 3), ret_d, 0.0),
                ];
                for (k, &(w, d, l)) in layout.iter().enumerate() {
                    let ri = pr(&[w], &mut rused);
                    let pos = to_world(d, l);
                    let task = match k {
                        2 | 3 => Task::Rush { lane: 0.0 },
                        6 => Task::Man { target: 8 },
                        7 => Task::Man { target: 9 },
                        10 => Task::Hold { spot: pos },
                        _ => Task::ReturnBlock { home: to_world((d + 16.0).min(ret_d - 8.0), l * 1.6) },
                    };
                    recv.push((ri, pos, task));
                }
                sp.kick_at = 1.9;
                p.kind = PlayKind::Punt;
            }
            StKind::FieldGoal { .. } => {
                let protect: [((Pos, usize), f32, f32); 11] = [
                    ((Pos::OL, 0), -0.8, 2.6), ((Pos::OL, 1), -0.8, 1.3), ((Pos::OL, 2), -0.6, 0.0),
                    ((Pos::OL, 3), -0.8, -1.3), ((Pos::OL, 4), -0.8, -2.6),
                    ((Pos::P, 0), -7.0, 0.0),
                    ((Pos::K, 0), -9.6, 1.8),
                    ((Pos::TE, 0), -1.0, 3.9), ((Pos::OL, 5), -1.4, 5.3), ((Pos::OL, 6), -1.4, -5.3),
                    ((Pos::TE, 1), -1.0, -3.9),
                ];
                for (k, &(w, d, l)) in protect.iter().enumerate() {
                    let ri = pk(&[w], &mut kused);
                    let pos = to_world(d, l);
                    let task = if k == QB || k == RB { Task::Hold { spot: pos } } else { Task::Block { home: pos } };
                    kick.push((ri, pos, task));
                }
                let lanes = [-6.0, -4.4, -2.8, -1.4, -0.4, 0.4, 1.4, 2.8, 4.4, 6.0, 0.0];
                let wants = [(Pos::DL, 0), (Pos::DL, 1), (Pos::DL, 2), (Pos::DL, 3), (Pos::LB, 0), (Pos::LB, 1), (Pos::DL, 4), (Pos::DL, 5), (Pos::LB, 2), (Pos::CB, 0), (Pos::S, 0)];
                for (k, w) in wants.iter().enumerate() {
                    let ri = pr(&[*w], &mut rused);
                    let pos = if k == 10 { to_world(4.0, 0.0) } else { to_world(1.0, lanes[k]) };
                    recv.push((ri, pos, Task::Rush { lane: lanes[k] * 0.3 }));
                }
                sp.kick_at = 1.3;
                p.kind = PlayKind::FieldGoal;
            }
        }

        for (k, (ri, pos, task)) in kick.into_iter().enumerate() {
            let mut a = Actor::new(kt, k as u8, ri, &kteam.players[ri], pos, kface, task);
            a.anim = Anim::Stance;
            p.actors.push(a);
        }
        for (k, (ri, pos, task)) in recv.into_iter().enumerate() {
            let mut a = Actor::new(rt, k as u8, ri, &rteam.players[ri], pos, rface, task);
            a.anim = Anim::Idle;
            p.actors.push(a);
        }

        p.off_team = kt;
        p.poss_team = kt;
        p.dir = dir;
        p.los_x = los_x;
        p.ball_y = ball_y;
        p.first_down_x = los_x;
        p.user_team = s.user_team;
        p.snap_delay = s.snap_delay;
        p.ball = match s.kind {
            StKind::Kickoff(_) => Ball::Loose(V3::new(los_x, ball_y, 0.18)),
            _ => Ball::Loose(V3::new(los_x, ball_y, 0.15)),
        };
        // Default user control: the returner when receiving, nobody while kicking.
        p.user = match s.user_team {
            Some(u) if u == rt => Some(match s.kind {
                StKind::FieldGoal { .. } => 11 + 5,
                _ => 21,
            }),
            _ => None,
        };
        let _ = rng;
        p.special = Some(sp);
        p
    }

    fn user_kicking(&self) -> bool {
        matches!((&self.special, self.user_team), (Some(sp), Some(u)) if sp.kick_team == u)
    }

    /// Before the snap / approach: wait for the user's kick meter, or the CPU's timing.
    pub(crate) fn special_presnap(&mut self, _input: &Input, rng: &mut Rng) {
        let start = if self.user_kicking() {
            self.kick_input.is_some()
        } else {
            self.t >= self.snap_delay
        };
        if !start {
            return;
        }
        let params = match self.kick_input.take() {
            Some(k) => k,
            None => self.cpu_kick_params(rng),
        };
        if let Some(sp) = self.special.as_mut() {
            sp.params = params;
        }
        self.phase = PlayPhase::Live;
        self.t = 0.0;
        for a in self.actors.iter_mut() {
            a.anim = Anim::Run;
        }
        if !matches!(self.special.as_ref().map(|s| s.kind), Some(StKind::Kickoff(_))) {
            self.events.push(Event::Snap);
        }
    }

    fn kicker_index(&self) -> usize {
        match self.special.as_ref().map(|s| s.kind) {
            Some(StKind::FieldGoal { .. }) => RB,
            _ => QB,
        }
    }

    /// Choose kick parameters for the CPU.
    fn cpu_kick_params(&self, rng: &mut Rng) -> KickParams {
        let Some(sp) = self.special.as_ref() else { return KickParams::default() };
        let k = &self.actors[self.kicker_index()];
        let acc = k.r.kick_acc as f32;
        let wobble = |rng: &mut Rng, s: f32| clamp(rng.normal() * s * (1.25 - acc / 120.0), -1.0, 1.0);
        match sp.kind {
            StKind::Kickoff(KickStyle::Deep) => KickParams { power: clamp(0.93 + rng.normal() * 0.05, 0.75, 1.0), accuracy: wobble(rng, 0.25), aim: 0.0 },
            StKind::Kickoff(KickStyle::Squib) => KickParams { power: 0.65, accuracy: wobble(rng, 0.3), aim: 0.0 },
            StKind::Kickoff(KickStyle::Onside) => KickParams { power: 0.5, accuracy: if rng.chance(0.5) { 0.85 } else { -0.85 }, aim: 0.0 },
            StKind::Punt => {
                // Pooch it inside the 10 when close, otherwise boom it.
                let to_goal = (goal_x(self.dir) - self.los_x) * self.dir;
                let want = (to_goal - 8.0).max(18.0);
                let reach = 0.82 + k.r.kick_power as f32 * 0.0022;
                let power = clamp((want / reach - 36.0) / 28.0, 0.1, 1.0);
                KickParams { power: clamp(power + rng.normal() * 0.04, 0.2, 1.0), accuracy: wobble(rng, 0.22), aim: 0.0 }
            }
            StKind::FieldGoal { .. } => {
                // Smallest power that clears the bar with a margin.
                let mut power = 1.0;
                let mut p = 0.3;
                while p <= 1.0 {
                    if self.fg_height_at_posts(p, 0.0) > 3.9 {
                        power = p;
                        break;
                    }
                    p += 0.02;
                }
                let dist = (self.posts_x() - self.los_x).abs();
                let sigma_deg = 1.0 + (99.0 - acc) * 0.06 + dist * 0.02;
                KickParams { power: clamp(power + 0.06, 0.0, 1.0), accuracy: clamp(rng.normal() * sigma_deg / 8.0, -1.0, 1.0), aim: 0.0 }
            }
        }
    }

    fn posts_x(&self) -> f32 {
        if self.dir > 0.0 {
            FIELD_LEN
        } else {
            0.0
        }
    }

    fn fg_velocity(&self, power: f32) -> f32 {
        let k = &self.actors[RB];
        (17.5 + 10.5 * power) * (0.85 + k.r.kick_power as f32 * 0.0018)
    }

    /// Height of a field goal when it reaches the uprights (for CPU power choice).
    fn fg_height_at_posts(&self, power: f32, _acc: f32) -> f32 {
        let v = self.fg_velocity(power);
        let th = 31f32.to_radians();
        let d = (self.posts_x() - (self.los_x - self.dir * 7.0)).abs();
        let t = d / (v * th.cos());
        0.25 + v * th.sin() * t - 0.5 * GRAVITY * t * t
    }

    /// Largest aim angle (radians) either side of the kick's natural line.
    fn max_aim(kind: StKind) -> f32 {
        match kind {
            StKind::Kickoff(KickStyle::Onside) => 0.6,
            StKind::Kickoff(_) => 0.35,
            StKind::Punt => 0.45,
            StKind::FieldGoal { .. } => 0.2,
        }
    }

    /// The kick's launch from its parameters: origin, launch height, velocity, landing
    /// spot. `noise` is the kicker's random error in degrees (0 for a preview).
    fn kick_solution(&self, sp: &SpecialPlay, params: KickParams, noise: f32) -> (V2, f32, V3, V2) {
        let ki = self.kicker_index();
        let kr = self.actors[ki].r;
        let reach = 0.82 + kr.kick_power as f32 * 0.0022;
        let pw = clamp(params.power, 0.0, 1.0);
        let acc = clamp(params.accuracy, -1.0, 1.0);
        let aim_deg = clamp(params.aim, -1.0, 1.0) * Self::max_aim(sp.kind).to_degrees();
        let dirv = V2::new(self.dir, 0.0);
        let (origin, z0) = match sp.kind {
            StKind::Kickoff(_) => (sp.kick_spot, 0.2),
            StKind::Punt => (self.actors[QB].p + dirv * 0.6, 0.9),
            StKind::FieldGoal { .. } => (self.actors[QB].p + dirv * 0.4, 0.25),
        };
        let (theta_deg, range, dev_deg, base) = match sp.kind {
            StKind::Kickoff(KickStyle::Deep) => (49.0, (37.0 + 30.0 * pw) * reach, acc * 6.0 + noise, dirv),
            StKind::Kickoff(KickStyle::Squib) => (15.0, 20.0 + 15.0 * pw, acc * 8.0 + noise, dirv),
            StKind::Kickoff(KickStyle::Onside) => (22.0, 10.5 + 3.0 * pw, acc * 28.0 + noise, dirv),
            StKind::Punt => (56.0, (36.0 + 28.0 * pw) * reach, acc * 14.0 + noise, dirv),
            StKind::FieldGoal { .. } => {
                let target = V2::new(self.posts_x(), FIELD_W * 0.5);
                (31.0, 0.0, acc * 8.0 + noise * 0.6, (target - origin).norm())
            }
        };
        let th = (theta_deg as f32).to_radians();
        let v = if let StKind::FieldGoal { .. } = sp.kind {
            self.fg_velocity(pw)
        } else {
            (range * GRAVITY / (2.0 * th).sin()).sqrt()
        };
        // Positive accuracy and aim go right (rotate clockwise from the kicker's view).
        let a = -((dev_deg + aim_deg) as f32).to_radians();
        let (sa, ca) = a.sin_cos();
        let h = V2::new(base.x * ca - base.y * sa, base.x * sa + base.y * ca);
        let vel = V3::new(h.x * v * th.cos(), h.y * v * th.cos(), v * th.sin());
        let hang = 2.0 * vel.z / GRAVITY;
        let land = origin + h * (v * th.cos() * hang);
        (origin, z0, vel, land)
    }

    /// Where a kick with this power and aim would go, with no kicker error: the kick
    /// origin, the landing spot (for field goals, where it crosses the goal line plane),
    /// and for field goals whether it clears the crossbar between the uprights.
    pub fn kick_preview(&self, power: f32, aim: f32) -> Option<(V2, V2, bool)> {
        let sp = self.special.as_ref()?;
        let params = KickParams { power, accuracy: 0.0, aim };
        let (origin, z0, vel, land) = self.kick_solution(sp, params, 0.0);
        if let StKind::FieldGoal { .. } = sp.kind {
            let posts = self.posts_x();
            let h = V2::new(vel.x, vel.y);
            let t = (posts - origin.x) / h.x;
            if !t.is_finite() || t <= 0.0 {
                return Some((origin, land, false));
            }
            let at = origin + h * t;
            let z = z0 + vel.z * t - 0.5 * GRAVITY * t * t;
            let ok = z > CROSSBAR_Z && (at.y - FIELD_W * 0.5).abs() < UPRIGHT_HALF;
            return Some((origin, at, ok));
        }
        Some((origin, land, true))
    }

    /// Kick the ball: build its launch velocity from the kick parameters.
    fn launch_kick(&mut self, rng: &mut Rng) {
        let Some(sp) = self.special.clone() else { return };
        let ki = self.kicker_index();
        let kr = self.actors[ki].r;
        let noise = rng.normal() * (0.3 + (99.0 - kr.kick_acc as f32) * 0.02);
        let (origin, z0, vel, land) = self.kick_solution(&sp, sp.params, noise);
        let hang = 2.0 * vel.z / GRAVITY;

        // Blocked kick? Somebody got to the kick point.
        let blockable = !matches!(sp.kind, StKind::Kickoff(_));
        let rusher_close = (0..N).any(|j| {
            let o = &self.actors[j];
            o.team != sp.kick_team && o.upright() && o.engaged.is_none() && o.p.dist(origin) < 1.2
        });
        let blocked = blockable && rusher_close && rng.chance(if sp.kind == StKind::Punt { 0.35 } else { 0.25 });

        let sp_mut = self.special.as_mut().unwrap();
        sp_mut.kicked = true;
        sp_mut.land = land;
        if blocked {
            sp_mut.touched = true;
            sp_mut.landed = true;
            if let StKind::FieldGoal { .. } = sp.kind {
                sp_mut.fg_result = Some(false);
            }
            let bvel = V3::new(-self.dir * 3.0 + rng.normal() * 2.0, rng.normal() * 3.0, 3.0);
            sp_mut.vel = bvel;
            self.ball = Ball::Air { pos: V3::from_xy(origin, z0), vel: bvel, target: origin, intended: None, arrive: 0.6, t: 0.0 };
            self.events.push(Event::Deflection);
            self.events.push(Event::Banner { text: "BLOCKED!".into(), style: "bad".into() });
        } else {
            sp_mut.vel = vel;
            self.ball = Ball::Air { pos: V3::from_xy(origin, z0), vel, target: land, intended: None, arrive: hang, t: 0.0 };
        }
        self.events.push(Event::Kick);
        self.actors[ki].anim = Anim::Throw;

        // Pick returners and hand the user a player to control.
        let rt = 1 - sp.kick_team;
        if matches!(sp.kind, StKind::Kickoff(_) | StKind::Punt) && !blocked {
            let ret = (11..N)
                .filter(|&j| matches!(self.actors[j].task, Task::Hold { .. }))
                .min_by(|&x, &y| self.actors[x].p.dist(land).partial_cmp(&self.actors[y].p.dist(land)).unwrap())
                .unwrap_or(N - 1);
            self.special.as_mut().unwrap().returner = ret;
            for j in 11..N {
                if j == ret {
                    self.actors[j].task = Task::Returner;
                } else if matches!(self.actors[j].task, Task::Hold { .. }) {
                    self.actors[j].task = Task::ReturnBlock { home: land - V2::new(-self.dir * 6.0, 0.0) };
                } else if matches!(self.actors[j].task, Task::Man { .. } | Task::Rush { .. }) {
                    let home = land - V2::new(-self.dir * 14.0, 0.0) + V2::new(0.0, (j as f32 - 16.0) * 2.0);
                    self.actors[j].task = Task::ReturnBlock { home };
                }
            }
            if self.user_team == Some(rt) {
                self.user = Some(ret);
                self.user_touched = false;
            } else if self.user_team == Some(sp.kick_team) {
                // Control the cover man closest to where the ball will come down.
                self.user = (0..11)
                    .filter(|&j| j != self.kicker_index())
                    .min_by(|&x, &y| self.actors[x].p.dist(land).partial_cmp(&self.actors[y].p.dist(land)).unwrap());
                self.user_touched = false;
            }
            // Coverage releases.
            for j in 0..11 {
                if j == self.kicker_index() {
                    self.actors[j].task = Task::Pursue;
                } else if !matches!(self.actors[j].task, Task::Cover { .. }) {
                    let lane = (self.actors[j].p.y - self.ball_y) * self.dir;
                    self.actors[j].task = Task::Cover { lane };
                }
            }
        }
    }

    /// Per-step special-teams choreography (runs before movement).
    pub(crate) fn special_live(&mut self, _dt: f32, input: &Input, rng: &mut Rng) {
        let Some(sp) = self.special.clone() else { return };
        let dirv = V2::new(self.dir, 0.0);

        // End of a field goal (or blocked kick) once the result is known.
        if let Some(end) = sp.end_t {
            if self.t >= end {
                let good = sp.fg_result.unwrap_or(false);
                let pat = matches!(sp.kind, StKind::FieldGoal { pat: true });
                let dist = ((self.posts_x() - (self.los_x - self.dir * 7.0)).abs()).round() as i32;
                let text = if pat {
                    format!("Extra point is {}.", if good { "GOOD" } else { "NO GOOD" })
                } else {
                    format!("{}-yard field goal is {}.", dist, if good { "GOOD" } else { "NO GOOD" })
                };
                let spot = V2::new(self.los_x, self.ball_y);
                self.end_play(EndKind::Down, spot, sp.kick_team, text);
                return;
            }
        }

        match sp.kind {
            StKind::Kickoff(_) => {
                if !sp.kicked {
                    // Kicker approach; coverage starts with him.
                    let spot = sp.kick_spot - dirv * 0.4;
                    self.actors[QB].task = Task::Hold { spot };
                    if self.t > 0.55 {
                        for j in 0..11 {
                            if j != QB && !matches!(self.actors[j].task, Task::Cover { .. }) {
                                let lane = (self.actors[j].p.y - self.ball_y) * self.dir;
                                self.actors[j].task = Task::Cover { lane };
                            }
                        }
                    }
                    if self.t >= sp.kick_at {
                        self.launch_kick(rng);
                    }
                }
            }
            StKind::Punt | StKind::FieldGoal { .. } => {
                let catcher = QB; // punter or holder
                let snap_time = if sp.kind == StKind::Punt { 0.7 } else { 0.42 };
                if !sp.snapped {
                    let from = V3::new(self.los_x, self.ball_y, 0.5);
                    let to = self.actors[catcher].p;
                    let k = clamp(self.t / snap_time, 0.0, 1.0);
                    let x = from.x + (to.x - from.x) * k;
                    let y = from.y + (to.y - from.y) * k;
                    let z = 0.5 + (1.1 - 0.5) * k + (k * (1.0 - k)) * 1.2;
                    self.ball = Ball::Loose(V3::new(x, y, z));
                    if self.t >= snap_time {
                        self.special.as_mut().unwrap().snapped = true;
                        self.ball = Ball::Held(catcher);
                    }
                }
                if let StKind::FieldGoal { .. } = sp.kind {
                    if !sp.kicked && self.t > 0.45 {
                        let hold = self.actors[QB].p;
                        let lat = V2::new(0.0, 0.45 * self.dir);
                        self.actors[RB].task = Task::Hold { spot: hold - dirv * 0.7 + lat };
                    }
                }
                if sp.snapped && !sp.kicked && self.t >= sp.kick_at {
                    self.launch_kick(rng);
                }
            }
        }

        // Kick returner in the end zone: take a knee (user presses action; CPU decides at the catch).
        if let Some(sp) = self.special.as_ref() {
            if sp.in_ez_catch && self.carrier.is_some() && self.carrier == self.user && input.action && self.t - sp.caught_t < 1.2 {
                let spot = self.actors[self.carrier.unwrap()].p;
                let rt = 1 - sp.kick_team;
                self.events.push(Event::Touchback);
                self.end_play(EndKind::Touchback, spot, rt, "Touchback.".into());
            }
        }
    }

    /// Ball flight, bounces and recoveries for kicked balls.
    pub(crate) fn special_flight(&mut self, dt: f32, rng: &mut Rng) {
        if self.phase != PlayPhase::Live {
            return;
        }
        let Some(sp) = self.special.clone() else { return };
        if !sp.kicked || self.carrier.is_some() {
            return;
        }
        let Ball::Air { mut pos, .. } = self.ball.clone() else { return };
        let mut vel = sp.vel;
        let kt = sp.kick_team;
        let rt = 1 - kt;
        let recv_dir = self.team_dir(rt);
        let prev_x = pos.x;
        pos = pos + vel * dt;
        if pos.z > 0.0 || vel.z > 0.0 {
            vel.z -= GRAVITY * dt;
        }

        // Field goal: judge it at the plane of the uprights.
        if let StKind::FieldGoal { .. } = sp.kind {
            let px = self.posts_x();
            if sp.fg_result.is_none() && (prev_x - px) * (pos.x - px) <= 0.0 && prev_x != pos.x {
                let good = pos.z > CROSSBAR_Z && (pos.y - FIELD_W * 0.5).abs() < UPRIGHT_HALF;
                let s = self.special.as_mut().unwrap();
                s.fg_result = Some(good);
                s.end_t = Some(self.t + 0.9);
            }
            if pos.z <= 0.0 {
                let s = self.special.as_mut().unwrap();
                if s.fg_result.is_none() {
                    s.fg_result = Some(false);
                }
                if s.end_t.is_none() {
                    s.end_t = Some(self.t + 0.5);
                }
                pos.z = 0.05;
                vel = V3::new(vel.x * 0.4, vel.y * 0.4, 0.0);
            }
            self.special.as_mut().unwrap().vel = vel;
            self.ball = Ball::Air { pos, vel, target: sp.land, intended: None, arrive: 0.0, t: 0.0 };
            return;
        }

        // Catch attempts while the ball is coming down.
        if !sp.landed && vel.z < 0.0 && pos.z < 2.6 && pos.z > 0.25 {
            let mut cands: Vec<(usize, f32)> = (11..N)
                .filter(|&j| self.actors[j].upright() && self.actors[j].engaged.is_none())
                .map(|j| (j, self.actors[j].p.dist(pos.xy())))
                .filter(|&(_, d)| d < 1.3)
                .collect();
            cands.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            if let Some(&(j, _)) = cands.first() {
                let catching = self.actors[j].r.catching as f32;
                let p = if j == sp.returner { 0.93 + catching * 0.0006 } else { 0.8 };
                if rng.chance(p) {
                    self.kick_caught(j, pos);
                    return;
                } else {
                    // Muffed!
                    let s = self.special.as_mut().unwrap();
                    s.touched = true;
                    s.landed = true;
                    vel = V3::new(vel.x * 0.25 + rng.normal(), vel.y * 0.25 + rng.normal(), 2.4);
                    self.events.push(Event::Drop);
                    self.events.push(Event::Banner { text: "MUFFED!".into(), style: "bad".into() });
                    for k in 0..N {
                        if self.actors[k].p.dist(pos.xy()) < 18.0 && k != self.kicker_index() {
                            self.actors[k].task = Task::Fetch;
                        }
                    }
                }
            }
        }

        // Ground contact: touchback, bounce, roll.
        if pos.z <= 0.0 {
            pos.z = 0.0;
            let first = !self.special.as_ref().unwrap().landed;
            if first {
                self.special.as_mut().unwrap().landed = true;
                let in_ez = (pos.x - own_goal_x(recv_dir)) * recv_dir < 0.0;
                if in_ez && !sp.touched {
                    self.kick_touchback(pos.xy());
                    return;
                }
                // Coverage and (on kickoffs) the return team go after the loose ball.
                let kickoff = matches!(sp.kind, StKind::Kickoff(_));
                for k in 0..N {
                    let a = &self.actors[k];
                    if a.p.dist(pos.xy()) > 20.0 || k == self.kicker_index() {
                        continue;
                    }
                    if a.team == kt || kickoff {
                        self.actors[k].task = Task::Fetch;
                    }
                }
            }
            if vel.z.abs() > 1.4 {
                vel.z = vel.z.abs() * 0.45;
                vel.x *= 0.65;
                vel.y *= 0.65;
            } else {
                vel.z = 0.0;
                let h = V2::new(vel.x, vel.y);
                let sp_h = h.len();
                let nh = if sp_h > 0.0 { h * ((sp_h - 6.0 * dt).max(0.0) / sp_h) } else { h };
                vel.x = nh.x;
                vel.y = nh.y;
            }
        }
        self.special.as_mut().unwrap().vel = vel;
        self.ball = Ball::Air { pos, vel, target: sp.land, intended: None, arrive: 0.0, t: 0.0 };

        let landed = self.special.as_ref().unwrap().landed;
        if !landed {
            return;
        }

        // Out of bounds / out the back of the end zone.
        if pos.y < 0.0 || pos.y > FIELD_W {
            let spot = V2::new(clamp(pos.x, 0.0, FIELD_LEN), clamp(pos.y, 0.0, FIELD_W));
            let in_ez = (spot.x - own_goal_x(recv_dir)) * recv_dir < 0.0;
            if in_ez {
                self.kick_touchback(spot);
            } else if matches!(sp.kind, StKind::Kickoff(_)) && !sp.touched {
                self.special.as_mut().unwrap().kick_oob = true;
                self.events.push(Event::OutOfBounds);
                self.end_play(EndKind::OutOfBounds, spot, rt, "Kickoff out of bounds.".into());
            } else {
                self.events.push(Event::OutOfBounds);
                self.end_play(EndKind::OutOfBounds, spot, rt, "Kick rolls out of bounds.".into());
            }
            return;
        }
        if (pos.x - own_goal_x(recv_dir) + recv_dir * 10.0) * recv_dir < 0.0 {
            self.kick_touchback(pos.xy());
            return;
        }

        // Recover the loose ball.
        let s = self.special.as_mut().unwrap();
        s.recover_cd = (s.recover_cd - dt).max(0.0);
        let speed = V2::new(vel.x, vel.y).len();
        if s.recover_cd <= 0.0 && pos.z < 1.0 {
            s.recover_cd = 0.15;
            let traveled = (pos.x - sp.kick_spot.x) * self.dir;
            let mut best: Option<(usize, f32)> = None;
            for k in 0..N {
                let a = &self.actors[k];
                if !a.upright() || a.engaged.is_some() {
                    continue;
                }
                let d = a.p.dist(pos.xy());
                if d > 0.95 {
                    continue;
                }
                let legal = if a.team == rt {
                    true
                } else {
                    match sp.kind {
                        StKind::Kickoff(_) => sp.touched || traveled >= 10.0,
                        _ => sp.touched,
                    }
                };
                // Punt coverage downs a dying ball instead of picking it up.
                let downs = a.team == kt && sp.kind == StKind::Punt && !sp.touched && speed < 1.2;
                if (legal || downs) && best.map(|b| d < b.1).unwrap_or(true) {
                    best = Some((k, d));
                }
            }
            if let Some((k, _)) = best {
                let a_team = self.actors[k].team;
                if a_team == kt && sp.kind == StKind::Punt && !sp.touched {
                    let spot = pos.xy();
                    let text = format!("Punt downed by {}.", self.actors[k].name);
                    self.end_play(EndKind::Down, spot, rt, text);
                    return;
                }
                if rng.chance(0.55) {
                    self.kick_recovered(k, pos);
                    return;
                }
            }
        }
        // A dead ball nobody wants.
        if speed < 0.2 {
            let s = self.special.as_mut().unwrap();
            s.stopped_t += dt;
            if s.stopped_t > 2.5 {
                let spot = pos.xy();
                self.end_play(EndKind::Down, spot, rt, "The ball is dead.".into());
            }
        }
    }

    fn kick_touchback(&mut self, spot: V2) {
        let rt = 1 - self.special.as_ref().map(|s| s.kick_team).unwrap_or(0);
        self.events.push(Event::Touchback);
        self.ball = Ball::Loose(V3::new(spot.x, spot.y, 0.12));
        self.end_play(EndKind::Touchback, spot, rt, "Touchback.".into());
    }

    fn kick_caught(&mut self, j: usize, pos: V3) {
        let sp = self.special.clone().unwrap();
        let rt = 1 - sp.kick_team;
        let recv_dir = self.team_dir(rt);
        self.ball = Ball::Held(j);
        self.carrier = Some(j);
        self.poss_team = rt;
        self.actors[j].task = Task::Carrier;
        self.actors[j].anim = Anim::Catch;
        let spot = self.actors[j].p;
        let in_ez = (spot.x - own_goal_x(recv_dir)) * recv_dir < 0.0;
        {
            let s = self.special.as_mut().unwrap();
            s.touched = true;
            s.caught_t = self.t;
            s.in_ez_catch = in_ez;
            s.catch_spot = Some(spot);
        }
        self.int_in_endzone = in_ez;
        self.catch_spot = Some(spot);
        self.events.push(Event::Catch { actor: j });
        let user_returner = self.user == Some(j);

        // Fair catch on punts: CPU calls it with coverage close; the user signals it.
        if sp.kind == StKind::Punt {
            let crowded = (0..11).any(|k| self.actors[k].p.dist(spot) < 5.0);
            let fair = if user_returner { self.fair_catch_signal } else { crowded };
            if fair && !in_ez {
                self.events.push(Event::FairCatch);
                let text = format!("Fair catch by {}.", self.actors[j].name);
                self.end_play(EndKind::Down, spot, rt, text);
                return;
            }
        }
        // Deep in the end zone: the CPU takes a knee.
        if in_ez && !user_returner {
            let depth = (own_goal_x(recv_dir) - spot.x) * recv_dir;
            if depth > 2.5 || sp.kind == StKind::Punt {
                self.events.push(Event::Touchback);
                self.end_play(EndKind::Touchback, spot, rt, "Touchback.".into());
                return;
            }
        }
        let _ = pos;
        self.set_react_all(rt);
    }

    fn kick_recovered(&mut self, k: usize, pos: V3) {
        let team = self.actors[k].team;
        self.ball = Ball::Held(k);
        self.carrier = Some(k);
        self.poss_team = team;
        self.actors[k].task = Task::Carrier;
        self.catch_spot = Some(pos.xy());
        if let Some(s) = self.special.as_mut() {
            s.touched = true;
            s.caught_t = self.t;
            s.catch_spot = Some(pos.xy());
        }
        let kt = self.special.as_ref().map(|s| s.kick_team).unwrap_or(0);
        if team == kt {
            self.events.push(Event::Banner { text: "RECOVERED!".into(), style: "good".into() });
        }
        self.events.push(Event::Catch { actor: k });
        if let Some(ut) = self.user_team {
            self.user = if ut == team { Some(k) } else { self.nearest_opponent(k, false) };
            self.user_touched = false;
        }
        self.set_react_all(team);
    }

    pub(crate) fn special_describe(&self, c: usize, spot: V2, tackler: &str) -> String {
        let who = &self.actors[c].name;
        let by = if tackler.is_empty() { String::new() } else { format!(" Tackled by {}.", tackler) };
        let sp = self.special.as_ref().unwrap();
        let from = sp.catch_spot.unwrap_or(spot);
        let team_dir = self.team_dir(self.actors[c].team);
        let yards = ((spot.x - from.x) * team_dir).round() as i32;
        if self.actors[c].team == sp.kick_team {
            return format!("{} recovers for the kicking team!{}", who, by);
        }
        match sp.kind {
            StKind::Punt => format!("{} returns the punt {} yards.{}", who, yards, by),
            _ => format!("{} returns the kick {} yards.{}", who, yards, by),
        }
    }

    // ---- Movement for special-teams tasks ------------------------------------------

    pub(crate) fn cover_desire(&self, i: usize, lane: f32) -> V2 {
        let a = &self.actors[i];
        if self.carrier.is_some() && self.actors[self.carrier.unwrap()].team != a.team {
            return self.pursue(i);
        }
        let lane_y0 = self.ball_y + lane * self.dir;
        if !self.special.as_ref().map(|s| s.kicked).unwrap_or(false) {
            // Gunners sprint downfield in their lane before the kick.
            return seek(a.p, V2::new(a.p.x + self.dir * 8.0, clamp(lane_y0, 1.0, FIELD_W - 1.0)), a.top);
        }
        let land = self.special.as_ref().map(|s| s.land).unwrap_or(a.p);
        let to_land = (land.x - a.p.x) * self.dir;
        // Stay in the lane until close, then squeeze toward the ball.
        let squeeze = clamp(1.0 - to_land / 25.0, 0.0, 1.0);
        let lane_y = self.ball_y + lane * self.dir;
        let y = lane_y + (land.y - lane_y) * squeeze;
        let x = if to_land > 4.0 { a.p.x + self.dir * 8.0 } else { land.x - self.dir * 1.5 };
        seek(a.p, V2::new(x, clamp(y, 1.0, FIELD_W - 1.0)), a.top)
    }

    pub(crate) fn returner_desire(&self, i: usize) -> V2 {
        let a = &self.actors[i];
        let Some(sp) = self.special.as_ref() else { return V2::ZERO };
        if !sp.kicked {
            return V2::ZERO;
        }
        if sp.landed {
            // Kickoffs: field the bouncing ball. Punts: let it roll.
            if matches!(sp.kind, StKind::Kickoff(_)) || sp.touched {
                return seek(a.p, self.ball_pos().xy(), a.top);
            }
            return arrive(a.p, a.p, 0.0);
        }
        arrive(a.p, sp.land, a.top)
    }
}
