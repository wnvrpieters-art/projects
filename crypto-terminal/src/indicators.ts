import type { Candle, Interval } from "./types";

export function ema(vals: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out = new Array<number>(vals.length);
  let e = vals[0] ?? NaN;
  for (let i = 0; i < vals.length; i++) {
    e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export function sma(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= n) sum -= vals[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export interface Bands {
  m: number[];
  up: number[];
  lo: number[];
}

export function bollinger(vals: number[], n: number, k: number): Bands {
  const m = sma(vals, n);
  const up = new Array<number>(vals.length).fill(NaN);
  const lo = new Array<number>(vals.length).fill(NaN);
  for (let i = n - 1; i < vals.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = vals[j] - m[i];
      s += d * d;
    }
    const sd = Math.sqrt(s / n);
    up[i] = m[i] + k * sd;
    lo[i] = m[i] - k * sd;
  }
  return { m, up, lo };
}

/**
 * Wilder's smoothing, which is what every charting package means by "RSI".
 *
 * The zero-loss case is handled explicitly rather than with a large sentinel
 * RS. Substituting RS = 100 looks harmless and yields 99.01 on a series that
 * has never ticked down — visibly off the top of the panel, and enough to make
 * an overbought threshold behave differently from every other terminal.
 */
function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function rsi(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < vals.length; i++) {
    const ch = vals[i] - vals[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    if (i <= n) {
      avgGain += g / n;
      avgLoss += l / n;
      if (i === n) out[i] = rsiValue(avgGain, avgLoss);
    } else {
      avgGain = (avgGain * (n - 1) + g) / n;
      avgLoss = (avgLoss * (n - 1) + l) / n;
      out[i] = rsiValue(avgGain, avgLoss);
    }
  }
  return out;
}

export interface Macd {
  line: number[];
  signal: number[];
  hist: number[];
}

export function macd(vals: number[]): Macd {
  const fast = ema(vals, 12);
  const slow = ema(vals, 26);
  const line = new Array<number>(vals.length);
  for (let i = 0; i < vals.length; i++) line[i] = fast[i] - slow[i];
  const signal = ema(line, 9);
  const hist = new Array<number>(vals.length);
  for (let i = 0; i < vals.length; i++) hist[i] = line[i] - signal[i];
  return { line, signal, hist };
}

/**
 * Rolling VWAP anchored to the start of the loaded series.
 *
 * A true session VWAP resets at the venue's session boundary; crypto has no
 * session, so the anchor is the first loaded bar and the value is only
 * comparable within one chart load. Labelled AVWAP in the UI for that reason.
 */
export function vwap(bars: Candle[]): number[] {
  const out = new Array<number>(bars.length);
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vv += b.v;
    out[i] = vv > 0 ? pv / vv : b.c;
  }
  return out;
}

export interface Overlays {
  ema: boolean;
  bb: boolean;
  vwap: boolean;
  sub: "RSI" | "MACD" | "NONE";
}

export interface IndicatorBundle {
  closes: number[];
  ema9: number[] | null;
  ema21: number[] | null;
  bands: Bands | null;
  avwap: number[] | null;
  rsi14: number[] | null;
  macd: Macd | null;
}

/**
 * Memoised across frames.
 *
 * The chart draws at 60fps but the underlying series changes at most a few
 * times a second, so keying on (symbol, interval, series version, overlay set)
 * cuts the indicator math by roughly an order of magnitude. Bollinger alone is
 * O(bars x period) and would otherwise dominate the frame budget.
 */
const cache: { key: string; value: IndicatorBundle | null } = { key: "", value: null };

export function indicators(
  symbol: string,
  interval: Interval,
  version: number,
  bars: Candle[],
  o: Overlays,
): IndicatorBundle {
  const key = `${symbol}|${interval}|${version}|${o.ema ? 1 : 0}${o.bb ? 1 : 0}${o.vwap ? 1 : 0}|${o.sub}`;
  if (cache.key === key && cache.value) return cache.value;

  const closes = new Array<number>(bars.length);
  for (let i = 0; i < bars.length; i++) closes[i] = bars[i].c;

  const value: IndicatorBundle = {
    closes,
    ema9: o.ema ? ema(closes, 9) : null,
    ema21: o.ema ? ema(closes, 21) : null,
    bands: o.bb ? bollinger(closes, 20, 2) : null,
    avwap: o.vwap ? vwap(bars) : null,
    rsi14: o.sub === "RSI" ? rsi(closes, 14) : null,
    macd: o.sub === "MACD" ? macd(closes) : null,
  };
  cache.key = key;
  cache.value = value;
  return value;
}
