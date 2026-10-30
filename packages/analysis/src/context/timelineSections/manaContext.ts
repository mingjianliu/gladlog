/**
 * Mana context for long matches (F144) — in matches over five minutes, the
 * mana markers (via emitManaMarkerEntries) for the friendly and enemy units.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { emitManaMarkerEntries } from "../matchTimelineSections";
import type { TimelineCtx } from "./ctx";

export function emitManaContextEntries(
  ctx: Pick<
    TimelineCtx,
    | "matchDurationS"
    | "owner"
    | "friends"
    | "enemies"
    | "matchStartMs"
    | "friendlyDeathAtByName"
    | "enemyDeathAtByName"
    | "pid"
    | "enemyPid"
    | "addEntry"
    | "manaFallback"
  >,
): void {
  const {
    matchDurationS,
    owner,
    friends,
    enemies,
    matchStartMs,
    friendlyDeathAtByName,
    enemyDeathAtByName,
    pid,
    enemyPid,
    addEntry,
    manaFallback,
  } = ctx;

  if (matchDurationS > 300) {
    emitManaMarkerEntries({
      owner,
      friends,
      enemies: enemies ?? [],
      matchStartMs,
      matchDurationS,
      friendlyDeathAtByName,
      enemyDeathAtByName,
      pid,
      enemyPid,
      addEntry,
      manaFallback,
    });
  }
}
