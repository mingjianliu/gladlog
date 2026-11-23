import { useCallback, useRef } from "react";

import { useT } from "../../i18n/LangProvider";
import { MAP_HEIGHT_MAX, MAP_HEIGHT_MIN } from "./useReplayLayout";

/** Step size per arrow-key press (px). */
const KEY_STEP = 40;

/**
 * Height drag bar below the map-only layout. The arena SVG has a locked
 * aspectRatio (width follows from height), so dragging the height scales the
 * whole thing -- on a portrait screen it is no longer pinned by the old
 * hard-coded max-width.
 *
 * The only difference from ReplaySplitter is the axis: here we measure the
 * pointer's offset from the map cell's **top edge**, which yields the height
 * directly (unlike the splitter, which converts to a ratio), so there is no
 * gap / track width to subtract -- the distance from the top edge to the
 * pointer *is* the height, and zero movement means zero jump.
 *
 * Keyboard accessibility matches ReplaySplitter: role="separator" plus the
 * aria-value* trio, ↑/↓ to step, Home/End to the extremes. Clamping is always
 * handled by useReplayLayout.
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
  const { t } = useT();
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
    // Same as ReplaySplitter: on pointercancel we aren't guaranteed to still
    // hold the capture, and release would throw.
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not in a capture state, nothing to do */
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // ReplayView has a window-level keydown handler (space to play, ←/→ to
      // scrub the timeline) that filters by tagName only and doesn't
      // recognize focused controls -- all four keys must stopPropagation, or
      // adjusting the height would scrub the timeline at the same time (the
      // splitter bar hit this exact trap).
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
      aria-label={t("report.replay.resizeMap")}
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
