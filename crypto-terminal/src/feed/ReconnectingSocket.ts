/**
 * WebSocket wrapper with the failure handling a live feed actually needs.
 *
 *  - Exponential backoff with full jitter. Synchronised retries across many
 *    clients are what turn a brief exchange blip into a thundering herd.
 *  - Staleness watchdog. A TCP connection can stay open long after data stops
 *    flowing (silent NAT timeout, suspended laptop). `readyState` still reads
 *    OPEN, so the only reliable liveness signal is message arrival.
 *  - Intentional-close flag, so `disconnect()` does not trigger a reconnect.
 *
 * Binance closes idle connections after 24h and pings every ~3 minutes; the
 * browser answers pings automatically, and the watchdog covers the rest.
 */
export interface SocketHandlers {
  onOpen: () => void;
  onMessage: (data: unknown) => void;
  onDown: (reason: string) => void;
}

export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private closedByUs = false;
  private watchdog: number | null = null;
  private retryTimer: number | null = null;
  private lastMessageAt = 0;
  reconnects = 0;

  constructor(
    private url: string,
    private handlers: SocketHandlers,
    private staleMs = 20_000,
  ) {}

  open(): void {
    this.closedByUs = false;
    this.spawn();
  }

  private spawn(): void {
    this.cleanupSocket();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.scheduleRetry(`construct failed: ${String(err)}`);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.startWatchdog();
      this.handlers.onOpen();
    };

    ws.onmessage = (ev: MessageEvent) => {
      this.lastMessageAt = Date.now();
      try {
        this.handlers.onMessage(JSON.parse(ev.data as string));
      } catch {
        /* A malformed frame is not worth dropping the connection over. */
      }
    };

    ws.onerror = () => {
      /* `error` carries no detail in browsers; `close` always follows. */
    };

    ws.onclose = (ev: CloseEvent) => {
      if (this.closedByUs) return;
      this.scheduleRetry(`socket closed (${ev.code})`);
    };
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdog = window.setInterval(() => {
      if (Date.now() - this.lastMessageAt > this.staleMs) {
        this.scheduleRetry("no data — connection went silent");
      }
    }, 5_000);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private scheduleRetry(reason: string): void {
    if (this.closedByUs || this.retryTimer !== null) return;
    this.stopWatchdog();
    this.cleanupSocket();
    this.handlers.onDown(reason);

    const ceiling = Math.min(30_000, 500 * 2 ** this.attempt);
    const delay = Math.random() * ceiling; // full jitter
    this.attempt++;
    this.reconnects++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (!this.closedByUs) this.spawn();
    }, delay);
  }

  private cleanupSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    this.ws = null;
  }

  send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  close(): void {
    this.closedByUs = true;
    this.stopWatchdog();
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.cleanupSocket();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
