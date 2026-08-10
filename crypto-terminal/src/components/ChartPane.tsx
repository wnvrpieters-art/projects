import { useEffect, useRef } from "react";
import { AXIS_W, chartGeometry, drawChart, type ChartView, type Crosshair } from "../render/chart";
import { drawDepth } from "../render/depth";
import type { Overlays } from "../indicators";
import type { MarketStore } from "../store";
import type { Interval } from "../types";
import { clamp } from "../render/theme";

interface Props {
  store: MarketStore;
  interval: Interval;
  overlays: Overlays;
  view: React.MutableRefObject<ChartView>;
  perf: React.MutableRefObject<{ fps: number }>;
  depthRef: React.RefObject<HTMLCanvasElement>;
}

/**
 * Owns the render loop for both canvases.
 *
 * Nothing here touches React state. The loop reads the store directly at frame
 * rate while the DOM panels re-render on their own slower clock, which keeps
 * pointer interaction smooth no matter how busy the feed is.
 */
export function ChartPane({ store, interval, overlays, view, perf, depthRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crossRef = useRef<Crosshair>({ on: false, x: 0, y: 0, i: null });
  const dragRef = useRef<{ x: number; offset: number } | null>(null);

  // Mirrored so the loop never needs to re-subscribe when a toggle changes.
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let windowStart = performance.now();

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      frames++;

      const cv = canvasRef.current;
      if (cv) {
        const bars = store.candles.get(intervalRef.current);
        drawChart(cv, {
          bars,
          version: store.candles.version,
          symbol: store.instrument?.symbol ?? "",
          interval: intervalRef.current,
          dp: store.instrument?.dp ?? 2,
          dir: store.dir,
          view: view.current,
          overlays: overlaysRef.current,
          cross: crossRef.current,
        });
      }
      const dc = depthRef.current;
      if (dc) drawDepth(dc, store.book, store.instrument?.dp ?? 2);

      if (t - windowStart >= 500) {
        perf.current.fps = Math.round((frames * 1000) / (t - windowStart));
        frames = 0;
        windowStart = t;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [store, view, perf, depthRef]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;

    const hitTest = (x: number): number | null => {
      const plotW = cv.clientWidth - AXIS_W;
      const bars = store.candles.get(intervalRef.current);
      const geo = chartGeometry(plotW, bars.length, view.current);
      const i = Math.floor((x - (plotW - geo.visible * geo.cw)) / geo.cw);
      return i >= 0 && i < geo.visible ? i : null;
    };

    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      crossRef.current = { on: true, x, y, i: hitTest(x) };
      if (dragRef.current) {
        const plotW = cv.clientWidth - AXIS_W;
        const cw = plotW / clamp(view.current.count, 20, 400);
        const bars = store.candles.get(intervalRef.current);
        view.current.offset = clamp(
          dragRef.current.offset + (e.clientX - dragRef.current.x) / cw,
          0,
          Math.max(0, bars.length - 30),
        );
      }
    };
    const onLeave = () => {
      crossRef.current = { on: false, x: 0, y: 0, i: null };
    };
    const onDown = (e: PointerEvent) => {
      dragRef.current = { x: e.clientX, offset: view.current.offset };
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = "grabbing";
    };
    const onUp = (e: PointerEvent) => {
      dragRef.current = null;
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      cv.style.cursor = "crosshair";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.count = clamp(view.current.count * (e.deltaY > 0 ? 1.12 : 0.89), 20, 400);
    };
    const onDouble = () => {
      view.current = { count: 90, offset: 0 };
    };

    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("dblclick", onDouble);
    return () => {
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("dblclick", onDouble);
    };
  }, [store, view]);

  return (
    <div className="chartwrap">
      <canvas ref={canvasRef} style={{ cursor: "crosshair", touchAction: "none" }} />
    </div>
  );
}
