import { SPELL_CATEGORIES, SPELL_ICONS_GENERATED } from "@gladlog/analysis";

import type { ReportSource } from "./types";

export interface CastRow {
  t: number;
  spellId: number;
  spellName: string;
  targetName: string;
  byPet: boolean;
  /** 图标基名(挖掘表 spellIconsGenerated);缺表项 undefined → 首字母 fallback。 */
  icon?: string;
}
export interface AuraRow {
  t: number;
  spellId: number;
  spellName: string;
  auraType: "BUFF" | "DEBUFF";
  applied: boolean;
}

/** 一条单位事件:施法 或 重要光环(curated PvP 分类内的光环)。 */
export type UnitEvent =
  ({ kind: "cast" } & CastRow) | ({ kind: "aura"; category: string } & AuraRow);

/** 该光环是否属于 curated PvP 分类集(CC/定身/免疫/防御CD/进攻CD/缴械/打断…)。 */
export function auraCategory(spellId: number): string | undefined {
  return SPELL_CATEGORIES[String(spellId)]?.type;
}

/** 该施法是否为大招/关键 CD(免疫/防御CD/进攻CD/缴械),用于 GCD 泳道高亮。 */
const MAJOR_CD_TYPES = new Set([
  "immunities",
  "buffs_defensive",
  "buffs_offensive",
  "disarms",
]);
export function isMajorCd(spellId: number): boolean {
  const c = auraCategory(spellId);
  return c != null && MAJOR_CD_TYPES.has(c);
}

export function deriveCasts(m: ReportSource, unitId: string): CastRow[] {
  const u = m.units[unitId];
  if (!u) return [];
  const row =
    (byPet: boolean) =>
    (e: (typeof u.casts)[number]): CastRow => ({
      t: e.timestamp,
      spellId: e.spellId,
      spellName: e.spellName,
      targetName: e.destName,
      byPet,
      icon: SPELL_ICONS_GENERATED[String(e.spellId)],
    });
  return [...u.casts.map(row(false)), ...u.petCasts.map(row(true))].sort(
    (a, b) => a.t - b.t,
  );
}

export function deriveAuraEvents(m: ReportSource, unitId: string): AuraRow[] {
  const u = m.units[unitId];
  if (!u) return [];
  return [...u.auraEvents]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => ({
      t: e.timestamp,
      spellId: e.spellId,
      spellName: e.spellName,
      auraType: e.auraType,
      applied: !e.eventName.includes("REMOVED"),
    }));
}

/**
 * 合并「施法 + 重要光环」为一条按时间升序的事件流。
 * 光环只保留 curated PvP 分类内的(过滤掉杂噪 proc / 小 buff)。
 */
export function deriveUnitTimeline(
  m: ReportSource,
  unitId: string,
): UnitEvent[] {
  const casts: UnitEvent[] = deriveCasts(m, unitId).map((c) => ({
    kind: "cast",
    ...c,
  }));
  const auras: UnitEvent[] = [];
  for (const a of deriveAuraEvents(m, unitId)) {
    const category = auraCategory(a.spellId);
    if (!category) continue;
    auras.push({ kind: "aura", category, ...a });
  }
  return [...casts, ...auras].sort((a, b) => a.t - b.t);
}
