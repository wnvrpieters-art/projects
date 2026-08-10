import { DEFAULT_FEED_OPTIONS, type FeedAdapter, type FeedOptions } from "./adapter";
import { BinanceFeed } from "./BinanceFeed";
import { CoinbaseFeed } from "./CoinbaseFeed";
import { SimFeed } from "./SimFeed";
import type { MarketStore } from "../store";

export type Venue = "binance" | "coinbase" | "sim";

export const VENUES: { id: Venue; label: string }[] = [
  { id: "binance", label: "Binance" },
  { id: "coinbase", label: "Coinbase" },
  { id: "sim", label: "Sim" },
];

export function createFeed(venue: Venue, store: MarketStore, opts: FeedOptions = {}): FeedAdapter {
  const merged = { ...DEFAULT_FEED_OPTIONS, ...opts };
  switch (venue) {
    case "binance":
      return new BinanceFeed(store, merged);
    case "coinbase":
      return new CoinbaseFeed(store, merged);
    case "sim":
      return new SimFeed(store, merged);
  }
}

export { BINANCE_INSTRUMENTS } from "./BinanceFeed";
export { COINBASE_INSTRUMENTS } from "./CoinbaseFeed";
export { SIM_INSTRUMENTS } from "./SimFeed";
export type { FeedAdapter, FeedOptions };
