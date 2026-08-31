import { computeSaliency, type SaliencyMaps, type SaliencyParams } from './saliency';
import { searchPlacement, type Candidate, type SearchOptions } from './search';

export interface AnalyzeOptions {
  saliency?: Partial<SaliencyParams>;
  search?: Partial<SearchOptions>;
}

export type AnalyzeStage = 'saliency' | 'search' | 'refine';
export type ProgressFn = (stage: AnalyzeStage, fraction: number) => void;

export interface AnalyzeResult {
  width: number;
  height: number;
  best: Candidate;
  top: Candidate[];
  meanLuma: number;
  evaluated: number;
  timings: { saliency: number; search: number; total: number };
  maps: SaliencyMaps;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Full pipeline on an RGBA buffer at working resolution:
 * saliency maps → exhaustive candidate search → refined best placement.
 * All coordinates in the result are in the buffer's pixel space.
 */
export function analyzeImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: AnalyzeOptions = {},
  onProgress?: ProgressFn,
): AnalyzeResult {
  const t0 = now();
  onProgress?.('saliency', 0);
  const maps = computeSaliency(rgba, width, height, options.saliency);
  const t1 = now();
  onProgress?.('saliency', 1);
  const { best, top, evaluated } = searchPlacement(maps, options.search, onProgress);
  const t2 = now();
  return {
    width,
    height,
    best,
    top,
    meanLuma: maps.meanLuma,
    evaluated,
    timings: { saliency: t1 - t0, search: t2 - t1, total: t2 - t0 },
    maps,
  };
}
