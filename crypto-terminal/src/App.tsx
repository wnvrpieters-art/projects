import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFeed, VENUES, type Venue } from "./feed";
import { MarketStore, useMarketTick } from "./store";
import { ChartPane } from "./components/ChartPane";
import { OrderBookPanel } from "./components/OrderBookPanel";
import { TapePanel } from "./components/TapePanel";
import { InstrumentList } from "./components/InstrumentList";
import type { ChartView } from "./render/chart";
import type { Overlays } from "./indicators";
import { C, fmtPx, fmtQty, hms } from "./render/theme";
import { INTERVALS, type ConnState, type Interval } from "./types";

const DEFAULT_SYMBOL: Record<Venue, string> = {
  binance: "BTCUSDT",
  coinbase: "BTC-USD",
  sim: "BTCUSD",
};

const STATUS_COLOR: Record<ConnState, string> = {
  idle: C.dim,
  connecting: C.amber,
  syncing: C.amber,
  live: C.up,
  stale: C.down,
  error: C.down,
};

export default function App() {
  const store = useMemo(() => new MarketStore(), []);
  const [venue, setVenue] = useState<Venue>("binance");
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL.binance);
  const [interval, setInterval] = useState<Interval>("1m");
  const [overlays, setOverlays] = useState<Overlays>({ ema: true, bb: false, vwap: true, sub: "RSI" });
  const [status, setStatus] = useState<ConnState>("idle");
  const [detail, setDetail] = useState("");

  const viewRef = useRef<ChartView>({ count: 90, offset: 0 });
  const perfRef = useRef({ fps: 0 });
  const depthRef = useRef<HTMLCanvasElement>(null);

  useMarketTick(9);

  const feed = useMemo(() => createFeed(venue, store), [venue, store]);

  useEffect(() => {
    const off = feed.onStatus((s, d) => {
      setStatus(s);
      setDetail(d ?? "");
    });
    const target = feed.instruments.some((i) => i.symbol === symbol) ? symbol : DEFAULT_SYMBOL[venue];
    if (target !== symbol) setSymbol(target);
    void feed.connect(target);
    return () => {
      off();
      feed.disconnect();
    };
    // Reconnecting on symbol change is handled below to avoid a full teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  const selectSymbol = useCallback(
    (next: string) => {
      if (next === symbol) return;
      setSymbol(next);
      viewRef.current = { count: 90, offset: 0 };
      void feed.switchSymbol(next);
    },
    [feed, symbol],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= INTERVALS.length) setInterval(INTERVALS[n - 1]);
      if (e.key.toLowerCase() === "r") viewRef.current = { count: 90, offset: 0 };
      if (e.key.toLowerCase() === "e") setOverlays((o) => ({ ...o, ema: !o.ema }));
      if (e.key.toLowerCase() === "b") setOverlays((o) => ({ ...o, bb: !o.bb }));
      if (e.key.toLowerCase() === "v") setOverlays((o) => ({ ...o, vwap: !o.vwap }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dp = store.instrument?.dp ?? 2;
  const session = store.candles.sessionStats();
  const change = store.last - session.open;
  const changePct = session.open > 0 ? (change / session.open) * 100 : 0;
  const bestBid = store.book.bestBid;
  const bestAsk = store.book.bestAsk;
  const imbalance = store.book.imbalance(15);
  const stats = store.stats;

  const stat = (label: string, value: string, color?: string) => (
    <div className="stat" key={label}>
      <span className="lbl">{label}</span>
      <span style={{ color: color ?? C.text }}>{value}</span>
    </div>
  );

  return (
    <div className="term">
      <div className="bar">
        <span className="brand">TERMINAL</span>
        <span className="led" style={{ background: STATUS_COLOR[status], boxShadow: `0 0 6px ${STATUS_COLOR[status]}` }} />
        <span className="lbl" style={{ color: STATUS_COLOR[status] }}>{status}</span>
        <span className="lbl ellipsis detail">{detail}</span>
        <span className="spacer" />
        <span className="venues">
          {VENUES.map((v) => (
            <button key={v.id} className={`btn${venue === v.id ? " on" : ""}`} onClick={() => setVenue(v.id)}>
              {v.label}
            </button>
          ))}
        </span>
        <span className="lbl">MSG/S <b>{stats.msgsPerSec}</b></span>
        <span className="lbl">LAG <b style={{ color: stats.latencyMs > 400 ? C.amber : C.up }}>{stats.latencyMs.toFixed(0)}ms</b></span>
        <span className="lbl">FPS <b>{perfRef.current.fps}</b></span>
        <span className="lbl">{hms(Date.now())} UTC</span>
      </div>

      <div className="hdr">
        <div className="idblock">
          <div className="symline">
            {store.instrument?.label ?? symbol} <span style={{ color: C.dim }}>{feed.venue}</span>
          </div>
          <div className="big" style={{ color: store.dir >= 0 ? C.up : C.down }}>{fmtPx(store.last, dp)}</div>
          <div style={{ color: change >= 0 ? C.up : C.down }}>
            {change >= 0 ? "+" : ""}
            {fmtPx(change, dp)} ({change >= 0 ? "+" : ""}
            {changePct.toFixed(2)}%)
          </div>
        </div>
        <div className="stats">
          {stat("BID", fmtPx(bestBid, dp), C.up)}
          {stat("ASK", fmtPx(bestAsk, dp), C.down)}
          {stat("OPEN", fmtPx(session.open, dp))}
          {stat("HIGH", fmtPx(session.high, dp), C.up)}
          {stat("LOW", fmtPx(session.low, dp), C.down)}
          {stat("VOLUME", fmtQty(session.volume))}
          {stat("BOOK", `${store.book.depth} lvl`)}
          {stat("IMBAL", `${(imbalance * 100).toFixed(1)}%`, imbalance >= 0 ? C.up : C.down)}
          {stat("RESYNC", String(stats.resyncs), stats.resyncs > 0 ? C.amber : C.dim)}
          {stat("RECONN", String(stats.reconnects), stats.reconnects > 0 ? C.amber : C.dim)}
        </div>
      </div>

      <div className="main">
        <div className="col left">
          <div className="ph">
            <span>Instruments</span>
            <span>{feed.instruments.length}</span>
          </div>
          <InstrumentList instruments={feed.instruments} selected={symbol} store={store} onSelect={selectSymbol} />
        </div>

        <div className="col">
          <div className="tools">
            {INTERVALS.map((iv) => (
              <button key={iv} className={`btn${interval === iv ? " on" : ""}`} onClick={() => setInterval(iv)}>
                {iv}
              </button>
            ))}
            <span className="sep" />
            <button className={`btn${overlays.ema ? " on" : ""}`} onClick={() => setOverlays({ ...overlays, ema: !overlays.ema })}>
              EMA 9/21
            </button>
            <button className={`btn${overlays.bb ? " on" : ""}`} onClick={() => setOverlays({ ...overlays, bb: !overlays.bb })}>
              BBands
            </button>
            <button className={`btn${overlays.vwap ? " on" : ""}`} onClick={() => setOverlays({ ...overlays, vwap: !overlays.vwap })}>
              AVWAP
            </button>
            <span className="sep" />
            {(["RSI", "MACD", "NONE"] as const).map((k) => (
              <button key={k} className={`btn${overlays.sub === k ? " on" : ""}`} onClick={() => setOverlays({ ...overlays, sub: k })}>
                {k}
              </button>
            ))}
            <span className="spacer" />
            <button className="btn" onClick={() => (viewRef.current = { count: 90, offset: 0 })}>
              Reset view
            </button>
          </div>

          <ChartPane store={store} interval={interval} overlays={overlays} view={viewRef} perf={perfRef} depthRef={depthRef} />

          <div className="tapepane">
            <div className="ph">
              <span>Time &amp; Sales</span>
              <span>{store.tape.length ? hms(store.tape[0].t) : "--"}</span>
            </div>
            <div className="scroll" style={{ flex: 1 }}>
              <TapePanel store={store} />
            </div>
          </div>
        </div>

        <div className="col right">
          <div className="ph">
            <span>Order Book L2</span>
            <span>{store.book.depth} lvl</span>
          </div>
          <OrderBookPanel store={store} />
          <div className="depthpane">
            <div className="ph">
              <span>Cumulative Depth</span>
              <span className="lbl">±0.4%</span>
            </div>
            <div style={{ height: 118 }}>
              <canvas ref={depthRef} />
            </div>
          </div>
        </div>
      </div>

      <div className="foot">
        <span><kbd>1</kbd>–<kbd>4</kbd> interval</span>
        <span><kbd>E</kbd>/<kbd>B</kbd>/<kbd>V</kbd> overlays</span>
        <span><kbd>R</kbd> reset view</span>
        <span>scroll = zoom · drag = pan · double-click = reset</span>
        <span className="spacer" />
        <span className="ellipsis">{store.instrument?.desc ?? ""}</span>
      </div>
    </div>
  );
}
