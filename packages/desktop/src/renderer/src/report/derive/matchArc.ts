import {
  extractMajorCooldowns,
  reconstructEnemyCDTimeline,
  specToString,
} from "@gladlog/analysis";
import {
  buildMatchArcStructured,
  type IMatchArcPhase,
} from "@gladlog/analysis/src/context/matchNarrative";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { resolveOwner } from "./analysisInput";
import { toLegacySafe } from "./legacySource";
import { sourceMemo } from "./sourceMemo";
import type { ReportSource } from "./types";

/**
 * The match-tempo header row (#10 T4). Its only job is assembling the
 * arguments for T1's `buildMatchArcStructured` — the same
 * legacy/owner/friends/enemies assembly pattern as keyMoments.ts (:129 the
 * enemy CD timeline, :149 extractMajorCooldowns per friendly) — while the
 * logic that decides phase boundaries and turning points is single-sourced in
 * buildMatchArcStructured and is not recomputed here.
 *
 * stub-safe: any failure along the way (missing field / bad fixture) is
 * swallowed and returns [] — the header row is a bonus and must never take
 * down the whole report page.
 */
function deriveMatchArcUncached(source: ReportSource): IMatchArcPhase[] {
  try {
    const legacy = toLegacySafe(source);
    const units = Object.values(legacy.units);
    const players = units.filter((u) => u.info);
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction !== CombatUnitReaction.Friendly,
    );
    // agy review: owner resolution reuses resolveOwner from analysisInput.ts
    // (single-source predicate) — it adds a reaction===Friendly check and a
    // healer fallback over a bare find(id===playerId), and it is the same
    // "who is the owner" predicate as buildAnalysisInput /
    // buildWindowAnalysisRequest. Do not start a second one here.
    const owner = resolveOwner(legacy) ?? friends[0];

    const enemyCDTimeline = reconstructEnemyCDTimeline(
      enemies,
      legacy,
      owner,
      friends,
    );
    const allTeamCooldownsWithPlayer = friends.flatMap((u) =>
      extractMajorCooldowns(u, legacy).map((cd) => ({ player: u, cd })),
    );
    // Same friendlyDeaths predicate as buildMatchContext.ts (the gate
    // predicate is the spec):
    // filter(deathRecords.length>0).flatMap(...).sort(atSeconds).
    const friendlyDeaths = friends
      .filter((u) => (u.deathRecords ?? []).length > 0)
      .flatMap((u) =>
        (u.deathRecords ?? []).map((d) => ({
          spec: specToString(u.spec),
          atSeconds: (d.timestamp - legacy.startTime) / 1000,
        })),
      )
      .sort((a, b) => a.atSeconds - b.atSeconds);
    const durationSeconds = (legacy.endTime - legacy.startTime) / 1000;

    return buildMatchArcStructured(
      enemyCDTimeline,
      allTeamCooldownsWithPlayer,
      friendlyDeaths,
      durationSeconds,
      legacy.startInfo.bracket,
    );
  } catch {
    return [];
  }
}

/** deriveMatchArcUncached, kept per source object across mounts (see sourceMemo.ts). */
export function deriveMatchArc(source: ReportSource): ReturnType<typeof deriveMatchArcUncached> {
  return sourceMemo(source, "deriveMatchArc", () => deriveMatchArcUncached(source));
}
