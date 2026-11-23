import { useCallback, useRef } from "react";

import { useT } from "../../i18n/LangProvider";
import { SPLIT_MAX, SPLIT_MIN } from "./useReplayLayout";

/** Adjustment step per arrow-key press (WAI-ARIA Window Splitter convention). */
const KEY_STEP = 0.05;

/**
 * Draggable splitter between the map and the GCD lanes. The ratio is derived
 * from the stage's actual width; clamping happens in useReplayLayout — dragging
 * cannot reach the extremes, which are only reachable via the preset buttons.
 *
 * Keyboard accessibility (WAI-ARIA Window Splitter pattern): the trio of
 * role="separator" + tabIndex + aria-value*, with ←/→ stepping by 0.05 and
 * Home/End jumping to the [SPLIT_MIN, SPLIT_MAX] ends. The keyboard path also
 * only calls onRatioChange; useReplayLayout still backstops the clamping.
 */
export function ReplaySplitter({
  ratio,
  onRatioChange,
  stageRef,
}: {
  ratio: number;
  onRatioChange: (r: number) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useT();
  const draggingRef = useRef(false);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width === 0) return;
      // The grid template is `${ratio}fr <splitterWidth>px ${1-ratio}fr`, and
      // the stage also has a column-gap (styles.css .rpt-replay-stage). The
      // width the two fr tracks share is NOT the whole rect.width — the
      // fixed-width splitter track itself must be subtracted, plus one grid gap
      // on each side (3 columns = 2 gaps). Neither number is re-hardcoded here
      // as a constant; both are measured from the rendered result (the
      // splitter's own rect width / the stage's computed columnGap). The
      // previous version hardcoded 6px and forgot to subtract 22px (the 6px
      // track + 2×8px gaps), causing a systematic offset; measuring rendered
      // values means that class of bug cannot recur.
      // The splitter's visual center is also not at the track's origin (x=0) but
      // offset right by "one gap + half a track width", so that offset must be
      // subtracted from clientX: only then does "press without dragging" yield
      // exactly the current ratio (zero movement = zero jump), instead of the
      // systematic drift the old formula produced.
      const splitterWidth = e.currentTarget.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(stage).columnGap) || 0;
      const usable = rect.width - splitterWidth - 2 * gap;
      if (usable <= 0) return;
      const x = e.clientX - rect.left - gap - splitterWidth / 2;
      onRatioChange(x / usable);
    },
    [onRatioChange, stageRef],
  );

  const stopDragging = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    // On pointercancel (a system-level gesture interrupting, a context menu
    // opening mid-drag, …) this element is not guaranteed to still hold the
    // capture — releasing an uncaptured pointerId throws, and swallowing that is
    // fine: the point here is only to make sure no capture is left behind, not
    // to handle the exception itself.
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not in a capture state; nothing to do */
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // ReplayView has a window-level keydown listener (space = play/pause, ←/→
      // = seek the timeline ±5s) that filters only on e.target.tagName and does
      // not recognize focused controls. keydown bubbles to window and
      // preventDefault does not stop that listener — without stopPropagation,
      // ←/→ while the splitter has focus would also seek the timeline. All four
      // keys the splitter handles must stopPropagation so none leak through to
      // that listener.
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          onRatioChange(ratio - KEY_STEP);
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          onRatioChange(ratio + KEY_STEP);
          break;
        case "Home":
          e.preventDefault();
          e.stopPropagation();
          onRatioChange(SPLIT_MIN);
          break;
        case "End":
          e.preventDefault();
          e.stopPropagation();
          onRatioChange(SPLIT_MAX);
          break;
        default:
          break;
      }
    },
    [ratio, onRatioChange],
  );

  return (
    <div
      className="rpt-replay-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("report.replay.resizeSplit")}
      tabIndex={0}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
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
