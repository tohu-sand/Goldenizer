export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG の生成に失敗しました（画像が大きすぎる可能性があります）'));
      }, 'image/png');
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** `photo.jpg` → `photo_golden.png`; other candidates get a suffix: `photo_golden_2.png` */
export function downloadName(originalName: string, candidateIndex = 0): string {
  const base = (originalName || 'image').replace(/\.[^.]+$/, '') || 'image';
  return candidateIndex > 0 ? `${base}_golden_${candidateIndex + 1}.png` : `${base}_golden.png`;
}
