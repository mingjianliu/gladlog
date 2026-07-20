import { useCallback, useRef } from "react";

import { MAP_HEIGHT_MAX, MAP_HEIGHT_MIN } from "./useReplayLayout";

/** 每次按方向键的步长(px)。 */
const KEY_STEP = 40;

/**
 * 纯地图档下方的高度拖拽条。场地 SVG 锁死 aspectRatio(宽由高推出),
 * 所以拖高度 = 整体缩放 —— 竖屏上不再被原来写死的 max-width 卡住。
 *
 * 与 ReplaySplitter 的区别只是轴向:这里量的是指针相对地图单元**顶边**的
 * 位移,直接得到高度(不像分栏那样要换算成占比),所以不需要扣 gap /
 * 轨道宽 —— 顶边到指针的距离就是高度本身,零位移即零跳变。
 *
 * 键盘可达性同 ReplaySplitter:role="separator" + aria-value* 三件套,
 * ↑/↓ 步进,Home/End 到两端。clamp 一律由 useReplayLayout 兜底。
 */
export function ReplayMapResizer({
  mapHeight,
  onHeightChange,
  cellRef,
}: {
  mapHeight: number;
  onHeightChange: (h: number) => void;
  cellRef: React.RefObject<HTMLDivElement | null>;
}) {
  const draggingRef = useRef(false);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const cell = cellRef.current;
      if (!cell) return;
      const top = cell.getBoundingClientRect().top;
      onHeightChange(e.clientY - top);
    },
    [onHeightChange, cellRef],
  );

  const stopDragging = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    // 同 ReplaySplitter:pointercancel 时不保证仍持有 capture,release 会抛。
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 未处于 capture 状态,无需处理 */
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // ReplayView 有 window 级 keydown(空格播放、←/→ 跳时间轴),只按
      // tagName 过滤、不认聚焦控件 —— 四个键都要 stopPropagation,否则
      // 调高度的同时把时间轴也跳走了(分栏条踩过同一个坑)。
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          onHeightChange(mapHeight - KEY_STEP);
          break;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          onHeightChange(mapHeight + KEY_STEP);
          break;
        case "Home":
          e.preventDefault();
          e.stopPropagation();
          onHeightChange(MAP_HEIGHT_MIN);
          break;
        case "End":
          e.preventDefault();
          e.stopPropagation();
          onHeightChange(MAP_HEIGHT_MAX);
          break;
        default:
          break;
      }
    },
    [mapHeight, onHeightChange],
  );

  return (
    <div
      className="rpt-replay-map-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整地图高度"
      data-testid="rpt-replay-map-resizer"
      tabIndex={0}
      aria-valuenow={Math.round(mapHeight)}
      aria-valuemin={MAP_HEIGHT_MIN}
      aria-valuemax={MAP_HEIGHT_MAX}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    />
  );
}
