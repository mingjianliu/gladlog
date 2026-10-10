/**
 * [SILENCE] (reliability round 2 W1b) — silences on players of both sides: who
 * was silenced, by what and by whom, and whether a trinket broke it or how long it
 * lasted.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. `silenceLineCount` is threaded:
 * the caller passes its current value and assigns back the returned one (the
 * [SILENCE] legend reads it). Its only writer is the local `renderSide`, which
 * is declared in the section and only called there (a local-sync closure, so
 * the threaded copy is exact). Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../../data/spellEffectData";
import { auraEndFromLog } from "../../utils/auraEndCause";
import { silenceIntervals } from "../../utils/cannotCastIntervals";
import {
  renderedCcDuration,
  TRINKET_BREAK_AFTER_REMOVAL_MS,
} from "../../utils/ccTrinketAnalysis";
import { pvpTrinketUses } from "../../utils/pvpTrinketUses";
import { fmtTime } from "../../utils/renderGrid";
import {
  formatPressedDuringNote,
  ownerControlPressKit,
  ownerPressesRejectedDuring,
} from "../controlRejectedPresses";
import type { TimelineCtx } from "./ctx";

export function emitSilenceEntries(
  ctx: Pick<
    TimelineCtx,
    | "allUnits"
    | "friends"
    | "enemies"
    | "ccTrinketSummaries"
    | "matchStartMs"
    | "matchEndMs"
    | "pid"
    | "enemyPid"
    | "actorLabel"
    | "addEntry"
    | "silenceLineCount"
    | "owner"
    | "ownerCDs"
    | "rawStreams"
  >,
): Pick<TimelineCtx, "silenceLineCount"> {
  const {
    owner,
    ownerCDs,
    rawStreams,
    allUnits,
    friends,
    enemies,
    ccTrinketSummaries,
    matchStartMs,
    matchEndMs,
    pid,
    enemyPid,
    actorLabel,
    addEntry,
  } = ctx;
  // threaded: read from ctx, returned to the caller (GH #116)
  let { silenceLineCount } = ctx;

  const idsOf = (players: ReadonlyArray<ICombatUnit>) => {
    const ids = new Set(players.map((u) => u.id));
    for (const u of allUnits ?? [])
      if (u.ownerId && ids.has(u.ownerId)) ids.add(u.id);
    return ids;
  };
  const friendIds = idsOf(friends);
  const enemyIds = idsOf(enemies ?? []);
  const renderSide = (
    victims: ReadonlyArray<ICombatUnit>,
    attackerIds: Set<string>,
    side: "friendly" | "enemy",
  ) => {
    for (const u of victims) {
      const trinketTimes =
        side === "friendly"
          ? (ccTrinketSummaries.find((s) => s.playerName === u.name)
              ?.trinketUseTimes ?? [])
          : [];
      const intervals = silenceIntervals(u, attackerIds);
      // FT-T16 (D13): the owner's major cooldowns pressed into a silence and
      // refused as "silenced", on that silence's line — the `[CC ON TEAM]`
      // clause, for the control that family does not hold. Only the log's
      // recorder has SPELL_CAST_FAILED rows.
      const pressedDuring =
        rawStreams?.available && side === "friendly" && u.id === owner.id
          ? ownerPressesRejectedDuring(
              rawStreams.castFailed,
              owner.id,
              ownerControlPressKit(ownerCDs),
              "silence",
              intervals,
              (s) => ({
                fromSeconds: (s.from - matchStartMs) / 1000,
                toSeconds: (Math.min(s.to, matchEndMs) - matchStartMs) / 1000,
              }),
            )
          : undefined;
      for (const s of intervals) {
        const at = (s.from - matchStartMs) / 1000;
        const endMs = Math.min(s.to, matchEndMs);
        const durS = Math.max(0, (endMs - s.from) / 1000);
        // enemy-def F-E17: the Medallion cast is logged up to a few ms
        // after the removal it caused (dfcccbf2: silence removed 21.020,
        // trinket 21.021) — the CC binder's `TRINKET_BREAK_AFTER_REMOVAL_MS`
        const trinketAt = trinketTimes.find((t) => {
          const tMs = matchStartMs + t * 1000;
          return (
            tMs >= s.from &&
            tMs <= endMs + TRINKET_BREAK_AFTER_REMOVAL_MS &&
            endMs - tMs <= 300
          );
        });
        // FT-T08 step 3c: a dispel of the silence, or the unit's death at
        // its removal, is in the log (`auraEndFromLog`) — stated when no
        // trinket press already accounts for the end. Clamped to the round's
        // end, the removal is not the silence's own: no cause is read.
        // an enemy's trinket has its own [ENEMY TRINKET] line: the same
        // window keeps the DEATH reading (a cascade inferred from timing) off
        // a silence it broke (codex review of step 3c). A dispel line names
        // this aura outright and is still read.
        const enemyTrinketed =
          side === "enemy" &&
          pvpTrinketUses(u).some(
            (t) =>
              t.atMs >= s.from &&
              t.atMs <= endMs + TRINKET_BREAK_AFTER_REMOVAL_MS &&
              endMs - t.atMs <= 300,
          );
        const end =
          trinketAt === undefined && s.to <= matchEndMs
            ? auraEndFromLog(
                u,
                s.spellId,
                { fromMs: s.from, removedMs: s.to },
                s.srcUnitId,
              )
            : undefined;
        const taker = end?.takenBy;
        const endNote = taker
          ? ` | dispelled by ${actorLabel(
              // the roster's name for that id — the log can spell one player
              // two ways (138e632d)
              [...friends, ...(enemies ?? [])].find(
                (p) => p.id === taker.unitId,
              )?.name ?? taker.unitName,
              side === "friendly" ? "friendly" : "enemy",
              taker.unitId,
            )}'s ${taker.spellName}`
          : end?.holderDied && !enemyTrinketed
            ? " | ended at their death"
            : "";
        const tail =
          trinketAt !== undefined
            ? ` | trinket broke this silence after ${renderedCcDuration({ durationSeconds: trinketAt - at })} (cut short — it had not expired)`
            : ` | ${renderedCcDuration({ durationSeconds: durS })}${endNote}`;
        const who = side === "friendly" ? pid(u.name) : enemyPid(u.name);
        // cc-dr F-SR1: a silence the unit's own reflect sent back to it
        const by =
          s.srcUnitId === u.id
            ? "(reflected back)"
            : `(by ${actorLabel(
                s.srcUnitName,
                side === "friendly" ? "enemy" : "friendly",
                s.srcUnitId,
              )})`;
        addEntry(
          at,
          `${fmtTime(at)}  [SILENCE]   ${who} ← ${getEnglishSpellName(s.spellId, s.spellName)} ${by}${tail}${formatPressedDuringNote(pressedDuring?.get(s))}`,
        );
        silenceLineCount++;
      }
    }
  };
  renderSide(friends, enemyIds, "friendly");
  renderSide(enemies ?? [], friendIds, "enemy");

  return { silenceLineCount };
}
