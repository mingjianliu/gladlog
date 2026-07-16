import {
  analyzePlayerCCAndTrinket,
  buildDeathOutcomeSummary,
  getEnglishSpellName,
  SPELL_CATEGORIES,
} from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import type { ReportSource } from "./types";

/** 死前回看窗口(秒)。 */
export const DEATH_RECAP_WINDOW_S = 10;

export interface DeathRecapEvent {
  /** 相对秒(自 combat start)。 */
  tS: number;
  kind: "dmg" | "heal" | "cc" | "def_used";
  spell: string;
  amount?: number;
  srcName: string;
}

export interface DeathRecap {
  unitId: string;
  unitName: string;
  /** 死亡时刻,相对秒。 */
  deathS: number;
  /** 死前 DEATH_RECAP_WINDOW_S 秒事件流(升序)。 */
  events: DeathRecapEvent[];
  /** 死亡时刻可用而未按的免疫/保命技(analysis deathOutcome 谓词)。 */
  availableImmunities: Array<{ spellName: string; wasInCC: boolean }>;
  /** 队友可给而没给的外部保命(施法者是否被控)。 */
  missedExternals: Array<{
    casterName: string;
    spellName: string;
    casterWasInCC: boolean;
  }>;
}

const DEF_TYPES = new Set(["immunities", "buffs_defensive"]);

/**
 * 友方每次死亡的回顾(backlog #6)。判定全部消费 analysis 谓词
 * (buildDeathOutcomeSummary / analyzePlayerCCAndTrinket)——渲染层不重造
 * 死亡判定,这是审计里双谓词病的教训。
 */
export function deriveDeathRecaps(source: ReportSource): DeathRecap[] {
  try {
    const legacy = toLegacySafe(source);
    const matchStartMs = legacy.startTime;
    // 覆盖双方死亡:己方死 = 防守复盘,敌方死 = 击杀执行复盘。
    const players = Object.values(legacy.units).filter((u) => u.info);
    if (players.length === 0) return [];

    const combatLike = {
      startTime: legacy.startTime,
      endTime: legacy.endTime,
      startInfo: { zoneId: (legacy as { zoneId?: string }).zoneId ?? "" },
    };
    const allUnits = Object.values(legacy.units);
    const ccSummaries = players.map((p) => {
      const opponents = players.filter((o) => o.reaction !== p.reaction);
      const oppIds = new Set(opponents.map((o) => o.id));
      const oppPets = allUnits.filter(
        (u) => u.ownerId && oppIds.has(u.ownerId),
      );
      return analyzePlayerCCAndTrinket(p, opponents, combatLike, oppPets);
    });
    const outcome = buildDeathOutcomeSummary(legacy, players, ccSummaries);

    const nameOf = (id: string): string => legacy.units[id]?.name ?? "unknown";

    const recaps: DeathRecap[] = [];
    for (const unit of players) {
      for (const death of unit.deathRecords) {
        const deathS = (death.timestamp - matchStartMs) / 1000;
        const fromS = deathS - DEATH_RECAP_WINDOW_S;
        const events: DeathRecapEvent[] = [];

        // 承伤(日志符号约定:原始伤害为负 → Math.abs)
        for (const d of unit.damageIn) {
          const tS = (d.logLine.timestamp - matchStartMs) / 1000;
          if (tS < fromS || tS > deathS) continue;
          events.push({
            tS,
            kind: "dmg",
            spell: getEnglishSpellName(d.spellId ?? "", d.spellName ?? ""),
            amount: Math.abs(d.effectiveAmount),
            srcName: nameOf(d.srcUnitId),
          });
        }
        // 承疗
        for (const h of unit.healIn) {
          const tS = (h.logLine.timestamp - matchStartMs) / 1000;
          if (tS < fromS || tS > deathS) continue;
          if (h.effectiveAmount <= 0) continue;
          events.push({
            tS,
            kind: "heal",
            spell: getEnglishSpellName(h.spellId ?? "", h.spellName ?? ""),
            amount: h.effectiveAmount,
            srcName: nameOf(h.srcUnitId),
          });
        }
        // 身上被贴的控制(curated cc 分类)
        for (const a of unit.auraEvents) {
          if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
          if (SPELL_CATEGORIES[a.spellId ?? ""]?.type !== "cc") continue;
          const tS = (a.logLine.timestamp - matchStartMs) / 1000;
          if (tS < fromS || tS > deathS) continue;
          events.push({
            tS,
            kind: "cc",
            spell: getEnglishSpellName(a.spellId ?? "", a.spellName ?? ""),
            srcName: nameOf(a.srcUnitId),
          });
        }
        // 自己按下的防御技
        for (const c of unit.spellCastEvents) {
          if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
          if (!DEF_TYPES.has(SPELL_CATEGORIES[c.spellId ?? ""]?.type ?? ""))
            continue;
          const tS = (c.logLine.timestamp - matchStartMs) / 1000;
          if (tS < fromS || tS > deathS) continue;
          events.push({
            tS,
            kind: "def_used",
            spell: getEnglishSpellName(c.spellId ?? "", c.spellName ?? ""),
            srcName: unit.name,
          });
        }
        events.sort((a, b) => a.tS - b.tS);

        // deathOutcome 事件按 (名字, 秒) 对齐
        const oc = outcome.events.find(
          (e) =>
            e.deadPlayer === unit.name && Math.abs(e.atSeconds - deathS) < 1,
        );

        recaps.push({
          unitId: unit.id,
          unitName: unit.name,
          deathS,
          events,
          availableImmunities: (oc?.availableImmunities ?? []).map((i) => ({
            spellName: i.spellName,
            wasInCC: i.wasInCC,
          })),
          missedExternals: (oc?.missedExternals ?? []).map((m) => ({
            casterName: m.casterName,
            spellName: m.spellName,
            casterWasInCC: m.casterWasInCC,
          })),
        });
      }
    }
    return recaps.sort((a, b) => a.deathS - b.deathS);
  } catch {
    return [];
  }
}
