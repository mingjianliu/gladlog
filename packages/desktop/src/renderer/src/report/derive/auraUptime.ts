import {
  buildAuraIntervals,
  type IAuraInterval,
  SPELL_CATEGORIES,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { displaySpellName } from "./spellDisplay";
import { overlapSeconds, rangeDurationS, type TimeRange } from "./timeRange";

/** Union of coverage: one spellId can have overlapping intervals from several
 * sources (two players of the same class applying the same-named buff), and
 * uptime means "time the aura was on the unit", so overlaps must not be double
 * counted — merge first, then measure. */
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

/** Maximum aura rows shown per unit (the top rows by in-window uptime,
 * descending). */
const MAX_ROWS_PER_UNIT = 6;
/** Rows below this share of the window are not shown (noise floor). */
const MIN_UPTIME_PCT = 2;

/** Aura categories that enter the uptime card → render color family (reuses
 * analysis's category whitelist; the render layer does not build a second
 * one). */
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
  /** In-window uptime, in seconds and as a share (time-window linkage ①: the
   * same overlapSeconds predicate). */
  uptimeS: number;
  uptimePct: number;
  applications: number;
  hasInferred: boolean;
}

/** Grouped by unit (P1-2): a group header plus its rows; low-share rows beyond
 * MAX_ROWS_PER_UNIT go into hiddenRows (expanded by clicking the "+N lower
 * uptime auras" affordance at the end of the group). */
export interface AuraUnitGroup {
  unitId: string;
  unitName: string;
  classId: number;
  reaction: "Friendly" | "Hostile";
  rows: AuraUptimeRow[];
  hiddenRows: AuraUptimeRow[];
}

export interface AuraUptime {
  groups: AuraUnitGroup[];
  durationS: number;
}

/**
 * Aura uptime (phase four ④, the arena counterpart of WCL's Buffs/Debuffs
 * uptime bars): each player's offensive-buff / defensive / CC aura intervals
 * and their share of the window. Interval pairing consumes analysis's
 * buildAuraIntervals (single-source predicate); inferred segments (already up
 * at the start / never seen dropping) are drawn dashed by the render layer and
 * never pass themselves off as observations.
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
    const groups: AuraUnitGroup[] = [];

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
          spellName: displaySpellName(spellId, intervals[0]?.spellName ?? ""),
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
      if (unitRows.length === 0) continue;
      unitRows.sort((a, b) => b.uptimeS - a.uptimeS);
      groups.push({
        unitId: p.id,
        unitName: p.name,
        classId: Number(p.class),
        reaction:
          p.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Hostile",
        rows: unitRows.slice(0, MAX_ROWS_PER_UNIT),
        hiddenRows: unitRows.slice(MAX_ROWS_PER_UNIT),
      });
    }

    groups.sort(
      (a, b) =>
        (a.reaction === "Friendly" ? 0 : 1) -
          (b.reaction === "Friendly" ? 0 : 1) ||
        a.unitName.localeCompare(b.unitName),
    );
    return { groups, durationS };
  } catch {
    return { groups: [], durationS: 1 };
  }
}
