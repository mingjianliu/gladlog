import { useCallback, useState } from "react";

/** 分栏档位。ratio 是它们的预设值,不是并列状态。 */
export type ReplayLayoutMode = "split" | "map" | "gcd";

/** 地图占比的可拖范围。拖不到极端 —— 极端只能点档位按钮进。 */
export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
/** 默认 1/3,即改造前写死的 1fr 2fr。 */
export const SPLIT_DEFAULT = 1 / 3;

/**
 * 纯地图档的地图高度(px)。场地 SVG 锁死 aspectRatio,宽由高推出 ——
 * 所以「调高度」就是整体缩放,竖屏上不再被原来写死的 max-width 卡住。
 * 只在 mode==="map" 生效:split 档的尺寸归 ratio 管。
 */
export const MAP_HEIGHT_MIN = 320;
export const MAP_HEIGHT_MAX = 1400;
/** 默认值 ≈ 改造前 max-width:1100px 减去两侧 140px 列后的地图宽(方形场地)。 */
export const MAP_HEIGHT_DEFAULT = 800;

const STORAGE_KEY = "gladlog.replaySplit";

/** 夹到 [SPLIT_MIN, SPLIT_MAX];非有限值(localStorage 脏数据)落回默认。 */
export function clampSplitRatio(desired: number): number {
  if (!Number.isFinite(desired)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, desired));
}

/** 同上,夹到 [MAP_HEIGHT_MIN, MAP_HEIGHT_MAX]。 */
export function clampMapHeight(desired: number): number {
  if (!Number.isFinite(desired)) return MAP_HEIGHT_DEFAULT;
  return Math.min(MAP_HEIGHT_MAX, Math.max(MAP_HEIGHT_MIN, desired));
}

interface Persisted {
  mode: ReplayLayoutMode;
  ratio: number;
  mapHeight: number;
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      const mode =
        p.mode === "map" || p.mode === "gcd" || p.mode === "split"
          ? p.mode
          : "split";
      return {
        mode,
        ratio: clampSplitRatio(p.ratio as number),
        // 旧档没有 mapHeight → undefined → clamp 落回默认,不用单独迁移
        mapHeight: clampMapHeight(p.mapHeight as number),
      };
    }
    // 旧键迁移:gladlog.replayLayout 存过 "map" / "full"
    const legacy = localStorage.getItem("gladlog.replayLayout");
    return {
      mode: legacy === "map" ? "map" : "split",
      ratio: SPLIT_DEFAULT,
      mapHeight: MAP_HEIGHT_DEFAULT,
    };
  } catch {
    /* 隐私模式等 */
  }
  return {
    mode: "split",
    ratio: SPLIT_DEFAULT,
    mapHeight: MAP_HEIGHT_DEFAULT,
  };
}

function persist(next: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式等 */
  }
}

export function useReplayLayout(): {
  mode: ReplayLayoutMode;
  ratio: number;
  mapHeight: number;
  setMode(m: ReplayLayoutMode): void;
  setRatio(r: number): void;
  setMapHeight(h: number): void;
} {
  const [state, setState] = useState<Persisted>(readPersisted);

  const setMode = useCallback((mode: ReplayLayoutMode) => {
    setState((prev) => {
      const next = { ...prev, mode };
      persist(next);
      return next;
    });
  }, []);

  const setRatio = useCallback((r: number) => {
    setState((prev) => {
      const next = { ...prev, ratio: clampSplitRatio(r) };
      persist(next);
      return next;
    });
  }, []);

  const setMapHeight = useCallback((h: number) => {
    setState((prev) => {
      const next = { ...prev, mapHeight: clampMapHeight(h) };
      persist(next);
      return next;
    });
  }, []);

  // 生效占比:极端档不读用户拖的值
  const ratio =
    state.mode === "map" ? 1 : state.mode === "gcd" ? 0 : state.ratio;

  return {
    mode: state.mode,
    ratio,
    mapHeight: state.mapHeight,
    setMode,
    setRatio,
    setMapHeight,
  };
}
