/**
 * Generate synthetic test images that mimic common inputs (line art, a backlit
 * sun, a portrait) so placement can be eyeballed without real photos.
 *
 *   pnpm tsx scripts/make-samples.ts [outDir=out/samples]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  addNoise,
  fillDisc,
  fillEllipse,
  fillGradientV,
  fillRect,
  makeImage,
  makeRng,
  strokeCircle,
  strokeLine,
  type Rgb,
} from '../src/lib/synthetic';
import type { RgbaImage } from '../src/lib/types';

const outDir = process.argv[2] ?? 'out/samples';
mkdirSync(outDir, { recursive: true });

function save(img: RgbaImage, name: string): void {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  const path = join(outDir, name);
  writeFileSync(path, PNG.sync.write(png));
  console.log('wrote', path);
}

const INK: Rgb = [20, 20, 20];

/** White page, black strokes: a stick-ish figure with a dense-haired head. */
function lineArt(): RgbaImage {
  const img = makeImage(800, 1100);
  const rnd = makeRng(3);
  const cx = 400;
  const cy = 320;
  strokeCircle(img, cx, cy, 120, 3, INK);
  // hair: many short strokes fanning over the top of the head
  for (let i = 0; i < 60; i++) {
    const a = -Math.PI * (0.05 + 0.9 * rnd());
    const r0 = 100 + rnd() * 30;
    const r1 = r0 + 60 + rnd() * 90;
    const wob = (rnd() - 0.5) * 0.4;
    strokeLine(img, cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), cx + r1 * Math.cos(a + wob), cy + r1 * Math.sin(a + wob), 2.5, INK);
  }
  // eyes, brows, mouth
  strokeCircle(img, cx - 45, cy + 10, 16, 4, INK);
  strokeCircle(img, cx + 45, cy + 10, 16, 4, INK);
  strokeLine(img, cx - 65, cy - 25, cx - 25, cy - 30, 3, INK);
  strokeLine(img, cx + 25, cy - 30, cx + 65, cy - 25, 3, INK);
  strokeLine(img, cx - 25, cy + 60, cx + 25, cy + 62, 3, INK);
  // neck, torso, arms, legs
  strokeLine(img, cx - 20, cy + 118, cx - 25, cy + 160, 3, INK);
  strokeLine(img, cx + 20, cy + 118, cx + 25, cy + 160, 3, INK);
  strokeLine(img, cx - 130, cy + 175, cx + 130, cy + 175, 3, INK);
  strokeLine(img, cx - 130, cy + 175, cx - 150, cy + 520, 3, INK);
  strokeLine(img, cx + 130, cy + 175, cx + 150, cy + 520, 3, INK);
  strokeLine(img, cx - 150, cy + 520, cx + 150, cy + 520, 3, INK);
  strokeLine(img, cx - 130, cy + 175, cx - 230, cy + 420, 3, INK);
  strokeLine(img, cx + 130, cy + 175, cx + 240, cy + 400, 3, INK);
  strokeLine(img, cx - 80, cy + 520, cx - 90, cy + 760, 3, INK);
  strokeLine(img, cx + 80, cy + 520, cx + 100, cy + 760, 3, INK);
  return img;
}

/** Sunset: gradient sky, bright sun, dark water, tree silhouettes on the left. */
function sunset(): RgbaImage {
  const img = makeImage(1200, 750);
  fillGradientV(img, [40, 50, 110], [250, 150, 110]);
  fillDisc(img, 820, 330, 55, [255, 250, 225]);
  fillDisc(img, 820, 330, 40, [255, 255, 255]);
  fillRect(img, 0, 420, 1200, 330, [30, 35, 50]);
  const rnd = makeRng(9);
  for (let x = 0; x < 380; x += 22 + rnd() * 10) {
    const h = 120 + rnd() * 140;
    const w = 26 + rnd() * 20;
    for (let yy = 0; yy < h; yy++) {
      const half = (w * yy) / h / 2;
      fillRect(img, Math.round(x - half), 420 - h + yy, Math.max(1, Math.round(half * 2)), 1, [15, 20, 25]);
    }
  }
  addNoise(img, 6, 4);
  return img;
}

/** Portrait: dark background, bright face with features, dark hair, body below. */
function portrait(): RgbaImage {
  const img = makeImage(900, 1200, [55, 58, 66]);
  addNoise(img, 10, 2);
  // body
  fillEllipse(img, 450, 1250, 330, 420, [90, 60, 50]);
  // hair
  fillEllipse(img, 450, 380, 190, 230, [35, 25, 20]);
  // face
  fillEllipse(img, 450, 440, 140, 180, [235, 195, 170]);
  // eyes / brows / mouth
  fillEllipse(img, 395, 415, 22, 12, [250, 250, 250]);
  fillEllipse(img, 505, 415, 22, 12, [250, 250, 250]);
  fillDisc(img, 397, 416, 9, [30, 25, 25]);
  fillDisc(img, 507, 416, 9, [30, 25, 25]);
  strokeLine(img, 365, 385, 425, 380, 6, [40, 30, 25]);
  strokeLine(img, 475, 380, 535, 385, 6, [40, 30, 25]);
  strokeLine(img, 415, 530, 485, 532, 7, [160, 70, 80]);
  return img;
}

save(lineArt(), 'lineart.png');
save(sunset(), 'sunset.png');
save(portrait(), 'portrait.png');
