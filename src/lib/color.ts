/** sRGB 8-bit → linear [0, 1] lookup table. */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export const srgbToLinear8 = (v: number): number => SRGB_TO_LINEAR[v];

export interface LabPlanes {
  width: number;
  height: number;
  /** L ∈ [0, 100] */
  L: Float32Array;
  /** a, b roughly ∈ [−128, 127] */
  a: Float32Array;
  b: Float32Array;
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;
const EPS = 216 / 24389; // 0.008856
const KAPPA = 24389 / 27; // 903.3

function labF(t: number): number {
  return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/** Convert an 8-bit RGBA buffer to CIE L*a*b* planes (D65). Alpha is ignored. */
export function rgbaToLab(rgba: Uint8ClampedArray, width: number, height: number): LabPlanes {
  const n = width * height;
  const L = new Float32Array(n);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = SRGB_TO_LINEAR[rgba[j]];
    const g = SRGB_TO_LINEAR[rgba[j + 1]];
    const bl = SRGB_TO_LINEAR[rgba[j + 2]];
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * bl) / XN;
    const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * bl) / YN;
    const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * bl) / ZN;
    const fx = labF(x);
    const fy = labF(y);
    const fz = labF(z);
    L[i] = 116 * fy - 16;
    a[i] = 500 * (fx - fy);
    b[i] = 200 * (fy - fz);
  }
  return { width, height, L, a, b };
}

/** Rec. 709 luma on gamma-encoded values, ∈ [0, 1]. */
export function rgbaToLuma(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255;
  }
  return out;
}
