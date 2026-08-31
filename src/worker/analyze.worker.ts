import { analyzeImage } from '../lib/analyze';
import type { AnalyzeResponse, WorkerIn, WorkerOut } from './protocol';

// The project uses a single tsconfig with the DOM lib; `Worker` has the
// (message, transfer[]) postMessage signature we need for the worker scope.
const ctx = self as unknown as Worker;

function post(msg: WorkerOut, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'analyze') return;
  try {
    const rgba = new Uint8ClampedArray(msg.rgba);
    const res = analyzeImage(rgba, msg.width, msg.height, msg.options, (stage, fraction) =>
      post({ type: 'progress', id: msg.id, stage, fraction }),
    );
    const out: AnalyzeResponse = {
      type: 'result',
      id: msg.id,
      width: res.width,
      height: res.height,
      placement: res.best.placement,
      score: res.best.score,
      terms: res.best.terms,
      top: res.top,
      meanLuma: res.meanLuma,
      evaluated: res.evaluated,
      timings: res.timings,
    };
    const transfer: Transferable[] = [];
    if (msg.debug) {
      out.saliency = res.maps.saliency.data.buffer as ArrayBuffer;
      out.eyeMap = res.maps.eyeMap.data.buffer as ArrayBuffer;
      transfer.push(out.saliency, out.eyeMap);
    }
    post(out, transfer);
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
};
