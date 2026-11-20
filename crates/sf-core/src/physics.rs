//! Ragdoll physics for tackles (Rapier).
//!
//! When a tackle is completed, the ball carrier and the tacklers become physical ragdolls:
//! 11 rigid bodies per player connected by joints with human-ish limits. Momentum, hit
//! angle and grab joints between tacklers and the carrier decide how they fall and pile
//! up, and the carrier is ruled down when a knee, hip, torso or head touches the turf.
//!
//! Coordinates are the core's (yards, z up). Each body's rest orientation is the
//! player's facing frame (x forward, y left, z up), so a body's rotation is directly
//! the world rotation of the matching skeleton bone.

use crate::math::{V2, V3};
use rapier3d::prelude::*;
use rapier3d::glamx::{Quat, Vec3};

pub const PARTS: usize = 11;
/// Floats per ragdoll in the render buffer: actor index + 11 × (pos xyz + quat xyzw).
pub const RAGDOLL_STRIDE: usize = 1 + PARTS * 7;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Part {
    Pelvis = 0,
    Torso,
    Head,
    UpperArmL,
    ForeArmL,
    UpperArmR,
    ForeArmR,
    ThighL,
    ShinL,
    ThighR,
    ShinR,
}

#[derive(Clone, Copy)]
enum Shape {
    Box(f32, f32, f32),
    Capsule(f32, f32),
    Ball(f32),
}

struct PartDef {
    center: [f32; 3],
    shape: Shape,
    mass: f32,
    parent: Option<usize>,
    anchor: [f32; 3],
    /// (AngX, AngY, AngZ) symmetric-ish limits as [min, max].
    limits: [[f32; 2]; 3],
}

const fn p(center: [f32; 3], shape: Shape, mass: f32, parent: Option<usize>, anchor: [f32; 3], limits: [[f32; 2]; 3]) -> PartDef {
    PartDef { center, shape, mass, parent, anchor, limits }
}

const SHOULDER: [[f32; 2]; 3] = [[-1.8, 1.8], [-2.6, 1.2], [-1.2, 1.2]];
const ELBOW: [[f32; 2]; 3] = [[-0.15, 0.15], [-2.4, 0.05], [-0.3, 0.3]];
const HIP: [[f32; 2]; 3] = [[-0.6, 0.6], [-1.9, 0.8], [-0.5, 0.5]];
const KNEE: [[f32; 2]; 3] = [[-0.1, 0.1], [-0.05, 2.4], [-0.15, 0.15]];

/// Rest pose, player facing +x at the origin (feet on the ground).
const DEFS: [PartDef; PARTS] = [
    p([0.0, 0.0, 1.0], Shape::Box(0.13, 0.19, 0.12), 0.16, None, [0.0; 3], [[0.0; 2]; 3]),
    p([0.0, 0.0, 1.40], Shape::Box(0.14, 0.25, 0.27), 0.33, Some(0), [0.0, 0.0, 1.12], [[-0.45, 0.45], [-0.6, 0.9], [-0.5, 0.5]]),
    p([0.0, 0.0, 1.93], Shape::Ball(0.16), 0.08, Some(1), [0.0, 0.0, 1.78], [[-0.5, 0.5], [-0.6, 0.7], [-0.9, 0.9]]),
    p([0.0, 0.31, 1.51], Shape::Capsule(0.085, 0.065), 0.035, Some(1), [0.0, 0.31, 1.66], SHOULDER),
    p([0.0, 0.31, 1.22], Shape::Capsule(0.09, 0.05), 0.025, Some(3), [0.0, 0.31, 1.36], ELBOW),
    p([0.0, -0.31, 1.51], Shape::Capsule(0.085, 0.065), 0.035, Some(1), [0.0, -0.31, 1.66], SHOULDER),
    p([0.0, -0.31, 1.22], Shape::Capsule(0.09, 0.05), 0.025, Some(5), [0.0, -0.31, 1.36], ELBOW),
    p([0.0, 0.11, 0.745], Shape::Capsule(0.145, 0.09), 0.11, Some(0), [0.0, 0.11, 0.98], HIP),
    p([0.0, 0.11, 0.30], Shape::Capsule(0.155, 0.065), 0.06, Some(7), [0.0, 0.11, 0.51], KNEE),
    p([0.0, -0.11, 0.745], Shape::Capsule(0.145, 0.09), 0.11, Some(0), [0.0, -0.11, 0.98], HIP),
    p([0.0, -0.11, 0.30], Shape::Capsule(0.155, 0.065), 0.06, Some(9), [0.0, -0.11, 0.51], KNEE),
];

fn volume(s: Shape) -> f32 {
    use std::f32::consts::PI;
    match s {
        Shape::Box(x, y, z) => 8.0 * x * y * z,
        Shape::Capsule(hh, r) => PI * r * r * 2.0 * hh + 4.0 / 3.0 * PI * r * r * r,
        Shape::Ball(r) => 4.0 / 3.0 * PI * r * r * r,
    }
}

fn v3(a: [f32; 3]) -> Vec3 {
    Vec3::new(a[0], a[1], a[2])
}

pub struct Ragdoll {
    pub actor: usize,
    pub bodies: [RigidBodyHandle; PARTS],
    pub age: f32,
}

pub struct Physics {
    world: PhysicsWorld,
    pub ragdolls: Vec<Ragdoll>,
}

/// Initial state of a player becoming a ragdoll.
pub struct RagdollStart {
    pub actor: usize,
    pub pos: V2,
    pub z: f32,
    pub facing: f32,
    /// Forward lean in radians (positive = leaning forward).
    pub lean: f32,
    pub vel: V2,
    pub mass: f32,
}

impl Default for Physics {
    fn default() -> Self {
        Self::new()
    }
}

impl Physics {
    pub fn new() -> Self {
        let mut world = PhysicsWorld::new();
        world.gravity = Vec3::new(0.0, 0.0, -crate::sim::GRAVITY);
        world.integration_parameters.dt = 1.0 / 60.0;
        // Turf: a big fixed slab whose top is z = 0.
        let ground = world.bodies.insert(RigidBodyBuilder::fixed().translation(Vec3::new(60.0, 26.67, -1.0)).build());
        let col = ColliderBuilder::cuboid(200.0, 200.0, 1.0).friction(0.85).restitution(0.05).build();
        world.colliders.insert_with_parent(col, ground, &mut world.bodies);
        Physics { world, ragdolls: Vec::new() }
    }

    pub fn has(&self, actor: usize) -> bool {
        self.ragdolls.iter().any(|r| r.actor == actor)
    }

    /// Turn a player into a ragdoll.
    pub fn spawn(&mut self, s: &RagdollStart) {
        if self.has(s.actor) {
            return;
        }
        let rot = Quat::from_rotation_z(s.facing) * Quat::from_rotation_y(s.lean);
        let base = Vec3::new(s.pos.x, s.pos.y, s.z);
        let vel = Vec3::new(s.vel.x, s.vel.y, 0.0);
        let mut handles = [RigidBodyHandle::invalid(); PARTS];
        for (i, d) in DEFS.iter().enumerate() {
            let c = base + rot * v3(d.center);
            let (axis, angle) = rot.to_axis_angle();
            let body = RigidBodyBuilder::dynamic()
                .translation(c)
                .rotation(axis * angle)
                .linvel(vel)
                .linear_damping(0.15)
                .angular_damping(1.2)
                .can_sleep(true)
                .build();
            let h = self.world.bodies.insert(body);
            let density = s.mass * d.mass / volume(d.shape);
            let col = match d.shape {
                Shape::Box(x, y, z) => ColliderBuilder::cuboid(x, y, z),
                Shape::Capsule(hh, r) => ColliderBuilder::capsule_z(hh, r),
                Shape::Ball(r) => ColliderBuilder::ball(r),
            }
            .density(density)
            .friction(0.8)
            .restitution(0.02)
            .build();
            self.world.colliders.insert_with_parent(col, h, &mut self.world.bodies);
            handles[i] = h;
        }
        for (i, d) in DEFS.iter().enumerate() {
            let Some(par) = d.parent else { continue };
            let pd = &DEFS[par];
            let mut j = SphericalJointBuilder::new()
                .local_anchor1(v3(d.anchor) - v3(pd.center))
                .local_anchor2(v3(d.anchor) - v3(d.center))
                .contacts_enabled(false);
            for (k, ax) in [JointAxis::AngX, JointAxis::AngY, JointAxis::AngZ].into_iter().enumerate() {
                j = j.limits(ax, d.limits[k]);
            }
            self.world.impulse_joints.insert(handles[par], handles[i], j.build(), true);
        }
        self.ragdolls.push(Ragdoll { actor: s.actor, bodies: handles, age: 0.0 });
    }

    fn ragdoll(&self, actor: usize) -> Option<&Ragdoll> {
        self.ragdolls.iter().find(|r| r.actor == actor)
    }

    /// Push a body part (e.g. the hit on the chest).
    pub fn impulse(&mut self, actor: usize, part: Part, j: V3, at_height: Option<f32>) {
        let Some(h) = self.ragdoll(actor).map(|r| r.bodies[part as usize]) else { return };
        if let Some(b) = self.world.bodies.get_mut(h) {
            let imp = Vec3::new(j.x, j.y, j.z);
            match at_height {
                Some(z) => {
                    let mut pt = b.translation();
                    pt.z = z;
                    b.apply_impulse_at_point(imp, pt, true);
                }
                None => b.apply_impulse(imp, true),
            }
        }
    }

    /// Change a whole ragdoll's velocity by `dv` (momentum transfer from a hit), plus a
    /// small topple impulse at chest height in the same direction.
    pub fn nudge(&mut self, actor: usize, dv: V3, topple: f32) {
        let Some(r) = self.ragdolls.iter().find(|r| r.actor == actor) else { return };
        let handles = r.bodies;
        let d = Vec3::new(dv.x, dv.y, dv.z);
        for h in handles {
            if let Some(b) = self.world.bodies.get_mut(h) {
                let m = b.mass();
                b.apply_impulse(d * m, true);
            }
        }
        if topple != 0.0 {
            if let Some(b) = self.world.bodies.get_mut(handles[Part::Torso as usize]) {
                let mut pt = b.translation();
                pt.z += 0.2;
                let flat = Vec3::new(dv.x, dv.y, 0.0).normalize_or_zero();
                b.apply_impulse_at_point(flat * topple, pt, true);
            }
        }
    }

    /// Tackler grabs the carrier: join the tackler's hand to the carrier's body where they are.
    pub fn grab(&mut self, tackler: usize, carrier: usize, hand: Part, target: Part) {
        let (Some(a), Some(b)) = (self.ragdoll(tackler), self.ragdoll(carrier)) else { return };
        let (ha, hb) = (a.bodies[hand as usize], b.bodies[target as usize]);
        let (Some(ba), Some(bb)) = (self.world.bodies.get(ha), self.world.bodies.get(hb)) else { return };
        // Hand point: the far end of the forearm capsule.
        let hand_world = ba.translation() + *ba.rotation() * Vec3::new(0.0, 0.0, -0.13);
        let local_a = Vec3::new(0.0, 0.0, -0.13);
        let local_b = bb.rotation().inverse() * (hand_world - bb.translation());
        // Don't let it reach through the body: clamp to the body's surface region.
        let local_b = local_b.clamp(Vec3::splat(-0.3), Vec3::splat(0.3));
        let j = SphericalJointBuilder::new().local_anchor1(local_a).local_anchor2(local_b).contacts_enabled(true);
        self.world.impulse_joints.insert(ha, hb, j.build(), true);
    }

    pub fn step(&mut self, dt: f32) {
        if self.ragdolls.is_empty() {
            return;
        }
        self.world.integration_parameters.dt = dt;
        self.world.step();
        for r in self.ragdolls.iter_mut() {
            r.age += dt;
        }
    }

    fn body_pose(&self, h: RigidBodyHandle) -> Option<(Vec3, Quat)> {
        self.world.bodies.get(h).map(|b| (b.translation(), *b.rotation()))
    }

    /// Ground position of a ragdoll (pelvis), for gameplay and the camera.
    pub fn pelvis(&self, actor: usize) -> Option<V3> {
        let r = self.ragdoll(actor)?;
        let (t, _) = self.body_pose(r.bodies[Part::Pelvis as usize])?;
        Some(V3::new(t.x, t.y, t.z))
    }

    /// Where the tucked ball is: in front of the chest.
    pub fn ball_spot(&self, actor: usize) -> Option<V3> {
        let r = self.ragdoll(actor)?;
        let (t, q) = self.body_pose(r.bodies[Part::Torso as usize])?;
        let b = t + q * Vec3::new(0.22, -0.12, -0.05);
        Some(V3::new(b.x, b.y, b.z.max(0.1)))
    }

    /// Down by contact: a knee, hip, torso, elbow or head is touching the ground.
    pub fn is_down(&self, actor: usize) -> bool {
        let Some(r) = self.ragdoll(actor) else { return false };
        let z = |part: Part, local: Vec3| -> f32 {
            self.body_pose(r.bodies[part as usize]).map(|(t, q)| (t + q * local).z).unwrap_or(9.0)
        };
        let knee = |shin: Part| z(shin, Vec3::new(0.0, 0.0, 0.2));
        let elbow = |fore: Part| z(fore, Vec3::new(0.0, 0.0, 0.13));
        z(Part::Pelvis, Vec3::ZERO) < 0.3
            || z(Part::Torso, Vec3::ZERO) < 0.32
            || z(Part::Head, Vec3::ZERO) < 0.24
            || knee(Part::ShinL) < 0.09
            || knee(Part::ShinR) < 0.09
            || elbow(Part::ForeArmL) < 0.07
            || elbow(Part::ForeArmR) < 0.07
    }

    pub fn age(&self, actor: usize) -> f32 {
        self.ragdoll(actor).map(|r| r.age).unwrap_or(0.0)
    }

    /// Render buffer: for each ragdoll, actor index then per part pos (x,y,z) + quat (x,y,z,w).
    pub fn write(&self, out: &mut Vec<f32>) {
        out.clear();
        for r in &self.ragdolls {
            out.push(r.actor as f32);
            for h in r.bodies {
                let (t, q) = self.body_pose(h).unwrap_or((Vec3::ZERO, Quat::IDENTITY));
                out.extend_from_slice(&[t.x, t.y, t.z, q.x, q.y, q.z, q.w]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ragdoll_falls_and_is_ruled_down() {
        let mut ph = Physics::new();
        ph.spawn(&RagdollStart { actor: 3, pos: V2::new(50.0, 26.0), z: 0.0, facing: 0.0, lean: 0.35, vel: V2::new(6.0, 0.0), mass: 100.0 });
        ph.impulse(3, Part::Torso, V3::new(-30.0, 10.0, 0.0), Some(1.5));
        let start = ph.pelvis(3).unwrap();
        let mut down_at = None;
        for i in 0..240 {
            ph.step(1.0 / 60.0);
            if down_at.is_none() && ph.is_down(3) {
                down_at = Some(i);
            }
        }
        let end = ph.pelvis(3).unwrap();
        assert!(down_at.is_some(), "ragdoll never went down");
        assert!(end.z < 0.6, "pelvis should be near the ground, z = {}", end.z);
        assert!(end.x.is_finite() && end.y.is_finite());
        assert!((end.x - start.x).abs() < 6.0, "flew too far: {:?} -> {:?}", start, end);
        let mut buf = Vec::new();
        ph.write(&mut buf);
        assert_eq!(buf.len(), RAGDOLL_STRIDE);
        assert!(buf.iter().all(|v| v.is_finite()));
    }
}
