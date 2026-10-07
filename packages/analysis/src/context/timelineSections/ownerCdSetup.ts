/**
 * What the owner's cooldown lines need, computed once before [YOU] [CD]: the
 * casts that get a [HEALING] block (F114), the cooldown buffs that fade
 * ([BUFF FADED]), the owner's CC summary, the hard-CC / stun tags for actions
 * taken while CC'd (B145) and the interrupt-immunity windows of the owner's PvP
 * talents (B139). Later sections (healer gap-filler, [TEAM] [CD]) use them too.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`, and the six results come back
 * to the caller. Output is pinned by the 605-file acceptanceCapture context hash.
 */
import { buffFullDurationForCaster } from "../../utils/buffDuration";
import { castEndedCcWindow } from "../../utils/ccTrinketAnalysis";
import { cdIsProcOnly } from "../../utils/cooldowns";
import { isStunCcInstance } from "../../utils/drAnalysis";
import { interruptImmuneWindows as interruptImmuneWindowsOf } from "../../utils/talentBehaviors";
import {
  computeHealingInWindow,
  extractOwnerCDBuffExpiry,
  HEALING_AMPLIFIER_SPELL_IDS,
  HEALING_WINDOW_EARLY_CD_SECONDS,
  HEALING_WINDOW_MIN_HPS,
} from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

export function prepareOwnerCdContext(
  ctx: Pick<
    TimelineCtx,
    | "ownerCDs"
    | "owner"
    | "matchStartMs"
    | "friends"
    | "ccTrinketSummaries"
    | "matchEndMs"
  >,
) {
  const {
    ownerCDs,
    owner,
    matchStartMs,
    friends,
    ccTrinketSummaries,
    matchEndMs,
  } = ctx;

  // F114 (Variant C): precompute which amplifier-spell casts get a [HEALING] block.
  // Per spell, emit only the first eligible cast and the worst subsequent eligible
  // cast (score = overhealPct * 1000 - maxBucketHps; higher = worse). Casts
  // suppressed by the early-low-activity gate are never eligible.
  const healingEmissionTimes = new Map<string, Set<number>>();
  for (const cd of ownerCDs) {
    if (!HEALING_AMPLIFIER_SPELL_IDS.has(cd.spellId)) continue;
    // A proc-only entry's "casts" are aura activations, not presses — no
    // [HEALING] verdict on something nobody chose (round 3 N5).
    if (cdIsProcOnly(cd)) continue;
    const duration = buffFullDurationForCaster(cd.spellId, owner);
    if (!duration) continue;
    const eligible: { timeSeconds: number; score: number }[] = [];
    for (const cast of cd.casts) {
      const fromMs = matchStartMs + cast.timeSeconds * 1000;
      const toMs = fromMs + duration * 1000;
      const healStats = computeHealingInWindow(owner.healOut, fromMs, toMs);
      const maxBucketHps = healStats
        ? Math.max(...healStats.buckets.map((b) => b.hps))
        : 0;
      const isEarlyLowActivity =
        cast.timeSeconds < HEALING_WINDOW_EARLY_CD_SECONDS &&
        maxBucketHps < HEALING_WINDOW_MIN_HPS;
      if (isEarlyLowActivity) continue;
      const score = (healStats?.overhealPct ?? 0) * 1000 - maxBucketHps;
      eligible.push({ timeSeconds: cast.timeSeconds, score });
    }
    if (eligible.length === 0) continue;
    const emit = new Set<number>([eligible[0].timeSeconds]);
    if (eligible.length > 1) {
      let worstIdx = 1;
      for (let i = 2; i < eligible.length; i++) {
        if (eligible[i].score > eligible[worstIdx].score) worstIdx = i;
      }
      emit.add(eligible[worstIdx].timeSeconds);
    }
    healingEmissionTimes.set(cd.spellId, emit);
  }

  const cdExpiryEvents = extractOwnerCDBuffExpiry(
    ownerCDs,
    owner.id,
    friends,
    matchStartMs,
    owner,
  );

  // H13: computed once — used to confirm early-ended channels were a real kick/CC, not a
  // self-cancel/movement, without recomputing the find() per cast.
  const ownerCCSummary = ccTrinketSummaries.find(
    (s) => s.playerName === owner.name,
  );

  // B145: an action taken while the owner is hard-CC'd (stun/incap) is NOT a free choice — the game
  // allowed it because it was a usable-while-stunned defensive, a PvP trinket, or an immune channel
  // (verified against raw logs: e.g. Emerald Communion channels through a full Hammer of Justice stun).
  // Tag [YOU] [CD]/[CAST] lines with the CC so the model reads a forced/immune action as such rather
  // than judging its timing as elective.
  const CC_VERB: Record<string, string> = {
    Stun: "stunned",
    Incapacitate: "incapacitated",
  };
  function ownerHardCcTagAt(timeSeconds: number): string {
    if (!ownerCCSummary) return "";
    for (const cc of ownerCCSummary.ccInstances) {
      const verb = cc.drInfo ? CC_VERB[cc.drInfo.category] : undefined;
      if (!verb) continue;
      if (
        timeSeconds > cc.atSeconds &&
        timeSeconds < cc.atSeconds + cc.durationSeconds
      ) {
        return ` [while ${verb}: ${cc.spellName}]`;
      }
    }
    return "";
  }
  // Triage enemy-def F-E20: "stunned at the cast" for the cheaper-alternative
  // note. The tag above is strict-inside; a cast that ENDED the stun (Divine
  // Shield out of Hammer of Justice) is logged a millisecond after the stun's
  // REMOVED and matches no instance strictly, so it also counts when it is
  // the cast that ended a stun (`castEndedCcWindow`, the predicate of the
  // `[CC ON TEAM]` break note). Stun only: the usable-while table has no
  // incapacitate dimension.
  const ownerStunWindows = (ownerCCSummary?.ccInstances ?? [])
    .filter(isStunCcInstance)
    .map((cc) => ({
      cc,
      applyMs: matchStartMs + Math.round(cc.atSeconds * 1000),
      removeMs:
        matchStartMs + Math.round((cc.atSeconds + cc.durationSeconds) * 1000),
    }));
  function ownerStunnedAtCast(timeSeconds: number): boolean {
    const castMs = matchStartMs + Math.round(timeSeconds * 1000);
    return ownerStunWindows.some(
      (w) =>
        (timeSeconds > w.cc.atSeconds &&
          timeSeconds < w.cc.atSeconds + w.cc.durationSeconds) ||
        castEndedCcWindow(w, castMs),
    );
  }

  // B139: interrupt/silence-immunity windows granted by the owner's PvP talents (Obsidian Mettle → Obsidian
  // Scales, Zen Focus Tea → Thunder Focus Tea). Each is a passive with no marker aura gated on a normal CD
  // aura, so it's driven by the talentBehaviors catalog (gated on pvpTalents). Used to correct the "enemy
  // interrupts UP" note on the owner's channels — a kick that cannot land is not a risk.
  const interruptImmuneWindows = interruptImmuneWindowsOf(owner, matchEndMs);
  function ownerInterruptImmuneReasonAt(
    timeSeconds: number,
  ): string | undefined {
    if (interruptImmuneWindows.length === 0) return undefined;
    const ms = matchStartMs + timeSeconds * 1000;
    return interruptImmuneWindows.find((w) => ms >= w.from && ms <= w.to)
      ?.reason;
  }

  // exported: returned to the caller (GH #116)
  return {
    healingEmissionTimes,
    cdExpiryEvents,
    ownerCCSummary,
    ownerHardCcTagAt,
    ownerStunnedAtCast,
    ownerInterruptImmuneReasonAt,
  };
}
