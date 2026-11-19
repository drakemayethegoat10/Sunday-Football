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
}

export interface MenuItem {
  idx: number;
  name: string;
  cat: string;
  formation: string;
}

export interface GameEvent {
  type: string;
  [k: string]: unknown;
}

/** Floats per player in the core snapshot. */
export const STRIDE = 8;
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
} as const;

/** Snapshot flag bits. */
export const FLAG = { User: 1, Carrier: 2, Target: 4, Engaged: 8, Offense: 16 } as const;

/**
 * The core uses field coordinates (x along the field, y across, z up).
 * Three.js is y-up; we map core (x, y, z) -> three (x, z, -y) so nothing is mirrored.
 */
export function toThree(x: number, y: number, z = 0): [number, number, number] {
  return [x, z, -y];
}
