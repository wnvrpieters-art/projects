import { BaseFeed } from "./adapter";
import { ReconnectingSocket } from "./ReconnectingSocket";
import type { Candle, Instrument, Interval } from "../types";
import type { MarketStore } from "../store";

const WS_URL = import.meta.env.VITE_COINBASE_WS ?? "wss://ws-feed.exchange.coinbase.com";

export const COINBASE_INSTRUMENTS: Instrument[] = [
  { symbol: "BTC-USD", label: "BTC-USD", desc: "BITCOIN / US DOLLAR", tickSize: 0.01, stepSize: 0.00000001, dp: 2 },
  { symbol: "ETH-USD", label: "ETH-USD", desc: "ETHEREUM / US DOLLAR", tickSize: 0.01, stepSize: 0.00000001, dp: 2 },
  { symbol: "SOL-USD", label: "SOL-USD", desc: "SOLANA / US DOLLAR", tickSize: 0.01, stepSize: 0.00000001, dp: 2 },
  { symbol: "XRP-USD", label: "XRP-USD", desc: "RIPPLE / US DOLLAR", tickSize: 0.0001, stepSize: 0.000001, dp: 4 },
  { symbol: "DOGE-USD", label: "DOGE-USD", desc: "DOGECOIN / US DOLLAR", tickSize: 0.00001, stepSize: 0.1, dp: 5 },
  { symbol: "LINK-USD", label: "LINK-USD", desc: "CHAINLINK / US DOLLAR", tickSize: 0.001, stepSize: 0.01, dp: 3 },
];

/** REST granularities Coinbase Exchange actually supports, mapped to our intervals. */
const GRANULARITY: Partial<Record<Interval, number>> = { "1m": 60, "5m": 300, "15m": 900 };

interface L2Snapshot {
  product_id: string;
  bids: [string, string][];
  asks: [string, string][];
}
interface L2Update {
  product_id: string;
  time?: string;
  changes: [string, string, string][];
}
interface MatchMsg {
  trade_id: number;
  price: string;
  size: string;
  side: "buy" | "sell";
  time: string;
}

/**
 * Coinbase Exchange adapter — the useful counterexample to Binance.
 *
 * Two structural differences drive the whole implementation:
 *
 *   1. The book arrives as a stateful `snapshot` then `l2update` sequence over
 *      the same socket, so there is no REST/WS reconciliation and no sequence
 *      arithmetic. Reconnect simply replaces the book with the next snapshot.
 *   2. There is no candle stream. Bars are folded from `match` messages
 *      client-side, and REST only backfills history at 1m and coarser — so the
 *      1s series starts empty and fills in as trades arrive.
 *
 * Keeping both venues behind one interface is what makes those differences
 * invisible to the renderer.
 */
export class CoinbaseFeed extends BaseFeed {
  readonly venue = "Coinbase Exchange";
  readonly instruments = COINBASE_INSTRUMENTS;

  private socket: ReconnectingSocket | null = null;
  private symbol = "";
  private generation = 0;

  async connect(symbol: string): Promise<void> {
    this.generation++;
    const gen = this.generation;
    this.symbol = symbol;
    this.store.reset();
    this.store.instrument = this.instruments.find((i) => i.symbol === symbol) ?? null;
    this.setState("connecting", symbol);

    try {
      await this.seedHistory(symbol);
    } catch (err) {
      this.setState("error", `history load failed: ${(err as Error).message}`);
    }
    if (gen !== this.generation) return;

    this.socket = new ReconnectingSocket(WS_URL, {
      onOpen: () => {
        this.setState("syncing", "subscribing");
        this.socket?.send({
          type: "subscribe",
          product_ids: [symbol],
          channels: ["level2_batch", "matches", "ticker"],
        });
      },
      onMessage: (raw) => this.onMessage(raw),
      onDown: (reason) => {
        this.store.book.clear();
        this.store.stats.reconnects = this.socket?.reconnects ?? 0;
        this.setState("stale", reason);
      },
    });
    this.socket.open();
  }

  async switchSymbol(symbol: string): Promise<void> {
    this.socket?.close();
    this.socket = null;
    await this.connect(symbol);
  }

  disconnect(): void {
    this.generation++;
    this.socket?.close();
    this.socket = null;
    this.setState("idle");
  }

  private async seedHistory(symbol: string): Promise<void> {
    const entries = Object.entries(GRANULARITY) as [Interval, number][];
    const results = await Promise.allSettled(
      entries.map(async ([interval, granularity]) => {
        const res = await fetch(`/api/coinbase/candles?product=${symbol}&granularity=${granularity}`);
        if (!res.ok) throw new Error(`candles ${interval} ${res.status}`);
        // Rows are [time, low, high, open, close, volume], newest first,
        // with time in *seconds* — three separate traps in one payload.
        const rows = (await res.json()) as number[][];
        const bars: Candle[] = rows
          .slice()
          .reverse()
          .map((r) => ({
            t: r[0] * 1000,
            o: r[3],
            h: r[2],
            l: r[1],
            c: r[4],
            v: r[5],
            closed: true,
          }));
        if (bars.length) bars[bars.length - 1].closed = false;
        return { interval, bars };
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") this.store.candles.seed(r.value.interval, r.value.bars);
    }
    const last = this.store.candles.get("1m").at(-1);
    if (last) this.store.setLast(last.c);
  }

  private onMessage(raw: unknown): void {
    const msg = raw as { type?: string; product_id?: string; message?: string };
    if (!msg.type) return;

    switch (msg.type) {
      case "error":
        this.setState("error", msg.message ?? "subscription rejected");
        return;

      case "snapshot": {
        const s = raw as L2Snapshot;
        if (s.product_id !== this.symbol) return;
        this.store.book.applySnapshot(s.bids, s.asks, Date.now());
        this.store.noteMessage();
        this.setState("live", "book snapshot applied");
        return;
      }

      case "l2update": {
        const u = raw as L2Update;
        if (u.product_id !== this.symbol) return;
        const ts = u.time ? Date.parse(u.time) : Date.now();
        this.store.book.applyL2Update(u.changes, Date.now());
        this.store.noteMessage(ts);
        return;
      }

      case "match":
      case "last_match": {
        const m = raw as MatchMsg;
        const ts = Date.parse(m.time);
        const price = +m.price;
        const size = +m.size;
        // `side` is the *maker's* side, so an aggressive buy is reported as a
        // sell. Getting this backwards inverts the entire tape.
        const side: 1 | -1 = m.side === "sell" ? 1 : -1;
        this.store.setLast(price);
        this.store.pushTrade({ t: ts, p: price, s: size, side, id: m.trade_id });
        this.store.candles.addTrade(price, size, ts);
        this.store.setTicker(this.symbol, price, this.store.candles.sessionStats().open);
        this.store.noteMessage(ts);
        return;
      }

      default:
        return;
    }
  }
}

export function createCoinbaseFeed(store: MarketStore, opts: { seedBars: number; depthLimit: number }): CoinbaseFeed {
  return new CoinbaseFeed(store, opts);
}
