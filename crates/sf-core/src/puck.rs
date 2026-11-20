//! The puck engine.
//!
//! Every player's true state is a circle on the turf: a puck with a radius, a mass, a
//! position and a velocity. Movement, collisions, blocking and tackle reach all run on
//! the pucks, and the animated body is drawn on top of its puck. Animation never moves a
//! player; only forces and accelerations do, so momentum is always kept.
//!
//! * Pucks can't overlap. When opponents meet, they exchange momentum (a nearly
//!   inelastic bump), so a heavy player running into a light one moves him. Teammates
//!   just slide past each other.
//! * Blocking is a fight between two pucks in contact. Along the line between them they
//!   push (strength and technique against the opponent's), which decides whether the
//!   pocket collapses or the run lane opens. Across that line the defender works for
//!   leverage while the blocker mirrors him. A defender sheds the block only when he
//!   physically wins the edge (his circle gets past the blocker's shoulder) or slips off
//!   to make a tackle.
//! * Pass-rush moves are physical: a swim or spin is a burst of lateral speed while the
//!   blocker's hands are knocked away, and a bull rush is a burst of drive.

use crate::contact::RushMove;
use crate::events::Event;
use crate::math::*;
use crate::player::Pos;
use crate::rng::Rng;
use crate::sim::*;

/// Arm's reach beyond the edge of a player's circle (tackles and blocks).
pub const REACH: f32 = 0.26;

/// Puck radius in yards from the player's position and strength.
pub fn radius_for(pos: Pos, strength: u8) -> f32 {
    let base = match pos {
        Pos::OL => 0.43,
        Pos::DL => 0.41,
        Pos::TE => 0.37,
        Pos::LB => 0.36,
        Pos::RB => 0.34,
        Pos::QB | Pos::S => 0.33,
        Pos::WR | Pos::CB => 0.31,
        Pos::K | Pos::P => 0.31,
    };
    base + (strength as f32 - 60.0) * 0.0006
}

/// Turn `facing` toward `target` at no more than `rate` radians per second.
pub(crate) fn turn_toward(facing: f32, target: f32, rate: f32, dt: f32) -> f32 {
    let diff = wrap_angle(target - facing);
    wrap_angle(facing + clamp(diff, -rate * dt, rate * dt))
}

impl Play {
    /// Distance between two players' circles (negative when overlapping).
    pub(crate) fn gap(&self, i: usize, j: usize) -> f32 {
        let (a, b) = (&self.actors[i], &self.actors[j]);
        a.p.dist(b.p) - a.radius - b.radius
    }

    /// Where a defender is trying to get: the quarterback in pass protection, otherwise
    /// the ball.
    pub(crate) fn defender_goal(&self) -> V2 {
        // Before the handoff on a run, the back is the real target.
        if !self.handoff && !self.is_pass() && self.special.is_none() && self.ball_holder() == Some(QB) {
            return self.actors[self.handoff_to].p;
        }
        match self.carrier {
            Some(c) => self.actors[c].p,
            None => self.focus(),
        }
    }

    /// Blocking angle: the point on `threat`'s path toward `goal` that blocker `i` can
    /// reach before he does, so the threat runs into the blocker's puck.
    pub(crate) fn intercept_point(&self, i: usize, threat: usize, goal: V2) -> V2 {
        let (a, o) = (&self.actors[i], &self.actors[threat]);
        let reach = a.radius + o.radius;
        let path = goal - o.p;
        let len = path.len().max(0.01);
        let dirp = path / len;
        let their_speed = o.v.len().max(o.top * 0.7);
        let my_speed = a.top * 0.92;
        let mut s = reach;
        while s < len - 0.8 {
            let pt = o.p + dirp * s;
            if a.p.dist(pt) / my_speed <= (s - reach) / their_speed + 0.12 {
                break;
            }
            s += 0.25;
        }
        o.p + dirp * s.min((len - 0.8).max(reach))
    }

    fn can_block(&self, b: usize) -> bool {
        let ba = &self.actors[b];
        let blocker = matches!(ba.task, Task::Block { .. } | Task::Escort | Task::ReturnBlock { .. })
            || matches!(&ba.task, Task::Route { delay, .. } if self.t < *delay);
        blocker && ba.engaged.is_none() && ba.upright() && ba.stun <= 0.0 && !ba.ragdoll && self.carrier != Some(b) && !self.screen_releasing(b)
    }

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------

    /// Keep pucks from overlapping and exchange momentum when they bump.
    pub(crate) fn puck_collisions(&mut self) {
        for i in 0..N {
            for j in (i + 1)..N {
                let (ai, aj) = (&self.actors[i], &self.actors[j]);
                if !ai.upright() || !aj.upright() || ai.ragdoll || aj.ragdoll || ai.wrapping || aj.wrapping {
                    continue;
                }
                let d = aj.p - ai.p;
                let dist = d.len();
                let min = ai.radius + aj.radius;
                if dist >= min || dist < 1e-4 {
                    continue;
                }
                let n = d / dist;
                let (mi, mj) = (ai.mass, aj.mass);
                let (wi, wj) = (mj / (mi + mj), mi / (mi + mj));
                let overlap = min - dist;
                // Momentum exchange along the contact normal (engaged pairs are already
                // driven together by the block, so they only get the positional fix).
                // Teammates see each other and slide past: they only get the positional fix.
                let engaged = ai.engaged == Some(j);
                // A defender whose tackle was just broken is falling off the runner.
                let shed = (self.carrier == Some(i) && aj.stun > 0.0) || (self.carrier == Some(j) && ai.stun > 0.0);
                let teammates = ai.team == aj.team || shed;
                let vn = (aj.v - ai.v).dot(n);
                let mut dvi = V2::ZERO;
                let mut dvj = V2::ZERO;
                if vn < 0.0 && !engaged && !teammates {
                    let e = 0.1;
                    let jimp = -(1.0 + e) * vn / (1.0 / mi + 1.0 / mj);
                    dvi = n * (-jimp / mi);
                    dvj = n * (jimp / mj);
                }
                let a = &mut self.actors[i];
                a.p -= n * (overlap * wi);
                a.v += dvi;
                let b = &mut self.actors[j];
                b.p += n * (overlap * wj);
                b.v += dvj;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Blocking
    // -----------------------------------------------------------------------

    pub(crate) fn blocking(&mut self, dt: f32, rng: &mut Rng) {
        let goal = self.defender_goal();
        let pass_pro = self.is_pass() && self.qb_in_pocket() && !self.thrown;

        // New engagements: the blocker's hands reach a defender while he's in his way.
        for b in 0..N {
            if !self.can_block(b) {
                continue;
            }
            let bteam = self.actors[b].team;
            for d in 0..N {
                let da = &self.actors[d];
                if da.team == bteam || da.engaged.is_some() || !da.upright() || da.ragdoll || da.wrapping || self.carrier == Some(d) {
                    continue;
                }
                if da.shed_cd > 0.0 && da.shed_from == Some(b) {
                    continue;
                }
                if self.gap(b, d) > REACH * 0.8 {
                    continue;
                }
                // The blocker has to be between the defender and where he wants to go.
                let to_goal = (goal - da.p).norm();
                let to_b = self.actors[b].p - da.p;
                let along = to_b.dot(to_goal);
                let lat = to_b.dot(to_goal.perp());
                let reach = self.actors[b].radius + da.radius;
                // Pass pro: squarely in front. Run blocks can also be angle blocks from the
                // side, as long as the blocker isn't behind him. (Margins are wider than the
                // shed tests below, so blocks don't flicker.)
                let dist = to_b.len().max(1e-3);
                let ok = if pass_pro { along > reach * 0.45 && lat.abs() < reach * 0.75 } else { along / dist > 0.17 };
                if !ok {
                    continue;
                }
                // The defender attacks the side the blocker is shading away from (edge
                // rushers prefer the outside).
                let lane_side = match da.task {
                    Task::Rush { lane } if lane != 0.0 => {
                        let out = V2::new(0.0, lane).dot(to_goal.perp());
                        if out > 0.0 { 1.0 } else { -1.0 }
                    }
                    _ => 0.0,
                };
                let side = if lat.abs() > 0.12 || lane_side == 0.0 {
                    if lat > 0.0 { -1.0 } else if lat < 0.0 { 1.0 } else if rng.chance(0.5) { 1.0 } else { -1.0 }
                } else {
                    lane_side
                };
                let da = &mut self.actors[d];
                da.engaged = Some(b);
                da.engage_t = 0.0;
                da.rush_side = side;
                let ba = &mut self.actors[b];
                ba.engaged = Some(d);
                ba.engage_t = 0.0;
                break;
            }
        }

        // Engaged pairs (processed once, from the blocker's side).
        let ball_team = self.carrier.map(|c| self.actors[c].team).unwrap_or(self.off_team);
        for b in 0..N {
            let Some(d) = self.actors[b].engaged else { continue };
            if self.actors[d].engaged != Some(b) || !self.actors[d].upright() || self.actors[d].ragdoll {
                self.actors[b].engaged = None;
                continue;
            }
            if self.screen_releasing(b) {
                self.release(b, d, false);
                continue;
            }
            if self.actors[b].team != ball_team {
                continue;
            }
            self.block_pair(b, d, goal, pass_pro, dt, rng);
        }
    }

    /// Break an engagement. `beaten`: the defender won, so the blocker lunges and stumbles.
    fn release(&mut self, b: usize, d: usize, beaten: bool) {
        self.actors[b].engaged = None;
        self.actors[d].engaged = None;
        self.actors[d].shed_cd = 0.8;
        self.actors[d].shed_from = Some(b);
        if beaten {
            self.actors[b].stun = 0.3;
        }
    }

    fn block_pair(&mut self, b: usize, d: usize, goal: V2, pass_pro: bool, dt: f32, rng: &mut Rng) {
        let (ba, da) = (&self.actors[b], &self.actors[d]);
        let (br, dr) = (ba.r, da.r);
        let reach = ba.radius + da.radius;
        let mut n = da.p - ba.p;
        if n.len_sq() < 1e-6 {
            n = (da.p - goal).norm();
        }
        let n = n.norm(); // blocker -> defender
        let t = n.perp();
        let to_goal = -n; // the defender's drive direction

        // ---- Ratings -------------------------------------------------------
        // Skill players can't sustain blocks on offense; special-teams units are built
        // from them, so there they block like everyone else.
        let skill_blocker = matches!(ba.pos, Pos::WR | Pos::RB | Pos::QB | Pos::CB | Pos::S | Pos::LB | Pos::K | Pos::P) && self.special.is_none();
        let rush_skill = if pass_pro { dr.pass_rush } else { dr.run_stop } as f32;
        let d_drive = rush_skill * 0.55 + dr.strength as f32 * 0.45;
        let mut b_drive = br.block as f32 * 0.6 + br.strength as f32 * 0.4;
        if skill_blocker {
            b_drive -= 12.0;
        }
        let finesse = (rush_skill * 0.6 + dr.agility as f32 * 0.4) / 99.0;
        let mirror = (br.block as f32 * 0.6 + br.agility as f32 * 0.4) / 99.0 * if skill_blocker { 0.75 } else { 1.0 };
        // Blocks wear down: after a few seconds the blocker can't keep mirroring.
        let et = ba.engage_t;
        let fatigue = if et > 1.3 { (1.0 - (et - 1.3) * 0.5).max(0.3) } else { 1.0 };
        let mass_edge = (da.mass - ba.mass) * 0.012;

        // ---- Push along the line between them -----------------------------
        // Positive: the pair moves toward the defender's goal (pocket collapsing / run
        // defender penetrating). Negative: the blocker drives him back.
        let bull = if da.drive_boost > 0.0 { 1.1 * (dr.strength as f32 + 30.0) / 99.0 } else { 0.0 };
        let push = if pass_pro {
            // The blocker sets and anchors; the rusher can only walk him back.
            let kick_slide = if et < 0.5 { 0.9 } else { 0.0 };
            clamp(0.3 + (d_drive - b_drive) * 0.03 + mass_edge + bull + kick_slide, 0.0, 2.4)
        } else {
            // Run blocks: the offense knows the snap count, so blockers fire off first.
            let fire_off = if et < 1.1 && self.special.is_none() && ba.team == self.off_team { -1.1 } else { 0.0 };
            clamp(-0.6 + (d_drive - b_drive) * 0.04 + mass_edge + bull + fire_off, -2.4, 2.2)
        };
        let ma = ba.mass + da.mass;
        let pair_vn = (ba.v * ba.mass + da.v * da.mass).dot(to_goal) / ma;
        let new_vn = approach(pair_vn, push, 6.0 * dt);

        // ---- Leverage across the line -------------------------------------
        let carrier_side = match self.carrier {
            Some(c) if !pass_pro => {
                let s = (self.actors[c].p - ba.p).dot(t);
                if s.abs() > 0.5 { s.signum() } else { self.actors[d].rush_side }
            }
            _ => self.actors[d].rush_side,
        };
        if !pass_pro {
            // Run defenders flow toward the ball.
            self.actors[d].rush_side = carrier_side;
        }
        let side = self.actors[d].rush_side;
        let (ba, da) = (&self.actors[b], &self.actors[d]);
        let d_vt = da.v.dot(t);
        let b_vt = ba.v.dot(t);
        let d_lat_speed = 0.9 + 2.2 * finesse;
        let d_lat_acc = da.acc * (0.3 + 0.45 * finesse);
        let mut new_dvt = approach(d_vt, side * d_lat_speed, d_lat_acc * dt);
        // The blocker wants the defender straight between him and the goal: mirror the
        // defender's lateral speed and close any offset.
        let ideal = da.p + (goal - da.p).norm() * reach;
        let err = (ideal - ba.p).dot(t);
        let hands = if ba.grip_off > 0.0 { 0.25 } else { 1.0 };
        let b_lat_speed = (1.3 + 3.0 * mirror) * fatigue;
        let b_lat_acc = ba.acc * (0.45 + 0.6 * mirror) * fatigue * hands;
        let b_want = clamp(err * 5.0 + d_vt * 0.8, -b_lat_speed, b_lat_speed);
        let mut new_bvt = approach(b_vt, b_want, b_lat_acc * dt);
        // Grip: the blocker's hands drag the defender along with him.
        let grip = (0.4 + 1.8 * br.block as f32 / 99.0) * hands * fatigue * if skill_blocker { 0.5 } else { 1.0 };
        let k = 1.0 - (-grip * dt).exp();
        let mean = (new_dvt * da.mass + new_bvt * ba.mass) / ma;
        new_dvt += (mean - new_dvt) * k;
        new_bvt += (mean - new_bvt) * k * 0.4;

        // Stay in contact: a small pull keeps the hands on (the collision pass keeps
        // them from overlapping).
        let gap = da.p.dist(ba.p) - reach;
        let close = clamp(gap * 4.0, 0.0, 1.5);
        let bv = to_goal * new_vn + t * new_bvt + n * close;
        let dv = to_goal * new_vn + t * new_dvt - n * close;

        let (bp, dp) = (ba.p, da.p);
        {
            let ba = &mut self.actors[b];
            ba.v = bv;
            ba.p = bp + bv * dt;
            ba.facing = crate::puck::turn_toward(ba.facing, n.angle(), 10.0, dt);
            ba.engage_t += dt;
        }
        {
            let da = &mut self.actors[d];
            da.v = dv;
            da.p = dp + dv * dt;
            da.facing = crate::puck::turn_toward(da.facing, (-n).angle(), 10.0, dt);
            da.engage_t += dt;
        }

        // ---- Did the defender get off the block? ---------------------------
        let (ba, da) = (&self.actors[b], &self.actors[d]);
        let rel = da.p - ba.p;
        let gap = rel.len() - reach;
        let (free, lat) = if pass_pro {
            // Pass rush: free once his circle is past the blocker's shoulder.
            let g = (goal - ba.p).norm();
            let along = rel.dot(g);
            let lat = (rel - g * along).len();
            (along > -0.25 * reach || lat > 0.92 * reach, lat)
        } else {
            // Run block: free once the blocker is no longer between him and the ball.
            let g = (goal - da.p).norm();
            let to_b = -rel;
            let cos = to_b.dot(g) / to_b.len().max(1e-3);
            (cos < -0.45, (to_b - g * to_b.dot(g)).len())
        };
        if free || gap > 0.45 {
            // Won the edge (or got pushed off): free.
            self.release(b, d, gap <= 0.45);
            return;
        }

        // Pass-rush moves: the user's on demand, the CPU's now and then.
        if pass_pro && da.rush_cd <= 0.0 && da.engage_t > 0.35 {
            let user_move = if self.user == Some(d) { self.user_rush.take() } else { None };
            let cpu_move = if self.user != Some(d) && rng.chance(dt * 0.85) {
                let power = dr.strength as f32 > dr.agility as f32 + 5.0;
                Some(if power && rng.chance(0.6) {
                    RushMove::Bull
                } else if rng.chance(0.6) {
                    RushMove::Swim
                } else {
                    RushMove::Spin
                })
            } else {
                None
            };
            if let Some(mv) = user_move.or(cpu_move) {
                if self.rush_move(d, b, mv, rng) {
                    return;
                }
            }
        }

        // Discrete decisions that aren't geometry: slipping off to make a tackle when the
        // ball comes to you, giving up on a block far from the play, skill players who
        // can't sustain.
        let mut p_off = 0.0;
        if skill_blocker {
            p_off += 0.45;
        }
        if let Some(c) = self.carrier {
            if c != QB || !self.qb_in_pocket() {
                let cd = self.actors[c].p.dist(self.actors[d].p);
                if cd < 2.4 {
                    p_off += 0.4 + 1.5 * dr.run_stop as f32 / 99.0 - 0.6 * br.block as f32 / 99.0;
                } else if cd > 7.0 {
                    p_off += 0.8;
                }
            }
        }
        if rng.chance(p_off.max(0.0) * dt) {
            self.release(b, d, false);
            return;
        }

        // Offensive holding: more likely when the blocker is getting beaten.
        if self.flags.is_empty() && self.actors[b].team == self.off_team && self.special.is_none() {
            let beat = (d_drive - b_drive).max(0.0) * 0.00035 + if lat > 0.7 * reach { 0.004 } else { 0.0 };
            let hazard = (0.0022 + beat) * self.penalty_rate;
            if rng.chance(hazard * dt) {
                let spot = self.actors[b].p;
                self.throw_flag(crate::sim::Foul::OffensiveHolding, b, spot);
            }
        }
    }

    /// Physical pass-rush moves. Returns true if the defender is free right away.
    pub(crate) fn rush_move(&mut self, d: usize, b: usize, mv: RushMove, rng: &mut Rng) -> bool {
        let (dr, br) = (self.actors[d].r, self.actors[b].r);
        let n = (self.actors[d].p - self.actors[b].p).norm();
        let t = n.perp();
        self.actors[d].rush_cd = 1.2;
        match mv {
            RushMove::Swim => {
                // Club the hands down and swim over: a lateral burst toward the edge.
                let side = self.actors[d].rush_side;
                let burst = 1.6 + 2.6 * (dr.agility as f32 * 0.5 + dr.pass_rush as f32 * 0.5) / 99.0;
                self.actors[d].v += t * (side * burst);
                self.actors[b].grip_off = 0.45 - br.block as f32 / 99.0 * 0.2;
            }
            RushMove::Spin => {
                // Spin back to the other shoulder.
                let side = -self.actors[d].rush_side;
                self.actors[d].rush_side = side;
                let burst = 1.8 + 2.8 * dr.agility as f32 / 99.0;
                self.actors[d].v += t * (side * burst);
                self.actors[b].grip_off = 0.4 - br.agility as f32 / 99.0 * 0.2;
            }
            RushMove::Bull => {
                // Drive through his chest.
                self.actors[d].drive_boost = 0.7;
                let edge = dr.strength as f32 - br.strength as f32 - br.block as f32 * 0.25;
                if edge > 0.0 && rng.chance(clamp(edge / 60.0, 0.0, 0.5)) {
                    // Knocked him back on his heels.
                    let away = -n;
                    self.actors[b].v += away * 1.5;
                    self.actors[b].stagger = 0.6;
                    self.actors[b].stun = 0.45;
                    self.release(b, d, false);
                    self.events.push(Event::Truck);
                    return true;
                }
            }
        }
        false
    }
}
