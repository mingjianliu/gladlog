/**
 * What [STATE] and the mana markers read — the key-moment seconds where [STATE]
 * always renders (deaths, cooldown presses, CC, pressure peaks, cleanses, CC
 * chains), the HP token tables in player-id order (B106), and the name-keyed death
 * times the mana markers take.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`, and the five tables come back to
 * the caller. Output is pinned by the 605-file acceptanceCapture context hash.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { canRemoveFrom } from "../../utils/dispelAnalysis";
import { extractAoeCCEvents } from "../../utils/drAnalysis";
import { DMG_SPIKE_THRESHOLD } from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

export function prepareStateInputs(
  ctx: Pick<
    TimelineCtx,
    | "friendlyDeaths"
    | "enemyDeaths"
    | "ownerCDs"
    | "teammateCDs"
    | "enemyCDTimeline"
    | "ccTrinketSummaries"
    | "pressureWindows"
    | "dispelSummary"
    | "owner"
    | "outgoingCCChains"
    | "playerIdMap"
    | "friends"
    | "pid"
    | "enemyIdMap"
    | "enemies"
    | "enemyPid"
  >,
) {
  const {
    friendlyDeaths,
    enemyDeaths,
    ownerCDs,
    teammateCDs,
    enemyCDTimeline,
    ccTrinketSummaries,
    pressureWindows,
    dispelSummary,
    owner,
    outgoingCCChains,
    playerIdMap,
    friends,
    pid,
    enemyIdMap,
    enemies,
    enemyPid,
  } = ctx;

  // Compile key moment seconds where major events occur
  const keyMomentSeconds = new Set<number>();
  for (const d of friendlyDeaths) keyMomentSeconds.add(Math.floor(d.atSeconds));
  for (const d of enemyDeaths) keyMomentSeconds.add(Math.floor(d.atSeconds));
  for (const cd of ownerCDs) {
    for (const cast of cd.casts)
      keyMomentSeconds.add(Math.floor(cast.timeSeconds));
  }
  for (const { cds } of teammateCDs) {
    for (const cd of cds) {
      for (const cast of cd.casts)
        keyMomentSeconds.add(Math.floor(cast.timeSeconds));
    }
  }
  for (const player of enemyCDTimeline.players) {
    for (const cd of player.offensiveCDs)
      keyMomentSeconds.add(Math.floor(cd.castTimeSeconds));
  }
  for (const summary of ccTrinketSummaries) {
    for (const cc of summary.ccInstances) {
      if (cc.durationSeconds > 0)
        keyMomentSeconds.add(Math.floor(cc.atSeconds));
    }
    for (const t of summary.trinketUseTimes)
      keyMomentSeconds.add(Math.floor(t));
  }
  for (const pw of pressureWindows) {
    if (pw.totalDamage >= DMG_SPIKE_THRESHOLD)
      keyMomentSeconds.add(Math.floor(pw.fromSeconds));
  }
  for (const miss of dispelSummary.missedCleanseWindows) {
    if (
      canRemoveFrom(owner, miss.dispelType, miss.targetCharmed, miss.targetName)
    )
      keyMomentSeconds.add(Math.floor(miss.timeSeconds));
  }
  for (const cleanse of dispelSummary.allyCleanse) {
    keyMomentSeconds.add(Math.floor(cleanse.timeSeconds));
  }
  if (outgoingCCChains && outgoingCCChains.length > 0) {
    for (const event of extractAoeCCEvents(outgoingCCChains)) {
      keyMomentSeconds.add(Math.floor(event.atSeconds));
    }
  }

  // HP ticks use the single radius HP_SAMPLE_RADIUS_MS throughout. A former
  // narrowing to ±1.5s inside critical windows has been removed — see the note
  // under HP_SAMPLE_RADIUS_MS in cooldowns.ts (in short: it did not fix the
  // problem it claimed to fix, it was redundant with the STATE emission gate,
  // and it actively dropped coverage inside critical windows).

  // B106: when a numeric ID map is present, sort HP tokens by player ID so the model
  // can align HP readings with class labels listed elsewhere in player-ID order.
  // Owner is always assigned ID 1 in buildPlayerLoadout, so sorting by ID also satisfies
  // the "owner first" property; fall back to owner-first ordering when no map is provided.
  const friendlyOrdered: ICombatUnit[] = playerIdMap
    ? [...friends].sort((a, b) => {
        const aId = playerIdMap.get(a.name);
        const bId = playerIdMap.get(b.name);
        if (aId === undefined && bId === undefined) return 0;
        if (aId === undefined) return 1;
        if (bId === undefined) return -1;
        return aId - bId;
      })
    : [
        ...friends.filter((u) => u.name === owner.name),
        ...friends.filter((u) => u.name !== owner.name),
      ];

  const friendlyHpUnits: Array<{
    unit: ICombatUnit;
    label: (name: string) => string;
  }> = friendlyOrdered.map((u) => ({
    unit: u,
    label: (name: string) => pid(name),
  }));

  const enemiesOrdered: ICombatUnit[] = enemyIdMap
    ? [...(enemies ?? [])].sort((a, b) => {
        const aId = enemyIdMap.get(a.name);
        const bId = enemyIdMap.get(b.name);
        if (aId === undefined && bId === undefined) return 0;
        if (aId === undefined) return 1;
        if (bId === undefined) return -1;
        return aId - bId;
      })
    : [...(enemies ?? [])];

  const enemyHpUnits: Array<{
    unit: ICombatUnit;
    label: (name: string) => string;
  }> = enemiesOrdered.map((u) => ({
    unit: u,
    label: (name: string) => enemyPid(name),
  }));

  // B42: [STATE] ticks show :dead instead of silently omitting dead players.
  // The [STATE] loop's own predicate is `isDeadAtRenderSecond`
  // (utils/cooldowns.ts), shared with analysis/crisisDecisionPoints.ts's
  // render-grid anchor so the two sides cannot drift apart on "was this unit
  // alive at second s". These name-keyed maps remain for the mana-marker
  // block below (emitManaMarkerEntries), which takes names, not units.
  const friendlyDeathAtByName = new Map<string, number>(
    friendlyDeaths.map((d) => [d.name, d.atSeconds]),
  );
  const enemyDeathAtByName = new Map<string, number>(
    enemyDeaths.map((d) => [d.name, d.atSeconds]),
  );

  // exported: returned to the caller (GH #116)
  return {
    keyMomentSeconds,
    friendlyHpUnits,
    enemyHpUnits,
    friendlyDeathAtByName,
    enemyDeathAtByName,
  };
}
