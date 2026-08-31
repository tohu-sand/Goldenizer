/**
 * Orientation of a golden rectangle / spiral, bit-encoded:
 *   bit 0 (FLIP_LONG)  — mirror along the long axis   (u → φ − u)
 *   bit 1 (FLIP_SHORT) — mirror along the short axis  (v → 1 − v)
 *   bit 2 (PORTRAIT)   — long axis is vertical (transpose u ↔ v)
 * Orientation 0 = landscape, first square on the left, spiral clockwise on
 * screen, eye in the upper-right region.
 */
export type Orientation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A golden rectangle in image coordinates. Invariant: landscape ⇒ w = φ·h,
 * portrait ⇒ h = φ·w. Always construct via `makePlacement`.
 */
export interface Placement extends Rect {
  orientation: Orientation;
}

/** An axis-aligned square of the recursive subdivision (image coords). */
export interface Square {
  x: number;
  y: number;
  size: number;
  /** 0 = largest square. */
  level: number;
}

/** One quarter-circle arc of the spiral (image coords, canvas angle convention). */
export interface Arc {
  cx: number;
  cy: number;
  r: number;
  startAngle: number;
  endAngle: number;
  /** Counter-clockwise sweep (canvas `arc()` semantics). */
  ccw: boolean;
  from: Point;
  to: Point;
  level: number;
}

/** Single-channel float map. */
export interface GrayMap {
  width: number;
  height: number;
  data: Float32Array;
}

/** 8-bit RGBA image (same layout as ImageData.data). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Summed-area table of size (width+1) × (height+1). */
export interface IntegralImage {
  width: number;
  height: number;
  data: Float64Array;
}
