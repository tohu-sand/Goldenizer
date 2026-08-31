import { ACCEPTED_MIME } from '../render/imageio';
import { h } from './dom';

export interface Dropzone {
  el: HTMLElement;
  setDisabled(disabled: boolean): void;
  openPicker(): void;
}

/** Click / keyboard / drag&drop file picker. Paste is handled globally in main.ts. */
export function createDropzone(onFile: (file: File) => void, compact = false): Dropzone {
  const input = h('input', { type: 'file', accept: ACCEPTED_MIME.join(','), class: 'visually-hidden', tabindex: -1 });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
    input.value = '';
  });

  const el = h(
    'div',
    { class: `dropzone${compact ? ' dropzone--compact' : ''}`, role: 'button', tabindex: 0, 'aria-label': '画像を選択' },
    h('div', { class: 'dropzone__icon', 'aria-hidden': 'true' }, '＋'),
    h('div', { class: 'dropzone__title' }, compact ? '別の画像をドロップ / クリックして選択' : '画像をここにドロップ'),
    compact ? null : h('div', { class: 'dropzone__sub' }, 'クリックして選択 · Ctrl+V で貼り付け'),
    compact ? null : h('div', { class: 'dropzone__formats' }, 'PNG · JPEG · WebP · GIF（先頭フレーム）· AVIF · BMP · SVG'),
    input,
  );

  let disabled = false;
  const open = () => {
    if (!disabled) input.click();
  };
  el.addEventListener('click', open);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  const over = (e: DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    el.classList.add('is-over');
  };
  el.addEventListener('dragenter', over);
  el.addEventListener('dragover', over);
  el.addEventListener('dragleave', () => el.classList.remove('is-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('is-over');
    if (disabled) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });

  return {
    el,
    setDisabled(d) {
      disabled = d;
      el.classList.toggle('is-disabled', d);
      el.setAttribute('aria-disabled', String(d));
    },
    openPicker: open,
  };
}
