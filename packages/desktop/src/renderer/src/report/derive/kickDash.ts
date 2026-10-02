import { analyzeKickAudit, type IKickAuditEntry } from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { toLegacySafe } from "./legacySource";
import { tInRange, type TimeRange } from "./timeRange";
import type { ReportSource } from "./types";

export interface KickDashRow {
  unitId: string;
  name: string;
  classId: number;
  reaction: "Friendly" | "Hostile";
  landed: number;
  juked: number;
  missed: number;
  /** The kick's own silence went onto a target that was not casting
   *  (Silence, Strangulate): no cast stopped, but not a miss either. */
  silenced: number;
  unknown: number;
  total: number;
  /** landed / (landed+juked+missed+silenced); unknown (old archives with no
   *  cast-bar data) is excluded from the denominator. null = no decidable
   *  kick. A silenced kick stays in the denominator, as it did while the
   *  audit still called it "missed" or "juked" — the rate is unchanged by
   *  the label (the audit says "silenced" only where cast-bar data exists). */
  landedRate: number | null;
  entries: IKickAuditEntry[];
}

/**
 * Interrupt dashboard (backlog #2): the kick audit aggregated per player on both
 * teams. Every judgement is consumed from analysis's analyzeKickAudit (the same
 * predicate as the burst ledger's "interrupt audit") — the ledger only looks at
 * the friendly side and paginates per player, so this adds the enemy side and a
 * whole-match comparison.
 */
/** range (time-window linkage ①): the judgements are computed on the full
 * stream (so landed pairings are unaffected by window boundaries), and only
 * afterwards are the entries filtered by atSeconds — filtering at the fact
 * layer, see derive/timeRange.ts. */
export function deriveKickDash(
  source: ReportSource,
  range?: TimeRange | null,
): KickDashRow[] {
  try {
    const legacy = toLegacySafe(source);
    const players = Object.values(legacy.units).filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    if (friends.length === 0 || enemies.length === 0) return [];

    const rows: KickDashRow[] = [];
    for (const p of players) {
      const opponents =
        p.reaction === CombatUnitReaction.Friendly ? enemies : friends;
      const entries = analyzeKickAudit(p, opponents, legacy).filter((e) =>
        tInRange(e.atSeconds, range),
      );
      if (entries.length === 0) continue;
      const count = (r: IKickAuditEntry["result"]) =>
        entries.filter((e) => e.result === r).length;
      const landed = count("landed");
      const juked = count("juked");
      const missed = count("missed");
      const silenced = count("silenced");
      const decided = landed + juked + missed + silenced;
      rows.push({
        unitId: p.id,
        name: p.name,
        classId: Number(p.class),
        reaction:
          p.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Hostile",
        landed,
        juked,
        missed,
        silenced,
        unknown: count("unknown"),
        total: entries.length,
        landedRate: decided > 0 ? landed / decided : null,
        entries,
      });
    }
    // Our side first, and within each group sorted by cast count descending
    // (the main interrupter on top)
    return rows.sort(
      (a, b) =>
        (a.reaction === "Friendly" ? 0 : 1) -
          (b.reaction === "Friendly" ? 0 : 1) || b.total - a.total,
    );
  } catch {
    return [];
  }
}
