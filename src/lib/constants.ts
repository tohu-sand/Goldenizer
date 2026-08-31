/** Golden ratio φ = (1 + √5) / 2. */
export const PHI = (1 + Math.sqrt(5)) / 2;
/** 1 / φ = φ − 1. */
export const INV_PHI = 1 / PHI;

/**
 * Canonical eye (convergence point) of the golden spiral inside the canonical
 * golden rectangle [0, φ] × [0, 1] with the first square on the left.
 * Derived as the intersection of the rectangle's diagonal and the reciprocal
 * rectangle's diagonal: (φ(φ+1)/(φ+2), 1/(φ+2)) ≈ (1.17082, 0.27639).
 */
export const EYE_U = (PHI * (PHI + 1)) / (PHI + 2);
export const EYE_V = 1 / (PHI + 2);

/** Working resolution (longest side) used for analysis. */
export const WORK_MAX = 256;
/** Maximum render canvas size (longest side) — keeps within iOS Safari canvas limits. */
export const MAX_RENDER = 4096;
/** Minimum accepted image side. */
export const MIN_IMAGE_SIDE = 16;
