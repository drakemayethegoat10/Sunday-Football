//! Physical contact between players (milestone 2 "feel"):
//! * Tackle attempts resolve into big hits, wrap-ups or misses from momentum, angle and
//!   ratings.
//! * Wrap-ups drain the carrier's balance while he keeps driving for yards. Strong backs
//!   can break free, and more tacklers mean a faster gang tackle.
//! * Completed tackles turn the players into ragdolls (see `physics`), and the ball is
//!   spotted where it is when the carrier's knee, hip or torso hits the turf.
//! * Big hits can force fumbles: a live, bouncing ball that players scramble for.
//! * Carrier hurdles and trucks; pass-rush swim / spin / bull rush.

use crate::events::Event;
use crate::math::*;
use crate::physics::{Part, Physics, RagdollStart};
use crate::rng::Rng;
use crate::sim::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RushMove {
    Swim,
    Spin,
    Bull,
}

impl Play {
    fn physics_mut(&mut self) -> &mut Physics {
        self.physics.get_or_insert_with(|| Box::new(Physics::new()))
    }

    /// Turn an actor into a ragdoll at its current state.
    fn ragdollize(&mut self, i: usize, lean: f32, vel: V2) {
        let a = &self.actors[i];
        let start = RagdollStart { actor: i, pos: a.p, z: a.z, facing: a.facing, lean, vel, mass: a.mass };
        self.physics_mut().spawn(&start);
        let a = &mut self.actors[i];
        a.ragdoll = true;
        a.ground = 99.0;
        a.engaged = None;
        a.wrapping = false;
        a.mv = Move::None;
        a.anim = Anim::Ragdoll;
    }

    /// Step ragdoll physics and copy positions back onto the actors.
    pub(crate) fn physics_step(&mut self, dt: f32) {
        let Some(ph) = self.physics.as_mut() else { return };
        ph.step(dt);
        let updates: Vec<(usize, V3)> = ph.ragdolls.iter().filter_map(|r| ph.pelvis(r.actor).map(|p| (r.actor, p))).collect();
        for (i, p) in updates {
            let a = &mut self.actors[i];
            a.p = V2::new(p.x, p.y);
            a.v = V2::ZERO;
            a.anim = Anim::Ragdoll;
        }
    }

    pub(crate) fn ragdoll_buffer(&self, out: &mut Vec<f32>) {
        match &self.physics {
            Some(ph) => ph.write(out),
            None => out.clear(),
        }
    }

    /// Per-step contact resolution. Replaces the old dice-roll tackle.
    pub(crate) fn contact_step(&mut self, dt: f32, rng: &mut Rng) {
        // A tackled carrier is falling: wait until he's down by contact.
        if self.falling {
            if let Some(c) = self.carrier {
                let (down, age, spot) = match self.physics.as_ref() {
                    Some(ph) => (ph.is_down(c), ph.age(c), ph.ball_spot(c)),
                    None => (true, 9.0, None),
                };
                if down || age > 2.2 {
                    let spot = spot.map(|s| s.xy()).unwrap_or(self.actors[c].p);
                    let sack = self.fall_sack && (spot.x - self.los_x) * self.dir < 0.0;
                    self.finish_down(spot, sack);
                }
            }
            return;
        }
        if self.fumble {
            self.fumble_step(dt, rng);
            return;
        }
        let Some(c) = self.carrier else { return };
        if !self.wraps.is_empty() {
            self.update_wraps(c, dt, rng);
            if self.falling || self.fumble {
                return;
            }
        }
        self.new_contacts(c, rng);
    }

    fn new_contacts(&mut self, c: usize, rng: &mut Rng) {
        let ca = self.actors[c].clone();
        let cfwd = if ca.v.len() > 0.3 { ca.v.norm() } else { ca.facing_v() };
        let airborne = ca.mv == Move::Hurdle && ca.z > 0.2;
        let in_pocket = c == QB && self.qb_in_pocket();
        let gang = (0..N).filter(|&j| {
            let o = &self.actors[j];
            o.team != ca.team && o.upright() && self.gap(j, c) < 0.9
        }).count();

        for j in 0..N {
            {
                let o = &self.actors[j];
                if o.team == ca.team || o.tackle_cd > 0.0 || o.stun > 0.0 || o.wrapping || o.ragdoll {
                    continue;
                }
                let diving = o.mv == Move::Dive;
                if !o.upright() && !diving {
                    continue;
                }
                // Reach is measured from the edges of the two pucks.
                let reach = if diving { 0.9 } else { crate::puck::REACH };
                if self.gap(j, c) > reach {
                    continue;
                }
            }
            let o = self.actors[j].clone();
            let diving = o.mv == Move::Dive;
            let to_def = (o.p - ca.p).norm();
            let front = cfwd.dot(to_def) > 0.3;
            let behind = cfwd.dot(to_def) < -0.4;
            let closing = (o.v - ca.v).dot((ca.p - o.p).norm()).max(0.0);
            self.actors[j].tackle_cd = 0.45;

            // Truck: lower the shoulder into a defender in front.
            if ca.mv == Move::Truck && ca.move_t > 0.0 && front {
                let push = ca.r.strength as f32 + ca.v.len() * 4.0 - o.r.strength as f32 * 0.9 - o.r.tackle as f32 * 0.3;
                if rng.chance(clamp(push / 60.0 + 0.35, 0.05, 0.85)) {
                    let away = to_def;
                    self.ragdollize(j, -0.35, o.v * 0.3);
                    let dv = away * (ca.v.len().max(3.0) * ca.mass / (ca.mass + o.mass));
                    self.physics_mut().nudge(j, V3::new(dv.x, dv.y, 0.8), o.mass * 0.8);
                    self.actors[c].v = self.actors[c].v * 0.7;
                    self.events.push(Event::Truck);
                    self.events.push(Event::Tackle { big: true });
                    continue;
                }
            }

            let mut p = 0.66 + (o.r.tackle as f32 - 60.0) * 0.008;
            let eva = ca.r.strength as f32 * 0.4 + ca.r.agility as f32 * 0.35 + ca.r.carrying as f32 * 0.25;
            p -= (eva - 60.0) * 0.006;
            p += closing * 0.025;
            if behind {
                p += 0.08;
            }
            if o.engaged.is_some() {
                // Still fighting a block: only an arm tackle.
                p -= 0.45;
            }
            if diving {
                p += 0.1;
            }
            p += gang.saturating_sub(1) as f32 * 0.12;
            if in_pocket {
                p += 0.12;
            }
            if ca.move_t > 0.0 {
                let ag = ca.r.agility as f32 / 99.0;
                match ca.mv {
                    Move::Juke if front => p -= 0.38 * ag,
                    Move::Spin if !front => p -= 0.32 * ag,
                    Move::Spin => p -= 0.15 * ag,
                    Move::Stiff if front => {
                        let w = clamp((ca.r.strength as f32 - o.r.strength as f32 + 45.0) / 80.0, 0.0, 1.0);
                        p -= 0.45 * w;
                    }
                    _ => {}
                }
            }
            if airborne {
                // Hurdles beat diving tacklers, but an upright hit in the air upends you.
                if diving {
                    p *= 0.25;
                } else {
                    p += 0.1;
                }
            }
            p = clamp(p, 0.05, 0.97);

            if rng.chance(p) {
                let hit_power = closing * o.mass / 100.0;
                let big = airborne || (!behind && closing > 5.5 && rng.chance(clamp(0.25 + (o.r.tackle as f32 - 60.0) * 0.01 + (hit_power - 6.0) * 0.08, 0.05, 0.85)));
                self.last_tackler = Some(j);
                if big || in_pocket && closing > 4.0 {
                    self.take_down(c, Some(j), true, closing, rng);
                    return;
                }
                // Wrap-up: hang on and drag him down.
                self.wraps.push(j);
                let off = (o.p - ca.p).clamp_len(0.7);
                let off = if off.len() < 0.45 { to_def * 0.55 } else { off };
                let a = &mut self.actors[j];
                a.wrapping = true;
                a.wrap_off = off;
                a.engaged = None;
                a.mv = Move::None;
                self.balance -= 0.15 + closing * 0.03;
                let slow = if diving { 0.45 } else { 0.6 };
                self.actors[c].v = self.actors[c].v * slow;
                self.events.push(Event::Wrap);
                if self.balance <= 0.0 {
                    self.take_down(c, None, false, closing, rng);
                    return;
                }
            } else {
                self.events.push(Event::BrokenTackle);
                self.actors[j].stun = 0.45 + rng.f32() * 0.4;
                if diving {
                    self.actors[j].ground = 1.0;
                }
                self.actors[c].v = self.actors[c].v * 0.8;
                self.actors[c].stagger = 0.35;
                if ca.mv == Move::Stiff && front {
                    self.actors[j].v = to_def * 3.0;
                }
            }
        }
    }

    /// Carrier dragging tacklers: balance drains, he may break free.
    fn update_wraps(&mut self, c: usize, dt: f32, rng: &mut Rng) {
        let ca = self.actors[c].clone();
        let td = self.team_dir(ca.team);
        let fwd_speed = (ca.v.x * td).max(0.0);
        let cf = 0.5 + ca.r.strength as f32 / 150.0 + fwd_speed / 30.0;
        let mut tf_sum = 0.0;
        let mut freed = Vec::new();
        for &t in &self.wraps {
            let o = &self.actors[t];
            tf_sum += 0.5 + o.r.tackle as f32 / 200.0 + o.r.strength as f32 / 250.0;
            let mut p_break = clamp(0.25 * (ca.r.strength as f32 - o.r.strength as f32 + 30.0) / 60.0, 0.02, 0.5);
            if ca.mv == Move::Spin && ca.move_t > 0.0 {
                p_break *= 3.0;
            }
            if ca.mv == Move::Stiff && ca.move_t > 0.0 {
                p_break *= 2.0;
            }
            if self.wraps.len() > 1 {
                p_break *= 0.5;
            }
            if rng.chance(p_break * dt) {
                freed.push(t);
            }
        }
        for t in freed {
            self.wraps.retain(|&w| w != t);
            let a = &mut self.actors[t];
            a.wrapping = false;
            a.stun = 0.8;
            a.ground = 0.9;
            self.events.push(Event::BrokenTackle);
            self.actors[c].stagger = 0.4;
        }
        let pocket = if c == QB && self.qb_in_pocket() { 1.8 } else { 1.0 };
        self.balance -= dt * 1.6 * tf_sum / cf * pocket;
        // Wrapped defenders ride along.
        let cp = self.actors[c].p;
        let cv = self.actors[c].v;
        for &t in &self.wraps.clone() {
            let a = &mut self.actors[t];
            a.p = cp + a.wrap_off;
            a.v = cv;
            a.facing = (-a.wrap_off).angle();
            a.anim = Anim::Wrap;
        }
        if self.balance <= 0.0 {
            self.take_down(c, None, false, 0.0, rng);
        }
    }

    /// The carrier goes down: ragdoll him and everyone holding on.
    fn take_down(&mut self, c: usize, hitter: Option<usize>, big: bool, closing: f32, rng: &mut Rng) {
        let ca = self.actors[c].clone();
        self.falling = true;
        self.fall_sack = c == QB && self.qb_in_pocket();
        let td = self.team_dir(ca.team);
        let fwd_lean = if ca.v.x * td > 1.0 { 0.35 } else { 0.1 };
        self.ragdollize(c, fwd_lean, ca.v);
        let mut participants: Vec<usize> = self.wraps.clone();
        if let Some(h) = hitter {
            if !participants.contains(&h) {
                participants.push(h);
            }
        }
        // A few more nearby defenders pile on.
        for j in 0..N {
            let o = &self.actors[j];
            if participants.len() >= 3 {
                break;
            }
            if o.team != ca.team && o.upright() && !participants.contains(&j) && self.gap(j, c) < 0.6 && rng.chance(0.5) {
                participants.push(j);
            }
        }
        for &t in &participants {
            let o = self.actors[t].clone();
            let dir = (ca.p - o.p).norm();
            let dir = if dir.len_sq() > 0.0 { dir } else { V2::new(-td, 0.0) };
            let vel = if o.wrapping { ca.v } else { o.v };
            self.ragdollize(t, 0.55, vel);
            // Momentum transfer: how much the hit changes the carrier's velocity.
            let closing_t = if big { closing.max(3.0) } else { 1.2 };
            let share = o.mass / (o.mass + ca.mass);
            let dv = dir * (closing_t * share * if big { 0.8 } else { 0.5 });
            let topple = if big { o.mass * 0.9 } else { o.mass * 0.25 };
            self.physics_mut().nudge(c, V3::new(dv.x, dv.y, if big { 0.6 } else { 0.0 }), topple);
            // The tackler keeps a bit of his own momentum into the carrier.
            let back = dir * (0.6 * (1.0 - share));
            self.physics_mut().nudge(t, V3::new(back.x, back.y, 0.0), 0.0);
            if !big || o.wrapping {
                self.physics_mut().grab(t, c, Part::ForeArmL, Part::Pelvis);
                self.physics_mut().grab(t, c, Part::ForeArmR, Part::Torso);
            }
        }
        self.wraps.clear();
        if self.last_tackler.is_none() {
            self.last_tackler = participants.first().copied();
        }
        self.events.push(Event::Tackle { big });
        // Gang tackles can strip the ball.
        if !big && participants.len() >= 2 && !self.fall_sack {
            let carry = ca.r.carrying as f32;
            if rng.chance(0.05 * (1.35 - carry / 99.0)) {
                self.start_fumble(c, 2.0, rng);
                return;
            }
        }
        if big {
            self.events.push(Event::BigHit);
            // Big hits can knock the ball loose.
            let carry = ca.r.carrying as f32;
            let p_fum = 0.2 * (closing / 7.0).min(1.6) * (1.35 - carry / 99.0);
            if !self.fall_sack && rng.chance(p_fum) {
                self.start_fumble(c, closing, rng);
            } else if self.fall_sack && rng.chance(0.06) {
                self.start_fumble(c, closing, rng);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Fumbles
    // -----------------------------------------------------------------------

    fn start_fumble(&mut self, c: usize, closing: f32, rng: &mut Rng) {
        let pos = self.actors[c].p;
        let away = if self.actors[c].v.len() > 0.1 { self.actors[c].v.norm() } else { V2::new(self.team_dir(self.actors[c].team), 0.0) };
        let v = away * (2.0 + closing * 0.3) + V2::new(rng.normal() * 1.5, rng.normal() * 1.5);
        self.fumble_vel = V3::new(v.x, v.y, 3.0 + rng.f32() * 2.0);
        self.ball = Ball::Air { pos: V3::new(pos.x, pos.y, 1.1), vel: self.fumble_vel, target: pos, intended: None, arrive: 0.0, t: 0.0 };
        self.fumble = true;
        self.fumble_t = 0.0;
        self.falling = false;
        self.fumble_team = self.actors[c].team;
        self.carrier = None;
        self.events.push(Event::Fumble);
        self.events.push(Event::Banner { text: "FUMBLE!".into(), style: "bad".into() });
        for k in 0..N {
            let a = &self.actors[k];
            if !a.ragdoll && a.p.dist(pos) < 18.0 {
                self.actors[k].task = Task::Fetch;
                self.actors[k].engaged = None;
            }
        }
        if let Some(ut) = self.user_team {
            let mine = (0..N).filter(|&k| self.actors[k].team == ut && !self.actors[k].ragdoll).min_by(|&a, &b| {
                self.actors[a].p.dist(pos).partial_cmp(&self.actors[b].p.dist(pos)).unwrap()
            });
            self.user = mine;
            self.user_touched = false;
        }
    }

    fn fumble_step(&mut self, dt: f32, rng: &mut Rng) {
        let Ball::Air { mut pos, .. } = self.ball.clone() else { return };
        self.fumble_t += dt;
        let mut vel = self.fumble_vel;
        pos = pos + vel * dt;
        vel.z -= GRAVITY * dt;
        if pos.z <= 0.0 {
            pos.z = 0.0;
            if vel.z.abs() > 1.2 {
                // Footballs bounce funny.
                vel.z = vel.z.abs() * 0.5;
                vel.x = vel.x * 0.6 + rng.normal() * 1.2;
                vel.y = vel.y * 0.6 + rng.normal() * 1.2;
            } else {
                vel.z = 0.0;
                let h = V2::new(vel.x, vel.y);
                let s = h.len();
                let n = if s > 0.0 { h * ((s - 5.0 * dt).max(0.0) / s) } else { h };
                vel.x = n.x;
                vel.y = n.y;
            }
        }
        self.fumble_vel = vel;
        self.ball = Ball::Air { pos, vel, target: pos.xy(), intended: None, arrive: 0.0, t: 0.0 };
        let team = self.fumble_team;

        if pos.y < 0.0 || pos.y > FIELD_W || pos.x < 0.0 || pos.x > FIELD_LEN {
            let spot = V2::new(clamp(pos.x, 0.0, FIELD_LEN), clamp(pos.y, 0.0, FIELD_W));
            self.fumble = false;
            self.events.push(Event::OutOfBounds);
            self.end_play(EndKind::OutOfBounds, spot, team, "The fumble rolls out of bounds.".into());
            return;
        }
        if pos.z < 1.0 && self.fumble_t > 0.25 {
            let mut best: Option<(usize, f32)> = None;
            for k in 0..N {
                let a = &self.actors[k];
                if !a.upright() || a.ragdoll {
                    continue;
                }
                let d = a.p.dist(pos.xy());
                if d < 0.9 && best.map(|b| d < b.1).unwrap_or(true) {
                    best = Some((k, d));
                }
            }
            if let Some((k, _)) = best {
                let skill = self.actors[k].r.awareness as f32 / 99.0;
                if rng.chance((0.25 + skill * 0.25) * dt * 8.0) {
                    self.recover_fumble(k, pos);
                    return;
                }
            }
        }
        if self.fumble_t > 4.0 {
            let spot = pos.xy();
            self.fumble = false;
            self.end_play(EndKind::Down, spot, team, "The ball is dead.".into());
        }
    }

    fn recover_fumble(&mut self, k: usize, pos: V3) {
        let team = self.actors[k].team;
        self.fumble = false;
        self.ball = Ball::Held(k);
        self.carrier = Some(k);
        self.poss_team = team;
        self.actors[k].task = Task::Carrier;
        self.balance = 1.0;
        let td = self.team_dir(team);
        let own_goal = if td > 0.0 { 10.0 } else { 110.0 };
        self.int_in_endzone = (pos.x - own_goal) * td < 0.0;
        let name = self.actors[k].name.clone();
        if team != self.fumble_team {
            self.fumble_lost = true;
            self.events.push(Event::Banner { text: "FUMBLE RECOVERED!".into(), style: if Some(team) == self.user_team { "good".into() } else { "bad".into() } });
        }
        self.events.push(Event::Ticker { text: format!("Fumble recovered by {}.", name) });
        if let Some(ut) = self.user_team {
            self.user = if ut == team { Some(k) } else { self.nearest_opponent(k, false) };
            self.user_touched = false;
        }
        self.set_react_all(team);
    }

    /// Returners' blockers go find a cover man while the kick is in the air.
    pub(crate) fn return_block_desire(&self, i: usize, home: V2) -> V2 {
        let a = &self.actors[i];
        let Some(sp) = self.special.as_ref() else { return arrive(a.p, home, a.top * 0.9) };
        if !sp.kicked {
            return arrive(a.p, home, a.top * 0.9);
        }
        let land = sp.land;
        let threat = (0..N)
            .filter(|&j| self.actors[j].team != a.team && self.actors[j].upright() && self.actors[j].engaged.is_none() && j != QB)
            .map(|j| (j, self.actors[j].p.dist(a.p)))
            .filter(|&(_, d)| d < 10.0)
            .min_by(|x, y| x.1.partial_cmp(&y.1).unwrap());
        match threat {
            Some((j, _)) => seek(a.p, self.intercept_point(i, j, land), a.top),
            None => arrive(a.p, home, a.top * 0.9),
        }
    }

    /// Spot of the ball for the camera / ticker when a carrier is a ragdoll.
    pub(crate) fn ragdoll_ball(&self, c: usize) -> Option<V3> {
        self.physics.as_ref().and_then(|ph| ph.ball_spot(c))
    }
}
