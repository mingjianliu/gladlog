import {
  analyzeOutgoingCCChains,
  type IOutgoingCCApplication,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { sourceMemo } from "./sourceMemo";
import { overlapSeconds, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

export interface CCChainRow {
  targetName: string;
  targetSpec: string;
  /** Used for classColor; resolved from legacy.units by target name and left
   * empty when not found (no colour dot is drawn). */
  targetClassId?: number;
  chainLen: number;
  totalCcSeconds: number;
  /** Whether the chain contains an application landing on the 25% DR tier or
   * on immunity (wasted CC). */
  wasted: boolean;
  apps: IOutgoingCCApplication[];
}

const EMPTY: { rows: CCChainRow[] } = { rows: [] };

/**
 * Enemy CC chain panel (#10 T5): an aggregation of the CC chains our side
 * applied to each enemy target, with DR-degraded / immune applications flagged
 * red. Every decision consumes analysis' analyzeOutgoingCCChains (the same
 * predicate as the timeline's [DR] annotation) — drAnalysis.ts:311-318
 * explicitly forbids filtering by DR tier, so nothing is filtered here either;
 * the aggregation happens purely in the presentation layer.
 *
 * range (time-window linkage ①): the DR sequence is computed over the full
 * stream (so chain length / degradation decisions are unaffected by window
 * boundaries — otherwise the first application inside the window would be
 * misjudged as Full), and only then are the apps filtered for display. A CC
 * application is a "duration fact" (it has atSeconds + durationSeconds), so it
 * is judged by overlapping seconds using timeRange.ts's predicate (the same
 * predicate as statsTable.ts's CC instance filtering/timing), NOT by the
 * instantaneous tInRange: otherwise an application starting outside the window
 * but mostly inside it would be dropped whole (caught by the agy flash review
 * and adopted).
 */
function deriveCCChainDashUncached(
  source: ReportSource,
  range?: TimeRange | null,
): { rows: CCChainRow[] } {
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

    const classIdByName = new Map(
      Object.values(legacy.units).map((u) => [u.name, Number(u.class)]),
    );

    const chains = analyzeOutgoingCCChains(friends, enemies, legacy);
    const rows: CCChainRow[] = [];
    for (const chain of chains) {
      // Any overlap > 0 counts (a boundary-crossing application does not vanish
      // whole — consistent with statsTable.ts's CC instance accounting); apps
      // keep each application's original durationSeconds (the per-row detail
      // must show the true duration, not the window-clipped fragment), and only
      // the aggregate column totalCcSeconds accumulates the overlapping part.
      const apps = chain.applications.filter(
        (a) => overlapSeconds(a.atSeconds, a.durationSeconds, range) > 0,
      );
      if (apps.length === 0) continue;
      rows.push({
        targetName: chain.targetName,
        targetSpec: chain.targetSpec,
        targetClassId: classIdByName.get(chain.targetName),
        chainLen: apps.length,
        totalCcSeconds: apps.reduce(
          (sum, a) =>
            sum + overlapSeconds(a.atSeconds, a.durationSeconds, range),
          0,
        ),
        wasted: apps.some(
          (a) => a.drInfo.level === "25%" || a.drInfo.level === "Immune",
        ),
        apps,
      });
    }
    return { rows: rows.sort((a, b) => b.chainLen - a.chainLen) };
  } catch {
    return EMPTY;
  }
}

/** deriveCCChainDashUncached; the whole-match call (no range) is kept per source object
 * across mounts (see sourceMemo.ts). */
export function deriveCCChainDash(
  source: ReportSource,
  range?: TimeRange | null,
): ReturnType<typeof deriveCCChainDashUncached> {
  if (range != null) return deriveCCChainDashUncached(source, range);
  return sourceMemo(source, "deriveCCChainDash", () => deriveCCChainDashUncached(source, range));
}
