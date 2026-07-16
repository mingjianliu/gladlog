import { getDampeningPercentage } from "@gladlog/analysis";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

/**
 * dampening 1s 网格序列(backlog #11a)。谓词单一来源:逐秒调 analysis 的
 * getDampeningPercentage(与 prompt 渲染同一函数),渲染层不重推 aura stack。
 */
export function deriveDampeningSeries(
  source: ReportSource,
): Array<{ tS: number; pct: number }> {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    if (players.length === 0) return [];
    const bracket = (source as { bracket?: string }).bracket ?? "3v3";
    const durationS = Math.max(
      1,
      Math.floor((legacy.endTime - legacy.startTime) / 1000),
    );
    const out: Array<{ tS: number; pct: number }> = [];
    for (let s = 0; s <= durationS; s++) {
      out.push({
        tS: s,
        pct: getDampeningPercentage(
          bracket,
          players,
          legacy.startTime + s * 1000,
        ),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** 播放时钟处的当前 dampening(最近不晚于 t 的采样)。 */
export function dampeningAt(
  series: Array<{ tS: number; pct: number }>,
  tS: number,
): number | null {
  if (series.length === 0) return null;
  let cur = series[0]!.pct;
  for (const p of series) {
    if (p.tS > tS) break;
    cur = p.pct;
  }
  return cur;
}
