import type { GrayMap, IntegralImage } from './types';

/** Summed-area table: data[(y+1)*(w+1) + (x+1)] = Σ map[0..y][0..x]. */
export function buildIntegral(map: GrayMap): IntegralImage {
  const { width: w, height: h, data } = map;
  const W = w + 1;
  const out = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const src = y * w;
    const prev = y * W;
    const cur = (y + 1) * W;
    for (let x = 0; x < w; x++) {
      rowSum += data[src + x];
      out[cur + x + 1] = out[prev + x + 1] + rowSum;
    }
  }
  return { width: w, height: h, data: out };
}

/** Sum over the integer pixel box [x0, x1) × [y0, y1), clamped to the image. */
export function rectSum(ii: IntegralImage, x0: number, y0: number, x1: number, y1: number): number {
  const { width: w, height: h, data } = ii;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > w) x1 = w;
  if (y1 > h) y1 = h;
  if (x1 <= x0 || y1 <= y0) return 0;
  const W = w + 1;
  return data[y1 * W + x1] - data[y0 * W + x1] - data[y1 * W + x0] + data[y0 * W + x0];
}

/** Sum over a fractional rect, rounded to the nearest pixel boundaries. */
export function rectSumF(ii: IntegralImage, x: number, y: number, w: number, h: number): number {
  return rectSum(ii, Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h));
}
