import {
  type BaitedKick,
  type CastCancel,
  ownerCastCancels,
  type RawStreams,
} from "@gladlog/analysis";

import { toLegacySafe } from "./legacySource";
import { type TimeRange, tInRange } from "./timeRange";
import type { ReportSource } from "./types";

export interface CastControlSummary {
  name: string;
  classId: number;
  hardcasts: number;
  cancels: CastCancel[];
  /** Median progress of the cancels that have one, or null. */
  medianCancelPct: number | null;
  /** Enemy SPELL_INTERRUPTs that landed on this player. */
  kicked: number;
  baitedKicks: BaitedKick[];
}

/**
 * The recorder's own cast control for the kick dashboard (user request
 * 2026-09-26 「我都想看看」: the fake-cast habit as a stats-page number). Same
 * predicate as the coach menu's kick-eaten contrast — `ownerCastCancels` —
 * so the dashboard and the prompt can never disagree about a count. Only the
 * player who recorded the log has SPELL_CAST_FAILED, so at most one row; null
 * until the raw streams have loaded (and forever in fixture mode).
 */
export function deriveCastControl(
  source: ReportSource,
  rawStreams: RawStreams | undefined,
  range?: TimeRange | null,
): CastControlSummary | null {
  if (!rawStreams?.available) return null;
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    for (const owner of players) {
      const friends = players.filter((u) => u.reaction === owner.reaction);
      const enemies = players.filter((u) => u.reaction !== owner.reaction);
      const r = ownerCastCancels({
        owner,
        friends,
        enemies,
        combat: legacy,
        rawStreams,
      });
      if (!r) continue;
      const cancels = r.cancels.filter((c) => tInRange(c.cancelS, range));
      const pcts = cancels
        .map((c) => c.progressPct)
        .filter((p): p is number => p !== null)
        .sort((a, b) => a - b);
      const enemyIds = new Set(enemies.map((e) => e.id));
      const kicked = (owner.actionIn ?? []).filter(
        (a) =>
          a.logLine.event === "SPELL_INTERRUPT" &&
          (enemyIds.has(a.srcUnitId) ||
            enemyIds.has(
              (legacy.units[a.srcUnitId] as { ownerId?: string } | undefined)
                ?.ownerId ?? "",
            )) &&
          tInRange((a.timestamp - legacy.startTime) / 1000, range),
      ).length;
      return {
        name: owner.name,
        classId: Number(owner.class),
        hardcasts: r.hardcasts,
        cancels,
        medianCancelPct: pcts.length
          ? pcts[Math.floor(pcts.length / 2)]!
          : null,
        kicked,
        baitedKicks: r.baitedKicks.filter((b) => tInRange(b.atSeconds, range)),
      };
    }
    return null;
  } catch {
    return null;
  }
}
