/**
 * [ENEMY HARD CAST] (F170) — enemy hard-cast kill spells (Chaos Bolt,
 * Pyroblast, …): the cast, its target, and whether it landed, was kicked or
 * was stopped.
 *
 * Cut out of buildMatchTimeline verbatim (GH #116); the body is unchanged, only
 * its closure inputs now arrive through `ctx`. Output is pinned by the 605-file
 * acceptanceCapture context hash.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../../data/spellEffectData";
import { fmtTime } from "../../utils/renderGrid";
import type { TimelineCtx } from "./ctx";

export function emitEnemyHardCastEntries(
  ctx: Pick<
    TimelineCtx,
    | "enemies"
    | "friends"
    | "matchStartMs"
    | "matchEndSeconds"
    | "pid"
    | "addEntry"
    | "enemyPid"
  >,
): void {
  const {
    enemies,
    friends,
    matchStartMs,
    matchEndSeconds,
    pid,
    addEntry,
    enemyPid,
  } = ctx;

  /** how long after the completed cast its projectile's row can come
   * (Pyroblast's flight: 0:47.390 → MISS 0:48.381) */
  const HARD_CAST_RESULT_MS = 2500;
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
      // fact2 (2026-10-20): a completed cast is not a hit — what it did is
      // the projectile's row on its target (0d08dd90 0:47: a Pyroblast into
      // Phase Shift logged MISS and no damage, and the line said `landed`).
      // The caster's completions of the spell at that target get the result
      // rows inside `HARD_CAST_RESULT_MS` (`hardCastResultOf`): a damage row, or a SPELL_ABSORBED row a shield
      // ate whole → `landed`; a miss row → `went off, <TYPE>`; none → `went
      // off`. Each row goes to the earliest completion before it that has
      // none yet (throw order), not "the first row before the next
      // completion": a Hot Streak instant 1 ms after the bar flies behind it
      // (5-1 0:54: bar .795, instant .796, the two hits at .999 and 1.013)
      const destId = landed.destUnitId || event.destUnitId;
      const outcome = hardCastResultOf(
        enemy,
        event.spellId,
        destId,
        landed,
        friends.find((f) => f.id === destId),
        HARD_CAST_RESULT_MS,
      );
      addEntry(
        timeSeconds,
        `${fmtTime(timeSeconds)}  [ENEMY HARD CAST]   ${enemyPid(enemy.name)}: ${spellName}${target} (${castS}s cast, ${outcome})`,
      );
    }
  }
}

/** The result row a completion of `spellId` at `destId` gets — a damage
 * row, a SPELL_ABSORBED row with no damage row of that hit (a hit a shield
 * ate whole), or a miss row — paired in throw order (fact4 D21). */
function hardCastResultOf(
  enemy: ICombatUnit,
  spellId: string,
  destId: string | undefined,
  completion: { timestamp: number },
  destUnit: ICombatUnit | undefined,
  windowMs: number,
): string {
  if (!destId) return "went off";
  const completions = enemy.spellCastEvents
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        e.spellId === spellId &&
        e.destUnitId === destId,
    )
    .map((e) => e.timestamp)
    .sort((a, b) => a - b);
  const damageMs = (enemy.damageOut ?? [])
    .filter((d) => d.spellId === spellId && d.destUnitId === destId)
    .map((d) => d.logLine.timestamp);
  // a hit the shield ate whole: its MISS ABSORB row stands for it, so its
  // SPELL_ABSORBED row is not a second hit
  const absorbMissMs = (enemy.missesOut ?? [])
    .filter(
      (m) =>
        m.spellId === spellId &&
        m.destUnitId === destId &&
        m.missType === "ABSORB",
    )
    .map((m) => m.timestamp);
  const rows: Array<{ ms: number; outcome: string }> = [
    ...damageMs.map((ms) => ({ ms, outcome: "landed" })),
    ...(destUnit?.absorbsIn ?? [])
      .filter(
        (a) =>
          a.attackerId === enemy.id &&
          a.attackSpellId === spellId &&
          ![...damageMs, ...absorbMissMs].some(
            (ms) => Math.abs(ms - a.timestamp) <= 1,
          ),
      )
      .map((a) => ({ ms: a.timestamp, outcome: "landed" })),
    ...(enemy.missesOut ?? [])
      .filter((m) => m.spellId === spellId && m.destUnitId === destId)
      .map((m) => ({
        ms: m.timestamp,
        // a `MISS … ABSORB` row is the hit a shield ate whole, logged again
        // (its SPELL_ABSORBED row carries it) — it landed
        outcome:
          m.missType === "ABSORB"
            ? "landed"
            : m.missType
              ? `went off, ${m.missType}`
              : "went off",
      })),
  ].sort((a, b) => a.ms - b.ms);
  // each result row, in time order, belongs to the EARLIEST completion at or
  // before it (inside `windowMs`) that has none yet: one caster's
  // projectiles of one spell at one target fly at one speed, so they arrive
  // in the order they were thrown — a Hot Streak instant 1 ms after a bar
  // (bar .795, instant .796, hits .999 / 1.013), and fact4 D21 (3ab80597 r3
  // 2:13): bolts done 2:15.221 / 2:16.467 at ~32 yd, hits 2:16.513 /
  // 2:18.132 — the "latest completion" rule (ef24bfdfe) gave the first hit
  // to the bolt done 46 ms before it and the first bolt read `went off`.
  // Flight measured on 605 new-season files (isolated completions, one row
  // inside 3 s): Chaos Bolt p50 852 ms / p95 1.79 s (n 597), Pyroblast p50
  // 455 ms / p95 0.99 s (n 1,188)
  const resultOf = new Map<number, string>();
  for (const r of rows) {
    for (let k = 0; k < completions.length; k++) {
      const c = completions[k]!;
      if (c > r.ms) break;
      if (r.ms - c > windowMs) continue;
      if (resultOf.has(k)) continue;
      resultOf.set(k, r.outcome);
      break;
    }
  }
  const idx = completions.indexOf(completion.timestamp);
  return (idx >= 0 ? resultOf.get(idx) : undefined) ?? "went off";
}
