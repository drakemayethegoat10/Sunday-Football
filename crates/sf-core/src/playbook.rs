//! Formations, routes and plays.
//!
//! Everything here uses *offense-relative* coordinates:
//! * `d` = yards downfield from the line of scrimmage (negative = backfield)
//! * `l` = yards to the quarterback's **left** of the ball (negative = right)
//!
//! Route waypoints use `(d, out)`, where `out` is measured toward the receiver's
//! own sideline, so one route definition works on either side of the field.

use serde::Serialize;

/// Offensive slots. All plays use 11 personnel (1 RB, 1 TE, 3 WR).
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
    /// Split end, wide left.
    X,
    /// Flanker, wide right.
    Z,
    /// Slot receiver, right.
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

/// Defensive slots (nickel personnel: 4 DL, 2 LB, 3 CB, 2 S).
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

#[derive(Clone, Copy, Debug)]
pub struct Formation {
    pub name: &'static str,
    /// `(d, l)` per offensive slot, in `OSLOTS` order.
    pub spots: [(f32, f32); 11],
    pub under_center: bool,
}

pub const GUN_TRIPS: Formation = Formation {
    name: "Gun Trips",
    under_center: false,
    spots: [
        (-0.8, 2.6),
        (-0.8, 1.3),
        (-0.6, 0.0),
        (-0.8, -1.3),
        (-0.8, -2.6),
        (-5.0, 0.0),
        (-5.0, 1.3),
        (-0.9, 3.9),
        (-0.6, 12.0),
        (-1.2, -12.0),
        (-1.2, -6.0),
    ],
};

pub const SINGLEBACK: Formation = Formation {
    name: "Singleback",
    under_center: true,
    spots: [
        (-0.8, 2.6),
        (-0.8, 1.3),
        (-0.6, 0.0),
        (-0.8, -1.3),
        (-0.8, -2.6),
        (-1.1, 0.0),
        (-7.0, 0.0),
        (-0.9, 3.9),
        (-0.6, 12.0),
        (-1.2, -12.0),
        (-1.2, -6.0),
    ],
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
}

pub struct RouteDef {
    pub pts: &'static [(f32, f32)],
    /// Settle in open space and face the QB at the end, instead of running on.
    pub sit: bool,
    /// Seconds spent pass-blocking before releasing (check-release routes).
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
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub enum PlayKind {
    /// `hole_l`: lateral aim point of the run. `delay`: draw-style late handoff (seconds).
    Run { hole_l: f32, delay: f32 },
    /// `drop`: dropback depth behind the LOS. `play_action`: fake a handoff first.
    Pass { drop: f32, play_action: bool },
    Punt,
    FieldGoal,
    Kneel,
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
            PlayKind::Kneel => "CLOCK",
        }
    }
}

pub static OFFENSE: &[OffPlay] = &[
    OffPlay { name: "Inside Zone", formation: &SINGLEBACK, kind: PlayKind::Run { hole_l: -1.4, delay: 0.0 }, routes: &[], reads: &[] },
    OffPlay { name: "Stretch Left", formation: &SINGLEBACK, kind: PlayKind::Run { hole_l: 6.0, delay: 0.0 }, routes: &[], reads: &[] },
    OffPlay { name: "Stretch Right", formation: &SINGLEBACK, kind: PlayKind::Run { hole_l: -6.5, delay: 0.0 }, routes: &[], reads: &[] },
    OffPlay { name: "Gun Draw", formation: &GUN_TRIPS, kind: PlayKind::Run { hole_l: 0.6, delay: 0.85 }, routes: &[], reads: &[] },
    OffPlay {
        name: "Slant Flat", formation: &GUN_TRIPS, kind: PlayKind::Pass { drop: 1.5, play_action: false },
        routes: &[(OSlot::X, Route::Slant, false), (OSlot::Z, Route::Slant, false), (OSlot::SL, Route::Flat, false), (OSlot::TE, Route::Seam, false)],
        reads: &[2, 1, 0, 3],
    },
    OffPlay {
        name: "Four Verticals", formation: &GUN_TRIPS, kind: PlayKind::Pass { drop: 2.0, play_action: false },
        routes: &[(OSlot::X, Route::Go, false), (OSlot::Z, Route::Go, false), (OSlot::SL, Route::Seam, false), (OSlot::TE, Route::Seam, false), (OSlot::RB, Route::Swing, false)],
        reads: &[2, 3, 0, 1, 4],
    },
    OffPlay {
        name: "Curl Flat", formation: &GUN_TRIPS, kind: PlayKind::Pass { drop: 2.0, play_action: false },
        routes: &[(OSlot::X, Route::Curl, false), (OSlot::Z, Route::Curl, false), (OSlot::SL, Route::Flat, false), (OSlot::TE, Route::Curl, false), (OSlot::RB, Route::CheckRelease, false)],
        reads: &[1, 2, 3, 0, 4],
    },
    OffPlay {
        name: "Mesh", formation: &GUN_TRIPS, kind: PlayKind::Pass { drop: 2.0, play_action: false },
        routes: &[(OSlot::SL, Route::Drag, false), (OSlot::TE, Route::DeepDrag, false), (OSlot::X, Route::Corner, false), (OSlot::Z, Route::Go, false), (OSlot::RB, Route::Swing, false)],
        reads: &[0, 1, 4, 2, 3],
    },
    OffPlay {
        name: "Smash", formation: &GUN_TRIPS, kind: PlayKind::Pass { drop: 2.0, play_action: false },
        routes: &[(OSlot::Z, Route::Hitch, false), (OSlot::SL, Route::Corner, false), (OSlot::X, Route::Hitch, false), (OSlot::TE, Route::Seam, false)],
        reads: &[1, 0, 2, 3],
    },
    OffPlay {
        name: "Quick Outs", formation: &GUN_TRIPS, kind: PlayKind::Pass { drop: 1.0, play_action: false },
        routes: &[(OSlot::X, Route::QuickOut, false), (OSlot::Z, Route::QuickOut, false), (OSlot::SL, Route::QuickOut, false), (OSlot::TE, Route::Seam, false)],
        reads: &[2, 0, 1, 3],
    },
    OffPlay {
        name: "Deep Cross", formation: &GUN_TRIPS, kind: PlayKind::Pass { drop: 2.5, play_action: false },
        routes: &[(OSlot::SL, Route::Over, false), (OSlot::X, Route::Dig, false), (OSlot::Z, Route::Go, false), (OSlot::TE, Route::Flat, false)],
        reads: &[0, 1, 3, 2],
    },
    OffPlay {
        name: "PA Deep Post", formation: &SINGLEBACK, kind: PlayKind::Pass { drop: 7.5, play_action: true },
        routes: &[(OSlot::X, Route::Post, false), (OSlot::Z, Route::Dig, false), (OSlot::SL, Route::Corner, false), (OSlot::TE, Route::Drag, false)],
        reads: &[0, 1, 2, 3],
    },
    OffPlay { name: "Punt", formation: &SINGLEBACK, kind: PlayKind::Punt, routes: &[], reads: &[] },
    OffPlay { name: "Field Goal", formation: &SINGLEBACK, kind: PlayKind::FieldGoal, routes: &[], reads: &[] },
    OffPlay { name: "QB Kneel", formation: &SINGLEBACK, kind: PlayKind::Kneel, routes: &[], reads: &[] },
];

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
    pub align: [Align; 11],
    pub assign: [DAssign; 11],
    /// Number of rushers (for CPU logic and the menu).
    pub blitz: bool,
}

const DL_ALIGN: [Align; 4] = [Align::At(1.0, 3.6), Align::At(1.0, 1.0), Align::At(1.0, -1.0), Align::At(1.0, -3.6)];

const fn d(dl: [Align; 4], rest: [Align; 7]) -> [Align; 11] {
    [dl[0], dl[1], dl[2], dl[3], rest[0], rest[1], rest[2], rest[3], rest[4], rest[5], rest[6]]
}

pub static DEFENSE: &[DefPlay] = &[
    DefPlay {
        name: "Cover 2",
        blitz: false,
        align: d(DL_ALIGN, [Align::At(5.0, 2.5), Align::At(5.0, -2.5), Align::Over(OSlot::X, 2.0), Align::Over(OSlot::Z, 2.0), Align::Over(OSlot::SL, 4.5), Align::At(13.0, 10.0), Align::At(13.0, -10.0)]),
        assign: [
            DAssign::Rush, DAssign::Rush, DAssign::Rush, DAssign::Rush,
            DAssign::Zone(9.0, 5.0), DAssign::Zone(9.0, -5.0),
            DAssign::Zone(6.0, 14.0), DAssign::Zone(6.0, -14.0), DAssign::Zone(12.0, 0.0),
            DAssign::Zone(19.0, 11.0), DAssign::Zone(19.0, -11.0),
        ],
    },
    DefPlay {
        name: "Cover 3",
        blitz: false,
        align: d(DL_ALIGN, [Align::At(5.0, 2.5), Align::At(5.0, -2.5), Align::Over(OSlot::X, 6.0), Align::Over(OSlot::Z, 6.0), Align::Over(OSlot::SL, 5.0), Align::At(14.0, 0.0), Align::At(8.0, -6.0)]),
        assign: [
            DAssign::Rush, DAssign::Rush, DAssign::Rush, DAssign::Rush,
            DAssign::Zone(8.0, 9.0), DAssign::Zone(10.0, 0.0),
            DAssign::Zone(18.0, 15.0), DAssign::Zone(18.0, -15.0), DAssign::Zone(8.0, -7.0),
            DAssign::Zone(21.0, 0.0), DAssign::Zone(7.0, -14.0),
        ],
    },
    DefPlay {
        name: "Cover 1 Man",
        blitz: false,
        align: d(DL_ALIGN, [Align::At(5.0, 2.0), Align::At(5.0, -1.5), Align::Over(OSlot::X, 4.0), Align::Over(OSlot::Z, 4.0), Align::Over(OSlot::SL, 4.0), Align::At(15.0, 0.0), Align::Over(OSlot::TE, 5.0)]),
        assign: [
            DAssign::Rush, DAssign::Rush, DAssign::Rush, DAssign::Rush,
            DAssign::RunFit(0.0), DAssign::Man(OSlot::RB),
            DAssign::Man(OSlot::X), DAssign::Man(OSlot::Z), DAssign::Man(OSlot::SL),
            DAssign::Zone(18.0, 0.0), DAssign::Man(OSlot::TE),
        ],
    },
    DefPlay {
        name: "Cover 0 Blitz",
        blitz: true,
        align: d(DL_ALIGN, [Align::At(3.0, 2.0), Align::At(3.0, -2.0), Align::Over(OSlot::X, 1.5), Align::Over(OSlot::Z, 1.5), Align::Over(OSlot::SL, 2.0), Align::At(8.0, 0.0), Align::Over(OSlot::TE, 4.0)]),
        assign: [
            DAssign::Rush, DAssign::Rush, DAssign::Rush, DAssign::Rush,
            DAssign::Rush, DAssign::Rush,
            DAssign::Man(OSlot::X), DAssign::Man(OSlot::Z), DAssign::Man(OSlot::SL),
            DAssign::Man(OSlot::RB), DAssign::Man(OSlot::TE),
        ],
    },
    DefPlay {
        name: "Run Commit",
        blitz: true,
        align: d(DL_ALIGN, [Align::At(4.0, 2.0), Align::At(4.0, -2.0), Align::Over(OSlot::X, 3.0), Align::Over(OSlot::Z, 3.0), Align::Over(OSlot::SL, 4.0), Align::At(14.0, 0.0), Align::At(6.0, -3.0)]),
        assign: [
            DAssign::Rush, DAssign::Rush, DAssign::Rush, DAssign::Rush,
            DAssign::RunFit(2.5), DAssign::RunFit(-1.5),
            DAssign::Man(OSlot::X), DAssign::Man(OSlot::Z), DAssign::Man(OSlot::SL),
            DAssign::Zone(16.0, 0.0), DAssign::RunFit(-4.0),
        ],
    },
];

/// Ball-carrier is the RB on runs; eligible receivers in icon order (1–5).
pub const ELIGIBLE: [OSlot; 5] = [OSlot::X, OSlot::Z, OSlot::SL, OSlot::TE, OSlot::RB];
