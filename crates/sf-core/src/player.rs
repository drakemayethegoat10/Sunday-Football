//! Players, ratings and roster generation.

use crate::rng::Rng;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Pos {
    QB,
    RB,
    WR,
    TE,
    OL,
    DL,
    LB,
    CB,
    S,
    K,
    P,
}

impl Pos {
    pub fn label(self) -> &'static str {
        match self {
            Pos::QB => "QB",
            Pos::RB => "RB",
            Pos::WR => "WR",
            Pos::TE => "TE",
            Pos::OL => "OL",
            Pos::DL => "DL",
            Pos::LB => "LB",
            Pos::CB => "CB",
            Pos::S => "S",
            Pos::K => "K",
            Pos::P => "P",
        }
    }

    /// Body-size class the renderer uses: 0 = slim (WR/CB/K), 1 = mid (RB/LB/S/QB/TE), 2 = big (OL/DL).
    pub fn build(self) -> u8 {
        match self {
            Pos::OL | Pos::DL => 2,
            Pos::WR | Pos::CB | Pos::K | Pos::P => 0,
            _ => 1,
        }
    }
}

/// Ratings are 0–99, like the classic sims.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Ratings {
    pub speed: u8,
    pub accel: u8,
    pub agility: u8,
    pub strength: u8,
    pub awareness: u8,
    pub carrying: u8,
    pub catching: u8,
    pub route: u8,
    pub throw_power: u8,
    pub throw_acc: u8,
    pub block: u8,
    pub pass_rush: u8,
    pub run_stop: u8,
    pub tackle: u8,
    pub coverage: u8,
    pub kick_power: u8,
    pub kick_acc: u8,
}

impl Ratings {
    /// Top speed in yards/second. A 99-speed player runs about 10.4 yd/s; a 40-speed lineman about 7.
    pub fn top_speed(&self) -> f32 {
        5.2 + self.speed as f32 * 0.053
    }
    /// Acceleration in yards/second².
    pub fn accel_rate(&self) -> f32 {
        5.5 + self.accel as f32 * 0.075
    }
    /// How fast the player can turn while moving (radians/second at full speed).
    pub fn turn_rate(&self) -> f32 {
        3.0 + self.agility as f32 * 0.06
    }
    /// Effective mass in "kg-ish" units for collision math.
    pub fn mass(&self, pos: Pos) -> f32 {
        let base = match pos {
            Pos::OL => 140.0,
            Pos::DL => 130.0,
            Pos::TE | Pos::LB => 112.0,
            Pos::RB | Pos::S | Pos::QB => 100.0,
            _ => 90.0,
        };
        base + self.strength as f32 * 0.15
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Player {
    pub id: u32,
    pub first: String,
    pub last: String,
    pub pos: Pos,
    pub number: u8,
    pub age: u8,
    /// Index into the renderer's skin-tone palette.
    pub skin: u8,
    pub ratings: Ratings,
}

impl Player {
    pub fn short_name(&self) -> String {
        format!("{}. {}", self.first.chars().next().unwrap_or('X'), self.last)
    }
    pub fn overall(&self) -> u8 {
        let r = &self.ratings;
        let v: u32 = match self.pos {
            Pos::QB => (r.throw_power as u32 * 2 + r.throw_acc as u32 * 4 + r.awareness as u32 * 3 + r.speed as u32) / 10,
            Pos::RB => (r.speed as u32 * 3 + r.agility as u32 * 2 + r.carrying as u32 * 2 + r.strength as u32 + r.accel as u32 * 2) / 10,
            Pos::WR => (r.speed as u32 * 3 + r.catching as u32 * 3 + r.route as u32 * 3 + r.agility as u32) / 10,
            Pos::TE => (r.catching as u32 * 3 + r.block as u32 * 3 + r.strength as u32 * 2 + r.speed as u32 * 2) / 10,
            Pos::OL => (r.block as u32 * 5 + r.strength as u32 * 3 + r.awareness as u32 * 2) / 10,
            Pos::DL => (r.pass_rush as u32 * 3 + r.run_stop as u32 * 3 + r.strength as u32 * 2 + r.tackle as u32 * 2) / 10,
            Pos::LB => (r.tackle as u32 * 3 + r.run_stop as u32 * 2 + r.coverage as u32 * 2 + r.speed as u32 * 2 + r.awareness as u32) / 10,
            Pos::CB => (r.coverage as u32 * 4 + r.speed as u32 * 3 + r.agility as u32 * 2 + r.catching as u32) / 10,
            Pos::S => (r.coverage as u32 * 3 + r.tackle as u32 * 3 + r.speed as u32 * 2 + r.awareness as u32 * 2) / 10,
            Pos::K | Pos::P => (r.kick_power as u32 + r.kick_acc as u32) / 2,
        };
        v.min(99) as u8
    }
}

/// A team's roster as the core sees it. Names, colors and logos live in `data/teams.json`
/// and stay on the client side.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Team {
    pub abbr: String,
    pub players: Vec<Player>,
}

impl Team {
    /// First player at a position (depth chart order), skipping `skip` of them.
    pub fn starter(&self, pos: Pos, skip: usize) -> usize {
        self.players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.pos == pos)
            .nth(skip)
            .or_else(|| self.players.iter().enumerate().find(|(_, p)| p.pos == pos))
            .map(|(i, _)| i)
            .unwrap_or(0)
    }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const FIRST: &[&str] = &[
    "Marcus", "Tyler", "Jordan", "Andre", "Caleb", "Darius", "Ethan", "Isaiah", "Jalen", "Kevin",
    "Luke", "Malik", "Nate", "Owen", "Quinn", "Reggie", "Sam", "Trey", "Victor", "Wes", "Xavier",
    "Zach", "Brandon", "Cole", "Derek", "Eli", "Frank", "Grant", "Hunter", "Ivan", "Jace", "Keon",
    "Lamar", "Mason", "Nico", "Omar", "Pierce", "Rashad", "Shane", "Terrell", "Austin", "Bryce",
    "Corey", "Devin", "Elijah", "Felix", "Gavin", "Hank", "Jamal", "Kyle",
];

const LAST: &[&str] = &[
    "Carter", "Hill", "Brooks", "Reed", "Coleman", "Hayes", "Simmons", "Foster", "Bryant", "Price",
    "Bennett", "Wood", "Barnes", "Ross", "Henderson", "Jenkins", "Perry", "Powell", "Long",
    "Patterson", "Hughes", "Flores", "Washington", "Butler", "Watson", "Griffin", "Diaz", "Myers",
    "Ford", "Hamilton", "Graham", "Sullivan", "Wallace", "Woods", "Cole", "West", "Jordan", "Owens",
    "Reynolds", "Fisher", "Ellis", "Harrison", "Gibson", "McDonald", "Cruz", "Marshall", "Ortiz",
    "Gomez", "Murray", "Freeman", "Wells", "Webb", "Simpson", "Stevens", "Tucker", "Porter",
    "Hunter", "Hicks", "Crawford", "Henry", "Boyd", "Mason", "Kennedy", "Warren", "Dixon", "Burns",
    "Gordon", "Shaw", "Holmes", "Rice", "Robertson", "Black", "Daniels", "Palmer", "Mills",
];

/// Roster layout for a game-day squad. Order matters: it is the depth chart.
pub const SQUAD: &[(Pos, usize)] = &[
    (Pos::QB, 2),
    (Pos::RB, 2),
    (Pos::WR, 4),
    (Pos::TE, 2),
    (Pos::OL, 7),
    (Pos::DL, 6),
    (Pos::LB, 4),
    (Pos::CB, 4),
    (Pos::S, 3),
    (Pos::K, 1),
    (Pos::P, 1),
];

fn number_for(pos: Pos, rng: &mut Rng, used: &mut Vec<u8>) -> u8 {
    let ranges: &[(u8, u8)] = match pos {
        Pos::QB => &[(1, 19)],
        Pos::K | Pos::P => &[(1, 19)],
        Pos::RB => &[(20, 49), (1, 9)],
        Pos::WR => &[(10, 19), (80, 89), (1, 9)],
        Pos::TE => &[(80, 89), (40, 49)],
        Pos::OL => &[(60, 79)],
        Pos::DL => &[(90, 99), (50, 79)],
        Pos::LB => &[(40, 59), (90, 99)],
        Pos::CB | Pos::S => &[(20, 49), (1, 9)],
    };
    for _ in 0..60 {
        let (lo, hi) = *rng.pick(ranges);
        let n = lo + rng.below((hi - lo + 1) as u32) as u8;
        if !used.contains(&n) {
            used.push(n);
            return n;
        }
    }
    // Fallback: any free number.
    let n = (1..=99).find(|n| !used.contains(n)).unwrap_or(0);
    used.push(n);
    n
}

fn rate(rng: &mut Rng, mean: f32, quality: f32) -> u8 {
    let v = mean + quality + rng.normal() * 6.0;
    v.round().clamp(25.0, 99.0) as u8
}

/// Generate one player. `quality` shifts all ratings (starters get a bump).
pub fn gen_player(rng: &mut Rng, id: u32, pos: Pos, quality: f32, used: &mut Vec<u8>) -> Player {
    let q = quality;
    let mut r = Ratings::default();
    // (speed, accel, agility, strength, awareness) baselines per position.
    let (sp, ac, ag, st, aw) = match pos {
        Pos::QB => (66.0, 70.0, 68.0, 58.0, 74.0),
        Pos::RB => (86.0, 86.0, 84.0, 66.0, 66.0),
        Pos::WR => (88.0, 86.0, 84.0, 50.0, 68.0),
        Pos::TE => (74.0, 74.0, 68.0, 70.0, 66.0),
        Pos::OL => (50.0, 60.0, 50.0, 84.0, 68.0),
        Pos::DL => (66.0, 74.0, 62.0, 84.0, 64.0),
        Pos::LB => (78.0, 80.0, 72.0, 72.0, 68.0),
        Pos::CB => (89.0, 88.0, 86.0, 48.0, 68.0),
        Pos::S => (85.0, 84.0, 80.0, 60.0, 70.0),
        Pos::K | Pos::P => (55.0, 55.0, 55.0, 45.0, 60.0),
    };
    r.speed = rate(rng, sp, q);
    r.accel = rate(rng, ac, q);
    r.agility = rate(rng, ag, q);
    r.strength = rate(rng, st, q);
    r.awareness = rate(rng, aw, q);
    let skill = |rng: &mut Rng, m: f32| rate(rng, m, q);
    r.carrying = skill(rng, if pos == Pos::RB { 80.0 } else { 55.0 });
    r.catching = skill(rng, match pos { Pos::WR => 82.0, Pos::TE => 74.0, Pos::RB => 66.0, Pos::CB | Pos::S => 54.0, _ => 35.0 });
    r.route = skill(rng, match pos { Pos::WR => 80.0, Pos::TE => 66.0, Pos::RB => 58.0, _ => 30.0 });
    r.throw_power = skill(rng, if pos == Pos::QB { 84.0 } else { 40.0 });
    r.throw_acc = skill(rng, if pos == Pos::QB { 80.0 } else { 30.0 });
    r.block = skill(rng, match pos { Pos::OL => 80.0, Pos::TE => 66.0, Pos::RB => 52.0, Pos::WR => 45.0, _ => 30.0 });
    r.pass_rush = skill(rng, match pos { Pos::DL => 78.0, Pos::LB => 62.0, _ => 30.0 });
    r.run_stop = skill(rng, match pos { Pos::DL => 76.0, Pos::LB => 74.0, Pos::S => 62.0, _ => 35.0 });
    r.tackle = skill(rng, match pos { Pos::LB => 80.0, Pos::S => 74.0, Pos::DL => 72.0, Pos::CB => 64.0, _ => 40.0 });
    r.coverage = skill(rng, match pos { Pos::CB => 80.0, Pos::S => 74.0, Pos::LB => 60.0, _ => 30.0 });
    r.kick_power = skill(rng, if matches!(pos, Pos::K | Pos::P) { 80.0 } else { 30.0 });
    r.kick_acc = skill(rng, if matches!(pos, Pos::K | Pos::P) { 78.0 } else { 30.0 });

    Player {
        id,
        first: rng.pick(FIRST).to_string(),
        last: rng.pick(LAST).to_string(),
        pos,
        number: number_for(pos, rng, used),
        age: 21 + rng.below(13) as u8,
        skin: rng.below(6) as u8,
        ratings: r,
    }
}

/// Generate a full game-day squad. `strength` is roughly -8 (weak) to +8 (elite).
pub fn gen_team(rng: &mut Rng, abbr: &str, strength: f32, id_base: u32) -> Team {
    let mut players = Vec::new();
    let mut used = Vec::new();
    let mut id = id_base;
    for &(pos, count) in SQUAD {
        for depth in 0..count {
            // Starters are better than backups.
            let starters = match pos {
                Pos::WR => 3,
                Pos::OL => 5,
                Pos::DL => 4,
                Pos::LB => 2,
                Pos::CB => 3,
                Pos::S => 2,
                _ => 1,
            };
            let q = strength + if depth < starters { 2.0 } else { -6.0 };
            players.push(gen_player(rng, id, pos, q, &mut used));
            id += 1;
        }
    }
    Team { abbr: abbr.to_string(), players }
}
