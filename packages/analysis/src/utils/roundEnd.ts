/**
 * roundEnd.ts — when a round ends, for everything that pairs an event with a
 * removal or a later event (triage 2026-09-29: CROSS-THEME §3 "Round end").
 *
 * A Solo Shuffle round is over at its first player death; the log keeps going
 * until `ARENA_MATCH_END` (the next round's prep, the scoreboard). A CC that
 * was still up then paired with a removal logged after it and printed its
 * full length (ba8c0510: a Polymorph that ran 0.6 s in the round read "6s" and
 * an uncleansed window), and healer activity logged after it closed a healing
 * gap that never was. Leaf module: `ccTrinketAnalysis`, `dispelAnalysis`,
 * `healingGaps` and the candidate layer all read it.
 */

/** Solo Shuffle only: the round-ending (first) player death, epoch ms, or
 * undefined for other brackets / a round with no player death. The one
 * definition behind `afterShuffleRoundEnd` and the owner gate's round-end
 * clip (moved here from candidateFindings.ts, which re-exports it). */
export function shuffleRoundEndMs(
  combat: { startInfo?: { bracket?: string } } | undefined,
  units: ReadonlyArray<{
    info?: unknown;
    deathRecords?: ReadonlyArray<{ timestamp?: number }>;
  }>,
): number | undefined {
  if (combat?.startInfo?.bracket !== "Rated Solo Shuffle") return undefined;
  let firstDeathMs = Infinity;
  for (const u of units) {
    if (!u.info) continue;
    for (const d of u.deathRecords ?? [])
      firstDeathMs = Math.min(firstDeathMs, d.timestamp ?? 0);
  }
  return Number.isFinite(firstDeathMs) ? firstDeathMs : undefined;
}

/**
 * The round's end, epoch ms: a Solo Shuffle round's ending death, else the
 * combat's end (`ARENA_MATCH_END`). `units` defaults to `combat.units` — the
 * round's every unit, players filtered by `info`. The one round end of cc-dr
 * F-CI1 (`[CC ON TEAM]` / `[CC ON ENEMY]` windows), missed-cleanse F-C3
 * (uncleansed windows) and cc-dr F-HG1 (healing gaps): events at or after it
 * are not in the round.
 */
export function roundEndMs(
  combat: {
    endTime: number;
    startInfo?: { bracket?: string };
    units?: Record<string, unknown> | ReadonlyArray<unknown>;
  },
  units?: ReadonlyArray<{
    info?: unknown;
    deathRecords?: ReadonlyArray<{ timestamp?: number }>;
  }>,
): number {
  const all =
    units ??
    ((combat.units ? Object.values(combat.units) : []) as ReadonlyArray<{
      info?: unknown;
      deathRecords?: ReadonlyArray<{ timestamp?: number }>;
    }>);
  return shuffleRoundEndMs(combat, all) ?? combat.endTime;
}
