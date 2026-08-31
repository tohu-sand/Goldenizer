import { describe, expect, it } from 'vitest';
import { buildIntegral, rectSum, rectSumF } from './integral';
import { makeGray } from './filters';
import { makeRng } from './synthetic';

describe('integral image', () => {
  it('rectSum matches brute force, including degenerate/edge/full rects', () => {
    const w = 37;
    const h = 23;
    const rnd = makeRng(42);
    const map = makeGray(w, h);
    for (let i = 0; i < w * h; i++) map.data[i] = rnd();
    const ii = buildIntegral(map);
    expect(ii.data.length).toBe((w + 1) * (h + 1));

    const brute = (x0: number, y0: number, x1: number, y1: number) => {
      let s = 0;
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) s += map.data[y * w + x];
      return s;
    };

    const cases: [number, number, number, number][] = [
      [0, 0, w, h],
      [0, 0, 0, 0],
      [5, 5, 5, 9],
      [-3, -3, 4, 4],
      [30, 20, 50, 40],
      [w - 1, h - 1, w, h],
      [10, 3, 2, 8], // inverted → 0
    ];
    for (let i = 0; i < 200; i++) {
      const x0 = Math.floor(rnd() * w);
      const y0 = Math.floor(rnd() * h);
      cases.push([x0, y0, x0 + Math.floor(rnd() * (w - x0 + 1)), y0 + Math.floor(rnd() * (h - y0 + 1))]);
    }
    for (const [x0, y0, x1, y1] of cases) {
      expect(rectSum(ii, x0, y0, x1, y1)).toBeCloseTo(brute(x0, y0, x1, y1), 9);
    }
    expect(rectSumF(ii, 2.4, 3.6, 5.2, 4.4)).toBeCloseTo(brute(2, 4, 8, 8), 9);
  });
});
