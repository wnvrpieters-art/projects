import { BaseFeed } from "./adapter";
import { INTERVALS, INTERVAL_MS, type Candle, type Instrument } from "../types";
import type { MarketStore } from "../store";

export const SIM_INSTRUMENTS: Instrument[] = [
  { symbol: "BTCUSD", label: "BTCUSD", desc: "BITCOIN / US DOLLAR (SIM)", tickSize: 0.5, stepSize: 0.0001, dp: 1 },
  { symbol: "ETHUSD", label: "ETHUSD", desc: "ETHEREUM / US DOLLAR (SIM)", tickSize: 0.05, stepSize: 0.001, dp: 2 },
  { symbol: "SOLUSD", label: "SOLUSD", desc: "SOLANA / US DOLLAR (SIM)", tickSize: 0.01, stepSize: 0.01, dp: 2 },
  { symbol: "XRPUSD", label: "XRPUSD", desc: "RIPPLE / US DOLLAR (SIM)", tickSize: 0.0001, stepSize: 1, dp: 4 },
];

const SEED_PRICE: Record<string, number> = { BTCUSD: 67432.5, ETHUSD: 3521.44, SOLUSD: 172.83, XRPUSD: 0.6214 };
const SEED_LOT: Record<string, number> = { BTCUSD: 0.9, ETHUSD: 14, SOLUSD: 160, XRPUSD: 42000 };

const TICK_MS = 100;
const BOOK_LEVELS = 40;

let spare: number | null = null;
function gauss(): number {
  if (spare !== null) {
    const v = spare;
    spare = null;
    return v;
  }
  let u = 0;
  let v = 0;
  let s = 0;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const m = Math.sqrt((-2 * Math.log(s)) / s);
  spare = v * m;
  return u * m;
}

/**
 * Offline adapter: mean-reverting jump diffusion with a synthetic L2 book.
 *
 * Not a toy — it is how the UI gets developed on a plane, how the renderer gets
 * profiled at a fixed message rate, and how the panels get tested without
 * waiting for a real venue to print something interesting. Same interface as
 * the live adapters, so nothing downstream can tell the difference.
 */
export class SimFeed extends BaseFeed {
  readonly venue = "Simulated";
  readonly instruments = SIM_INSTRUMENTS;

  private timer: number | null = null;
  private price = 0;
  private anchor = 0;
  private sigma = 0.0008;
  private lot = 1;
  private tick = 0.5;
  private levels: { bidSize: number; askSize: number }[] = [];
  private tradeId = 0;

  async connect(symbol: string): Promise<void> {
    this.disconnect();
    const inst = this.instruments.find((i) => i.symbol === symbol) ?? this.instruments[0];
    this.store.reset();
    this.store.instrument = { ...inst };
    this.setState("connecting", symbol);

    this.price = SEED_PRICE[inst.symbol] ?? 100;
    this.anchor = this.price;
    this.lot = SEED_LOT[inst.symbol] ?? 100;
    this.tick = inst.tickSize;
    this.levels = Array.from({ length: BOOK_LEVELS }, (_, i) => {
      const decay = Math.exp(-i * 0.09);
      return { bidSize: this.lot * decay * (0.5 + Math.random()), askSize: this.lot * decay * (0.5 + Math.random()) };
    });

    this.seedBars();
    this.store.setLast(this.price);
    this.timer = window.setInterval(() => this.step(), TICK_MS);
    this.setState("live", "synthetic feed");
  }

  async switchSymbol(symbol: string): Promise<void> {
    await this.connect(symbol);
  }

  disconnect(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.setState("idle");
  }

  private seedBars(): void {
    const now = Date.now();
    for (const interval of INTERVALS) {
      const step = INTERVAL_MS[interval];
      const sig = this.sigma * Math.sqrt(step / TICK_MS);
      const n = 400;
      const closes = new Array<number>(n);
      let p = this.price;
      for (let i = n - 1; i >= 0; i--) {
        closes[i] = p;
        p = p * Math.exp(-sig * gauss());
      }
      const b0 = Math.floor(now / step) * step;
      const bars: Candle[] = [];
      for (let i = 0; i < n; i++) {
        const o = i === 0 ? closes[0] * (1 - sig * 0.4) : closes[i - 1];
        const c = closes[i];
        const w = sig * (0.35 + Math.random() * 0.85);
        bars.push({
          t: b0 - (n - 1 - i) * step,
          o,
          h: Math.max(o, c) * (1 + Math.abs(gauss()) * w * 0.7),
          l: Math.min(o, c) * (1 - Math.abs(gauss()) * w * 0.7),
          c,
          v: this.lot * (0.35 + Math.random() * 1.1) * (step / TICK_MS / 10),
          closed: i < n - 1,
        });
      }
      this.store.candles.seed(interval, bars);
    }
  }

  private step(): void {
    const now = Date.now();
    this.anchor *= Math.exp(0.00004 * gauss());
    let shock = this.sigma * gauss() + Math.log(this.anchor / this.price) * 0.004;
    if (Math.random() < 0.0025) shock += this.sigma * 9 * gauss();
    const next = Math.max(this.tick, Math.round((this.price * Math.exp(shock)) / this.tick) * this.tick);
    const dir = next >= this.price ? 1 : -1;
    this.price = next;
    this.store.setLast(next);

    const nTrades = Math.random() < 0.55 ? 1 + Math.floor(Math.random() * 2) : 0;
    for (let i = 0; i < nTrades; i++) {
      const size = (this.lot / 24) * (0.15 + Math.random() * 1.9);
      this.store.pushTrade({ t: now, p: next, s: size, side: dir > 0 ? 1 : -1, id: this.tradeId++ });
      this.store.candles.addTrade(next, size, now);
    }

    const bids: [string, string][] = [];
    const asks: [string, string][] = [];
    const half = this.tick * (1 + Math.floor(Math.random() * 2));
    let bp = next - half;
    let ap = next + half;
    for (let i = 0; i < BOOK_LEVELS; i++) {
      const lvl = this.levels[i];
      const decay = Math.exp(-i * 0.09);
      lvl.bidSize = Math.min(this.lot * decay * 5, Math.max(this.lot * decay * 0.12, lvl.bidSize * Math.exp(0.09 * gauss())));
      lvl.askSize = Math.min(this.lot * decay * 5, Math.max(this.lot * decay * 0.12, lvl.askSize * Math.exp(0.09 * gauss())));
      bids.push([String(bp), String(lvl.bidSize)]);
      asks.push([String(ap), String(lvl.askSize)]);
      bp -= this.tick * (1 + Math.floor(Math.random() * 3));
      ap += this.tick * (1 + Math.floor(Math.random() * 3));
    }
    this.store.book.applySnapshot(bids, asks, now);
    this.store.setTicker(this.store.instrument?.symbol ?? "", next, this.store.candles.sessionStats().open);
    this.store.noteMessage(now);
    this.store.stats.latencyMs = 6 + Math.random() * 8;
  }
}

export function createSimFeed(store: MarketStore, opts: { seedBars: number; depthLimit: number }): SimFeed {
  return new SimFeed(store, opts);
}
