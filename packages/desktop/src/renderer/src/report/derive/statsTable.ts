import { analyzePlayerCCAndTrinket, isKickSpellId } from "@gladlog/analysis";
import { CombatUnitReaction, LogEvent } from "@gladlog/parser-compat";

import { dispelSummaryOf } from "./dispelSummary";
import { toLegacySafe } from "./legacySource";
import { displaySpellName } from "./spellDisplay";
import {
  eventInRange,
  overlapSeconds,
  rangeDurationS,
  type TimeRange,
  tInRange,
} from "./timeRange";
import type { ReportSource } from "./types";

/** Detail instance (for row expansion, backlog #10 v2); tS = relative seconds. */
export interface StatsInstance {
  tS: number;
  /** Event description, e.g. "Wind Shear → Chaos Bolt" /
   * "Kidney Shot 5.0s(Rogue X)". */
  label: string;
}

export interface StatsRow {
  unitId: string;
  name: string;
  classId: number;
  reaction: string;
  /** Interrupt casts (SPELL_CAST_SUCCESS ∩ the interrupts category). */
  kicksCast: number;
  /** Times interrupted by the enemy (analysis interruptInstances). */
  kicksTaken: number;
  /** Total seconds spent under CC (analysis ccInstances). */
  ccTakenS: number;
  /** CC time as a percentage of the whole match. */
  ccTakenPct: number;
  /** Friendly dispels (cleansing a teammate). */
  cleanses: number;
  /** Offensive dispels / buff steals. */
  purges: number;
  /** Row-expansion detail: interrupt casts / interrupts taken / CC taken
   * (each in ascending time order). */
  detail: {
    kicksCast: StatsInstance[];
    kicksTaken: StatsInstance[];
    ccTaken: StatsInstance[];
  };
}

/**
 * Per-player hard-data table (backlog #10): interrupts / CC taken / dispels.
 * Every decision consumes an analysis predicate
 * (analyzePlayerCCAndTrinket / reconstructDispelSummary / the interrupt
 * category table); the render layer never rebuilds a whitelist — that is where
 * whitelist rot is born.
 */
/** range (time-window linkage ①): filtering happens at the FACT layer — the
 * decisions are still computed on the full stream (state inference must not be
 * polluted by the window), and only then are facts filtered by timestamp and
 * durations clipped by overlap. Predicates live in derive/timeRange.ts. */
export function deriveStatsTable(
  source: ReportSource,
  range?: TimeRange | null,
): StatsRow[] {
  try {
    const legacy = toLegacySafe(source);
    const durationS = Math.max(1, rangeDurationS(legacy, range));
    const inR = eventInRange(legacy, range);
    const players = Object.values(legacy.units).filter((u) => u.info);
    if (players.length === 0) return [];
    const friends = players.filter(
      (u) => u.reaction === CombatUnitReaction.Friendly,
    );
    const enemies = players.filter(
      (u) => u.reaction === CombatUnitReaction.Hostile,
    );
    // Both analysis functions below are handed the round itself (`legacy`),
    // as the prompt and `keyMoments.ts` hand it: they read the round's end
    // off it (`roundEndMs` — a Solo Shuffle round is over at its first player
    // death, though its log runs ~2 s on), so a control still on at that
    // death counts to the death and not to its logged removal. This used to
    // be `{startTime, endTime, startInfo: {zoneId: legacy.zoneId ?? ""}}`:
    // no round, and a zone read off a field the legacy match does not have
    // (it is `startInfo.zoneId`), so always "".

    // Dispels both ways: build once from our perspective and once from the
    // enemy's (same predicate, symmetric on both sides). B1 (user
    // 2026-10-24): the dispel panel's reading (`dispelSummaryOf`: both
    // sides' pets, a pet's dispel credited to its owner, B45) — the table's
    // 解 / 驱散 had left a Warlock's pet purges out (3 of 184 rows).
    const ourDispels = dispelSummaryOf(legacy, friends, enemies);
    const theirDispels = dispelSummaryOf(legacy, enemies, friends);

    const rows: StatsRow[] = [];
    for (const p of players) {
      const opponents =
        p.reaction === CombatUnitReaction.Friendly ? enemies : friends;
      const oppIds = new Set(opponents.map((o) => o.id));
      const oppPets = Object.values(legacy.units).filter(
        (u) => u.ownerId && oppIds.has(u.ownerId),
      );
      const cc = analyzePlayerCCAndTrinket(p, opponents, legacy, oppPets);
      // CC instances inside the window: overlap > 0 counts toward the instance
      // count, and duration counts only the overlapping part (a
      // boundary-crossing instance does not vanish wholesale)
      const ccInWindow = cc.ccInstances.filter(
        (i) => overlapSeconds(i.atSeconds, i.durationSeconds, range) > 0,
      );
      const ccTakenS = ccInWindow.reduce(
        (s, i) => s + overlapSeconds(i.atSeconds, i.durationSeconds, range),
        0,
      );
      const kicksTakenInWindow = cc.interruptInstances.filter((i) =>
        tInRange(i.atSeconds, range),
      );
      const kickCastEvents = p.spellCastEvents.filter(
        (e) =>
          e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          isKickSpellId(e.spellId ?? "") &&
          inR(e.logLine),
      );
      const kicksCast = kickCastEvents.length;
      const dispels =
        p.reaction === CombatUnitReaction.Friendly ? ourDispels : theirDispels;
      // Deliberate casts only (UI review #3) — procs/riders are not decisions.
      const cleanses = dispels.allyCleanse.filter(
        (d) =>
          d.sourceName === p.name &&
          d.dispelKind === "deliberate" &&
          tInRange(d.timeSeconds, range),
      ).length;
      const purges = dispels.ourPurges.filter(
        (d) =>
          d.sourceName === p.name &&
          d.dispelKind === "deliberate" &&
          tInRange(d.timeSeconds, range),
      ).length;

      rows.push({
        unitId: p.id,
        name: p.name,
        classId: Number(p.class),
        reaction:
          p.reaction === CombatUnitReaction.Friendly ? "Friendly" : "Hostile",
        kicksCast,
        kicksTaken: kicksTakenInWindow.length,
        ccTakenS: Math.round(ccTakenS * 10) / 10,
        ccTakenPct: Math.round((100 * ccTakenS) / durationS),
        cleanses,
        purges,
        detail: {
          kicksCast: kickCastEvents
            .map((e) => ({
              tS: (e.logLine.timestamp - legacy.startTime) / 1000,
              label: displaySpellName(e.spellId ?? "", e.spellName ?? ""),
            }))
            .sort((a, b) => a.tS - b.tS),
          kicksTaken: kicksTakenInWindow
            .map((i) => ({
              tS: i.atSeconds,
              label: `${i.kickSpellName} 打断 ${i.interruptedSpellName}(${i.sourceName})`,
            }))
            .sort((a, b) => a.tS - b.tS),
          ccTaken: ccInWindow
            .map((i) => ({
              tS: i.atSeconds,
              label: `${i.spellName} ${i.durationSeconds.toFixed(1)}s(${i.sourceName})`,
            }))
            .sort((a, b) => a.tS - b.tS),
        },
      });
    }
    // Friendlies first, then by CC duration descending within each group (the
    // most targeted player on top)
    return rows.sort(
      (a, b) =>
        (a.reaction === "Friendly" ? 0 : 1) -
          (b.reaction === "Friendly" ? 0 : 1) || b.ccTakenS - a.ccTakenS,
    );
  } catch {
    return [];
  }
}
