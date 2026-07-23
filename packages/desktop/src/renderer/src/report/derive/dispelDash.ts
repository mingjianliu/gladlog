import {
  annotateMissedPurgesWithKillWindows,
  computeOffensiveWindows,
  getEnglishSpellName,
  reconstructDispelSummary,
  type ICCEfficiencyStat,
  type IDispelEvent,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { tInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

/** 单条驱散/漏驱散实例(行展开与列表用);tS = 相对秒。 */
export interface DispelInstance {
  tS: number;
  label: string;
  /** ▶ 跳转的镜头单位(施放者或目标)。 */
  unitName: string;
}

export interface DispelDashRow {
  unitId: string;
  name: string;
  classId: number;
  reaction: "Friendly" | "Hostile";
  /** 给队友解 debuff。 */
  cleanses: number;
  /** 进攻驱散(purge)。 */
  purges: number;
  /** 偷 buff(SPELL_STOLEN)。 */
  steals: number;
  events: DispelInstance[];
}

export interface DispelDash {
  rows: DispelDashRow[];
  /** 我方漏掉的进攻驱散机会(敌方 Critical/High 增益坐了 >3s)。 */
  missedPurges: DispelInstance[];
  /** 我方漏掉的解控/解 debuff 窗口。 */
  missedCleanses: DispelInstance[];
  /** 每个友方目标的可解 CC 解除率(analysis ccEfficiency)。 */
  ccEfficiency: ICCEfficiencyStat[];
}

const EMPTY: DispelDash = {
  rows: [],
  missedPurges: [],
  missedCleanses: [],
  ccEfficiency: [],
};

const fmtName = (id: string, fallback: string): string =>
  getEnglishSpellName(id, fallback);

/**
 * 驱散仪表盘(backlog #3):完成的账目(purge/解/偷,双向)+ 漏掉的机会
 * (missedPurgeWindows / missedCleanseWindows / ccEfficiency)。判定全部消费
 * analysis 的 reconstructDispelSummary —— 与 prompt 侧 [MISSED PURGE
 * OPPORTUNITY]/[CLEANSE] 同一谓词,渲染层不重造白名单。
 */
/** range(时间窗联动①):账目/漏机会按事实时刻过滤;ccEfficiency 是全场聚合
 * (analysis 不带逐窗时刻),窗口激活时由组件标注「全场口径」。 */
export function deriveDispelDash(
  source: ReportSource,
  range?: TimeRange | null,
): DispelDash {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friends.length === 0 || enemies.length === 0) return EMPTY;
    const combatLike = { startTime: legacy.startTime, endTime: legacy.endTime };

    // 双向各建一次(与 statsTable 同法);宠物驱散归主(B45)走 pets 参数
    const petsOf = (owners: typeof players) => {
      const ids = new Set(owners.map((o) => o.id));
      return Object.values(legacy.units).filter(
        (u) => u.ownerId && ids.has(u.ownerId),
      );
    };
    const ours = reconstructDispelSummary(
      friends,
      enemies,
      combatLike,
      petsOf(friends),
      petsOf(enemies),
    );
    const theirs = reconstructDispelSummary(
      enemies,
      friends,
      combatLike,
      petsOf(enemies),
      petsOf(friends),
    );
    // 漏 purge 标注是否落在我方 kill window 内(与 prompt 侧同一标注谓词)
    const windows = computeOffensiveWindows(enemies, friends, legacy);
    annotateMissedPurgesWithKillWindows(ours.missedPurgeWindows, windows);

    const toInstance = (d: IDispelEvent): DispelInstance => ({
      tS: d.timeSeconds,
      label: `${fmtName(d.dispelSpellId, d.dispelSpellName)} ${
        d.isSpellSteal ? "偷走" : "驱散"
      } ${fmtName(d.removedSpellId, d.removedSpellName)}(${d.targetName})${
        d.wasFatal ? " ☠致命" : ""
      }`,
      unitName: d.sourceName,
    });

    const rows: DispelDashRow[] = [];
    for (const p of players) {
      const side = p.reaction === CombatUnitReaction.Friendly ? ours : theirs;
      const cleanse = side.allyCleanse.filter(
        (d) => d.sourceName === p.name && tInRange(d.timeSeconds, range),
      );
      const purge = side.ourPurges.filter(
        (d) => d.sourceName === p.name && tInRange(d.timeSeconds, range),
      );
      if (cleanse.length + purge.length === 0) continue;
      rows.push({
        unitId: p.id,
        name: p.name,
        classId: Number(p.class),
        reaction:
          p.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Hostile",
        cleanses: cleanse.length,
        purges: purge.filter((d) => !d.isSpellSteal).length,
        steals: purge.filter((d) => d.isSpellSteal).length,
        events: [...cleanse, ...purge]
          .map(toInstance)
          .sort((a, b) => a.tS - b.tS),
      });
    }
    rows.sort(
      (a, b) =>
        (a.reaction === "Friendly" ? 0 : 1) -
          (b.reaction === "Friendly" ? 0 : 1) ||
        b.cleanses + b.purges + b.steals - (a.cleanses + a.purges + a.steals),
    );

    const missedPurges: DispelInstance[] = ours.missedPurgeWindows
      .filter((w) => tInRange(w.timeSeconds, range))
      .map((w) => ({
        tS: w.timeSeconds,
        label: `${fmtName(w.spellId, w.spellName)} 挂在 ${w.enemyName} 身上 ${Math.round(
          w.durationSeconds,
        )}s 未被驱散${w.duringKillWindow ? "(我方击杀窗口内)" : ""}${
          w.purgeWasOnCD ? "(驱散在 CD)" : ""
        }`,
        unitName: w.enemyName,
      }))
      .sort((a, b) => a.tS - b.tS);

    const missedCleanses: DispelInstance[] = ours.missedCleanseWindows
      .filter((w) => tInRange(w.timeSeconds, range))
      .map((w) => ({
        tS: w.timeSeconds,
        label: `${w.targetName} 挂 ${fmtName(w.spellId, w.spellName)} ${Math.round(
          w.durationSeconds,
        )}s 未被解${w.cleanseWasOnCD ? "(解法在 CD)" : ""}`,
        unitName: w.targetName,
      }))
      .sort((a, b) => a.tS - b.tS);

    return {
      rows,
      missedPurges,
      missedCleanses,
      ccEfficiency: ours.ccEfficiency,
    };
  } catch {
    return EMPTY;
  }
}
