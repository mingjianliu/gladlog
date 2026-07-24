import {
  buildAuraIntervals,
  getEnglishSpellName,
  SPELL_CATEGORIES,
  type IAuraInterval,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { overlapSeconds, rangeDurationS, type TimeRange } from "./timeRange";

/** 覆盖并集:同一 spellId 可能有多来源的重叠区间(双方同职业互相上同名
 * buff),uptime 是「身上挂着的时间」,重叠段不能重复计 —— 先并后量。 */
export function mergeCoverage(
  intervals: { fromS: number; toS: number }[],
): { fromS: number; toS: number }[] {
  const sorted = [...intervals].sort((a, b) => a.fromS - b.fromS);
  const out: { fromS: number; toS: number }[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.fromS <= last.toS) {
      last.toS = Math.max(last.toS, iv.toS);
    } else {
      out.push({ fromS: iv.fromS, toS: iv.toS });
    }
  }
  return out;
}
import type { ReportSource } from "./types";

/** 每单位最多展示的光环行数(按窗口内 uptime 降序取头部)。 */
const MAX_ROWS_PER_UNIT = 6;
/** 低于该窗口占比的行不展示(噪声地板)。 */
const MIN_UPTIME_PCT = 2;

/** 进 uptime 卡的光环类别 → 渲染色系(复用 analysis 的分类白名单,
 * 渲染层不造第二套)。 */
const CATEGORY_KIND: Record<string, "offense" | "defense" | "cc"> = {
  buffs_offensive: "offense",
  debuffs_offensive: "offense",
  buffs_defensive: "defense",
  immunities: "defense",
  cc: "cc",
  roots: "cc",
  disarms: "cc",
};

export interface AuraUptimeRow {
  unitId: string;
  unitName: string;
  classId: number;
  reaction: "Friendly" | "Hostile";
  spellId: string;
  spellName: string;
  kind: "offense" | "defense" | "cc";
  intervals: IAuraInterval[];
  /** 窗口内 uptime 秒数与占比(时间窗联动①:overlapSeconds 同谓词)。 */
  uptimeS: number;
  uptimePct: number;
  applications: number;
  hasInferred: boolean;
}

export interface AuraUptime {
  rows: AuraUptimeRow[];
  durationS: number;
}

/**
 * 光环 uptime(第四阶段④,WCL Buffs/Debuffs uptime 条的竞技场版):
 * 每玩家身上的 进攻增益/防御/控制 光环区间与窗口内占比。区间配对消费
 * analysis 的 buildAuraIntervals(谓词单源);推断段(开局已挂/未见掉落)
 * 由渲染层画成虚线,不冒充观测。
 */
export function deriveAuraUptime(
  source: ReportSource,
  range?: TimeRange | null,
): AuraUptime {
  try {
    const legacy = toLegacySafe(source);
    const durationS = Math.max(
      1e-6,
      (legacy.endTime - legacy.startTime) / 1000,
    );
    const windowS = rangeDurationS(legacy, range);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const rows: AuraUptimeRow[] = [];

    for (const p of players) {
      const bydSpell = new Map<string, IAuraInterval[]>();
      for (const iv of buildAuraIntervals(p, legacy)) {
        const kind = CATEGORY_KIND[SPELL_CATEGORIES[iv.spellId]?.type ?? ""];
        if (!kind) continue;
        const list = bydSpell.get(iv.spellId) ?? [];
        list.push(iv);
        bydSpell.set(iv.spellId, list);
      }
      const unitRows: AuraUptimeRow[] = [];
      for (const [spellId, intervals] of bydSpell) {
        const uptimeS = mergeCoverage(intervals).reduce(
          (s, iv) => s + overlapSeconds(iv.fromS, iv.toS - iv.fromS, range),
          0,
        );
        const uptimePct = (100 * uptimeS) / windowS;
        if (uptimePct < MIN_UPTIME_PCT) continue;
        unitRows.push({
          unitId: p.id,
          unitName: p.name,
          classId: Number(p.class),
          reaction:
            p.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Hostile",
          spellId,
          spellName: getEnglishSpellName(
            spellId,
            intervals[0]?.spellName ?? "",
          ),
          kind: CATEGORY_KIND[SPELL_CATEGORIES[spellId]!.type]!,
          intervals,
          uptimeS: Math.round(uptimeS * 10) / 10,
          uptimePct: Math.round(uptimePct),
          applications: intervals.length,
          hasInferred: intervals.some(
            (iv) => iv.inferredStart || iv.inferredEnd,
          ),
        });
      }
      unitRows.sort((a, b) => b.uptimeS - a.uptimeS);
      rows.push(...unitRows.slice(0, MAX_ROWS_PER_UNIT));
    }

    rows.sort(
      (a, b) =>
        (a.reaction === "Friendly" ? 0 : 1) -
          (b.reaction === "Friendly" ? 0 : 1) ||
        a.unitName.localeCompare(b.unitName) ||
        b.uptimeS - a.uptimeS,
    );
    return { rows, durationS };
  } catch {
    return { rows: [], durationS: 1 };
  }
}
