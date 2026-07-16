import { computeOffensiveWindows } from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

/**
 * 脆弱窗口色带(backlog #8):burst = 击杀尝试(金),vulnerable = 无人惩罚
 * 的整段脆弱期(灰红)。谓词单一来源:直接消费 analysis 的
 * computeOffensiveWindows(含 2026-07-17 burst 重设计),不在渲染层复制常量。
 * 时间为**相对秒**(自 combat start),渲染侧按各自坐标系换算。
 */
export interface VulnBand {
  kind: "burst" | "vulnerable";
  fromS: number;
  toS: number;
  targetName: string;
  /** burst:团队伤害;vulnerable:整段团队伤害。 */
  damage: number;
}

export function deriveVulnBands(source: ReportSource): VulnBand[] {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friendlies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friendlies.length === 0 || enemies.length === 0) return [];

    const bands: VulnBand[] = [];
    for (const w of computeOffensiveWindows(enemies, friendlies, legacy)) {
      if (w.bursts.length > 0) {
        for (const b of w.bursts) {
          bands.push({
            kind: "burst",
            fromS: b.fromSeconds,
            toS: b.toSeconds,
            targetName: w.targetName,
            damage: b.damage,
          });
        }
      } else {
        bands.push({
          kind: "vulnerable",
          fromS: w.fromSeconds,
          toS: w.toSeconds,
          targetName: w.targetName,
          damage: w.friendlyDamageInWindow,
        });
      }
    }
    return bands.sort((a, b) => a.fromS - b.fromS);
  } catch {
    return [];
  }
}
