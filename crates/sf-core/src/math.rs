//! Small vector math. Units are yards and seconds.
//! The field is the x/y plane, and z is height above the grass.

use serde::{Deserialize, Serialize};
use std::ops::{Add, AddAssign, Div, Mul, Neg, Sub, SubAssign};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct V2 {
    pub x: f32,
    pub y: f32,
}

impl V2 {
    pub const ZERO: V2 = V2 { x: 0.0, y: 0.0 };

    #[inline]
    pub const fn new(x: f32, y: f32) -> Self {
        V2 { x, y }
    }
    #[inline]
    pub fn len_sq(self) -> f32 {
        self.x * self.x + self.y * self.y
    }
    #[inline]
    pub fn len(self) -> f32 {
        self.len_sq().sqrt()
    }
    #[inline]
    pub fn dist(self, o: V2) -> f32 {
        (self - o).len()
    }
    #[inline]
    pub fn dot(self, o: V2) -> f32 {
        self.x * o.x + self.y * o.y
    }
    /// Unit vector in the same direction, or zero for a (near) zero vector.
    #[inline]
    pub fn norm(self) -> V2 {
        let l = self.len();
        if l > 1e-6 {
            self / l
        } else {
            V2::ZERO
        }
    }
    /// Rotate 90 degrees counter-clockwise.
    #[inline]
    pub fn perp(self) -> V2 {
        V2::new(-self.y, self.x)
    }
    #[inline]
    pub fn clamp_len(self, max: f32) -> V2 {
        let l = self.len();
        if l > max && l > 1e-6 {
            self * (max / l)
        } else {
            self
        }
    }
    #[inline]
    pub fn angle(self) -> f32 {
        self.y.atan2(self.x)
    }
    #[inline]
    pub fn from_angle(a: f32) -> V2 {
        V2::new(a.cos(), a.sin())
    }
    #[inline]
    pub fn lerp(self, o: V2, t: f32) -> V2 {
        self + (o - self) * t
    }
}

impl Add for V2 {
    type Output = V2;
    fn add(self, o: V2) -> V2 {
        V2::new(self.x + o.x, self.y + o.y)
    }
}
impl Sub for V2 {
    type Output = V2;
    fn sub(self, o: V2) -> V2 {
        V2::new(self.x - o.x, self.y - o.y)
    }
}
impl Mul<f32> for V2 {
    type Output = V2;
    fn mul(self, s: f32) -> V2 {
        V2::new(self.x * s, self.y * s)
    }
}
impl Div<f32> for V2 {
    type Output = V2;
    fn div(self, s: f32) -> V2 {
        V2::new(self.x / s, self.y / s)
    }
}
impl Neg for V2 {
    type Output = V2;
    fn neg(self) -> V2 {
        V2::new(-self.x, -self.y)
    }
}
impl AddAssign for V2 {
    fn add_assign(&mut self, o: V2) {
        self.x += o.x;
        self.y += o.y;
    }
}
impl SubAssign for V2 {
    fn sub_assign(&mut self, o: V2) {
        self.x -= o.x;
        self.y -= o.y;
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct V3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl V3 {
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        V3 { x, y, z }
    }
    pub fn xy(self) -> V2 {
        V2::new(self.x, self.y)
    }
    pub fn from_xy(v: V2, z: f32) -> Self {
        V3::new(v.x, v.y, z)
    }
}

impl Add for V3 {
    type Output = V3;
    fn add(self, o: V3) -> V3 {
        V3::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}
impl Mul<f32> for V3 {
    type Output = V3;
    fn mul(self, s: f32) -> V3 {
        V3::new(self.x * s, self.y * s, self.z * s)
    }
}

/// Wrap an angle to (-PI, PI].
pub fn wrap_angle(a: f32) -> f32 {
    use std::f32::consts::{PI, TAU};
    if !a.is_finite() {
        return 0.0;
    }
    let w = (a + PI).rem_euclid(TAU) - PI;
    if w <= -PI {
        w + TAU
    } else {
        w
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrap_angle_is_bounded() {
        use std::f32::consts::PI;
        for a in [0.0f32, 3.5, -3.5, 100.0, -100.0, 1e9, PI, -PI, f32::INFINITY, f32::NAN] {
            let w = wrap_angle(a);
            assert!(w > -PI - 1e-4 && w <= PI + 1e-4, "{a} -> {w}");
        }
    }
}

#[inline]
pub fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    v.max(lo).min(hi)
}

#[inline]
pub fn approach(cur: f32, target: f32, max_step: f32) -> f32 {
    if (target - cur).abs() <= max_step {
        target
    } else {
        cur + max_step * (target - cur).signum()
    }
}
