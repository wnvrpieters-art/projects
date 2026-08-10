/**
 * Logic checks for the pieces where a bug is silent rather than loud.
 *
 * Run with: npm run verify
 */
import assert from "node:assert/strict";
import { OrderBook, classifyDiff } from "../src/feed/OrderBook";
import { CandleStore } from "../src/feed/CandleStore";
import { bollinger, ema, rsi, vwap } from "../src/indicators";
import type { Candle } from "../src/types";

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("\nsequence classification");
test("a diff fully behind the book is skipped", () => {
  assert.equal(classifyDiff(1000, 990, 1000), "skip");
  assert.equal(classifyDiff(1000, 500, 999), "skip");
});
test("a diff starting past the next id is a gap", () => {
  assert.equal(classifyDiff(1000, 1002, 1010), "gap");
});
test("a diff straddling the next id applies", () => {
  // The snapshot case: U <= lastUpdateId + 1 <= u
  assert.equal(classifyDiff(1000, 995, 1005), "apply");
  assert.equal(classifyDiff(1000, 1001, 1001), "apply");
});
test("off-by-one at the boundary is not a gap", () => {
  assert.equal(classifyDiff(1000, 1001, 1004), "apply");
});

console.log("\norder book");
test("snapshot sorts bids descending and asks ascending", () => {
  const b = new OrderBook();
  b.applySnapshot(
    [["100.0", "2"], ["99.0", "3"], ["101.0", "1"]],
    [["102.0", "4"], ["103.0", "1"]],
    10,
  );
  const { bids, asks } = b.top(10);
  assert.deepEqual(bids.map((l) => l.p), [101, 100, 99]);
  assert.deepEqual(asks.map((l) => l.p), [102, 103]);
  assert.equal(b.bestBid, 101);
  assert.equal(b.bestAsk, 102);
  assert.equal(b.mid, 101.5);
});
test("a zero size deletes the level instead of storing it", () => {
  const b = new OrderBook();
  b.applySnapshot([["100", "2"], ["99", "3"]], [["101", "1"]], 10);
  b.applyDiff([["100", "0"]], [], 11, Date.now());
  const { bids } = b.top(10);
  assert.deepEqual(bids.map((l) => l.p), [99]);
  assert.equal(b.lastUpdateId, 11);
});
test("a diff replaces size rather than accumulating it", () => {
  const b = new OrderBook();
  b.applySnapshot([["100", "2"]], [["101", "1"]], 10);
  b.applyDiff([["100", "5"]], [], 11, Date.now());
  assert.equal(b.top(1).bids[0].s, 5);
});
test("imbalance is signed toward the heavier side", () => {
  const b = new OrderBook();
  b.applySnapshot([["100", "30"]], [["101", "10"]], 1);
  assert.ok(b.imbalance(5) > 0.49 && b.imbalance(5) < 0.51);
});
test("clear leaves the book unsynced", () => {
  const b = new OrderBook();
  b.applySnapshot([["100", "1"]], [["101", "1"]], 5);
  assert.equal(b.synced, true);
  b.clear();
  assert.equal(b.synced, false);
  assert.equal(b.depth, 0);
});
test("coinbase-style updates route to the correct side", () => {
  const b = new OrderBook();
  b.applySnapshot([["100", "1"]], [["101", "1"]], 1);
  b.applyL2Update([["buy", "99", "7"], ["sell", "102", "3"]], Date.now());
  assert.equal(b.top(5).bids.length, 2);
  assert.equal(b.top(5).asks.length, 2);
  assert.equal(b.top(5).bids[1].s, 7);
});

console.log("\ncandle store");
const bar = (t: number, c: number): Candle => ({ t, o: c, h: c, l: c, c, v: 1, closed: true });

test("upsert replaces the forming bar and appends new ones", () => {
  const s = new CandleStore(10);
  s.seed("1m", [bar(60_000, 10), bar(120_000, 11)]);
  s.upsert("1m", { ...bar(120_000, 15), closed: false });
  assert.equal(s.get("1m").length, 2);
  assert.equal(s.get("1m")[1].c, 15);
  s.upsert("1m", bar(180_000, 16));
  assert.equal(s.get("1m").length, 3);
});
test("a late bar does not rewrite history", () => {
  const s = new CandleStore(10);
  s.seed("1m", [bar(60_000, 10), bar(120_000, 11)]);
  s.upsert("1m", bar(60_000, 99));
  assert.equal(s.get("1m")[0].c, 10);
  assert.equal(s.get("1m").length, 2);
});
test("maxBars is enforced from the front", () => {
  const s = new CandleStore(3);
  for (let i = 1; i <= 6; i++) s.upsert("1m", bar(i * 60_000, i));
  const arr = s.get("1m");
  assert.equal(arr.length, 3);
  assert.deepEqual(arr.map((b) => b.c), [4, 5, 6]);
});
test("trades fold into the correct bucket across intervals", () => {
  const s = new CandleStore(50);
  const base = 1_700_000_000_000;
  s.addTrade(100, 1, base);
  s.addTrade(105, 2, base + 500); // same 1s bucket
  s.addTrade(95, 1, base + 1_500); // next 1s bucket, same 1m bucket
  const oneSec = s.get("1s");
  const oneMin = s.get("1m");
  assert.equal(oneSec.length, 2);
  assert.equal(oneSec[0].h, 105);
  assert.equal(oneSec[0].v, 3);
  assert.equal(oneMin.length, 1);
  assert.equal(oneMin[0].h, 105);
  assert.equal(oneMin[0].l, 95);
  assert.equal(oneMin[0].v, 4);
});
test("version advances on every mutation", () => {
  const s = new CandleStore(10);
  const v0 = s.version;
  s.addTrade(1, 1, Date.now());
  assert.ok(s.version > v0);
});

console.log("\nindicators");
test("ema converges to a constant series", () => {
  const out = ema(new Array(100).fill(42), 9);
  assert.ok(Math.abs(out[99] - 42) < 1e-9);
});
test("rsi is 100 on a strictly rising series", () => {
  const vals = Array.from({ length: 60 }, (_, i) => 100 + i);
  const out = rsi(vals, 14);
  assert.ok(out[59] > 99.9);
});
test("rsi is 0 on a strictly falling series", () => {
  const vals = Array.from({ length: 60 }, (_, i) => 200 - i);
  const out = rsi(vals, 14);
  assert.ok(out[59] < 0.1);
});
test("rsi on a flat series is neutral, not undefined", () => {
  const out = rsi(new Array(60).fill(100), 14);
  assert.equal(out[59], 50);
});
test("bollinger bands collapse onto the mean with zero variance", () => {
  const { m, up, lo } = bollinger(new Array(40).fill(10), 20, 2);
  assert.ok(Math.abs(up[39] - m[39]) < 1e-9);
  assert.ok(Math.abs(lo[39] - m[39]) < 1e-9);
});
test("bollinger leaves the warm-up period undefined", () => {
  const { up } = bollinger(Array.from({ length: 40 }, (_, i) => i), 20, 2);
  assert.ok(Number.isNaN(up[18]));
  assert.ok(Number.isFinite(up[19]));
});
test("vwap weights by volume, not by bar count", () => {
  const bars: Candle[] = [
    { t: 0, o: 10, h: 10, l: 10, c: 10, v: 1, closed: true },
    { t: 1, o: 20, h: 20, l: 20, c: 20, v: 99, closed: true },
  ];
  const out = vwap(bars);
  assert.ok(out[1] > 19.8, `expected ~19.9, got ${out[1]}`);
});

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}\n`);
