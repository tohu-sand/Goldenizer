/**
 * Headless dev CLI: decode a PNG/JPEG, run the analysis at working resolution,
 * rasterize the golden-spiral overlay onto the full-size image and write a PNG.
 *
 *   pnpm cli <in.png|jpg> <out.png> [--saliency <map.png>] [--work <px>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { analyzeImage, type AnalyzeOptions } from '../src/lib/analyze';
import type { ScoreWeights } from '../src/lib/search';
import { MAX_RENDER, PHI, WORK_MAX } from '../src/lib/constants';
import { bilinearSample, downscaleRgba, fitSize } from '../src/lib/filters';
import {
  clampInside,
  describeOrientation,
  eyePoint,
  isPortrait,
  longSide,
  makePlacement,
  sampleSpiral,
  sampleSpiralInto,
  scalePlacement,
  shortSide,
  subdivide,
} from '../src/lib/geometry';
import { DEFAULT_SEARCH_OPTIONS, Scorer, describeCandidate, maxLongSide, type SearchOptions } from '../src/lib/search';
import type { GrayMap, Orientation, Placement, Point, RgbaImage } from '../src/lib/types';

// ---------------------------------------------------------------- image I/O

function decode(path: string): RgbaImage {
  const buf = readFileSync(path);
  const ext = extname(path).toLowerCase();
  if (ext === '.png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
    return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer, j.data.byteOffset, j.data.length) };
  }
  throw new Error(`unsupported extension: ${ext}`);
}

function encodePng(img: RgbaImage, path: string): void {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

// ---------------------------------------------------------------- rasterizer

type Rgb = readonly [number, number, number];

/** Coverage mask (0..1 per pixel) that strokes accumulate into before one composite pass. */
class Mask {
  readonly data: Float32Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Float32Array(width * height);
  }

  /** Anti-aliased disc stamp: coverage = max(existing, 1 − dist outside radius). */
  disc(cx: number, cy: number, r: number): void {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
        const c = d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d;
        if (c > 0) {
          const i = y * this.width + x;
          if (c > this.data[i]) this.data[i] = c;
        }
      }
    }
  }

  line(a: Point, b: Point, width: number): void {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, width / 2);
    }
  }

  polyline(pts: Point[], width: number): void {
    for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i], pts[i + 1], width);
  }

  rect(x: number, y: number, w: number, h: number, width: number): void {
    const tl = { x, y };
    const tr = { x: x + w, y };
    const br = { x: x + w, y: y + h };
    const bl = { x, y: y + h };
    this.line(tl, tr, width);
    this.line(tr, br, width);
    this.line(br, bl, width);
    this.line(bl, tl, width);
  }

  composite(img: RgbaImage, color: Rgb, alpha: number): void {
    const d = img.data;
    for (let i = 0; i < this.data.length; i++) {
      const a = this.data[i] * alpha;
      if (a <= 0) continue;
      const j = i * 4;
      d[j] = d[j] * (1 - a) + color[0] * a;
      d[j + 1] = d[j + 1] * (1 - a) + color[1] * a;
      d[j + 2] = d[j + 2] * (1 - a) + color[2] * a;
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Same styling rules as render/overlay.ts, applied to a raw RGBA buffer. */
function drawOverlay(img: RgbaImage, p: Placement, meanLuma: number): void {
  const R = Math.max(img.width, img.height);
  const wSquares = clamp(0.0015 * R, 1, 6);
  const wSpiral = clamp(0.003 * R, 1.5, 12);
  const halo = clamp(0.001 * R, 1, 4);
  const stroke: Rgb = [255, 61, 0];
  const haloColor: Rgb = meanLuma < 0.6 ? [255, 255, 255] : [0, 0, 0];
  const haloAlpha = meanLuma < 0.6 ? 0.6 : 0.35;

  const squares = subdivide(p, 10).filter((s) => s.size >= 2);
  const n = Math.max(64, Math.ceil((4.11 * shortSide(p)) / 2));
  const spiral = sampleSpiral(p, 10, n);

  const haloMask = new Mask(img.width, img.height);
  haloMask.rect(p.x, p.y, p.w, p.h, wSquares + 2 * halo);
  for (const s of squares) haloMask.rect(s.x, s.y, s.size, s.size, wSquares + 2 * halo);
  haloMask.polyline(spiral, wSpiral + 2 * halo);
  haloMask.composite(img, haloColor, haloAlpha);

  const lineMask = new Mask(img.width, img.height);
  lineMask.rect(p.x, p.y, p.w, p.h, wSquares);
  for (const s of squares) lineMask.rect(s.x, s.y, s.size, s.size, wSquares);
  lineMask.composite(img, stroke, 1);

  const spiralMask = new Mask(img.width, img.height);
  spiralMask.polyline(spiral, wSpiral);
  spiralMask.composite(img, stroke, 1);
}

function grayToPng(map: GrayMap, p?: Placement): RgbaImage {
  const img: RgbaImage = { width: map.width, height: map.height, data: new Uint8ClampedArray(map.width * map.height * 4) };
  for (let i = 0; i < map.data.length; i++) {
    const v = clamp(map.data[i], 0, 1) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  if (p) {
    const m = new Mask(map.width, map.height);
    m.rect(p.x, p.y, p.w, p.h, 1);
    const e = eyePoint(p);
    m.disc(e.x, e.y, 2);
    m.composite(img, [255, 61, 0], 1);
  }
  return img;
}

// ---------------------------------------------------------------- main

function main(argv: string[]): void {
  const args = argv.slice(2);
  const positional: string[] = [];
  let saliencyOut: string | undefined;
  let workMax = WORK_MAX;
  let renderMax = MAX_RENDER;
  let eyeGamma: number | undefined;
  let covGamma: number | undefined;
  /** --place o,x,y,shortSide (output-image coords): render and score this placement instead of the best. */
  let forced: number[] | undefined;
  const weights: Partial<ScoreWeights> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--saliency') saliencyOut = args[++i];
    else if (args[i] === '--work') workMax = Number(args[++i]);
    else if (args[i] === '--max') renderMax = Number(args[++i]);
    else if (args[i] === '--eye-gamma') eyeGamma = Number(args[++i]);
    else if (args[i] === '--cov-gamma') covGamma = Number(args[++i]);
    else if (args[i] === '--w-eye') weights.eye = Number(args[++i]);
    else if (args[i] === '--w-path') weights.path = Number(args[++i]);
    else if (args[i] === '--w-cov') weights.coverage = Number(args[++i]);
    else if (args[i] === '--w-scale') weights.scale = Number(args[++i]);
    else if (args[i] === '--w-fit') weights.fit = Number(args[++i]);
    else if (args[i] === '--place') forced = args[++i].split(',').map(Number);
    else positional.push(args[i]);
  }
  const [inPath, outPath] = positional;
  if (!inPath || !outPath) {
    console.error(
      'usage: pnpm cli <in.png|jpg> <out.png> [--saliency <map.png>] [--work <px>] [--max <px>] [--eye-gamma <n>] [--cov-gamma <n>] [--w-eye|--w-path|--w-cov|--w-scale <n>]',
    );
    process.exit(2);
  }
  const options: AnalyzeOptions = { search: { ...(eyeGamma !== undefined ? { eyeGamma } : {}), weights: weights as ScoreWeights } };
  if (Object.keys(weights).length === 0) delete options.search!.weights;
  if (covGamma !== undefined) options.saliency = { coverageGamma: covGamma };

  const t0 = performance.now();
  const decoded = decode(inPath);
  // mirror the browser's render cap (MAX_RENDER) — and allow smaller outputs for quick eyeballing
  const renderSize = fitSize(decoded.width, decoded.height, renderMax);
  const full = renderSize.width === decoded.width ? decoded : downscaleRgba(decoded, renderSize.width, renderSize.height);
  const t1 = performance.now();
  const size = fitSize(full.width, full.height, workMax);
  const work = downscaleRgba(full, size.width, size.height);
  const t2 = performance.now();
  const res = analyzeImage(work.data, work.width, work.height, options);
  const t3 = performance.now();

  const k = full.width / work.width;
  let placement = clampInside(scalePlacement(res.best.placement, k), full.width, full.height);
  const searchOpts: SearchOptions = {
    ...DEFAULT_SEARCH_OPTIONS,
    ...(options.search ?? {}),
    weights: { ...DEFAULT_SEARCH_OPTIONS.weights, ...(options.search?.weights ?? {}) },
  };
  const scorer = new Scorer(res.maps, searchOpts);
  /** Mean alignment per spiral level (arc), using the arc-length partition of the samples. */
  const alignmentByLevel = (p: Placement): string => {
    const n = searchOpts.spiralSamples;
    const along = new Float64Array(n);
    const cross = new Float64Array(n);
    const total = scorer.alignment(p, along, cross);
    const lengths = Array.from({ length: searchOpts.spiralDepth }, (_, i) => (Math.PI / 2) * Math.pow(PHI, -i));
    const totalLen = lengths.reduce((a, b) => a + b, 0);
    const sa: number[] = [];
    const sc: number[] = [];
    const ss: number[] = [];
    const counts: number[] = [];
    const pts = new Float64Array(n * 2);
    sampleSpiralInto(p, searchOpts.spiralDepth, n, pts);
    let lvl = 0;
    let consumed = 0;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * totalLen;
      while (lvl < lengths.length - 1 && t > consumed + lengths[lvl]) {
        consumed += lengths[lvl];
        lvl++;
      }
      sa[lvl] = (sa[lvl] ?? 0) + along[i];
      sc[lvl] = (sc[lvl] ?? 0) + cross[i];
      ss[lvl] = (ss[lvl] ?? 0) + bilinearSample(res.maps.saliency, pts[i * 2], pts[i * 2 + 1]);
      counts[lvl] = (counts[lvl] ?? 0) + 1;
    }
    return (
      `path=${total.toFixed(3)} ` +
      sa.map((s, i) => `L${i}:${(s / counts[i]).toFixed(2)}/${(sc[i] / counts[i]).toFixed(2)}/S${(ss[i] / counts[i]).toFixed(2)}`).join(' ') +
      '  (along/cross/saliency)'
    );
  };
  console.log(`best alignment by level: ${alignmentByLevel(res.best.placement)}`);
  if (forced && forced.length >= 4) {
    const [o, fx, fy, fshort] = forced;
    placement = clampInside(makePlacement(fx, fy, fshort, o as Orientation), full.width, full.height);
    const workP = scalePlacement(placement, 1 / k);
    const scale = longSide(workP) / maxLongSide(work.width, work.height, isPortrait(workP.orientation));
    const c = scorer.score(workP, scale);
    console.log(`forced placement: ${describeCandidate(c)}`);
    console.log(`forced alignment by level: ${alignmentByLevel(workP)}`);
  }
  drawOverlay(full, placement, res.meanLuma);
  encodePng(full, outPath);
  const t4 = performance.now();

  const info = describeOrientation(placement.orientation);
  console.log(`${inPath}: ${full.width}x${full.height} → work ${work.width}x${work.height} (meanLuma ${res.meanLuma.toFixed(2)})`);
  console.log(`best: ${describeCandidate(res.best)}`);
  console.log(`      ${info.aspect}, eye ${info.eyeCorner}, ${info.winding}; full-res rect x=${placement.x.toFixed(0)} y=${placement.y.toFixed(0)} w=${placement.w.toFixed(0)} h=${placement.h.toFixed(0)}`);
  console.log('top candidates:');
  res.top.forEach((c, i) => console.log(`  ${i + 1}. ${describeCandidate(c)}`));
  console.log(
    `timings: decode ${(t1 - t0).toFixed(0)} ms, downscale ${(t2 - t1).toFixed(0)} ms, saliency ${res.timings.saliency.toFixed(0)} ms, search ${res.timings.search.toFixed(0)} ms (${res.evaluated} candidates), render+encode ${(t4 - t3).toFixed(0)} ms`,
  );
  console.log(`wrote ${outPath}`);

  if (saliencyOut) {
    const maps = res.maps;
    // side by side: saliency | eyeMap | edge energy (sqrt of the tensor trace)
    const w = maps.width;
    const h = maps.height;
    const trace = { width: w, height: h, data: new Float32Array(w * h) };
    for (let i = 0; i < w * h; i++) trace.data[i] = Math.sqrt(Math.min(1, maps.tensor.xx.data[i] + maps.tensor.yy.data[i]));
    const shown = forced ? scalePlacement(placement, 1 / k) : res.best.placement;
    const panels = [grayToPng(maps.saliency, shown), grayToPng(maps.eyeMap, shown), grayToPng(trace, shown)];
    const W = w * panels.length + 2 * (panels.length - 1);
    const all: RgbaImage = { width: W, height: h, data: new Uint8ClampedArray(W * h * 4) };
    panels.forEach((pn, idx) => {
      for (let y = 0; y < h; y++) all.data.set(pn.data.subarray(y * w * 4, (y + 1) * w * 4), (y * W + idx * (w + 2)) * 4);
    });
    encodePng(all, saliencyOut);
    console.log(`wrote ${saliencyOut} (saliency | eyeMap | edge energy)`);
  }
}

main(process.argv);
