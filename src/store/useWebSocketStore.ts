/**
 * useTickerStream — Zustand + WebSocket live ticker feed (Binance public stream)
 *
 * Requires: react >= 18, zustand >= 4.5 (works on v5)
 *
 * Design notes
 *  - One shared socket per app, ref-counted by symbol. Ten components asking for
 *    BTCUSDT produce one subscription, not ten sockets.
 *  - Messages land in a plain Map outside React and are flushed into the store on
 *    a throttled tick (~8 fps). Binance pushes ~1 msg/sec/symbol, and bursts far
 *    faster on volatile pairs; without batching every message is a render.
 *  - Only changed symbols get new object identities on flush, so
 *    `useTicker('ETHUSDT')` does not re-render when BTC moves.
 *  - Reconnects with exponential backoff + jitter, resubscribes on open, and a
 *    watchdog force-closes a socket that has gone quiet (half-open TCP, laptop
 *    resume from sleep, Binance's 24h server-side disconnect).
 *
 * Usage
 *
 *   function Board() {
 *     const { tickers, status } = useTickerStream(['BTCUSDT', 'ETHUSDT']);
 *     return (
 *       <>
 *         <span>{status}</span>
 *         {tickers.map(t => <Row key={t.symbol} symbol={t.symbol} />)}
 *       </>
 *     );
 *   }
 *
 *   // Leaf components subscribe to a single symbol for minimal re-renders.
 *   function Row({ symbol }: { symbol: string }) {
 *     const t = useTicker(symbol);
 *     return <div>{symbol} {t?.price} ({t?.changePct}%)</div>;
 *   }
 */

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

/* ------------------------------------------------------------------ config */

const WS_ENDPOINT = 'wss://stream.binance.com:9443/ws';

/** Max store commit rate. 120ms ≈ 8 fps: below perceptual threshold for numbers. */
const THROTTLE_MS = 120;
/** No message for this long while subscribed ⇒ assume the socket is dead. */
const STALE_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_MS = 5_000;
const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;
/** Connection must survive this long before the backoff counter resets. */
const STABLE_AFTER_MS = 10_000;
/** Delay before acting on a release — absorbs StrictMode double-mount. */
const RELEASE_GRACE_MS = 5_000;

/* ------------------------------------------------------------------- types */

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

export interface Ticker {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  /** Base asset volume over the rolling 24h window. */
  volume: number;
  quoteVolume: number;
  eventTime: number;
}

interface RawTickerEvent {
  e?: string;
  E?: number;
  s?: string;
  c?: string;
  P?: string;
  h?: string;
  l?: string;
  v?: string;
  q?: string;
}

/* ------------------------------------------------------------------- store */

interface TickerStore {
  status: ConnectionStatus;
  tickers: Record<string, Ticker>;
  error: string | null;
  reconnectAttempt: number;
  lastMessageAt: number | null;
  /** @internal */ _setStatus: (s: ConnectionStatus, attempt?: number) => void;
  /** @internal */ _setError: (e: string | null) => void;
  /** @internal */ _commit: (batch: Map<string, Ticker>) => void;
  /** @internal */ _drop: (symbol: string) => void;
}

export const useTickerStore = create<TickerStore>()((set) => ({
  status: 'idle',
  tickers: {},
  error: null,
  reconnectAttempt: 0,
  lastMessageAt: null,

  _setStatus: (status, attempt) =>
    set((state) =>
      state.status === status && attempt === undefined
        ? state
        : { status, reconnectAttempt: attempt ?? state.reconnectAttempt },
    ),

  _setError: (error) => set((state) => (state.error === error ? state : { error })),

  _commit: (batch) =>
    set((state) => {
      if (batch.size === 0) return state; // identical reference ⇒ no notify
      // Fresh top-level object, but untouched symbols keep their identity so
      // per-symbol selectors stay stable.
      const tickers = { ...state.tickers };
      batch.forEach((ticker, symbol) => {
        tickers[symbol] = ticker;
      });
      return { tickers, lastMessageAt: Date.now() };
    }),

  _drop: (symbol) =>
    set((state) => {
      if (!(symbol in state.tickers)) return state;
      const { [symbol]: _removed, ...rest } = state.tickers;
      return { tickers: rest };
    }),
}));

/* ------------------------------------------------------------------ parsing */

const streamName = (symbol: string) => `${symbol.toLowerCase()}@ticker`;

function parseTicker(raw: RawTickerEvent): Ticker | null {
  if (raw?.e !== '24hrTicker' || typeof raw.s !== 'string') return null;
  const price = Number(raw.c);
  if (!Number.isFinite(price)) return null;
  return {
    symbol: raw.s,
    price,
    changePct: Number(raw.P) || 0,
    high: Number(raw.h) || 0,
    low: Number(raw.l) || 0,
    volume: Number(raw.v) || 0,
    quoteVolume: Number(raw.q) || 0,
    eventTime: raw.E ?? Date.now(),
  };
}

/* ------------------------------------------------- connection manager (singleton) */

type Timer = ReturnType<typeof setTimeout>;

class TickerSocket {
  private ws: WebSocket | null = null;
  private buffer = new Map<string, Ticker>();
  private refCounts = new Map<string, number>();
  private pendingRelease = new Map<string, Timer>();

  private flushTimer: Timer | null = null;
  private rafId: number | null = null;
  private reconnectTimer: Timer | null = null;
  private stableTimer: Timer | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  private attempt = 0;
  private msgId = 1;
  private lastMessageAt = 0;
  private intentionalClose = false;
  private listenersBound = false;

  /* ------------------------------- public API ------------------------------- */

  acquire(symbols: string[]): void {
    const fresh: string[] = [];

    for (const symbol of symbols) {
      const pending = this.pendingRelease.get(symbol);
      if (pending) {
        clearTimeout(pending);
        this.pendingRelease.delete(symbol);
      }
      const next = (this.refCounts.get(symbol) ?? 0) + 1;
      this.refCounts.set(symbol, next);
      if (next === 1) fresh.push(symbol);
    }

    this.connect();
    if (fresh.length > 0 && this.isOpen()) this.subscribe(fresh);
  }

  release(symbols: string[]): void {
    for (const symbol of symbols) {
      const next = (this.refCounts.get(symbol) ?? 0) - 1;
      if (next > 0) {
        this.refCounts.set(symbol, next);
        continue;
      }
      this.refCounts.delete(symbol);
      if (this.pendingRelease.has(symbol)) continue;

      this.pendingRelease.set(
        symbol,
        setTimeout(() => {
          this.pendingRelease.delete(symbol);
          if (this.refCounts.has(symbol)) return; // re-acquired during grace
          if (this.isOpen()) this.unsubscribe([symbol]);
          this.buffer.delete(symbol);
          useTickerStore.getState()._drop(symbol);
          if (this.refCounts.size === 0) this.disconnect();
        }, RELEASE_GRACE_MS),
      );
    }
  }

  /** Tear everything down — useful in tests or on logout. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();
    this.buffer.clear();
    this.ws?.close(1000, 'client shutdown');
    this.ws = null;
    this.attempt = 0;
    useTickerStore.getState()._setStatus('closed', 0);
  }

  /* ------------------------------ connection ------------------------------- */

  private connect(): void {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return; // SSR
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.intentionalClose = false;
    this.bindNetworkListeners();
    useTickerStore
      .getState()
      ._setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', this.attempt);

    try {
      const ws = new WebSocket(WS_ENDPOINT);
      this.ws = ws;
      ws.onopen = () => this.handleOpen();
      ws.onmessage = (event) => this.handleMessage(event);
      ws.onerror = () => useTickerStore.getState()._setError('WebSocket error');
      ws.onclose = (event) => this.handleClose(event);
    } catch (err) {
      useTickerStore.getState()._setError(err instanceof Error ? err.message : 'Connection failed');
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    this.lastMessageAt = Date.now();
    useTickerStore.getState()._setError(null);
    useTickerStore.getState()._setStatus('open', this.attempt);

    const active = [...this.refCounts.keys()];
    if (active.length > 0) this.subscribe(active);
    else this.disconnect();

    // Only treat the connection as healthy once it has held for a while,
    // otherwise an accept-then-drop server turns backoff into a hot loop.
    this.stableTimer = setTimeout(() => {
      this.attempt = 0;
      useTickerStore.getState()._setStatus('open', 0);
    }, STABLE_AFTER_MS);

    this.startHealthCheck();
  }

  private handleMessage(event: MessageEvent): void {
    this.lastMessageAt = Date.now();

    let payload: unknown;
    try {
      payload = JSON.parse(event.data as string);
    } catch {
      return;
    }

    // /ws delivers raw events; combined-stream endpoints wrap them in { data }.
    const raw = (payload as { data?: RawTickerEvent })?.data ?? (payload as RawTickerEvent);
    const ticker = parseTicker(raw);
    if (!ticker) return; // subscription acks, pongs, unknown events

    this.buffer.set(ticker.symbol, ticker); // newest wins per symbol
    this.scheduleFlush();
  }

  private handleClose(event: CloseEvent): void {
    this.stopHealthCheck();
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    this.ws = null;
    if (this.intentionalClose || this.refCounts.size === 0) {
      useTickerStore.getState()._setStatus('closed');
      return;
    }
    if (event.code !== 1000) {
      useTickerStore.getState()._setError(`Socket closed (${event.code})`);
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.refCounts.size === 0) return;

    const exponential = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * 2 ** this.attempt);
    const delay = exponential * (0.5 + Math.random() * 0.5); // full-ish jitter
    this.attempt += 1;
    useTickerStore.getState()._setStatus('reconnecting', this.attempt);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /* ------------------------------ throttling ------------------------------- */

  private scheduleFlush(): void {
    if (this.flushTimer) return; // a flush is already pending; coalesce into it
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      // Align the commit with paint when the tab is visible; fall back to an
      // immediate flush when hidden (rAF never fires in a background tab).
      if (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible') {
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          this.flush();
        });
      } else {
        this.flush();
      }
    }, THROTTLE_MS);
  }

  private flush(): void {
    if (this.buffer.size === 0) return;
    useTickerStore.getState()._commit(this.buffer);
    this.buffer.clear();
  }

  /* -------------------------------- plumbing -------------------------------- */

  private isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.isOpen()) return;
    this.ws!.send(JSON.stringify(payload));
  }

  private subscribe(symbols: string[]): void {
    this.send({ method: 'SUBSCRIBE', params: symbols.map(streamName), id: this.msgId++ });
  }

  private unsubscribe(symbols: string[]): void {
    this.send({ method: 'UNSUBSCRIBE', params: symbols.map(streamName), id: this.msgId++ });
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthTimer = setInterval(() => {
      if (this.refCounts.size === 0 || !this.isOpen()) return;
      if (Date.now() - this.lastMessageAt > STALE_TIMEOUT_MS) {
        // Half-open socket: readyState still says OPEN but nothing is arriving.
        useTickerStore.getState()._setError('Stream stalled — reconnecting');
        this.ws?.close(4000, 'stale');
      }
    }, HEALTH_CHECK_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private bindNetworkListeners(): void {
    if (this.listenersBound || typeof window === 'undefined') return;
    this.listenersBound = true;

    window.addEventListener('online', () => {
      if (this.refCounts.size === 0) return;
      this.attempt = 0; // network is back; don't sit out a long backoff
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.connect();
    });

    window.addEventListener('offline', () => {
      if (this.refCounts.size > 0) useTickerStore.getState()._setStatus('reconnecting');
    });
  }

  private clearTimers(): void {
    this.stopHealthCheck();
    for (const timer of [this.flushTimer, this.reconnectTimer, this.stableTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.flushTimer = null;
    this.reconnectTimer = null;
    this.stableTimer = null;
    this.pendingRelease.forEach(clearTimeout);
    this.pendingRelease.clear();
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

const socket = new TickerSocket();

/* ------------------------------------------------------------------- hooks */

export interface UseTickerStreamResult {
  tickers: Ticker[];
  status: ConnectionStatus;
  error: string | null;
  reconnectAttempt: number;
  isConnected: boolean;
}

/**
 * Subscribe to live 24h ticker data for a set of symbols.
 * Pass symbols in any case: 'btcusdt' and 'BTCUSDT' are the same subscription.
 */
export function useTickerStream(symbols: string[]): UseTickerStreamResult {
  // Order- and identity-independent key so a new array literal each render
  // doesn't resubscribe.
  const key = symbols
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(',');

  const normalized = useMemo(() => (key ? key.split(',') : []), [key]);

  useEffect(() => {
    if (normalized.length === 0) return;
    socket.acquire(normalized);
    return () => socket.release(normalized);
  }, [normalized]);

  const tickers = useTickerStore(
    useShallow((state) =>
      normalized.map((symbol) => state.tickers[symbol]).filter(Boolean) as Ticker[],
    ),
  );

  const status = useTickerStore((s) => s.status);
  const error = useTickerStore((s) => s.error);
  const reconnectAttempt = useTickerStore((s) => s.reconnectAttempt);

  return { tickers, status, error, reconnectAttempt, isConnected: status === 'open' };
}

/** Single-symbol selector. Re-renders only when that symbol's data changes. */
export function useTicker(symbol: string): Ticker | undefined {
  const upper = symbol.toUpperCase();
  return useTickerStore((s) => s.tickers[upper]);
}

export function useConnectionStatus(): ConnectionStatus {
  return useTickerStore((s) => s.status);
}

/** Escape hatch for tests and teardown. */
export const tickerSocket = {
  disconnect: () => socket.disconnect(),
};