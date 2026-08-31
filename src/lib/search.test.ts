import { describe, expect, it } from 'vitest';
import { analyzeImage } from './analyze';
import { PHI } from './constants';
import { describeOrientation, eyePoint, longSide, shortSide } from './geometry';
import { describeCandidate, nearDuplicate } from './search';
import { addNoise, fillDisc, fillRect, makeImage } from './synthetic';
import type { Placement } from './types';

const inside = (p: Placement, w: number, h: number) =>
  p.x >= -1e-6 && p.y >= -1e-6 && p.x + p.w <= w + 1e-6 && p.y + p.h <= h + 1e-6;

describe('searchPlacement (via analyzeImage)', () => {
  it('centered disc → eye on the disc, rect inside the image, φ exact', () => {
    const img = makeImage(256, 192);
    fillDisc(img, 128, 96, 25, [0, 0, 0]);
    const res = analyzeImage(img.data, img.width, img.height);
    const p = res.best.placement;
    const e = eyePoint(p);
    expect(Math.hypot(e.x - 128, e.y - 96), describeCandidate(res.best)).toBeLessThan(25 + 8);
    expect(inside(p, 256, 192)).toBe(true);
    expect(longSide(p) / shortSide(p)).toBeCloseTo(PHI, 12);
    expect(res.top.length).toBeGreaterThan(1);
    expect(res.top[0]).toBe(res.best);
    for (let i = 1; i < res.top.length; i++) expect(res.top[i].score).toBeLessThanOrEqual(res.top[i - 1].score);
    // candidates offered to the user are distinct
    for (let i = 0; i < res.top.length; i++)
      for (let j = i + 1; j < res.top.length; j++) expect(nearDuplicate(res.top[i], res.top[j], 256)).toBe(false);
  });

  it('disc at the top-right → an orientation whose eye corner is TR, and a large rect', () => {
    const img = makeImage(256, 192);
    fillDisc(img, 200, 40, 20, [0, 0, 0]);
    const res = analyzeImage(img.data, img.width, img.height);
    const p = res.best.placement;
    const e = eyePoint(p);
    expect(Math.hypot(e.x - 200, e.y - 40), describeCandidate(res.best)).toBeLessThan(20 + 8);
    expect(describeOrientation(p.orientation).eyeCorner, describeCandidate(res.best)).toBe('TR');
    expect(res.best.terms.scale, describeCandidate(res.best)).toBeGreaterThan(0.7);
  });

  it('two discs → eye on the larger one', () => {
    const img = makeImage(256, 192);
    fillDisc(img, 70, 120, 25, [0, 0, 0]);
    fillDisc(img, 190, 60, 10, [0, 0, 0]);
    const res = analyzeImage(img.data, img.width, img.height);
    const e = eyePoint(res.best.placement);
    expect(Math.hypot(e.x - 70, e.y - 120), describeCandidate(res.best)).toBeLessThan(25 + 8);
  });

  it('coloured blob on a noisy background → eye on the blob', () => {
    const img = makeImage(240, 160, [90, 110, 130]);
    addNoise(img, 10, 5);
    fillDisc(img, 160, 100, 22, [230, 60, 40]);
    const res = analyzeImage(img.data, img.width, img.height);
    const e = eyePoint(res.best.placement);
    expect(Math.hypot(e.x - 160, e.y - 100), describeCandidate(res.best)).toBeLessThan(22 + 8);
  });

  it('subject filling most of the frame → rectangle hugs its bounding box, eye on its focal spot', () => {
    // a large, uniformly salient portrait "figure" with a compact high-contrast feature inside it
    const img = makeImage(200, 300, [40, 40, 45]);
    fillRect(img, 40, 30, 120, 250, [190, 170, 150]);
    fillDisc(img, 100, 90, 14, [10, 10, 10]);
    const res = analyzeImage(img.data, img.width, img.height);
    const p = res.best.placement;
    const tol = 18;
    // the golden aspect makes the rect wider than the 120 px figure, so check the fitted
    // dimension (height) and that it stays centred on the figure horizontally
    expect(Math.abs(p.y - 30), describeCandidate(res.best)).toBeLessThan(tol);
    expect(Math.abs(p.y + p.h - 280), describeCandidate(res.best)).toBeLessThan(tol);
    expect(Math.abs(p.x + p.w / 2 - 100), describeCandidate(res.best)).toBeLessThan(15);
    expect(res.maps.subjectExtent).toBeGreaterThan(0.6);
  });

  it('blank image → full-frame landscape, orientation 0, no NaN', () => {
    const img = makeImage(256, 192, [200, 200, 200]);
    const res = analyzeImage(img.data, img.width, img.height);
    const p = res.best.placement;
    expect(Number.isFinite(res.best.score)).toBe(true);
    expect(p.orientation).toBe(0);
    expect(res.best.terms.scale).toBeCloseTo(1, 9);
    expect(p.w).toBeCloseTo(256, 6);
    expect(inside(p, 256, 192)).toBe(true);
  });

  it('tiny and degenerate images do not throw', () => {
    for (const [w, h] of [
      [8, 5],
      [1, 1],
      [3, 40],
      [40, 3],
    ]) {
      const img = makeImage(w, h);
      if (w > 4 && h > 4) fillDisc(img, w / 2, h / 2, 1.5, [0, 0, 0]);
      const res = analyzeImage(img.data, w, h);
      expect(Number.isFinite(res.best.score)).toBe(true);
      expect(inside(res.best.placement, w, h)).toBe(true);
    }
  });

  it('runs fast enough at working resolution', () => {
    const img = makeImage(256, 192, [120, 120, 120]);
    addNoise(img, 30, 11);
    fillDisc(img, 90, 80, 30, [250, 240, 20]);
    const res = analyzeImage(img.data, img.width, img.height);
    expect(res.timings.total, JSON.stringify(res.timings)).toBeLessThan(500);
    expect(res.evaluated).toBeGreaterThan(1000);
  });
});
