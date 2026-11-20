//! Drives the game the way a human would (snap, throw, juke, dive) to catch hangs
//! and NaNs in user-controlled paths.

use sf_core::game::{Game, Phase, Settings};
use sf_core::sim::{Input, PlayPhase};

fn run(seed: u64, off_call: usize, throw_at: f32, throw_to: u8, kind: u8, wiggle: bool) {
    let s = Settings { quarter_len: 120.0, runoff: 15.0, user_team: Some(0), ..Default::default() };
    let mut g = Game::new(seed, s, ["SAR", "HOU"], [1.0, 0.0]);
    let mut snap = Vec::new();
    let mut steps = 0u64;
    let mut thrown = false;
    while g.phase != Phase::Final {
        steps += 1;
        assert!(steps < 3_000_000, "seed {seed}: game never finished");
        let mut input = Input::default();
        match g.phase {
            Phase::PlayCall if g.user_must_choose() => {
                let off = g.user_on_offense() == Some(true);
                g.call_play(if off { off_call } else { (steps % 5) as usize });
                thrown = false;
                continue;
            }
            _ => {}
        }
        // Feed the kick meter whenever the user has to kick.
        if g.phase == Phase::InPlay && g.play.phase == PlayPhase::PreSnap && g.play.special.is_some() {
            let k = (steps % 7) as f32 / 7.0;
            g.set_kick(0.55 + k * 0.45, (k - 0.5) * 0.6);
        }
        let user_off = g.user_on_offense() == Some(true);
        match g.play.phase {
            PlayPhase::PreSnap if user_off => input.action = true,
            PlayPhase::Live => {
                if user_off && !thrown && g.play.t >= throw_at {
                    input.throw_to = throw_to;
                    input.throw_kind = kind;
                    thrown = true;
                }
                if !wiggle {
                    g.step(1.0 / 60.0, &input);
                    g.snapshot(&mut snap);
                    assert!(snap.iter().all(|v| v.is_finite()), "seed {seed}: non-finite");
                    g.drain_events();
                    continue;
                }
                // Wiggle the stick and spam moves to exercise every user path.
                let a = (steps as f32) * 0.05;
                input.mx = a.cos();
                input.my = a.sin();
                input.sprint = steps % 3 == 0;
                input.action = steps % 40 == 0;
                input.spin = steps % 57 == 0;
                input.stiff = steps % 71 == 0;
                input.switch = steps % 97 == 0;
                input.hurdle = steps % 83 == 0;
                input.truck = steps % 89 == 0;
            }
            _ => {}
        }
        g.step(1.0 / 60.0, &input);
        g.snapshot(&mut snap);
        if let Some(bad) = snap.iter().position(|v| !v.is_finite()) {
            panic!("seed {seed}: non-finite snapshot value at {bad} (play t={})", g.play.t);
        }
        g.drain_events();
    }
}

#[test]
fn user_offense_throws_and_moves() {
    for seed in 1..=6 {
        for wiggle in [false, true] {
            eprintln!("seed {seed} wiggle {wiggle}");
            run(seed, 6, 0.9, 2, 0, wiggle);
            run(seed, 5, 1.4, 1, 2, wiggle);
            run(seed, 0, 0.5, 0, 0, wiggle);
            run(seed, 4, 0.9, 2, 0, wiggle);
        }
    }
}
