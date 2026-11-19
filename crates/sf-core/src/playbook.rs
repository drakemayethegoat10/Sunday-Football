//! Formations, routes and plays.
//!
//! Everything here uses *offense-relative* coordinates:
//! * `d` = yards downfield from the line of scrimmage (negative = backfield)
//! * `l` = yards to the quarterback's **left** of the ball (negative = right)
//!
//! Route waypoints use `(d, out)`, where `out` is measured toward the receiver's
//! own sideline, so one route definition works on either side of the field.
//!
//! Every formation fills the same 11 offensive slots; *personnel* decides which
//! roster player fills the flexible slots (e.g. the `SL` slot is a slot receiver in
//! 11 personnel, a second tight end in 12, a fullback in 21).

use crate::player::Pos;
use serde::Serialize;

/// Offensive slots.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum OSlot {
    LT = 0,
    LG,
    C,
    RG,
    RT,
    QB,
    RB,
    TE,
    /// Split end, usually wide left.
    X,
    /// Flanker, usually wide right.
    Z,
    /// Flexible slot: slot WR, TE2 or fullback depending on personnel.
    SL,
}

pub const OSLOTS: [OSlot; 11] = [
    OSlot::LT,
    OSlot::LG,
    OSlot::C,
    OSlot::RG,
    OSlot::RT,
    OSlot::QB,
    OSlot::RB,
    OSlot::TE,
    OSlot::X,
    OSlot::Z,
    OSlot::SL,
];

/// Defensive slots. `NB` and `WLB` are flexible (nickel back / SAM / dime back).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum DSlot {
    LE = 0,
    LDT,
    RDT,
    RE,
    WLB,
    MLB,
    CB1,
    CB2,
    NB,
    FS,
    SS,
}

pub const DSLOTS: [DSlot; 11] = [
    DSlot::LE,
    DSlot::LDT,
    DSlot::RDT,
    DSlot::RE,
    DSlot::WLB,
    DSlot::MLB,
    DSlot::CB1,
    DSlot::CB2,
    DSlot::NB,
    DSlot::FS,
    DSlot::SS,
];

/// Roster pick: the n-th player at a position on the depth chart.
pub type Pick = (Pos, usize);

#[derive(Clone, Copy, Debug)]
pub struct Formation {
    pub name: &'static str,
    pub personnel: &'static str,
    /// `(d, l)` per offensive slot, in `OSLOTS` order.
    pub spots: [(f32, f32); 11],
    pub under_center: bool,
    pub rb: Pick,
    pub te: Pick,
    pub x: Pick,
    pub z: Pick,
    pub sl: Pick,
}

const OL: [(f32, f32); 5] = [(-0.8, 2.6), (-0.8, 1.3), (-0.6, 0.0), (-0.8, -1.3), (-0.8, -2.6)];

const fn f(qb: (f32, f32), rb: (f32, f32), te: (f32, f32), x: (f32, f32), z: (f32, f32), sl: (f32, f32)) -> [(f32, f32); 11] {
    [OL[0], OL[1], OL[2], OL[3], OL[4], qb, rb, te, x, z, sl]
}

pub const GUN_TRIPS: Formation = Formation {
    name: "Gun Trips",
    personnel: "11",
    under_center: false,
    spots: f((-5.0, 0.0), (-5.0, 1.3), (-0.9, 3.9), (-0.6, 12.0), (-1.2, -12.0), (-1.2, -6.0)),
    rb: (Pos::RB, 0),
    te: (Pos::TE, 0),
    x: (Pos::WR, 0),
    z: (Pos::WR, 1),
    sl: (Pos::WR, 2),
};

pub const GUN_DOUBLES: Formation = Formation {
    name: "Gun Doubles",
    personnel: "11",
    under_center: false,
    spots: f((-5.0, 0.0), (-5.0, -1.3), (-0.9, -3.9), (-0.6, 12.0), (-1.2, -12.0), (-1.2, 6.5)),
    rb: (Pos::RB, 0),
    te: (Pos::TE, 0),
    x: (Pos::WR, 0),
    z: (Pos::WR, 1),
    sl: (Pos::WR, 2),
};

pub const GUN_EMPTY: Formation = Formation {
    name: "Gun Empty",
    personnel: "10",
    under_center: false,
    spots: f((-5.0, 0.0), (-0.9, -4.6), (-1.2, 7.0), (-0.6, 13.0), (-1.2, -13.0), (-1.2, -8.8)),
    rb: (Pos::RB, 0),
    te: (Pos::WR, 3),
    x: (Pos::WR, 0),
    z: (Pos::WR, 1),
    sl: (Pos::WR, 2),
};

pub const SINGLEBACK: Formation = Formation {
    name: "Singleback",
    personnel: "11",
    under_center: true,
    spots: f((-1.1, 0.0), (-7.0, 0.0), (-0.9, 3.9), (-0.6, 12.0), (-1.2, -12.0), (-1.2, -6.0)),
    rb: (Pos::RB, 0),
    te: (Pos::TE, 0),
    x: (Pos::WR, 0),
    z: (Pos::WR, 1),
    sl: (Pos::WR, 2),
};

pub const SINGLEBACK_ACE: Formation = Formation {
    name: "Singleback Ace",
    personnel: "12",
    under_center: true,
    spots: f((-1.1, 0.0), (-7.0, 0.0), (-0.9, 3.9), (-0.6, 12.0), (-1.2, -12.0), (-0.9, -3.9)),
    rb: (Pos::RB, 0),
    te: (Pos::TE, 0),
    x: (Pos::WR, 0),
    z: (Pos::WR, 1),
    sl: (Pos::TE, 1),
};

pub const I_FORM: Formation = Formation {
    name: "I-Form Pro",
    personnel: "21",
    under_center: true,
    spots: f((-1.1, 0.0), (-7.0, 0.0), (-0.9, -3.9), (-0.6, 12.0), (-1.2, -12.0), (-4.3, 0.0)),
    rb: (Pos::RB, 0),
    te: (Pos::TE, 0),
    x: (Pos::WR, 0),
    z: (Pos::WR, 1),
    sl: (Pos::RB, 1),
};

pub const I_FORM_TIGHT: Formation = Formation {
    name: "I-Form Tight",
    personnel: "21",
    under_center: true,
    spots: f((-1.1, 0.0), (-7.0, 0.0), (-0.9, -3.9), (-0.6, 7.0), (-1.2, -7.0), (-4.3, 0.0)),
    rb: (Pos::RB, 0),
    te: (Pos::TE, 0),
    x: (Pos::WR, 0),
    z: (Pos::WR, 1),
    sl: (Pos::RB, 1),
};

pub const PISTOL: Formation = Formation {
    name: "Pistol",
    personnel: "11",
    under_center: false,
    spots: f((-4.0, 0.0), (-7.0, 0.0), (-0.9, -3.9), (-0.6, 12.0), (-1.2, -12.0), (-1.2, 6.0)),
    rb: (Pos::RB, 0),
    te: (Pos::TE, 0),
    x: (Pos::WR, 0),
    z: (Pos::WR, 1),
    sl: (Pos::WR, 2),
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Route {
    Go,
    Seam,
    Slant,
    Out,
    QuickOut,
    Dig,
    Curl,
    Hitch,
    Post,
    Corner,
    Flat,
    Drag,
    DeepDrag,
    Over,
    Swing,
    CheckRelease,
    Stick,
    Fade,
    Comeback,
    Wheel,
    Screen,
}

pub struct RouteDef {
    pub pts: &'static [(f32, f32)],
    /// Settle in open space and face the QB at the end, instead of running on.
    pub sit: bool,
    /// Seconds spent pass-blocking before releasing.
    pub delay: f32,
}

pub fn route_def(r: Route) -> RouteDef {
    match r {
        Route::Go => RouteDef { pts: &[(45.0, 1.0)], sit: false, delay: 0.0 },
        Route::Seam => RouteDef { pts: &[(45.0, -0.5)], sit: false, delay: 0.0 },
        Route::Slant => RouteDef { pts: &[(1.5, 0.0), (12.0, -9.0)], sit: false, delay: 0.0 },
        Route::Out => RouteDef { pts: &[(9.0, 0.0), (8.5, 14.0)], sit: false, delay: 0.0 },
        Route::QuickOut => RouteDef { pts: &[(5.0, 0.0), (4.5, 14.0)], sit: false, delay: 0.0 },
        Route::Dig => RouteDef { pts: &[(12.0, 0.0), (12.0, -22.0)], sit: false, delay: 0.0 },
        Route::Curl => RouteDef { pts: &[(11.0, 0.0), (9.5, -1.5)], sit: true, delay: 0.0 },
        Route::Hitch => RouteDef { pts: &[(6.0, 0.0), (5.0, 0.0)], sit: true, delay: 0.0 },
        Route::Post => RouteDef { pts: &[(11.0, 0.0), (34.0, -12.0)], sit: false, delay: 0.0 },
        Route::Corner => RouteDef { pts: &[(11.0, 0.0), (27.0, 10.0)], sit: false, delay: 0.0 },
        Route::Flat => RouteDef { pts: &[(1.5, 2.0), (3.5, 11.0)], sit: false, delay: 0.0 },
        Route::Drag => RouteDef { pts: &[(3.0, -3.0), (4.0, -24.0)], sit: false, delay: 0.0 },
        Route::DeepDrag => RouteDef { pts: &[(6.0, -3.0), (7.0, -24.0)], sit: false, delay: 0.0 },
        Route::Over => RouteDef { pts: &[(7.0, 0.0), (17.0, -28.0)], sit: false, delay: 0.0 },
        Route::Swing => RouteDef { pts: &[(-1.5, 3.0), (1.0, 10.0), (6.0, 13.0)], sit: false, delay: 0.0 },
        Route::CheckRelease => RouteDef { pts: &[(2.0, 4.0), (4.0, 9.0)], sit: true, delay: 1.3 },
        Route::Stick => RouteDef { pts: &[(5.5, 0.0), (6.0, -1.8)], sit: true, delay: 0.0 },
        Route::Fade => RouteDef { pts: &[(3.0, 1.5), (45.0, 4.0)], sit: false, delay: 0.0 },
        Route::Comeback => RouteDef { pts: &[(15.0, 0.0), (12.5, 3.0)], sit: true, delay: 0.0 },
        Route::Wheel => RouteDef { pts: &[(1.0, 4.0), (4.0, 9.0), (35.0, 9.5)], sit: false, delay: 0.0 },
        Route::Screen => RouteDef { pts: &[(-2.5, 4.5), (-2.0, 7.0)], sit: true, delay: 0.7 },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub enum PlayKind {
    /// `hole_l`: lateral aim point. `delay`: draw-style late handoff. `carrier`: RB, SL
    /// (fullback dive) or QB (sneak). `toss`: pitch instead of a handoff. `counter`:
    /// the back jab-steps the other way first.
    Run { hole_l: f32, delay: f32, carrier: OSlot, toss: bool, counter: bool },
    /// `drop`: dropback depth. `boot`: roll out toward this lateral offset (0 = pocket).
    /// `screen`: linemen release to lead the screen.
    Pass { drop: f32, play_action: bool, boot: f32, screen: bool },
    Punt,
    FieldGoal,
    Kneel,
    Spike,
}

const fn run(hole_l: f32) -> PlayKind {
    PlayKind::Run { hole_l, delay: 0.0, carrier: OSlot::RB, toss: false, counter: false }
}
const fn pass(drop: f32) -> PlayKind {
    PlayKind::Pass { drop, play_action: false, boot: 0.0, screen: false }
}
const fn pa(drop: f32) -> PlayKind {
    PlayKind::Pass { drop, play_action: true, boot: 0.0, screen: false }
}

pub struct OffPlay {
    pub name: &'static str,
    pub formation: &'static Formation,
    pub kind: PlayKind,
    /// Receivers and their routes. `true` mirrors the route to the other side.
    pub routes: &'static [(OSlot, Route, bool)],
    /// CPU-only hint: preferred read order (indexes into `routes`).
    pub reads: &'static [usize],
}

impl OffPlay {
    pub fn category(&self) -> &'static str {
        match self.kind {
            PlayKind::Run { .. } => "RUN",
            PlayKind::Pass { .. } => "PASS",
            PlayKind::Punt | PlayKind::FieldGoal => "SPECIAL",
            PlayKind::Kneel | PlayKind::Spike => "CLOCK",
        }
    }
    pub fn is_special(&self) -> bool {
        matches!(self.kind, PlayKind::Punt | PlayKind::FieldGoal | PlayKind::Kneel | PlayKind::Spike)
    }
}

use OSlot::{RB as B, SL as S, TE as T, X, Z};
use Route::*;

pub static OFFENSE: &[OffPlay] = &[
    // ---- Gun Trips (11)
    OffPlay { name: "Gun Inside Zone", formation: &GUN_TRIPS, kind: run(-1.4), routes: &[], reads: &[] },
    OffPlay { name: "Gun Draw", formation: &GUN_TRIPS, kind: PlayKind::Run { hole_l: 0.6, delay: 0.85, carrier: B, toss: false, counter: false }, routes: &[], reads: &[] },
    OffPlay { name: "Slant Flat", formation: &GUN_TRIPS, kind: pass(1.5), routes: &[(X, Slant, false), (Z, Slant, false), (S, Flat, false), (T, Seam, false)], reads: &[2, 1, 0, 3] },
    OffPlay { name: "Four Verticals", formation: &GUN_TRIPS, kind: pass(2.0), routes: &[(X, Go, false), (Z, Go, false), (S, Seam, false), (T, Seam, false), (B, Swing, false)], reads: &[2, 3, 0, 1, 4] },
    OffPlay { name: "Curl Flat", formation: &GUN_TRIPS, kind: pass(2.0), routes: &[(X, Curl, false), (Z, Curl, false), (S, Flat, false), (T, Curl, false), (B, CheckRelease, false)], reads: &[1, 2, 3, 0, 4] },
    OffPlay { name: "Mesh", formation: &GUN_TRIPS, kind: pass(2.0), routes: &[(S, Drag, false), (T, DeepDrag, false), (X, Corner, false), (Z, Go, false), (B, Swing, false)], reads: &[0, 1, 4, 2, 3] },
    OffPlay { name: "Smash", formation: &GUN_TRIPS, kind: pass(2.0), routes: &[(Z, Hitch, false), (S, Corner, false), (X, Hitch, false), (T, Seam, false)], reads: &[1, 0, 2, 3] },
    OffPlay { name: "Quick Outs", formation: &GUN_TRIPS, kind: pass(1.0), routes: &[(X, QuickOut, false), (Z, QuickOut, false), (S, QuickOut, false), (T, Seam, false)], reads: &[2, 0, 1, 3] },
    OffPlay { name: "Deep Cross", formation: &GUN_TRIPS, kind: pass(2.5), routes: &[(S, Route::Over, false), (X, Dig, false), (Z, Go, false), (T, Flat, false)], reads: &[0, 1, 3, 2] },
    OffPlay { name: "HB Screen", formation: &GUN_TRIPS, kind: PlayKind::Pass { drop: 2.5, play_action: false, boot: 0.0, screen: true }, routes: &[(B, Screen, false), (X, Go, false), (Z, Go, false), (S, Slant, false)], reads: &[0] },
    // ---- Gun Doubles (11)
    OffPlay { name: "Stick", formation: &GUN_DOUBLES, kind: pass(1.5), routes: &[(T, Stick, false), (S, Stick, false), (B, Flat, false), (X, Fade, false), (Z, Go, false)], reads: &[0, 1, 2, 3, 4] },
    OffPlay { name: "Y-Cross", formation: &GUN_DOUBLES, kind: pass(2.5), routes: &[(T, Route::Over, false), (Z, Comeback, false), (S, Seam, false), (X, Post, false), (B, CheckRelease, false)], reads: &[0, 1, 2, 3, 4] },
    OffPlay { name: "Dagger", formation: &GUN_DOUBLES, kind: pass(2.5), routes: &[(X, Dig, false), (S, Seam, false), (Z, Go, false), (T, Drag, false), (B, CheckRelease, false)], reads: &[0, 1, 3, 4, 2] },
    OffPlay { name: "Outside Zone", formation: &GUN_DOUBLES, kind: run(-6.5), routes: &[], reads: &[] },
    // ---- Gun Empty (10)
    OffPlay { name: "Spacing", formation: &GUN_EMPTY, kind: pass(1.0), routes: &[(X, Hitch, false), (T, Stick, false), (S, Stick, false), (B, QuickOut, false), (Z, Hitch, false)], reads: &[1, 2, 3, 0, 4] },
    OffPlay { name: "Empty Verticals", formation: &GUN_EMPTY, kind: pass(2.0), routes: &[(X, Go, false), (T, Seam, false), (S, Seam, false), (Z, Go, false), (B, QuickOut, false)], reads: &[4, 1, 2, 0, 3] },
    // ---- Singleback (11)
    OffPlay { name: "Inside Zone", formation: &SINGLEBACK, kind: run(-1.4), routes: &[], reads: &[] },
    OffPlay { name: "Stretch Left", formation: &SINGLEBACK, kind: run(6.0), routes: &[], reads: &[] },
    OffPlay { name: "Stretch Right", formation: &SINGLEBACK, kind: run(-6.5), routes: &[], reads: &[] },
    OffPlay { name: "Curls", formation: &SINGLEBACK, kind: pass(5.0), routes: &[(X, Curl, false), (Z, Curl, false), (S, Flat, false), (T, Seam, false)], reads: &[1, 0, 2, 3] },
    OffPlay { name: "PA Deep Post", formation: &SINGLEBACK, kind: pa(7.5), routes: &[(X, Post, false), (Z, Dig, false), (S, Corner, false), (T, Drag, false)], reads: &[0, 1, 2, 3] },
    OffPlay { name: "PA Boot Left", formation: &SINGLEBACK, kind: PlayKind::Pass { drop: 5.0, play_action: true, boot: 8.0, screen: false }, routes: &[(T, Flat, false), (Z, Route::Over, false), (X, Comeback, false), (S, Corner, false)], reads: &[0, 1, 2, 3] },
    // ---- Singleback Ace (12)
    OffPlay { name: "Power", formation: &SINGLEBACK_ACE, kind: run(1.4), routes: &[], reads: &[] },
    OffPlay { name: "Counter", formation: &SINGLEBACK_ACE, kind: PlayKind::Run { hole_l: -3.0, delay: 0.15, carrier: B, toss: false, counter: true }, routes: &[], reads: &[] },
    OffPlay { name: "Toss Left", formation: &SINGLEBACK_ACE, kind: PlayKind::Run { hole_l: 8.0, delay: 0.0, carrier: B, toss: true, counter: false }, routes: &[], reads: &[] },
    OffPlay { name: "PA Seams", formation: &SINGLEBACK_ACE, kind: pa(6.0), routes: &[(T, Seam, false), (S, Seam, false), (X, Post, false), (Z, Comeback, false)], reads: &[0, 1, 3, 2] },
    // ---- I-Form Pro (21)
    OffPlay { name: "FB Dive", formation: &I_FORM, kind: PlayKind::Run { hole_l: -0.6, delay: 0.0, carrier: S, toss: false, counter: false }, routes: &[], reads: &[] },
    OffPlay { name: "HB Dive", formation: &I_FORM, kind: run(1.4), routes: &[], reads: &[] },
    OffPlay { name: "Power O", formation: &I_FORM, kind: run(-2.6), routes: &[], reads: &[] },
    OffPlay { name: "Toss Right", formation: &I_FORM, kind: PlayKind::Run { hole_l: -8.5, delay: 0.0, carrier: B, toss: true, counter: false }, routes: &[], reads: &[] },
    OffPlay { name: "PA Cross", formation: &I_FORM, kind: pa(6.5), routes: &[(T, Drag, false), (X, Post, false), (Z, Route::Over, false), (S, Flat, false)], reads: &[2, 0, 1, 3] },
    // ---- I-Form Tight (21), short yardage / goal line
    OffPlay { name: "QB Sneak", formation: &I_FORM_TIGHT, kind: PlayKind::Run { hole_l: 0.0, delay: 0.0, carrier: OSlot::QB, toss: false, counter: false }, routes: &[], reads: &[] },
    OffPlay { name: "Goal Line Dive", formation: &I_FORM_TIGHT, kind: run(-1.4), routes: &[], reads: &[] },
    OffPlay { name: "PA Fades", formation: &I_FORM_TIGHT, kind: pa(5.0), routes: &[(X, Fade, false), (Z, Fade, false), (T, Flat, false), (S, Flat, false)], reads: &[2, 3, 0, 1] },
    // ---- Pistol (11)
    OffPlay { name: "Pistol Zone", formation: &PISTOL, kind: run(-1.4), routes: &[], reads: &[] },
    OffPlay { name: "Pistol PA Post", formation: &PISTOL, kind: pa(4.0), routes: &[(X, Post, false), (S, Wheel, false), (Z, Dig, false), (T, Drag, false)], reads: &[0, 2, 1, 3] },
    // ---- Special / clock
    OffPlay { name: "Punt", formation: &SINGLEBACK, kind: PlayKind::Punt, routes: &[], reads: &[] },
    OffPlay { name: "Field Goal", formation: &SINGLEBACK, kind: PlayKind::FieldGoal, routes: &[], reads: &[] },
    OffPlay { name: "QB Kneel", formation: &SINGLEBACK, kind: PlayKind::Kneel, routes: &[], reads: &[] },
    OffPlay { name: "Spike Ball", formation: &SINGLEBACK, kind: PlayKind::Spike, routes: &[], reads: &[] },
];

pub fn offense_index(name: &str) -> usize {
    OFFENSE.iter().position(|p| p.name == name).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Defense
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Align {
    /// Fixed `(d, l)` relative to the ball.
    At(f32, f32),
    /// Line up over an offensive player at depth `d` (small = press).
    Over(OSlot, f32),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DAssign {
    Rush,
    Man(OSlot),
    /// Zone drop to `(d, l)` relative to the ball.
    Zone(f32, f32),
    /// Fill the run gap at `l`, otherwise hang underneath and watch the QB.
    RunFit(f32),
}

pub struct DefPlay {
    pub name: &'static str,
    pub personnel: &'static str,
    pub align: [Align; 11],
    pub assign: [DAssign; 11],
    pub blitz: bool,
    /// Who plays the flexible NB and WLB slots.
    pub nb: Pick,
    pub wlb: Pick,
}

const DL: [Align; 4] = [Align::At(1.0, 3.6), Align::At(1.0, 1.0), Align::At(1.0, -1.0), Align::At(1.0, -3.6)];
const DL_TIGHT: [Align; 4] = [Align::At(0.9, 2.8), Align::At(0.9, 0.7), Align::At(0.9, -0.7), Align::At(0.9, -2.8)];

const fn d(dl: [Align; 4], rest: [Align; 7]) -> [Align; 11] {
    [dl[0], dl[1], dl[2], dl[3], rest[0], rest[1], rest[2], rest[3], rest[4], rest[5], rest[6]]
}

use Align::{At, Over};
use DAssign::{Man, Rush as R, RunFit as Fit, Zone};

const NICKEL: (Pick, Pick) = ((Pos::CB, 2), (Pos::LB, 0));
const BASE: (Pick, Pick) = ((Pos::LB, 2), (Pos::LB, 0));
const DIME: (Pick, Pick) = ((Pos::CB, 2), (Pos::S, 2));

pub static DEFENSE: &[DefPlay] = &[
    // ---- Nickel (4-2-5)
    DefPlay {
        name: "Cover 2", personnel: "Nickel", blitz: false, nb: NICKEL.0, wlb: NICKEL.1,
        align: d(DL, [At(5.0, 2.5), At(5.0, -2.5), Over(X, 2.0), Over(Z, 2.0), Over(S, 4.5), At(13.0, 10.0), At(13.0, -10.0)]),
        assign: [R, R, R, R, Zone(9.0, 5.0), Zone(9.0, -5.0), Zone(6.0, 14.0), Zone(6.0, -14.0), Zone(12.0, 0.0), Zone(19.0, 11.0), Zone(19.0, -11.0)],
    },
    DefPlay {
        name: "Cover 3", personnel: "Nickel", blitz: false, nb: NICKEL.0, wlb: NICKEL.1,
        align: d(DL, [At(5.0, 2.5), At(5.0, -2.5), Over(X, 6.0), Over(Z, 6.0), Over(S, 5.0), At(14.0, 0.0), At(8.0, -6.0)]),
        assign: [R, R, R, R, Zone(8.0, 9.0), Zone(10.0, 0.0), Zone(18.0, 15.0), Zone(18.0, -15.0), Zone(8.0, -7.0), Zone(21.0, 0.0), Zone(7.0, -14.0)],
    },
    DefPlay {
        name: "Cover 1 Man", personnel: "Nickel", blitz: false, nb: NICKEL.0, wlb: NICKEL.1,
        align: d(DL, [At(5.0, 2.0), At(5.0, -1.5), Over(X, 4.0), Over(Z, 4.0), Over(S, 4.0), At(15.0, 0.0), Over(T, 5.0)]),
        assign: [R, R, R, R, Fit(0.0), Man(B), Man(X), Man(Z), Man(S), Zone(18.0, 0.0), Man(T)],
    },
    DefPlay {
        name: "Cover 4", personnel: "Nickel", blitz: false, nb: NICKEL.0, wlb: NICKEL.1,
        align: d(DL, [At(5.0, 2.5), At(5.0, -2.5), Over(X, 7.0), Over(Z, 7.0), Over(S, 5.0), At(12.0, 7.0), At(12.0, -7.0)]),
        assign: [R, R, R, R, Zone(8.0, 6.0), Zone(9.0, -4.0), Zone(17.0, 17.0), Zone(17.0, -17.0), Zone(7.0, -11.0), Zone(17.0, 6.0), Zone(17.0, -6.0)],
    },
    DefPlay {
        name: "Tampa 2", personnel: "Nickel", blitz: false, nb: NICKEL.0, wlb: NICKEL.1,
        align: d(DL, [At(5.0, 3.0), At(5.0, -0.5), Over(X, 2.0), Over(Z, 2.0), Over(S, 4.5), At(13.0, 10.0), At(13.0, -10.0)]),
        assign: [R, R, R, R, Zone(9.0, 7.0), Zone(15.0, 0.0), Zone(6.0, 14.0), Zone(6.0, -14.0), Zone(9.0, -7.0), Zone(19.0, 12.0), Zone(19.0, -12.0)],
    },
    DefPlay {
        name: "Zone Blitz", personnel: "Nickel", blitz: true, nb: NICKEL.0, wlb: NICKEL.1,
        align: d(DL, [At(3.0, 2.5), At(3.0, -1.5), Over(X, 6.0), Over(Z, 6.0), Over(S, 4.0), At(14.0, 0.0), At(7.0, -6.0)]),
        assign: [Zone(5.0, 11.0), R, R, R, R, R, Zone(18.0, 15.0), Zone(18.0, -15.0), Zone(8.0, -3.0), Zone(21.0, 0.0), Zone(6.0, -13.0)],
    },
    DefPlay {
        name: "Cover 0 Blitz", personnel: "Nickel", blitz: true, nb: NICKEL.0, wlb: NICKEL.1,
        align: d(DL, [At(3.0, 2.0), At(3.0, -2.0), Over(X, 1.5), Over(Z, 1.5), Over(S, 2.0), At(8.0, 0.0), Over(T, 4.0)]),
        assign: [R, R, R, R, R, R, Man(X), Man(Z), Man(S), Man(B), Man(T)],
    },
    // ---- Base 4-3 (NB slot = SAM linebacker)
    DefPlay {
        name: "4-3 Cover 2", personnel: "4-3 Base", blitz: false, nb: BASE.0, wlb: BASE.1,
        align: d(DL, [At(4.5, 4.0), At(4.5, 0.0), Over(X, 2.0), Over(Z, 2.0), Over(T, 4.0), At(13.0, 10.0), At(13.0, -10.0)]),
        assign: [R, R, R, R, Zone(9.0, 7.0), Zone(10.0, 0.0), Zone(6.0, 14.0), Zone(6.0, -14.0), Zone(9.0, -7.0), Zone(19.0, 11.0), Zone(19.0, -11.0)],
    },
    DefPlay {
        name: "4-3 Cover 3", personnel: "4-3 Base", blitz: false, nb: BASE.0, wlb: BASE.1,
        align: d(DL, [At(4.5, 4.0), At(4.5, 0.0), Over(X, 6.0), Over(Z, 6.0), Over(T, 4.0), At(14.0, 0.0), At(8.0, -5.0)]),
        assign: [R, R, R, R, Zone(8.0, 10.0), Zone(9.0, 0.0), Zone(18.0, 15.0), Zone(18.0, -15.0), Zone(8.0, -8.0), Zone(21.0, 0.0), Fit(-2.0)],
    },
    DefPlay {
        name: "4-3 Cover 1", personnel: "4-3 Base", blitz: false, nb: BASE.0, wlb: BASE.1,
        align: d(DL, [At(4.5, 3.0), At(4.5, 0.0), Over(X, 4.0), Over(Z, 4.0), Over(T, 3.0), At(15.0, 0.0), At(7.0, 5.0)]),
        assign: [R, R, R, R, Fit(2.0), Man(B), Man(X), Man(Z), Man(T), Zone(18.0, 0.0), Man(S)],
    },
    DefPlay {
        name: "Mike Blitz", personnel: "4-3 Base", blitz: true, nb: BASE.0, wlb: BASE.1,
        align: d(DL, [At(4.0, 3.0), At(3.0, 0.5), Over(X, 3.0), Over(Z, 3.0), Over(T, 3.0), At(15.0, 0.0), At(6.0, 4.0)]),
        assign: [R, R, R, R, Man(B), R, Man(X), Man(Z), Man(T), Zone(18.0, 0.0), Man(S)],
    },
    DefPlay {
        name: "Run Stuff", personnel: "4-3 Base", blitz: true, nb: BASE.0, wlb: BASE.1,
        align: d(DL_TIGHT, [At(3.5, 2.5), At(3.5, -0.5), Over(X, 3.0), Over(Z, 3.0), Over(T, 2.5), At(12.0, 0.0), At(5.0, -3.5)]),
        assign: [R, R, R, R, Fit(2.0), Fit(-0.5), Man(X), Man(Z), Fit(-4.0), Zone(15.0, 0.0), Fit(-2.5)],
    },
    // ---- Dime (dime back in the WLB slot)
    DefPlay {
        name: "Dime 2 Man", personnel: "Dime", blitz: false, nb: DIME.0, wlb: DIME.1,
        align: d(DL, [Over(T, 4.0), At(5.5, 0.0), Over(X, 2.0), Over(Z, 2.0), Over(S, 3.0), At(14.0, 10.0), At(14.0, -10.0)]),
        assign: [R, R, R, R, Man(T), Man(B), Man(X), Man(Z), Man(S), Zone(20.0, 11.0), Zone(20.0, -11.0)],
    },
    DefPlay {
        name: "Dime Cover 3", personnel: "Dime", blitz: false, nb: DIME.0, wlb: DIME.1,
        align: d(DL, [At(6.0, 4.0), At(5.5, 0.0), Over(X, 6.0), Over(Z, 6.0), Over(S, 5.0), At(15.0, 0.0), At(9.0, -6.0)]),
        assign: [R, R, R, R, Zone(9.0, 9.0), Zone(10.0, 0.0), Zone(19.0, 15.0), Zone(19.0, -15.0), Zone(9.0, -8.0), Zone(22.0, 0.0), Zone(8.0, -14.0)],
    },
    DefPlay {
        name: "Prevent", personnel: "Dime", blitz: false, nb: DIME.0, wlb: DIME.1,
        align: d(DL, [At(9.0, 6.0), At(8.0, -2.0), Over(X, 9.0), Over(Z, 9.0), Over(S, 9.0), At(20.0, 6.0), At(20.0, -6.0)]),
        assign: [Zone(6.0, 10.0), R, R, R, Zone(12.0, 7.0), Zone(10.0, -2.0), Zone(22.0, 17.0), Zone(22.0, -17.0), Zone(13.0, -9.0), Zone(27.0, 6.0), Zone(27.0, -6.0)],
    },
    // ---- Goal line
    DefPlay {
        name: "Goal Line Man", personnel: "Goal Line", blitz: true, nb: BASE.0, wlb: BASE.1,
        align: d(DL_TIGHT, [At(2.5, 2.0), At(2.5, -1.0), Over(X, 1.5), Over(Z, 1.5), Over(T, 2.0), At(5.0, 0.0), At(2.0, -4.0)]),
        assign: [R, R, R, R, Man(S), Man(B), Man(X), Man(Z), Man(T), Zone(5.0, 0.0), R],
    },
    DefPlay {
        name: "Goal Line Stuff", personnel: "Goal Line", blitz: true, nb: BASE.0, wlb: BASE.1,
        align: d(DL_TIGHT, [At(2.0, 2.0), At(2.0, -1.0), Over(X, 1.5), Over(Z, 1.5), Over(T, 1.5), At(4.0, 0.0), At(2.0, -3.5)]),
        assign: [R, R, R, R, Fit(1.5), Fit(-1.0), Man(X), Man(Z), Fit(-4.0), Zone(5.0, 0.0), Fit(-2.5)],
    },
];

pub fn defense_index(name: &str) -> usize {
    DEFENSE.iter().position(|p| p.name == name).unwrap_or(0)
}

/// Receiver icon order (1–5).
pub const ELIGIBLE: [OSlot; 5] = [OSlot::X, OSlot::Z, OSlot::SL, OSlot::TE, OSlot::RB];
