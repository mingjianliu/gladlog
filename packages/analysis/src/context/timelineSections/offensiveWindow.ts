/**
 * [OFFENSIVE WINDOW] — one synthesized header per aligned enemy burst window that
 * overlaps a DMG SPIKE: the window, the peak spike's damage, target and interval
 * (labelled as the spike's own window, not the burst's), and the cooldowns in it.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { fmtTime } from "../../utils/renderGrid";
import { PEAK_SPIKE_MARKERS, peakSpikePlacement } from "../peakSpikePlacement";
import { DMG_SPIKE_THRESHOLD } from "../timelineHelpers";
import type { TimelineCtx } from "./ctx";

export function emitOffensiveWindowEntries(
  ctx: Pick<
    TimelineCtx,
    "enemyCDTimeline" | "pressureWindows" | "addEntry" | "pid"
  >,
): void {
  const { enemyCDTimeline, pressureWindows, addEntry, pid } = ctx;

  for (const burst of enemyCDTimeline.alignedBurstWindows) {
    // Take the highest-damage spike inside the window — matching the rendered
    // wording "peak spike". The old .find() also returned the maximum, but only
    // because of the implicit behaviour that **pressureWindows happens to be
    // sorted by totalDamage descending** (the other qualifyingSpikes site in
    // this file has already been bitten by the same ordering dependency).
    // State the criterion explicitly here: if the sort changes, the semantics
    // will not silently change with it.
    const candidates = pressureWindows.filter(
      (pw) =>
        pw.totalDamage >= DMG_SPIKE_THRESHOLD &&
        pw.fromSeconds >= burst.fromSeconds - 5 &&
        pw.fromSeconds <= burst.toSeconds + 5,
    );
    const overlappingSpike = candidates.reduce<
      (typeof candidates)[number] | undefined
    >(
      (best, pw) => (!best || pw.totalDamage > best.totalDamage ? pw : best),
      undefined,
    );
    if (!overlappingSpike) continue;
    const dmgM = (overlappingSpike.totalDamage / 1_000_000).toFixed(2);
    // Each CD carries its actual cast time — the window is a union, and without
    // per-CD times it gets read as "all popped together at the start" (059)
    const cdNames = burst.activeCDs
      .map((c) => `${c.spellName}@${fmtTime(c.castSeconds)}`)
      .join(" + ");
    const placement = peakSpikePlacement(
      burst.toSeconds,
      overlappingSpike.fromSeconds,
      overlappingSpike.toSeconds,
    );
    const marker = PEAK_SPIKE_MARKERS[placement];
    addEntry(
      burst.fromSeconds,
      // The damage number is the total of **that DMG SPIKE window**, not the
      // damage inside this burst window — the two intervals differ. Previously
      // only the burst's start/end were printed, so a reader inevitably read the
      // number as "damage during this window" (class I: the ord 017 responder
      // drew a wrong conclusion from exactly this). Label the window the damage
      // belongs to explicitly so number and interval line up.
      `${fmtTime(burst.fromSeconds)}  [OFFENSIVE WINDOW]   ${fmtTime(burst.fromSeconds)}–${fmtTime(burst.toSeconds)} | peak spike ${dmgM}M on ${pid(overlappingSpike.targetName)} (${overlappingSpike.targetSpec}) over ${fmtTime(overlappingSpike.fromSeconds)}–${fmtTime(overlappingSpike.toSeconds)}${marker} | CDs: ${cdNames}`,
    );
  }
}
