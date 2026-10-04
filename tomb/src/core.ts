// Constants shared by the generator, the game rules, the bot and the renderer.

export const W = 15;
export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;
export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];
export const opp = (d: number): number => (d + 2) & 3;

export const IT_NONE = 0;
export const IT_DOT = 1;
export const IT_COIN = 2;
export const IT_STAR = 3;
export const IT_SHIELD = 4;
export const IT_MAGNET = 5;
export const IT_FREEZE = 6;

/** Bounce pads: 1 = "/" and 2 = "\". DEFLECT[pad][dir] is the direction after bouncing. */
export const PAD_SLASH = 1;
export const PAD_BACKSLASH = 2;
export const DEFLECT: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [3, 2, 1, 0],
];

/** A slide this long can only be bouncing between pads forever. */
export const SLIDE_LIMIT = 400;

/** Slide motion, shared by the game, the bot and the flood timing. Tiles and seconds. */
export const MOVE = { v0: 12, accel: 220, vmax: 30 };
const T_ACC = (MOVE.vmax - MOVE.v0) / MOVE.accel;
const D_ACC = MOVE.v0 * T_ACC + 0.5 * MOVE.accel * T_ACC * T_ACC;

export function moveDist(t: number): number {
  if (t <= 0) return 0;
  if (t < T_ACC) return MOVE.v0 * t + 0.5 * MOVE.accel * t * t;
  return D_ACC + MOVE.vmax * (t - T_ACC);
}

export function moveTime(len: number): number {
  if (len <= D_ACC) return (-MOVE.v0 + Math.sqrt(MOVE.v0 * MOVE.v0 + 2 * MOVE.accel * len)) / MOVE.accel;
  return T_ACC + (len - D_ACC) / MOVE.vmax;
}
