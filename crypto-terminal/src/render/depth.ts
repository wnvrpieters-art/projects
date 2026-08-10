import type { OrderBook } from "../feed/OrderBook";
import { C, fmtPx, fmtQty, prepareCanvas, rgba } from "./theme";

/**
 * Cumulative depth curve.
 *
 * Drawn as true step functions rather than smoothed lines: liquidity sits at
 * discrete prices, and interpolating between levels implies resting size that
 * is not there. The x-axis is clipped to a percentage band around the mid,
 * because full-book range is dominated by far-touch levels nobody trades into.
 */
export function drawDepth(cv: HTMLCanvasElement, book: OrderBook, dp: number, bandPct = 0.004): void {
  const prep = prepareCanvas(cv);
  if (!prep) return;
  const { ctx, w: W, h: H } = prep;
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";

  const mid = book.mid;
  if (!Number.isFinite(mid)) {
    ctx.fillStyle = C.dim;
    ctx.textAlign = "center";
    ctx.fillText("no book", W / 2, H / 2);
    return;
  }

  const { bids, asks } = book.top(400);
  const span = mid * bandPct;
  const B = H - 12;

  let cb = 0;
  let ca = 0;
  const bidCurve: { p: number; c: number }[] = [];
  const askCurve: { p: number; c: number }[] = [];
  for (const l of bids) {
    if (l.p < mid - span) break;
    cb += l.s;
    bidCurve.push({ p: l.p, c: cb });
  }
  for (const l of asks) {
    if (l.p > mid + span) break;
    ca += l.s;
    askCurve.push({ p: l.p, c: ca });
  }
  const max = Math.max(cb, ca) || 1;

  const xAt = (p: number): number => W / 2 + ((p - mid) / span) * (W / 2 - 2);
  const yAt = (c: number): number => B - (c / max) * (B - 4);

  const side = (curve: { p: number; c: number }[], color: string): void => {
    if (!curve.length) return;
    ctx.beginPath();
    ctx.moveTo(W / 2, B);
    let px = W / 2;
    for (const l of curve) {
      const x = xAt(l.p);
      const y = yAt(l.c);
      ctx.lineTo(px, y);
      ctx.lineTo(x, y);
      px = x;
    }
    ctx.lineTo(px, B);
    ctx.closePath();
    ctx.fillStyle = rgba(color, 0.18);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  side(bidCurve, C.up);
  side(askCurve, C.down);

  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = rgba(C.text, 0.25);
  ctx.beginPath();
  ctx.moveTo(W / 2 + 0.5, 0);
  ctx.lineTo(W / 2 + 0.5, B);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = C.dim;
  ctx.textAlign = "left";
  ctx.fillText(fmtPx(mid - span, dp), 2, H - 5);
  ctx.textAlign = "right";
  ctx.fillText(fmtPx(mid + span, dp), W - 2, H - 5);
  ctx.textAlign = "center";
  ctx.fillStyle = C.text;
  ctx.fillText(fmtPx(mid, dp), W / 2, H - 5);

  ctx.textAlign = "left";
  ctx.fillStyle = C.up;
  ctx.fillText(fmtQty(cb), 2, 8);
  ctx.textAlign = "right";
  ctx.fillStyle = C.down;
  ctx.fillText(fmtQty(ca), W - 2, 8);
}
