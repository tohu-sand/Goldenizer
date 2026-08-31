import { describe, expect, it } from 'vitest';
import {
  bilinearSample,
  downscaleRgba,
  fitSize,
  gaussianBlur,
  gaussianKernel,
  makeGray,
  percentile,
  sobelMagnitude,
} from './filters';
import { fillRect, makeImage } from './synthetic';

describe('gaussian', () => {
  it('kernel is symmetric and sums to 1', () => {
    for (const s of [0.5, 1, 2.7, 8]) {
      const k = gaussianKernel(s);
      expect(k.length % 2).toBe(1);
      let sum = 0;
      for (let i = 0; i < k.length; i++) {
        sum += k[i];
        expect(k[i]).toBeCloseTo(k[k.length - 1 - i], 7);
      }
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('leaves a constant image unchanged (clamp padding)', () => {
    const m = makeGray(20, 13);
    m.data.fill(0.37);
    const b = gaussianBlur(m, 3);
    for (let i = 0; i < b.data.length; i++) expect(b.data[i]).toBeCloseTo(0.37, 5);
  });

  it('impulse response is symmetric and preserves mass', () => {
    const m = makeGray(31, 31);
    m.data[15 * 31 + 15] = 1;
    const b = gaussianBlur(m, 2);
    let sum = 0;
    for (let y = 0; y < 31; y++) {
      for (let x = 0; x < 31; x++) {
        sum += b.data[y * 31 + x];
        expect(b.data[y * 31 + x]).toBeCloseTo(b.data[(30 - y) * 31 + (30 - x)], 7);
        expect(b.data[y * 31 + x]).toBeCloseTo(b.data[x * 31 + y], 7);
      }
    }
    expect(sum).toBeCloseTo(1, 5);
    expect(b.data[15 * 31 + 15]).toBeGreaterThan(b.data[15 * 31 + 16]);
  });
});

describe('sobel', () => {
  it('peaks on a vertical step edge and is zero far away', () => {
    const w = 40;
    const h = 10;
    const m = makeGray(w, h);
    for (let y = 0; y < h; y++) for (let x = 20; x < w; x++) m.data[y * w + x] = 1;
    const g = sobelMagnitude(m);
    for (let y = 0; y < h; y++) {
      expect(g.data[y * w + 19]).toBeCloseTo(4, 6);
      expect(g.data[y * w + 20]).toBeCloseTo(4, 6);
      expect(g.data[y * w + 5]).toBe(0);
      expect(g.data[y * w + 35]).toBe(0);
    }
  });
});

describe('percentile', () => {
  it('matches known quantiles of a ramp', () => {
    const d = new Float32Array(10000);
    for (let i = 0; i < d.length; i++) d[i] = i / (d.length - 1);
    expect(percentile(d, 0.5)).toBeCloseTo(0.5, 2);
    expect(percentile(d, 0.95)).toBeCloseTo(0.95, 2);
    expect(percentile(d, 0.99)).toBeCloseTo(0.99, 2);
    expect(percentile(d, 1)).toBeCloseTo(1, 6);
    const c = new Float32Array(50).fill(3);
    expect(percentile(c, 0.9)).toBe(3);
    expect(percentile(new Float32Array(0), 0.9)).toBe(0);
  });
});

describe('bilinearSample', () => {
  it('interpolates and clamps', () => {
    const m = makeGray(2, 2, new Float32Array([0, 1, 2, 3]));
    expect(bilinearSample(m, 0, 0)).toBe(0);
    expect(bilinearSample(m, 1, 1)).toBe(3);
    expect(bilinearSample(m, 0.5, 0)).toBeCloseTo(0.5, 9);
    expect(bilinearSample(m, 0.5, 0.5)).toBeCloseTo(1.5, 9);
    expect(bilinearSample(m, -5, 10)).toBe(2);
  });
});

describe('fitSize / downscaleRgba', () => {
  it('fits within the longest side and never upscales', () => {
    expect(fitSize(4000, 3000, 256)).toEqual({ width: 256, height: 192 });
    expect(fitSize(100, 50, 256)).toEqual({ width: 100, height: 50 });
    expect(fitSize(1, 5000, 256)).toEqual({ width: 1, height: 256 });
  });

  it('area-averages colours', () => {
    const img = makeImage(8, 4, [0, 0, 0]);
    fillRect(img, 0, 0, 4, 4, [255, 255, 255]);
    const d = downscaleRgba(img, 2, 1);
    expect(Array.from(d.data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    const e = downscaleRgba(img, 1, 1);
    expect(e.data[0]).toBe(128);
  });
});
