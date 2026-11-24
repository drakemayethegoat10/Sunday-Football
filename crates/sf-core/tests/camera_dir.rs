//! The camera follows the team with the ball: when the ball changes hands during a play
//! (interception, fumble recovery, kick return), `ball_dir` flips mid-play, and it already
//! matches the next play's `dir`, so the camera doesn't jump again between plays.
use sf_core::game::{Game, Phase, Settings};
use sf_core::sim::{Input, PlayPhase};
use std::sync::atomic::{AtomicU32, Ordering};

static CHECKED: AtomicU32 = AtomicU32::new(0);

#[test]
fn camera_turns_with_possession_changes() {
    let (mut returns, mut turnovers) = (0, 0);
    for seed in 1..40u64 {
        if returns >= 6 && turnovers >= 2 {
            break;
        }
        let (r, t) = one_game(seed);
        returns += r;
        turnovers += t;
    }
    assert!(returns >= 6, "kick returns seen: {returns}");
    assert!(turnovers >= 2, "turnovers seen: {turnovers}");
    assert!(CHECKED.load(Ordering::Relaxed) >= 4, "next-play direction checked too rarely");
}

fn one_game(seed: u64) -> (u32, u32) {
    let s = Settings { quarter_len: 300.0, runoff: 15.0, user_team: None, ..Default::default() };
    let mut g = Game::new(seed, s, ["SAR", "HOU"], [0.0, 0.0]);
    let (mut returns, mut turnovers) = (0, 0);
    // Direction the ball was going when the last play ended, and the team holding it.
    let mut pending: Option<(f32, u8)> = None;
    let mut flipped_this_play = false;
    let mut was_special = false;
    let mut flip_situation = "";
    let mut flip_quarter = 0;
    while g.phase != Phase::Final {
        g.step(1.0 / 60.0, &Input::default());
        g.drain_events();
        let h = g.hud();
        if g.phase == Phase::InPlay && g.play.phase != PlayPhase::PreSnap {
            if g.play.poss_team != g.play.off_team {
                assert_eq!(h.ball_dir, -h.dir, "ball changed hands: camera should face the other way");
                if !flipped_this_play {
                    flipped_this_play = true;
                    was_special = g.play.special.is_some();
                    flip_situation = h.situation;
                    flip_quarter = h.quarter;
                }
            } else {
                assert_eq!(h.ball_dir, h.dir);
            }
            pending = Some((h.ball_dir, g.play.poss_team));
        } else {
            if let Some((d, holder)) = pending.take() {
                if flipped_this_play {
                    // If the team that ended the play with the ball has it next, it attacks
                    // the way the camera already faces. Not checked across a new quarter
                    // (both teams switch ends) or after a try (the scoring team kicks off
                    // whatever happened on it).
                    let try_play = flip_situation == "try" || flip_situation == "two_point";
                    if g.phase == Phase::PlayCall && h.quarter == flip_quarter && h.possession == holder && !try_play {
                        assert_eq!(h.dir, d, "after the return the camera shouldn't swing again (seed {seed}, ball changed hands on a {flip_situation} play, next is {} q{} {:.0}; last play: {})", h.situation, h.quarter, h.clock, h.last_play);
                        CHECKED.fetch_add(1, Ordering::Relaxed);
                    }
                    if was_special {
                        returns += 1;
                    } else {
                        turnovers += 1;
                    }
                }
                flipped_this_play = false;
            }
            assert_eq!(h.ball_dir, h.dir);
        }
    }
    (returns, turnovers)
}

/// The same checks over many more games (slow): `--ignored camera_scan`.
#[test]
#[ignore]
fn camera_scan_many_games() {
    for seed in 1..160u64 {
        one_game(seed);
    }
}
