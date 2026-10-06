/**
 * [UNIT DESTROYED] — non-player deaths (totems, pets, guardians): who owned
 * them, what killed them, and how long a summon lived.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { fmtTime } from "../../utils/renderGrid";
import {
  SUMMON_REACH_MIN_S,
  summonReach,
} from "../../utils/summonReachability";
import {
  CONTESTABLE_ENEMY_SUMMON_NPC_IDS,
  CRITICAL_NON_PLAYER_NPC_NAMES,
  damageEventLabel,
  getNpcIdFromGuid,
  getTopDamageSourcesInWindow,
  isCriticalNonPlayerUnit,
  nonPlayerUnitKill,
  opposingHitsOnUnit,
  resolveSummonOwner,
  summonedAtMs,
  summonLifetimeAtKillS,
} from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

export function emitUnitDestroyedEntries(
  ctx: Pick<
    TimelineCtx,
    | "allUnits"
    | "matchEndMs"
    | "matchStartMs"
    | "enemyPid"
    | "friends"
    | "pid"
    | "enemies"
    | "params"
    | "addEntry"
    | "playerIdMap"
    | "enemyIdMap"
    | "summonOwners"
    | "unitNames"
    | "rosterSides"
  >,
): void {
  const {
    allUnits,
    matchEndMs,
    matchStartMs,
    enemyPid,
    friends,
    pid,
    enemies,
    params,
    addEntry,
    playerIdMap,
    enemyIdMap,
    summonOwners,
    unitNames,
    rosterSides,
  } = ctx;

  if (allUnits) {
    const durationS = (matchEndMs - matchStartMs) / 1000;
    for (const unit of allUnits) {
      if (!isCriticalNonPlayerUnit(unit)) continue;
      const kill = nonPlayerUnitKill(unit);
      if (!kill) {
        // GH #100 / BACKLOG #51 (user ruling 2026-09-20): an ENEMY summon a
        // team is expected to kill, that was NOT killed — say how much the
        // owner's team hit it. A fact; no lifetime is claimed (the log has no
        // despawn event) and nothing here says anyone should have done more.
        const npcId = getNpcIdFromGuid(unit.id) ?? "";
        if (!CONTESTABLE_ENEMY_SUMMON_NPC_IDS.has(npcId)) continue;
        const summonerSide = allUnits.find(
          (u) => u.id === unit.ownerId,
        )?.reaction;
        const unitSide =
          unit.reaction === CombatUnitReaction.Hostile ||
          unit.reaction === CombatUnitReaction.Friendly
            ? unit.reaction
            : summonerSide;
        if (unitSide !== CombatUnitReaction.Hostile) continue;
        const summonMs = summonedAtMs(unit);
        if (summonMs === null) continue;
        const summonS = (summonMs - matchStartMs) / 1000;
        if (summonS < 0 || summonS > durationS) continue;
        const summoner = allUnits.find((u) => u.id === unit.ownerId);
        const by = summoner ? ` (by ${enemyPid(summoner.name)})` : "";
        const { hits, hitters } = opposingHitsOnUnit(unit, unitSide);
        const resolveHitterLabel = (id: string): string => {
          const u = allUnits?.find((x) => x.id === id);
          if (!u) return "[pet]";
          if (friends.some((f) => f.id === u.id)) return pid(u.name);
          const ownerUnit = resolveSummonOwner({
            allUnits,
            friends,
            enemies,
            name: u.name,
            sourceId: u.id,
            side: "friendly",
          });
          if (ownerUnit && friends.some((f) => f.id === ownerUnit.id)) {
            return pid(ownerUnit.name);
          }
          return "[pet]";
        };
        const who = hitters.map(resolveHitterLabel);
        // Feasibility travels with the fact (user-approved 2026-09-20, in
        // place of a separate accusation candidate): who could have hit it,
        // and for how much of its official duration. Absent when nobody had
        // SUMMON_REACH_MIN_S in reach and free — the bare fact then accuses
        // no one.
        const reach = summonReach(
          unit,
          { endTime: matchEndMs, startInfo: { zoneId: params.zoneId } },
          friends,
          enemies ?? [],
        );
        const reachStr =
          reach?.best && reach.best.seconds >= SUMMON_REACH_MIN_S
            ? `; ${pid(reach.best.unit.name)} was in range and free to act for ${reach.best.seconds}s of its ${reach.windowSeconds}s`
            : "";
        addEntry(
          summonS,
          `${fmtTime(summonS)}  [ENEMY SUMMON]   ${CRITICAL_NON_PLAYER_NPC_NAMES[npcId]}${by} — not killed: ` +
            (hits === 0
              ? "0 hits from your team"
              : `hit ${hits}× by ${[...new Set(who)].join(", ")}`) +
            reachStr,
        );
        continue;
      }
      const atSeconds = (kill.timestamp - matchStartMs) / 1000;
      if (atSeconds < 0 || atSeconds > durationS) continue; // Match End cleanup suppression
      // A totem's own flags are sometimes neutral (20 of 3,076 lines rendered
      // "Unknown" on the 605-match acceptance set); its summoner's side is not.
      const side =
        unit.reaction === CombatUnitReaction.Friendly ||
        unit.reaction === CombatUnitReaction.Hostile
          ? unit.reaction
          : allUnits.find((u) => u.id === unit.ownerId)?.reaction;
      const reactionStr =
        side === CombatUnitReaction.Friendly
          ? "Friendly"
          : side === CombatUnitReaction.Hostile
            ? "Enemy"
            : "Unknown";
      let line = `${fmtTime(atSeconds)}  [UNIT DESTROYED]   ${CRITICAL_NON_PLAYER_NPC_NAMES[getNpcIdFromGuid(unit.id) ?? ""] ?? unit.name} (${reactionStr})`;
      // The final blow names the killer exactly. The 10 s top-sources window
      // stays as the fallback for a bare UNIT_DIED; it cannot serve totems,
      // whose damageIn effectiveAmount is zeroed (pet/guardian target).
      if (kill.finalBlow) {
        line += ` killed by: ${damageEventLabel(kill.finalBlow, playerIdMap, enemyIdMap, summonOwners)}`;
      } else {
        const topSources = getTopDamageSourcesInWindow(
          unit,
          kill.timestamp,
          10_000,
          2,
          playerIdMap,
          enemyIdMap,
          summonOwners,
          unitNames,
          rosterSides,
        );
        if (topSources.length > 0)
          line += ` killed by: ${topSources.join(", ")}`;
      }
      // GH #86 (user 2026-09-22): how long it stood — summon to kill. Stated
      // only when the summon is in the log; no "expected" lifetime, ever.
      const stood = summonLifetimeAtKillS(unit, kill);
      if (stood !== null) line += `, ${stood} s after it was summoned`;
      addEntry(atSeconds, line);
    }
  }
}
