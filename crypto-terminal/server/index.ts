/**
 * Local market-data proxy.
 *
 * Why this exists rather than calling the exchange from the browser:
 *
 *  - Rate-limit ownership. Depth snapshots are expensive (weight 50 at
 *    limit=1000) and every browser tab would otherwise spend from the same IP
 *    budget with no coordination. One process holding the bucket is the only
 *    way to stay under the ceiling deterministically.
 *  - Caching. exchangeInfo changes a few times a year; klines for a closed bar
 *    never change. Serving those from memory removes most upstream traffic.
 *  - Reachability. Exchange REST hosts are geo-restricted in several
 *    jurisdictions and CORS policy is theirs to change. A proxy makes the host
 *    a config value instead of a code change.
 *
 * No API keys are involved: every endpoint below is public market data.
 */
import http from "node:http";
import { WeightLimiter, ResponseCache } from "./limiter.js";

const PORT = Number(process.env.API_PORT ?? 8787);
const BINANCE_REST = process.env.BINANCE_REST ?? "https://api.binance.com";
const COINBASE_REST = process.env.COINBASE_REST ?? "https://api.exchange.coinbase.com";
const WEIGHT_PER_MIN = Number(process.env.BINANCE_WEIGHT_PER_MIN ?? 4800);

const limiter = new WeightLimiter(WEIGHT_PER_MIN);
const cache = new ResponseCache();
setInterval(() => cache.sweep(), 60_000).unref();

/** Published weights for the endpoints used here. Verify against exchangeInfo. */
function depthWeight(limit: number): number {
  if (limit <= 100) return 5;
  if (limit <= 500) return 25;
  if (limit <= 1000) return 50;
  return 250;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
  }
}

async function upstream(url: string, weight: number): Promise<string> {
  await limiter.take(weight);
  const res = await fetch(url, {
    headers: { "User-Agent": "crypto-terminal/1.0" },
    signal: AbortSignal.timeout(10_000),
  });

  const used = Number(res.headers.get("x-mbx-used-weight-1m"));
  if (Number.isFinite(used) && used > 0) limiter.observeUsed(used);

  if (res.status === 429 || res.status === 418) {
    const retry = Number(res.headers.get("retry-after") ?? 60);
    limiter.banFor(retry);
    throw new HttpError(429, "upstream rate limited", retry);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, `upstream ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.text();
}

function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const routes: Record<string, (u: URL) => Promise<string>> = {
  /** Symbol metadata: tick size, lot step, display precision. */
  "/api/exchangeInfo": async (u) => {
    const symbol = (u.searchParams.get("symbol") ?? "").toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) throw new HttpError(400, "bad symbol");
    return cache.get(`ei:${symbol}`, 6 * 3600_000, () =>
      upstream(`${BINANCE_REST}/api/v3/exchangeInfo?symbol=${symbol}`, 20),
    );
  },

  /** Historical bars used to seed the chart before the socket takes over. */
  "/api/klines": async (u) => {
    const symbol = (u.searchParams.get("symbol") ?? "").toUpperCase();
    const interval = u.searchParams.get("interval") ?? "1m";
    const limit = Math.min(1000, Math.max(1, num(u.searchParams.get("limit"), 500)));
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) throw new HttpError(400, "bad symbol");
    if (!/^(1s|[1-9][0-9]?[mhdwM])$/.test(interval)) throw new HttpError(400, "bad interval");
    // A closed bar is immutable; the only volatile part is the forming one.
    const ttl = interval === "1s" ? 900 : 4_000;
    return cache.get(`k:${symbol}:${interval}:${limit}`, ttl, () =>
      upstream(`${BINANCE_REST}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, 2),
    );
  },

  /**
   * Order book snapshot. Never cached: the client pairs it with a buffered
   * diff stream by `lastUpdateId`, and a stale snapshot desynchronises the book.
   */
  "/api/depth": async (u) => {
    const symbol = (u.searchParams.get("symbol") ?? "").toUpperCase();
    const limit = Math.min(5000, Math.max(5, num(u.searchParams.get("limit"), 1000)));
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) throw new HttpError(400, "bad symbol");
    return upstream(`${BINANCE_REST}/api/v3/depth?symbol=${symbol}&limit=${limit}`, depthWeight(limit));
  },

  /** Coinbase Exchange candles, for the Coinbase adapter's chart seed. */
  "/api/coinbase/candles": async (u) => {
    const product = (u.searchParams.get("product") ?? "").toUpperCase();
    const granularity = num(u.searchParams.get("granularity"), 60);
    if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/.test(product)) throw new HttpError(400, "bad product");
    if (![60, 300, 900, 3600, 21600, 86400].includes(granularity)) throw new HttpError(400, "bad granularity");
    return cache.get(`cb:${product}:${granularity}`, 4_000, async () => {
      const res = await fetch(`${COINBASE_REST}/products/${product}/candles?granularity=${granularity}`, {
        headers: { "User-Agent": "crypto-terminal/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new HttpError(res.status, `coinbase ${res.status}`);
      return res.text();
    });
  },

  "/api/health": async () =>
    JSON.stringify({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      rateLimit: limiter.state,
      cache: cache.stats,
      upstream: { binance: BINANCE_REST, coinbase: COINBASE_REST },
    }),
};

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET,OPTIONS" });
    return res.end();
  }
  if (req.method !== "GET") {
    res.writeHead(405).end("method not allowed");
    return;
  }

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const route = routes[url.pathname];
  if (!route) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "not found", path: url.pathname }));
  }

  const started = performance.now();
  try {
    const body = await route(url);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-Proxy-Ms": (performance.now() - started).toFixed(1),
    });
    res.end(body);
  } catch (err) {
    const e = err as HttpError & { retryAfter?: number };
    const status = typeof e.status === "number" ? e.status : 502;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (e.retryAfter) headers["Retry-After"] = String(e.retryAfter);
    res.writeHead(status, headers);
    res.end(JSON.stringify({ error: e.message ?? "proxy error" }));
    if (status >= 500) console.error(`[proxy] ${url.pathname} -> ${status}: ${e.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`[proxy] listening on http://127.0.0.1:${PORT}`);
  console.log(`[proxy] binance=${BINANCE_REST} budget=${WEIGHT_PER_MIN} weight/min`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[proxy] ${sig} — closing`);
    server.close(() => process.exit(0));
  });
}
