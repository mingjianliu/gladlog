import { burstCastSpan, reconstructEnemyCDTimeline } from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

/** 敌方进攻大 CD 的 active 区间(绝对 ms)——回放红光脉冲用。 */
export interface BurstAuraSpan {
  fromMs: number;
  toMs: number;
  spellName: string;
}

/**
 * 回放爆发视觉(DPS D1 顺带项):每个敌方玩家的进攻 CD active 区间。
 * CD 检测 = reconstructEnemyCDTimeline,span = burstCastSpan —— 与爆发账本
 * 审计的是同一段时间,脉冲盖到哪里、账本就审到哪里。
 */
export function deriveBurstAuras(
  source: ReportSource,
): Record<string, BurstAuraSpan[]> {
  try {
    const legacy = toLegacySafe(source);
    const enemies = Object.values(legacy.units).filter(
      (u) => u.info && u.reaction === CombatUnitReaction.Hostile,
    );
    if (enemies.length === 0) return {};
    const idByName = new Map(enemies.map((e) => [e.name, e.id]));

    const out: Record<string, BurstAuraSpan[]> = {};
    for (const p of reconstructEnemyCDTimeline(enemies, legacy).players) {
      const unitId = idByName.get(p.playerName);
      if (!unitId) continue;
      out[unitId] = p.offensiveCDs.map((cd) => {
        const span = burstCastSpan(cd);
        return {
          fromMs: legacy.startTime + span.from * 1000,
          toMs: legacy.startTime + span.to * 1000,
          spellName: cd.spellName,
        };
      });
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 同秒集火(DPS D1 顺带项):unitId → { 相对整秒 → 同秒打它的敌对玩家数 },
 * 仅保留 ≥2 人的秒。宠物伤害归主人(与 damageOut 合并同一口径),
 * 秒 = floor(相对毫秒 / 1000),与回放时钟同网格。
 */
export function deriveFocusFire(
  source: ReportSource,
): Record<string, Record<number, number>> {
  try {
    const legacy = toLegacySafe(source);
    const units = Object.values(legacy.units);
    const players = units.filter((u) => u.info);
    const playerIds = new Set(players.map((p) => p.id));
    // 宠物/守卫 → 主人(集火计头数按玩家算)
    const ownerOf = new Map<string, string>();
    for (const u of units) {
      if (u.ownerId && playerIds.has(u.ownerId)) ownerOf.set(u.id, u.ownerId);
    }

    const out: Record<string, Record<number, number>> = {};
    for (const victim of players) {
      const bySecond = new Map<number, Set<string>>();
      for (const d of victim.damageIn) {
        const src = ownerOf.get(d.srcUnitId) ?? d.srcUnitId;
        if (!playerIds.has(src) || src === victim.id) continue;
        if (Math.abs(d.effectiveAmount) <= 0) continue;
        const sec = Math.floor((d.logLine.timestamp - legacy.startTime) / 1000);
        let set = bySecond.get(sec);
        if (!set) bySecond.set(sec, (set = new Set()));
        set.add(src);
      }
      const focused: Record<number, number> = {};
      for (const [sec, srcs] of bySecond) {
        if (srcs.size >= 2) focused[sec] = srcs.size;
      }
      if (Object.keys(focused).length > 0) out[victim.id] = focused;
    }
    return out;
  } catch {
    return {};
  }
}
