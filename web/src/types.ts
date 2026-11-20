// Shared types and constants for the web client.

export interface TeamInfo {
  id: string;
  city: string;
  name: string;
  conf: number;
  div: string;
  primary: string;
  secondary: string;
  accent: string;
  placeholder_branding?: boolean;
}

export interface Hud {
  phase: 'playcall' | 'inplay' | 'final';
  play_phase: 'presnap' | 'live' | 'over';
  user_side: 'offense' | 'defense' | 'none';
  situation: 'scrimmage' | 'kickoff' | 'try' | 'two_point';
  special: '' | 'kickoff' | 'punt' | 'fg' | 'pat';
  user_kicking: boolean;
  user_choosing: boolean;
  quarter_label: string;
  clock_running: boolean;
  timeouts: [number, number];
  kneel_window: boolean;
  abbr: [string, string];
  score: [number, number];
  quarter: number;
  clock: number;
  down: number;
  to_go: string;
  spot: string;
  possession: number;
  los_x: number;
  first_down_x: number;
  ball_y: number;
  dir: number;
  lineup: number;
  off_play: string;
  def_play: string;
  last_play: string;
  user_def_slot: number;
}

export interface LineupEntry {
  team: number;
  number: number;
  pos: string;
  name: string;
  skin: number;
  build: number;
  /** Radius of the player's puck in yards. */
  radius?: number;
}

export interface MenuItem {
  idx: number;
  name: string;
  cat: string;
  formation: string;
  group: string;
}

export interface GameEvent {
  type: string;
  [k: string]: unknown;
}

/** Floats per player in the core snapshot, then BALL_STRIDE floats for the ball. */
export const STRIDE = 8;
/** Ball block: x, y, z, state, holder, vx, vy, then the target marker: kind, x, y, time left. */
export const BALL_STRIDE = 12;
export const N = 22;
export const FIELD_LEN = 120;
export const FIELD_W = 53.333;

export const ANIM = {
  Stance: 0,
  Idle: 1,
  Run: 2,
  Block: 3,
  Throw: 4,
  Catch: 5,
  Dive: 6,
  Down: 7,
  Juke: 8,
  Spin: 9,
  Stiff: 10,
  Celebrate: 11,
  Wrap: 12,
  Hurdle: 13,
  Truck: 14,
  Ragdoll: 15,
  Stagger: 16,
} as const;

/** Ragdoll buffer: actor index + 11 parts × (x, y, z, qx, qy, qz, qw), core coordinates. */
export const RAGDOLL_PARTS = 11;
export const RAGDOLL_STRIDE = 1 + RAGDOLL_PARTS * 7;

/** Snapshot flag bits. */
export const FLAG = { User: 1, Carrier: 2, Target: 4, Engaged: 8, Offense: 16 } as const;

/**
 * The core uses field coordinates (x along the field, y across, z up).
 * Three.js is y-up; we map core (x, y, z) -> three (x, z, -y) so nothing is mirrored.
 */
export function toThree(x: number, y: number, z = 0): [number, number, number] {
  return [x, z, -y];
}
