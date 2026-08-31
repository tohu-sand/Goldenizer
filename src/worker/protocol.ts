import type { AnalyzeOptions, AnalyzeStage } from '../lib/analyze';
import type { Candidate, ScoreTerms } from '../lib/search';
import type { Placement } from '../lib/types';

export interface AnalyzeRequest {
  type: 'analyze';
  id: number;
  width: number;
  height: number;
  /** RGBA bytes (transferred). */
  rgba: ArrayBuffer;
  options?: AnalyzeOptions;
  /** When true, the saliency maps are sent back (transferred). */
  debug?: boolean;
}

export interface AnalyzeProgress {
  type: 'progress';
  id: number;
  stage: AnalyzeStage;
  fraction: number;
}

export interface AnalyzeResponse {
  type: 'result';
  id: number;
  /** Working-resolution size the placement refers to. */
  width: number;
  height: number;
  placement: Placement;
  score: number;
  terms: ScoreTerms;
  top: Candidate[];
  meanLuma: number;
  evaluated: number;
  timings: { saliency: number; search: number; total: number };
  /** Float32 saliency map (width × height), only when `debug`. */
  saliency?: ArrayBuffer;
  /** Float32 eye map (width × height), only when `debug`. */
  eyeMap?: ArrayBuffer;
}

export interface AnalyzeError {
  type: 'error';
  id: number;
  message: string;
}

export type WorkerIn = AnalyzeRequest;
export type WorkerOut = AnalyzeProgress | AnalyzeResponse | AnalyzeError;
