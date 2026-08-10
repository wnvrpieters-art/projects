import type { BookLevel } from "../types";

/**
 * Local L2 book maintained from a REST snapshot plus a diff stream.
 *
 * Storage is two price->size Maps. Writes are O(1); the sorted view is built
 * lazily and cached, so a burst of diffs costs one sort at the next read rather
 * than one sort per update. Reads happen at frame rate (60/s) while writes
 * arrive at stream rate (10/s), which is exactly the case the cache is for.
 */
export class OrderBook {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private flash = new Map<number, number>();
  private dirty = true;
  private cachedBids: BookLevel[] = [];
  private cachedAsks: BookLevel[] = [];

  /** Last update id applied. Used to validate diff continuity. */
  lastUpdateId = 0;
  synced = false;

  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.flash.clear();
    this.lastUpdateId = 0;
    this.synced = false;
    this.dirty = true;
  }

  applySnapshot(bids: [string, string][], asks: [string, string][], lastUpdateId: number): void {
    this.bids.clear();
    this.asks.clear();
    for (const [p, s] of bids) {
      const size = +s;
      if (size > 0) this.bids.set(+p, size);
    }
    for (const [p, s] of asks) {
      const size = +s;
      if (size > 0) this.asks.set(+p, size);
    }
    this.lastUpdateId = lastUpdateId;
    this.synced = true;
    this.dirty = true;
  }

  /**
   * Apply one diff side. A size of exactly 0 is a delete, not a zero-size
   * level — treating it as a level is the classic way to end up with a book
   * full of phantom prices.
   */
  private applySide(map: Map<number, number>, rows: [string, string][], now: number): void {
    for (const [ps, ss] of rows) {
      const p = +ps;
      const s = +ss;
      const prev = map.get(p);
      if (s === 0) {
        map.delete(p);
        this.flash.delete(p);
      } else {
        map.set(p, s);
        if (prev === undefined || Math.abs(s - prev) / prev > 0.05) this.flash.set(p, now);
      }
    }
  }

  applyDiff(bids: [string, string][], asks: [string, string][], finalUpdateId: number, now: number): void {
    this.applySide(this.bids, bids, now);
    this.applySide(this.asks, asks, now);
    this.lastUpdateId = finalUpdateId;
    this.dirty = true;
  }

  /** Coinbase-style absolute updates: [side, price, size] with size 0 = remove. */
  applyL2Update(changes: [string, string, string][], now: number): void {
    for (const [side, ps, ss] of changes) {
      const map = side === "buy" ? this.bids : this.asks;
      this.applySide(map, [[ps, ss]], now);
    }
    this.dirty = true;
  }

  private rebuild(): void {
    this.cachedBids = [];
    this.cachedAsks = [];
    for (const [p, s] of this.bids) this.cachedBids.push({ p, s, f: this.flash.get(p) ?? 0 });
    for (const [p, s] of this.asks) this.cachedAsks.push({ p, s, f: this.flash.get(p) ?? 0 });
    this.cachedBids.sort((a, b) => b.p - a.p);
    this.cachedAsks.sort((a, b) => a.p - b.p);
    this.dirty = false;

    // Expired flashes are dropped here rather than on a timer: this is the only
    // place that walks every level anyway.
    if (this.flash.size > 400) {
      const cutoff = Date.now() - 1_000;
      for (const [p, t] of this.flash) if (t < cutoff) this.flash.delete(p);
    }
  }

  /** Top `n` levels per side, best price first. */
  top(n: number): { bids: BookLevel[]; asks: BookLevel[] } {
    if (this.dirty) this.rebuild();
    return { bids: this.cachedBids.slice(0, n), asks: this.cachedAsks.slice(0, n) };
  }

  get bestBid(): number {
    if (this.dirty) this.rebuild();
    return this.cachedBids.length ? this.cachedBids[0].p : NaN;
  }

  get bestAsk(): number {
    if (this.dirty) this.rebuild();
    return this.cachedAsks.length ? this.cachedAsks[0].p : NaN;
  }

  get mid(): number {
    const b = this.bestBid;
    const a = this.bestAsk;
    return Number.isFinite(b) && Number.isFinite(a) ? (b + a) / 2 : NaN;
  }

  get depth(): number {
    return this.bids.size + this.asks.size;
  }

  /** Size-weighted imbalance over the top `n` levels, in [-1, 1]. */
  imbalance(n: number): number {
    const { bids, asks } = this.top(n);
    let b = 0;
    let a = 0;
    for (const l of bids) b += l.s;
    for (const l of asks) a += l.s;
    const total = b + a;
    return total > 0 ? (b - a) / total : 0;
  }
}

export type DiffAction = "apply" | "skip" | "gap";

/**
 * The single rule that decides whether a depth diff can be trusted.
 *
 * Extracted from the adapter because it is the one piece of book handling where
 * a subtle mistake produces a book that looks fine and is quietly wrong — worth
 * being able to test in isolation.
 *
 *   skip  — entirely contained in what we already applied (snapshot overlap or
 *           a duplicate frame)
 *   gap   — starts beyond the next expected id, so updates were missed and the
 *           book must be rebuilt from a fresh snapshot
 *   apply — contiguous with, or straddling, the next expected id
 */
export function classifyDiff(lastUpdateId: number, firstId: number, finalId: number): DiffAction {
  if (finalId <= lastUpdateId) return "skip";
  if (firstId > lastUpdateId + 1) return "gap";
  return "apply";
}
