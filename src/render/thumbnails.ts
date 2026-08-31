import type { Placement } from '../lib/types';
import { scalePlacement } from '../lib/geometry';
import { downscaleCanvas } from './imageio';
import { drawOverlay, overlayStyleFor } from './overlay';

/** Longest side of the thumbnail bitmap (displayed at roughly half that, for crisp lines). */
export const THUMB_MAX = 240;

/** Small copy of the pristine image, shared by all candidate thumbnails. */
export function makeThumbBase(base: HTMLCanvasElement): HTMLCanvasElement {
  return downscaleCanvas(base, THUMB_MAX);
}

/**
 * Thumbnail of one candidate: the small base image with the overlay drawn at
 * thumbnail scale (thin lines, shallow depth).
 */
export function drawThumbnail(thumbBase: HTMLCanvasElement, placementRender: Placement, renderWidth: number, meanLuma: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = thumbBase.width;
  c.height = thumbBase.height;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.drawImage(thumbBase, 0, 0);
  const k = thumbBase.width / renderWidth;
  const style = overlayStyleFor(c.width, c.height, meanLuma);
  style.squareWidth = 1;
  style.spiralWidth = 2.5;
  style.haloWidth = 1;
  style.depth = 6;
  drawOverlay(ctx, scalePlacement(placementRender, k), style);
  return c;
}
