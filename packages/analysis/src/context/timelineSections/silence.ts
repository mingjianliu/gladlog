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
import { officialDurationS } from "../../utils/auraIntervals";
import {
  pressEndedSilence,
  renderedCcDuration,
  renderedCcSpan,
} from "../../utils/ccTrinketAnalysis";
import { pvpTrinketUses } from "../../utils/pvpTrinketUses";
import { fmtTime } from "../../utils/renderGrid";
import {
  silenceIntervalsInRound,
  unloggedSilencesOnOwner,
} from "../../utils/unloggedSilence";
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
    | "enemyCCSummaries"
    | "matchStartMs"
    | "roundEndAtMs"
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
    enemyCCSummaries,
    matchStartMs,
    roundEndAtMs,
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
      // F15 / fact1215 R3: both sides read their own PvP trinket presses
      // (the enemy side had none — 364e3201's Medallion ended Spider Venom
      // and Silence and the lines read a plain `| 1s`)
      const trinketTimes =
        (side === "friendly"
          ? ccTrinketSummaries
          : (enemyCCSummaries ?? [])
        ).find((s) => s.playerName === u.name)?.trinketUseTimes ?? [];
      // F02b: the round's end is the one the control lines use
      // (`roundEndMs`, cc-dr F-CI1): a silence that landed at or after it is
      // not in the round (`silenceIntervalsInRound`), and one still on the
      // unit then is cut there and says so (`renderedCcSpan`). The cut was at
      // the LOG's end, ~2 s after a Solo Shuffle round's ending death:
      // `2:12 [SILENCE] … | 3s` in a round that ended at 2:13 (54 lines on
      // the 605 capture).
      const intervals = silenceIntervalsInRound(u, attackerIds, roundEndAtMs);
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
                toSeconds: (Math.min(s.to, roundEndAtMs) - matchStartMs) / 1000,
              }),
            )
          : undefined;
      for (const s of intervals) {
        const at = (s.from - matchStartMs) / 1000;
        const stillOnAtRoundEnd = s.to > roundEndAtMs;
        const endMs = Math.min(s.to, roundEndAtMs);
        const durS = Math.max(0, (endMs - s.from) / 1000);
        // enemy-def F-E17: the Medallion cast is logged up to a few ms
        // after the removal it caused (dfcccbf2: silence removed 21.020,
        // trinket 21.021) — the CC binder's `TRINKET_BREAK_AFTER_REMOVAL_MS`
        // read against the silence's own removal, never the round-end cut
        // (codex 60-POSTHOC-05b #3: a Medallion 1 ms after the cut "broke"
        // a silence that ran on), and a dispel the log names wins over a
        // press that merely coincides (05b #1, the hard-CC binder's order:
        // a Purify at 22 s and a trinket at 22.050 s read "trinket broke")
        const fullS = officialDurationS(
          s.spellId,
          [...friends, ...(enemies ?? [])].find((p) => p.id === s.srcUnitId),
          s.from,
        );
        const dispelledEnd = stillOnAtRoundEnd
          ? undefined
          : auraEndFromLog(
              u,
              s.spellId,
              {
                fromMs: s.from,
                removedMs: s.to,
                // a silence that ran its length ended on its own, whatever
                // died in that millisecond (`removedByDeath`'s natural end,
                // as the control and wall lines give it — GH #173 item 17:
                // a 3 s Garrote silence removed at 3.012 s, in its holder's
                // death, read "ended at their death")
                ...(fullS === null
                  ? {}
                  : { naturalEndMs: s.from + fullS * 1000 }),
              },
              s.srcUnitId,
            );
        const trinketAt =
          stillOnAtRoundEnd || dispelledEnd?.takenBy
            ? undefined
            : trinketTimes.find((t) =>
                pressEndedSilence(
                  s.from,
                  s.to,
                  matchStartMs + t * 1000,
                  s.spellId,
                  u,
                ),
              );
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
          !stillOnAtRoundEnd &&
          !dispelledEnd?.takenBy &&
          pvpTrinketUses(u).some((t) =>
            pressEndedSilence(s.from, s.to, t.atMs, s.spellId, u),
          );
        const end = trinketAt === undefined ? dispelledEnd : undefined;
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
            : ` | ${renderedCcSpan({
                durationSeconds: durS,
                ...(stillOnAtRoundEnd
                  ? { stillOnAtRoundEnd: true as const }
                  : {}),
              })}${endNote}`;
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

  // fact1215 R11: a silence the log writes no aura for, proven by the
  // owner's own press refused as silenced — the shared reading
  // (`unloggedSilencesOnOwner`), which the cast-bar stop evidence reads too
  // (fact11 D6). One line at the cast, no length — the log has none.
  if (owner)
    for (const s of unloggedSilencesOnOwner({
      owner,
      allUnits: allUnits ?? [],
      enemies: enemies ?? [],
      matchStartMs,
      roundEndAtMs,
      rawStreams,
    })) {
      const at = (s.castMs - matchStartMs) / 1000;
      addEntry(
        at,
        `${fmtTime(at)}  [SILENCE]   ${pid(owner.name)} ← ${s.spellName} (by ${actorLabel(s.srcName, "enemy", s.srcId)}) | no aura logged — silenced at ${fmtTime((s.refusalMs - matchStartMs) / 1000)} (${s.refusalSpellName} refused); length not logged`,
      );
      silenceLineCount++;
    }

  return { silenceLineCount };
}
