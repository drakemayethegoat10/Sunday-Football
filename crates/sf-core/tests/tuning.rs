//! Tuning report: `cargo test -p sf-core --release --test tuning -- --ignored --nocapture`
//! Prints separation, air yards and yards-after-catch by coverage and play.
use sf_core::game::{Game, Phase, Settings};
use sf_core::playbook::{DEFENSE, OFFENSE};
use sf_core::sim::{Input, PlayPhase};
use std::collections::BTreeMap;

#[test]
#[ignore]
fn coverage_report() {
    let input = Input::default();
    let mut by_def: BTreeMap<&str, (u32, f32, f32, f32)> = BTreeMap::new();
    let mut by_off: BTreeMap<&str, (u32, f32, f32, f32)> = BTreeMap::new();
    let mut pressure = (0u32, 0u32, 0f32);
    for seed in 1..=6 {
        let s = Settings { quarter_len: 300.0, runoff: 15.0, user_team: None };
        let mut g = Game::new(seed, s, ["SAR", "HOU"], [1.0, 0.0]);
        let mut caught = false;
        let mut sep = 0.0;
        let mut cx = 0.0;
        let mut thrown_seen = false;
        while g.phase != Phase::Final {
            g.step(1.0 / 60.0, &input);
            let p = &g.play;
            if p.phase == PlayPhase::Live {
                if p.thrown && !thrown_seen {
                    thrown_seen = true;
                    pressure.0 += 1;
                    pressure.2 += p.t;
                }
                if let (Some(c), false) = (p.catch_spot, caught) {
                    if let Some(car) = p.carrier {
                        if p.actors[car].team == p.off_team {
                            caught = true;
                            cx = c.x;
                            sep = (0..22).filter(|&j| p.actors[j].team != p.off_team).map(|j| p.actors[j].p.dist(p.actors[car].p)).fold(99.0, f32::min);
                        }
                    }
                }
            }
            if p.phase == PlayPhase::Over && p.over_t < 1.0 / 59.0 {
                if let Some(r) = &p.result {
                    if r.sack { pressure.1 += 1; }
                    if caught {
                        let yac = (r.spot.x - cx) * p.dir;
                        let air = (cx - p.los_x) * p.dir;
                        for (map, key) in [(&mut by_def, DEFENSE[p.def_play].name), (&mut by_off, OFFENSE[p.off_play].name)] {
                            let e = map.entry(key).or_insert((0, 0.0, 0.0, 0.0));
                            e.0 += 1; e.1 += sep; e.2 += air; e.3 += yac;
                        }
                    }
                }
                caught = false;
                thrown_seen = false;
            }
            g.drain_events();
        }
    }
    println!("{:<16} {:>4} {:>6} {:>6} {:>6}", "DEFENSE", "n", "sep", "air", "yac");
    for (k, v) in &by_def { println!("{:<16} {:>4} {:>6.1} {:>6.1} {:>6.1}", k, v.0, v.1 / v.0 as f32, v.2 / v.0 as f32, v.3 / v.0 as f32); }
    println!("{:<16} {:>4} {:>6} {:>6} {:>6}", "OFFENSE", "n", "sep", "air", "yac");
    for (k, v) in &by_off { println!("{:<16} {:>4} {:>6.1} {:>6.1} {:>6.1}", k, v.0, v.1 / v.0 as f32, v.2 / v.0 as f32, v.3 / v.0 as f32); }
    println!("throws {} sacks {} avg time to throw {:.2}s", pressure.0, pressure.1, pressure.2 / pressure.0.max(1) as f32);
}
