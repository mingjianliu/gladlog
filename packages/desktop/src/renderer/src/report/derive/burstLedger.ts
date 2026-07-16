import {
  analyzeBurstLedger,
  analyzeKickAudit,
  auditWindowTargeting,
  computeOffensiveWindows,
  isHealerSpec,
  type IBurstLedgerEntry,
  type IKickAuditEntry,
  type IWindowTargetingAudit,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

export interface LedgerPlayer {
  unitId: string;
  name: string;
  classId: number;
  isHealer: boolean;
  bursts: IBurstLedgerEntry[];
  targeting: IWindowTargetingAudit[];
  kicks: IKickAuditEntry[];
}

/**
 * 爆发账本(DPS 方向 D1):每个友方玩家的 爆发对齐 / kill-window 目标纪律 /
 * 打断审计。判定全部消费 analysis 谓词(analyzeBurstLedger / auditWindowTargeting /
 * analyzeKickAudit),与敌方 CD 时间线、色带共享同一套 CD/窗口谓词。
 * DPS 在前(账本主要面向 DPS),治疗殿后;全空的玩家不出行。
 */
export function deriveBurstLedger(source: ReportSource): LedgerPlayer[] {
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

    // 窗口(对敌方目标)全玩家共享,只算一次 —— 与 vulnWindows 同谓词。
    const windows = computeOffensiveWindows(enemies, friendlies, legacy);

    const out: LedgerPlayer[] = [];
    for (const p of friendlies) {
      const allies = friendlies.filter((f) => f.id !== p.id);
      const bursts = analyzeBurstLedger(p, allies, enemies, legacy);
      const targeting = auditWindowTargeting(p, windows, enemies, legacy);
      const kicks = analyzeKickAudit(p, enemies, legacy);
      if (bursts.length + targeting.length + kicks.length === 0) continue;
      out.push({
        unitId: p.id,
        name: p.name,
        classId: Number(p.class),
        isHealer: isHealerSpec(p.spec),
        bursts,
        targeting,
        kicks,
      });
    }
    return out.sort((a, b) => (a.isHealer ? 1 : 0) - (b.isHealer ? 1 : 0));
  } catch {
    return [];
  }
}
