/**
 * [BUFF FADED] (F70, B31) — the owner's cooldown buffs ending, tagged with the
 * cause (own shapeshift / dispelled / stolen / its target died / absorb used
 * up / ended early / expired / estimated) so the model does not invent a
 * dispel for a buff that simply ran out (B129) nor miss one the log shows
 * (FT-T08 step 3).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { HEAL_ABSORB_SELF_SAVE_IDS } from "../../utils/healAbsorbSave";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitBuffFadedEntries(
  ctx: Pick<TimelineCtx, "cdExpiryEvents" | "addEntry" | "actorLabel">,
): void {
  const { cdExpiryEvents, addEntry, actorLabel } = ctx;
  const k = (n: number) => `${Math.round(n / 1000)}k`;

  for (const expiry of cdExpiryEvents) {
    // B15a step 2: Death Pact's aura is the heal absorb it leaves on its
    // caster, not a buff — "ended early" there means the absorb was eaten,
    // and the press line already says how it ended.
    if (HEAL_ABSORB_SELF_SAVE_IDS.has(expiry.spellId)) continue;
    // B129: tag the fade cause so the model does not invent a dispel for a buff that simply expired,
    // and can tell a consumed absorb (ended early) from an expired one. "(estimated)" is retained for
    // expiries inferred from duration (no removal event logged).
    // FT-T08 step 3: a dispel, a steal, the holder's death and an absorb
    // running out are in the log — they are stated, not offered as one of
    // three guesses. "ended early" is what is left when none of them is.
    const a = expiry.absorb;
    // what it absorbed is the log's absorb lines; what was left is the
    // amount on its REMOVED line
    const took = a
      ? `${k(a.absorbed)} absorbed${a.left ? `, ${k(a.left)} left` : ""}`
      : "";
    const by = expiry.endedBy
      ? `${actorLabel(expiry.endedBy.unitName, "enemy", expiry.endedBy.unitId)}'s ${expiry.endedBy.spellName}`
      : "";
    const causeNote =
      expiry.cause === "death"
        ? " (removed at your death)"
        : expiry.cause === "target_death"
          ? " (its target died)"
          : expiry.cause === "dispelled"
            ? ` (dispelled by ${by}${took ? `; ${took}` : ""})`
            : expiry.cause === "stolen"
              ? ` (stolen by ${by}${took ? `; ${took}` : ""})`
              : expiry.cause === "form_shift"
                ? " (ended by your own shapeshift)"
                : expiry.cause === "absorbed"
                  ? ` (used up — absorbed ${k(a!.absorbed)})`
                  : expiry.dispelUnclear
                    ? ` (a dispel of this spell is logged at that moment — not which copy it took${took ? `; ${took}` : ""})`
                    : expiry.cause === "ended_early"
                    ? took
                      ? ` (ended early — ${took}; no dispel logged)`
                      : " (ended early — no dispel logged)"
                    : expiry.isEstimated
                      ? " (expired, estimated)"
                      : took
                        ? ` (expired; ${took})`
                        : " (expired)";
    addEntry(
      expiry.expiresAtSeconds,
      `${fmtTime(expiry.expiresAtSeconds)}  [BUFF FADED]   ${expiry.spellName}${causeNote}`,
    );
  }
}
