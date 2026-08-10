/**
 * Weight-aware token bucket for exchange REST budgets.
 *
 * Binance charges a *weight* per endpoint (GET /depth?limit=1000 is far more
 * expensive than /exchangeInfo) and enforces the ceiling per IP over a rolling
 * minute. Two mechanisms guard it here:
 *
 *   1. Local bucket — refills continuously so bursts cannot outrun the budget.
 *   2. Server feedback — every response carries `x-mbx-used-weight-1m`. That is
 *      the authoritative number (it includes weight this process did not spend,
 *      e.g. another app on the same IP), so we trust it over our own accounting
 *      whenever it is higher.
 *
 * A 429 or 418 sets a hard cooldown from `Retry-After`. Ignoring that is how an
 * IP gets banned, so requests during cooldown fail fast instead of queueing.
 */
export class WeightLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private cooldownUntil = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly perMinute: number) {
    this.tokens = perMinute;
  }

  private refill(): void {
    const now = Date.now();
    const gained = ((now - this.lastRefill) / 60_000) * this.perMinute;
    if (gained > 0) {
      this.tokens = Math.min(this.perMinute, this.tokens + gained);
      this.lastRefill = now;
    }
  }

  /** Blocks until `weight` is affordable. Throws immediately during a ban cooldown. */
  async take(weight: number): Promise<void> {
    if (Date.now() < this.cooldownUntil) {
      const wait = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
      throw Object.assign(new Error(`upstream rate limit cooldown, retry in ${wait}s`), {
        status: 429,
        retryAfter: wait,
      });
    }
    this.refill();
    if (this.tokens >= weight) {
      this.tokens -= weight;
      return;
    }
    const deficit = weight - this.tokens;
    const waitMs = Math.ceil((deficit / this.perMinute) * 60_000);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), waitMs);
      this.queue.push(() => clearTimeout(timer));
    });
    this.refill();
    this.tokens = Math.max(0, this.tokens - weight);
  }

  /** Reconcile local accounting against the exchange's own counter. */
  observeUsed(used: number): void {
    this.refill();
    const remaining = Math.max(0, this.perMinute - used);
    if (remaining < this.tokens) this.tokens = remaining;
  }

  banFor(seconds: number): void {
    this.cooldownUntil = Date.now() + seconds * 1000;
    this.tokens = 0;
  }

  get state() {
    this.refill();
    return {
      available: Math.floor(this.tokens),
      capacity: this.perMinute,
      cooldownMs: Math.max(0, this.cooldownUntil - Date.now()),
    };
  }
}

/** TTL cache with single-flight de-duplication of concurrent identical requests. */
export class ResponseCache {
  private store = new Map<string, { exp: number; body: string }>();
  private inflight = new Map<string, Promise<string>>();
  private hits = 0;
  private misses = 0;

  async get(key: string, ttlMs: number, produce: () => Promise<string>): Promise<string> {
    const hit = this.store.get(key);
    if (hit && hit.exp > Date.now()) {
      this.hits++;
      return hit.body;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    this.misses++;
    const p = produce()
      .then((body) => {
        if (ttlMs > 0) this.store.set(key, { exp: Date.now() + ttlMs, body });
        return body;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.store) if (v.exp <= now) this.store.delete(k);
  }

  get stats() {
    return { entries: this.store.size, hits: this.hits, misses: this.misses, inflight: this.inflight.size };
  }
}
