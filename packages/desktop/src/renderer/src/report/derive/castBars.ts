import type { ReportSource } from "./types";

/** 读条无匹配结束事件时的兜底时长(ms)——竞技场读条极少超过 4s。 */
export const CAST_BAR_MAX_MS = 4_000;
/** start→success 配对窗口(ms):超过视为不相关(掉线/漏事件)。 */
const PAIR_WINDOW_MS = 12_000;

export interface CastBar {
  unitId: string;
  spellId: number;
  spellName: string;
  fromMs: number;
  toMs: number;
  /** completed = 同技能 SUCCESS 收尾;cut = 被打断/取消/换读条(无 SUCCESS)。 */
  outcome: "completed" | "cut";
}

/**
 * 真读条条(#11b 完全版,parser castStarts 落地后):
 * SPELL_CAST_START 与后续事件配对 —— 同技能 SUCCESS = 完成;先出现的
 * 下一次 CAST_START(换读条/取消后重读)或 4s 兜底 = 被掐。
 * 瞬发无 CAST_START,天然不出条。旧存档 doc 无 castStarts 字段 → 空数组。
 */
export function deriveCastBars(
  source: ReportSource,
  unitId: string,
): CastBar[] {
  const u = source.units[unitId] as
    | {
        casts?: Array<{ timestamp: number; spellId: number }>;
        castStarts?: Array<{
          timestamp: number;
          spellId: number;
          spellName: string;
        }>;
      }
    | undefined;
  const starts = u?.castStarts ?? [];
  if (starts.length === 0) return [];
  const successes = [...(u?.casts ?? [])].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  const bars: CastBar[] = [];
  for (let i = 0; i < starts.length; i++) {
    const st = starts[i]!;
    const nextStartT = starts[i + 1]?.timestamp ?? Infinity;
    const success = successes.find(
      (c) =>
        c.spellId === st.spellId &&
        c.timestamp >= st.timestamp &&
        c.timestamp <= st.timestamp + PAIR_WINDOW_MS &&
        c.timestamp <= nextStartT,
    );
    const cap = Math.min(nextStartT, st.timestamp + CAST_BAR_MAX_MS);
    bars.push({
      unitId,
      spellId: st.spellId,
      spellName: st.spellName,
      fromMs: st.timestamp,
      toMs: success ? success.timestamp : cap,
      outcome: success ? "completed" : "cut",
    });
  }
  return bars;
}

/** 播放时钟 t 时该单位进行中的读条(没有则 null)。 */
export function castBarAt(bars: CastBar[], tMs: number): CastBar | null {
  for (const b of bars) {
    if (tMs >= b.fromMs && tMs <= b.toMs) return b;
  }
  return null;
}
