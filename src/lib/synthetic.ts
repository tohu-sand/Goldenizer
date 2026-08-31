import type { RgbaImage } from './types';

export type Rgb = readonly [number, number, number];

export const WHITE: Rgb = [255, 255, 255];
export const BLACK: Rgb = [0, 0, 0];

/** Solid-filled RGBA image. */
export function makeImage(width: number, height: number, fill: Rgb = WHITE): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

export function setPixel(img: RgbaImage, x: number, y: number, c: Rgb): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = 255;
}

export function fillRect(img: RgbaImage, x: number, y: number, w: number, h: number, c: Rgb): void {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx++) setPixel(img, xx, yy, c);
}

export function fillDisc(img: RgbaImage, cx: number, cy: number, r: number, c: Rgb): void {
  const r2 = r * r;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(img.height - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(img.width - 1, Math.ceil(cx + r)); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPixel(img, x, y, c);
    }
  }
}

/** Ring of outer radius r and given thickness. */
export function strokeCircle(img: RgbaImage, cx: number, cy: number, r: number, thickness: number, c: Rgb): void {
  const ro2 = r * r;
  const ri = Math.max(0, r - thickness);
  const ri2 = ri * ri;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(img.height - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(img.width - 1, Math.ceil(cx + r)); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= ro2 && d2 >= ri2) setPixel(img, x, y, c);
    }
  }
}

/** Deterministic LCG in [0, 1). */
export function makeRng(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Add uniform noise of ±amplitude to RGB (alpha untouched). */
export function addNoise(img: RgbaImage, amplitude: number, seed = 1): void {
  const rnd = makeRng(seed);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) d[i + k] = d[i + k] + (rnd() * 2 - 1) * amplitude;
  }
}

/** Axis-aligned filled ellipse. */
export function fillEllipse(img: RgbaImage, cx: number, cy: number, rx: number, ry: number, c: Rgb): void {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(img.height - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(img.width - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(img, x, y, c);
    }
  }
}

/** Straight stroke of the given width (round caps). */
export function strokeLine(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, width: number, c: Rgb): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillDisc(img, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, c);
  }
}

/** Vertical linear gradient between two colours. */
export function fillGradientV(img: RgbaImage, top: Rgb, bottom: Rgb): void {
  for (let y = 0; y < img.height; y++) {
    const t = img.height > 1 ? y / (img.height - 1) : 0;
    const c: Rgb = [top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t, top[2] + (bottom[2] - top[2]) * t];
    for (let x = 0; x < img.width; x++) setPixel(img, x, y, c);
  }
}
