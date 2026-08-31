import { MIN_IMAGE_SIDE } from '../lib/constants';
import { fitSize } from '../lib/filters';
import type { RgbaImage } from '../lib/types';

export const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/svg+xml'];
const ACCEPTED_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'];

export class ImageInputError extends Error {}

export function isAcceptedFile(file: File): boolean {
  if (file.type) return ACCEPTED_MIME.includes(file.type.toLowerCase());
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ACCEPTED_EXT.includes(ext);
}

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decodeViaImg(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    return {
      source: img,
      width,
      height,
      close: () => {
        img.src = '';
        URL.revokeObjectURL(url);
      },
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Decode a File into something drawable. Uses createImageBitmap with EXIF
 * orientation applied; falls back to <img> (covers SVG and older engines).
 */
export async function decodeFile(file: File): Promise<DecodedImage> {
  if (!isAcceptedFile(file)) {
    throw new ImageInputError('対応していないファイル形式です（PNG / JPEG / WebP / GIF / AVIF / BMP / SVG）');
  }
  let decoded: DecodedImage | undefined;
  if (typeof createImageBitmap === 'function' && file.type !== 'image/svg+xml') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      decoded = { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      decoded = undefined;
    }
  }
  if (!decoded) {
    try {
      decoded = await decodeViaImg(file);
    } catch {
      throw new ImageInputError('画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です。');
    }
  }
  if (decoded.width < MIN_IMAGE_SIDE || decoded.height < MIN_IMAGE_SIDE) {
    decoded.close();
    throw new ImageInputError(`画像が小さすぎます（${MIN_IMAGE_SIDE}px 以上必要です）`);
  }
  return decoded;
}

function make2d(width: number, height: number, willReadFrequently = false): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently });
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/** Draw the decoded image onto a canvas no larger than `maxSide` on its longest side. */
export function makeRenderCanvas(decoded: DecodedImage, maxSide: number): HTMLCanvasElement {
  const size = fitSize(decoded.width, decoded.height, maxSide);
  const [c, ctx] = make2d(size.width, size.height);
  ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
  return c;
}

/**
 * Downscale a canvas so its longest side is ≤ maxSide, by repeated halving
 * (avoids the aliasing of a single large-ratio drawImage). Returns a new canvas.
 */
export function downscaleCanvas(src: HTMLCanvasElement, maxSide: number, willReadFrequently = false): HTMLCanvasElement {
  const target = fitSize(src.width, src.height, maxSide);
  let cur: HTMLCanvasElement = src;
  while (cur.width / 2 >= target.width * 2 && cur.height / 2 >= target.height * 2) {
    const [half, ctx] = make2d(Math.floor(cur.width / 2), Math.floor(cur.height / 2));
    ctx.drawImage(cur, 0, 0, half.width, half.height);
    if (cur !== src) cur.width = 0; // release intermediate
    cur = half;
  }
  const [out, ctx] = make2d(target.width, target.height, willReadFrequently);
  ctx.drawImage(cur, 0, 0, target.width, target.height);
  if (cur !== src) cur.width = 0;
  return out;
}

/** Working-resolution RGBA bytes for analysis. */
export function makeWorkingImage(src: HTMLCanvasElement, maxSide: number): RgbaImage {
  const out = downscaleCanvas(src, maxSide, true);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  const data = ctx.getImageData(0, 0, out.width, out.height).data;
  const { width, height } = out;
  out.width = 0;
  return { width, height, data };
}
