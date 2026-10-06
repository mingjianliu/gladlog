/**
 * [ENEMY HARD CAST] (F170) — enemy hard-cast kill spells (Chaos Bolt,
 * Pyroblast, …): the cast, its target, and whether it landed, was kicked or
 * was stopped.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../../data/spellEffectData";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitEnemyHardCastEntries(
  ctx: Pick<
    TimelineCtx,
    | "enemies"
    | "matchStartMs"
    | "matchEndSeconds"
    | "pid"
    | "addEntry"
    | "enemyPid"
  >,
): void {
  const { enemies, matchStartMs, matchEndSeconds, pid, addEntry, enemyPid } =
    ctx;

  const HARD_CAST_KILL_SPELLS = new Set(["116858", "11366", "1254294"]); // Chaos Bolt, Pyroblast
  /** below this a START→SUCCESS pair is an instant (Hot Streak), not a bar */
  const HARD_CAST_MIN_MS = 300;
  /** above this the success belongs to a later press, not this bar */
  const HARD_CAST_MAX_MS = 12_000;
  for (const enemy of enemies ?? []) {
    // A success belongs to one bar (codex: START 5 s / SUCCESS 7.5 s /
    // START 7.5 s / SUCCESS 10 s — the second START must not re-read the
    // first bar's 7.5 s success as a 0 s "instant").
    const consumedSuccess = new Set<object>();
    const starts = [...(enemy.castStartEvents ?? [])]
      .filter((e) => e.logLine.event === LogEvent.SPELL_CAST_START)
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp ||
          (a.logLine.lineIndex ?? 0) - (b.logLine.lineIndex ?? 0),
      );
    for (const event of starts) {
      if (!event.spellId || !HARD_CAST_KILL_SPELLS.has(event.spellId)) continue;
      const timeSeconds = (event.timestamp - matchStartMs) / 1000;
      if (timeSeconds < 0 || timeSeconds > matchEndSeconds) continue;
      // Reliability round 3 N10 (7d1f): every SPELL_CAST_START rendered — an
      // instant Hot Streak Pyroblast (START → SUCCESS 3–27 ms) and a bar the
      // mage aborted both read as "kept hard-casting Pyroblast". A line now
      // needs the same spell's SUCCESS ≥ HARD_CAST_MIN_MS after the start
      // and before the next start of it; instants and aborted bars are not
      // hard casts (a kick that stopped one shows on the [kick] line).
      // You cannot run two bars at once: ANY later START by this enemy
      // (any spell) ends this bar's window — the rule hardCastOccupancyWithin
      // uses (codex: an abandoned Pyroblast followed by a Fireball bar and a
      // Hot Streak instant read "3.0s cast, landed").
      const nextStart = starts.find(
        (e) =>
          e.timestamp > event.timestamp ||
          (e.timestamp === event.timestamp &&
            (e.logLine.lineIndex ?? 0) > (event.logLine.lineIndex ?? 0)),
      );
      // event order, not bare timestamps (codex: an instant START and its
      // SUCCESS at the same ms must not be read as the previous bar's end)
      const beforeNextStart = (e: {
        timestamp: number;
        logLine: { lineIndex?: number };
      }) =>
        nextStart === undefined ||
        e.timestamp < nextStart.timestamp ||
        (e.timestamp === nextStart.timestamp &&
          (e.logLine.lineIndex ?? 0) < (nextStart.logLine.lineIndex ?? 0));
      // The FIRST same-spell success after the start is this bar's outcome
      // (codex: skipping a 20 ms success to a later instant printed "3.0s
      // cast, landed"); an instant (< HARD_CAST_MIN_MS), no success before
      // the next start, or a success further than a bar can run
      // (HARD_CAST_MAX_MS) all mean "not a landed hard cast".
      const first = enemy.spellCastEvents.find(
        (e) =>
          e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          e.spellId === event.spellId &&
          !consumedSuccess.has(e) &&
          (e.timestamp > event.timestamp ||
            (e.timestamp === event.timestamp &&
              (e.logLine.lineIndex ?? 0) >= (event.logLine.lineIndex ?? 0))) &&
          beforeNextStart(e),
      );
      if (!first) continue;
      consumedSuccess.add(first);
      const castMs = first.timestamp - event.timestamp;
      if (castMs < HARD_CAST_MIN_MS || castMs > HARD_CAST_MAX_MS) continue;
      const landed = first;
      const spellName = getEnglishSpellName(event.spellId, event.spellName);
      const target = event.destUnitName ? ` → ${pid(event.destUnitName)}` : "";
      const castS = ((landed.timestamp - event.timestamp) / 1000).toFixed(1);
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [ENEMY HARD CAST]   ${enemyPid(enemy.name)}: ${spellName}${target} (${castS}s cast, landed)`,
      );
    }
  }
}
