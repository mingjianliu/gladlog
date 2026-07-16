import {
  analyzePlayerCCAndTrinket,
  getEnglishSpellName,
  reconstructDispelSummary,
  SPELL_CATEGORIES,
} from "@gladlog/analysis";
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

/** 明细实例(行展开用,backlog #10 v2);tS = 相对秒。 */
export interface StatsInstance {
  tS: number;
  /** 事件描述,如 "Wind Shear → Chaos Bolt" / "Kidney Shot 5.0s(Rogue X)"。 */
  label: string;
}

export interface StatsRow {
  unitId: string;
  name: string;
  classId: number;
  reaction: string;
  /** 打断技施放次数(SPELL_CAST_SUCCESS ∩ interrupts 分类)。 */
  kicksCast: number;
  /** 被敌方打断次数(analysis interruptInstances)。 */
  kicksTaken: number;
  /** 被控总秒数(analysis ccInstances)。 */
  ccTakenS: number;
  /** 被控占全场 %。 */
  ccTakenPct: number;
  /** 己方驱散(给队友解)次数。 */
  cleanses: number;
  /** 进攻驱散/偷 buff 次数。 */
  purges: number;
  /** 行展开明细:打断施放 / 被打断 / 被控(各按时间升序)。 */
  detail: {
    kicksCast: StatsInstance[];
    kicksTaken: StatsInstance[];
    ccTaken: StatsInstance[];
  };
}

/**
 * 每玩家硬数据表(backlog #10):打断/被控/驱散。判定全部消费 analysis
 * 谓词(analyzePlayerCCAndTrinket / reconstructDispelSummary / 打断分类表),
 * 渲染层不重造白名单——那是白名单腐烂病的诞生地。
 */
export function deriveStatsTable(source: ReportSource): StatsRow[] {
  try {
    const legacy = toLegacySafe(source);
    const durationS = Math.max(1, (legacy.endTime - legacy.startTime) / 1000);
    const players = Object.values(legacy.units).filter((u) => u.info);
    if (players.length === 0) return [];
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    const combatLike = {
      startTime: legacy.startTime,
      endTime: legacy.endTime,
      startInfo: { zoneId: (legacy as { zoneId?: string }).zoneId ?? "" },
    };

    // 驱散双向:己方视角 + 敌方视角各建一次(同一谓词,两侧对称)
    const ourDispels = reconstructDispelSummary(friends, enemies, combatLike);
    const theirDispels = reconstructDispelSummary(enemies, friends, combatLike);

    const rows: StatsRow[] = [];
    for (const p of players) {
      const opponents =
        p.reaction === CombatUnitReaction.Friendly ? enemies : friends;
      const cc = analyzePlayerCCAndTrinket(p, opponents, combatLike);
      const ccTakenS = cc.ccInstances.reduce(
        (s, i) => s + i.durationSeconds,
        0,
      );
      const kickCastEvents = p.spellCastEvents.filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          SPELL_CATEGORIES[e.spellId ?? ""]?.type === "interrupts",
      );
      const kicksCast = kickCastEvents.length;
      const dispels =
        p.reaction === CombatUnitReaction.Friendly ? ourDispels : theirDispels;
      const cleanses = dispels.allyCleanse.filter(
        (d) => d.sourceName === p.name,
      ).length;
      const purges = dispels.ourPurges.filter(
        (d) => d.sourceName === p.name,
      ).length;

      rows.push({
        unitId: p.id,
        name: p.name,
        classId: Number(p.class),
        reaction:
          p.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Hostile",
        kicksCast,
        kicksTaken: cc.interruptInstances.length,
        ccTakenS: Math.round(ccTakenS * 10) / 10,
        ccTakenPct: Math.round((100 * ccTakenS) / durationS),
        cleanses,
        purges,
        detail: {
          kicksCast: kickCastEvents
            .map((e) => ({
              tS: (e.logLine.timestamp - legacy.startTime) / 1000,
              label: getEnglishSpellName(e.spellId ?? "", e.spellName ?? ""),
            }))
            .sort((a, b) => a.tS - b.tS),
          kicksTaken: cc.interruptInstances
            .map((i) => ({
              tS: i.atSeconds,
              label: `${i.kickSpellName} 打断 ${i.interruptedSpellName}(${i.sourceName})`,
            }))
            .sort((a, b) => a.tS - b.tS),
          ccTaken: cc.ccInstances
            .map((i) => ({
              tS: i.atSeconds,
              label: `${i.spellName} ${i.durationSeconds.toFixed(1)}s(${i.sourceName})`,
            }))
            .sort((a, b) => a.tS - b.tS),
        },
      });
    }
    // 己方在前,组内按被控时长降序(最被针对的最上)
    return rows.sort(
      (a, b) =>
        (a.reaction === "Friendly" ? 0 : 1) -
          (b.reaction === "Friendly" ? 0 : 1) || b.ccTakenS - a.ccTakenS,
    );
  } catch {
    return [];
  }
}
