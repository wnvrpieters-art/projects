import { C, fmtPx } from "../render/theme";
import type { MarketStore } from "../store";
import type { Instrument } from "../types";

interface Props {
  instruments: Instrument[];
  selected: string;
  store: MarketStore;
  onSelect: (symbol: string) => void;
}

export function InstrumentList({ instruments, selected, store, onSelect }: Props) {
  return (
    <div className="scroll">
      {instruments.map((inst) => {
        const t = store.tickers.get(inst.symbol);
        const isSelected = inst.symbol === selected;
        return (
          <button
            key={inst.symbol}
            className={`inst${isSelected ? " sel" : ""}`}
            onClick={() => onSelect(inst.symbol)}
            aria-current={isSelected}
          >
            <span className="sym">{inst.label}</span>
            <span style={{ textAlign: "right", color: t ? (t.dir >= 0 ? C.up : C.down) : C.dim }}>
              {t ? fmtPx(t.last, inst.dp) : "--"}
            </span>
            <span className="lbl ellipsis">{inst.desc}</span>
            <span className="pct" style={{ color: t && t.pct >= 0 ? C.up : C.down }}>
              {t ? `${t.pct >= 0 ? "+" : ""}${t.pct.toFixed(2)}%` : "--"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
