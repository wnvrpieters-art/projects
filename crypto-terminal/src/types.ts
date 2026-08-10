export interface Candle {
  /** Bar open time, ms epoch, aligned to the interval. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** Quote-asset volume, when the venue reports it. */
  q?: number;
  closed: boolean;
}

export interface BookLevel {
  p: number;
  s: number;
  /** Timestamp of the last size change — drives the flash highlight. */
  f: number;
}

export interface Trade {
  t: number;
  p: number;
  s: number;
  /** 1 = buyer was the aggressor, -1 = seller was. */
  side: 1 | -1;
  id: number;
}

export interface Instrument {
  /** Venue-native symbol, e.g. BTCUSDT (Binance) or BTC-USD (Coinbase). */
  symbol: string;
  label: string;
  desc: string;
  tickSize: number;
  stepSize: number;
  /** Price display decimals, derived from tickSize. */
  dp: number;
}

export type Interval = "1s" | "1m" | "5m" | "15m";

export const INTERVAL_MS: Record<Interval, number> = {
  "1s": 1_000,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};

export const INTERVALS: Interval[] = ["1s", "1m", "5m", "15m"];

export type ConnState = "idle" | "connecting" | "syncing" | "live" | "stale" | "error";

export interface FeedStats {
  /** Messages accepted from the socket in the current window. */
  msgs: number;
  msgsPerSec: number;
  /** Diff events discarded because the book was mid-resync. */
  dropped: number;
  /** Book resynchronisations caused by a sequence gap. */
  resyncs: number;
  reconnects: number;
  /** now() - exchange event time, in ms. Wall-clock skew is included. */
  latencyMs: number;
}
