import { C, fmtPx, fmtQty, hms, rgba } from "../render/theme";
import type { MarketStore } from "../store";

const ROWS = 40;

/** Executions, newest first. Block prints are highlighted against a rolling median. */
export function TapePanel({ store }: { store: MarketStore }) {
  const dp = store.instrument?.dp ?? 2;
  const tape = store.tape;
  const now = Date.now();

  // Median rather than mean: trade sizes are heavy-tailed, and a single block
  // print would drag a mean threshold above every subsequent block.
  const sizes = tape.slice(0, 60).map((t) => t.s).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const blockThreshold = median * 5;

  if (!tape.length) return <div className="empty">no prints yet</div>;

  return (
    <>
      {tape.slice(0, ROWS).map((t) => (
        <div
          className="tape"
          key={t.id}
          style={{ background: now - t.t < 300 ? rgba(t.side > 0 ? C.up : C.down, 0.1) : "transparent" }}
        >
          <span style={{ color: C.dim }}>{hms(t.t)}</span>
          <span style={{ color: t.side > 0 ? C.up : C.down, textAlign: "right" }}>{fmtPx(t.p, dp)}</span>
          <span style={{ textAlign: "right", color: t.s > blockThreshold ? C.amber : C.text }}>{fmtQty(t.s)}</span>
        </div>
      ))}
    </>
  );
}
