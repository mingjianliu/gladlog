/**
 * [CC ON ENEMY] (2026-07-18 coverage fix) — our CC landing on enemies (the
 * owner's only when it has no [YOU] [CC] cast line), and enemy trinket use
 * ([ENEMY TRINKET]).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. `enemyTrinketCount` is threaded:
 * the caller passes its current value and assigns back the returned one (the
 * [ENEMY TRINKET] legend reads it). Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";

import { BACKLASH_AURA_CC_TYPE, backlashCcTag } from "../../data/backlashCc";
import { BREAK_RACIAL_SPELL_IDS } from "../../data/racialAbilities";
import { getEnglishSpellName } from "../../data/spellEffectData";
import { ccSpellIds } from "../../data/spellTags";
import { silenceIntervals } from "../../utils/cannotCastIntervals";
import {
  ccEndedByCasterInterrupt,
  ccEndedByImmunityAura,
  ccEndedByOwnPress,
  ccLoggedEnd,
  ccUnloggedEarlyEnd,
  findBrokenCC,
  findBrokenDisarm,
  formatCcLoggedEnd,
  formatCcRefreshed,
  formatCcUnloggedEnd,
  type ICCInstance,
  pressEndedSilence,
  renderedCcDuration,
  renderedCcSpan,
  tremorTotemBreak,
  TRINKET_BREAK_AFTER_REMOVAL_MS,
} from "../../utils/ccTrinketAnalysis";
import { hasOffensiveSpellActive, hpAtPress } from "../../utils/cooldowns";
import { wasRemovedByAllyDispel } from "../../utils/dispelAnalysis";
import { isEnemyCdWindowSpell } from "../../utils/enemyCDs";
import { MEDALLION_SPELL_ID } from "../../utils/pvpTrinketUses";
import { fmtTime, toRenderSecond } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitCcOnEnemyEntries(
  ctx: Pick<
    TimelineCtx,
    | "enemyCCSummaries"
    | "enemies"
    | "friends"
    | "matchStartMs"
    | "actorLabel"
    | "roundBounds"
    | "addEntry"
    | "enemyPid"
    | "enemyTrinketCount"
    | "matchEndSeconds"
    | "enemyDispelSummary"
    | "params"
    | "owner"
    | "ownerRenderedCcIds"
    | "enemyCcDrTag"
    | "rosterSides"
    | "silenceLineCount"
    | "allUnits"
  >,
): Pick<TimelineCtx, "enemyTrinketCount" | "silenceLineCount"> {
  const {
    allUnits,
    enemyCCSummaries,
    enemies,
    friends,
    matchStartMs,
    actorLabel,
    roundBounds,
    addEntry,
    enemyPid,
    matchEndSeconds,
    enemyDispelSummary,
    params,
    enemyCcDrTag,
    rosterSides,
  } = ctx;
  // threaded: read from ctx, returned to the caller (GH #116)
  let { enemyTrinketCount, silenceLineCount } = ctx;

  if (enemyCCSummaries) {
    for (const summary of enemyCCSummaries) {
      // Enemy trinket usage was previously not rendered at all (60-match wild
      // audit: 30/57 matches below 80% coverage, every gap on the hostile side)
      // — "did the target trinket or not" is the core fact of a burst-conversion
      // audit, and without it the coach can only downgrade confidence with
      // "trinket state never observed".
      const enemyUnit = enemies?.find((e) => e.name === summary.playerName);
      const friendlyIds = new Set(friends.map((f) => f.id));
      // our players and their summons — the attacker set the [SILENCE]
      // lines read an enemy's silences against (silence.ts `idsOf`)
      const friendAndSummonIds = new Set(friendlyIds);
      for (const u of allUnits ?? [])
        if (u.ownerId && friendlyIds.has(u.ownerId))
          friendAndSummonIds.add(u.id);
      /** One `[ENEMY TRINKET]` line: `used <what>[ out of <CC> (by <src>)]`. */
      const addEnemyBreakLine = (
        t: number,
        what: string,
        /** the press's own id — the HP is read AT the press (F-E11) */
        pressSpellId: string,
        brokenCC:
          | Pick<ICCInstance, "spellName" | "sourceName" | "sourceId">
          | undefined,
      ) => {
        const tSec = toRenderSecond(t);
        const tMs = matchStartMs + tSec * 1000;
        const ccPart = brokenCC
          ? brokenCC.sourceId !== undefined &&
            brokenCC.sourceId === enemyUnit?.id
            ? ` out of ${brokenCC.spellName} (reflected back)`
            : ` out of ${brokenCC.spellName} (by ${actorLabel(brokenCC.sourceName, "friendly", brokenCC.sourceId)})`
          : "";
        const hasBurst =
          friends.some((f) =>
            hasOffensiveSpellActive(
              f,
              tMs,
              friendlyIds,
              undefined,
              roundBounds,
            ),
          ) ||
          (enemies ?? []).some((e) =>
            hasOffensiveSpellActive(
              e,
              tMs,
              friendlyIds,
              isEnemyCdWindowSpell,
              roundBounds,
            ),
          );
        const burstPart = hasBurst ? " [friendly offensive CD active]" : "";
        const hpPct = enemyUnit
          ? hpAtPress(enemyUnit, matchStartMs + Math.round(t * 1000), {
              spellId: pressSpellId,
              srcUnitId: enemyUnit.id,
            })
          : null;
        const hpPart =
          hpPct !== null ? ` (target at ${hpPct.toFixed(0)}% HP)` : "";
        addEntry(
          t,
          `${fmtTime(t)}  [ENEMY TRINKET]   ${enemyPid(summary.playerName)} used ${what}${ccPart}${burstPart}${hpPart}`,
        );
      };
      // F15 / fact1215 R3: what the press removed — a CC, else a disarm
      // (the friendly [TRINKET] line's fallback, `findBrokenDisarm`), else a
      // silence (`pressEndedSilence`, the [SILENCE] tail's predicate). The
      // enemy line named CCs only: 0f894aee / 10bce166 / 3867e9ef disarms and
      // 06aa443c / 364e3201 silences ended by a Medallion named nothing.
      const silences = enemyUnit
        ? silenceIntervals(enemyUnit, friendAndSummonIds)
        : [];
      // round-1 retest idx 12: the enemy's own control sent back onto it
      // (Cyclone REFLECTED, source = holder) is no `ccInstances` member on the
      // enemy side (ruling A52 = A keeps the [CC ON ENEMY] line off it), so
      // the press that ended it named nothing (086019c0 3:14: the Medallion
      // and the reflected Cyclone's REMOVED in one ms) — read off the aura
      const reflectedCcEndedBy = (pressMs: number) => {
        if (!enemyUnit) return undefined;
        const removed = (enemyUnit.auraEvents ?? []).find(
          (a) =>
            !!a.spellId &&
            ccSpellIds.has(a.spellId) &&
            a.srcUnitId === enemyUnit.id &&
            a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
            Math.abs(a.timestamp - pressMs) <= TRINKET_BREAK_AFTER_REMOVAL_MS,
        );
        return removed
          ? {
              spellName: getEnglishSpellName(
                removed.spellId!,
                removed.spellName,
              ),
              sourceName: enemyUnit.name,
              sourceId: enemyUnit.id,
            }
          : undefined;
      };
      for (const t of summary.trinketUseTimes) {
        enemyTrinketCount++;
        const pressMs = matchStartMs + Math.round(t * 1000);
        const silence = silences.find((x) =>
          pressEndedSilence(x.from, x.to, pressMs, x.spellId),
        );
        addEnemyBreakLine(
          t,
          "PvP trinket",
          MEDALLION_SPELL_ID,
          findBrokenCC(summary.ccInstances, matchStartMs, pressMs) ??
            findBrokenDisarm(
              summary.disarmInstances ?? [],
              matchStartMs,
              pressMs,
            ) ??
            (silence
              ? {
                  spellName: getEnglishSpellName(
                    silence.spellId,
                    silence.spellName,
                  ),
                  sourceName: silence.srcUnitName,
                  sourceId: silence.srcUnitId,
                }
              : undefined) ??
            reflectedCcEndedBy(pressMs),
        );
      }
      // F-E21 / ruling A′15: the same line for a break that was not the
      // trinket. A break RACIAL renders on every press — the trinket
      // equivalents, and Escape Artist, which locks nothing and names no CC
      // (`breakRemovesCc`) but is still the racial pressed (codex review,
      // 2026-10-03: keyed on the trinket lock, it never rendered). A class
      // ability (Blink, Berserker Shout …) only when it broke a control —
      // every other Blink is not a break.
      for (const u of summary.breakAbilityUses ?? []) {
        if (u.atSeconds < 0 || u.atSeconds > matchEndSeconds) continue;
        if (!BREAK_RACIAL_SPELL_IDS.has(u.spellId) && !u.brokenCc) continue;
        enemyTrinketCount++; // keeps the [ENEMY TRINKET] legend in the prompt
        addEnemyBreakLine(u.atSeconds, u.name, u.spellId, u.brokenCc);
      }
      for (const cc of summary.ccInstances) {
        // F148: Cleanse Success Verification — check if this CC was removed by an enemy dispel
        const isCleansed = enemyDispelSummary
          ? wasRemovedByAllyDispel(
              enemyDispelSummary.allyCleanse,
              cc.spellId,
              summary.playerName,
              cc.atSeconds + cc.durationSeconds,
            )
          : false;
        // Mirror of the [CC ON TEAM] tremor note (user 2026-09-20: Tremor
        // "depending on the situation" — i.e. when it did something): the
        // ENEMY dropped Tremor Totem mid-fear and our fear ended that instant.
        const trinketBroke =
          cc.trinketState === "used" || cc.trinketState === "racial_break";
        const enemyTremor =
          !trinketBroke && !isCleansed
            ? tremorTotemBreak(cc, matchStartMs, enemies ?? [])
            : null;
        // The owner's own CC keeps its per-target line too (work order
        // 2026-10-14c #8): the [YOU] [CC] cast line is per cast and prints no
        // length, so 82a2d681's two Blinding Sleets broken at 0.76 / 0.81 s
        // had no length and no end anywhere on the page. Until then the line
        // was kept only for a tremor break or a QUICK FOLLOW-UPS citation.
        // A QUICK FOLLOW-UPS line cites this landing (it still decides the
        // backlash-silence exception below).
        const keptForFollowUp = (params.keepOwnerCcOnEnemy ?? []).some(
          (k) =>
            k.targetName === summary.playerName &&
            k.spellId === cc.spellId &&
            k.ccAtS === cc.atSeconds,
        );
        // cc-dr F-CE1: the DR the OUTGOING chain holds for this landing —
        // same target, spell, caster (a pet's CC is its owner's, as the
        // chain credits it) and render second; never the enemy-side summary's
        // drInfo (the two pair REFRESH differently). A backlash aura has no
        // chain application and no tag.
        const drTag = enemyCcDrTag(
          summary.playerName,
          cc.spellId,
          cc.atSeconds,
          cc.sourceId,
          cc.sourceName,
        );
        // FT-T08 step 3c: how it ended, when the log says — the damage that
        // broke it, a dispel, the target's death; Tremor has its note above.
        // FT-T09: or the target's own press. The [ENEMY TRINKET] line names
        // the ONE control a press is bound to; every control that press (or
        // an immunity) ended says so here, on its own line.
        const loggedEndNote =
          enemyTremor || !enemyUnit
            ? ""
            : formatCcLoggedEnd(
                // a control a press is bound to reads the press only, and
                // only when the press sits at its removal: the binder also
                // takes a control that landed just after the press and ran on
                trinketBroke
                  ? ccEndedByOwnPress(enemyUnit, cc, matchStartMs)
                  : (ccLoggedEnd(enemyUnit, cc, matchStartMs) ??
                      // …the caster's channel kicked at its removal (R9)
                      ccEndedByCasterInterrupt(
                        enemyUnit,
                        cc,
                        matchStartMs,
                        (allUnits ?? []).find((u) => u.id === cc.sourceId) ??
                          friends.find((f) => f.id === cc.sourceId),
                      ) ??
                      ccEndedByOwnPress(
                        enemyUnit,
                        cc,
                        matchStartMs,
                        (allUnits ?? []).find((u) => u.id === cc.sourceId) ??
                          friends.find((f) => f.id === cc.sourceId),
                      ) ??
                      // …or a control immunity that went up on them in the
                      // removal's millisecond (a Slayer's Bladestorm: no press)
                      ccEndedByImmunityAura(enemyUnit, cc, matchStartMs)),
                (name, id) => {
                  // a player is labelled by the roster's name for that id —
                  // the log can spell one player two ways (138e632d)
                  const foe = (enemies ?? []).find((e) => e.id === id);
                  const mate = friends.find((f) => f.id === id);
                  // a pet / totem: the roster says whose side its owner is on
                  const hostile =
                    foe !== undefined ||
                    (mate === undefined &&
                      id !== undefined &&
                      rosterSides?.get(id) === CombatUnitReaction.Hostile);
                  return actorLabel(
                    foe?.name ?? mate?.name ?? name,
                    hostile ? "enemy" : "friendly",
                    id,
                  );
                },
              );
        // F06b / F08: gone within half a second with nothing in the log
        // to say why — said, not left as a bare `<1s`
        // (`ccUnloggedEarlyEnd`). An enemy's dispel of it is the
        // `enemyDispelSummary` reading above.
        const endNote =
          loggedEndNote ||
          (enemyTremor || !enemyUnit || trinketBroke || isCleansed
            ? ""
            : formatCcUnloggedEnd(
                ccUnloggedEarlyEnd(enemyUnit, cc, matchStartMs),
              ));
        // F06c: a REFRESH row this line's instance runs across
        const refreshNote = formatCcRefreshed(cc, fmtTime, drTag !== "");
        // FT F22: a dispel backlash that is a SILENCE (Unstable Affliction's
        // 196364 — DB2 mechanic 9, `BACKLASH_AURA_CC_TYPE`) is a silence on
        // that enemy, not hard CC: the [SILENCE] line, in its format, with
        // the tag the [CC ON TEAM] line of the same aura carries. It read
        // `[CC ON ENEMY] … ← Unstable Affliction (by …) (4s)` under a legend
        // that says those lines hold no silences. One exception: the landing
        // a QUICK FOLLOW-UPS line cites keeps its [CC ON ENEMY] line — the
        // gate reads that line (`checkForcedTrinketConsistency`).
        const backlashType = BACKLASH_AURA_CC_TYPE.get(cc.spellId);
        if (backlashType === "silence" && !enemyTremor && !keptForFollowUp) {
          if (
            addEntry(
              cc.atSeconds,
              `${fmtTime(cc.atSeconds)}  [SILENCE]   ${enemyPid(summary.playerName)} ← ${cc.spellName} (by ${actorLabel(cc.sourceName, "friendly", cc.sourceId)}) | ${renderedCcSpan(cc)}${backlashCcTag(backlashType)}${endNote}`,
            )
          )
            silenceLineCount++;
          continue;
        }
        const durStr = enemyTremor
          ? `${drTag} | enemy Tremor Totem from ${enemyPid(enemyTremor.shamanName)} ended this CC after ${renderedCcDuration(cc)} (cut short — it had not expired)`
          : ` (${renderedCcSpan(cc)})${drTag}${refreshNote}${endNote}`;
        addEntry(
          cc.atSeconds,
          `${fmtTime(cc.atSeconds)}  [CC ON ENEMY]   ${enemyPid(summary.playerName)} ← ${cc.spellName} (by ${actorLabel(cc.sourceName, "friendly", cc.sourceId)})${durStr}`,
        );
      }
    }
  }

  return { enemyTrinketCount, silenceLineCount };
}
