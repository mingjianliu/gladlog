import { analyzeKickAudit, type IKickAuditEntry } from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { tInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

export interface KickDashRow {
  unitId: string;
  name: string;
  classId: number;
  reaction: "Friendly" | "Hostile";
  landed: number;
  juked: number;
  missed: number;
  unknown: number;
  total: number;
  /** landed / (landed+juked+missed);unknown(旧档无读条数据)不入分母。null = 无可判定 kick。 */
  landedRate: number | null;
  entries: IKickAuditEntry[];
}

/**
 * 打断仪表盘(backlog #2):两队每个玩家的 kick 审计聚合。判定全部消费
 * analysis 的 analyzeKickAudit(与爆发账本"打断审计"同一谓词)——账本只看
 * 友方且按玩家分页,这里补上敌方侧与全场对照。
 */
/** range(时间窗联动①):判定在全量流上算(landed 配对不受窗口边界影响),
 * 之后按 atSeconds 过滤条目 —— 事实层过滤,见 derive/timeRange.ts。 */
export function deriveKickDash(
  source: ReportSource,
  range?: TimeRange | null,
): KickDashRow[] {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friends.length === 0 || enemies.length === 0) return [];

    const rows: KickDashRow[] = [];
    for (const p of players) {
      const opponents =
        p.reaction === CombatUnitReaction.Friendly ? enemies : friends;
      const entries = analyzeKickAudit(p, opponents, legacy).filter((e) =>
        tInRange(e.atSeconds, range),
      );
      if (entries.length === 0) continue;
      const count = (r: IKickAuditEntry["result"]) =>
        entries.filter((e) => e.result === r).length;
      const landed = count("landed");
      const juked = count("juked");
      const missed = count("missed");
      const decided = landed + juked + missed;
      rows.push({
        unitId: p.id,
        name: p.name,
        classId: Number(p.class),
        reaction:
          p.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Hostile",
        landed,
        juked,
        missed,
        unknown: count("unknown"),
        total: entries.length,
        landedRate: decided > 0 ? landed / decided : null,
        entries,
      });
    }
    // 己方在前,组内按施放次数降序(kick 主力最上)
    return rows.sort(
      (a, b) =>
        (a.reaction === "Friendly" ? 0 : 1) -
          (b.reaction === "Friendly" ? 0 : 1) || b.total - a.total,
    );
  } catch {
    return [];
  }
}
