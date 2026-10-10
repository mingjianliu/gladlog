import { CombatUnitType, ICombatUnit } from "@gladlog/parser-compat";

import { fmtTime, toRenderSecond } from "./renderGrid";

// DF RULES https://www.icy-veins.com/forums/topic/69530-dampening-and-healing-changes-in-dragonflight-pre-patch-phase-2-arenas/
// Solo Shuffle - Start at 10% Dampening and after 1 minute, ramp up at a pace of 25% per minute
// 3v3 - Start at 10% Dampening and after 3 minutes (down from 5 minutes), ramp up at a pace of 6% per minute
// 2v2 - the Dragonflight start values (30% with a healer on both teams, 10%
//   otherwise) are NOT what the log prints any more; see `getInitialDampening`.

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface DampeningEvent {
  timestamp: number;
  stacks: number;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Pre-computes all dampening aura dose events from the player list, sorted
 * ascending by timestamp. Called once per timeline computation to avoid
 * flatMapping all players on every sample interval.
 *
 * Both dose events carry the stack count AFTER the change. The stack also
 * goes DOWN (FT-T08 step 4): in 3 of the 60 re-eval logs — all 2v2, after a
 * player died — the survivors' Dampening dropped by a third or more on a
 * SPELL_AURA_REMOVED_DOSE line (95127ab4: 51 → 32) and climbed again from
 * there; read on APPLIED_DOSE alone it stayed at 52 until the next dose.
 *
 * This is the ONE place the stack count is read off a dose line
 * (`doseStackCount`).
 */
export function buildDampeningEvents(players: ICombatUnit[]): DampeningEvent[] {
  const events: DampeningEvent[] = [];
  for (const a of (players ?? []).flatMap((p) => p?.auraEvents ?? [])) {
    if (!a || a.spellId !== "110310") continue;
    if (
      !a.logLine ||
      (a.logLine.event !== "SPELL_AURA_APPLIED_DOSE" &&
        a.logLine.event !== "SPELL_AURA_REMOVED_DOSE")
    )
      continue;
    const stacks = doseStackCount(a.logLine.parameters?.[12]);
    if (stacks !== null) events.push({ timestamp: a.timestamp, stacks });
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * The stack count of a dose line's amount parameter, or null when it is not
 * a count.
 *
 * The parser hands it over as a number — except in a document stored by a
 * parser older than the CRLF fix (parser/src/api.ts): the amount is the last
 * field of the line, so it kept the line's trailing "\r" ("42\r"), which
 * parser-compat's `convertParams` leaves a string. Such a document's stacks
 * were never read; in 2v2, where no value is stated before the first logged
 * stack (`getInitialDampening`), that left the whole round without a
 * dampening number. Trailing / leading whitespace is trimmed here and a
 * plain non-negative integer is accepted; anything else is still not a
 * count.
 */
function doseStackCount(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Returns the dampening stack count at or before `upToTimestamp` from a
 * pre-built sorted event list, falling back to `fallback` if no event exists
 * yet — `null` where no value is stated before the first logged stack
 * (`getInitialDampening`).
 */
function getDampeningFromEvents<F extends number | null>(
  events: DampeningEvent[],
  upToTimestamp: number,
  fallback: F,
): number | F {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].timestamp <= upToTimestamp) {
      return events[i].stacks;
    }
  }
  return fallback;
}

/**
 * The round's first logged dampening stack (the earliest dose event of the
 * units handed in), or null when the log printed none.
 */
export function firstLoggedDampening(
  players: ICombatUnit[],
): DampeningEvent | null {
  return buildDampeningEvents(players)[0] ?? null;
}

/** Which bracket's dampening rules a round runs under. */
export type DampeningRules = "2v2" | "3v3" | "Rated Solo Shuffle";

/**
 * The one classification of a round's dampening rules — every consumer of a
 * dampening value goes through it (`getInitialDampening`), so one prompt never
 * states two different start values.
 *
 * The bracket string decides when it names a bracket (the literal
 * ARENA_MATCH_START strings "2v2", "3v3", "Rated Solo Shuffle"); the roster
 * size is only the fallback for a string that names none (a skirmish, an
 * absent bracket). The roster is counted on PLAYERS only, whatever list the
 * caller hands in: three consumers used to pass every unit of the round —
 * pets, totems and guardians included — to a count of "more than four", so a
 * 2v2 round with a pet out was classified 3v3 and its press lines read
 * `dampening: 10%` under a header that said `started at 30%` (FT-T13, D10:
 * 159 of the 516 healer-2v2 prompts / 220 lines of the 605-file capture).
 *
 * For a string that names no bracket `units` must be the round's WHOLE
 * roster — one side alone never counts more than four.
 *
 * (The 2v2 "healer on both teams" / "double DPS" split is gone with the two
 * start values it selected — see `getInitialDampening`.)
 */
export function dampeningRulesOf(
  bracket: string | undefined,
  units: readonly ICombatUnit[] | undefined,
): DampeningRules {
  const safeBracket = bracket ?? "";
  if (safeBracket === "Rated Solo Shuffle") {
    return "Rated Solo Shuffle";
  }
  if (safeBracket.includes("3v3") || safeBracket.includes("Three")) {
    return "3v3";
  }
  if (safeBracket.includes("2v2")) {
    return "2v2";
  }
  const players = (units ?? []).filter(
    (u) => u?.type === CombatUnitType.Player,
  );
  return players.length > 4 ? "3v3" : "2v2";
}

/**
 * THE RULE'S HOME: the dampening value stated BEFORE the round's first logged
 * stack — or `null`, where none is stated. Exported for callers that compose
 * "event stream + initial value" themselves (desktop's deriveDampeningSeries);
 * nobody may copy the table a second time.
 *
 * The log never prints a value before the first stack event (aura 110310,
 * SPELL_AURA_APPLIED_DOSE / _REMOVED_DOSE — the plain APPLIED line carries no
 * count), so whatever is said about that span is a claim about the game:
 *
 * - **3v3 and Solo Shuffle: 10 — kept as it was.** Also a hand value the log
 *   does not print before the first stack, but one the first stack does not
 *   contradict, and outside the D11 ruling (which is about 2v2). The ramp
 *   starts late there: in 3v3 the first stack reads 11 in 85 of 85 rounds
 *   that logged one, 90 s or more into the round (180 s after the aura is
 *   applied in the sampled round); in Shuffle it reads 12 / 11 / 13 in
 *   510 / 187 / 12 rounds, 20–90 s in (about 60 s after the aura is applied)
 *   — a flat 10, then the ramp (605-file capture).
 * - **2v2: `null` — deliberately not stated** (user ruling 2026-10-10, D11
 *   of FT-T13, "follow the log's first tick", re-opening the signed O10 of
 *   2026-09-30 that had kept 30 / 10). The table's Dragonflight values — 30 with a healer
 *   on both teams, 10 otherwise — are contradicted by the log: the first
 *   stack, about 10 s after the aura is applied, reads **42 in 258 of 258**
 *   rounds with two healers and **22 in 32 of 32** rounds of the other kind
 *   (605-file capture), and from there the stack climbs by one every 10 s.
 *   Stepping one tick back gives 41 / 21, but that is an extrapolation: a
 *   number the log never prints (Game-Behaviour Rule). So before its first
 *   logged stack a 2v2 prompt carries NO dampening number — no `started at`,
 *   no `| dampening:` note, no `[DAMPENING ALERT]`, no `damp:` — and the
 *   header says `first logged at N% (m:ss)` instead.
 *
 * Do not "fix" the 2v2 `null` back into a number without a logged source for
 * it. The one place that needs a weight where none is stated is the
 * burst-window threat score — see `dampeningForThreatWeight`.
 */
export function getInitialDampening(
  bracket: string,
  players: readonly ICombatUnit[],
): number | null {
  const rules = dampeningRulesOf(bracket, players);
  if (rules === "2v2") {
    return null;
  }
  // 3v3, Rated Solo Shuffle
  return 10;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The dampening (0–100) at `timestamp` — `null` where none is stated: a 2v2
 * round before its first logged stack (`getInitialDampening`). A caller that
 * prints the value prints nothing on `null`.
 *
 * `players` are the units whose stack events are read. `roster` is the round's
 * whole unit list the bracket is classified from (`dampeningRulesOf`); it
 * defaults to `players` and must be passed whenever `players` is only one side
 * of the round.
 */
export function getDampeningPercentage(
  bracket: string,
  players: ICombatUnit[],
  timestamp: number,
  roster: readonly ICombatUnit[] = players,
): number | null {
  const events = buildDampeningEvents(players);
  const fallback = getInitialDampening(bracket, roster);
  // FIX 3: use ?? instead of || so stacks=0 is not conflated with "no data"
  return getDampeningFromEvents(events, timestamp, fallback);
}

// ---------------------------------------------------------------------------
// Burst window danger scoring helpers
// ---------------------------------------------------------------------------

/**
 * The dampening at a match instant as a 0–1 fraction (0.30 = 30%), or `null`
 * where none is stated (see `getDampeningPercentage`).
 */
export function computeDampening(
  matchTimeMs: number,
  bracket: string,
  players: ICombatUnit[],
  roster: readonly ICombatUnit[] = players,
): number | null {
  const damp = getDampeningPercentage(bracket, players, matchTimeMs, roster);
  return damp === null ? null : Math.min(damp / 100, 1.0);
}

/**
 * The dampening (0–1) a burst window's threat score is WEIGHTED with — never
 * a printed number. Where a value is stated it is that value. Where none is
 * (a 2v2 round before its first logged stack) the weight reads the round's
 * first logged stack — the nearest number the log does print — and 0 when the
 * log printed no stack at all.
 *
 * This is an implementation choice of FT-T13 D11, not part of the ruling
 * (which is about what the prompt STATES). The alternative is no weight
 * (×1.0) before the first stack; it was not taken because every 2v2 round's
 * first stack reads 42 or 22 (`getInitialDampening`), so ×1.0 would score an
 * opener at 0:08 as if the round had no dampening and step the same burst to
 * ×1.63 at 0:12. Before D11 the weight there came from the hand value
 * (30 → ×1.45, 10 → ×1.15). To switch, return 0 instead of the first stack.
 */
export function dampeningForThreatWeight(
  matchTimeMs: number,
  bracket: string,
  players: ICombatUnit[],
  roster: readonly ICombatUnit[] = players,
): number {
  const stated = computeDampening(matchTimeMs, bracket, players, roster);
  if (stated !== null) return stated;
  const first = firstLoggedDampening(players);
  return first ? Math.min(first.stacks / 100, 1.0) : 0;
}

/**
 * Danger multiplier from dampening: the same incoming damage is harder to heal when
 * dampening is high.
 * 0% → 1.0×  |  30% → 1.45×  |  60% → 1.9×
 */
export function dampeningDangerMultiplier(dampening: number): number {
  return 1 + dampening * 1.5;
}

export function fmtDampening(dampening: number): string {
  return `${Math.round(dampening * 100)}%`;
}

// ---------------------------------------------------------------------------
// AI context helpers
// ---------------------------------------------------------------------------

export interface IDampeningSnapshot {
  atSeconds: number;
  dampening: number;
}

/**
 * Returns a sparse timeline of dampening values sampled every 30s, plus the
 * final value at match end. Only includes entries where dampening changed from
 * the previous sample (avoids repetitive flat sections).
 * Events are precomputed once and reused across all sample points (FIX 1).
 *
 * A sample where no value is stated (a 2v2 round before its first logged
 * stack, `getInitialDampening`) is skipped, so the first entry of such a
 * round sits after 0 s, and the list is empty when the log printed no stack.
 */
export function computeDampeningTimeline(
  bracket: string,
  players: ICombatUnit[],
  startTime: number,
  endTime: number,
): IDampeningSnapshot[] {
  const durationMs = endTime - startTime;
  // FIX 1: build event list once, reuse across all sample intervals
  const events = buildDampeningEvents(players);
  const fallback = getInitialDampening(bracket, players);
  const snapshots: IDampeningSnapshot[] = [];
  const INTERVAL_MS = 30_000;

  let prevDamp = -1;
  for (let ms = 0; ms <= durationMs; ms += INTERVAL_MS) {
    const pct = getDampeningFromEvents(events, startTime + ms, fallback);
    if (pct === null) continue;
    const damp = pct / 100;
    if (damp !== prevDamp) {
      snapshots.push({ atSeconds: ms / 1000, dampening: damp });
      prevDamp = damp;
    }
  }

  // Always include the final value if not already captured
  const finalPct = getDampeningFromEvents(events, endTime, fallback);
  const durationSeconds = durationMs / 1000;
  if (
    finalPct !== null &&
    (snapshots.length === 0 ||
      snapshots[snapshots.length - 1].dampening !== finalPct / 100)
  ) {
    snapshots.push({ atSeconds: durationSeconds, dampening: finalPct / 100 });
  }

  return snapshots;
}

export function formatDampeningForContext(
  bracket: string,
  players: ICombatUnit[],
  startTime: number,
  endTime: number,
): string[] {
  const timeline = computeDampeningTimeline(
    bracket,
    players,
    startTime,
    endTime,
  );
  const durationSeconds = (endTime - startTime) / 1000;
  // No value stated at any point of the round: a 2v2 round with no logged
  // stack (`getInitialDampening`). Said, not left out — and as what the data
  // has, not as a reason: the usual case is a round that ended inside its
  // first ~11 s, but a stored document that lost its dose lines says the
  // same whatever the round's length.
  if (timeline.length === 0) {
    return [
      `DAMPENING (${bracket}): n/a — no dampening stack was logged in this round (${toRenderSecond(durationSeconds)}s)`,
    ];
  }
  const finalDamp = timeline[timeline.length - 1].dampening;

  // Short matches where dampening barely moved: emit an explicit n/a line instead of
  // silently omitting the section — full-scale audit judges read the absence as missing
  // data (a sufficiency ding) rather than "considered and irrelevant".
  if (durationSeconds < 90 && finalDamp < 0.15) {
    return [
      // Snap to the render grid: MATCH FACTS' Duration uses fmtTime (floor),
      // so using Math.round here would make a 36.8s match report 37s in one
      // place and 0:36 in another (a class-H self-contradiction).
      `DAMPENING (${bracket}): n/a — match ended (${toRenderSecond(durationSeconds)}s) before dampening ramped (${fmtDampening(finalDamp)} at end)`,
    ];
  }

  const lines: string[] = [];

  // Compact single-line summary — the ramp schedule is fixed per bracket so only the
  // endpoint matters for AI reasoning. Full timeline is visible in the Dispels UI tab.
  //
  // The opening clause states what is known at 0:00. A value is stated there
  // in 3v3 / Solo Shuffle (`started at`); in 2v2 none is, and the clause gives
  // the first logged stack and its second instead — the second the first
  // `| dampening:` note and the first `[DAMPENING ALERT]` can appear at
  // (`checkDampeningStartConsistency` reads it back).
  const knownAtStart = timeline[0].atSeconds === 0;
  const first = knownAtStart ? null : firstLoggedDampening(players);
  const opening = first
    ? `first logged at ${first.stacks}% (${fmtTime((first.timestamp - startTime) / 1000)}; the log prints no value before that)`
    : `started at ${fmtDampening(timeline[0].dampening)}`;
  lines.push(
    `DAMPENING (${bracket}): ${opening}, ended at ${fmtDampening(finalDamp)} at match end`,
  );

  if (finalDamp >= 0.4) {
    lines.push(
      `  Dampening ${fmtDampening(finalDamp)} at match end (≥40% bracket: healing received reduced by ${fmtDampening(finalDamp)}).`,
    );
  } else if (finalDamp >= 0.2) {
    lines.push(
      `  Dampening ${fmtDampening(finalDamp)} at match end (≥20% bracket).`,
    );
  }

  return lines;
}
