# TERMINAL

A real-time crypto market microstructure workstation. Live L2 order book, cumulative
depth, and canvas-rendered candles over exchange WebSockets, with a local proxy that
owns the REST rate-limit budget.

Two live venues and one offline simulator, behind a single adapter interface.

```
npm install
cp .env.example .env
npm run dev          # proxy on :8787, app on http://localhost:5173
```

If Binance is unreachable from your location, switch the venue selector in the top
bar to **Coinbase** or **Sim** — or point `BINANCE_REST` / `BINANCE_WS` at
`binance.us` in `.env`.

---

## What runs where

```
┌─ browser ─────────────────────────────────────────────────────────────┐
│                                                                       │
│   FeedAdapter ──writes──▶ MarketStore ──reads──▶ canvas renderer      │
│   (Binance /                │   OrderBook              (60fps rAF)     │
│    Coinbase /               │   CandleStore                            │
│    Sim)                     │   tape                                   │
│        │                    └──reads──▶ DOM panels (~9Hz sampling)     │
│        │                                                               │
│        ├── WebSocket ──────────────────────────▶ exchange stream       │
│        └── fetch /api/* ──┐                                            │
└───────────────────────────┼───────────────────────────────────────────┘
                            ▼
                  ┌─ node proxy :8787 ─────────┐
                  │  weight-aware token bucket │──▶ exchange REST
                  │  TTL cache + single-flight │
                  └────────────────────────────┘
```

The browser never calls an exchange REST endpoint directly. It does talk to the
exchange WebSocket directly, because market data streams are unauthenticated,
unmetered, and adding a hop would only add latency.

---

## Order book synchronisation

The part most worth reading. A depth *diff* stream means nothing without a snapshot,
and the two arrive over different transports with no shared ordering — sequence
numbers do the reconciling.

**Binance** (`src/feed/BinanceFeed.ts`):

1. Open `<symbol>@depth@100ms` and buffer every event. Do not apply anything yet.
2. `GET /api/v3/depth?limit=1000` for a snapshot carrying `lastUpdateId`.
3. Discard buffered events whose final id `u <= lastUpdateId` — the snapshot already
   contains them.
4. The first surviving event must straddle `lastUpdateId + 1`. If it starts after
   that, the snapshot predates the buffer, there is a hole between them, and the only
   fix is a newer snapshot.
5. Replay the rest, requiring each event to be contiguous with the last.
6. Stay live, applying diffs and checking continuity on every one.

Any gap means the local book has silently diverged from the venue's, so it is
discarded and rebuilt. **Tolerating a gap is the most common bug in home-grown book
builders** — nothing looks broken, the book just quietly drifts from reality.

The rule lives in one pure function, `classifyDiff`, used by both the live path and
the buffer replay, and covered by the tests:

```ts
classifyDiff(lastUpdateId, firstId, finalId) // -> "apply" | "skip" | "gap"
```

Resyncs back off exponentially with jitter. A depth snapshot costs 50 weight, so a
resync storm is a fast route to a rate-limit ban, which costs far more than a few
seconds of stale book.

**Coinbase** (`src/feed/CoinbaseFeed.ts`) is the useful counterexample: `level2_batch`
delivers a `snapshot` then `l2update` over the same socket, so there is no
reconciliation and no sequence arithmetic. Reconnect simply replaces the book.

Two other Coinbase traps the adapter handles, both of which silently produce
plausible-looking wrong output:

- REST candle rows are `[time, low, high, open, close, volume]`, newest first, with
  time in **seconds**.
- `match.side` is the **maker's** side, so an aggressive buy is reported as a sell.
  Getting this backwards inverts the entire tape.

---

## Why a proxy for REST but not for WebSocket

| | reason |
|---|---|
| **Rate-limit ownership** | Weight is charged per IP. Every tab would otherwise spend from the same budget with no coordination. One process holding the bucket is the only way to stay under the ceiling deterministically. |
| **Caching** | `exchangeInfo` changes a few times a year; a closed kline never changes. Serving those from memory removes most upstream traffic. |
| **Reachability** | Exchange REST hosts are geo-restricted in several jurisdictions and CORS policy is theirs to change. A proxy makes the host a config value instead of a code change. |

The limiter reconciles its local bucket against the exchange's own
`x-mbx-used-weight-1m` header on every response, trusting the server's number when it
is higher — it includes weight this process did not spend. A `429` or `418` sets a
hard cooldown from `Retry-After`; requests during cooldown fail fast rather than
queueing, because ignoring that header is how an IP gets banned.

`GET /api/health` reports live bucket state, cache hit ratio, and in-flight requests.

No API keys anywhere. Every endpoint used is public market data.

---

## Performance

The two loops are deliberately decoupled:

- **Feed → store** runs at message rate. State is mutated in place behind a version
  counter, not reallocated. At ten book updates a second plus trade prints, allocating
  a fresh state object per message would put the feed on the GC's critical path.
- **Store → canvas** runs at frame rate inside `requestAnimationFrame`, reading the
  store directly. No React state is involved, so pointer interaction stays smooth
  regardless of how busy the feed is.
- **Store → DOM** samples at ~9Hz. Past that, text stops being readable anyway.

Other things that matter under load:

- The book is two `Map`s with a lazily-rebuilt sorted view. Writes are O(1); the sort
  happens at most once per read-after-write, so a burst of diffs costs one sort
  instead of one per update.
- Indicators are memoised on `(symbol, interval, series version, overlay set)`.
  Bollinger is O(bars × period) and would otherwise dominate the frame budget at 60fps.
- Canvas backing stores are capped at 2× DPR. Uncapped 3× means 9× the fill rate for
  a difference nobody can see on a 1px hairline.
- Depth diffs arriving mid-resync go to a bounded buffer. Overflow drops the oldest
  and increments a counter; the sequence check catches the resulting hole on replay
  rather than applying a corrupt book.

`MSG/S`, `LAG`, `FPS`, `RESYNC`, and `RECONN` are all live in the top bar. Watch
`RESYNC` — a number that climbs means the connection is losing frames.

`LAG` is `now() - venue event time`, so it includes client clock skew. Treat it as an
indicator rather than a measurement; a sudden jump still reliably means the feed is
falling behind.

---

## Reconnection

`ReconnectingSocket` handles the failure modes a long-lived feed actually hits:

- **Full-jitter exponential backoff.** Synchronised retries across many clients turn a
  brief exchange blip into a thundering herd.
- **Staleness watchdog.** A TCP connection can stay open long after data stops flowing
  — silent NAT timeout, suspended laptop. `readyState` still reads `OPEN`, so message
  arrival is the only reliable liveness signal.
- **Intentional-close flag**, so switching symbols doesn't trigger a reconnect.

Every reconnect invalidates the book. Diffs missed while the socket was down cannot be
recovered, so the book is cleared and resynced from a fresh snapshot.

---

## Adding a venue

Extend `BaseFeed`, write into the `MarketStore`, register in `src/feed/index.ts`.
Nothing in the renderer or the panels changes.

```ts
export class KrakenFeed extends BaseFeed {
  readonly venue = "Kraken";
  readonly instruments = KRAKEN_INSTRUMENTS;
  async connect(symbol: string) { /* seed history, open socket */ }
  async switchSymbol(symbol: string) { /* ... */ }
  disconnect() { /* ... */ }
}
```

Lifecycle events go through `onStatus`; hot market data goes straight into the store.
Emitting an event object per depth update would allocate for no benefit — nothing
downstream reads a *message*, only the resulting state.

---

## Verify

```
npm run verify      # 22 logic checks — sequence rules, book, candles, indicators
npm run typecheck   # strict tsc, zero errors
npm run build       # production bundle
```

The tests target the places where a bug is silent rather than loud: sequence
boundaries, zero-size deletes, late bars, bucket alignment, and indicator edge cases
like RSI on a series that has never ticked down.

---

## Controls

| | |
|---|---|
| `1`–`4` | interval (1s / 1m / 5m / 15m) |
| `E` / `B` / `V` | EMA, Bollinger, anchored VWAP |
| `R` | reset view |
| scroll | zoom · drag pans · double-click resets |

---

## Scope

Deliberately not included: order entry, positions, P&L, authentication, and any
persistence. This reads market data and draws it. Adding a trading path means API key
custody, signed requests, and an execution state machine — a different project with a
different risk profile, and not one to bolt onto a viewer.

Also worth knowing:

- **AVWAP, not session VWAP.** Crypto has no session boundary, so the anchor is the
  first loaded bar. Values are comparable only within one chart load.
- **Coinbase 1s bars start empty.** Its REST API offers 1m and coarser, so the 1s
  series builds from live trades rather than backfilling.
- **Rate-limit weights are hardcoded** in `server/index.ts` from published figures.
  Exchanges revise them. `GET /api/v3/exchangeInfo` returns the authoritative
  `rateLimits` block — check it against `BINANCE_WEIGHT_PER_MIN` before running this
  anywhere that matters.
- **Session high/low/volume** are computed over the loaded 1m window, not a true
  24h rolling window from the venue's ticker.
