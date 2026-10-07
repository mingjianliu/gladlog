/**
 * [BUFF FADED] (F70, B31) — the owner's cooldown buffs ending, tagged with the
 * cause (own shapeshift / ended early / expired / estimated) so the model does
 * not invent a dispel for a buff that simply ran out (B129).
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { HEAL_ABSORB_SELF_SAVE_IDS } from "../../utils/healAbsorbSave";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitBuffFadedEntries(
  ctx: Pick<TimelineCtx, "cdExpiryEvents" | "addEntry">,
): void {
  const { cdExpiryEvents, addEntry } = ctx;

  for (const expiry of cdExpiryEvents) {
    // B15a step 2: Death Pact's aura is the heal absorb it leaves on its
    // caster, not a buff — "ended early" there means the absorb was eaten,
    // and the press line already says how it ended.
    if (HEAL_ABSORB_SELF_SAVE_IDS.has(expiry.spellId)) continue;
    // B129: tag the fade cause so the model does not invent a dispel for a buff that simply expired,
    // and can tell a consumed absorb (ended early) from an expired one. "(estimated)" is retained for
    // expiries inferred from duration (no removal event logged).
    const causeNote =
      expiry.cause === "death"
        ? " (removed at your death)"
        : expiry.cause === "form_shift"
        ? " (ended by your own shapeshift)"
        : expiry.cause === "ended_early"
          ? " (ended early — absorbed, dispelled, or cancelled)"
          : expiry.isEstimated
            ? " (expired, estimated)"
            : " (expired)";
    addEntry(
      expiry.expiresAtSeconds,
      `${fmtTime(expiry.expiresAtSeconds)}  [BUFF FADED]   ${expiry.spellName}${causeNote}`,
    );
  }
}
