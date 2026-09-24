import { ICombatUnit } from "@gladlog/parser-compat";

import { IMajorCooldownInfo, specToString } from "../utils/cooldowns";
import { fmtTime } from "../utils/renderGrid";
import { IEnemyCDTimeline } from "../utils/enemyCDs";

/**
 * Structured phase of `buildMatchArc`. `prose` is the exact sentence
 * `buildMatchArc` renders after the colon for this phase — the two must
 * stay byte-identical (gate predicates are the spec: the structured output is
 * the single source, prose only formats it).
 */
export interface IMatchArcPhase {
  phase: "early" | "mid" | "late";
  fromS: number;
  toS: number;
  /** One sentence for this phase (identical to the text after the colon on
   * buildMatchArc's corresponding line). */
  prose: string;
  /** early = the first defensive CD; mid = the first death or the first burst
   * window resolving, whichever comes earlier. */
  turningPoint?: { tS: number; label: string };
}

/**
 * Builds a compact 3-sentence match arc (Early / Mid / Late) before the CRITICAL MOMENTS
 * section, so the LLM understands match flow before evaluating individual moments.
 *
 * Phase boundaries (per AI_CONTEXT_REFACTOR.md):
 *   Early: match start → first major defensive used by either team
 *   Mid:   first defensive → first friendly death OR first burst window resolved
 *   Late:  that boundary → match end
 *
 * Edge cases:
 *   - Match < 90s: collapse to two phases (Pressure / Death or Resolution)
 *   - 3v3 + duration > 180s + no deaths: Late = "dampening reached"
 *   - Win with no friendly deaths: three phases still emitted; Late describes kill finish
 *
 * This is the structured single source (#10 T1). `buildMatchArc` below is a
 * pure formatter over this output — do not duplicate the phase-boundary math.
 */
export function buildMatchArcStructured(
  enemyCDTimeline: IEnemyCDTimeline,
  allTeamCooldownsWithPlayer: Array<{
    player: ICombatUnit;
    cd: IMajorCooldownInfo;
  }>,
  friendlyDeaths: Array<{ spec: string; atSeconds: number }>,
  durationSeconds: number,
  bracket: string,
): IMatchArcPhase[] {
  // Edge case: very short match — collapse to two phases
  if (durationSeconds < 90) {
    const mid = Math.round(durationSeconds / 2);
    const phases: IMatchArcPhase[] = [
      {
        phase: "early",
        fromS: 0,
        toS: mid,
        prose: "Early pressure established — no recovery window.",
      },
    ];
    if (friendlyDeaths.length > 0) {
      const d = friendlyDeaths[0];
      phases.push({
        phase: "late",
        fromS: mid,
        toS: durationSeconds,
        prose: `${d.spec} died at ${fmtTime(d.atSeconds)} — speed kill.`,
      });
    } else {
      phases.push({
        phase: "late",
        fromS: mid,
        toS: durationSeconds,
        prose: "Match resolved quickly — no friendly deaths.",
      });
    }
    return phases;
  }

  const burstsSorted = [...enemyCDTimeline.alignedBurstWindows].sort(
    (a, b) => a.fromSeconds - b.fromSeconds,
  );
  const firstBurst = burstsSorted[0] ?? null;
  const firstDeath = friendlyDeaths[0];

  // Find first defensive cast from either team
  let firstDefensiveSeconds = Infinity;
  let firstDefensiveName = "";
  let firstDefensiveSpec = "";
  for (const { player, cd } of allTeamCooldownsWithPlayer) {
    if (cd.tag !== "Defensive" || cd.neverUsed || cd.casts.length === 0)
      continue;
    const cast = cd.casts[0];
    if (cast.timeSeconds < firstDefensiveSeconds) {
      firstDefensiveSeconds = cast.timeSeconds;
      firstDefensiveName = cd.spellName;
      firstDefensiveSpec = specToString(player.spec);
    }
  }

  // Phase boundaries
  const earlyEnd =
    firstDefensiveSeconds < Infinity
      ? firstDefensiveSeconds
      : durationSeconds / 2;
  const firstBurstResolved =
    firstBurst !== null ? firstBurst.toSeconds : Infinity;
  const firstFriendlyDeathSeconds = firstDeath?.atSeconds ?? Infinity;
  const midEnd = Math.min(firstFriendlyDeathSeconds, firstBurstResolved);
  // Clamp lateStart >= earlyEnd to prevent inverted phase ranges (e.g. "Mid (1:11–0:53)")
  // when a death/burst occurs before the first defensive is spent.
  const rawLateStart =
    midEnd < Infinity ? midEnd : earlyEnd + (durationSeconds - earlyEnd) / 2;
  const lateStart = Math.max(earlyEnd, rawLateStart);

  const phases: IMatchArcPhase[] = [];

  // Early phase prose
  const earlyBursts = burstsSorted.filter((b) => b.fromSeconds < earlyEnd);
  let earlyProse: string;
  if (earlyBursts.length > 0) {
    const burst = earlyBursts[0];
    const cdNames = burst.activeCDs.map((c) => c.spellName).join(" + ");
    earlyProse = `Enemy aligned burst established pressure (${burst.dangerLabel} — ${cdNames}); no major defensives spent.`;
  } else if (firstDefensiveSeconds === Infinity) {
    earlyProse =
      "No coordinated burst; match opened with sustained pressure and no defensive CDs committed.";
  } else {
    earlyProse =
      "No coordinated enemy burst in opening phase; sustained/DoT pressure building.";
  }
  const earlyPhase: IMatchArcPhase = {
    phase: "early",
    fromS: 0,
    toS: earlyEnd,
    prose: earlyProse,
  };
  if (firstDefensiveSeconds < Infinity) {
    earlyPhase.turningPoint = {
      tS: firstDefensiveSeconds,
      label: `${firstDefensiveSpec}'s ${firstDefensiveName}`,
    };
  }
  phases.push(earlyPhase);

  // Mid phase prose — skip if zero-duration (earlyEnd === lateStart, e.g. first death/burst before first defensive)
  if (earlyEnd < lateStart) {
    let midProse: string;
    if (firstDefensiveSeconds < Infinity) {
      const midBursts = burstsSorted.filter(
        (b) => b.fromSeconds >= earlyEnd && b.fromSeconds < lateStart,
      );
      const burstNote =
        midBursts.length > 0
          ? ` in response to ${midBursts[0].dangerLabel} burst at ${fmtTime(midBursts[0].fromSeconds)}`
          : "";
      midProse = `${firstDefensiveSpec}'s ${firstDefensiveName} committed${burstNote} — limited major CD coverage remaining.`;
    } else {
      midProse =
        "No major defensive CDs committed; match progressed through sustained pressure.";
    }
    const midPhase: IMatchArcPhase = {
      phase: "mid",
      fromS: earlyEnd,
      toS: lateStart,
      prose: midProse,
    };
    if (midEnd < Infinity) {
      midPhase.turningPoint =
        firstFriendlyDeathSeconds <= firstBurstResolved
          ? { tS: midEnd, label: `${firstDeath!.spec} died` }
          : { tS: midEnd, label: "burst window resolved" };
    }
    phases.push(midPhase);
  }

  // Late phase prose
  let lateProse: string;
  const lateBursts = burstsSorted.filter((b) => b.fromSeconds >= lateStart);
  const lateBurstNote =
    lateBursts.length > 0
      ? `Second burst (${lateBursts[0].dangerLabel}) aligned with`
      : "Pressure continued with";
  if (firstDeath) {
    lateProse = `${lateBurstNote} limited defensive options → ${firstDeath.spec} died at ${fmtTime(firstDeath.atSeconds)}.`;
  } else if (bracket === "3v3" && durationSeconds > 180) {
    lateProse =
      "Dampening reached — healing reduced; match extended to kill window.";
  } else {
    lateProse = "Match concluded — no friendly deaths; pressure neutralized.";
  }
  phases.push({
    phase: "late",
    fromS: lateStart,
    toS: durationSeconds,
    prose: lateProse,
  });

  return phases;
}

/**
 * Formats `buildMatchArcStructured`'s output into the `MATCH ARC:` prose block.
 * Pure formatter — do not recompute phase boundaries here; consume the
 * structured phases (gate predicates are the spec: analysis and the gate must
 * share one predicate for the same judgment; prose is only the render layer).
 * Output must stay byte-identical to the pre-refactor
 * implementation (see matchNarrative.arc.test.ts consistency assertions).
 */
export function buildMatchArc(
  enemyCDTimeline: IEnemyCDTimeline,
  allTeamCooldownsWithPlayer: Array<{
    player: ICombatUnit;
    cd: IMajorCooldownInfo;
  }>,
  friendlyDeaths: Array<{ spec: string; atSeconds: number }>,
  durationSeconds: number,
  bracket: string,
): string[] {
  const lines: string[] = [];
  lines.push("MATCH ARC:");

  const phases = buildMatchArcStructured(
    enemyCDTimeline,
    allTeamCooldownsWithPlayer,
    friendlyDeaths,
    durationSeconds,
    bracket,
  );

  // Edge case: very short match — collapse to two phases
  if (durationSeconds < 90) {
    const [pressure, resolution] = phases;
    lines.push(`  Pressure (0:00–${fmtTime(pressure.toS)}): ${pressure.prose}`);
    const label = friendlyDeaths.length > 0 ? "Death" : "Resolution";
    lines.push(
      `  ${label} (${fmtTime(resolution.fromS)}–${fmtTime(resolution.toS)}): ${resolution.prose}`,
    );
    return lines;
  }

  const headerLabel: Record<IMatchArcPhase["phase"], string> = {
    early: "Early",
    mid: "Mid",
    late: "Late",
  };
  for (const phase of phases) {
    lines.push(
      `  ${headerLabel[phase.phase]} (${fmtTime(phase.fromS)}–${fmtTime(phase.toS)}): ${phase.prose}`,
    );
  }

  return lines;
}
