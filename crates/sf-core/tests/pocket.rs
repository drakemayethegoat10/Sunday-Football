//! Pocket report: how long the user's quarterback has before the rush gets home when he
//! takes his drop and just holds the ball.
//! `cargo test -p sf-core --release --test pocket -- --ignored --nocapture`

use sf_core::game::{Game, Phase, Settings};
use sf_core::playbook::{PlayKind, OFFENSE};
use sf_core::sim::{Input, PlayPhase};

/// Pass plays without play-action, screens or bootlegs: a plain dropback.
fn dropbacks() -> Vec<usize> {
    OFFENSE
        .iter()
        .enumerate()
        .filter(|(_, p)| matches!(p.kind, PlayKind::Pass { play_action: false, screen: false, boot, .. } if boot == 0.0))
        .map(|(i, _)| i)
        .collect()
}

pub struct PocketStats {
    pub plays: u32,
    /// Seconds from the snap until a defender is within 1.2 yd of the QB.
    pub pressure: Vec<f32>,
    /// Seconds from the snap until the QB is sacked (or 6 s if he never is).
    pub sack: Vec<f32>,
}

pub fn pocket_stats(difficulty: u8, seeds: std::ops::RangeInclusive<u64>) -> PocketStats {
    let calls = dropbacks();
    let mut out = PocketStats { plays: 0, pressure: Vec::new(), sack: Vec::new() };
    for seed in seeds {
        let s = Settings { quarter_len: 300.0, runoff: 15.0, user_team: Some(0), difficulty, ..Default::default() };
        let mut g = Game::new(seed, s, ["SAR", "HOU"], [0.0, 0.0]);
        let mut k = seed as usize;
        let mut steps = 0u64;
        let mut pressure_t: Option<f32> = None;
        let mut measuring = false;
        while g.phase != Phase::Final && out.plays < 40 * (seed as u32) {
            steps += 1;
            assert!(steps < 3_000_000, "game never finished");
            let mut input = Input::default();
            if g.phase == Phase::PlayCall && g.user_must_choose() {
                let off = g.user_on_offense() == Some(true);
                k += 1;
                g.call_play(if off { calls[k % calls.len()] } else { k % 5 });
                continue;
            }
            if g.phase == Phase::InPlay && g.play.phase == PlayPhase::PreSnap && g.play.special.is_some() {
                g.set_kick(0.8, 0.0, 0.0);
            }
            let user_off = g.user_on_offense() == Some(true);
            let dropback = user_off && g.play.special.is_none() && calls.contains(&g.play.off_play);
            if g.play.phase == PlayPhase::PreSnap && user_off {
                input.action = true;
            }
            g.step(1.0 / 60.0, &input);
            let p = &g.play;
            if dropback && p.phase == PlayPhase::Live {
                if !measuring {
                    measuring = true;
                    pressure_t = None;
                }
                let qb = p.actors[5].p;
                if pressure_t.is_none() && (11..22).any(|j| p.actors[j].ground <= 0.0 && p.actors[j].p.dist(qb) < 1.2) {
                    pressure_t = Some(p.t);
                }
                // Stop measuring after 6 s or once the QB leaves the pocket.
                if p.t > 6.0 || p.carrier != Some(5) {
                    measuring = false;
                    out.plays += 1;
                    out.pressure.push(pressure_t.unwrap_or(6.0));
                    out.sack.push(6.0);
                    // Fast-forward to the end of the play.
                    while g.play.phase == PlayPhase::Live {
                        g.step(1.0 / 60.0, &Input::default());
                    }
                }
            } else if measuring && p.phase == PlayPhase::Over {
                measuring = false;
                out.plays += 1;
                out.pressure.push(pressure_t.unwrap_or(p.t));
                let sacked = p.result.as_ref().map(|r| r.sack).unwrap_or(false);
                out.sack.push(if sacked { p.t } else { 6.0 });
            }
            g.drain_events();
        }
    }
    out
}

fn median(v: &[f32]) -> f32 {
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    s.get(s.len() / 2).copied().unwrap_or(0.0)
}

fn under(v: &[f32], t: f32) -> f32 {
    v.iter().filter(|&&x| x < t).count() as f32 / v.len().max(1) as f32 * 100.0
}

#[test]
#[ignore]
fn pocket_report() {
    println!("{:<8} {:>5} {:>10} {:>10} {:>9} {:>9} {:>9}", "level", "plays", "pressure", "sack", "sack<2s%", "sack<3s%", "sack<6s%");
    for d in 0..4u8 {
        let s = pocket_stats(d, 1..=4);
        println!(
            "{:<8} {:>5} {:>9.2}s {:>9.2}s {:>8.0}% {:>8.0}% {:>8.0}%",
            ["Rookie", "Pro", "AllPro", "Legend"][d as usize],
            s.plays,
            median(&s.pressure),
            median(&s.sack),
            under(&s.sack, 2.0),
            under(&s.sack, 3.0),
            under(&s.sack, 5.99)
        );
    }
}

/// A quarterback who just holds the ball should get a real pocket: most sacks take
/// well over two seconds, even on the hardest level.
#[test]
fn pocket_holds() {
    let s = pocket_stats(3, 1..=2);
    assert!(s.plays >= 20, "only {} dropbacks", s.plays);
    let quick = under(&s.sack, 2.0);
    assert!(quick < 15.0, "{quick:.0}% of sacks came in under 2 s");
    assert!(median(&s.pressure) > 2.0, "median pressure {:.2}s", median(&s.pressure));
}
