import { useCallback, useRef } from "react";

/**
 * 地图/GCD 之间的拖拽分隔条。比例由 stage 的实际宽度换算,
 * clamp 在 useReplayLayout 里做 —— 拖不到极端,极端只能点档位按钮进。
 */
export function ReplaySplitter(props: {
  onRatioChange: (r: number) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const draggingRef = useRef(false);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const stage = props.stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width === 0) return;
      props.onRatioChange((e.clientX - rect.left) / rect.width);
    },
    [props],
  );

  return (
    <div
      className="rpt-replay-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整地图与 GCD 泳道的宽度"
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        draggingRef.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}
