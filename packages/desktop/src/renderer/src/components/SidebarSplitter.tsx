import { useCallback, useRef } from "react";

import { useT } from "../i18n/LangProvider";
import { SIDEBAR_MAX, SIDEBAR_MIN } from "../sidebarWidth";

/** Adjustment step per arrow-key press, in px (WAI-ARIA Window Splitter). */
const KEY_STEP = 16;

/**
 * Draggable divider between the match list and the main pane.
 *
 * Modelled on report/components/ReplaySplitter.tsx — same pointer-capture
 * approach, same role="separator" + aria-value* trio, same try/catch around
 * releasePointerCapture (on pointercancel this element is not guaranteed to
 * still hold the capture, and releasing an uncaptured pointerId throws).
 *
 * Simpler than ReplaySplitter in one respect: that one converts the pointer
 * into a *ratio*, so it has to subtract its own track width and the grid gaps.
 * Here the value is the sidebar's width in px and the sidebar starts at the
 * layout's left edge, so the distance from that edge to the pointer *is* the
 * width — no gap arithmetic, and pressing without moving cannot jump.
 * Clamping stays in sidebarWidth.ts for both paths.
 */
export function SidebarSplitter({
  width,
  onWidthChange,
  layoutRef,
}: {
  width: number;
  onWidthChange: (w: number) => void;
  layoutRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useT();
  const draggingRef = useRef(false);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const layout = layoutRef.current;
      if (!layout) return;
      onWidthChange(e.clientX - layout.getBoundingClientRect().left);
    },
    [onWidthChange, layoutRef],
  );

  const stopDragging = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not in a capture state; nothing to do */
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          onWidthChange(width - KEY_STEP);
          break;
        case "ArrowRight":
          e.preventDefault();
          onWidthChange(width + KEY_STEP);
          break;
        case "Home":
          e.preventDefault();
          onWidthChange(SIDEBAR_MIN);
          break;
        case "End":
          e.preventDefault();
          onWidthChange(SIDEBAR_MAX);
          break;
        default:
          break;
      }
    },
    [width, onWidthChange],
  );

  return (
    <div
      className="app-sidebar-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("matchList.splitterAria")}
      tabIndex={0}
      aria-valuenow={Math.round(width)}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
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
