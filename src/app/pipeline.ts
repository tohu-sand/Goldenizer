import { MAX_RENDER, WORK_MAX } from '../lib/constants';
import { clampInside, scalePlacement } from '../lib/geometry';
import type { Candidate } from '../lib/search';
import type { Placement } from '../lib/types';
import { decodeFile, makeRenderCanvas, makeWorkingImage } from '../render/imageio';
import { drawOverlay, overlayStyleFor } from '../render/overlay';
import type { AnalyzeResponse } from '../worker/protocol';
import type { AnalyzeClient } from './workerClient';

export type PipelineStage = 'decode' | 'analyze' | 'render';

export interface PipelineResult {
  file: File;
  /** Pristine image at render resolution (never drawn on). */
  base: HTMLCanvasElement;
  /** Display canvas: base + overlay of the selected candidate. */
  canvas: HTMLCanvasElement;
  /** Distinct candidates in working coordinates, best first. */
  candidates: Candidate[];
  /** working → render coordinate factor. */
  scale: number;
  response: AnalyzeResponse;
  originalWidth: number;
  originalHeight: number;
  clientTimings: { decode: number; analyze: number; render: number };
}

export interface PipelineOptions {
  debug?: boolean;
  onStage?: (stage: PipelineStage, fraction?: number) => void;
  /** Return true to abort (e.g. a newer image was dropped). */
  isCancelled?: () => boolean;
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

/** Placement of candidate `index` in render-canvas coordinates. */
export function placementFor(r: PipelineResult, index: number): Placement {
  const c = r.candidates[index] ?? r.candidates[0];
  return clampInside(scalePlacement(c.placement, r.scale), r.canvas.width, r.canvas.height);
}

/** Redraw the display canvas with candidate `index`; returns its placement. */
export function drawCandidate(r: PipelineResult, index: number): Placement {
  const ctx = r.canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(r.base, 0, 0);
  const p = placementFor(r, index);
  drawOverlay(ctx, p, overlayStyleFor(r.canvas.width, r.canvas.height, r.response.meanLuma));
  return p;
}

export async function runPipeline(file: File, client: AnalyzeClient, opts: PipelineOptions = {}): Promise<PipelineResult> {
  const cancelled = () => opts.isCancelled?.() === true;
  const t0 = performance.now();
  opts.onStage?.('decode');
  const decoded = await decodeFile(file);
  if (cancelled()) {
    decoded.close();
    throw new CancelledError();
  }
  const base = makeRenderCanvas(decoded, MAX_RENDER);
  const working = makeWorkingImage(base, WORK_MAX);
  const originalWidth = decoded.width;
  const originalHeight = decoded.height;
  decoded.close();
  const t1 = performance.now();

  opts.onStage?.('analyze', 0);
  const response = await client.analyze(working, {
    debug: opts.debug,
    onProgress: (stage, fraction) => {
      // saliency ≈ first 40 %, search 40–90 %, refine 90–100 %
      const f = stage === 'saliency' ? 0.4 * fraction : stage === 'search' ? 0.4 + 0.5 * fraction : 0.9 + 0.1 * fraction;
      opts.onStage?.('analyze', f);
    },
  });
  if (cancelled()) {
    base.width = 0;
    throw new CancelledError();
  }
  const t2 = performance.now();

  opts.onStage?.('render');
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const result: PipelineResult = {
    file,
    base,
    canvas,
    candidates: response.top.length ? response.top : [{ placement: response.placement, score: response.score, terms: response.terms }],
    scale: base.width / response.width,
    response,
    originalWidth,
    originalHeight,
    clientTimings: { decode: t1 - t0, analyze: t2 - t1, render: 0 },
  };
  drawCandidate(result, 0);
  result.clientTimings.render = performance.now() - t2;
  return result;
}

/** Free the large canvases of a result that is no longer displayed. */
export function disposeResult(r: PipelineResult): void {
  r.base.width = 0;
  r.canvas.width = 0;
}
