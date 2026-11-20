//! Browser bindings for sf-core. Keep this thin: all game logic belongs in sf-core
//! so the native PC client gets it too.

use sf_core::game::{Game, Settings};
use sf_core::sim::Input;
use wasm_bindgen::prelude::*;

/// Button bit flags sent from JavaScript.
pub const BTN_SPRINT: u32 = 1;
pub const BTN_ACTION: u32 = 2;
pub const BTN_SPIN: u32 = 4;
pub const BTN_STIFF: u32 = 8;
pub const BTN_SWITCH: u32 = 16;
pub const BTN_FAIR_CATCH: u32 = 32;
pub const BTN_HURDLE: u32 = 64;
pub const BTN_TRUCK: u32 = 128;

#[wasm_bindgen]
pub struct WebGame {
    game: Game,
    snap: Vec<f32>,
    rag: Vec<f32>,
}

#[wasm_bindgen]
impl WebGame {
    /// `user_team`: 0 or 1 for the human's team, -1 for CPU vs CPU.
    /// `difficulty`: 0 Rookie .. 3 Legend. `penalties`: 0 off, 1 normal, 2 strict.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(seed: u32, home: &str, away: &str, quarter_minutes: f32, user_team: i32, difficulty: u8, penalties: f32, overtime: bool) -> WebGame {
        let settings = Settings {
            quarter_len: (quarter_minutes * 60.0).clamp(60.0, 900.0),
            runoff: 15.0,
            user_team: if (0..=1).contains(&user_team) { Some(user_team as u8) } else { None },
            difficulty: difficulty.min(3),
            penalties: penalties.clamp(0.0, 3.0),
            overtime,
        };
        WebGame { game: Game::new(seed as u64, settings, [home, away], [1.0, 0.0]), snap: Vec::with_capacity(256), rag: Vec::with_capacity(512) }
    }

    /// Advance one fixed step. `mx`/`my` are the move direction in field space.
    pub fn step(&mut self, dt: f32, mx: f32, my: f32, buttons: u32, throw_to: u8, throw_kind: u8) {
        let input = Input {
            mx,
            my,
            sprint: buttons & BTN_SPRINT != 0,
            action: buttons & BTN_ACTION != 0,
            spin: buttons & BTN_SPIN != 0,
            stiff: buttons & BTN_STIFF != 0,
            switch: buttons & BTN_SWITCH != 0,
            throw_to,
            throw_kind,
            fair_catch: buttons & BTN_FAIR_CATCH != 0,
            hurdle: buttons & BTN_HURDLE != 0,
            truck: buttons & BTN_TRUCK != 0,
        };
        self.game.step(dt, &input);
    }

    /// 8 floats per player (22), then 12 for the ball. See `sim::Play::snapshot`.
    pub fn snapshot(&mut self) -> Vec<f32> {
        self.game.snapshot(&mut self.snap);
        self.snap.clone()
    }

    /// Ragdoll bodies: per ragdoll, actor index then 11 × (x, y, z, qx, qy, qz, qw).
    pub fn ragdolls(&mut self) -> Vec<f32> {
        self.game.ragdolls(&mut self.rag);
        self.rag.clone()
    }

    pub fn hud(&self) -> String {
        serde_json::to_string(&self.game.hud()).unwrap_or_default()
    }

    pub fn events(&mut self) -> String {
        serde_json::to_string(&self.game.drain_events()).unwrap_or_else(|_| "[]".into())
    }

    pub fn lineup(&self) -> String {
        serde_json::to_string(&self.game.lineup_info()).unwrap_or_else(|_| "[]".into())
    }

    pub fn menu(&self) -> String {
        serde_json::to_string(&self.game.menu()).unwrap_or_else(|_| "[]".into())
    }

    pub fn call_play(&mut self, idx: u32) {
        self.game.call_play(idx as usize);
    }

    /// Kick meter result: power 0–1, accuracy -1 (hook) .. 1 (slice), aim -1 (left) .. 1 (right).
    pub fn kick(&mut self, power: f32, accuracy: f32, aim: f32) {
        self.game.set_kick(power, accuracy, aim);
    }

    /// Where a kick with this power and aim would go: [origin x, y, landing x, y, clears].
    /// Empty when there's no kick to aim.
    pub fn kick_preview(&self, power: f32, aim: f32) -> Vec<f32> {
        self.game.kick_preview(power, aim)
    }

    /// The human calls a timeout. Returns true if it was granted.
    pub fn timeout(&mut self) -> bool {
        match self.game.settings.user_team {
            Some(u) => self.game.call_timeout(u),
            None => false,
        }
    }

    /// End-of-game box score as JSON.
    pub fn stats(&self) -> String {
        serde_json::to_string(&self.game.stats).unwrap_or_else(|_| "[]".into())
    }
}
