/**
 * Stasis releases — the Preservation Evoker's stored spells and when Stasis
 * released them.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitStasisEntries(
  ctx: Pick<TimelineCtx, "stasisEvents" | "addEntry">,
): void {
  const { stasisEvents, addEntry } = ctx;

  for (const stasis of stasisEvents) {
    // Prefer resolved spell names; fall back to the stored-spell count so an
    // unidentified release is never shown as an empty "→ " (which reads as a
    // wasted Stasis). Only skip releases that genuinely stored nothing.
    const contents =
      stasis.spells.length > 0
        ? stasis.spells.join(", ")
        : stasis.storedCount > 0
          ? `${stasis.storedCount} spell(s) stored (contents not identified)`
          : "";
    if (contents) {
      addEntry(
        stasis.releaseSeconds,
        `${fmtTime(stasis.releaseSeconds)}  [YOU] [STASIS RELEASE] → ${contents}`,
      );
    }
  }
}
