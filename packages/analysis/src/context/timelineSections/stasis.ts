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
    // stored before the round: its contents are not in this round's log
    if (stasis.storedBeforeRound) {
      const at = stasis.releaseSeconds ?? stasis.storedSeconds;
      addEntry(
        at,
        stasis.releaseSeconds === undefined
          ? `${fmtTime(at)}  [YOU] [STASIS STORED] → stored before this round (not released before the round ended; its contents are not in this round's log)`
          : `${fmtTime(at)}  [YOU] [STASIS RELEASE] → stored before this round (its contents are not in this round's log)`,
      );
      continue;
    }
    if (!contents) continue;
    // FT-T06: the line sits where the spells were REPLAYED (the ready
    // aura's end), not where storing ended. A Stasis that was never replayed
    // inside the round says so at the moment it was stored.
    if (stasis.releaseSeconds === undefined) {
      addEntry(
        stasis.storedSeconds,
        `${fmtTime(stasis.storedSeconds)}  [YOU] [STASIS STORED] → ${contents} (${
          stasis.unreleased === "lost"
            ? "never released: it came off with nothing replayed"
            : "not released before the round ended"
        })`,
      );
      continue;
    }
    addEntry(
      stasis.releaseSeconds,
      `${fmtTime(stasis.releaseSeconds)}  [YOU] [STASIS RELEASE] → ${contents}`,
    );
  }
}
