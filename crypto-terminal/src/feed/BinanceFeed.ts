import { BaseFeed } from "./adapter";
import { ReconnectingSocket } from "./ReconnectingSocket";
import { classifyDiff } from "./OrderBook";
import { INTERVALS, type Candle, type Instrument, type Interval } from "../types";
import type { MarketStore } from "../store";

const WS_BASE = import.meta.env.VITE_BINANCE_WS ?? "wss://stream.binance.com:9443";

export const BINANCE_INSTRUMENTS: Instrument[] = [
  { symbol: "BTCUSDT", label: "BTCUSDT", desc: "BITCOIN / TETHER", tickSize: 0.01, stepSize: 0.00001, dp: 2 },
  { symbol: "ETHUSDT", label: "ETHUSDT", desc: "ETHEREUM / TETHER", tickSize: 0.01, stepSize: 0.0001, dp: 2 },
  { symbol: "SOLUSDT", label: "SOLUSDT", desc: "SOLANA / TETHER", tickSize: 0.01, stepSize: 0.001, dp: 2 },
  { symbol: "XRPUSDT", label: "XRPUSDT", desc: "RIPPLE / TETHER", tickSize: 0.0001, stepSize: 0.1, dp: 4 },
  { symbol: "DOGEUSDT", label: "DOGEUSDT", desc: "DOGECOIN / TETHER", tickSize: 0.00001, stepSize: 1, dp: 5 },
  { symbol: "BNBUSDT", label: "BNBUSDT", desc: "BNB / TETHER", tickSize: 0.01, stepSize: 0.001, dp: 2 },
  { symbol: "ADAUSDT", label: "ADAUSDT", desc: "CARDANO / TETHER", tickSize: 0.0001, stepSize: 0.1, dp: 4 },
  { symbol: "LINKUSDT", label: "LINKUSDT", desc: "CHAINLINK / TETHER", tickSize: 0.001, stepSize: 0.01, dp: 3 },
];

interface DepthDiff {
  U: number; // first update id in this event
  u: number; // final update id in this event
  b: [string, string][];
  a: [string, string][];
  E: number;
}

interface KlineMsg {
  E: number;
  k: { t: number; i: string; o: string; h: string; l: string; c: string; v: string; q: string; x: boolean };
}

interface AggTradeMsg {
  T: number;
  a: number;
  p: string;
  q: string;
  m: boolean; // buyer is the market maker => the aggressor was the seller
}

interface MiniTicker {
  s: string;
  c: string;
  o: string;
}

const MAX_BUFFERED_DIFFS = 400;

/**
 * Binance Spot adapter.
 *
 * The interesting part is book synchronisation. A depth diff stream is only
 * meaningful relative to a snapshot, and the two arrive over different
 * transports with no shared ordering, so the sequence numbers have to do the
 * reconciling. Binance documents the procedure; the implementation below
 * follows it exactly, including the two failure modes that matter:
 *
 *   - snapshot older than the buffer  -> refetch
 *   - gap between consecutive events  -> the book is now wrong, resync
 *
 * Silently tolerating a gap is the single most common bug in home-grown book
 * builders. It does not look broken; it just quietly drifts.
 */
export class BinanceFeed extends BaseFeed {
  readonly venue = "Binance Spot";
  readonly instruments = BINANCE_INSTRUMENTS;

  private socket: ReconnectingSocket | null = null;
  private tickerSocket: ReconnectingSocket | null = null;
  private symbol = "";
  private buffer: DepthDiff[] = [];
  private syncing = false;
  private syncAttempt = 0;
  private resyncTimer: number | null = null;
  private generation = 0;

  async connect(symbol: string): Promise<void> {
    this.generation++;
    const gen = this.generation;
    this.symbol = symbol;
    this.store.reset();
    this.store.instrument = this.instruments.find((i) => i.symbol === symbol) ?? null;
    this.setState("connecting", symbol);

    try {
      await this.loadMeta(symbol);
      await this.seedHistory(symbol);
    } catch (err) {
      this.setState("error", `history load failed: ${(err as Error).message}`);
      // The socket still gets opened: live data is more valuable than history,
      // and the chart backfills as bars close.
    }
    if (gen !== this.generation) return;

    this.openMarketSocket(symbol);
    this.openTickerSocket();
  }

  async switchSymbol(symbol: string): Promise<void> {
    this.socket?.close();
    this.socket = null;
    this.clearResync();
    await this.connect(symbol);
  }

  disconnect(): void {
    this.generation++;
    this.clearResync();
    this.socket?.close();
    this.tickerSocket?.close();
    this.socket = null;
    this.tickerSocket = null;
    this.setState("idle");
  }

  /* ------------------------------ REST seed ------------------------------ */

  private async loadMeta(symbol: string): Promise<void> {
    const res = await fetch(`/api/exchangeInfo?symbol=${symbol}`);
    if (!res.ok) throw new Error(`exchangeInfo ${res.status}`);
    const json = (await res.json()) as {
      symbols: { symbol: string; filters: { filterType: string; tickSize?: string; stepSize?: string }[] }[];
    };
    const entry = json.symbols?.find((s) => s.symbol === symbol);
    if (!entry) return;
    const price = entry.filters.find((f) => f.filterType === "PRICE_FILTER");
    const lot = entry.filters.find((f) => f.filterType === "LOT_SIZE");
    const tickSize = price?.tickSize ? Number(price.tickSize) : null;
    const stepSize = lot?.stepSize ? Number(lot.stepSize) : null;
    const inst = this.store.instrument;
    if (inst && tickSize) {
      inst.tickSize = tickSize;
      // Display precision follows the tick, not a hardcoded guess — otherwise
      // the book renders prices the venue cannot actually quote.
      inst.dp = Math.max(0, Math.round(-Math.log10(tickSize)));
    }
    if (inst && stepSize) inst.stepSize = stepSize;
  }

  private async seedHistory(symbol: string): Promise<void> {
    const results = await Promise.allSettled(
      INTERVALS.map(async (interval) => {
        const res = await fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=${this.opts.seedBars}`);
        if (!res.ok) throw new Error(`klines ${interval} ${res.status}`);
        const rows = (await res.json()) as (string | number)[][];
        const bars: Candle[] = rows.map((r) => ({
          t: Number(r[0]),
          o: Number(r[1]),
          h: Number(r[2]),
          l: Number(r[3]),
          c: Number(r[4]),
          v: Number(r[5]),
          q: Number(r[7]),
          closed: true,
        }));
        if (bars.length) bars[bars.length - 1].closed = false;
        return { interval, bars };
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") this.store.candles.seed(r.value.interval as Interval, r.value.bars);
    }
    const last = this.store.candles.get("1m").at(-1);
    if (last) this.store.setLast(last.c);
  }

  /* ------------------------------ sockets -------------------------------- */

  private openMarketSocket(symbol: string): void {
    const lc = symbol.toLowerCase();
    const streams = [
      ...INTERVALS.map((i) => `${lc}@kline_${i}`),
      `${lc}@depth@100ms`,
      `${lc}@aggTrade`,
    ].join("/");

    this.socket = new ReconnectingSocket(`${WS_BASE}/stream?streams=${streams}`, {
      onOpen: () => {
        // Every reconnect invalidates the book: diffs missed while the socket
        // was down cannot be recovered, so start from a fresh snapshot.
        this.setState("syncing", "socket open — fetching depth snapshot");
        void this.startBookSync();
      },
      onMessage: (raw) => this.onMarketMessage(raw),
      onDown: (reason) => {
        this.store.book.clear();
        this.store.stats.reconnects = this.socket?.reconnects ?? 0;
        this.setState("stale", reason);
      },
    });
    this.socket.open();
  }

  private openTickerSocket(): void {
    if (this.tickerSocket) return;
    const streams = this.instruments.map((i) => `${i.symbol.toLowerCase()}@miniTicker`).join("/");
    this.tickerSocket = new ReconnectingSocket(
      `${WS_BASE}/stream?streams=${streams}`,
      {
        onOpen: () => undefined,
        onMessage: (raw) => {
          const msg = raw as { data?: MiniTicker };
          const d = msg.data;
          if (!d?.s) return;
          this.store.setTicker(d.s, Number(d.c), Number(d.o));
        },
        onDown: () => undefined,
      },
      60_000, // miniTicker only fires once per second per symbol
    );
    this.tickerSocket.open();
  }

  private onMarketMessage(raw: unknown): void {
    const msg = raw as { stream?: string; data?: unknown };
    const stream = msg.stream;
    const data = msg.data;
    if (!stream || !data) return;

    if (stream.includes("@kline_")) {
      const k = (data as KlineMsg).k;
      const interval = k.i as Interval;
      if (!INTERVALS.includes(interval)) return;
      this.store.candles.upsert(interval, {
        t: k.t,
        o: +k.o,
        h: +k.h,
        l: +k.l,
        c: +k.c,
        v: +k.v,
        q: +k.q,
        closed: k.x,
      });
      this.store.noteMessage((data as KlineMsg).E);
      return;
    }

    if (stream.includes("@aggTrade")) {
      const t = data as AggTradeMsg;
      const price = +t.p;
      this.store.setLast(price);
      this.store.pushTrade({ t: t.T, p: price, s: +t.q, side: t.m ? -1 : 1, id: t.a });
      this.store.noteMessage(t.T);
      return;
    }

    if (stream.includes("@depth")) {
      this.onDepthDiff(data as DepthDiff);
    }
  }

  /* --------------------------- book synchronisation ---------------------- */

  private onDepthDiff(e: DepthDiff): void {
    this.store.noteMessage(e.E);

    if (this.syncing || !this.store.book.synced) {
      this.buffer.push(e);
      if (this.buffer.length > MAX_BUFFERED_DIFFS) {
        // A buffer this deep means the snapshot is taking far too long. Dropping
        // the oldest is safe: the sequence check on replay will catch the hole
        // and force another resync rather than applying a corrupt book.
        this.buffer.shift();
        this.store.stats.dropped++;
      }
      return;
    }

    const book = this.store.book;
    const action = classifyDiff(book.lastUpdateId, e.U, e.u);
    if (action === "skip") return;
    if (action === "gap") {
      this.scheduleResync(`sequence gap: expected ${book.lastUpdateId + 1}, got ${e.U}`);
      return;
    }
    book.applyDiff(e.b, e.a, e.u, Date.now());
    if (this.state !== "live") this.setState("live");
  }

  private async startBookSync(): Promise<void> {
    if (this.syncing) return;
    const gen = this.generation;
    this.syncing = true;
    this.buffer = [];
    this.store.book.clear();

    try {
      const res = await fetch(`/api/depth?symbol=${this.symbol}&limit=${this.opts.depthLimit}`);
      if (!res.ok) throw new Error(`depth ${res.status}`);
      const snap = (await res.json()) as { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };
      if (gen !== this.generation) return;

      this.store.book.applySnapshot(snap.bids, snap.asks, snap.lastUpdateId);

      // Discard everything the snapshot already contains.
      const pending = this.buffer.filter((e) => e.u > snap.lastUpdateId);
      const first = pending[0];

      // The first surviving event must straddle lastUpdateId + 1. If it starts
      // after that, the snapshot predates the buffer and there is a hole between
      // them — nothing to do but fetch a newer snapshot.
      if (first && first.U > snap.lastUpdateId + 1) {
        throw new Error(`snapshot stale: first buffered U=${first.U} > ${snap.lastUpdateId + 1}`);
      }

      let prevU = snap.lastUpdateId;
      const now = Date.now();
      for (const e of pending) {
        const action = classifyDiff(prevU, e.U, e.u);
        if (action === "skip") continue;
        if (action === "gap") throw new Error(`gap while replaying buffer at ${e.U}`);
        this.store.book.applyDiff(e.b, e.a, e.u, now);
        prevU = e.u;
      }

      this.buffer = [];
      this.syncing = false;
      this.syncAttempt = 0;
      this.setState("live", `book synced at ${snap.lastUpdateId}`);
    } catch (err) {
      this.syncing = false;
      if (gen !== this.generation) return;
      this.scheduleResync((err as Error).message);
    }
  }

  private scheduleResync(reason: string): void {
    if (this.resyncTimer !== null) return;
    this.store.stats.resyncs++;
    this.store.book.clear();
    this.setState("syncing", `resync: ${reason}`);

    // Backoff matters here: a resync storm burns REST weight at 50 per attempt
    // and a ban costs far more than a few seconds of a stale book.
    const delay = Math.min(10_000, 500 * 2 ** this.syncAttempt) * (0.5 + Math.random() * 0.5);
    this.syncAttempt++;
    this.resyncTimer = window.setTimeout(() => {
      this.resyncTimer = null;
      void this.startBookSync();
    }, delay);
  }

  private clearResync(): void {
    if (this.resyncTimer !== null) {
      clearTimeout(this.resyncTimer);
      this.resyncTimer = null;
    }
    this.syncing = false;
    this.buffer = [];
  }
}

export function createBinanceFeed(store: MarketStore, opts: { seedBars: number; depthLimit: number }): BinanceFeed {
  return new BinanceFeed(store, opts);
}
