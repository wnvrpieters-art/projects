import { indicators, type Overlays } from "../indicators";
import type { Candle, Interval } from "../types";
import { C, clamp, fmtPx, fmtQty, hm, hms, prepareCanvas, rgba } from "./theme";

export interface ChartView {
  /** Bars visible across the plot width. */
  count: number;
  /** Bars scrolled back from the right edge. */
  offset: number;
}

export interface Crosshair {
  on: boolean;
  x: number;
  y: number;
  /** Index into the visible slice, or null when off the plot. */
  i: number | null;
}

export interface ChartInput {
  bars: Candle[];
  version: number;
  symbol: string;
  interval: Interval;
  dp: number;
  dir: number;
  view: ChartView;
  overlays: Overlays;
  cross: Crosshair;
}

export const AXIS_W = 68;
const AXIS_H = 18;
const TOP = 22;

/** Visible-slice geometry, shared by the renderer and the pointer hit-test. */
export function chartGeometry(plotWidth: number, barCount: number, view: ChartView) {
  const count = clamp(Math.round(view.count), 20, 400);
  const end = clamp(barCount - Math.round(view.offset), 5, barCount);
  const start = Math.max(0, end - count);
  const visible = end - start;
  const cw = plotWidth / count;
  return { count, start, end, visible, cw };
}

export function drawChart(cv: HTMLCanvasElement, input: ChartInput): void {
  const prep = prepareCanvas(cv);
  if (!prep) return;
  const { ctx, w: W, h: H } = prep;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";

  const all = input.bars;
  if (all.length < 3) {
    ctx.fillStyle = C.dim;
    ctx.textAlign = "center";
    ctx.fillText("awaiting history…", W / 2, H / 2);
    return;
  }

  const plotW = Math.max(40, W - AXIS_W);
  const subOn = input.overlays.sub !== "NONE";
  const subH = subOn ? clamp(H * 0.19, 54, 120) : 0;
  const volH = clamp(H * 0.12, 34, 78);
  const priceH = Math.max(60, H - AXIS_H - volH - subH - TOP);

  const pT = TOP;
  const pB = TOP + priceH;
  const vT = pB + 6;
  const vB = vT + volH - 6;
  const sT = vB + 8;
  const sB = sT + subH - 8;

  const geo = chartGeometry(plotW, all.length, input.view);
  const vis = all.slice(geo.start, geo.end);
  if (!vis.length) return;
  const bw = Math.max(1, Math.min(geo.cw * 0.66, 16));
  const xAt = (i: number): number => plotW - (vis.length - i) * geo.cw + geo.cw / 2;

  const ind = indicators(input.symbol, input.interval, input.version, all, input.overlays);

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < vis.length; i++) {
    if (vis[i].l < lo) lo = vis[i].l;
    if (vis[i].h > hi) hi = vis[i].h;
    const g = geo.start + i;
    if (ind.bands && Number.isFinite(ind.bands.up[g])) {
      if (ind.bands.up[g] > hi) hi = ind.bands.up[g];
      if (ind.bands.lo[g] < lo) lo = ind.bands.lo[g];
    }
    if (ind.avwap) {
      if (ind.avwap[g] > hi) hi = ind.avwap[g];
      if (ind.avwap[g] < lo) lo = ind.avwap[g];
    }
  }
  const pad = (hi - lo) * 0.08 || hi * 0.001;
  hi += pad;
  lo -= pad;
  const yAt = (p: number): number => pB - ((p - lo) / (hi - lo)) * priceH;

  /* grid + axes */
  ctx.lineWidth = 1;
  ctx.textAlign = "left";
  const rows = 6;
  for (let i = 0; i <= rows; i++) {
    const p = lo + ((hi - lo) * i) / rows;
    const y = Math.round(yAt(p)) + 0.5;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
    ctx.fillStyle = C.dim;
    ctx.fillText(fmtPx(p, input.dp), plotW + 6, y);
  }
  const vStep = Math.max(1, Math.round(geo.count / 7));
  ctx.textAlign = "center";
  const timeLabel = (t: number): string => (input.interval === "1s" || input.interval === "1m" ? hms(t) : hm(t));
  for (let i = vis.length - 1; i >= 0; i -= vStep) {
    const x = Math.round(xAt(i)) + 0.5;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(x, pT);
    ctx.lineTo(x, subOn ? sB : vB);
    ctx.stroke();
    ctx.fillStyle = C.dim;
    ctx.fillText(timeLabel(vis[i].t), x, H - AXIS_H / 2);
  }

  /* bollinger */
  if (ind.bands) {
    const b = ind.bands;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < vis.length; i++) {
      const g = geo.start + i;
      if (!Number.isFinite(b.up[g])) continue;
      const x = xAt(i);
      if (!started) {
        ctx.moveTo(x, yAt(b.up[g]));
        started = true;
      } else ctx.lineTo(x, yAt(b.up[g]));
    }
    for (let i = vis.length - 1; i >= 0; i--) {
      const g = geo.start + i;
      if (!Number.isFinite(b.lo[g])) continue;
      ctx.lineTo(xAt(i), yAt(b.lo[g]));
    }
    ctx.closePath();
    ctx.fillStyle = rgba(C.band, 0.1);
    ctx.fill();
    ctx.strokeStyle = rgba(C.band, 0.65);
    ctx.stroke();
  }

  /* candles */
  for (let i = 0; i < vis.length; i++) {
    const k = vis[i];
    ctx.fillStyle = k.c >= k.o ? C.up : C.down;
    const x = Math.round(xAt(i));
    ctx.fillRect(x, yAt(k.h), 1, Math.max(1, yAt(k.l) - yAt(k.h)));
    const top = yAt(Math.max(k.o, k.c));
    ctx.fillRect(Math.round(x - bw / 2), top, Math.max(1, Math.round(bw)), Math.max(1, yAt(Math.min(k.o, k.c)) - top));
  }

  /* overlays */
  const line = (series: number[], color: string, dash?: number[]): void => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < vis.length; i++) {
      const v = series[geo.start + i];
      if (!Number.isFinite(v)) continue;
      const x = xAt(i);
      const y = yAt(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };
  if (ind.ema9 && ind.ema21) {
    line(ind.ema9, C.amber);
    line(ind.ema21, C.cyan);
  }
  if (ind.avwap) line(ind.avwap, C.violet, [4, 3]);

  /* volume */
  let vmax = 0;
  for (const k of vis) if (k.v > vmax) vmax = k.v;
  for (let i = 0; i < vis.length; i++) {
    const k = vis[i];
    const h = (k.v / (vmax || 1)) * (vB - vT);
    ctx.fillStyle = rgba(k.c >= k.o ? C.up : C.down, 0.45);
    ctx.fillRect(Math.round(xAt(i) - bw / 2), vB - h, Math.max(1, Math.round(bw)), h);
  }
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(0, vB + 0.5);
  ctx.lineTo(plotW, vB + 0.5);
  ctx.stroke();
  ctx.fillStyle = C.dim;
  ctx.textAlign = "left";
  ctx.fillText(`VOL ${fmtQty(vis[vis.length - 1].v)}`, 4, vT + 6);

  /* sub-pane */
  if (ind.rsi14) {
    const yR = (v: number): number => sB - (clamp(v, 0, 100) / 100) * (sB - sT);
    ctx.fillStyle = rgba(C.amber, 0.06);
    ctx.fillRect(0, yR(70), plotW, yR(30) - yR(70));
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = C.grid;
    for (const lv of [30, 70]) {
      const y = Math.round(yR(lv)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < vis.length; i++) {
      const v = ind.rsi14[geo.start + i];
      if (!Number.isFinite(v)) continue;
      const x = xAt(i);
      const y = yR(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const cur = ind.rsi14[geo.end - 1];
    ctx.fillStyle = C.dim;
    ctx.fillText(`RSI(14) ${Number.isFinite(cur) ? cur.toFixed(1) : "--"}`, 4, sT + 6);
  } else if (ind.macd) {
    const m = ind.macd;
    let mx = 1e-12;
    for (let i = geo.start; i < geo.end; i++) {
      mx = Math.max(mx, Math.abs(m.line[i]), Math.abs(m.signal[i]), Math.abs(m.hist[i]));
    }
    const mid = (sT + sB) / 2;
    const yM = (v: number): number => mid - (v / mx) * ((sB - sT) / 2) * 0.9;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(mid) + 0.5);
    ctx.lineTo(plotW, Math.round(mid) + 0.5);
    ctx.stroke();
    for (let i = 0; i < vis.length; i++) {
      const v = m.hist[geo.start + i];
      const y = yM(v);
      ctx.fillStyle = rgba(v >= 0 ? C.up : C.down, 0.55);
      ctx.fillRect(Math.round(xAt(i) - bw / 2), Math.min(y, mid), Math.max(1, Math.round(bw)), Math.abs(y - mid));
    }
    const sub = (series: number[], color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < vis.length; i++) {
        const x = xAt(i);
        const y = yM(series[geo.start + i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    sub(m.line, C.cyan);
    sub(m.signal, C.amber);
    ctx.fillStyle = C.dim;
    ctx.fillText("MACD 12/26/9", 4, sT + 6);
  }

  /* last price */
  const last = all[all.length - 1];
  const ly = yAt(last.c);
  if (geo.end === all.length && ly > pT && ly < pB) {
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = rgba(input.dir >= 0 ? C.up : C.down, 0.7);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(ly) + 0.5);
    ctx.lineTo(plotW, Math.round(ly) + 0.5);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = input.dir >= 0 ? C.up : C.down;
  ctx.fillRect(plotW + 1, clamp(ly - 8, pT, pB - 16), AXIS_W - 2, 16);
  ctx.fillStyle = "#04040a";
  ctx.textAlign = "left";
  ctx.fillText(fmtPx(last.c, input.dp), plotW + 6, clamp(ly, pT + 8, pB - 8));

  /* legend — follows the crosshair when it is on a bar */
  const hoverIdx = input.cross.i !== null && input.cross.i < vis.length ? input.cross.i : vis.length - 1;
  const k = vis[hoverIdx];
  let lx = 4;
  const seg = (label: string, value: string, color: string): void => {
    ctx.fillStyle = C.dim;
    ctx.fillText(label, lx, 10);
    lx += ctx.measureText(label).width + 3;
    ctx.fillStyle = color;
    ctx.fillText(value, lx, 10);
    lx += ctx.measureText(value).width + 8;
  };
  ctx.textAlign = "left";
  seg("O", fmtPx(k.o, input.dp), C.text);
  seg("H", fmtPx(k.h, input.dp), C.text);
  seg("L", fmtPx(k.l, input.dp), C.text);
  seg("C", fmtPx(k.c, input.dp), k.c >= k.o ? C.up : C.down);
  seg("V", fmtQty(k.v), C.text);
  if (ind.ema9 && ind.ema21) {
    seg("EMA9", fmtPx(ind.ema9[geo.start + hoverIdx], input.dp), C.amber);
    seg("21", fmtPx(ind.ema21[geo.start + hoverIdx], input.dp), C.cyan);
  }
  if (ind.avwap) seg("AVWAP", fmtPx(ind.avwap[geo.start + hoverIdx], input.dp), C.violet);

  /* crosshair */
  const cross = input.cross;
  if (cross.on && cross.x < plotW) {
    const cx = Math.round(cross.i !== null ? xAt(cross.i) : cross.x) + 0.5;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = rgba(C.text, 0.35);
    ctx.beginPath();
    ctx.moveTo(cx, pT);
    ctx.lineTo(cx, H - AXIS_H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, Math.round(cross.y) + 0.5);
    ctx.lineTo(plotW, Math.round(cross.y) + 0.5);
    ctx.stroke();
    ctx.restore();

    if (cross.y > pT && cross.y < pB) {
      const p = lo + ((pB - cross.y) / priceH) * (hi - lo);
      ctx.fillStyle = C.panel2;
      ctx.fillRect(plotW + 1, cross.y - 8, AXIS_W - 2, 16);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(plotW + 1.5, cross.y - 7.5, AXIS_W - 3, 15);
      ctx.fillStyle = C.text;
      ctx.textAlign = "left";
      ctx.fillText(fmtPx(p, input.dp), plotW + 6, cross.y);
    }
    if (cross.i !== null && vis[cross.i]) {
      const label = timeLabel(vis[cross.i].t);
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = C.panel2;
      ctx.fillRect(clamp(cx - w / 2, 0, plotW - w), H - AXIS_H + 1, w, AXIS_H - 2);
      ctx.fillStyle = C.text;
      ctx.textAlign = "center";
      ctx.fillText(label, clamp(cx, w / 2, plotW - w / 2), H - AXIS_H / 2);
    }
  }
}
