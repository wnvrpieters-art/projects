import { INTERVALS, INTERVAL_MS, type Candle, type Interval } from "../types";

/**
 * Multi-interval OHLCV series.
 *
 * Two ingestion paths, because venues differ:
 *   `upsert` — the venue streams bars itself (Binance kline streams).
 *   `addTrade` — the venue streams only executions (Coinbase matches), so bars
 *                are folded client-side across every interval at once.
 *
 * Bars are stored newest-last in a plain array. `shift()` on overflow is O(n),
 * but n is capped and the operation runs at most a few times a second, which is
 * cheaper in practice than the pointer bookkeeping of a ring buffer.
 */
export class CandleStore {
  private series = new Map<Interval, Candle[]>();
  /** Bumped on every mutation; downstream memoisation keys off it. */
  version = 0;

  constructor(private maxBars = 1500) {
    for (const i of INTERVALS) this.series.set(i, []);
  }

  clear(): void {
    for (const i of INTERVALS) this.series.set(i, []);
    this.version++;
  }

  seed(interval: Interval, bars: Candle[]): void {
    const trimmed = bars.slice(-this.maxBars);
    this.series.set(interval, trimmed);
    this.version++;
  }

  get(interval: Interval): Candle[] {
    return this.series.get(interval) ?? [];
  }

  get seeded(): boolean {
    return this.get("1m").length > 0;
  }

  /** Replace the forming bar, or append if this is a new one. */
  upsert(interval: Interval, bar: Candle): void {
    const arr = this.series.get(interval);
    if (!arr) return;
    const last = arr[arr.length - 1];
    if (last && last.t === bar.t) {
      arr[arr.length - 1] = bar;
    } else if (!last || bar.t > last.t) {
      arr.push(bar);
      if (arr.length > this.maxBars) arr.shift();
    }
    // A bar older than the tail is a late/duplicate frame; ignore it rather
    // than rewriting history the chart has already drawn.
    this.version++;
  }

  addTrade(price: number, size: number, ts: number): void {
    for (const interval of INTERVALS) {
      const arr = this.series.get(interval);
      if (!arr) continue;
      const step = INTERVAL_MS[interval];
      const bucket = Math.floor(ts / step) * step;
      const last = arr[arr.length - 1];
      if (last && last.t === bucket) {
        last.c = price;
        if (price > last.h) last.h = price;
        if (price < last.l) last.l = price;
        last.v += size;
      } else {
        if (last) last.closed = true;
        arr.push({ t: bucket, o: last ? last.c : price, h: price, l: price, c: price, v: size, closed: false });
        if (arr.length > this.maxBars) arr.shift();
      }
    }
    this.version++;
  }

  /** Session stats derived from the finest series that covers the window. */
  sessionStats(interval: Interval = "1m", bars = 1440): { open: number; high: number; low: number; volume: number } {
    const arr = this.get(interval).slice(-bars);
    if (!arr.length) return { open: NaN, high: NaN, low: NaN, volume: 0 };
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const b of arr) {
      if (b.h > high) high = b.h;
      if (b.l < low) low = b.l;
      volume += b.v;
    }
    return { open: arr[0].o, high, low, volume };
  }
}
