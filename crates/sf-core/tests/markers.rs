//! The render snapshot's target marker: passes and kicks in the air show where they land.
use sf_core::game::{Game, Phase, Settings};
use sf_core::sim::{Ball, Input, PlayPhase, BALL_STRIDE, N, STRIDE};

#[test]
fn passes_and_kicks_mark_their_landing_spot() {
    let s = Settings { quarter_len: 120.0, runoff: 15.0, user_team: None, ..Default::default() };
    let mut g = Game::new(5, s, ["SAR", "HOU"], [0.0, 0.0]);
    let (mut pass_marks, mut kick_marks) = (0, 0);
    let mut snap = Vec::new();
    while g.phase != Phase::Final && (pass_marks < 20 || kick_marks < 20) {
        g.step(1.0 / 60.0, &Input::default());
        g.drain_events();
        g.snapshot(&mut snap);
        assert_eq!(snap.len(), N * STRIDE + BALL_STRIDE);
        let b = N * STRIDE;
        let p = &g.play;
        if p.phase != PlayPhase::Live || !matches!(p.ball, Ball::Air { .. }) {
            continue;
        }
        let kick_in_air = p.special.as_ref().map(|s| s.kicked && !s.touched && !s.landed).unwrap_or(false);
        if p.special.is_none() && p.thrown {
            assert_eq!(snap[b + 7], 1.0);
            pass_marks += 1;
        } else if kick_in_air && !p.fumble {
            assert_eq!(snap[b + 7], 2.0, "kick in the air should be marked");
            assert!(snap[b + 10] >= 0.0 && snap[b + 10].is_finite());
            kick_marks += 1;
        }
    }
    assert!(pass_marks >= 20 && kick_marks >= 20, "passes {pass_marks}, kicks {kick_marks}");
}
