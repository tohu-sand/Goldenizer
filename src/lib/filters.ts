import type { GrayMap, RgbaImage } from './types';

export function makeGray(width: number, height: number, data?: Float32Array): GrayMap {
  return { width, height, data: data ?? new Float32Array(width * height) };
}

/** Normalized 1-D Gaussian kernel with radius ceil(3σ). */
export function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Separable Gaussian blur with clamp-to-edge padding. Returns a new map. */
export function gaussianBlur(src: GrayMap, sigma: number): GrayMap {
  const { width: w, height: h, data } = src;
  if (!(sigma > 0)) return makeGray(w, h, new Float32Array(data));
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) >> 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      if (x >= r && x + r < w) {
        for (let i = -r; i <= r; i++) acc += data[row + x + i] * k[i + r];
      } else {
        for (let i = -r; i <= r; i++) {
          let xx = x + i;
          if (xx < 0) xx = 0;
          else if (xx >= w) xx = w - 1;
          acc += data[row + xx] * k[i + r];
        }
      }
      tmp[row + x] = acc;
    }
  }
  // vertical pass
  for (let y = 0; y < h; y++) {
    const interior = y >= r && y + r < h;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      if (interior) {
        for (let i = -r; i <= r; i++) acc += tmp[(y + i) * w + x] * k[i + r];
      } else {
        for (let i = -r; i <= r; i++) {
          let yy = y + i;
          if (yy < 0) yy = 0;
          else if (yy >= h) yy = h - 1;
          acc += tmp[yy * w + x] * k[i + r];
        }
      }
      out[y * w + x] = acc;
    }
  }
  return makeGray(w, h, out);
}

/** Sobel gradient components (gx, gy) with clamp-to-edge padding. */
export function sobelXY(src: GrayMap): { gx: GrayMap; gy: GrayMap } {
  const { width: w, height: h, data } = src;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const at = (x: number, y: number) => {
    if (x < 0) x = 0;
    else if (x >= w) x = w - 1;
    if (y < 0) y = 0;
    else if (y >= h) y = h - 1;
    return data[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const rr = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      gx[y * w + x] = tr + 2 * rr + br - (tl + 2 * l + bl);
      gy[y * w + x] = bl + 2 * b + br - (tl + 2 * t + tr);
    }
  }
  return { gx: makeGray(w, h, gx), gy: makeGray(w, h, gy) };
}

/** Sobel gradient magnitude with clamp-to-edge padding. */
export function sobelMagnitude(src: GrayMap): GrayMap {
  const { width: w, height: h, data } = src;
  const out = new Float32Array(w * h);
  const at = (x: number, y: number) => {
    if (x < 0) x = 0;
    else if (x >= w) x = w - 1;
    if (y < 0) y = 0;
    else if (y >= h) y = h - 1;
    return data[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const rr = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const gx = tr + 2 * rr + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      out[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return makeGray(w, h, out);
}

/** Approximate p-quantile (p ∈ [0, 1]) via a 1024-bin histogram. */
export function percentile(data: Float32Array, p: number): number {
  const n = data.length;
  if (n === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) return max;
  const bins = 1024;
  const hist = new Uint32Array(bins);
  const scale = bins / (max - min);
  for (let i = 0; i < n; i++) {
    let idx = Math.floor((data[i] - min) * scale);
    if (idx >= bins) idx = bins - 1;
    hist[idx]++;
  }
  const target = p * n;
  let cum = 0;
  for (let i = 0; i < bins; i++) {
    cum += hist[i];
    if (cum >= target) return min + ((i + 1) / bins) * (max - min);
  }
  return max;
}

export function maxOf(data: Float32Array): number {
  let m = -Infinity;
  for (let i = 0; i < data.length; i++) if (data[i] > m) m = data[i];
  return m;
}

export function meanOf(data: Float32Array): number {
  if (data.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i];
  return s / data.length;
}

/** clip(map / percentile_p(map), 0, 1) ^ gamma, in place. A non-positive reference yields all zeros. */
export function normalizeByPercentileInPlace(map: GrayMap, p: number, gamma = 1): GrayMap {
  const ref = percentile(map.data, p);
  const d = map.data;
  if (!(ref > 0)) {
    d.fill(0);
    return map;
  }
  const inv = 1 / ref;
  for (let i = 0; i < d.length; i++) {
    let v = d[i] * inv;
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    d[i] = gamma === 1 ? v : Math.pow(v, gamma);
  }
  return map;
}

/** Divide by the maximum, in place (no-op when max ≤ 0). */
export function normalizeByMaxInPlace(map: GrayMap): GrayMap {
  const m = maxOf(map.data);
  if (m > 0) {
    const inv = 1 / m;
    for (let i = 0; i < map.data.length; i++) map.data[i] *= inv;
  }
  return map;
}

/** Bilinear sample with clamped coordinates. */
export function bilinearSample(map: GrayMap, x: number, y: number): number {
  const { width: w, height: h, data } = map;
  if (x < 0) x = 0;
  else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0;
  else if (y > h - 1) y = h - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const bot = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/** Working-size for analysis: longest side ≤ maxSide, never upscaled, min 1 px. */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Area-averaging downscale of an RGBA image (box filter over the source
 * footprint of each destination pixel). Used by tests and the CLI; the browser
 * path uses canvas drawImage instead.
 */
export function downscaleRgba(src: RgbaImage, dstW: number, dstH: number): RgbaImage {
  const { width: sw, height: sh, data } = src;
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const sx = sw / dstW;
  const sy = sh / dstH;
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let cnt = 0;
      for (let yy = y0; yy < y1; yy++) {
        let j = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++, j += 4) {
          r += data[j];
          g += data[j + 1];
          b += data[j + 2];
          a += data[j + 3];
          cnt++;
        }
      }
      const o = (y * dstW + x) * 4;
      out[o] = r / cnt;
      out[o + 1] = g / cnt;
      out[o + 2] = b / cnt;
      out[o + 3] = a / cnt;
    }
  }
  return { width: dstW, height: dstH, data: out };
}
