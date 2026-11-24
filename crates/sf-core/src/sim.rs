//! The live on-field simulation of a single play.
//!
//! Actors `0..11` are the offense (in `OSLOTS` order) and `11..22` the defense
//! (in `DSLOTS` order). The play runs at a fixed timestep and reports a
//! [`PlayResult`] when the ball is dead.

use crate::events::Event;
use crate::math::*;
use crate::player::{Player, Pos, Ratings, Team};
use crate::playbook::*;
use crate::rng::Rng;
use crate::physics::Physics;
use crate::contact::RushMove;

pub const FIELD_LEN: f32 = 120.0;
pub const FIELD_W: f32 = 53.333;
pub const HASH_LO: f32 = 23.58;
pub const HASH_HI: f32 = 29.75;
/// Gravity in yards/s².
pub const GRAVITY: f32 = 10.72;
const RELEASE_Z: f32 = 2.0;
/// Floats per actor in the render snapshot.
pub const STRIDE: usize = 8;
/// Floats for the ball at the end of the render snapshot.
pub const BALL_STRIDE: usize = 12;
pub const N: usize = 22;
pub(crate) const QB: usize = 5;
pub(crate) const RB: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Anim {
    Stance = 0,
    Idle = 1,
    Run = 2,
    Block = 3,
    Throw = 4,
    Catch = 5,
    Dive = 6,
    Down = 7,
    Juke = 8,
    Spin = 9,
    Stiff = 10,
    Celebrate = 11,
    Wrap = 12,
    Hurdle = 13,
    Truck = 14,
    Ragdoll = 15,
    Stagger = 16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    None,
    Juke,
    Spin,
    Stiff,
    Dive,
    Hurdle,
    Truck,
}

#[derive(Clone, Debug)]
pub enum Task {
    Stance,
    Qb { drop_to: V2, mesh: Option<V2> },
    Route { pts: Vec<V2>, idx: usize, sit: bool, delay: f32, home: V2 },
    Block { home: V2 },
    RunPath { pts: Vec<V2>, idx: usize, delay: f32 },
    Rush { lane: f32 },
    Man { target: usize },
    Zone { spot: V2, deep: bool },
    RunFit { spot: V2 },
    Pursue,
    Carrier,
    Escort,
    Idle,
    /// Go to a spot and stay (kicker approach, holder, punter, waiting returner).
    Hold { spot: V2 },
    /// Kick coverage: sprint downfield in a lane, then pursue.
    Cover { lane: f32 },
    /// Return team: drop back to `home`, then block once the ball is caught.
    ReturnBlock { home: V2 },
    /// Kick returner: get under the ball.
    Returner,
    /// Chase a loose ball.
    Fetch,
}

#[derive(Clone, Debug)]
pub struct Actor {
    pub team: u8,
    pub slot: u8,
    pub roster: usize,
    pub pos: Pos,
    pub number: u8,
    pub name: String,
    pub skin: u8,
    pub r: Ratings,
    pub top: f32,
    pub acc: f32,
    pub mass: f32,
    pub p: V2,
    pub v: V2,
    pub z: f32,
    pub facing: f32,
    pub task: Task,
    pub anim: Anim,
    /// Stumbling: reduced control for this many seconds.
    pub stun: f32,
    /// On the ground for this many seconds.
    pub ground: f32,
    pub engaged: Option<usize>,
    pub engage_t: f32,
    pub mv: Move,
    pub move_t: f32,
    pub move_cd: f32,
    pub tackle_cd: f32,
    /// Countdown until this player recognises a run / catch and pursues (-1 = not triggered).
    pub react: f32,
    /// Countdown until a defender reacts to a thrown ball (-1 = not triggered).
    pub ball_react: f32,
    /// Play-action fake: crash toward the line for this long.
    pub bite: f32,
    pub tried_catch: bool,
    /// 1–5 receiver icon (0 = none).
    pub icon: u8,
    /// Simulated by ragdoll physics (tackled).
    pub ragdoll: bool,
    /// Hanging onto the ball carrier.
    pub wrapping: bool,
    pub wrap_off: V2,
    pub rush_cd: f32,
    /// Knocked off balance (brief slowdown).
    pub stagger: f32,
    /// Radius of the player's puck (the circle that is his true body on the turf).
    pub radius: f32,
    /// Just shed a block: can't be re-engaged by `shed_from` for a moment.
    pub shed_cd: f32,
    pub shed_from: Option<usize>,
    /// Which way a defender is working across his blocker (+1 / -1 along the blocker's left).
    pub rush_side: f32,
    /// Blocker's hands knocked away (swim / spin) for this long.
    pub grip_off: f32,
    /// Bull rush: extra drive for this long.
    pub drive_boost: f32,
    /// Direction of the current move's burst (juke).
    pub mv_dir: V2,
}

impl Actor {
    pub(crate) fn new(team: u8, slot: u8, roster: usize, pl: &Player, p: V2, facing: f32, task: Task) -> Self {
        let r = pl.ratings;
        Actor {
            team,
            slot,
            roster,
            pos: pl.pos,
            number: pl.number,
            name: pl.short_name(),
            skin: pl.skin,
            r,
            top: r.top_speed(),
            acc: r.accel_rate(),
            mass: r.mass(pl.pos),
            p,
            v: V2::ZERO,
            z: 0.0,
            facing,
            task,
            anim: Anim::Stance,
            stun: 0.0,
            ground: 0.0,
            engaged: None,
            engage_t: 0.0,
            mv: Move::None,
            move_t: 0.0,
            move_cd: 0.0,
            tackle_cd: 0.0,
            react: -1.0,
            ball_react: -1.0,
            bite: 0.0,
            tried_catch: false,
            icon: 0,
            ragdoll: false,
            wrapping: false,
            wrap_off: V2::ZERO,
            rush_cd: 0.0,
            stagger: 0.0,
            radius: crate::puck::radius_for(pl.pos, r.strength),
            shed_cd: 0.0,
            shed_from: None,
            rush_side: 1.0,
            grip_off: 0.0,
            drive_boost: 0.0,
            mv_dir: V2::ZERO,
        }
    }
    pub(crate) fn upright(&self) -> bool {
        self.ground <= 0.0
    }
    pub(crate) fn facing_v(&self) -> V2 {
        V2::from_angle(self.facing)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub enum Foul {
    FalseStart,
    Offside,
    OffensiveHolding,
    DefensiveHolding,
    PassInterference,
}

impl Foul {
    pub fn label(self) -> &'static str {
        match self {
            Foul::FalseStart => "False Start",
            Foul::Offside => "Offside",
            Foul::OffensiveHolding => "Holding",
            Foul::DefensiveHolding => "Defensive Holding",
            Foul::PassInterference => "Pass Interference",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Flag {
    pub foul: Foul,
    pub team: u8,
    pub spot: V2,
    pub player: String,
}

/// User (or CPU) kick: power 0–1, accuracy -1 (hook left) .. 1 (slice right), and aim
/// -1 (left) .. 1 (right) of the kick's natural line, from the kicker's point of view.
#[derive(Clone, Copy, Debug, Default)]
pub struct KickParams {
    pub power: f32,
    pub accuracy: f32,
    pub aim: f32,
}

#[derive(Clone, Debug)]
pub enum Ball {
    Held(usize),
    Air { pos: V3, vel: V3, target: V2, intended: Option<usize>, arrive: f32, t: f32 },
    Loose(V3),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlayPhase {
    PreSnap,
    Live,
    Over,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndKind {
    Down,
    OutOfBounds,
    Incomplete,
    Touchdown,
    Safety,
    Touchback,
}

#[derive(Clone, Debug)]
pub struct PlayResult {
    pub kind: EndKind,
    pub spot: V2,
    /// Team holding the ball when the play ended.
    pub carrier_team: u8,
    pub turnover: bool,
    pub sack: bool,
    pub text: String,
    pub flags: Vec<Flag>,
    /// Possession changed on a fumble.
    pub fumble: bool,
    /// Field goal / extra point result.
    pub fg: Option<bool>,
    /// Kickoff went out of bounds.
    pub kick_oob: bool,
}

/// One frame of player input, already converted to field space by the client.
#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    /// Desired move direction in field coordinates (length 0–1).
    pub mx: f32,
    pub my: f32,
    pub sprint: bool,
    /// Snap / juke / dive (edge-triggered).
    pub action: bool,
    pub spin: bool,
    pub stiff: bool,
    pub switch: bool,
    /// Receiver icon 1–5 to throw to (0 = no throw this frame).
    pub throw_to: u8,
    /// 0 = bullet, 1 = touch, 2 = lob.
    pub throw_kind: u8,
    /// Signal a fair catch on a punt (edge-triggered).
    pub fair_catch: bool,
    /// Ball carrier: hurdle / truck (edge-triggered).
    pub hurdle: bool,
    pub truck: bool,
}

pub struct PlaySetup<'a> {
    pub off_team: u8,
    pub dir: f32,
    pub los_x: f32,
    pub ball_y: f32,
    pub first_down_x: f32,
    pub off_play: usize,
    pub def_play: usize,
    pub teams: &'a [Team; 2],
    pub user_team: Option<u8>,
    pub user_def_slot: usize,
    pub snap_delay: f32,
    /// Penalty frequency multiplier (0 = off, 1 = normal).
    pub penalty_rate: f32,
}

pub struct Play {
    pub actors: Vec<Actor>,
    pub ball: Ball,
    pub off_team: u8,
    pub dir: f32,
    pub los_x: f32,
    pub ball_y: f32,
    pub first_down_x: f32,
    pub kind: PlayKind,
    pub off_play: usize,
    pub def_play: usize,
    pub phase: PlayPhase,
    pub t: f32,
    pub over_t: f32,
    pub snap_delay: f32,
    pub user_team: Option<u8>,
    pub user: Option<usize>,
    pub user_touched: bool,
    pub handoff: bool,
    pub thrown: bool,
    pub scramble: bool,
    pub carrier: Option<usize>,
    pub poss_team: u8,
    pub drop_time: f32,
    pub route_actors: Vec<usize>,
    pub int_in_endzone: bool,
    pub thrower_name: String,
    pub target_name: String,
    pub last_tackler: Option<usize>,
    pub result: Option<PlayResult>,
    pub events: Vec<Event>,
    pub idle_t: f32,
    /// Where the ball was caught (for air yards vs yards after catch).
    pub catch_spot: Option<V2>,
    /// Who takes the handoff on a run (RB, or SL for a fullback dive).
    pub handoff_to: usize,
    /// The ball is pitched (toss) rather than handed off.
    pub pitch: bool,
    pub screen: bool,
    pub flags: Vec<Flag>,
    pub penalty_rate: f32,
    /// Special-teams state (kickoff, punt, field goal).
    pub special: Option<crate::special::SpecialPlay>,
    /// Kick parameters from the user's kick meter, waiting to be used.
    pub kick_input: Option<KickParams>,
    pub fair_catch_signal: bool,
    /// Ragdoll physics world (created on the first tackle of the play).
    pub physics: Option<Box<Physics>>,
    /// Defenders currently wrapped up on the ball carrier.
    pub wraps: Vec<usize>,
    /// Ball carrier's balance while wrapped (falls at 0).
    pub balance: f32,
    /// The carrier is going down (ragdoll) and the play ends when he's down by contact.
    pub falling: bool,
    pub fall_sack: bool,
    pub fumble: bool,
    pub fumble_vel: V3,
    pub fumble_t: f32,
    pub fumble_team: u8,
    pub fumble_lost: bool,
    pub user_rush: Option<RushMove>,
}

fn off_roster(team: &Team, slot: OSlot, f: &Formation) -> usize {
    use OSlot::*;
    let pick = |p: Pick| team.starter(p.0, p.1);
    match slot {
        LT => team.starter(Pos::OL, 0),
        LG => team.starter(Pos::OL, 1),
        C => team.starter(Pos::OL, 2),
        RG => team.starter(Pos::OL, 3),
        RT => team.starter(Pos::OL, 4),
        OSlot::QB => team.starter(Pos::QB, 0),
        OSlot::RB => pick(f.rb),
        OSlot::TE => pick(f.te),
        X => pick(f.x),
        Z => pick(f.z),
        SL => pick(f.sl),
    }
}

fn def_roster(team: &Team, slot: DSlot, dp: &DefPlay) -> usize {
    use DSlot::*;
    match slot {
        LE => team.starter(Pos::DL, 0),
        LDT => team.starter(Pos::DL, 1),
        RDT => team.starter(Pos::DL, 2),
        RE => team.starter(Pos::DL, 3),
        WLB => team.starter(dp.wlb.0, dp.wlb.1),
        MLB => team.starter(Pos::LB, 1),
        CB1 => team.starter(Pos::CB, 0),
        CB2 => team.starter(Pos::CB, 1),
        NB => team.starter(dp.nb.0, dp.nb.1),
        FS => team.starter(Pos::S, 0),
        SS => team.starter(Pos::S, 1),
    }
}

/// Roster index for special-teams roles, avoiding players already used.
pub(crate) fn pick_unused(team: &Team, wants: &[(Pos, usize)], used: &mut Vec<usize>) -> usize {
    for &(pos, depth) in wants {
        let i = team.starter(pos, depth);
        if team.players[i].pos == pos && !used.contains(&i) {
            used.push(i);
            return i;
        }
    }
    // Fallback: any unused non-kicker.
    let i = (0..team.players.len())
        .find(|i| !used.contains(i) && !matches!(team.players[*i].pos, Pos::K | Pos::P))
        .unwrap_or(0);
    used.push(i);
    i
}

pub(crate) fn seek(from: V2, to: V2, speed: f32) -> V2 {
    (to - from).norm() * speed
}

pub(crate) fn arrive(from: V2, to: V2, speed: f32) -> V2 {
    let d = to - from;
    let dist = d.len();
    if dist < 0.08 {
        V2::ZERO
    } else {
        d / dist * speed.min(dist * 2.5)
    }
}

/// Solve the launch velocity for a throw that leaves `from` (height `z0`) and arrives at
/// `to` (height `z1`) after `t` seconds under gravity.
pub fn solve_throw(from: V2, z0: f32, to: V2, z1: f32, t: f32) -> V3 {
    let d = to - from;
    let vz = (z1 - z0 + 0.5 * GRAVITY * t * t) / t;
    V3::new(d.x / t, d.y / t, vz)
}

impl Play {
    pub fn new(s: PlaySetup, rng: &mut Rng) -> Play {
        let op = &OFFENSE[s.off_play];
        let dp = &DEFENSE[s.def_play];
        let f = op.formation;
        let dir = s.dir;
        let dirv = V2::new(dir, 0.0);
        let los_x = s.los_x;
        let ball_y = s.ball_y;
        let to_world = |d: f32, l: f32| -> V2 {
            V2::new(los_x + dir * d, clamp(ball_y + dir * l, 0.6, FIELD_W - 0.6))
        };
        let off_face = if dir > 0.0 { 0.0 } else { std::f32::consts::PI };
        let def_face = if dir > 0.0 { std::f32::consts::PI } else { 0.0 };

        let ot = &s.teams[s.off_team as usize];
        let dteam = 1 - s.off_team;
        let dt = &s.teams[dteam as usize];

        let mut actors = Vec::with_capacity(N);
        let mut drop_time = 1.0;
        for (k, slot) in OSLOTS.iter().enumerate() {
            let (d, l) = f.spots[k];
            let p = to_world(d, l);
            let ri = off_roster(ot, *slot, f);
            let task = match slot {
                OSlot::QB => {
                    let (drop_to, mesh) = match op.kind {
                        PlayKind::Pass { drop, play_action, boot, .. } => {
                            let depth = if f.under_center { drop } else { 5.0 + drop };
                            drop_time = 0.35 + drop * 0.22;
                            let mesh = if play_action { Some(to_world(-3.0, 0.3)) } else { None };
                            if play_action {
                                drop_time += 0.45;
                            }
                            if boot != 0.0 {
                                // Bootleg: roll out toward the boot side.
                                drop_time += 0.3;
                                (to_world(-depth.min(6.0), boot), mesh)
                            } else {
                                (to_world(-depth, 0.0), mesh)
                            }
                        }
                        PlayKind::Run { hole_l, carrier: OSlot::QB, .. } => (to_world(1.0, hole_l), None),
                        PlayKind::Run { hole_l, toss: true, .. } => (to_world(-2.0, hole_l * 0.2), None),
                        PlayKind::Run { hole_l, .. } => {
                            if f.under_center {
                                (to_world(-3.0, hole_l * 0.15), None)
                            } else {
                                (to_world(-5.0, 0.0), None)
                            }
                        }
                        _ => (p, None),
                    };
                    Task::Qb { drop_to, mesh }
                }
                OSlot::LT | OSlot::LG | OSlot::C | OSlot::RG | OSlot::RT => {
                    let home = match op.kind {
                        PlayKind::Run { .. } => p + dirv * 1.0,
                        _ => p - dirv * 1.3,
                    };
                    Task::Block { home }
                }
                _ => Task::Block { home: p - dirv * 0.6 },
            };
            let mut a = Actor::new(s.off_team, k as u8, ri, &ot.players[ri], p, off_face, task);
            a.anim = Anim::Stance;
            actors.push(a);
        }

        // Runs: ball-carrier path, everyone else blocks (receivers stalk downfield).
        let mut route_actors = Vec::new();
        let mut handoff_to = RB;
        let mut pitch = false;
        let mut screen = false;
        match op.kind {
            PlayKind::Run { hole_l, delay, carrier, toss, counter } => {
                for &i in &[OSlot::TE as usize, OSlot::X as usize, OSlot::Z as usize, OSlot::SL as usize, RB] {
                    let home = actors[i].p + dirv * if i == RB || i == OSlot::SL as usize { 1.5 } else { 3.0 };
                    actors[i].task = Task::Block { home };
                }
                match carrier {
                    OSlot::QB => {
                        handoff_to = QB;
                    }
                    _ => {
                        let c = carrier as usize;
                        handoff_to = c;
                        let start = actors[c].p;
                        let mut pts = Vec::new();
                        if counter {
                            pts.push(start + V2::new(0.0, -dir * hole_l.signum() * 1.8));
                        }
                        if toss {
                            pitch = true;
                            pts.push(to_world(-5.0, hole_l * 0.55));
                        } else if c == OSlot::SL as usize {
                            pts.push(to_world(-2.4, hole_l * 0.4));
                        } else if f.under_center {
                            pts.push(to_world(-3.4, hole_l * 0.2));
                        } else {
                            pts.push(to_world(-4.3, -0.2));
                        }
                        pts.push(to_world(0.3, hole_l));
                        pts.push(to_world(5.0, hole_l * 1.15));
                        actors[c].task = Task::RunPath { pts, idx: 0, delay };
                    }
                }
            }
            PlayKind::Pass { play_action, screen: scr, .. } => {
                screen = scr;
                if play_action {
                    let mesh = to_world(-3.2, 0.6);
                    actors[RB].task = Task::RunPath { pts: vec![mesh, to_world(-0.5, -1.5)], idx: 0, delay: 0.0 };
                }
                for &(slot, route, mirror) in op.routes {
                    let i = slot as usize;
                    let (_, l) = f.spots[i];
                    let side = if l >= 0.0 { 1.0 } else { -1.0 } * if mirror { -1.0 } else { 1.0 };
                    let start = actors[i].p;
                    let def = route_def(route);
                    let pts: Vec<V2> = def
                        .pts
                        .iter()
                        .map(|&(rd, out)| {
                            let w = start + V2::new(dir * rd, dir * side * out);
                            V2::new(w.x, clamp(w.y, 1.0, FIELD_W - 1.0))
                        })
                        .collect();
                    actors[i].task = Task::Route { pts, idx: 0, sit: def.sit, delay: def.delay, home: start - dirv * 0.5 };
                    actors[i].icon = ELIGIBLE.iter().position(|e| *e == slot).map(|p| p as u8 + 1).unwrap_or(0);
                    route_actors.push(i);
                }
            }
            _ => {}
        }

        for (k, slot) in DSLOTS.iter().enumerate() {
            let p = match dp.align[k] {
                Align::At(d, l) => to_world(d, l),
                Align::Over(os, d) => {
                    let (_, ol) = f.spots[os as usize];
                    to_world(d, ol)
                }
            };
            let ri = def_roster(dt, *slot, dp);
            let task = match dp.assign[k] {
                DAssign::Rush => {
                    let lane = match slot {
                        DSlot::LE => dir * 2.5,
                        DSlot::RE => -dir * 2.5,
                        _ => 0.0,
                    };
                    Task::Rush { lane }
                }
                DAssign::Man(os) => Task::Man { target: os as usize },
                DAssign::Zone(d, l) => Task::Zone { spot: to_world(d, l), deep: d >= 14.0 },
                DAssign::RunFit(l) => Task::RunFit { spot: to_world(4.5, l) },
            };
            let mut a = Actor::new(dteam, k as u8, ri, &dt.players[ri], p, def_face, task);
            a.anim = if matches!(slot, DSlot::LE | DSlot::LDT | DSlot::RDT | DSlot::RE) { Anim::Stance } else { Anim::Idle };
            actors.push(a);
        }

        let user = match s.user_team {
            Some(u) if u == s.off_team => Some(QB),
            Some(_) => Some(11 + s.user_def_slot.min(10)),
            None => None,
        };

        // Coverage disguise: show a different safety shell before the snap, then rotate.
        if rng.chance(0.4) {
            let fs = 11 + DSlot::FS as usize;
            let ss = 11 + DSlot::SS as usize;
            let single_high = matches!(actors[fs].task, Task::Zone { deep: true, .. }) && !matches!(actors[ss].task, Task::Zone { deep: true, .. });
            if single_high {
                actors[fs].p = to_world(13.0, 9.0);
                actors[ss].p = to_world(13.0, -9.0);
            } else {
                actors[ss].p = to_world(7.5, -5.0);
                actors[fs].p = to_world(15.0, 0.0);
            }
        }
        Play {
            actors,
            ball: Ball::Loose(V3::new(los_x, ball_y, 0.15)),
            off_team: s.off_team,
            dir,
            los_x,
            ball_y,
            first_down_x: s.first_down_x,
            kind: op.kind,
            off_play: s.off_play,
            def_play: s.def_play,
            phase: PlayPhase::PreSnap,
            t: 0.0,
            over_t: 0.0,
            snap_delay: s.snap_delay,
            user_team: s.user_team,
            user,
            user_touched: false,
            handoff: false,
            thrown: false,
            scramble: false,
            carrier: None,
            poss_team: s.off_team,
            drop_time,
            route_actors,
            int_in_endzone: false,
            thrower_name: String::new(),
            target_name: String::new(),
            last_tackler: None,
            result: None,
            events: Vec::new(),
            idle_t: 0.0,
            catch_spot: None,
            handoff_to,
            pitch,
            screen,
            flags: Vec::new(),
            penalty_rate: s.penalty_rate,
            special: None,
            kick_input: None,
            fair_catch_signal: false,
            physics: None,
            wraps: Vec::new(),
            balance: 1.0,
            falling: false,
            fall_sack: false,
            fumble: false,
            fumble_vel: V3::default(),
            fumble_t: 0.0,
            fumble_team: 0,
            fumble_lost: false,
            user_rush: None,
        }
    }

    /// An empty play (no actors) used as a starting point by other constructors.
    pub fn empty() -> Play {
        Play {
            actors: Vec::new(),
            ball: Ball::Loose(V3::default()),
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
            handoff_to: RB,
            pitch: false,
            screen: false,
            flags: Vec::new(),
            penalty_rate: 1.0,
            special: None,
            kick_input: None,
            fair_catch_signal: false,
            physics: None,
            wraps: Vec::new(),
            balance: 1.0,
            falling: false,
            fall_sack: false,
            fumble: false,
            fumble_vel: V3::default(),
            fumble_t: 0.0,
            fumble_team: 0,
            fumble_lost: false,
            user_rush: None,
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    pub fn team_dir(&self, team: u8) -> f32 {
        if team == self.off_team {
            self.dir
        } else {
            -self.dir
        }
    }

    pub(crate) fn dirv(&self) -> V2 {
        V2::new(self.dir, 0.0)
    }

    pub(crate) fn user_is_offense(&self) -> bool {
        self.user_team == Some(self.off_team)
    }

    pub(crate) fn is_pass(&self) -> bool {
        matches!(self.kind, PlayKind::Pass { .. })
    }

    fn play_action(&self) -> bool {
        matches!(self.kind, PlayKind::Pass { play_action: true, .. })
    }

    pub(crate) fn ball_holder(&self) -> Option<usize> {
        match self.ball {
            Ball::Held(i) => Some(i),
            _ => None,
        }
    }

    /// Where the "action" is: ball carrier, QB, or the thrown ball's target.
    pub(crate) fn focus(&self) -> V2 {
        match &self.ball {
            Ball::Held(i) => self.actors[*i].p,
            Ball::Air { target, .. } => *target,
            Ball::Loose(p) => p.xy(),
        }
    }

    /// QB still in the pocket with the ball (not yet a runner).
    pub(crate) fn qb_in_pocket(&self) -> bool {
        self.ball_holder() == Some(QB) && !self.scramble && self.poss_team == self.off_team
    }

    pub fn ball_pos(&self) -> V3 {
        match &self.ball {
            Ball::Held(i) => {
                let a = &self.actors[*i];
                if a.ragdoll {
                    if let Some(b) = self.ragdoll_ball(*i) {
                        return b;
                    }
                }
                // Carried high and tight against the chest (the renderer puts it in the
                // carrying arm; this is the point the camera and loose balls use).
                let f = a.facing_v();
                let h = if a.anim == Anim::Down { 0.35 } else if a.anim == Anim::Throw { 1.9 } else { 1.45 };
                V3::new(a.p.x + f.x * 0.2, a.p.y + f.y * 0.2, a.z + h)
            }
            Ball::Air { pos, .. } => *pos,
            Ball::Loose(p) => *p,
        }
    }

    /// Throw a flag on actor `who` (the fouling player).
    pub(crate) fn throw_flag(&mut self, foul: Foul, who: usize, spot: V2) {
        let a = &self.actors[who];
        self.flags.push(Flag { foul, team: a.team, spot, player: format!("#{} {}", a.number, a.name) });
        self.events.push(Event::Flag { x: spot.x, y: spot.y });
    }

    /// On a screen, linemen pass-set briefly, then let rushers through and release.
    /// Defensive holding: a man-cover defender riding a receiver early in the route.
    fn coverage_holding(&mut self, dt: f32, rng: &mut Rng) {
        if !self.flags.is_empty() || !self.qb_in_pocket() || !self.is_pass() || self.t < 0.5 || self.t > 3.0 {
            return;
        }
        for i in 11..N {
            if let Task::Man { target } = self.actors[i].task {
                let d = self.actors[i].p.dist(self.actors[target].p);
                if d < 0.9 && matches!(self.actors[target].task, Task::Route { .. }) {
                    let cov = self.actors[i].r.coverage as f32;
                    let hazard = 0.006 * self.penalty_rate * (1.4 - cov / 140.0);
                    if rng.chance(hazard * dt) {
                        let spot = self.actors[i].p;
                        self.throw_flag(Foul::DefensiveHolding, i, spot);
                        return;
                    }
                }
            }
        }
    }

    pub(crate) fn screen_releasing(&self, i: usize) -> bool {
        self.screen && i < 5 && self.t > 0.9 && !matches!(self.ball, Ball::Held(c) if c != QB)
    }

    pub(crate) fn set_react_all(&mut self, carrier_team: u8) {
        for a in self.actors.iter_mut() {
            let aw = a.r.awareness as f32;
            a.react = if a.team == carrier_team { 0.05 } else { 0.12 + (99.0 - aw) * 0.005 };
        }
    }

    // -----------------------------------------------------------------------
    // Step
    // -----------------------------------------------------------------------

    pub fn step(&mut self, dt: f32, input: &Input, rng: &mut Rng) {
        self.t += dt;
        match self.phase {
            PlayPhase::PreSnap if self.special.is_some() => self.special_presnap(input, rng),
            PlayPhase::PreSnap => self.step_presnap(input),
            PlayPhase::Live => self.step_live(dt, input, rng),
            PlayPhase::Over => self.step_over(dt),
        }
    }

    fn step_presnap(&mut self, input: &Input) {
        let user_off = self.user_is_offense();
        if !user_off && input.switch {
            if let Some(u) = self.user {
                // Cycle through defenders.
                let next = if u + 1 >= N { 11 } else { u + 1 };
                self.user = Some(next.max(11));
            }
        }
        let snap = if user_off { input.action } else { self.t >= self.snap_delay };
        if snap {
            self.phase = PlayPhase::Live;
            self.t = 0.0;
            self.ball = Ball::Held(QB);
            self.carrier = Some(QB);
            for a in self.actors.iter_mut() {
                a.anim = Anim::Run;
            }
            self.events.push(Event::Snap);
        }
    }

    fn step_over(&mut self, dt: f32) {
        self.over_t += dt;
        self.physics_step(dt);
        for a in self.actors.iter_mut() {
            if a.ragdoll {
                continue;
            }
            a.v = a.v * (1.0 - (4.0 * dt).min(1.0));
            a.p += a.v * dt;
            if a.ground > 0.0 {
                a.ground -= dt;
            }
            if a.anim != Anim::Down && a.anim != Anim::Celebrate {
                a.anim = if a.v.len() > 0.6 { Anim::Run } else { Anim::Idle };
            }
            if a.anim == Anim::Down && a.ground <= 0.0 && self.over_t > 1.0 {
                a.anim = Anim::Idle;
            }
            a.z = 0.0;
        }
    }

    fn step_live(&mut self, dt: f32, input: &Input, rng: &mut Rng) {
        // 1. Timers.
        for a in self.actors.iter_mut() {
            a.stun = (a.stun - dt).max(0.0);
            a.ground = (a.ground - dt).max(0.0);
            a.move_cd = (a.move_cd - dt).max(0.0);
            a.tackle_cd = (a.tackle_cd - dt).max(0.0);
            a.bite = (a.bite - dt).max(0.0);
            a.rush_cd = (a.rush_cd - dt).max(0.0);
            a.stagger = (a.stagger - dt).max(0.0);
            a.shed_cd = (a.shed_cd - dt).max(0.0);
            a.grip_off = (a.grip_off - dt).max(0.0);
            a.drive_boost = (a.drive_boost - dt).max(0.0);
            if a.move_t > 0.0 {
                a.move_t -= dt;
                if a.move_t <= 0.0 {
                    if a.mv == Move::Dive {
                        a.ground = 0.9;
                        a.anim = Anim::Down;
                    }
                    a.mv = Move::None;
                    a.z = 0.0;
                }
            }
            if a.ball_react > 0.0 {
                a.ball_react = (a.ball_react - dt).max(0.0);
            }
        }

        // 2. Reactions (recognising a run or a catch).
        let carrier_team = self.carrier.map(|c| self.actors[c].team);
        for i in 0..N {
            if self.actors[i].react > 0.0 {
                self.actors[i].react -= dt;
                if self.actors[i].react <= 0.0 {
                    self.actors[i].react = 0.0;
                    if Some(i) == self.carrier {
                        continue;
                    }
                    let a = &mut self.actors[i];
                    match carrier_team {
                        Some(ct) if a.team != ct => a.task = Task::Pursue,
                        Some(_) => {
                            if !matches!(a.task, Task::Block { .. }) || a.team != self.off_team {
                                a.task = Task::Escort;
                            }
                        }
                        None => {}
                    }
                }
            }
        }

        // 3. User actions.
        if input.fair_catch {
            self.fair_catch_signal = true;
        }
        self.user_actions(input, rng);

        // 4. Ball handling: kicks for special teams; handoffs, QB decisions, scrambles otherwise.
        if self.special.is_some() {
            self.special_live(dt, input, rng);
            if self.phase != PlayPhase::Live {
                self.update_anims();
                return;
            }
        } else {
            self.ball_logic(rng);
        }

        // 5. Movement.
        let mut desired = [V2::ZERO; N];
        for (i, d) in desired.iter_mut().enumerate() {
            *d = self.desire(i, input);
        }
        self.cpu_carrier_moves(dt, rng);
        for (i, d) in desired.iter().enumerate() {
            self.integrate(i, *d, dt);
        }
        self.advance_routes();

        // 6. Blocking.
        self.blocking(dt, rng);

        // 7. Collisions.
        self.puck_collisions();

        // 8. Ball flight and catches. A fumble in the air is not a pass or a kick: the
        // contact step bounces it and decides who recovers it.
        if !self.fumble {
            if self.special.is_some() {
                self.special_flight(dt, rng);
            } else {
                self.ball_flight(dt, rng);
                self.coverage_holding(dt, rng);
            }
        }

        // 9. Contact: tackles, wrap-ups, ragdolls, fumbles.
        self.physics_step(dt);
        if self.phase == PlayPhase::Live {
            self.contact_step(dt, rng);
        }

        // 10. Score / boundaries.
        if self.phase == PlayPhase::Live {
            self.boundaries();
        }

        // Safety valve: nothing happening for a long time ends the play.
        if self.phase == PlayPhase::Live {
            let waiting = self.carrier.is_none() && !matches!(self.ball, Ball::Air { .. }) && self.special.is_none();
            self.idle_t = if waiting { self.idle_t + dt } else { 0.0 };
            if self.t > 25.0 || self.idle_t > 1.0 {
                let spot = self.ball_pos().xy();
                let ct = self.poss_team;
                self.end_play(EndKind::Down, spot, ct, "Play blown dead.".into());
            }
        }

        // Animation states.
        self.update_anims();
    }

    // -----------------------------------------------------------------------
    // User
    // -----------------------------------------------------------------------

    fn user_actions(&mut self, input: &Input, rng: &mut Rng) {
        let Some(u) = self.user else { return };
        let ut = self.user_team.unwrap_or(0);
        if input.mx.abs() + input.my.abs() > 0.1 {
            self.user_touched = true;
        }
        let user_has_ball = self.carrier.map(|c| self.actors[c].team) == Some(ut);

        if input.switch && !user_has_ball {
            // Switch to the teammate closest to the ball.
            let f = self.focus();
            let best = (0..N)
                .filter(|&j| j != u && self.actors[j].team == ut && self.actors[j].upright())
                .min_by(|&a, &b| self.actors[a].p.dist(f).partial_cmp(&self.actors[b].p.dist(f)).unwrap());
            if let Some(b) = best {
                self.user = Some(b);
                self.user_touched = false;
            }
        }

        let u = self.user.unwrap_or(u);
        let hint = V2::new(input.mx, input.my);
        if self.carrier == Some(u) && !self.qb_in_pocket() {
            if input.action {
                self.start_move(u, Move::Juke, hint, rng);
            } else if input.spin {
                self.start_move(u, Move::Spin, hint, rng);
            } else if input.stiff {
                self.start_move(u, Move::Stiff, hint, rng);
            } else if input.hurdle {
                self.start_move(u, Move::Hurdle, hint, rng);
            } else if input.truck {
                self.start_move(u, Move::Truck, hint, rng);
            }
        } else if !user_has_ball && self.actors[u].engaged.is_some() {
            // Engaged with a blocker: pass-rush moves.
            if input.action {
                self.user_rush = Some(RushMove::Swim);
            } else if input.spin {
                self.user_rush = Some(RushMove::Spin);
            } else if input.stiff {
                self.user_rush = Some(RushMove::Bull);
            }
        } else if !user_has_ball && input.action && self.actors[u].mv == Move::None && self.actors[u].upright() {
            self.start_move(u, Move::Dive, hint, rng);
        }

        // Throws.
        if input.throw_to > 0 && self.user_is_offense() && self.qb_in_pocket() && !self.thrown && self.is_pass() && (!self.play_action() || self.t > 0.6) {
            if let Some(r) = (0..11).find(|&j| self.actors[j].icon == input.throw_to) {
                // Placement: the stick direction at release leads / back-shoulders the throw.
                self.throw_to(r, input.throw_kind.min(2), V2::new(input.mx, input.my), rng);
            }
        }
    }

    fn start_move(&mut self, i: usize, mv: Move, hint: V2, rng: &mut Rng) {
        // The nearest opponent decides which way to juke when there is no input.
        let near = self.nearest_opponent(i, true).map(|j| self.actors[j].p);
        let a = &mut self.actors[i];
        if a.move_cd > 0.0 || a.mv != Move::None || !a.upright() {
            return;
        }
        let fwd = if a.v.len() > 0.5 { a.v.norm() } else { a.facing_v() };
        match mv {
            Move::Juke => {
                let perp = fwd.perp();
                let side = if hint.len() > 0.2 {
                    if hint.dot(perp) >= 0.0 { 1.0 } else { -1.0 }
                } else if let Some(np) = near {
                    if (np - a.p).dot(perp) > 0.0 { -1.0 } else { 1.0 }
                } else if rng.chance(0.5) {
                    1.0
                } else {
                    -1.0
                };
                // The cut itself happens in `integrate`: a short, explosive lateral
                // acceleration of the puck, so momentum carries through it.
                a.mv_dir = perp * side;
                a.mv = Move::Juke;
                a.move_t = 0.35;
                a.move_cd = 0.9;
                self.events.push(Event::Juke);
            }
            Move::Spin => {
                a.v = a.v * 0.85;
                a.mv = Move::Spin;
                a.move_t = 0.5;
                a.move_cd = 1.3;
                self.events.push(Event::Spin);
            }
            Move::Stiff => {
                a.mv = Move::Stiff;
                a.move_t = 0.55;
                a.move_cd = 1.2;
                self.events.push(Event::StiffArm);
            }
            Move::Dive => {
                let d = if hint.len() > 0.2 { hint.norm() } else { fwd };
                a.v = d * (a.v.len() + 2.5).max(4.5);
                a.mv = Move::Dive;
                a.move_t = 0.4;
                a.move_cd = 1.0;
            }
            Move::Hurdle => {
                a.mv = Move::Hurdle;
                a.move_t = 0.55;
                a.move_cd = 1.4;
                self.events.push(Event::Hurdle);
            }
            Move::Truck => {
                a.mv = Move::Truck;
                a.move_t = 0.5;
                a.move_cd = 1.1;
            }
            Move::None => {}
        }
    }

    fn cpu_carrier_moves(&mut self, dt: f32, rng: &mut Rng) {
        let Some(c) = self.carrier else { return };
        if self.user == Some(c) || self.qb_in_pocket() {
            return;
        }
        let a = &self.actors[c];
        if a.move_cd > 0.0 || a.mv != Move::None {
            return;
        }
        let fwd = a.v.norm();
        let threat = (0..N).any(|j| {
            let o = &self.actors[j];
            o.team != a.team && o.upright() && o.engaged.is_none() && {
                let rel = o.p - a.p;
                rel.len() < 2.2 && rel.norm().dot(fwd) > 0.4
            }
        });
        if threat && rng.chance(dt * 3.0) {
            let roll = rng.f32();
            let ag = a.r.agility as f32 / 99.0;
            let st = a.r.strength as f32 / 99.0;
            let mv = if roll < 0.45 * ag {
                Move::Juke
            } else if roll < 0.45 * ag + 0.35 * st {
                Move::Stiff
            } else if roll < 0.45 * ag + 0.35 * st + 0.2 {
                Move::Spin
            } else {
                Move::None
            };
            if mv != Move::None {
                self.start_move(c, mv, V2::ZERO, rng);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Ball logic
    // -----------------------------------------------------------------------

    fn ball_logic(&mut self, rng: &mut Rng) {
        let Some(h) = self.ball_holder() else { return };

        // Handoff or play-action fake.
        if h == QB && !self.handoff && self.poss_team == self.off_team {
            let hb = self.handoff_to;
            let near = self.actors[QB].p.dist(self.actors[hb].p) < 1.15;
            match self.kind {
                PlayKind::Run { carrier: OSlot::QB, .. } if self.t > 0.2 => {
                    // QB sneak / keeper.
                    self.handoff = true;
                    self.scramble = true;
                    self.actors[QB].task = Task::Carrier;
                    self.set_react_all(self.off_team);
                }
                PlayKind::Run { toss: true, .. } if self.t > 0.32 => {
                    // Pitch: a short lateral the back almost never drops.
                    self.handoff = true;
                    let target = self.actors[hb].p + self.actors[hb].v * 0.35;
                    self.target_name = self.actors[hb].name.clone();
                    self.throw_at(target, Some(hb), 1, rng);
                    self.thrown = false; // a pitch is a run, not a pass
                    self.events.push(Event::Handoff);
                }
                PlayKind::Run { delay, toss: false, .. } if hb != QB && near && self.t > 0.3 + delay => {
                    self.handoff = true;
                    self.ball = Ball::Held(hb);
                    self.carrier = Some(hb);
                    self.actors[hb].task = Task::Carrier;
                    self.actors[QB].task = Task::Idle;
                    if self.user == Some(QB) {
                        self.user = Some(hb);
                    }
                    self.events.push(Event::Handoff);
                    self.set_react_all(self.off_team);
                }
                PlayKind::Run { delay, .. } if self.t > 1.6 + delay => {
                    // The mesh never happened: the QB keeps it.
                    self.handoff = true;
                    self.scramble = true;
                    self.actors[QB].task = Task::Carrier;
                    self.actors[hb].task = Task::Escort;
                    self.set_react_all(self.off_team);
                }
                PlayKind::Pass { play_action: true, .. } if near && self.t > 0.3 => {
                    self.handoff = true; // the fake is "done"
                    self.events.push(Event::PlayAction);
                    for j in 11..N {
                        let a = &mut self.actors[j];
                        if matches!(a.task, Task::Zone { .. } | Task::RunFit { .. } | Task::Man { .. }) && a.pos != Pos::CB {
                            let fool = 1.0 - a.r.awareness as f32 / 110.0;
                            if rng.chance(fool + 0.15) {
                                a.bite = 0.35 + fool * 0.5;
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // QB scrambles past the line: he's a runner now.
        if h == QB && !self.scramble && self.poss_team == self.off_team {
            let past = (self.actors[QB].p.x - self.los_x) * self.dir > 0.4;
            if past {
                self.scramble = true;
                self.actors[QB].task = Task::Carrier;
                self.set_react_all(self.off_team);
            }
        }

        // CPU quarterback.
        if h == QB && !self.user_is_offense() && self.qb_in_pocket() && !self.thrown && self.is_pass() {
            self.cpu_qb(rng);
        }
    }

    /// How open receiver `r` will be when a ball arrives.
    fn separation(&self, r: usize) -> f32 {
        let qb = &self.actors[QB];
        let a = &self.actors[r];
        let dist = qb.p.dist(a.p);
        let t = dist / 20.0 + 0.2;
        let pred = a.p + a.v * t;
        let mut sep = f32::MAX;
        for j in 0..N {
            let o = &self.actors[j];
            if o.team == a.team || !o.upright() {
                continue;
            }
            let op = o.p + o.v * (t * 0.5);
            sep = sep.min(op.dist(pred));
            // Defender sitting in the throwing lane.
            let lane = pred - qb.p;
            let rel = o.p - qb.p;
            let along = rel.dot(lane.norm());
            if along > 2.0 && along < lane.len() - 1.0 {
                let lat = (rel - lane.norm() * along).len();
                sep = sep.min(lat * 1.6 + 0.4);
            }
        }
        sep
    }

    fn cpu_qb(&mut self, rng: &mut Rng) {
        if !self.actors[QB].upright() {
            return;
        }
        if self.t < self.drop_time {
            // Still in the fake or the drop: only a free rusher in his face hurries him.
            let hot = self.nearest_opponent(QB, true).map(|j| self.actors[j].p.dist(self.actors[QB].p)).unwrap_or(99.0);
            if hot > 2.2 || self.t < 0.8 {
                return;
            }
            let best = self.route_actors.iter().copied().map(|r| (r, self.separation(r))).max_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            if let Some((r, sep)) = best {
                if sep > 1.2 {
                    let kind = self.auto_throw_kind(r);
                    self.throw_to(r, kind, V2::ZERO, rng);
                }
            }
            return;
        }
        let pocket = self.t - self.drop_time;
        let reads = OFFENSE[self.off_play].reads;
        if reads.is_empty() || self.route_actors.is_empty() {
            return;
        }
        let pressure = self
            .nearest_opponent(QB, true)
            .map(|j| self.actors[j].p.dist(self.actors[QB].p))
            .unwrap_or(99.0);
        let awareness = self.actors[QB].r.awareness as f32;
        if pocket < 0.15 {
            return;
        }
        let cur = ((pocket / (0.85 - awareness * 0.003)) as usize).min(reads.len() - 1);
        let thresh = (4.2 - pocket * 0.85).max(1.5);

        let ready = |p: &Play, r: usize| -> bool {
            match &p.actors[r].task {
                Task::Route { delay, .. } => p.t > *delay + 0.3,
                _ => true,
            }
        };

        for &k in &reads[..=cur] {
            let r = self.route_actors[k.min(self.route_actors.len() - 1)];
            if ready(self, r) && self.separation(r) > thresh {
                let kind = self.auto_throw_kind(r);
                self.throw_to(r, kind, V2::ZERO, rng);
                return;
            }
        }
        // Feel the rush: a free rusher closing in hurries the throw, if the QB notices him
        // in time (aware quarterbacks feel it sooner).
        let feel = pressure < 2.8 && rng.chance((1.0 + 3.0 * awareness / 99.0) / 60.0);
        if feel || pocket > 4.0 {
            let best = self
                .route_actors
                .iter()
                .copied()
                .filter(|&r| ready(self, r))
                .map(|r| (r, self.separation(r)))
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            if let Some((r, sep)) = best {
                if sep > 1.7 {
                    let kind = self.auto_throw_kind(r);
                    self.throw_to(r, kind, V2::ZERO, rng);
                    return;
                }
            }
            if pocket > 2.4 && self.actors[QB].r.speed > 70 && pressure > 1.5 {
                // Scramble.
                self.actors[QB].task = Task::Carrier;
                self.scramble = true;
                self.set_react_all(self.off_team);
            } else if pocket > 4.8 || (pressure < 2.2 && rng.chance((0.8 + 2.4 * awareness / 99.0) / 60.0)) {
                // Sees the rusher in time (or not) and throws it away.
                // Throw it away out of bounds.
                let qb = self.actors[QB].p;
                let side = if qb.y < FIELD_W * 0.5 { -4.0 } else { FIELD_W + 4.0 };
                let target = V2::new(qb.x + self.dir * 14.0, side);
                self.throw_at(target, None, 1, rng);
            }
        }
    }

    fn auto_throw_kind(&self, r: usize) -> u8 {
        let d = self.actors[QB].p.dist(self.actors[r].p);
        if d > 26.0 {
            2
        } else if d > 13.0 {
            1
        } else {
            0
        }
    }

    /// The "bucket" throw: lead the receiver, keep the ball away from the closest
    /// defender, then add error from accuracy, distance and pressure.
    fn throw_to(&mut self, r: usize, kind: u8, place: V2, rng: &mut Rng) {
        let qb = &self.actors[QB];
        let power = 16.5 + qb.r.throw_power as f32 * 0.115;
        let hspeed = power * [0.97, 0.84, 0.68][kind as usize];
        let release = qb.p + qb.facing_v() * 0.3;
        let rc = &self.actors[r];

        // Lead: iterate on flight time.
        let mut target = rc.p;
        let mut t = 0.5;
        for _ in 0..5 {
            t = (target.dist(release) / hspeed).max(0.35);
            target = rc.p + rc.v * t;
        }
        // Keep it on the sideline side of out-breaking routes.
        target = V2::new(clamp(target.x, 0.5, FIELD_LEN - 0.5), clamp(target.y, 0.8, FIELD_W - 0.8));

        // Bucket: shade away from the nearest defender to the catch point.
        let acc = qb.r.throw_acc as f32;
        let nearest_def = (0..N)
            .filter(|&j| self.actors[j].team != qb.team && self.actors[j].upright())
            .min_by(|&a, &b| {
                self.actors[a].p.dist(target).partial_cmp(&self.actors[b].p.dist(target)).unwrap()
            });
        if let Some(dj) = nearest_def {
            let dp = self.actors[dj].p + self.actors[dj].v * (t * 0.6);
            let away = target - dp;
            let dist = away.len();
            if dist < 4.0 {
                let shade = (4.0 - dist) * 0.35 * (acc / 99.0);
                target += away.norm() * shade.min(1.3);
            }
        }

        // Error.
        let pressure = self
            .nearest_opponent(QB, true)
            .map(|j| self.actors[j].p.dist(qb.p))
            .unwrap_or(99.0);
        let dist = target.dist(release);
        let mut sigma = (100.0 - acc) * 0.013 + dist * 0.016 * (1.15 - acc / 99.0);
        if pressure < 2.5 {
            sigma += (2.5 - pressure) * 0.35;
        }
        if qb.v.len() > 2.5 {
            sigma += 0.4;
        }
        // User placement: up to ~2 yards in the stick direction.
        target += place.clamp_len(1.0) * 2.0;
        target += V2::new(rng.normal() * sigma, rng.normal() * sigma * 0.8);
        self.target_name = rc.name.clone();
        self.throw_at(target, Some(r), kind, rng);
    }

    fn throw_at(&mut self, target: V2, intended: Option<usize>, kind: u8, _rng: &mut Rng) {
        let qb = &self.actors[QB];
        let power = 16.5 + qb.r.throw_power as f32 * 0.115;
        let hspeed = power * [0.97, 0.84, 0.68][kind as usize];
        let release = qb.p + qb.facing_v() * 0.3;
        let t = (target.dist(release) / hspeed).max(0.3);
        let arrive_z = [1.3, 1.45, 1.6][kind as usize];
        let vel = solve_throw(release, RELEASE_Z, target, arrive_z, t);
        self.thrower_name = qb.name.clone();
        self.ball = Ball::Air { pos: V3::from_xy(release, RELEASE_Z), vel, target, intended, arrive: t, t: 0.0 };
        self.thrown = true;
        self.carrier = None;
        self.actors[QB].anim = Anim::Throw;
        self.actors[QB].task = Task::Idle;
        self.events.push(Event::Throw { kind });
        for j in 0..N {
            let a = &mut self.actors[j];
            a.tried_catch = false;
            if a.team != self.off_team {
                a.ball_react = 0.1 + (99.0 - a.r.awareness as f32) * 0.004;
            }
        }
        if let Some(r) = intended {
            if self.user_is_offense() {
                self.user = Some(r);
                self.user_touched = false;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Desired movement
    // -----------------------------------------------------------------------

    pub(crate) fn nearest_opponent(&self, i: usize, unengaged: bool) -> Option<usize> {
        let a = &self.actors[i];
        (0..N)
            .filter(|&j| {
                let o = &self.actors[j];
                o.team != a.team && o.upright() && (!unengaged || o.engaged.is_none())
            })
            .min_by(|&x, &y| self.actors[x].p.dist(a.p).partial_cmp(&self.actors[y].p.dist(a.p)).unwrap())
    }

    fn desire(&self, i: usize, input: &Input) -> V2 {
        let a = &self.actors[i];
        if !a.upright() || a.engaged.is_some() {
            return V2::ZERO;
        }
        // User control.
        if self.user == Some(i) {
            let is_carrier = self.carrier == Some(i) && !self.qb_in_pocket();
            if is_carrier || self.user_touched {
                let m = V2::new(input.mx, input.my).clamp_len(1.0);
                let sp = if input.sprint { a.top } else { a.top * 0.8 };
                return m * sp;
            }
        }
        if a.bite > 0.0 {
            return seek(a.p, V2::new(self.los_x, a.p.y), a.top * 0.7);
        }

        // Defenders break on a thrown ball: contest it if they can get there, otherwise
        // rally to where it will be caught so they can make the tackle.
        if let Ball::Air { target, arrive, t, .. } = &self.ball {
            if a.team != self.off_team && a.ball_react == 0.0 {
                let time_left = (arrive - t).max(0.05);
                let dist = a.p.dist(*target);
                let reach = a.top * (time_left + 0.35);
                let rusher = matches!(a.task, Task::Rush { .. });
                if dist < reach || (!rusher && dist < 22.0) || (rusher && dist < 9.0) {
                    // Aim a little past the catch point, toward the defense's goal, to cut off YAC.
                    let shade = V2::new(-self.dir * clamp(dist - reach, 0.0, 6.0) * 0.5, 0.0);
                    return seek(a.p, *target + shade, a.top);
                }
            }
        }

        match &a.task {
            Task::Stance | Task::Idle => {
                if self.carrier.is_some() && a.team != self.carrier.map(|c| self.actors[c].team).unwrap_or(a.team) {
                    return self.pursue(i);
                }
                V2::ZERO
            }
            Task::Qb { drop_to, mesh } => {
                if let Some(m) = mesh {
                    if self.t < 0.75 {
                        return arrive(a.p, *m, a.top * 0.7);
                    }
                }
                if self.qb_in_pocket() && self.is_pass() {
                    let mut v = arrive(a.p, *drop_to, a.top * 0.75);
                    if a.p.dist(*drop_to) < 0.6 {
                        // Climb / slide away from pressure.
                        if let Some(j) = self.nearest_opponent(i, true) {
                            let o = self.actors[j].p;
                            if o.dist(a.p) < 3.2 {
                                v = (a.p - o).norm() * (a.top * 0.45);
                            }
                        }
                    }
                    v
                } else {
                    arrive(a.p, *drop_to, a.top * 0.85)
                }
            }
            Task::Route { pts, idx, sit, delay, home } => {
                if let Ball::Air { target, intended: Some(r), arrive: at, t, .. } = &self.ball {
                    if *r == i {
                        let time_left = (at - t).max(0.05);
                        let need = a.p.dist(*target) / time_left;
                        return seek(a.p, *target, need.min(a.top).max(a.top * 0.5));
                    }
                }
                if self.t < *delay {
                    return self.block_desire(i, *home);
                }
                let speed = a.top * 0.94;
                if *idx < pts.len() {
                    seek(a.p, pts[*idx], speed)
                } else if *sit {
                    // Settle in a soft spot, drifting away from the closest defender.
                    let last = pts[pts.len() - 1];
                    let mut goal = last;
                    if let Some(j) = self.nearest_opponent(i, false) {
                        let o = self.actors[j].p;
                        if o.dist(a.p) < 3.0 {
                            goal = last + (last - o).norm() * 1.5;
                        }
                    }
                    arrive(a.p, goal, a.top * 0.4)
                } else {
                    let n = pts.len();
                    let dirn = if n >= 2 { (pts[n - 1] - pts[n - 2]).norm() } else { self.dirv() };
                    let mut d = dirn;
                    if a.p.y < 2.5 || a.p.y > FIELD_W - 2.5 {
                        d = V2::new(self.dir, 0.0);
                    }
                    d * speed
                }
            }
            Task::Block { home } => self.block_desire(i, *home),
            Task::RunPath { pts, idx, delay } => {
                if self.t < *delay {
                    return V2::ZERO;
                }
                if *idx < pts.len() {
                    let sp = if *idx == 0 { a.top * 0.72 } else { a.top };
                    seek(a.p, pts[*idx], sp)
                } else {
                    self.block_desire(i, a.p)
                }
            }
            Task::Rush { .. } => {
                if !self.qb_in_pocket() {
                    return self.pursue(i);
                }
                seek(a.p, self.rusher_aim(i), a.top)
            }
            Task::Man { target } => self.man_desire(i, *target),
            Task::Zone { spot, deep } => self.zone_desire(i, *spot, *deep),
            Task::RunFit { spot } => {
                if self.handoff && !self.is_pass() {
                    return self.pursue(i);
                }
                if self.t < 0.9 {
                    arrive(a.p, *spot, a.top * 0.6)
                } else {
                    let s = *spot + self.dirv() * 2.0;
                    self.zone_desire(i, s, false)
                }
            }
            Task::Pursue => self.pursue(i),
            Task::Carrier => self.carrier_desire(i),
            Task::Escort => self.escort_desire(i),
            Task::Hold { spot } => arrive(a.p, *spot, a.top * 0.85),
            Task::Cover { lane } => self.cover_desire(i, *lane),
            Task::ReturnBlock { home } => self.return_block_desire(i, *home),
            Task::Returner => self.returner_desire(i),
            Task::Fetch => seek(a.p, self.ball_pos().xy(), a.top),
        }
    }

    /// Where a pass rusher is heading: the quarterback, edge rushers arcing outside him.
    pub(crate) fn rusher_aim(&self, i: usize) -> V2 {
        let a = &self.actors[i];
        let qb = self.actors[QB].p;
        match a.task {
            Task::Rush { lane } => qb + V2::new(0.0, lane * clamp(a.p.dist(qb) / 6.0, 0.0, 1.0)),
            _ => qb,
        }
    }

    fn block_desire(&self, i: usize, home: V2) -> V2 {
        let a = &self.actors[i];
        if self.screen_releasing(i) {
            // Release and set up the convoy in front of the screen.
            let spot = match &self.actors[RB].task {
                Task::Route { pts, .. } => *pts.last().unwrap_or(&self.actors[RB].p),
                _ => self.actors[RB].p,
            };
            let lane = V2::new(0.0, (i as f32 - 2.0) * 1.3 * self.dir);
            return arrive(a.p, spot + self.dirv() * 3.5 + lane, a.top * 0.85);
        }
        let protect = match self.carrier {
            Some(c) if self.actors[c].team == a.team => self.actors[c].p,
            _ => self.actors[QB].p,
        };
        let run_blocking = !self.is_pass() || !self.qb_in_pocket();
        let range = if run_blocking { 7.0 } else { 4.5 };
        let mut best = None;
        let mut best_s = f32::MAX;
        for j in 0..N {
            let o = &self.actors[j];
            if o.team == a.team || !o.upright() || o.engaged.is_some() {
                continue;
            }
            let d = o.p.dist(a.p);
            if d > range {
                continue;
            }
            if !run_blocking && !matches!(o.task, Task::Rush { .. } | Task::Pursue) && d > 2.0 {
                continue;
            }
            let mut s = d + 0.5 * o.p.dist(protect);
            if !run_blocking {
                // Zone protection: leave a rusher to the teammate whose area he's in.
                let mate = (0..N)
                    .filter(|&k| k != i && self.actors[k].team == a.team && self.actors[k].engaged.is_none() && matches!(self.actors[k].task, Task::Block { .. }))
                    .map(|k| (self.actors[k].p.y - o.p.y).abs())
                    .fold(f32::MAX, f32::min);
                if mate + 0.4 < (a.p.y - o.p.y).abs() {
                    s += 6.0;
                }
            }
            if s < best_s {
                best_s = s;
                best = Some(j);
            }
        }
        if let Some(j) = best {
            let o = &self.actors[j];
            let reach = a.radius + o.radius;
            if run_blocking {
                let target = o.p + (protect - o.p).norm() * (reach * 0.95);
                return seek(a.p, target, a.top * 0.92);
            }
            // Pass pro: kick-slide to a spot on the rusher's path to the quarterback,
            // getting there before he does, so he runs into the blocker's puck.
            let target = self.intercept_point(i, j, self.rusher_aim(j));
            return seek(a.p, target, a.top * 0.9);
        }
        if run_blocking {
            seek(a.p, protect + self.dirv() * 4.0, a.top * 0.6)
        } else {
            arrive(a.p, home, a.top * 0.5)
        }
    }

    fn man_desire(&self, i: usize, target: usize) -> V2 {
        let a = &self.actors[i];
        let r = &self.actors[target];
        if (a.react == 0.0 || a.ball_react == 0.0) && self.carrier.is_some() && !self.qb_in_pocket() {
            return self.pursue(i);
        }
        if matches!(r.task, Task::Block { .. }) {
            // His man stayed in to block: sit in the hole and watch the QB.
            let spot = V2::new(self.los_x + self.dir * 5.0, a.p.y);
            return arrive(a.p, spot, a.top * 0.5);
        }
        let cov = a.r.coverage as f32;
        let lag = (0.3 - cov * 0.0022).max(0.06);
        let pred = r.p + r.v * (0.25 - lag);
        let cushion = clamp(1.6 - self.t * 0.35, 0.4, 1.6);
        let inside = clamp(self.ball_y - r.p.y, -1.0, 1.0) * 0.6;
        let goal = pred + self.dirv() * cushion + V2::new(0.0, inside);
        arrive(a.p, goal, a.top)
    }

    fn zone_desire(&self, i: usize, spot: V2, deep: bool) -> V2 {
        let a = &self.actors[i];
        if self.carrier.is_some() && !self.qb_in_pocket() && (a.react == 0.0 || a.ball_react == 0.0) {
            return self.pursue(i);
        }
        let radius = if deep { 13.0 } else { 8.0 };
        let qb = self.actors[QB].p;
        let mut threat: Option<usize> = None;
        let mut best = f32::MAX;
        for &r in &self.route_actors {
            let ra = &self.actors[r];
            let d = ra.p.dist(spot);
            if d > radius {
                continue;
            }
            let score = if deep { -(ra.p.x - self.los_x) * self.dir } else { d };
            if score < best {
                best = score;
                threat = Some(r);
            }
        }
        let goal = match threat {
            None => spot,
            Some(r) => {
                let ra = &self.actors[r];
                if deep {
                    let depth_x = ra.p.x + self.dir * 3.5;
                    let min_x = spot.x - self.dir * 4.0;
                    let x = if self.dir > 0.0 { depth_x.max(min_x) } else { depth_x.min(min_x) };
                    V2::new(x, spot.y + (ra.p.y - spot.y) * 0.7)
                } else {
                    let g = ra.p + (qb - ra.p).norm() * 1.4;
                    spot + (g - spot).clamp_len(radius * 0.8)
                }
            }
        };
        arrive(a.p, goal, a.top * 0.95)
    }

    pub(crate) fn pursue(&self, i: usize) -> V2 {
        let a = &self.actors[i];
        let target = match self.carrier {
            Some(c) => {
                let ca = &self.actors[c];
                // Solve for the intercept time: |carrier(t) - me| = my_speed * t.
                let rel = ca.p - a.p;
                let (vx, s) = (ca.v, a.top * 0.97);
                let qa = vx.len_sq() - s * s;
                let qb = 2.0 * rel.dot(vx);
                let qc = rel.len_sq();
                let t_hit = if qa.abs() < 1e-3 {
                    if qb < 0.0 { -qc / qb } else { 1.5 }
                } else {
                    let disc = qb * qb - 4.0 * qa * qc;
                    if disc < 0.0 {
                        1.5
                    } else {
                        let r1 = (-qb - disc.sqrt()) / (2.0 * qa);
                        let r2 = (-qb + disc.sqrt()) / (2.0 * qa);
                        let t = if r1 > 0.0 && (r1 < r2 || r2 <= 0.0) { r1 } else { r2 };
                        if t > 0.0 { t } else { 1.5 }
                    }
                };
                // Smarter players take better angles.
                let skill = 0.55 + a.r.awareness as f32 * 0.0045;
                ca.p + ca.v * (t_hit.min(3.0) * skill)
            }
            None => self.focus(),
        };
        seek(a.p, target, a.top)
    }

    fn carrier_desire(&self, i: usize) -> V2 {
        let a = &self.actors[i];
        let td = self.team_dir(a.team);
        let fwd = V2::new(td, 0.0);
        let mut best = fwd;
        let mut best_s = f32::MIN;
        for k in -7..=7 {
            let ang = k as f32 * 0.2;
            let (s, c) = ang.sin_cos();
            let d = V2::new(fwd.x * c - fwd.y * s, fwd.x * s + fwd.y * c);
            let mut score = c * 1.5;
            for j in 0..N {
                let o = &self.actors[j];
                if j == i || !o.upright() || o.ragdoll {
                    continue;
                }
                let rel = o.p - a.p;
                let along = rel.dot(d);
                let lat = (rel.x * d.y - rel.y * d.x).abs();
                if o.team == a.team {
                    // Teammates' pucks are physical too: find the crease between blockers.
                    if o.engaged.is_some() && along > 0.0 && along < 3.0 {
                        score -= 0.6 * (-(lat / 0.8).powi(2)).exp();
                    }
                    continue;
                }
                let w = if o.engaged.is_some() { 0.3 } else { 1.0 };
                if along > -1.5 && along < 10.0 {
                    score -= 2.4 * w * (-lat / 1.9).exp() * (1.0 - along.max(0.0) / 12.0);
                }
            }
            let ahead = a.p + d * 4.0;
            if ahead.y < 1.0 || ahead.y > FIELD_W - 1.0 {
                score -= 3.0;
            }
            if score > best_s {
                best_s = score;
                best = d;
            }
        }
        let cur = a.v.norm();
        let mut d = if cur.len_sq() > 0.0 { (best * 0.65 + cur * 0.35).norm() } else { best };
        // Run discipline: until he reaches the line, the back presses the play's hole
        // and only shades toward daylight; he cuts once he's there.
        if let PlayKind::Run { hole_l, .. } = self.kind {
            let behind = (self.los_x - a.p.x) * td;
            if i == self.handoff_to && a.team == self.off_team && behind > -0.5 && self.catch_spot.is_none() {
                let hole = V2::new(self.los_x + td * 1.5, clamp(self.ball_y + td * hole_l, 1.0, FIELD_W - 1.0));
                let to_hole = (hole - a.p).norm();
                let w = clamp((behind + 0.5) / 2.5, 0.0, 1.0) * 0.75;
                d = (to_hole * w + d * (1.0 - w)).norm();
            }
        }
        d * a.top
    }

    fn escort_desire(&self, i: usize) -> V2 {
        let a = &self.actors[i];
        let Some(c) = self.carrier else { return V2::ZERO };
        let cp = self.actors[c].p;
        // Returns develop over a long field: look for threats much farther out.
        let range = if self.special.is_some() { 22.0 } else { 9.0 };
        let mut best = None;
        let mut best_d = f32::MAX;
        for j in 0..N {
            let o = &self.actors[j];
            if o.team == a.team || !o.upright() || o.engaged.is_some() || o.ragdoll {
                continue;
            }
            let d = o.p.dist(cp);
            // Only threats I can still get in front of (not ones already past me).
            let ahead = (o.p - a.p).dot((o.p - cp).norm()) > -1.0;
            if d < range && ahead && d + o.p.dist(a.p) * 0.6 < best_d {
                best_d = d + o.p.dist(a.p) * 0.6;
                best = Some(j);
            }
        }
        match best {
            Some(j) => seek(a.p, self.intercept_point(i, j, cp), a.top),
            None => {
                let td = self.team_dir(a.team);
                seek(a.p, cp + V2::new(td * 3.0, 0.0), a.top * 0.85)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Integration
    // -----------------------------------------------------------------------

    fn integrate(&mut self, i: usize, desired: V2, dt: f32) {
        let is_carrier = self.carrier == Some(i);
        // Tacklers hanging on add their mass to the carrier's puck and pull against him.
        let (drag, brake) = if is_carrier && !self.wraps.is_empty() {
            let m = self.actors[i].mass;
            let hang: f32 = self.wraps.iter().map(|&w| self.actors[w].mass * 0.7).sum();
            let pull: f32 = self.wraps.iter().map(|&w| (self.actors[w].r.tackle as f32 + self.actors[w].r.strength as f32) / 198.0).sum();
            (m / (m + hang), pull * 0.8)
        } else {
            (1.0, 0.0)
        };
        let a = &mut self.actors[i];
        if a.engaged.is_some() || a.wrapping || a.ragdoll {
            return;
        }
        if a.mv == Move::Hurdle {
            let k = clamp(1.0 - a.move_t / 0.55, 0.0, 1.0);
            a.z = (k * std::f32::consts::PI).sin() * 0.6;
        }
        if !a.upright() {
            a.v = a.v * (1.0 - (6.0 * dt).min(1.0));
            a.p += a.v * dt;
            return;
        }
        if a.mv != Move::Dive {
            let mut desired = desired;
            let mut max_acc = a.acc;
            if a.stun > 0.0 {
                max_acc *= 0.3;
                desired = desired * 0.45;
            }
            max_acc *= drag;
            match a.mv {
                Move::Spin => desired = desired * 0.85,
                Move::Stiff => desired = desired * 0.92,
                Move::Juke if a.move_t > 0.15 => {
                    // Plant and cut: a big lateral burst, braking the forward speed.
                    let fwd = if a.v.len() > 0.5 { a.v.norm() } else { a.facing_v() };
                    let burst = 3.2 + a.r.agility as f32 * 0.028;
                    desired = fwd * (a.v.len() * 0.6) + a.mv_dir * burst;
                    max_acc = a.acc * (2.2 + a.r.agility as f32 * 0.012);
                }
                Move::Juke => max_acc *= 0.6,
                _ => {}
            }
            if brake > 0.0 {
                // Tacklers pulling back on the carrier.
                let s = a.v.len();
                if s > 0.0 {
                    a.v = a.v * ((s - brake * dt).max(0.0) / s);
                }
            }
            let dv = desired - a.v;
            let fwd = a.v.norm();
            if fwd.len_sq() == 0.0 {
                a.v += dv.clamp_len(max_acc * dt);
            } else {
                let along_s = dv.dot(fwd);
                let along = fwd * along_s;
                let lat = dv - along;
                let along_max = if along_s < 0.0 { max_acc * 1.7 } else { max_acc };
                let lat_max = max_acc * (0.75 + a.r.agility as f32 * 0.007);
                a.v += along.clamp_len(along_max * dt) + lat.clamp_len(lat_max * dt);
            }
            let mut cap = a.top * if a.mv == Move::Juke { 1.1 } else { 1.0 } * if is_carrier { 0.98 } else { 1.0 } * drag;
            if a.stagger > 0.0 {
                cap *= 0.7;
            }
            if a.mv == Move::Truck {
                cap *= 0.92;
            }
            a.v = a.v.clamp_len(cap);
        } else {
            a.z = 0.35;
        }
        a.p += a.v * dt;
        // Keep non-carriers roughly on the field.
        if !is_carrier {
            a.p.x = clamp(a.p.x, -4.0, FIELD_LEN + 4.0);
            a.p.y = clamp(a.p.y, -3.0, FIELD_W + 3.0);
        }
        // Facing follows velocity.
        let sp = a.v.len();
        if sp > 0.6 && a.mv != Move::Spin {
            let target = a.v.angle();
            let diff = wrap_angle(target - a.facing);
            a.facing = wrap_angle(a.facing + clamp(diff, -12.0 * dt, 12.0 * dt));
        } else if a.mv == Move::Spin {
            a.facing = wrap_angle(a.facing + 14.0 * dt);
        }
    }

    fn advance_routes(&mut self) {
        for i in 0..N {
            let reached = {
                let a = &self.actors[i];
                match &a.task {
                    Task::Route { pts, idx, .. } | Task::RunPath { pts, idx, .. } => {
                        *idx < pts.len() && a.p.dist(pts[*idx]) < 0.9
                    }
                    _ => false,
                }
            };
            if reached {
                let mut fake_done = false;
                match &mut self.actors[i].task {
                    Task::Route { idx, .. } => *idx += 1,
                    Task::RunPath { idx, pts, .. } => {
                        *idx += 1;
                        fake_done = *idx >= pts.len();
                    }
                    _ => {}
                }
                if fake_done && i == RB && self.handoff {
                    // Play-action fake done: pick up a blocker.
                    let home = self.actors[QB].p;
                    self.actors[i].task = Task::Block { home };
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Ball flight
    // -----------------------------------------------------------------------

    fn ball_flight(&mut self, dt: f32, rng: &mut Rng) {
        let (pos, intended, t) = match &mut self.ball {
            Ball::Air { pos, vel, t, intended, .. } => {
                *t += dt;
                *pos = *pos + *vel * dt;
                vel.z -= GRAVITY * dt;
                (*pos, *intended, *t)
            }
            _ => return,
        };

        if t > 0.2 && pos.z > 0.15 && pos.z < 3.0 {
            let mut cands: Vec<(usize, f32)> = (0..N)
                .filter(|&j| {
                    let a = &self.actors[j];
                    !a.tried_catch && a.engaged.is_none() && (a.upright() || a.mv == Move::Dive)
                })
                .map(|j| (j, self.actors[j].p.dist(pos.xy())))
                .filter(|&(j, d)| d < if self.actors[j].mv == Move::Dive { 1.7 } else { 1.15 })
                .collect();
            cands.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            for (j, _) in cands {
                self.actors[j].tried_catch = true;
                if self.try_catch(j, pos, intended, rng) {
                    return;
                }
                if !matches!(self.ball, Ball::Air { .. }) {
                    return;
                }
            }
        }

        if pos.z <= 0.05 || pos.x < -6.0 || pos.x > FIELD_LEN + 6.0 || pos.y < -6.0 || pos.y > FIELD_W + 6.0 {
            self.ball = Ball::Loose(V3::new(pos.x, pos.y, 0.12));
            self.events.push(Event::Incomplete);
            let text = if self.target_name.is_empty() {
                format!("{} throws it away.", self.thrower_name)
            } else {
                format!("{} pass incomplete, intended for {}.", self.thrower_name, self.target_name)
            };
            let spot = V2::new(self.los_x, self.ball_y);
            let ot = self.off_team;
            self.end_play(EndKind::Incomplete, spot, ot, text);
        }
    }

    /// Returns true if the ball was caught.
    fn try_catch(&mut self, j: usize, pos: V3, intended: Option<usize>, rng: &mut Rng) -> bool {
        let a = &self.actors[j];
        let contested = (0..N)
            .filter(|&k| k != j && self.actors[k].team != a.team && self.actors[k].upright())
            .map(|k| (k, self.actors[k].p.dist(a.p)))
            .filter(|&(_, d)| d < 1.3)
            .min_by(|x, y| x.1.partial_cmp(&y.1).unwrap());

        if a.team == self.off_team {
            let mut p = 0.45 + a.r.catching as f32 * 0.0055;
            if intended != Some(j) {
                p *= 0.75;
            }
            if let Some((k, _)) = contested {
                p -= 0.25 * self.actors[k].r.coverage as f32 / 99.0;
            }
            if a.mv == Move::Dive {
                p -= 0.1;
            }
            if self.pitch && intended == Some(j) {
                p = 0.985;
            }
            if rng.chance(p) {
                self.complete_catch(j, pos);
                return true;
            } else if intended == Some(j) {
                // Pass interference: a defender all over the receiver as the ball arrives.
                if let Some((k, d)) = contested {
                    if !self.pitch && d < 1.0 && self.flags.is_empty() {
                        let cov = self.actors[k].r.coverage as f32;
                        let p_dpi = 0.14 * self.penalty_rate * (1.3 - cov / 160.0);
                        if rng.chance(p_dpi) {
                            let spot = self.actors[j].p;
                            self.throw_flag(Foul::PassInterference, k, spot);
                        }
                    }
                }
                self.events.push(Event::Drop);
                if let Ball::Air { vel, .. } = &mut self.ball {
                    *vel = V3::new(vel.x * 0.25, vel.y * 0.25, -1.5);
                }
            }
        } else {
            let mut p_int = 0.02 + a.r.catching as f32 * 0.0016;
            let p_defl = 0.25 + a.r.coverage as f32 * 0.0025;
            if let Some(r) = intended {
                if self.actors[r].p.dist(pos.xy()) < 1.2 {
                    p_int *= 0.5;
                }
            }
            let roll = rng.f32();
            if roll < p_int {
                self.complete_catch(j, pos);
                return true;
            } else if roll < p_int + p_defl {
                self.events.push(Event::Deflection);
                if let Ball::Air { vel, .. } = &mut self.ball {
                    *vel = V3::new(-vel.x * 0.15 + rng.normal(), vel.y * 0.2 + rng.normal(), 2.6);
                }
            }
        }
        false
    }

    fn complete_catch(&mut self, j: usize, pos: V3) {
        let a = &self.actors[j];
        if a.p.y < 0.0 || a.p.y > FIELD_W || a.p.x < 0.0 || a.p.x > FIELD_LEN {
            self.ball = Ball::Loose(V3::new(pos.x, pos.y, 0.12));
            self.events.push(Event::Incomplete);
            let text = format!("{} pass to {} is caught out of bounds. Incomplete.", self.thrower_name, a.name);
            let spot = V2::new(self.los_x, self.ball_y);
            let ot = self.off_team;
            self.end_play(EndKind::Incomplete, spot, ot, text);
            return;
        }
        let team = a.team;
        self.catch_spot = Some(a.p);
        self.ball = Ball::Held(j);
        self.carrier = Some(j);
        self.actors[j].task = Task::Carrier;
        self.actors[j].anim = Anim::Catch;
        self.actors[j].mv = Move::None;
        self.actors[j].z = 0.0;
        // Securing the catch costs speed; contested catches cost more.
        if !self.pitch {
            let contested = (0..N).any(|k| self.actors[k].team != team && self.actors[k].p.dist(self.actors[j].p) < 2.0);
            self.actors[j].v = self.actors[j].v * if contested { 0.4 } else { 0.6 };
            self.actors[j].stun = if contested { 0.35 } else { 0.22 };
            self.actors[j].move_cd = 0.5;
        }
        if team != self.off_team {
            self.poss_team = team;
            let td = self.team_dir(team);
            let own_goal = if td > 0.0 { 10.0 } else { 110.0 };
            self.int_in_endzone = (self.actors[j].p.x - own_goal) * td < 0.0;
            self.target_name = self.actors[j].name.clone();
            self.events.push(Event::Interception { actor: j });
        } else {
            self.target_name = self.actors[j].name.clone();
            self.events.push(Event::Catch { actor: j });
        }
        self.set_react_all(team);
        // Hand control to the right player: the catcher if he's ours, otherwise
        // our player closest to him.
        if let Some(ut) = self.user_team {
            self.user = if ut == team { Some(j) } else { self.nearest_opponent(j, false) };
            self.user_touched = false;
        }
    }

    // Tackling lives in contact.rs (contact model + ragdoll physics).

    pub(crate) fn finish_down(&mut self, spot: V2, sack: bool) {
        let c = self.carrier.unwrap_or(QB);
        let team = self.actors[c].team;
        let td = self.team_dir(team);
        let own_goal = if td > 0.0 { 10.0 } else { 110.0 };
        let in_own_ez = (spot.x - own_goal) * td < 0.0;
        let kind = if in_own_ez {
            if team != self.off_team && self.int_in_endzone {
                EndKind::Touchback
            } else {
                EndKind::Safety
            }
        } else {
            EndKind::Down
        };
        let tackler = self.last_tackler.map(|t| self.actors[t].name.clone()).unwrap_or_default();
        let text = self.describe(c, spot, sack, &tackler);
        if sack {
            self.events.push(Event::Sack);
        }
        let mut r = self.end_play(kind, spot, team, text);
        r.sack = sack;
        self.result = Some(r);
    }

    fn describe(&self, c: usize, spot: V2, sack: bool, tackler: &str) -> String {
        if self.special.is_some() {
            return self.special_describe(c, spot, tackler);
        }
        let yards = ((spot.x - self.los_x) * self.dir).round() as i32;
        let who = &self.actors[c].name;
        let by = if tackler.is_empty() { String::new() } else { format!(" Tackled by {}.", tackler) };
        if sack {
            return format!("{} sacked by {} for a loss of {}.", who, tackler, -yards);
        }
        if self.fumble_lost {
            return format!("FUMBLE! Recovered by {}.{}", who, by);
        }
        if self.actors[c].team != self.off_team {
            return format!("{} pass INTERCEPTED by {}!{}", self.thrower_name, who, by);
        }
        let yd = match yards {
            0 => "no gain".to_string(),
            y if y < 0 => format!("a loss of {}", -y),
            1 => "1 yard".to_string(),
            y => format!("{} yards", y),
        };
        if self.thrown {
            format!("{} pass complete to {} for {}.{}", self.thrower_name, who, yd, by)
        } else {
            format!("{} runs for {}.{}", who, yd, by)
        }
    }

    fn boundaries(&mut self) {
        let Some(c) = self.carrier else { return };
        let a = &self.actors[c];
        let team = a.team;
        let td = self.team_dir(team);
        let goal = if td > 0.0 { 110.0 } else { 10.0 };
        if (a.p.x - goal) * td >= 0.0 && a.p.y >= 0.0 && a.p.y <= FIELD_W {
            let who = a.name.clone();
            let spot = a.p;
            self.events.push(Event::Touchdown { team });
            let text = if self.special.is_some() {
                format!("{} takes it all the way back for a TOUCHDOWN!", who)
            } else if self.thrown && team == self.off_team {
                format!("{} pass to {}... TOUCHDOWN!", self.thrower_name, who)
            } else if team != self.off_team {
                format!("{} returns the interception for a TOUCHDOWN!", who)
            } else {
                format!("{} runs it in for a TOUCHDOWN!", who)
            };
            self.end_play(EndKind::Touchdown, spot, team, text);
            for j in 0..N {
                if self.actors[j].team == team {
                    self.actors[j].anim = Anim::Celebrate;
                }
            }
            return;
        }
        if a.p.y < 0.0 || a.p.y > FIELD_W || a.p.x < 0.0 || a.p.x > FIELD_LEN {
            let spot = V2::new(clamp(a.p.x, 0.0, FIELD_LEN), clamp(a.p.y, 0.0, FIELD_W));
            self.events.push(Event::OutOfBounds);
            let own_goal = if td > 0.0 { 10.0 } else { 110.0 };
            let in_own_ez = (spot.x - own_goal) * td < 0.0;
            let kind = if in_own_ez {
                if team != self.off_team && self.int_in_endzone { EndKind::Touchback } else { EndKind::Safety }
            } else {
                EndKind::OutOfBounds
            };
            let mut text = self.describe(c, spot, false, "");
            text = text.trim_end_matches('.').to_string() + ", out of bounds.";
            self.end_play(kind, spot, team, text);
        }
    }

    pub(crate) fn end_play(&mut self, kind: EndKind, spot: V2, carrier_team: u8, text: String) -> PlayResult {
        self.phase = PlayPhase::Over;
        self.over_t = 0.0;
        let r = PlayResult {
            kind,
            spot,
            carrier_team,
            turnover: carrier_team != self.off_team,
            sack: false,
            text,
            flags: self.flags.clone(),
            fumble: self.fumble_lost,
            fg: self.special.as_ref().and_then(|sp| sp.fg_result),
            kick_oob: self.special.as_ref().map(|sp| sp.kick_oob).unwrap_or(false),
        };
        self.result = Some(r.clone());
        for a in self.actors.iter_mut() {
            a.engaged = None;
            a.mv = Move::None;
            a.z = 0.0;
        }
        if kind == EndKind::Safety {
            self.events.push(Event::Safety);
        }
        r
    }

    pub(crate) fn update_anims(&mut self) {
        for i in 0..N {
            let carrier = self.carrier == Some(i);
            let a = &mut self.actors[i];
            if a.anim == Anim::Celebrate {
                continue;
            }
            if a.ragdoll {
                a.anim = Anim::Ragdoll;
                continue;
            }
            if a.wrapping {
                a.anim = Anim::Wrap;
                continue;
            }
            if !a.upright() {
                a.anim = if a.mv == Move::Dive { Anim::Dive } else { Anim::Down };
                continue;
            }
            a.anim = match a.mv {
                Move::Dive => Anim::Dive,
                Move::Juke => Anim::Juke,
                Move::Spin => Anim::Spin,
                Move::Stiff => Anim::Stiff,
                Move::Hurdle => Anim::Hurdle,
                Move::Truck => Anim::Truck,
                Move::None => {
                    if a.stagger > 0.0 && a.v.len() > 0.5 {
                        Anim::Stagger
                    } else if a.engaged.is_some() {
                        Anim::Block
                    } else if a.anim == Anim::Throw && self.t < 10.0 && matches!(self.ball, Ball::Air { t, .. } if t < 0.35) {
                        Anim::Throw
                    } else if a.anim == Anim::Catch && carrier && a.v.len() < 3.0 {
                        Anim::Catch
                    } else if a.v.len() > 0.5 {
                        Anim::Run
                    } else {
                        Anim::Idle
                    }
                }
            };
        }
    }

    // -----------------------------------------------------------------------
    // Output
    // -----------------------------------------------------------------------

    /// Fill `out` with `STRIDE` floats per actor, then `BALL_STRIDE` floats for the ball:
    /// position, state, holder, velocity, then the target marker (kind, x, y, time left).
    pub fn snapshot(&self, out: &mut Vec<f32>) {
        out.clear();
        let intended = match &self.ball {
            Ball::Air { intended, .. } => *intended,
            _ => None,
        };
        let show_icons = self.user_is_offense() && self.qb_in_pocket() && !self.thrown && self.is_pass() && self.phase != PlayPhase::Over;
        for (i, a) in self.actors.iter().enumerate() {
            let mut flags = 0u32;
            if self.user == Some(i) {
                flags |= 1;
            }
            if self.carrier == Some(i) {
                flags |= 2;
            }
            if intended == Some(i) {
                flags |= 4;
            }
            if a.engaged.is_some() {
                flags |= 8;
            }
            if a.team == self.off_team {
                flags |= 16;
            }
            out.extend_from_slice(&[
                a.p.x,
                a.p.y,
                a.z,
                a.facing,
                a.anim as u8 as f32,
                a.v.len(),
                flags as f32,
                if show_icons { a.icon as f32 } else { 0.0 },
            ]);
        }
        let b = self.ball_pos();
        let (state, holder) = match &self.ball {
            Ball::Held(i) => (1.0, *i as f32),
            Ball::Air { .. } => (2.0, -1.0),
            Ball::Loose(_) => (0.0, -1.0),
        };
        let (vx, vy) = match &self.ball {
            Ball::Air { vel, .. } => (vel.x, vel.y),
            _ => (0.0, 0.0),
        };
        // Target marker: where a pass (1) or kick (2) is coming down, and how soon.
        let (mark, tx, ty, tleft) = match &self.ball {
            Ball::Air { pos, target, arrive, t, .. } if !self.fumble && self.phase == PlayPhase::Live => {
                let kick = self.special.as_ref().filter(|s| s.kicked && !s.touched && !s.landed);
                if self.special.is_none() && self.thrown {
                    (1.0, target.x, target.y, (arrive - t).max(0.0))
                } else if let Some(sp) = kick {
                    // Time until the kick comes down to catching height.
                    let (z, vz) = (pos.z - 1.4, sp.vel.z);
                    let disc = vz * vz + 2.0 * GRAVITY * z;
                    let tl = if disc > 0.0 { ((vz + disc.sqrt()) / GRAVITY).max(0.0) } else { 0.0 };
                    (2.0, sp.land.x, sp.land.y, tl)
                } else {
                    (0.0, 0.0, 0.0, 0.0)
                }
            }
            _ => (0.0, 0.0, 0.0, 0.0),
        };
        out.extend_from_slice(&[b.x, b.y, b.z, state, holder, vx, vy, mark, tx, ty, tleft, 0.0]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throw_solver_lands_on_target() {
        let from = V2::new(30.0, 26.0);
        let to = V2::new(52.0, 40.0);
        for &t in &[0.6f32, 1.2, 2.4] {
            let v = solve_throw(from, 2.0, to, 1.4, t);
            let mut p = V3::new(from.x, from.y, 2.0);
            let mut vel = v;
            let dt = 1.0 / 240.0;
            let steps = (t / dt).round() as usize;
            for _ in 0..steps {
                p = p + vel * dt;
                vel.z -= GRAVITY * dt;
            }
            assert!(p.xy().dist(to) < 0.05, "t={t}: landed {:?}", p);
            assert!((p.z - 1.4).abs() < 0.3, "t={t}: height {}", p.z);
        }
    }
}
