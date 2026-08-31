import { describe, expect, it } from 'vitest';
import { EYE_U, EYE_V, PHI } from './constants';
import {
  ORIENTATIONS,
  canonicalSquares,
  clampInside,
  describeOrientation,
  eyePoint,
  isCcw,
  isPortrait,
  longSide,
  makePlacement,
  remainingRect,
  sampleSpiral,
  sampleSpiralInto,
  scalePlacement,
  shortSide,
  spiralArcs,
  subdivide,
} from './geometry';
import type { Orientation, Placement, Point } from './types';

const EYE_REL_LO = 1 / (PHI + 2); // 0.2764
const EYE_REL_HI = 1 - EYE_REL_LO; // 0.7236

/** Expected (relative x, relative y, corner, winding of travel outer end → eye) per orientation. */
const TABLE: Record<Orientation, [number, number, string, string]> = {
  0: [EYE_REL_HI, EYE_REL_LO, 'TR', 'ccw'],
  1: [EYE_REL_LO, EYE_REL_LO, 'TL', 'cw'],
  2: [EYE_REL_HI, EYE_REL_HI, 'BR', 'cw'],
  3: [EYE_REL_LO, EYE_REL_HI, 'BL', 'ccw'],
  4: [EYE_REL_LO, EYE_REL_HI, 'BL', 'cw'],
  5: [EYE_REL_LO, EYE_REL_LO, 'TL', 'ccw'],
  6: [EYE_REL_HI, EYE_REL_HI, 'BR', 'ccw'],
  7: [EYE_REL_HI, EYE_REL_LO, 'TR', 'cw'],
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const placements = (): Placement[] =>
  ORIENTATIONS.flatMap((o) => [makePlacement(13.5, 7.25, 100, o), makePlacement(-20, 40, 37.5, o)]);

describe('constants', () => {
  it('eye is the canonical value', () => {
    expect(EYE_U).toBeCloseTo(1.1708203932, 9);
    expect(EYE_V).toBeCloseTo(0.2763932023, 9);
    expect(EYE_U / PHI).toBeCloseTo(EYE_REL_HI, 12);
  });
});

describe('makePlacement', () => {
  it('keeps the φ ratio exact for every orientation', () => {
    for (const p of placements()) {
      expect(longSide(p) / shortSide(p)).toBeCloseTo(PHI, 12);
      if (isPortrait(p.orientation)) expect(p.h).toBeGreaterThan(p.w);
      else expect(p.w).toBeGreaterThan(p.h);
    }
  });
});

describe('eyePoint', () => {
  it('matches the orientation table', () => {
    for (const o of ORIENTATIONS) {
      for (const p of [makePlacement(10, 20, 50, o), makePlacement(0, 0, 1, o)]) {
        const e = eyePoint(p);
        const [rx, ry, corner, winding] = TABLE[o];
        expect((e.x - p.x) / p.w).toBeCloseTo(rx, 9);
        expect((e.y - p.y) / p.h).toBeCloseTo(ry, 9);
        const info = describeOrientation(o);
        expect(info.eyeCorner).toBe(corner);
        expect(info.winding).toBe(winding);
        expect(info.aspect).toBe(isPortrait(o) ? 'portrait' : 'landscape');
      }
    }
  });

  it('all 8 orientations give distinct eye points for the same rect footprint', () => {
    const land = ORIENTATIONS.filter((o) => !isPortrait(o)).map((o) => eyePoint(makePlacement(0, 0, 10, o)));
    const port = ORIENTATIONS.filter((o) => isPortrait(o)).map((o) => eyePoint(makePlacement(0, 0, 10, o)));
    for (const group of [land, port]) {
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) expect(dist(group[i], group[j])).toBeGreaterThan(1);
    }
  });

  it('remaining rect after 30 levels contains the eye and converges to it', () => {
    for (const p of placements()) {
      const e = eyePoint(p);
      const r = remainingRect(p, 30);
      expect(e.x).toBeGreaterThanOrEqual(r.x - 1e-9);
      expect(e.x).toBeLessThanOrEqual(r.x + r.w + 1e-9);
      expect(e.y).toBeGreaterThanOrEqual(r.y - 1e-9);
      expect(e.y).toBeLessThanOrEqual(r.y + r.h + 1e-9);
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      expect(dist(c, e)).toBeLessThan(1e-5 * shortSide(p));
      expect(Math.max(r.w, r.h)).toBeLessThan(1e-5 * shortSide(p));
    }
  });
});

describe('canonicalSquares', () => {
  it('side lengths are φ^(−k)', () => {
    const sq = canonicalSquares(10);
    sq.forEach((s, k) => expect(s.s).toBeCloseTo(Math.pow(PHI, -k), 9));
  });
});

describe('subdivide', () => {
  it('squares tile the rectangle: inside, non-overlapping, areas sum up', () => {
    for (const p of placements()) {
      const depth = 8;
      const squares = subdivide(p, depth);
      expect(squares).toHaveLength(depth);
      let area = 0;
      const s = shortSide(p);
      squares.forEach((q, k) => {
        expect(q.level).toBe(k);
        expect(q.size).toBeCloseTo(s * Math.pow(PHI, -k), 9);
        expect(q.x).toBeGreaterThanOrEqual(p.x - 1e-9);
        expect(q.y).toBeGreaterThanOrEqual(p.y - 1e-9);
        expect(q.x + q.size).toBeLessThanOrEqual(p.x + p.w + 1e-9);
        expect(q.y + q.size).toBeLessThanOrEqual(p.y + p.h + 1e-9);
        area += q.size * q.size;
      });
      for (let i = 0; i < depth; i++) {
        for (let j = i + 1; j < depth; j++) {
          const a = squares[i];
          const b = squares[j];
          const ox = Math.min(a.x + a.size, b.x + b.size) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.size, b.y + b.size) - Math.max(a.y, b.y);
          expect(Math.max(0, ox) * Math.max(0, oy)).toBeLessThan(1e-9);
        }
      }
      const rem = remainingRect(p, depth);
      expect(area + rem.w * rem.h).toBeCloseTo(p.w * p.h, 6);
    }
  });
});

describe('spiralArcs', () => {
  const norm = (v: Point) => {
    const l = Math.hypot(v.x, v.y);
    return { x: v.x / l, y: v.y / l };
  };
  /** Normalize an angle difference into (−π, π]. */
  const wrapPi = (d: number) => {
    let a = d % (2 * Math.PI);
    if (a <= -Math.PI) a += 2 * Math.PI;
    if (a > Math.PI) a -= 2 * Math.PI;
    return a;
  };

  it('arcs chain end to end, have the square radius, and are tangent-continuous', () => {
    for (const p of placements()) {
      const depth = 8;
      const arcs = spiralArcs(p, depth);
      const squares = subdivide(p, depth);
      expect(arcs).toHaveLength(depth);
      for (let k = 0; k < depth; k++) {
        const a = arcs[k];
        expect(a.level).toBe(k);
        expect(a.r).toBeCloseTo(squares[k].size, 9);
        expect(a.ccw).toBe(isCcw(p.orientation));
        // endpoints lie on the circle
        expect(dist(a.from, { x: a.cx, y: a.cy })).toBeCloseTo(a.r, 9);
        expect(dist(a.to, { x: a.cx, y: a.cy })).toBeCloseTo(a.r, 9);
        // sweep is a quarter turn in the direction given by `ccw` (canvas: cw = increasing angle)
        const sweep = wrapPi(a.endAngle - a.startAngle);
        expect(sweep).toBeCloseTo((a.ccw ? -1 : 1) * (Math.PI / 2), 9);
        // the midpoint of the arc lies inside its square
        const mid = a.startAngle + (a.ccw ? -1 : 1) * (Math.PI / 4);
        const m = { x: a.cx + a.r * Math.cos(mid), y: a.cy + a.r * Math.sin(mid) };
        const q = squares[k];
        expect(m.x).toBeGreaterThanOrEqual(q.x - 1e-9);
        expect(m.x).toBeLessThanOrEqual(q.x + q.size + 1e-9);
        expect(m.y).toBeGreaterThanOrEqual(q.y - 1e-9);
        expect(m.y).toBeLessThanOrEqual(q.y + q.size + 1e-9);
        // the arc bulges away from the eye (toward the outer corner), never toward it
        const eye = eyePoint(p);
        const chordMid = { x: (a.from.x + a.to.x) / 2, y: (a.from.y + a.to.y) / 2 };
        expect(dist(m, eye)).toBeGreaterThan(dist(chordMid, eye));
        if (k + 1 < depth) {
          const b = arcs[k + 1];
          expect(dist(a.to, b.from)).toBeLessThan(1e-9);
          // tangent at a.to equals tangent at b.from (both perpendicular to the radius, same direction)
          const ra = norm({ x: a.to.x - a.cx, y: a.to.y - a.cy });
          const rb = norm({ x: b.from.x - b.cx, y: b.from.y - b.cy });
          const sign = a.ccw ? -1 : 1;
          const ta = { x: -ra.y * sign, y: ra.x * sign };
          const tb = { x: -rb.y * sign, y: rb.x * sign };
          expect(dist(ta, tb)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('orientation 1 is the mirror of orientation 0; orientation 4 is the transpose', () => {
    const p0 = makePlacement(0, 0, 10, 0);
    const p1 = makePlacement(0, 0, 10, 1);
    const p4 = makePlacement(0, 0, 10, 4);
    const a0 = spiralArcs(p0, 6);
    const a1 = spiralArcs(p1, 6);
    const a4 = spiralArcs(p4, 6);
    for (let k = 0; k < 6; k++) {
      expect(a1[k].cx).toBeCloseTo(p0.w - a0[k].cx, 9);
      expect(a1[k].cy).toBeCloseTo(a0[k].cy, 9);
      expect(a4[k].cx).toBeCloseTo(a0[k].cy, 9);
      expect(a4[k].cy).toBeCloseTo(a0[k].cx, 9);
      expect(a1[k].ccw).toBe(!a0[k].ccw);
      expect(a4[k].ccw).toBe(!a0[k].ccw);
    }
  });
});

describe('sampleSpiral', () => {
  it('is equally spaced by arc length, starts at the outer end and ends near the eye', () => {
    for (const p of placements()) {
      const n = 96;
      const pts = sampleSpiral(p, 8, n);
      const arcs = spiralArcs(p, 8);
      expect(pts).toHaveLength(n);
      expect(dist(pts[0], arcs[0].from)).toBeLessThan(1e-9);
      const d0 = dist(pts[0], pts[1]);
      // chord lengths vary slightly with curvature; arc-length spacing is constant,
      // so chords must be within a few percent of each other except across arc joins.
      for (let i = 1; i < n - 1; i++) {
        const d = dist(pts[i], pts[i + 1]);
        expect(d).toBeGreaterThan(d0 * 0.9);
        expect(d).toBeLessThan(d0 * 1.05);
      }
      expect(dist(pts[n - 1], eyePoint(p))).toBeLessThan(0.05 * shortSide(p));
      const flat = new Float64Array(n * 2);
      const normals = new Float64Array(n * 2);
      sampleSpiralInto(p, 8, n, flat, normals);
      for (let i = 0; i < n; i++) {
        expect(flat[i * 2]).toBeCloseTo(pts[i].x, 12);
        expect(flat[i * 2 + 1]).toBeCloseTo(pts[i].y, 12);
        // unit normals, perpendicular to the local tangent (chord to the next sample). Checked on the
        // outer arcs only: on the tiny inner arcs a chord subtends a large angle and is no longer tangent.
        expect(Math.hypot(normals[i * 2], normals[i * 2 + 1])).toBeCloseTo(1, 12);
        if (i + 1 < n * 0.7) {
          const tx = pts[i + 1].x - pts[i].x;
          const ty = pts[i + 1].y - pts[i].y;
          const cos = (tx * normals[i * 2] + ty * normals[i * 2 + 1]) / Math.hypot(tx, ty);
          expect(Math.abs(cos)).toBeLessThan(0.06);
        }
      }
    }
  });
});

describe('scalePlacement / clampInside', () => {
  it('scales exactly and clamps into bounds', () => {
    for (const p of placements()) {
      const q = scalePlacement(p, 3.7);
      expect(q.x).toBeCloseTo(p.x * 3.7, 9);
      expect(q.w).toBeCloseTo(p.w * 3.7, 9);
      expect(longSide(q) / shortSide(q)).toBeCloseTo(PHI, 12);
      const c = clampInside(q, 120, 90);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(120 + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(90 + 1e-9);
      expect(longSide(c) / shortSide(c)).toBeCloseTo(PHI, 12);
    }
  });
});
