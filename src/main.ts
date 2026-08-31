import './style.css';
import { CancelledError, runPipeline } from './app/pipeline';
import { AnalyzeClient } from './app/workerClient';
import { ImageInputError, isAcceptedFile } from './render/imageio';
import { debugPanel, isDebugEnabled } from './ui/debugView';
import { View } from './ui/view';

const STAGE_LABEL = { decode: '読み込み中…', analyze: '解析中…', render: '描画中…' } as const;

function boot(): void {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('#app not found');
  const debug = isDebugEnabled();
  const client = new AnalyzeClient();
  let generation = 0;

  const handleFile = (file: File): void => {
    const gen = ++generation;
    const cancelled = () => gen !== generation;
    if (!isAcceptedFile(file)) {
      view.render({ kind: 'error', message: '対応していないファイル形式です（PNG / JPEG / WebP / GIF / AVIF / BMP / SVG）' });
      return;
    }
    view.render({ kind: 'processing', label: STAGE_LABEL.decode });
    runPipeline(file, client, {
      debug,
      isCancelled: cancelled,
      onStage: (stage, fraction) => {
        if (!cancelled()) view.setProgress(STAGE_LABEL[stage], stage === 'analyze' ? fraction : undefined);
      },
    })
      .then((result) => {
        if (cancelled()) return;
        view.render({ kind: 'result', result });
      })
      .catch((e: unknown) => {
        if (cancelled() || e instanceof CancelledError) return;
        const message =
          e instanceof ImageInputError
            ? e.message
            : `処理中にエラーが発生しました: ${e instanceof Error ? e.message : String(e)}`;
        console.error(e);
        view.render({ kind: 'error', message });
      });
  };

  const view = new View(
    root,
    {
      onFile: handleFile,
      onReset: () => {
        generation++;
        view.render({ kind: 'idle' });
      },
    },
    debug ? debugPanel : undefined,
  );

  // Paste anywhere on the page.
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          e.preventDefault();
          handleFile(f);
          return;
        }
      }
    }
  });

  // Dropping anywhere on the page (outside the dropzone) also works; never let the browser navigate.
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
}

boot();
