import { spiralArcs, subdivide } from '../lib/geometry';
import type { Placement } from '../lib/types';

export interface OverlayStyle {
  stroke: string;
  haloColor: string;
  haloAlpha: number;
  squareWidth: number;
  spiralWidth: number;
  /** Extra halo width per side. */
  haloWidth: number;
  /** Subdivision depth. */
  depth: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Line widths scale with the canvas; halo colour adapts to the image brightness. */
export function overlayStyleFor(width: number, height: number, meanLuma: number): OverlayStyle {
  const R = Math.max(width, height);
  const dark = meanLuma < 0.6;
  return {
    stroke: '#FF3D00',
    haloColor: dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.35)',
    haloAlpha: 1,
    squareWidth: clamp(0.0015 * R, 1, 6),
    spiralWidth: clamp(0.003 * R, 1.5, 12),
    haloWidth: clamp(0.001 * R, 1, 4),
    depth: 10,
  };
}

/** Build the two paths: nested squares (+ outer rectangle) and the spiral. */
export function buildPaths(p: Placement, depth: number): { squares: Path2D; spiral: Path2D } {
  const squares = new Path2D();
  squares.rect(p.x, p.y, p.w, p.h);
  for (const s of subdivide(p, depth)) {
    if (s.size < 2) break;
    squares.rect(s.x, s.y, s.size, s.size);
  }
  const spiral = new Path2D();
  for (const a of spiralArcs(p, depth)) {
    if (a.r < 1) break;
    // arcs chain end to end, so the implicit connecting line between them has zero length
    spiral.arc(a.cx, a.cy, a.r, a.startAngle, a.endAngle, a.ccw);
  }
  return { squares, spiral };
}

/** Stroke the overlay: halo pass first, then squares, then the spiral. */
export function drawOverlay(ctx: CanvasRenderingContext2D, p: Placement, style: OverlayStyle): void {
  const { squares, spiral } = buildPaths(p, style.depth);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.globalAlpha = style.haloAlpha;
  ctx.strokeStyle = style.haloColor;
  ctx.lineWidth = style.squareWidth + 2 * style.haloWidth;
  ctx.stroke(squares);
  ctx.lineWidth = style.spiralWidth + 2 * style.haloWidth;
  ctx.stroke(spiral);

  ctx.globalAlpha = 1;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.squareWidth;
  ctx.stroke(squares);
  ctx.lineWidth = style.spiralWidth;
  ctx.stroke(spiral);
  ctx.restore();
}
