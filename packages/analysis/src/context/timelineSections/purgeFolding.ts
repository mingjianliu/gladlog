/**
 * GH #99 item 3, Rules B & C — fold the owner's qualifying missed purges into the
 * enemy buff / enemy CD lines they belong to: which buff intervals are dropped
 * (folded into a cast line), which buff or CD line carries a missed-purge note,
 * and which missed purges were consumed so [MISSED PURGE] does not repeat them.
 * Renders nothing itself; [ENEMY BUFF], [ENEMY CD] and the cleanse block read
 * what it returns.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`, and the five results come back to
 * the caller. Output is pinned by the 605-file acceptanceCapture context hash.
 */
import { HIGH_VALUE_PURGEABLE_BUFFS } from "../../data/purgeWhitelist";
import {
  canOffensivePurge,
  formatMissedPurgeExemption,
  type IMissedPurgeWindow,
  missedPurgesFor,
} from "../../utils/dispelAnalysis";
import type { IEnemyCDCast } from "../../utils/enemyCDs";
import { toRenderSecond } from "../../utils/renderGrid";
import type { IEnemyBuffInterval } from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

export function foldMissedPurges(
  ctx: Pick<
    TimelineCtx,
    | "enemyPid"
    | "owner"
    | "dispelSummary"
    | "enemyBuffIntervals"
    | "enemyCDTimeline"
  >,
) {
  const {
    enemyPid,
    owner,
    dispelSummary,
    enemyBuffIntervals,
    enemyCDTimeline,
  } = ctx;

  function sameEnemyUnit(name1: string, name2: string): boolean {
    if (name1 === name2) return true;
    if (name1.split("-")[0] === name2.split("-")[0]) return true;
    if (enemyPid(name1) === enemyPid(name2)) return true;
    return false;
  }

  // The windows the OWNER could have answered (`missedPurgesFor`): a general
  // purger's are the team's; an owner holding only a scoped removal (P-P5b =
  // C: Shattering Throw) gets the ones that tool answers, with that tool's
  // cooldown and reach. An immunity shield is worth the line by
  // itself; everything else stays behind the high-value whitelist.
  const qualifyingMissedPurges = missedPurgesFor(owner, dispelSummary).filter(
    (m) =>
      HIGH_VALUE_PURGEABLE_BUFFS.has(m.spellId) ||
      m.viaScopedTool?.scope === "immunity",
  );

  function formatPurgeAnnotationWithMiss(miss: IMissedPurgeWindow): string {
    const rawExemption = formatMissedPurgeExemption(miss);
    const exemptionPart = rawExemption
      ? rawExemption.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*/g, "; ")
      : "";
    const exemptionSuffix = exemptionPart ? `; ${exemptionPart}` : "";
    return ` (purgeable; unpurged for ${Math.round(miss.durationSeconds)}s${exemptionSuffix})`;
  }

  const droppedBuffIntervals = new Set<IEnemyBuffInterval>();
  const buffPurgeAnnotations = new Map<IEnemyBuffInterval, string>();
  const cdPurgeAnnotations = new Map<IEnemyCDCast, string>();
  const consumedMissedPurges = new Set<IMissedPurgeWindow>();

  for (const [enemyName, intervals] of enemyBuffIntervals) {
    for (const interval of intervals) {
      // Step 1: Check if there is a matching missed purge window for this buff (Rule C)
      let matchedMiss: IMissedPurgeWindow | undefined;
      for (const miss of qualifyingMissedPurges) {
        if (consumedMissedPurges.has(miss)) continue;
        if (
          toRenderSecond(miss.timeSeconds) !==
          toRenderSecond(interval.startSeconds)
        )
          continue;
        if (!sameEnemyUnit(miss.enemyName, enemyName)) continue;
        if (
          miss.spellName !== interval.spellName &&
          miss.spellId !== interval.spellId
        )
          continue;
        matchedMiss = miss;
        consumedMissedPurges.add(miss);
        break;
      }

      const purgeAnnotation = matchedMiss
        ? formatPurgeAnnotationWithMiss(matchedMiss)
        : interval.purgeable && canOffensivePurge(owner)
          ? " (purgeable)"
          : "";

      // Step 2: Check if there is a matching [ENEMY CD] line for the SAME unit and SAME spell (Rule B)
      let matchedCd: IEnemyCDCast | undefined;
      for (const player of enemyCDTimeline.players) {
        if (!sameEnemyUnit(player.playerName, enemyName)) continue;
        for (const cd of player.offensiveCDs) {
          if (
            toRenderSecond(cd.castTimeSeconds) !==
            toRenderSecond(interval.startSeconds)
          )
            continue;
          if (
            cd.spellName !== interval.spellName &&
            cd.spellId !== interval.spellId
          )
            continue;
          matchedCd = cd;
          break;
        }
        if (matchedCd) break;
      }

      if (matchedCd) {
        // Self-buff: fold [ENEMY BUFF] start line into [ENEMY CD]
        droppedBuffIntervals.add(interval);
        if (purgeAnnotation) {
          cdPurgeAnnotations.set(matchedCd, purgeAnnotation);
        }
      } else {
        if (purgeAnnotation) {
          buffPurgeAnnotations.set(interval, purgeAnnotation);
        }
      }
    }
  }

  // exported: returned to the caller (GH #116)
  return {
    qualifyingMissedPurges,
    droppedBuffIntervals,
    buffPurgeAnnotations,
    cdPurgeAnnotations,
    consumedMissedPurges,
  };
}
