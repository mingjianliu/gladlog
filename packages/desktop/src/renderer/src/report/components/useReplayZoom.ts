import { useCallback, useRef, useState } from "react";

export interface ReplayViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FALLBACK_VW = 520;
const FALLBACK_VH = 520;
/** 最多放大到全幅的 1/5。 */
const MAX_ZOOM_DIVISOR = 5;

/**
 * 回放地图的缩放/平移。全部数学跑在 viewBox 单位上,与像素宽度无关 ——
 * 所以拖动分栏分隔条不会扰动缩放状态。
 */
export function useReplayZoom() {
  const [view, setView] = useState<ReplayViewBox | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // VW/VH 要等 zoneMap 分支算完,那发生在 tracks.length === 0 的早退之后,
  // 所以沿用原实现:渲染期由消费者写入。
  const dimsRef = useRef({ vw: FALLBACK_VW, vh: FALLBACK_VH });
  // 滚轮判定要读当前 view,但监听不该因 view 变化而重装 —— 渲染期同步进 ref。
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

  // 回调 ref:元素来了就装监听,走了就拆。本任务保持原规则(必须按 ⌘/Ctrl),
  // 改判定表是 Task 3 的事。
  const hotZoneRef = useCallback(
    (el: HTMLDivElement | null) => {
      detachRef.current?.();
      detachRef.current = null;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return;
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
