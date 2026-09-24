import { useCallback, useRef, useState } from "react";

interface ReplayViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FALLBACK_VW = 520;
const FALLBACK_VH = 520;
/** Zoom in at most to 1/5 of the full extent. */
const MAX_ZOOM_DIVISOR = 5;

/**
 * Zoom/pan for the replay map. All the maths runs in viewBox units, independent
 * of pixel width — so dragging the split-pane divider does not disturb the zoom
 * state.
 */
export function useReplayZoom() {
  const [view, setView] = useState<ReplayViewBox | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // VW/VH are only known once the zoneMap branch has run, which happens after
  // the tracks.length === 0 early return — so keep the original design: the
  // consumer writes them during render.
  const dimsRef = useRef({ vw: FALLBACK_VW, vh: FALLBACK_VH });
  // The wheel handler needs the current view, but the listener must not be
  // reinstalled whenever view changes — mirror it into a ref during render.
  const viewRef = useRef<ReplayViewBox | null>(null);
  viewRef.current = view;
  const detachRef = useRef<(() => void) | null>(null);

  const setDims = useCallback((vw: number, vh: number) => {
    dimsRef.current = { vw, vh };
  }, []);

  const applyZoom = useCallback((factor: number, fx: number, fy: number) => {
    const { vw, vh } = dimsRef.current;
    setView((cur0) => {
      const cur = cur0 ?? { x: 0, y: 0, w: vw, h: vh };
      const w = Math.min(vw, Math.max(vw / MAX_ZOOM_DIVISOR, cur.w * factor));
      const h = (w / vw) * vh;
      let x = cur.x + fx * (cur.w - w);
      let y = cur.y + fy * (cur.h - h);
      x = Math.min(Math.max(0, x), vw - w);
      y = Math.min(Math.max(0, y), vh - h);
      return w >= vw ? null : { x, y, w, h };
    });
  }, []);

  const panByPixels = useCallback((dx: number, dy: number, rect: DOMRect) => {
    const { vw, vh } = dimsRef.current;
    setView((cur) => {
      if (!cur) return cur;
      const mx = (dx / rect.width) * cur.w;
      const my = (dy / rect.height) * cur.h;
      return {
        ...cur,
        x: Math.min(Math.max(0, cur.x - mx), vw - cur.w),
        y: Math.min(Math.max(0, cur.y - my), vh - cur.h),
      };
    });
  }, []);

  const reset = useCallback(() => setView(null), []);

  // Callback ref: attach the listener when the element arrives, detach when it leaves.
  const hotZoneRef = useCallback(
    (el: HTMLDivElement | null) => {
      detachRef.current?.();
      detachRef.current = null;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        // In the panorama state a bare wheel belongs to page scrolling — return
        // untouched, never call preventDefault, or the map becomes a scroll
        // black hole. Entering the zoomed state is an explicit "I am looking at
        // the map", and only then do we take over.
        if (!e.ctrlKey && !e.metaKey && !viewRef.current) return;
        e.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        applyZoom(
          e.deltaY > 0 ? 1.25 : 0.8,
          (e.clientX - rect.left) / rect.width,
          (e.clientY - rect.top) / rect.height,
        );
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      detachRef.current = () => el.removeEventListener("wheel", onWheel);
    },
    [applyZoom],
  );

  const zoomLevel = view
    ? Math.round((dimsRef.current.vw / view.w) * 10) / 10
    : null;

  return {
    view,
    zoomLevel,
    applyZoom,
    panByPixels,
    reset,
    setDims,
    svgRef,
    hotZoneRef,
  };
}
