/**
 * [OFFENSIVE WINDOW] — one synthesized header per aligned enemy burst window that
 * a listed DMG SPIKE starts within 5 s of: the window, the largest spike credited
 * to it (damage, target and the spike's own interval — not the burst's) or the
 * statement that none is, and the cooldowns in it.
 *
 * Cut out of buildMatchTimeline (GH #116); its closure inputs arrive through
 * `ctx`. Which spike a header names is `creditSpikesToWindows` (T12 ③).
 */
import { fmtTime } from "../../utils/renderGrid";
import {
  creditSpikesToWindows,
  NO_CREDITED_SPIKE_CLAUSE,
  PEAK_SPIKE_MARKERS,
  peakSpikePlacement,
} from "../peakSpikePlacement";
import { DMG_SPIKE_THRESHOLD } from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

export function emitOffensiveWindowEntries(
  ctx: Pick<
    TimelineCtx,
    | "enemyCDTimeline"
    | "pressureWindows"
    | "addEntry"
    | "pid"
    | "requestSnapshotPlaceholder"
  >,
): void {
  const {
    enemyCDTimeline,
    pressureWindows,
    addEntry,
    pid,
    requestSnapshotPlaceholder,
  } = ctx;

  const spikes = pressureWindows.filter(
    (pw) => pw.totalDamage >= DMG_SPIKE_THRESHOLD,
  );
  // Which windows get a header is unchanged: those a listed spike starts
  // within 5 s of. (So is which windows get the B14b [RES] row.) What changed
  // (T12 ③, user ruling 2026-10-10) is which spike a header may NAME — see
  // `creditSpikesToWindows`: only one whose bucket overlaps the window, and
  // each spike on one header. The 5 s rule used to pick the spike too, so
  // 444 of 8,154 headers on the 605 capture named a spike that began after
  // the window had ended (223 of them with another listed spike inside the
  // window) and 180 spikes were named on two headers.
  const listed = enemyCDTimeline.alignedBurstWindows.filter((burst) =>
    spikes.some(
      (pw) =>
        pw.fromSeconds >= burst.fromSeconds - 5 &&
        pw.fromSeconds <= burst.toSeconds + 5,
    ),
  );
  const creditedTo = creditSpikesToWindows(listed, spikes);

  listed.forEach((burst, windowIndex) => {
    // The largest of the spikes credited to this window — the rendered
    // wording is "peak spike". Stated as a criterion, not read off the order
    // `pressureWindows` happens to arrive in.
    const peak = spikes.reduce<(typeof spikes)[number] | undefined>(
      (best, pw, s) =>
        creditedTo[s] === windowIndex &&
        (!best || pw.totalDamage > best.totalDamage)
          ? pw
          : best,
      undefined,
    );
    // Each CD carries its actual cast time — the window is a union, and without
    // per-CD times it gets read as "all popped together at the start" (059)
    const cdNames = burst.activeCDs
      .map((c) => `${c.spellName}@${fmtTime(c.castSeconds)}`)
      .join(" + ");
    // The damage number is the total of **that DMG SPIKE window**, not the
    // damage inside this burst window — the two intervals differ. Previously
    // only the burst's start/end were printed, so a reader inevitably read the
    // number as "damage during this window" (class I: the ord 017 responder
    // drew a wrong conclusion from exactly this). Label the window the damage
    // belongs to explicitly so number and interval line up.
    const spikeClause = peak
      ? `peak spike ${(peak.totalDamage / 1_000_000).toFixed(2)}M on ${pid(peak.targetName)} (${peak.targetSpec}) over ${fmtTime(peak.fromSeconds)}–${fmtTime(peak.toSeconds)}${
          PEAK_SPIKE_MARKERS[
            peakSpikePlacement(
              burst.toSeconds,
              peak.fromSeconds,
              peak.toSeconds,
            )
          ]
        }`
      : // A statement about the listed lines, not about the damage: the
        // [DMG SPIKE] list is the round's largest buckets only.
        NO_CREDITED_SPIKE_CLAUSE;
    addEntry(
      burst.fromSeconds,
      `${fmtTime(burst.fromSeconds)}  [OFFENSIVE WINDOW]   ${fmtTime(burst.fromSeconds)}–${fmtTime(burst.toSeconds)} | ${spikeClause} | CDs: ${cdNames}`,
      // B14b (user ruling 2026-10-06/07): what the team had ready when the
      // burst began — a full [RES] row, past the debounce, that leaves the
      // rows after it alone. Its `enemy:` column is the state at the window's
      // whole second; the opener pressed inside that second is on the header.
      requestSnapshotPlaceholder(
        burst.fromSeconds,
        true,
        true,
        undefined,
        true,
      ),
    );
  });
}
