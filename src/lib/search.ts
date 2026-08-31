import { PHI } from './constants';
import { bilinearSample } from './filters';
import { ORIENTATIONS, eyePoint, isPortrait, longSide, makePlacement, sampleSpiralInto } from './geometry';
import { rectSumF } from './integral';
import type { SaliencyMaps } from './saliency';
import type { Orientation, Placement } from './types';

export interface ScoreWeights {
  /** Saliency at the eye point. */
  eye: number;
  /** Contour alignment along the spiral (edge energy across the curve). */
  path: number;
  /** Fraction of total saliency mass inside the rectangle. */
  coverage: number;
  /**
   * How closely the rectangle's four edges follow the subject's bounding box
   * (1 − mean edge distance / (0.25·L)) — the "frame the subject" rule of the
   * classic overlays. Blended in by the subject's extent: for a subject that
   * fills the frame it largely replaces coverage/scale; for a small subject it
   * is switched off and the whole picture is framed.
   */
  fit: number;
  /** Penalty weight on (1 − scale). */
  scale: number;
}

export interface SearchOptions {
  /** Fractions of the maximum fitting long side, evaluated in this order. */
  scales: number[];
  /** Coarse grid step as a fraction of the longest image side. */
  gridStep: number;
  /** Refinement window (± fraction of L) and step for position. */
  refineRadius: number;
  refineStep: number;
  /** Refinement window (±) and step for scale. */
  refineScaleRadius: number;
  refineScaleStep: number;
  /** Number of diverse coarse candidates to refine. */
  topK: number;
  spiralSamples: number;
  spiralDepth: number;
  weights: ScoreWeights;
  /** Exponent applied to the eye term (> 1 sharpens the preference for the exact focal point). */
  eyeGamma: number;
  orientations: Orientation[];
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  scales: [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4],
  gridStep: 0.04,
  refineRadius: 0.04,
  refineStep: 0.01,
  refineScaleRadius: 0.04,
  refineScaleStep: 0.01,
  topK: 8,
  spiralSamples: 96,
  spiralDepth: 8,
  weights: { eye: 0.4, path: 0.15, coverage: 0.3, fit: 0.6, scale: 0.25 },
  eyeGamma: 1,
  orientations: [...ORIENTATIONS],
};

export interface ScoreTerms {
  eye: number;
  path: number;
  coverage: number;
  fit: number;
  /** long side / maximum fitting long side ∈ (0, 1]. */
  scale: number;
}

export interface Candidate {
  placement: Placement;
  score: number;
  terms: ScoreTerms;
}

export interface SearchResult {
  best: Candidate;
  /** Refined top candidates, best first. */
  top: Candidate[];
  evaluated: number;
}

export type SearchProgress = (stage: 'search' | 'refine', fraction: number) => void;

/** Longest side of the largest golden rectangle of the given aspect that fits in w × h. */
export function maxLongSide(width: number, height: number, portrait: boolean): number {
  return portrait ? Math.min(height, width * PHI) : Math.min(width, height * PHI);
}

/** Scores a single placement against the saliency maps. */
export class Scorer {
  private readonly buf: Float64Array;
  private readonly nrm: Float64Array;
  private readonly areaTotal: number;
  /** Subject gate g ∈ [0, 1]: 0 for subjects spanning ≤ 30 % of the frame, 1 at ≥ 80 %. */
  readonly gate: number;
  /** Effective weights after blending by the gate. */
  readonly fitWeight: number;
  readonly coverageWeight: number;
  readonly scaleWeight: number;
  private readonly tolerance: number;

  constructor(
    private readonly maps: SaliencyMaps,
    private readonly opts: SearchOptions,
  ) {
    this.buf = new Float64Array(opts.spiralSamples * 2);
    this.nrm = new Float64Array(opts.spiralSamples * 2);
    this.areaTotal = maps.width * maps.height;
    const g = Math.min(1, Math.max(0, (maps.subjectExtent - 0.3) / 0.5));
    this.gate = g;
    this.fitWeight = opts.weights.fit * g;
    // as the subject fills the frame, coverage/scale hand over to the bounding-box fit
    this.coverageWeight = opts.weights.coverage * (1 - 0.7 * g);
    this.scaleWeight = opts.weights.scale * (1 - 0.7 * g);
    this.tolerance = 0.25 * Math.max(maps.width, maps.height);
  }

  /**
   * Contour term ∈ [0, 1]: for each spiral sample, `along` = sqrt(nᵀ J n) is the
   * edge energy across the curve (the curve runs along a contour) and `cross` =
   * sqrt(tᵀ J t) the edge energy along the curve (the curve cuts through a
   * contour), with n the normal, t the tangent and J the structure tensor.
   * Returns mean(0.5 + 0.5·(along − cross)): 0.5 in flat regions, → 1 when the
   * spiral hugs contours (head outline, sleeves), → 0 when it slices through them.
   */
  alignment(p: Placement, perAlong?: Float64Array, perCross?: Float64Array): number {
    const { maps, opts, buf, nrm } = this;
    const n = opts.spiralSamples;
    const T = maps.tensor;
    sampleSpiralInto(p, opts.spiralDepth, n, buf, nrm);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const x = buf[i * 2];
      const y = buf[i * 2 + 1];
      const nx = nrm[i * 2];
      const ny = nrm[i * 2 + 1];
      const jxx = bilinearSample(T.xx, x, y);
      const jxy = bilinearSample(T.xy, x, y);
      const jyy = bilinearSample(T.yy, x, y);
      // tangent t = (−ny, nx)
      let va = jxx * nx * nx + 2 * jxy * nx * ny + jyy * ny * ny;
      let vc = jxx * ny * ny - 2 * jxy * nx * ny + jyy * nx * nx;
      if (va > 1) va = 1;
      else if (va < 0) va = 0;
      if (vc > 1) vc = 1;
      else if (vc < 0) vc = 0;
      const along = Math.sqrt(va);
      const cross = Math.sqrt(vc);
      if (perAlong) perAlong[i] = along;
      if (perCross) perCross[i] = cross;
      acc += 0.5 + 0.5 * (along - cross);
    }
    return acc / n;
  }

  score(p: Placement, scale: number): Candidate {
    const { maps, opts } = this;
    const e = eyePoint(p);
    const eyeRaw = bilinearSample(maps.eyeMap, e.x, e.y);
    const eye = opts.eyeGamma === 1 ? eyeRaw : Math.pow(eyeRaw, opts.eyeGamma);
    const path = this.alignment(p);
    const massIn = rectSumF(maps.integral, p.x, p.y, p.w, p.h);
    const coverage = maps.totalMass > 0 ? massIn / maps.totalMass : (p.w * p.h) / this.areaTotal;
    const fit = this.boxFit(p);
    const w = opts.weights;
    const score =
      w.eye * eye + w.path * path + this.coverageWeight * coverage + this.fitWeight * fit - this.scaleWeight * (1 - scale);
    return { placement: p, score, terms: { eye, path, coverage, fit, scale } };
  }

  /**
   * Bounding-box fit ∈ [0, 1]: 1 − (mean distance of the four rectangle edges
   * to the subject box's edges) / (0.25·L), clipped per edge.
   */
  boxFit(p: Placement): number {
    const b = this.maps.subjectBox;
    if (!(b.w > 0 && b.h > 0)) return 0;
    const tol = this.tolerance;
    const d = (a: number, c: number) => Math.max(0, 1 - Math.abs(a - c) / tol);
    return (d(p.x, b.x) + d(p.y, b.y) + d(p.x + p.w, b.x + b.w) + d(p.y + p.h, b.y + b.h)) / 4;
  }
}

/** Grid positions 0, step, 2·step, … always ending exactly at `range` (≥ 0). */
function positions(range: number, step: number): number[] {
  if (range <= 1e-9) return [0];
  const out: number[] = [];
  for (let v = 0; v < range; v += step) out.push(v);
  out.push(range);
  return out;
}

/** Keeps the K best candidates, replacing near-duplicates (same orientation, nearby, similar scale). */
class TopList {
  readonly items: Candidate[] = [];
  constructor(
    private readonly k: number,
    private readonly posTol: number,
    private readonly scaleTol: number,
  ) {}

  private similar(a: Candidate, b: Candidate): boolean {
    const pa = a.placement;
    const pb = b.placement;
    return (
      pa.orientation === pb.orientation &&
      Math.abs(a.terms.scale - b.terms.scale) <= this.scaleTol &&
      Math.abs(pa.x + pa.w / 2 - (pb.x + pb.w / 2)) <= this.posTol &&
      Math.abs(pa.y + pa.h / 2 - (pb.y + pb.h / 2)) <= this.posTol
    );
  }

  offer(c: Candidate): void {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      if (this.similar(items[i], c)) {
        if (c.score > items[i].score) {
          items.splice(i, 1);
          this.insert(c);
        }
        return;
      }
    }
    if (items.length < this.k) this.insert(c);
    else if (c.score > items[items.length - 1].score) {
      items.pop();
      this.insert(c);
    }
  }

  private insert(c: Candidate): void {
    const items = this.items;
    let i = 0;
    while (i < items.length && items[i].score >= c.score) i++;
    items.splice(i, 0, c);
  }
}

export function searchPlacement(
  maps: SaliencyMaps,
  options: Partial<SearchOptions> = {},
  onProgress?: SearchProgress,
): SearchResult {
  const opts: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS, ...options };
  if (options.weights) opts.weights = { ...DEFAULT_SEARCH_OPTIONS.weights, ...options.weights };
  const W = maps.width;
  const H = maps.height;
  const L = Math.max(W, H);
  const step = Math.max(1, Math.round(opts.gridStep * L));
  const scorer = new Scorer(maps, opts);
  const minScale = Math.min(...opts.scales);
  let evaluated = 0;

  // --- coarse exhaustive search (scales descending so ties favour larger rects) ---
  const coarse = new TopList(opts.topK, 1.5 * step, 0.06);
  const scales = [...opts.scales].sort((a, b) => b - a);
  scales.forEach((s, si) => {
    for (const o of opts.orientations) {
      const portrait = isPortrait(o);
      const maxLong = maxLongSide(W, H, portrait);
      const long = s * maxLong;
      const short = long / PHI;
      const w = portrait ? short : long;
      const h = portrait ? long : short;
      const xs = positions(W - w, step);
      const ys = positions(H - h, step);
      for (const y of ys) {
        for (const x of xs) {
          coarse.offer(scorer.score(makePlacement(x, y, short, o), s));
          evaluated++;
        }
      }
    }
    onProgress?.('search', (si + 1) / scales.length);
  });

  // --- local refinement around each diverse seed ---
  const refined: Candidate[] = [];
  const seeds = coarse.items;
  const posStep = Math.max(0.5, opts.refineStep * L);
  const posRadius = opts.refineRadius * L;
  seeds.forEach((seed, i) => {
    let best = seed;
    const o = seed.placement.orientation;
    const portrait = isPortrait(o);
    const maxLong = maxLongSide(W, H, portrait);
    const cx0 = seed.placement.x + seed.placement.w / 2;
    const cy0 = seed.placement.y + seed.placement.h / 2;
    for (let ds = -opts.refineScaleRadius; ds <= opts.refineScaleRadius + 1e-9; ds += opts.refineScaleStep) {
      const s = seed.terms.scale + ds;
      if (s > 1 + 1e-9 || s < minScale - 1e-9) continue;
      const long = Math.min(s, 1) * maxLong;
      const short = long / PHI;
      const w = portrait ? short : long;
      const h = portrait ? long : short;
      for (let dy = -posRadius; dy <= posRadius + 1e-9; dy += posStep) {
        const y = Math.min(Math.max(cy0 + dy - h / 2, 0), Math.max(0, H - h));
        for (let dx = -posRadius; dx <= posRadius + 1e-9; dx += posStep) {
          const x = Math.min(Math.max(cx0 + dx - w / 2, 0), Math.max(0, W - w));
          const c = scorer.score(makePlacement(x, y, short, o), Math.min(s, 1));
          evaluated++;
          if (c.score > best.score) best = c;
        }
      }
    }
    refined.push(best);
    onProgress?.('refine', (i + 1) / seeds.length);
  });

  refined.sort((a, b) => b.score - a.score);
  // refinement can make two seeds converge on the same placement — keep distinct ones only
  const top: Candidate[] = [];
  for (const c of refined) if (!top.some((u) => nearDuplicate(u, c, L))) top.push(c);
  return { best: top[0], top, evaluated };
}

/** Same orientation, centres within 2 % of L and scale within 0.03. */
export function nearDuplicate(a: Candidate, b: Candidate, L: number): boolean {
  const pa = a.placement;
  const pb = b.placement;
  return (
    pa.orientation === pb.orientation &&
    Math.abs(a.terms.scale - b.terms.scale) <= 0.03 &&
    Math.abs(pa.x + pa.w / 2 - (pb.x + pb.w / 2)) <= 0.02 * L &&
    Math.abs(pa.y + pa.h / 2 - (pb.y + pb.h / 2)) <= 0.02 * L
  );
}

/** Human-readable size of a candidate for logs. */
export function describeCandidate(c: Candidate): string {
  const p = c.placement;
  return `o=${p.orientation} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} w=${p.w.toFixed(1)} h=${p.h.toFixed(1)} long=${longSide(p).toFixed(1)} score=${c.score.toFixed(3)} [eye=${c.terms.eye.toFixed(2)} path=${c.terms.path.toFixed(2)} cov=${c.terms.coverage.toFixed(2)} fit=${c.terms.fit.toFixed(2)} scale=${c.terms.scale.toFixed(2)}]`;
}
