import { C, fmtPx, fmtQty, rgba } from "../render/theme";
import type { MarketStore } from "../store";

const LEVELS = 15;
const FLASH_MS = 220;

/**
 * L2 ladder.
 *
 * Rows are rendered from the cached sorted view rather than the raw maps, and
 * the depth bar is scaled to the largest size on screen — not to the full book,
 * where one far-touch iceberg would flatten every visible row to nothing.
 */
export function OrderBookPanel({ store }: { store: MarketStore }) {
  const dp = store.instrument?.dp ?? 2;
  const { bids, asks } = store.book.top(LEVELS);
  const now = Date.now();

  if (!bids.length || !asks.length) {
    return (
      <div className="book">
        <div className="empty">{store.status === "syncing" ? "synchronising book…" : "no book data"}</div>
      </div>
    );
  }

  let maxSize = 0;
  for (const l of bids) if (l.s > maxSize) maxSize = l.s;
  for (const l of asks) if (l.s > maxSize) maxSize = l.s;

  const spread = asks[0].p - bids[0].p;
  const spreadBp = (spread / store.book.mid) * 10_000;

  const rows = (levels: typeof bids, color: string, key: string) => {
    let cum = 0;
    return levels.map((l, i) => {
      cum += l.s;
      const fresh = now - l.f < FLASH_MS;
      return (
        <div className="row" key={`${key}${i}`}>
          <div className="bg" style={{ width: `${(l.s / maxSize) * 100}%`, background: rgba(color, fresh ? 0.32 : 0.13) }} />
          <span style={{ color }}>{fmtPx(l.p, dp)}</span>
          <span className="sz">{fmtQty(l.s)}</span>
          <span className="tot">{fmtQty(cum)}</span>
        </div>
      );
    });
  };

  return (
    <div className="book">
      <div className="bookhead">
        <span>Price</span>
        <span style={{ textAlign: "right" }}>Size</span>
        <span style={{ textAlign: "right" }}>Total</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column-reverse" }}>{rows(asks, C.down, "a")}</div>
      <div className="mid">
        <span style={{ color: store.dir >= 0 ? C.up : C.down, fontSize: 13 }}>{fmtPx(store.last, dp)}</span>
        <span className="lbl">
          SPRD {fmtPx(spread, dp)} · {spreadBp.toFixed(2)}bp
        </span>
      </div>
      {rows(bids, C.up, "b")}
    </div>
  );
}
