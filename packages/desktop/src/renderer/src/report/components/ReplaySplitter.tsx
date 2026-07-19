import { useCallback, useRef } from "react";

import { SPLIT_MAX, SPLIT_MIN } from "./useReplayLayout";

/** 每次按方向键的调整步长(WAI-ARIA Window Splitter 惯例)。 */
const KEY_STEP = 0.05;

/**
 * 地图/GCD 之间的拖拽分隔条。比例由 stage 的实际宽度换算,
 * clamp 在 useReplayLayout 里做 —— 拖不到极端,极端只能点档位按钮进。
 *
 * 键盘可达性(WAI-ARIA Window Splitter 模式):role="separator" + tabIndex
 * + aria-value* 三件套,←/→ 步进 0.05,Home/End 到 [SPLIT_MIN, SPLIT_MAX]
 * 两端。键盘路径同样只调 onRatioChange,clamp 仍由 useReplayLayout 兜底。
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
  const draggingRef = useRef(false);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width === 0) return;
      // grid 模板是 `${ratio}fr <splitterWidth>px ${1-ratio}fr`,stage 还有
      // column-gap(styles.css .rpt-replay-stage)。两条 fr 轨道能分到的宽度
      // 不是整条 rect.width —— 要扣掉中间固定宽的分隔条轨道本身,以及左右
      // 各一条 grid gap(3 列 = 2 条 gap)。这两个数不在这里重复硬编码常量,
      // 直接从渲染结果量(分隔条自身的 rect 宽度 / stage 的 computed
      // columnGap)——上一版正是硬编码 6px 却漏减 22px(6px 轨道 + 2×8px
      // gap)导致系统性偏差,量渲染值这类 bug 就不会再犯一次。
      // 分隔条视觉中心也不在轨道起点(x=0),而是再往右偏"一条 gap + 半个
      // 轨道宽",所以要把这段偏移从 clientX 里减掉:这样"原地按下不拖"才会
      // 得到跟当前 ratio 完全一致的值(零位移 = 零跳变),而不是像旧公式
      // 那样系统性偏出一截。
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
    // pointercancel(系统级手势打断、拖拽中弹右键菜单等)不保证这个元素
    // 还持有 capture —— release 一个未捕获的 pointerId 会抛,吞掉即可,
    // 这里的目的只是确保不会残留 capture,不是要处理这个异常本身。
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 未处于 capture 状态,无需处理 */
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // ReplayView 有个 window 级 keydown 监听(空格播放/暂停、←/→ 跳时间轴
      // ±5s),只按 e.target.tagName 过滤,不认聚焦控件。keydown 会冒泡到
      // window,preventDefault 拦不住那个监听器 —— 焦点在分隔条上时不
      // stopPropagation,←/→ 会同时把时间轴跳走。分隔条处理的四个键都要
      // stopPropagation,不让它们漏到那个监听器上。
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
      aria-label="调整地图与 GCD 泳道的宽度"
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
