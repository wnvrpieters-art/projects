import type { ConnState, Instrument, Interval } from "../types";
import type { MarketStore } from "../store";

export interface FeedOptions {
  /** Bars fetched per interval to seed the chart before the socket takes over. */
  seedBars?: number;
  /** Depth snapshot size. Larger = more of the book, more REST weight. */
  depthLimit?: number;
}

/**
 * Contract every venue adapter implements.
 *
 * Deliberate asymmetry: lifecycle events go through `onStatus` (rare, cheap to
 * allocate), while hot market data is written straight into the MarketStore.
 * Emitting an event object per depth update would allocate roughly 10 objects
 * per second per symbol for no benefit — nothing downstream reads a message,
 * only the resulting state.
 */
export interface FeedAdapter {
  readonly venue: string;
  /** Symbols this venue exposes in the watchlist. */
  readonly instruments: Instrument[];
  connect(symbol: string): Promise<void>;
  /** Tear down the old subscription and start a new one. */
  switchSymbol(symbol: string): Promise<void>;
  disconnect(): void;
  onStatus(fn: (s: ConnState, detail?: string) => void): () => void;
}

export abstract class BaseFeed implements FeedAdapter {
  abstract readonly venue: string;
  abstract readonly instruments: Instrument[];
  protected listeners = new Set<(s: ConnState, detail?: string) => void>();
  protected state: ConnState = "idle";

  constructor(protected store: MarketStore, protected opts: Required<FeedOptions>) {}

  onStatus(fn: (s: ConnState, detail?: string) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  protected setState(s: ConnState, detail?: string): void {
    this.state = s;
    this.store.status = s;
    this.store.statusDetail = detail ?? "";
    for (const fn of this.listeners) fn(s, detail);
  }

  protected seedIntervals(): Interval[] {
    return ["1s", "1m", "5m", "15m"];
  }

  abstract connect(symbol: string): Promise<void>;
  abstract switchSymbol(symbol: string): Promise<void>;
  abstract disconnect(): void;
}

export const DEFAULT_FEED_OPTIONS: Required<FeedOptions> = {
  seedBars: 500,
  depthLimit: 1000,
};
