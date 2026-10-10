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
import { roundEndMs } from "../../utils/roundEnd";
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
    | "allPlayers"
    | "bracket"
    | "matchStartMs"
    | "matchEndMs"
  >,
): void {
  const {
    enemyCDTimeline,
    pressureWindows,
    addEntry,
    pid,
    requestSnapshotPlaceholder,
    allPlayers,
    bracket,
    matchStartMs,
    matchEndMs,
  } = ctx;
  // T12 ① b (user ruling 2026-10-10, option A): the header's END is cut at
  // the round's end (`roundEndMs` — a Solo Shuffle round ends at its first
  // player death) — a window is a union of buff lengths and read e.g.
  // 3:21–3:45 in a round that ended at 3:23 (322 of 8,154 headers on the
  // 605-file capture). Cut HERE, at the line, on purpose: clamping the
  // window object itself made its last seconds assessable and added 53
  // position-mistake `stayed-in` candidates in a round's final seconds
  // (37 of them with the owner under 10 % HP) — every reader of the window
  // other than this line still gets the object as it was.
  const roundEndS =
    (roundEndMs({ endTime: matchEndMs, startInfo: { bracket } }, allPlayers) -
      matchStartMs) /
    1000;

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
    const headerEndS = Math.min(burst.toSeconds, roundEndS);
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
            peakSpikePlacement(headerEndS, peak.fromSeconds, peak.toSeconds)
          ]
        }`
      : // A statement about the listed lines, not about the damage: the
        // [DMG SPIKE] list is the round's largest buckets only.
        NO_CREDITED_SPIKE_CLAUSE;
    addEntry(
      burst.fromSeconds,
      `${fmtTime(burst.fromSeconds)}  [OFFENSIVE WINDOW]   ${fmtTime(burst.fromSeconds)}–${fmtTime(headerEndS)} | ${spikeClause} | CDs: ${cdNames}`,
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
