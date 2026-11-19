//! # sf-core
//!
//! The Sunday Football simulation core. It has no graphics and no platform code, so the
//! same rules, AI and (later) franchise logic run in the browser (via `sf-wasm`) and
//! on the native PC client (Bevy).

pub mod events;
pub mod game;
pub mod math;
pub mod player;
pub mod playbook;
pub mod rng;
pub mod sim;
pub mod special;

pub use events::Event;
pub use game::{Game, Settings};
pub use sim::Input;
