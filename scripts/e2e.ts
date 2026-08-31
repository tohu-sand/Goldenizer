/**
 * End-to-end smoke test over the Chrome DevTools Protocol (no extra deps).
 * Drives a local Chrome/Edge in headless mode against a running dev/preview server:
 * idle screenshot → drop an image → wait for the result → verify the download →
 * reset → second image → unsupported file → error state. Fails on console errors.
 *
 *   pnpm e2e [url] [image1] [image2]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const APP_URL = process.argv[2] ?? 'http://localhost:4173/';
const IMAGE1 = resolve(process.argv[3] ?? 'C:/Windows/Web/Screen/img102.jpg');
const IMAGE2 = resolve(process.argv[4] ?? 'C:/Windows/Web/Wallpaper/ThemeA/img20.jpg');
const OUT = 'out/e2e';
const PORT = 9333;
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await fn()) return;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${label}`);
}

type Json = Record<string, unknown>;

class Cdp {
  private id = 0;
  private readonly pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Map<string, ((p: Json) => void)[]>();

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error('websocket error'));
    });
    return new Cdp(ws);
  }

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; method?: string; params?: Json; result?: Json; error?: { message: string } };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
      } else if (msg.method) {
        for (const l of this.listeners.get(msg.method) ?? []) l(msg.params ?? {});
      }
    };
  }

  send(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, fn: (p: Json) => void): void {
    const arr = this.listeners.get(method) ?? [];
    arr.push(fn);
    this.listeners.set(method, arr);
  }

  once(method: string): Promise<Json> {
    return new Promise((resolve) => this.on(method, resolve));
  }

  close(): void {
    this.ws.close();
  }
}

async function main(): Promise<void> {
  const browser = BROWSERS.find((p) => existsSync(p));
  if (!browser) throw new Error('no Chrome/Edge found');
  mkdirSync(OUT, { recursive: true });
  const profile = join(tmpdir(), 'goldenizer-e2e-profile');

  await waitFor(async () => (await fetch(APP_URL)).ok, 15000, `app at ${APP_URL}`);

  const proc: ChildProcess = spawn(
    browser,
    [
      '--headless',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1200,1100',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const errors: string[] = [];
  let cdp: Cdp | undefined;
  try {
    await waitFor(async () => (await fetch(`http://localhost:${PORT}/json/version`)).ok, 15000, 'devtools port');
    const targets = (await (await fetch(`http://localhost:${PORT}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    const c = cdp;

    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.send('Page.enable');
    c.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
      errors.push(`exception: ${d?.exception?.description ?? d?.text ?? JSON.stringify(p)}`);
    });
    c.on('Runtime.consoleAPICalled', (p) => {
      if (p.type !== 'error' && p.type !== 'warning') return;
      const args = (p.args as { value?: unknown; description?: string }[]).map((a) => a.value ?? a.description).join(' ');
      errors.push(`console.${String(p.type)}: ${args}`);
    });
    c.on('Log.entryAdded', (p) => {
      const e = p.entry as { level: string; text: string; url?: string };
      if (e.level === 'error') errors.push(`log: ${e.text} ${e.url ?? ''}`);
    });

    const evalJs = async <T,>(expression: string, awaitPromise = false): Promise<T> => {
      const r = (await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })) as {
        result: { value: T };
        exceptionDetails?: { text: string; exception?: { description?: string } };
      };
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const shot = async (name: string) => {
      const r = (await c.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
      const path = join(OUT, name);
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      console.log(`  screenshot ${path}`);
    };
    const STATE = `(() => {
      const r = document.querySelector('.result');
      if (r) {
        const a = r.querySelector('a.btn--primary');
        return a && !a.classList.contains('is-disabled') ? 'ready' : 'result:generating';
      }
      const e = document.querySelector('.error__message');
      if (e) return 'error:' + e.textContent;
      const l = document.querySelector('.progress__label');
      return l ? 'processing:' + l.textContent : (document.querySelector('.dropzone') ? 'idle' : 'unknown');
    })()`;
    const state = () => evalJs<string>(STATE);
    const setFile = async (path: string) => {
      const doc = (await c.send('DOM.getDocument', { depth: 1 })) as { root: { nodeId: number } };
      const q = (await c.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })) as { nodeId: number };
      if (!q.nodeId) throw new Error('file input not found');
      await c.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [path] });
    };
    const waitReady = async (label: string) => {
      let last = '';
      await waitFor(async () => {
        last = await state();
        if (last.startsWith('error:')) throw new Error(`app error while ${label}: ${last}`);
        return last === 'ready';
      }, 30000, `${label} (last state: ${last})`);
    };

    // 1. idle
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: APP_URL });
    await loaded;
    await sleep(300);
    console.log('idle state:', await state());
    if ((await state()) !== 'idle') throw new Error('expected idle state after load');
    await shot('01-idle.png');

    // 2. first image
    console.log(`drop ${IMAGE1}`);
    const t0 = Date.now();
    await setFile(IMAGE1);
    await waitReady('first image');
    console.log(`  ready in ${Date.now() - t0} ms`);
    console.log('  canvas:', await evalJs<string>(`(c => c.width + 'x' + c.height)(document.querySelector('canvas.preview'))`));
    const href = await evalJs<string>(`document.querySelector('.result a.btn--primary').getAttribute('href')`);
    const dl = await evalJs<string>(`document.querySelector('.result a.btn--primary').getAttribute('download')`);
    if (!href.startsWith('blob:')) throw new Error(`download href is not a blob URL: ${href}`);
    const size = await evalJs<number>(`fetch(document.querySelector('.result a.btn--primary').href).then(r => r.blob()).then(b => b.size)`, true);
    console.log(`  download: ${dl} (${(size / 1024).toFixed(0)} KB)`);
    if (size < 1000) throw new Error('download blob suspiciously small');
    await shot('02-result.png');

    // 2b. candidate carousel: next arrow, thumbnail click, keyboard, per-candidate downloads
    const counterText = () => evalJs<string>(`document.querySelector('.carousel__counter')?.textContent ?? ''`);
    const hrefNow = () => evalJs<string>(`document.querySelector('.result a.btn--primary').getAttribute('href')`);
    const thumbCount = await evalJs<number>(`document.querySelectorAll('.thumb').length`);
    console.log(`  ${await counterText()} (${thumbCount} thumbnails)`);
    if (thumbCount < 2) throw new Error('expected at least 2 candidates');
    await evalJs(`document.querySelector('.carousel__arrow--next').click()`);
    await waitFor(async () => (await counterText()).startsWith('候補 2 /'), 5000, 'candidate 2 selected');
    await waitReady('candidate 2 download');
    const href2 = await hrefNow();
    if (href2 === href) throw new Error('download URL did not change for candidate 2');
    console.log(`  candidate 2: ${await evalJs<string>(`document.querySelector('.result a.btn--primary').getAttribute('download')`)}`);
    await evalJs(`document.querySelectorAll('.thumb')[2].click()`);
    await waitFor(async () => (await counterText()).startsWith('候補 3 /'), 5000, 'candidate 3 via thumbnail');
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
    await waitFor(async () => (await counterText()).startsWith('候補 2 /'), 5000, 'candidate 2 via keyboard');
    await waitReady('candidate 2 cached download');
    if ((await hrefNow()) !== href2) throw new Error('cached download URL should be reused for candidate 2');
    const selectedIdx = await evalJs<number>(`[...document.querySelectorAll('.thumb')].findIndex(t => t.classList.contains('is-selected'))`);
    if (selectedIdx !== 1) throw new Error(`thumbnail 2 should be highlighted, got index ${selectedIdx}`);
    const last = Math.min(thumbCount - 1, 3);
    await evalJs(`document.querySelectorAll('.thumb')[${last}].click()`);
    await waitFor(async () => (await counterText()).startsWith(`候補 ${last + 1} /`), 5000, `candidate ${last + 1}`);
    await waitReady(`candidate ${last + 1} download`);
    await shot('02b-candidates.png');
    await evalJs(`document.querySelectorAll('.thumb')[0].click()`);
    await waitReady('back to candidate 1');

    // 3. second image dropped straight onto the result view's compact dropzone
    const canvasBefore = await evalJs<string>(`(c => c.width + 'x' + c.height)(document.querySelector('canvas.preview'))`);
    console.log(`drop ${IMAGE2}`);
    await setFile(IMAGE2);
    await waitFor(async () => (await state()) !== 'ready', 3000, 'processing to start');
    await waitReady('second image');
    const canvasAfter = await evalJs<string>(`(c => c.width + 'x' + c.height)(document.querySelector('canvas.preview'))`);
    console.log(`  canvas: ${canvasBefore} → ${canvasAfter}`);
    if (canvasAfter === canvasBefore) throw new Error('second image did not replace the first');
    await shot('03-result2.png');

    // 4. unsupported file → error state (drop via the compact dropzone on the result page)
    const bogus = join(tmpdir(), 'goldenizer-bogus.txt');
    writeFileSync(bogus, 'not an image');
    await setFile(bogus);
    await waitFor(async () => (await state()).startsWith('error:'), 5000, 'error state');
    console.log('  error state:', await state());
    await shot('04-error.png');
    await evalJs(`document.querySelector('.error button').click()`);
    await waitFor(async () => (await state()) === 'idle', 5000, 'idle after error');

    await c.send('Browser.close').catch(() => undefined);
  } finally {
    cdp?.close();
    proc.kill();
  }

  if (errors.length) {
    console.error('\nBrowser console errors/warnings:');
    for (const e of errors) console.error('  ' + e);
    process.exit(1);
  }
  console.log('\nE2E OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
