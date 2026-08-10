export const C = {
  bg: "#050506",
  panel: "#0a0a0c",
  panel2: "#101014",
  line: "#1e1e24",
  grid: "#131318",
  amber: "#ffa62b",
  text: "#e4e4e8",
  dim: "#74747e",
  up: "#00c176",
  down: "#ff3b52",
  cyan: "#3ec8e0",
  violet: "#b98bff",
  band: "#4a4a72",
} as const;

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export function fmtPx(v: number, dp: number): string {
  if (!Number.isFinite(v)) return "--";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtQty(v: number): string {
  if (!Number.isFinite(v)) return "--";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

const p2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

export function hms(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

export function hm(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/**
 * Size the backing store to device pixels, capped at 2x.
 *
 * Uncapped DPR on a 3x phone means 9x the fill rate for a difference nobody can
 * see on a 1px hairline. Returns false when the element has no layout yet.
 */
export function prepareCanvas(cv: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (cv.width !== bw || cv.height !== bh) {
    cv.width = bw;
    cv.height = bh;
  }
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
