import {
  CombatUnitClass,
  CombatUnitSpec,
  IArenaMatch,
  ICombatUnit,
  IShuffleMatch,
  WoWCombatLogParser,
} from "@gladlog/parser-compat";

import { buildAuraIntervals } from "./auraIntervals";

/** In-place replacement for lodash `_.sum` / `_.sumBy` (undefined counts as 0,
 * which for a sum is equivalent to lodash skipping undefined) — pulling in
 * 215KB of lodash for four helper functions is not worth it. */
const sum = (xs: Array<number | undefined>): number =>
  xs.reduce<number>((a, b) => a + (b ?? 0), 0);

const combatUnitSpecReverse: Record<string, string> = {};
const combatUnitClassReverse: Record<string, string> = {};
const specNames: Record<string, string> = {};
const classNames: Record<string, string> = {};
// https://github.com/Microsoft/TypeScript/issues/21935#issuecomment-371583528
Object.keys(CombatUnitSpec).forEach((k) => {
  combatUnitSpecReverse[CombatUnitSpec[k as keyof typeof CombatUnitSpec]] = k;
});
Object.keys(CombatUnitClass).forEach((k) => {
  combatUnitClassReverse[CombatUnitClass[k as keyof typeof CombatUnitClass]] =
    k;
});

Object.keys(CombatUnitSpec).forEach((k) => {
  specNames[CombatUnitSpec[k as keyof typeof CombatUnitSpec]] = k
    .split("_")
    .reverse()
    .join(" ");
});
Object.keys(CombatUnitClass).forEach((k) => {
  classNames[CombatUnitClass[k as keyof typeof CombatUnitClass]] = k
    .split("_")
    .reverse()
    .join(" ");
});

type ParseResult = {
  arenaMatches: IArenaMatch[];
  shuffleMatches: IShuffleMatch[];
};

/**
 * 单条伤害/治疗事件达到多少才算「值得记的一击」。
 *
 * **实测出处**(S2 归档 2026/08 快照(18,134 文件)均匀子样 585 个 / 1,155 回合,2026-08-23,每 97 条抽 1):
 * 伤害事件 n=32,292 —— p25 916 · 中位 3,335 · p75 7,916 · p90 19,083 · p99 71,359;
 * 治疗事件 n=29,816 —— p25 58 · 中位 1,291 · p75 7,077 · p90 17,456 · p99 106,183。
 * 现值 10,000 分别落在**第 79.9 / 81.9 分位** —— 筛掉八成琐碎事件、留下前两成,
 * 是一个有区分度的阈值,故不改值。
 */
export const SIGNIFICANT_DAMAGE_HEAL_THRESHOLD = 10000;

export interface IAuraInterval {
  spellId: string;
  spellName: string;
  /** Raw log source name of the aura (who applied it) — needed to price a
   * talent-shared wall found on somebody other than its caster. */
  srcUnitName: string;
  startMs: number;
  endMs: number;
}

/**
 * Filtered aura intervals in ms shape — 2026-08-21 起是权威构建器
 * `auraIntervals.ts#buildAuraIntervals` 之上的薄适配器(谓词索引「尚未统一」
 * 项收口):此前这里有一份独立实现,与权威版在 dest 过滤 / 逐来源键控 /
 * BACKLOG #28 重复 CLOSE 去重 / 官方时长封顶上各自为政 —— GH #17 的
 * burst-into-immunity 伪影(REMOVED 缺失 + 重新施放的 5s 斗篷拼成 130s
 * 区间)先在本地修了一版,防伪规则现已上移进权威实现(二次 APPLIED 关旧
 * 开新 + lastSeen 封顶锚),本函数只做:白名单过滤 + 相对秒 → 绝对 ms。
 * 语义变化(相对旧独立实现):同一 spellId 不同来源现在是**独立区间**
 * (权威版按 spellId:srcUnitId 键控)——burstLedger 的 overlap 取每区间
 * 独立计算,语义更准非回归。
 */
export function buildFilteredAuraIntervals(
  unit: ICombatUnit,
  spellIds: ReadonlySet<string>,
  combat: { startTime: number; endTime: number },
): IAuraInterval[] {
  return buildAuraIntervals(unit, combat)
    .filter((iv) => spellIds.has(iv.spellId))
    .map((iv) => ({
      spellId: iv.spellId,
      spellName: iv.spellName,
      srcUnitName: iv.srcUnitName,
      startMs: combat.startTime + iv.fromS * 1000,
      endMs: combat.startTime + iv.toS * 1000,
    }))
    .sort((x, y) => x.startMs - y.startMs);
}

export const healerSpecs = [
  CombatUnitSpec.Paladin_Holy,
  CombatUnitSpec.Priest_Discipline,
  CombatUnitSpec.Priest_Holy,
  CombatUnitSpec.Shaman_Restoration,
  CombatUnitSpec.Druid_Restoration,
  CombatUnitSpec.Monk_Mistweaver,
  CombatUnitSpec.Evoker_Preservation,
];
export const tankSpecs = [
  CombatUnitSpec.Druid_Guardian,
  CombatUnitSpec.Monk_Brewmaster,
  CombatUnitSpec.Warrior_Protection,
  CombatUnitSpec.Paladin_Protection,
  CombatUnitSpec.DemonHunter_Vengeance,
  CombatUnitSpec.DeathKnight_Blood,
];

export const tanksOrHealers = [...healerSpecs, ...tankSpecs];

export class Utils {
  public static parseFromStringArray(
    buffer: string[],
    wowVersion: string,
    timezone?: string,
  ): ParseResult {
    const logParser = new WoWCombatLogParser(wowVersion, timezone);

    const results: ParseResult = {
      arenaMatches: [],
      shuffleMatches: [],
    };

    logParser.on("arena_match_ended", (data: IArenaMatch) => {
      results.arenaMatches.push(data);
    });

    logParser.on("solo_shuffle_ended", (data: IShuffleMatch) => {
      results.shuffleMatches.push(data);
    });
    // TODO: handle onError here?

    for (const line of buffer) {
      logParser.parseLine(line);
    }
    logParser.flush();

    return results;
  }

  public static getSpecName(spec: CombatUnitSpec) {
    return specNames[spec];
  }

  public static getClassName(unitClass: CombatUnitClass) {
    return classNames[unitClass];
  }

  public static getSpecClass(spec: CombatUnitSpec): CombatUnitClass {
    switch (spec) {
      case CombatUnitSpec.Druid_Balance:
      case CombatUnitSpec.Druid_Feral:
      case CombatUnitSpec.Druid_Guardian:
      case CombatUnitSpec.Druid_Restoration:
        return CombatUnitClass.Druid;
      case CombatUnitSpec.Hunter_BeastMastery:
      case CombatUnitSpec.Hunter_Marksmanship:
      case CombatUnitSpec.Hunter_Survival:
        return CombatUnitClass.Hunter;
      case CombatUnitSpec.Mage_Arcane:
      case CombatUnitSpec.Mage_Fire:
      case CombatUnitSpec.Mage_Frost:
        return CombatUnitClass.Mage;
      case CombatUnitSpec.Paladin_Holy:
      case CombatUnitSpec.Paladin_Protection:
      case CombatUnitSpec.Paladin_Retribution:
        return CombatUnitClass.Paladin;
      case CombatUnitSpec.Priest_Discipline:
      case CombatUnitSpec.Priest_Holy:
      case CombatUnitSpec.Priest_Shadow:
        return CombatUnitClass.Priest;
      case CombatUnitSpec.Rogue_Assassination:
      case CombatUnitSpec.Rogue_Outlaw:
      case CombatUnitSpec.Rogue_Subtlety:
        return CombatUnitClass.Rogue;
      case CombatUnitSpec.Shaman_Elemental:
      case CombatUnitSpec.Shaman_Enhancement:
      case CombatUnitSpec.Shaman_Restoration:
        return CombatUnitClass.Shaman;
      case CombatUnitSpec.Warlock_Affliction:
      case CombatUnitSpec.Warlock_Demonology:
      case CombatUnitSpec.Warlock_Destruction:
        return CombatUnitClass.Warlock;
      case CombatUnitSpec.Warrior_Arms:
      case CombatUnitSpec.Warrior_Fury:
      case CombatUnitSpec.Warrior_Protection:
        return CombatUnitClass.Warrior;
      case CombatUnitSpec.DeathKnight_Blood:
      case CombatUnitSpec.DeathKnight_Frost:
      case CombatUnitSpec.DeathKnight_Unholy:
        return CombatUnitClass.DeathKnight;
      case CombatUnitSpec.Monk_Brewmaster:
      case CombatUnitSpec.Monk_Mistweaver:
      case CombatUnitSpec.Monk_Windwalker:
        return CombatUnitClass.Monk;
      case CombatUnitSpec.DemonHunter_Havoc:
      case CombatUnitSpec.DemonHunter_Vengeance:
      case CombatUnitSpec.DemonHunter_Devourer:
        return CombatUnitClass.DemonHunter;
      case CombatUnitSpec.Evoker_Devastation:
      case CombatUnitSpec.Evoker_Preservation:
      case CombatUnitSpec.Evoker_Augmentation:
        return CombatUnitClass.Evoker;
      default:
        return CombatUnitClass.None;
    }
  }

  public static getAverageItemLevel(player: ICombatUnit): number {
    // advanced actions contain information about the character's item level. if that's available,
    // we should use that before trying to do our own calculations based on gear.
    const advancedActions = player.advancedActions.filter(
      (action) => (action as any).advancedActorItemLevel > 0,
    );
    if (advancedActions.length > 0) {
      return Math.round(
        sum(advancedActions.map((a) => (a as any).advancedActorItemLevel)) /
          advancedActions.length,
      );
    }

    if (!(player.info?.equipment && player.info.equipment.length >= 16)) {
      return 0;
    }

    // if using offhand weapon this calculation is normal
    if (player.info.equipment[16].id !== "0") {
      return Math.round(sum(player.info.equipment.map((e) => e.ilvl)) / 16);
    }
    // otherwise, the 2h weapon counts as 2 slots with the same ilvl
    return Math.round(
      (player.info.equipment[15].ilvl +
        Math.round(sum(player.info.equipment.map((e) => e.ilvl)))) /
        16,
    );
  }

  public static filterNulls<T>(items: (T | null | undefined)[]): T[] {
    const results: T[] = [];
    items.forEach((i) => {
      if (i) {
        results.push(i);
      }
    });
    return results;
  }

  // The ported-over getSpellIcon/getSpecIcon/getClassIcon were deleted
  // (2026-08-01): nothing in the repo called them, yet they left direct
  // images.wowarenalogs.com links sitting in library code.
  // Icons always go through the main process's iconCache plus the generated
  // icon base-name tables (spellIconsGenerated / specIconsGenerated); see
  // docs/DATA-COMPLIANCE.md.

  public static printCombatNumber(num: number, isCritical = false): string {
    const criticalMarker = "*";

    if (num < 1000) {
      return `${num.toFixed()}${isCritical ? criticalMarker : ""}`;
    }
    if (num < 10000) {
      return `${(num / 1000).toFixed(1)}k${isCritical ? criticalMarker : ""}`;
    }

    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}m${isCritical ? criticalMarker : ""}`;
    }

    return `${(num / 1000).toFixed()}k${isCritical ? criticalMarker : ""}`;
  }
}
