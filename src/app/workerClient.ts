import type { AnalyzeOptions, AnalyzeStage } from '../lib/analyze';
import type { RgbaImage } from '../lib/types';
import type { AnalyzeRequest, AnalyzeResponse, WorkerOut } from '../worker/protocol';

export type ProgressHandler = (stage: AnalyzeStage, fraction: number) => void;

interface Pending {
  resolve: (r: AnalyzeResponse) => void;
  reject: (e: Error) => void;
  onProgress?: ProgressHandler;
}

/** Promise wrapper around the long-lived analysis worker. */
export class AnalyzeClient {
  private worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor() {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(new URL('../worker/analyze.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerOut>) => this.handle(ev.data);
    w.onerror = (ev) => {
      const err = new Error(ev.message || 'worker error');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    return w;
  }

  private handle(msg: WorkerOut): void {
    const p = this.pending.get(msg.id);
    if (!p) return; // stale (cancelled) request
    if (msg.type === 'progress') {
      p.onProgress?.(msg.stage, msg.fraction);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.type === 'result') p.resolve(msg);
    else p.reject(new Error(msg.message));
  }

  /**
   * Analyze a working-resolution RGBA image. The buffer is transferred to the
   * worker, so `img.data` must not be used afterwards.
   */
  analyze(
    img: RgbaImage,
    opts: { options?: AnalyzeOptions; debug?: boolean; onProgress?: ProgressHandler } = {},
  ): Promise<AnalyzeResponse> {
    const id = this.nextId++;
    const buffer = img.data.buffer as ArrayBuffer;
    const req: AnalyzeRequest = {
      type: 'analyze',
      id,
      width: img.width,
      height: img.height,
      rgba: buffer,
      options: opts.options,
      debug: opts.debug,
    };
    return new Promise<AnalyzeResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: opts.onProgress });
      this.worker.postMessage(req, [buffer]);
    });
  }

  /** Drop all in-flight requests (their results will be ignored). */
  cancelAll(): void {
    const err = new Error('cancelled');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
