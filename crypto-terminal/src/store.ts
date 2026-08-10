import { useEffect, useReducer } from "react";
import { OrderBook } from "./feed/OrderBook";
import { CandleStore } from "./feed/CandleStore";
import type { ConnState, FeedStats, Instrument, Trade } from "./types";

const MAX_TAPE = 120;

/**
 * Single mutable snapshot of the market, owned by the feed adapter and read by
 * the renderer.
 *
 * This is intentionally not immutable state. At 10 book updates and dozens of
 * trades per second, allocating a fresh state object per message would put the
 * whole feed on the GC's critical path and force React to reconcile faster than
 * anyone can read. Mutation plus a version counter keeps allocation flat, and
 * the UI samples at a fixed rate instead of chasing every message.
 */
export class MarketStore {
  book = new OrderBook();
  candles = new CandleStore();
  tape: Trade[] = [];

  instrument: Instrument | null = null;
  last = NaN;
  prevLast = NaN;
  dir: 0 | 1 | -1 = 0;

  status: ConnState = "idle";
  statusDetail = "";

  stats: FeedStats = { msgs: 0, msgsPerSec: 0, dropped: 0, resyncs: 0, reconnects: 0, latencyMs: 0 };

  /** Lightweight last/percent for every watchlist row, keyed by symbol. */
  tickers = new Map<string, { last: number; pct: number; dir: 0 | 1 | -1 }>();

  private msgWindow = 0;
  private windowStart = performance.now();

  reset(): void {
    this.book.clear();
    this.candles.clear();
    this.tape = [];
    this.last = NaN;
    this.prevLast = NaN;
    this.dir = 0;
    this.stats.dropped = 0;
    this.stats.resyncs = 0;
  }

  /** Called once per accepted socket frame. `eventTs` is the venue's own clock. */
  noteMessage(eventTs?: number): void {
    this.stats.msgs++;
    this.msgWindow++;
    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed >= 1_000) {
      this.stats.msgsPerSec = Math.round((this.msgWindow * 1_000) / elapsed);
      this.msgWindow = 0;
      this.windowStart = now;
    }
    if (eventTs) {
      // Includes client clock skew, so treat it as an indicator rather than a
      // measurement. A sudden jump still reliably means the feed is falling behind.
      const lag = Date.now() - eventTs;
      this.stats.latencyMs = this.stats.latencyMs * 0.8 + lag * 0.2;
    }
  }

  setLast(price: number): void {
    if (!Number.isFinite(price)) return;
    this.prevLast = this.last;
    if (Number.isFinite(this.prevLast)) {
      this.dir = price > this.prevLast ? 1 : price < this.prevLast ? -1 : this.dir;
    }
    this.last = price;
  }

  pushTrade(t: Trade): void {
    this.tape.unshift(t);
    if (this.tape.length > MAX_TAPE) this.tape.length = MAX_TAPE;
  }

  setTicker(symbol: string, last: number, open: number): void {
    const prev = this.tickers.get(symbol);
    const dir: 0 | 1 | -1 = prev ? (last > prev.last ? 1 : last < prev.last ? -1 : prev.dir) : 0;
    this.tickers.set(symbol, { last, pct: open > 0 ? ((last - open) / open) * 100 : 0, dir });
  }
}

/**
 * Re-render the caller at a fixed rate rather than per message.
 *
 * The canvas panes draw themselves from the store inside requestAnimationFrame
 * and do not use this at all — only DOM panels (book, tape, header) do, and
 * roughly 9Hz is past the point where text stops being readable anyway.
 */
export function useMarketTick(hz = 9): void {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = window.setInterval(force, Math.round(1000 / hz));
    return () => clearInterval(id);
  }, [hz]);
}
