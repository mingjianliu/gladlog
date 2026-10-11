/**
 * [TRINKET] and [CC ON TEAM] — PvP trinket presses (what they broke, or the
 * disarm they broke as a [DISARM] tail) and enemy CC landing on our team.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. `disarmLineCount` is threaded:
 * the caller passes its current value and assigns back the returned one (the
 * [DISARM] legend reads it). `trinketBrokenDisarm` stays in buildMatchTimeline
 * and is passed in. Output is pinned by the 605-file acceptanceCapture context
 * hash.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";

import { BACKLASH_AURA_CC_TYPE } from "../../data/backlashCc";
import {
  ccAvoidedOutcomeText,
  ccEndedByOwnPress,
  ccLoggedEnd,
  formatCcLoggedEnd,
  immunityBreak,
  lastTrinketPressBefore,
  renderedCcDuration,
  renderedCcSpan,
  tremorTotemBreak,
} from "../../utils/ccTrinketAnalysis";
import { wasRemovedByAllyDispel } from "../../utils/dispelAnalysis";
import { fmtTime } from "../../utils/renderGrid";
import {
  formatPressedDuringNote,
  ownerControlPressKit,
  ownerPressesRejectedDuring,
} from "../controlRejectedPresses";
import type { TimelineCtx } from "./ctx";

export function emitTrinketCcOnTeamEntries(
  ctx: Pick<
    TimelineCtx,
    | "ccTrinketSummaries"
    | "trinketBrokenDisarm"
    | "actorLabel"
    | "addEntry"
    | "pid"
    | "disarmLineCount"
    | "dispelSummary"
    | "matchStartMs"
    | "friends"
    | "enemies"
    | "rosterSides"
    | "avoidanceSourceTag"
    | "trinketLastUsedCount"
    | "owner"
    | "ownerCDs"
    | "rawStreams"
  >,
): Pick<TimelineCtx, "disarmLineCount" | "trinketLastUsedCount"> {
  const {
    ccTrinketSummaries,
    trinketBrokenDisarm,
    actorLabel,
    addEntry,
    pid,
    dispelSummary,
    matchStartMs,
    friends,
    enemies,
    rosterSides,
    avoidanceSourceTag,
    owner,
    ownerCDs,
    rawStreams,
  } = ctx;
  // threaded: read from ctx, returned to the caller (GH #116)
  let { disarmLineCount, trinketLastUsedCount } = ctx;

  for (const summary of ccTrinketSummaries) {
    // FT-T16 (D13): the owner's major cooldowns pressed into a control and
    // refused because of it, on that control's line. Only the log's recorder
    // has SPELL_CAST_FAILED rows; the windows are the lines that print.
    const pressedDuring =
      rawStreams?.available && summary.playerName === owner.name
        ? ownerPressesRejectedDuring(
            rawStreams.castFailed,
            owner.id,
            ownerControlPressKit(ownerCDs),
            "control",
            summary.ccInstances.filter((cc) => cc.durationSeconds !== 0),
            (cc) => ({
              fromSeconds: cc.atSeconds,
              toSeconds: cc.atSeconds + cc.durationSeconds,
            }),
          )
        : undefined;

    for (const t of summary.trinketUseTimes) {
      // F-E18: name the disarm, as [ENEMY TRINKET] names its CC
      const brokenDisarm = trinketBrokenDisarm(summary, t);
      const disarmPart = brokenDisarm
        ? ` out of ${brokenDisarm.spellName} (by ${actorLabel(brokenDisarm.sourceName, "enemy", brokenDisarm.sourceId)})`
        : "";
      addEntry(
        t,
        `${fmtTime(t)}  [TRINKET]   ${pid(summary.playerName)} used PvP trinket${disarmPart}`,
      );
    }

    // cc-dr F-DA1 (ruling A54 = A): a disarm on any player of our team gets
    // a line in the [SILENCE] format (it was only a [RES] `cc:` token); a
    // trinket press that broke it (`trinketBrokenDisarm`) takes the tail.
    for (const d of summary.disarmInstances) {
      const brokeAt = summary.trinketUseTimes.find(
        (t) => trinketBrokenDisarm(summary, t) === d,
      );
      const tail =
        brokeAt !== undefined
          ? ` | trinket broke this disarm after ${(brokeAt - d.atSeconds).toFixed(0)}s (cut short — it had not expired)`
          : ` | ${renderedCcDuration(d)}`;
      // the legend counts only lines that print (codex 35-CD-15: a disarm
      // past the match end is skipped)
      if (
        addEntry(
          d.atSeconds,
          `${fmtTime(d.atSeconds)}  [DISARM]   ${pid(summary.playerName)} ← ${d.spellName} (by ${actorLabel(d.sourceName, "enemy", d.sourceId)})${tail}`,
        )
      )
        disarmLineCount++;
    }

    for (const cc of summary.ccInstances) {
      if (cc.durationSeconds === 0) continue;
      let trinketNote = "";
      if (cc.trinketState === "used") {
        // B111: with the active-at-cast attribution fix, 'used' means the trinket was pressed while this
        // CC was still active — it BROKE the CC. The logged length is the truncated endured time (aura
        // was cut short at the break), NOT the CC's natural duration, so the standalone "| Ns" is
        // suppressed below and this note states how long the player endured and that the CC had NOT
        // expired on its own — otherwise the coach misreads a trinket-shortened "1s" as a trivial CC
        // that was not worth trinketing (see 294 Finding "trinketed a 1-second Hammer").
        trinketNote = ` | trinket broke this CC after ${renderedCcDuration(cc)} (cut short — it had not expired)`;
      } else if (cc.trinketState === "racial_break") {
        // Same truncated-duration semantics as the trinket break, but state
        // what actually happened: the racial was pressed, not the trinket.
        trinketNote = ` | ${cc.breakRacialName ?? "racial"} broke this CC after ${renderedCcDuration(cc)} (cut short — it had not expired); PvP trinket NOT used`;
      } else if (cc.trinketState === "on_cooldown") {
        const cdLeft =
          cc.trinketCDSecondsLeft !== undefined
            ? `${cc.trinketCDSecondsLeft}s left`
            : "on CD";
        // B4a: where that cooldown went — the press, and what it broke
        const last = lastTrinketPressBefore(
          summary,
          cc.atSeconds,
          matchStartMs,
        );
        const lastStr = last
          ? `; last used ${fmtTime(last.atSeconds)}${last.brokeSpellName ? ` on ${last.brokeSpellName}` : ""}`
          : "";
        if (last) trinketLastUsedCount++;
        trinketNote = ` | trinket: ON CD (${cdLeft}${lastStr})`;
      }
      // F-E21: the player's trinket-equivalent racial not back when this CC
      // landed — on its own cooldown from an earlier press (9c6ab747 1:37:
      // Will of the Forsaken broke the 0:18 Song, and the later Song said
      // only "trinket: ON CD"), or held by a trinket press's shared lock.
      // Not on a CC that was itself broken — that note says who did.
      if (
        cc.breakRacialOnCd &&
        cc.trinketState !== "used" &&
        cc.trinketState !== "racial_break"
      )
        trinketNote += `${trinketNote ? ";" : " |"} ${cc.breakRacialOnCd.name}: ON CD (${cc.breakRacialOnCd.secondsLeft}s left)`;

      // F148: Cleanse Success Verification — check if this CC was removed by a friendly dispel
      const isCleansed = wasRemovedByAllyDispel(
        dispelSummary.allyCleanse,
        cc.spellId,
        summary.playerName,
        cc.atSeconds + cc.durationSeconds,
      );
      const cleansedNote = isCleansed ? " [CLEANSED]" : "";

      // GH #100 (user 2026-09-20): a friendly Tremor Totem dropped mid-fear
      // ends it the same instant — the one tremor fact the log supports.
      // Same "cut short" wording and duration handling as the trinket break
      // (B111): the logged length is the endured time, not the CC's length.
      const trinketBroke =
        cc.trinketState === "used" || cc.trinketState === "racial_break";
      const tremor =
        !trinketBroke && !isCleansed
          ? tremorTotemBreak(cc, matchStartMs, friends)
          : null;
      const tremorNote = tremor
        ? ` | Tremor Totem from ${pid(tremor.shamanName)} ended this CC after ${renderedCcDuration(cc)} (cut short — it had not expired)`
        : "";
      // Triage enemy-def F-E20: the player's own immunity ended it (Divine
      // Shield out of a stun). The trinket / racial / Tremor notes above name
      // their own break first; the `| Ns` duration stays, this note says why
      // the CC ended there.
      const ccdUnit = friends.find((f) => f.name === summary.playerName);
      const immunity =
        !trinketBroke && !isCleansed && !tremor && ccdUnit
          ? immunityBreak(cc, matchStartMs, ccdUnit)
          : null;
      const immunityNote = immunity
        ? ` | ${immunity.spellName} broke this CC after ${renderedCcDuration(cc)}`
        : "";

      // FT-T08 step 3c: how it ended, when the log says and no note above
      // already does — the damage that broke it, the player's death. A
      // friendly dispel is the [CLEANSED] tag. FT-T09: or the player's own
      // press, for a CC the press's own note is not on (one trinket press is
      // bound to one CC; a second CC it removed said nothing).
      const loggedEnd =
        !trinketBroke && !isCleansed && !tremor && !immunity && ccdUnit
          ? (ccLoggedEnd(ccdUnit, cc, matchStartMs) ??
            ccEndedByOwnPress(ccdUnit, cc, matchStartMs))
          : undefined;
      const endNote = formatCcLoggedEnd(
        loggedEnd?.kind === "dispelled" ? undefined : loggedEnd,
        (name, id) => {
          // a player is labelled by the roster's name for that id — the log
          // can spell one player two ways (138e632d)
          const mate = friends.find((f) => f.id === id);
          const foe = (enemies ?? []).find((e) => e.id === id);
          // a pet / totem: the roster says whose side its owner is on
          const friendly =
            mate !== undefined ||
            (foe === undefined &&
              id !== undefined &&
              rosterSides?.get(id) === CombatUnitReaction.Friendly);
          return actorLabel(
            mate?.name ?? foe?.name ?? name,
            friendly ? "friendly" : "enemy",
            id,
          );
        },
      );

      // `spell:<id>` is getDRCategory's self-DR fallback for a CC no DR
      // family claims (Infernal Awakening 22703 — drShareScan 2026-09-25: full
      // 79 % after a stun, 88 % after disorient / incapacitate, i.e. it shares
      // none) — a key, not a category the reader can use, so no tag.
      const drStr =
        cc.drInfo &&
        cc.drInfo.category !== "Unknown" &&
        !cc.drInfo.category.startsWith("spell:")
          ? ` [DR: ${cc.drInfo.category} ${cc.drInfo.level}]`
          : "";
      // GH #103: the tag names the CC (the coach guessed "stun" for a silence)
      // and reads the one backlash table (data/backlashCc.ts).
      const backlashType = BACKLASH_AURA_CC_TYPE.get(cc.spellId);
      const backlashStr = backlashType
        ? ` [DISPEL BACKLASH CC: ${backlashType}]`
        : "";

      // B111: for a trinket-broken CC the logged duration is the truncated endured time, not the CC's
      // natural length; suppress the standalone "| Ns" (the trinket note carries the endured time) so it
      // is not misread as the CC's trivial full duration.
      const durStr =
        cc.trinketState === "used" ||
        cc.trinketState === "racial_break" ||
        tremor
          ? ""
          : ` | ${renderedCcSpan(cc)}`;

      // B124: surface the caster→target range (and LoS) already computed at CC application, so claims
      // like "walked into the CC" / "should have LoS'd it" become checkable instead of inferred. Only
      // shown when advanced logging supplied positions.
      // cc-dr F-SR1 (ruling A52 = A): the holder's own CC sent back to it —
      // no caster to name and no caster distance to measure
      const reflectedBack =
        cc.sourceId !== undefined &&
        cc.sourceId === friends.find((u) => u.name === summary.playerName)?.id;
      let posStr = "";
      if (cc.distanceYards !== null && !reflectedBack) {
        const losTag = cc.losBlocked === true ? ", LoS blocked" : "";
        posStr = ` | ${cc.distanceYards}yd from caster${losTag}`;
      }
      const byStr = reflectedBack
        ? "(reflected back)"
        : `(by ${actorLabel(cc.sourceName, "enemy", cc.sourceId)})`;

      // passive_trinket → player has no active trinket, no annotation
      addEntry(
        cc.atSeconds,
        // B112: "(by N)" not "(N)" — the bare "(6)" caster-id was misread as a "6s" duration.
        `${fmtTime(cc.atSeconds)}  [CC ON TEAM]   ${pid(summary.playerName)} ← ${cc.spellName} ${byStr}${durStr}${drStr}${backlashStr}${posStr}${trinketNote}${tremorNote}${immunityNote}${endNote}${cleansedNote}${formatPressedDuringNote(pressedDuring?.get(cc))}`,
      );
    }

    if (summary.ccAvoidedInstances) {
      for (const avoided of summary.ccAvoidedInstances) {
        addEntry(
          avoided.atSeconds,
          // M-g: state the observed facts (CC cast did not land; avoidance ability present),
          // not a causal verdict. Let the model infer whether the ability caused the avoidance.
          // FT-T16 D15 "3c": with a SPELL_MISSED row of the cast on this
          // player, the first half is the log's own miss type; the second
          // half stays a fact standing next to it, not the row's reason.
          `${fmtTime(avoided.atSeconds)}  [CC AVOIDED?]   ${pid(summary.playerName)}: ${avoided.spellName} (by ${actorLabel(avoided.sourceName, "enemy", avoided.sourceId)}) ${ccAvoidedOutcomeText(avoided)}; ${avoided.avoidanceSpellName}${avoidanceSourceTag(avoided.avoidanceSourceName, summary.playerName)} active`,
        );
      }
    }
  }

  return { disarmLineCount, trinketLastUsedCount };
}
