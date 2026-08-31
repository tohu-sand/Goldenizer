import type { PipelineResult } from '../app/pipeline';
import { eyePoint } from '../lib/geometry';
import type { Candidate } from '../lib/search';
import type { Placement } from '../lib/types';
import { h } from './dom';

export const isDebugEnabled = (): boolean => new URLSearchParams(location.search).get('debug') === '1';

function heatmap(buf: ArrayBuffer, w: number, hgt: number, placement: Placement, label: string): HTMLElement {
  const map = new Float32Array(buf);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  c.className = 'heatmap';
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(w, hgt);
    for (let i = 0; i < map.length; i++) {
      const v = Math.max(0, Math.min(1, map[i]));
      // simple inferno-ish ramp: black → purple → orange → white
      const r = Math.min(1, v * 2.2) * 255;
      const g = Math.max(0, v - 0.35) * 1.6 * 255;
      const b = (v < 0.5 ? v * 1.4 : Math.max(0, 1.4 - v * 1.8)) * 255;
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(placement.x + 0.5, placement.y + 0.5, placement.w, placement.h);
    const e = eyePoint(placement);
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return h('figure', { class: 'debug__fig' }, c, h('figcaption', {}, label));
}

function candidateRow(c: Candidate, i: number): HTMLElement {
  const p = c.placement;
  const cell = (t: string) => h('td', {}, t);
  return h(
    'tr',
    {},
    cell(String(i + 1)),
    cell(c.score.toFixed(3)),
    cell(String(p.orientation)),
    cell(c.terms.scale.toFixed(2)),
    cell(c.terms.eye.toFixed(2)),
    cell(c.terms.path.toFixed(2)),
    cell(c.terms.coverage.toFixed(2)),
    cell(c.terms.fit.toFixed(2)),
    cell(`${p.x.toFixed(0)},${p.y.toFixed(0)} ${p.w.toFixed(0)}×${p.h.toFixed(0)}`),
  );
}

/** Saliency heatmaps, top candidates and timings — shown with ?debug=1. */
export function debugPanel(result: PipelineResult): HTMLElement {
  const r = result.response;
  const figs: HTMLElement[] = [];
  if (r.saliency) figs.push(heatmap(r.saliency, r.width, r.height, r.placement, 'saliency'));
  if (r.eyeMap) figs.push(heatmap(r.eyeMap, r.width, r.height, r.placement, 'eye map'));
  const t = r.timings;
  const ct = result.clientTimings;
  const timings = `decode+downscale ${ct.decode.toFixed(0)} ms · worker saliency ${t.saliency.toFixed(0)} ms · search ${t.search.toFixed(0)} ms (${r.evaluated} candidates) · round-trip ${ct.analyze.toFixed(0)} ms · overlay ${ct.render.toFixed(0)} ms`;
  const header = ['#', 'score', 'o', 'scale', 'eye', 'path', 'cov', 'fit', 'rect'].map((s) => h('th', {}, s));
  console.table(r.top.map((c) => ({ score: c.score, o: c.placement.orientation, ...c.terms })));
  return h(
    'section',
    { class: 'debug' },
    h('h2', {}, 'debug'),
    h('div', { class: 'debug__figs' }, ...figs),
    h('p', { class: 'debug__timings' }, timings),
    h('table', { class: 'debug__table' }, h('thead', {}, h('tr', {}, ...header)), h('tbody', {}, ...r.top.map(candidateRow))),
  );
}
