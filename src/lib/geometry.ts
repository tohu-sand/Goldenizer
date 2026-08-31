import { EYE_U, EYE_V, PHI } from './constants';
import type { Arc, Orientation, Placement, Point, Rect, Square } from './types';

export const FLIP_LONG = 1;
export const FLIP_SHORT = 2;
export const PORTRAIT = 4;
export const ORIENTATIONS: readonly Orientation[] = [0, 1, 2, 3, 4, 5, 6, 7];

export const isPortrait = (o: Orientation): boolean => (o & PORTRAIT) !== 0;
export const flipLong = (o: Orientation): boolean => (o & FLIP_LONG) !== 0;
export const flipShort = (o: Orientation): boolean => (o & FLIP_SHORT) !== 0;
/**
 * Canvas `arc()` `anticlockwise` flag for travelling along the spiral from the
 * outer end toward the eye. Orientation 0 travels counter-clockwise on screen;
 * every reflection flips the sense, so an even number of reflections ⇒ ccw.
 */
export const isCcw = (o: Orientation): boolean => ((o & 1) ^ ((o >> 1) & 1) ^ ((o >> 2) & 1)) === 0;

/** The only sanctioned way to build a Placement (keeps the φ ratio exact). */
export function makePlacement(x: number, y: number, shortSide: number, orientation: Orientation): Placement {
  const long = shortSide * PHI;
  return isPortrait(orientation)
    ? { x, y, w: shortSide, h: long, orientation }
    : { x, y, w: long, h: shortSide, orientation };
}

export const shortSide = (p: Placement): number => (isPortrait(p.orientation) ? p.w : p.h);
export const longSide = (p: Placement): number => (isPortrait(p.orientation) ? p.h : p.w);

/** Map canonical coordinates (u ∈ [0, φ], v ∈ [0, 1]) to image coordinates. */
export function canonicalToImage(p: Placement, u: number, v: number): Point {
  const o = p.orientation;
  const s = shortSide(p);
  const uu = flipLong(o) ? PHI - u : u;
  const vv = flipShort(o) ? 1 - v : v;
  return isPortrait(o) ? { x: p.x + vv * s, y: p.y + uu * s } : { x: p.x + uu * s, y: p.y + vv * s };
}

/** Convergence point of the spiral. */
export const eyePoint = (p: Placement): Point => canonicalToImage(p, EYE_U, EYE_V);

// ---------------------------------------------------------------------------
// Canonical subdivision (orientation 0, rectangle [0, φ] × [0, 1]).
// Squares are cut from sides in the order L, B, R, T, L, B, ...
// ---------------------------------------------------------------------------

/** Side from which the k-th square is cut: 0 = L, 1 = B, 2 = R, 3 = T. */
export type Side = 0 | 1 | 2 | 3;

export interface CanonSquare {
  /** Top-left corner (a, b) and side length s of the square [a, a+s] × [b, b+s]. */
  a: number;
  b: number;
  s: number;
  side: Side;
}

interface CanonLayout {
  squares: CanonSquare[];
  remaining: Rect;
}

const canonCache = new Map<number, CanonLayout>();

function canonicalLayout(depth: number): CanonLayout {
  const cached = canonCache.get(depth);
  if (cached) return cached;
  const squares: CanonSquare[] = [];
  let u0 = 0;
  let v0 = 0;
  let u1 = PHI;
  let v1 = 1;
  for (let k = 0; k < depth; k++) {
    const side = (k % 4) as Side;
    const s = Math.min(u1 - u0, v1 - v0);
    switch (side) {
      case 0: // L
        squares.push({ a: u0, b: v0, s, side });
        u0 += s;
        break;
      case 1: // B
        squares.push({ a: u0, b: v1 - s, s, side });
        v1 -= s;
        break;
      case 2: // R
        squares.push({ a: u1 - s, b: v0, s, side });
        u1 -= s;
        break;
      case 3: // T
        squares.push({ a: u0, b: v0, s, side });
        v0 += s;
        break;
    }
  }
  const layout: CanonLayout = { squares, remaining: { x: u0, y: v0, w: u1 - u0, h: v1 - v0 } };
  canonCache.set(depth, layout);
  return layout;
}

export const canonicalSquares = (depth: number): readonly CanonSquare[] => canonicalLayout(depth).squares;

interface CanonArc {
  cx: number;
  cy: number;
  r: number;
  /** Canonical arcs always sweep −π/2 from startAngle (counter-clockwise on screen, outer end → eye). */
  startAngle: number;
  from: Point;
  to: Point;
}

/**
 * Canonical quarter arc for a square cut from `side`.
 * The centre is the corner of the square farthest from the next square, so that
 * consecutive arcs are internally tangent (a true spiral, no cusps). Each arc
 * joins the two corners adjacent to the centre and bulges toward the outer corner.
 */
function canonicalArc(sq: CanonSquare): CanonArc {
  const { a, b, s } = sq;
  switch (sq.side) {
    case 0: // L: centre TR, TL → BR
      return { cx: a + s, cy: b, r: s, startAngle: Math.PI, from: { x: a, y: b }, to: { x: a + s, y: b + s } };
    case 1: // B: centre TL, BL → TR
      return { cx: a, cy: b, r: s, startAngle: Math.PI / 2, from: { x: a, y: b + s }, to: { x: a + s, y: b } };
    case 2: // R: centre BL, BR → TL
      return { cx: a, cy: b + s, r: s, startAngle: 0, from: { x: a + s, y: b + s }, to: { x: a, y: b } };
    case 3: // T: centre BR, TR → BL
      return { cx: a + s, cy: b + s, r: s, startAngle: -Math.PI / 2, from: { x: a + s, y: b }, to: { x: a, y: b + s } };
  }
}

// ---------------------------------------------------------------------------
// Image-space API
// ---------------------------------------------------------------------------

function rectFromCanonical(p: Placement, x0: number, y0: number, x1: number, y1: number): Rect {
  const c0 = canonicalToImage(p, x0, y0);
  const c1 = canonicalToImage(p, x1, y1);
  const x = Math.min(c0.x, c1.x);
  const y = Math.min(c0.y, c1.y);
  return { x, y, w: Math.abs(c1.x - c0.x), h: Math.abs(c1.y - c0.y) };
}

/** The first `depth` squares of the subdivision, level 0 = largest. */
export function subdivide(p: Placement, depth: number): Square[] {
  const s = shortSide(p);
  return canonicalSquares(depth).map((sq, level) => {
    const r = rectFromCanonical(p, sq.a, sq.b, sq.a + sq.s, sq.b + sq.s);
    return { x: r.x, y: r.y, size: sq.s * s, level };
  });
}

/** The golden rectangle left over after removing `depth` squares (contains the eye). */
export function remainingRect(p: Placement, depth: number): Rect {
  const rem = canonicalLayout(depth).remaining;
  return rectFromCanonical(p, rem.x, rem.y, rem.x + rem.w, rem.y + rem.h);
}

/** Quarter-circle arcs of the spiral, one per square, chained end to end. */
export function spiralArcs(p: Placement, depth: number): Arc[] {
  const s = shortSide(p);
  const ccw = isCcw(p.orientation);
  return canonicalSquares(depth).map((sq, level) => {
    const ca = canonicalArc(sq);
    const c = canonicalToImage(p, ca.cx, ca.cy);
    const from = canonicalToImage(p, ca.from.x, ca.from.y);
    const to = canonicalToImage(p, ca.to.x, ca.to.y);
    return {
      cx: c.x,
      cy: c.y,
      r: ca.r * s,
      startAngle: Math.atan2(from.y - c.y, from.x - c.x),
      endAngle: Math.atan2(to.y - c.y, to.x - c.x),
      ccw,
      from,
      to,
      level,
    };
  });
}

interface CanonSamples {
  n: number;
  /** Canonical (u, v) pairs, flattened. */
  uv: Float64Array;
  /** Unit outward normals (from the arc centre through the point), flattened. */
  nrm: Float64Array;
}

const sampleCache = new Map<string, CanonSamples>();

/** Points equally spaced by arc length along the canonical spiral. */
function canonicalSamples(depth: number, n: number): CanonSamples {
  const key = `${depth}:${n}`;
  const cached = sampleCache.get(key);
  if (cached) return cached;
  const arcs = canonicalSquares(depth).map(canonicalArc);
  const lengths = arcs.map((a) => (Math.PI / 2) * a.r);
  const total = lengths.reduce((acc, l) => acc + l, 0);
  const uv = new Float64Array(n * 2);
  const nrm = new Float64Array(n * 2);
  let k = 0;
  let consumed = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * total;
    while (k < arcs.length - 1 && t > consumed + lengths[k]) {
      consumed += lengths[k];
      k++;
    }
    const arc = arcs[k];
    const f = Math.min(1, Math.max(0, (t - consumed) / lengths[k]));
    const theta = arc.startAngle - f * (Math.PI / 2);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    uv[i * 2] = arc.cx + arc.r * c;
    uv[i * 2 + 1] = arc.cy + arc.r * s;
    nrm[i * 2] = c;
    nrm[i * 2 + 1] = s;
  }
  const out = { n, uv, nrm };
  sampleCache.set(key, out);
  return out;
}

/** `n` points along the spiral, equally spaced by arc length, from the outer end to the eye. */
export function sampleSpiral(p: Placement, depth: number, n: number): Point[] {
  const { uv } = canonicalSamples(depth, n);
  const pts: Point[] = new Array(n);
  for (let i = 0; i < n; i++) pts[i] = canonicalToImage(p, uv[i * 2], uv[i * 2 + 1]);
  return pts;
}

/**
 * Fast variant of `sampleSpiral` writing into a preallocated flat array
 * [x0, y0, x1, y1, ...]; avoids allocations in the hot search loop.
 */
export function sampleSpiralInto(p: Placement, depth: number, n: number, out: Float64Array, outNormals?: Float64Array): void {
  const { uv, nrm } = canonicalSamples(depth, n);
  const o = p.orientation;
  const s = shortSide(p);
  const fl = flipLong(o);
  const fs = flipShort(o);
  const portrait = isPortrait(o);
  for (let i = 0; i < n; i++) {
    let u = uv[i * 2];
    let v = uv[i * 2 + 1];
    let nu = nrm[i * 2];
    let nv = nrm[i * 2 + 1];
    if (fl) {
      u = PHI - u;
      nu = -nu;
    }
    if (fs) {
      v = 1 - v;
      nv = -nv;
    }
    if (portrait) {
      out[i * 2] = p.x + v * s;
      out[i * 2 + 1] = p.y + u * s;
      if (outNormals) {
        outNormals[i * 2] = nv;
        outNormals[i * 2 + 1] = nu;
      }
    } else {
      out[i * 2] = p.x + u * s;
      out[i * 2 + 1] = p.y + v * s;
      if (outNormals) {
        outNormals[i * 2] = nu;
        outNormals[i * 2 + 1] = nv;
      }
    }
  }
}

/** Scale a placement about the origin by `k` (rebuilt so the φ ratio stays exact). */
export function scalePlacement(p: Placement, k: number): Placement {
  return makePlacement(p.x * k, p.y * k, shortSide(p) * k, p.orientation);
}

/** Shrink/move a placement so it lies fully inside a `width` × `height` image. */
export function clampInside(p: Placement, width: number, height: number): Placement {
  const o = p.orientation;
  const maxShort = isPortrait(o) ? Math.min(width, height / PHI) : Math.min(height, width / PHI);
  const s = Math.min(shortSide(p), maxShort);
  const q = makePlacement(p.x, p.y, s, o);
  q.x = Math.min(Math.max(q.x, 0), Math.max(0, width - q.w));
  q.y = Math.min(Math.max(q.y, 0), Math.max(0, height - q.h));
  return q;
}

export type EyeCorner = 'TL' | 'TR' | 'BL' | 'BR';

export interface OrientationInfo {
  aspect: 'landscape' | 'portrait';
  eyeCorner: EyeCorner;
  winding: 'cw' | 'ccw';
}

export function describeOrientation(o: Orientation): OrientationInfo {
  const p = makePlacement(0, 0, 1, o);
  const e = eyePoint(p);
  const right = e.x / p.w > 0.5;
  const bottom = e.y / p.h > 0.5;
  const eyeCorner: EyeCorner = bottom ? (right ? 'BR' : 'BL') : right ? 'TR' : 'TL';
  return { aspect: isPortrait(o) ? 'portrait' : 'landscape', eyeCorner, winding: isCcw(o) ? 'ccw' : 'cw' };
}
