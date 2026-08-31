import { rgbaToLab, rgbaToLuma } from './color';
import {
  gaussianBlur,
  makeGray,
  meanOf,
  normalizeByMaxInPlace,
  normalizeByPercentileInPlace,
  percentile,
  sobelMagnitude,
  sobelXY,
} from './filters';
import { buildIntegral, rectSum } from './integral';
import type { GrayMap, IntegralImage, Rect } from './types';

/**
 * Smoothed structure tensor J = blur(∇I ∇Iᵀ), summed over the L, a, b channels
 * and normalized so that the 99th percentile of trace(J) is 1. The edge energy
 * across a curve with unit normal n is nᵀ J n: high where the curve runs along
 * a contour, ≈ 0 where it crosses one.
 */
export interface StructureTensor {
  xx: GrayMap;
  xy: GrayMap;
  yy: GrayMap;
}

export interface SaliencyParams {
  /** Absolute σ (px) for the Achanta frequency-tuned blur. */
  sigmaFt: number;
  /** σ for the edge-density blur, as a fraction of the longest side. */
  sigmaEdge: number;
  /** σ for the fine eye map blur (feature scale), as a fraction of the longest side. */
  sigmaEye: number;
  /** σ for the coarse eye map blur (object scale), as a fraction of the longest side. */
  sigmaEyeCoarse: number;
  /** σ for smoothing the structure tensor (contour alignment), as a fraction of the longest side. */
  sigmaTensor: number;
  edgeClipPct: number;
  ftClipPct: number;
  finalClipPct: number;
  /** Width of the border frame used for the reference colour, as a fraction of the longest side. */
  borderFrac: number;
  /** Weight of the border mean vs. the global mean in the reference colour. */
  borderMeanWeight: number;
  /** Strength of the centre bias (0 = none). */
  centerBias: number;
  /** Final gamma (sharpening of the map). */
  gamma: number;
  /**
   * Exponent applied to S when building the coverage integral (> 1 makes the
   * coverage term care mostly about strongly salient regions, so the rectangle
   * fits the subject instead of stretching over textured background).
   */
  coverageGamma: number;
  /** Exponent applied to S before measuring the subject's bounding box (suppresses diffuse background). */
  boxGamma: number;
  /** Mass quantile trimmed at each end when measuring the subject's bounding box. */
  boxTail: number;
}

export const DEFAULT_SALIENCY_PARAMS: SaliencyParams = {
  sigmaFt: 1.0,
  sigmaEdge: 0.016,
  sigmaEye: 0.03,
  sigmaEyeCoarse: 0.08,
  sigmaTensor: 0.008,
  edgeClipPct: 0.95,
  ftClipPct: 0.99,
  finalClipPct: 0.99,
  borderFrac: 0.04,
  borderMeanWeight: 0.5,
  centerBias: 0.3,
  gamma: 1.5,
  coverageGamma: 1,
  boxGamma: 3,
  boxTail: 0.02,
};

export interface SaliencyMaps {
  width: number;
  height: number;
  /** Combined saliency S ∈ [0, 1]. */
  saliency: GrayMap;
  /**
   * Fine + coarse blurred S, jointly normalized to [0, 1]; used to score the eye
   * point. The coarse term rewards sitting at the centre of a large salient mass.
   */
  eyeMap: GrayMap;
  integral: IntegralImage;
  totalMass: number;
  /** Contour-alignment tensor used by the path term. */
  tensor: StructureTensor;
  /**
   * Bounding box of the salient mass (2–98 % quantiles of the column/row
   * marginals), in working pixels.
   */
  subjectBox: Rect;
  /**
   * Fraction of the frame spanned by `subjectBox` (mean of the x and y
   * fractions) ∈ [0, 1]. Large ⇒ the subject *is* the composition and the
   * rectangle should hug it; small ⇒ frame the whole picture.
   */
  subjectExtent: number;
  /** Mean luma of the image ∈ [0, 1]. */
  meanLuma: number;
  /** Intermediate maps kept for debugging. */
  parts: { ft: GrayMap; edge: GrayMap };
}

/** Mean of a plane over the whole image and over a border frame of `border` px. */
function frameMeans(plane: Float32Array, w: number, h: number, border: number): { global: number; border: number } {
  let all = 0;
  let edge = 0;
  let edgeN = 0;
  for (let y = 0; y < h; y++) {
    const onBorderY = y < border || y >= h - border;
    for (let x = 0; x < w; x++) {
      const v = plane[y * w + x];
      all += v;
      if (onBorderY || x < border || x >= w - border) {
        edge += v;
        edgeN++;
      }
    }
  }
  return { global: all / (w * h), border: edgeN ? edge / edgeN : all / (w * h) };
}

export function computeSaliency(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  params: Partial<SaliencyParams> = {},
): SaliencyMaps {
  const P = { ...DEFAULT_SALIENCY_PARAMS, ...params };
  const w = width;
  const h = height;
  const n = w * h;
  const L = Math.max(w, h);

  // 1. colour spaces
  const lab = rgbaToLab(rgba, w, h);
  const luma = rgbaToLuma(rgba, w, h);
  const meanLuma = meanOf(luma);

  // 2. frequency-tuned saliency: distance of the slightly blurred image from a reference colour
  const Lb = gaussianBlur(makeGray(w, h, lab.L), P.sigmaFt);
  const ab = gaussianBlur(makeGray(w, h, lab.a), P.sigmaFt);
  const bb = gaussianBlur(makeGray(w, h, lab.b), P.sigmaFt);
  const border = Math.max(1, Math.round(P.borderFrac * L));
  const mL = frameMeans(lab.L, w, h, border);
  const ma = frameMeans(lab.a, w, h, border);
  const mb = frameMeans(lab.b, w, h, border);
  const bw = P.borderMeanWeight;
  const refL = (1 - bw) * mL.global + bw * mL.border;
  const refA = (1 - bw) * ma.global + bw * ma.border;
  const refB = (1 - bw) * mb.global + bw * mb.border;
  const ft = makeGray(w, h);
  for (let i = 0; i < n; i++) {
    const dL = Lb.data[i] - refL;
    const da = ab.data[i] - refA;
    const db = bb.data[i] - refB;
    ft.data[i] = Math.sqrt(dL * dL + da * da + db * db);
  }
  normalizeByPercentileInPlace(ft, P.ftClipPct);

  // 3. edge density: clipped Sobel magnitude, blurred
  const grad = sobelMagnitude(Lb);
  const gRef = percentile(grad.data, P.edgeClipPct);
  if (gRef > 0) {
    for (let i = 0; i < n; i++) {
      const v = grad.data[i] / gRef;
      grad.data[i] = v > 1 ? 1 : v;
    }
  } else {
    grad.data.fill(0);
  }
  const edge = gaussianBlur(grad, P.sigmaEdge * L);
  normalizeByMaxInPlace(edge);

  // 4. combine (max: salient if colour-distinct OR textured — keeps object interiors filled),
  //    apply centre bias, clip, sharpen
  const S = makeGray(w, h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const hw = Math.max(1, w / 2);
  const hh = Math.max(1, h / 2);
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / hh;
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / hw;
      const d2 = 0.5 * (dx * dx + dy * dy);
      const cb = 1 - P.centerBias * d2;
      const i = y * w + x;
      const f = ft.data[i];
      const g = edge.data[i];
      S.data[i] = (f > g ? f : g) * cb;
    }
  }
  normalizeByPercentileInPlace(S, P.finalClipPct, P.gamma);

  // 5. eye map (fine + coarse scale, jointly normalized) and integral image
  const eyeMap = gaussianBlur(S, P.sigmaEye * L);
  const coarse = gaussianBlur(S, P.sigmaEyeCoarse * L);
  for (let i = 0; i < n; i++) eyeMap.data[i] += coarse.data[i];
  normalizeByMaxInPlace(eyeMap);
  let coverageMap = S;
  if (P.coverageGamma !== 1) {
    coverageMap = makeGray(w, h);
    for (let i = 0; i < n; i++) coverageMap.data[i] = Math.pow(S.data[i], P.coverageGamma);
  }
  const integral = buildIntegral(coverageMap);
  const totalMass = rectSum(integral, 0, 0, w, h);

  // 6. structure tensor over L, a, b (Di Zenzo multi-channel gradient), smoothed and normalized
  const tensor = structureTensor([Lb, ab, bb], P.sigmaTensor * L);

  // 7. where the salient mass lives and how much of the frame it spans — measured on a
  //    sharpened map so that diffuse background texture does not stretch the box
  const core = makeGray(w, h);
  for (let i = 0; i < n; i++) core.data[i] = Math.pow(S.data[i], P.boxGamma);
  const subjectBox = massBox(core, P.boxTail);
  const subjectExtent = (subjectBox.w / w + subjectBox.h / h) / 2;

  return {
    width: w,
    height: h,
    saliency: S,
    eyeMap,
    integral,
    totalMass,
    tensor,
    subjectBox,
    subjectExtent,
    meanLuma,
    parts: { ft, edge },
  };
}

/**
 * Bounding box of the mass between the `tail` and `1 − tail` quantiles of the
 * column and row marginals (pixel-edge coordinates). Empty map ⇒ zero-size box.
 */
export function massBox(map: GrayMap, tail = 0.02): Rect {
  const { width: w, height: h, data } = map;
  const cols = new Float64Array(w);
  const rows = new Float64Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      cols[x] += v;
      rows[y] += v;
      total += v;
    }
  }
  if (!(total > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const span = (marginal: Float64Array): [number, number] => {
    let acc = 0;
    let lo = 0;
    let hi = marginal.length;
    for (let i = 0; i < marginal.length; i++) {
      acc += marginal[i];
      if (acc >= tail * total) {
        lo = i;
        break;
      }
    }
    acc = 0;
    for (let i = marginal.length - 1; i >= 0; i--) {
      acc += marginal[i];
      if (acc >= tail * total) {
        hi = i + 1;
        break;
      }
    }
    return [lo, Math.max(lo, hi)];
  };
  const [x0, x1] = span(cols);
  const [y0, y1] = span(rows);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function structureTensor(planes: GrayMap[], sigma: number): StructureTensor {
  const w = planes[0].width;
  const h = planes[0].height;
  const n = w * h;
  const xx = makeGray(w, h);
  const xy = makeGray(w, h);
  const yy = makeGray(w, h);
  for (const plane of planes) {
    const { gx, gy } = sobelXY(plane);
    for (let i = 0; i < n; i++) {
      const a = gx.data[i];
      const b = gy.data[i];
      xx.data[i] += a * a;
      xy.data[i] += a * b;
      yy.data[i] += b * b;
    }
  }
  const Jxx = gaussianBlur(xx, sigma);
  const Jxy = gaussianBlur(xy, sigma);
  const Jyy = gaussianBlur(yy, sigma);
  const trace = new Float32Array(n);
  for (let i = 0; i < n; i++) trace[i] = Jxx.data[i] + Jyy.data[i];
  const ref = percentile(trace, 0.99);
  if (ref > 0) {
    const inv = 1 / ref;
    for (let i = 0; i < n; i++) {
      Jxx.data[i] *= inv;
      Jxy.data[i] *= inv;
      Jyy.data[i] *= inv;
    }
  } else {
    Jxx.data.fill(0);
    Jxy.data.fill(0);
    Jyy.data.fill(0);
  }
  return { xx: Jxx, xy: Jxy, yy: Jyy };
}
