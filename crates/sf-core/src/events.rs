//! Events the core emits for the client: sounds, banners, the play-by-play ticker,
//! and (later) commentary.

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Snap,
    Handoff,
    PlayAction,
    Throw { kind: u8 },
    Catch { actor: usize },
    Interception { actor: usize },
    Drop,
    Deflection,
    Incomplete,
    Tackle { big: bool },
    BrokenTackle,
    Juke,
    Spin,
    StiffArm,
    Sack,
    Touchdown { team: u8 },
    FirstDown,
    TurnoverOnDowns,
    Punt { yards: i32 },
    FieldGoal { good: bool, dist: i32 },
    ExtraPoint { good: bool },
    Safety,
    OutOfBounds,
    QuarterEnd { quarter: u8 },
    Halftime,
    Final,
    /// A penalty flag thrown at field position (x, y).
    Flag { x: f32, y: f32 },
    /// The ball was kicked (kickoff, punt, field goal).
    Kick,
    FairCatch,
    Touchback,
    Timeout { team: u8 },
    TwoMinuteWarning,
    Overtime,
    Penalty { text: String },
    /// Big centered text. `style` is a CSS hint: "good", "bad", "info".
    Banner { text: String, style: String },
    /// One line of play-by-play.
    Ticker { text: String },
}
