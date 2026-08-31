import { describe, expect, it } from 'vitest';
import { computeSaliency } from './saliency';
import { addNoise, fillDisc, makeImage, strokeCircle } from './synthetic';
import type { GrayMap } from './types';

function argmax(m: GrayMap): { x: number; y: number; v: number } {
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const v = m.data[y * m.width + x];
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  return { x: bx, y: by, v: best };
}

/** Mean of the map inside radius rIn of (cx, cy) and outside radius rOut. */
function insideOutside(m: GrayMap, cx: number, cy: number, rIn: number, rOut: number) {
  let si = 0;
  let ni = 0;
  let so = 0;
  let no = 0;
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const v = m.data[y * m.width + x];
      if (d <= rIn) {
        si += v;
        ni++;
      } else if (d >= rOut) {
        so += v;
        no++;
      }
    }
  return { inside: si / ni, outside: so / no };
}

function expectFiniteUnit(m: GrayMap) {
  for (let i = 0; i < m.data.length; i++) {
    expect(Number.isFinite(m.data[i])).toBe(true);
    expect(m.data[i]).toBeGreaterThanOrEqual(0);
    expect(m.data[i]).toBeLessThanOrEqual(1);
  }
}

describe('computeSaliency', () => {
  it('black disc on white → peak on the disc, inside ≫ outside', () => {
    const img = makeImage(200, 150);
    fillDisc(img, 140, 60, 20, [0, 0, 0]);
    const maps = computeSaliency(img.data, img.width, img.height);
    expectFiniteUnit(maps.saliency);
    expectFiniteUnit(maps.eyeMap);
    const a = argmax(maps.saliency);
    expect(Math.hypot(a.x - 140, a.y - 60)).toBeLessThan(25);
    const e = argmax(maps.eyeMap);
    expect(Math.hypot(e.x - 140, e.y - 60)).toBeLessThan(25);
    const io = insideOutside(maps.saliency, 140, 60, 20, 30);
    expect(io.inside).toBeGreaterThan(5 * io.outside);
    expect(maps.totalMass).toBeGreaterThan(0);
    expect(maps.meanLuma).toBeGreaterThan(0.9);
  });

  it('thin ring on white → edge term still localizes it', () => {
    const img = makeImage(200, 150);
    strokeCircle(img, 140, 60, 20, 2, [0, 0, 0]);
    const maps = computeSaliency(img.data, img.width, img.height);
    expectFiniteUnit(maps.saliency);
    const a = argmax(maps.saliency);
    expect(Math.hypot(a.x - 140, a.y - 60)).toBeLessThan(28);
    const io = insideOutside(maps.saliency, 140, 60, 20, 30);
    expect(io.inside).toBeGreaterThan(5 * io.outside);
  });

  it('uniform image → all zeros, no NaN', () => {
    const img = makeImage(64, 48, [120, 130, 140]);
    const maps = computeSaliency(img.data, img.width, img.height);
    expectFiniteUnit(maps.saliency);
    expectFiniteUnit(maps.eyeMap);
    expect(maps.totalMass).toBe(0);
    for (let i = 0; i < maps.saliency.data.length; i++) expect(maps.saliency.data[i]).toBe(0);
  });

  it('noise → finite values in [0, 1]', () => {
    const img = makeImage(64, 48, [128, 128, 128]);
    addNoise(img, 100, 7);
    const maps = computeSaliency(img.data, img.width, img.height);
    expectFiniteUnit(maps.saliency);
    expectFiniteUnit(maps.eyeMap);
  });

  it('coloured blob on a neutral photo-like background', () => {
    const img = makeImage(160, 120, [90, 110, 130]);
    addNoise(img, 8, 3);
    fillDisc(img, 50, 70, 18, [230, 60, 40]);
    const maps = computeSaliency(img.data, img.width, img.height);
    const a = argmax(maps.eyeMap);
    expect(Math.hypot(a.x - 50, a.y - 70)).toBeLessThan(22);
  });
});
