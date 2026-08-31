import { disposeResult, drawCandidate, placementFor, type PipelineResult } from '../app/pipeline';
import { canvasToPngBlob, downloadName } from '../render/exportPng';
import { drawThumbnail, makeThumbBase } from '../render/thumbnails';
import { clear, h } from './dom';
import { createDropzone, type Dropzone } from './dropzone';

export type ViewState =
  | { kind: 'idle' }
  | { kind: 'processing'; label: string; fraction?: number }
  | { kind: 'result'; result: PipelineResult }
  | { kind: 'error'; message: string };

export interface ViewHandlers {
  onFile(file: File): void;
  onReset(): void;
}

export class View {
  private readonly main: HTMLElement;
  private readonly status: HTMLElement;
  private dropzone: Dropzone | null = null;
  private stateKind: ViewState['kind'] = 'idle';
  /** Cleanup for the current result view (blob URLs, key handler, canvases). */
  private cleanup: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    private readonly handlers: ViewHandlers,
    private readonly debugPanel?: (result: PipelineResult) => HTMLElement,
  ) {
    this.main = h('main', { class: 'main' });
    this.status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    root.append(
      h(
        'header',
        { class: 'header' },
        h(
          'h1',
          { class: 'title' },
          h('img', { class: 'title__mark', src: `${import.meta.env.BASE_URL}favicon.svg`, alt: '', width: 28, height: 28 }),
          'Goldenizer',
        ),
        h('p', { class: 'tagline' }, '画像に黄金螺旋を自動配置します。画像は送信されません。'),
      ),
      this.main,
      this.status,
      h('footer', { class: 'footer' }, '© 2026 tohu_sand. All rights reserved.'),
    );
    this.render({ kind: 'idle' });
  }

  get kind(): ViewState['kind'] {
    return this.stateKind;
  }

  /** Cheap in-place update while processing (avoids re-rendering the whole panel). */
  setProgress(label: string, fraction?: number): void {
    if (this.stateKind !== 'processing') return;
    const lbl = this.main.querySelector<HTMLElement>('.progress__label');
    const bar = this.main.querySelector<HTMLElement>('.progress__bar');
    if (lbl) lbl.textContent = label;
    if (bar) {
      bar.style.width = fraction === undefined ? '100%' : `${Math.round(fraction * 100)}%`;
      bar.classList.toggle('is-indeterminate', fraction === undefined);
    }
  }

  render(state: ViewState): void {
    this.stateKind = state.kind;
    this.cleanup?.();
    this.cleanup = null;
    clear(this.main);
    this.status.textContent = '';
    this.dropzone = null;
    switch (state.kind) {
      case 'idle':
        this.dropzone = createDropzone(this.handlers.onFile);
        this.main.append(this.dropzone.el);
        break;
      case 'processing':
        this.main.append(
          h(
            'div',
            { class: 'progress' },
            h('div', { class: 'spinner', 'aria-hidden': 'true' }),
            h('div', { class: 'progress__label' }, state.label),
            h('div', { class: 'progress__track' }, h('div', { class: 'progress__bar' })),
          ),
        );
        this.setProgress(state.label, state.fraction);
        break;
      case 'result':
        this.renderResult(state.result);
        break;
      case 'error':
        this.main.append(
          h(
            'div',
            { class: 'error' },
            h('p', { class: 'error__message' }, state.message),
            h('button', { class: 'btn', type: 'button', onclick: () => this.handlers.onReset() }, 'やり直す'),
          ),
        );
        break;
    }
  }

  private renderResult(result: PipelineResult): void {
    const canvas = result.canvas;
    const count = result.candidates.length;
    canvas.className = 'preview';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '黄金螺旋を重ねた結果画像');

    // --- candidate carousel state ---
    let selected = -1;
    const blobUrls = new Map<number, string>();
    const blobSizes = new Map<number, number>();
    let blobGeneration = 0;

    const counter = h('span', { class: 'carousel__counter', 'aria-live': 'polite' });
    const prev = h('button', { class: 'carousel__arrow carousel__arrow--prev', type: 'button', 'aria-label': '前の候補', onclick: () => select(selected - 1) }, '‹');
    const next = h('button', { class: 'carousel__arrow carousel__arrow--next', type: 'button', 'aria-label': '次の候補', onclick: () => select(selected + 1) }, '›');
    const download = h('a', { class: 'btn btn--primary is-disabled', href: '#', download: downloadName(result.file.name), 'aria-disabled': 'true' }, 'PNG を生成中…');
    download.addEventListener('click', (e) => {
      if (download.classList.contains('is-disabled')) e.preventDefault();
    });

    // thumbnails
    const thumbBase = makeThumbBase(result.base);
    const thumbs = result.candidates.map((c, i) => {
      const tc = drawThumbnail(thumbBase, placementFor(result, i), canvas.width, result.response.meanLuma);
      return h(
        'button',
        {
          class: 'thumb',
          type: 'button',
          role: 'option',
          'aria-selected': 'false',
          'aria-label': `候補 ${i + 1}`,
          title: `候補 ${i + 1} · スコア ${c.score.toFixed(3)}`,
          onclick: () => select(i),
        },
        tc,
        h('span', { class: 'thumb__index', 'aria-hidden': 'true' }, String(i + 1)),
      );
    });
    thumbBase.width = 0;

    const setDownloadReady = (index: number, url: string, size?: number) => {
      download.href = url;
      download.setAttribute('download', downloadName(result.file.name, index));
      download.classList.remove('is-disabled');
      download.removeAttribute('aria-disabled');
      download.textContent = size === undefined ? 'PNG をダウンロード' : `PNG をダウンロード（${(size / 1024 / 1024).toFixed(1)} MB）`;
    };

    const updateDownload = (index: number) => {
      const cached = blobUrls.get(index);
      if (cached) {
        setDownloadReady(index, cached, blobSizes.get(index));
        return;
      }
      download.href = '#';
      download.classList.add('is-disabled');
      download.setAttribute('aria-disabled', 'true');
      download.textContent = 'PNG を生成中…';
      const gen = ++blobGeneration;
      // toBlob snapshots the canvas synchronously, so the blob really is candidate `index`
      canvasToPngBlob(canvas)
        .then((blob) => {
          if (this.stateKind !== 'result' || !download.isConnected) return;
          const url = URL.createObjectURL(blob);
          blobUrls.set(index, url);
          blobSizes.set(index, blob.size);
          if (gen === blobGeneration && index === selected) setDownloadReady(index, url, blob.size);
        })
        .catch((e: unknown) => {
          if (gen !== blobGeneration) return;
          download.textContent = 'PNG の生成に失敗しました';
          this.status.textContent = e instanceof Error ? e.message : String(e);
        });
    };

    const select = (index: number) => {
      index = Math.max(0, Math.min(count - 1, index));
      if (index === selected) return;
      selected = index;
      drawCandidate(result, index);
      counter.textContent = `候補 ${index + 1} / ${count}`;
      prev.disabled = index === 0;
      next.disabled = index === count - 1;
      thumbs.forEach((t, i) => {
        t.classList.toggle('is-selected', i === index);
        t.setAttribute('aria-selected', String(i === index));
      });
      thumbs[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      updateDownload(index);
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        select(selected - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        select(selected + 1);
      }
    };
    document.addEventListener('keydown', onKey);
    this.cleanup = () => {
      document.removeEventListener('keydown', onKey);
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
      blobUrls.clear();
      disposeResult(result);
    };

    this.dropzone = createDropzone(this.handlers.onFile, true);
    const panel = h(
      'div',
      { class: 'result' },
      h('div', { class: 'preview-wrap' }, canvas, count > 1 ? prev : null, count > 1 ? next : null),
      h(
        'div',
        { class: 'thumbs-wrap' },
        h('div', { class: 'thumbs__header' }, counter),
        h('div', { class: 'thumbs', role: 'listbox', 'aria-label': '候補' }, ...thumbs),
      ),
      h('div', { class: 'actions' }, download),
      this.dropzone.el,
    );
    if (this.debugPanel) panel.append(this.debugPanel(result));
    this.main.append(panel);
    select(0);
  }
}
