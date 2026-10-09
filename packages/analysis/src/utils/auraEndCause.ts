import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import { AURA_REBROADCAST_GAP_MS, dropAuraRebroadcasts } from "./auraIntervals";
import { ALLY_DISPEL_MATCH_TOLERANCE_S } from "./dispelAnalysis";

/**
 * A buff removed this shortly before its holder's UNIT_DIED was stripped by
 * the death cascade — neither dispelled nor cancelled. Editorial (measured,
 * not a game constant; triage 2026-09-29 death-kill F-B1): repro gaps 7–45 ms
 * (bd790c92, 121c7e15, 6062daf2); the nearest non-cascade removal is 390 ms
 * (0e0663e6 Pillar of Frost).
 */
export const DEATH_CASCADE_MS = 100;

/** What the log itself says about how an aura ended (FT-T08 step 3). */
export interface IAuraEndFromLog {
  /** A SPELL_DISPEL / SPELL_STOLEN of this aura on its holder at the removal
   * (within `ALLY_DISPEL_MATCH_TOLERANCE_S`): who did it, with what. */
  takenBy?: {
    kind: "dispelled" | "stolen";
    unitId: string;
    unitName: string;
    spellName: string;
  };
  /** A dispel / steal of this spell is logged on the holder at the removal,
   * but the log does not say which copy of the spell it took (several
   * sources' copies came off together, fewer take lines than removals or
   * different takers). Never set together with `takenBy`. */
  takeUnclear?: true;
  /** The holder died within `DEATH_CASCADE_MS` after the removal. */
  holderDied: boolean;
  /**
   * What this application absorbed: the sum of the SPELL_ABSORBED lines that
   * name the aura as the shield, on its holder, inside the application's
   * span. Present only when there is such a line — that is what makes the
   * aura an absorb (an amount on an aura line is not: a heal-absorb debuff, a
   * HoT and Defensive Stance carry one too).
   *
   * `left` is the amount on the REMOVED line (0 = nothing left), read only
   * when the aura's amount is its remaining absorb: a positive amount on its
   * APPLIED — or on the REFRESH a re-press while it is up writes (Ice
   * Barrier pressed three times is one aura with three shield amounts) —
   * and REMOVED below the last of them. Tranquility's damage reduction is written
   * as absorb lines while its amount stays put (APPLIED 696,347 = REMOVED
   * 696,347) — no `left`. An aura whose APPLIED line carries amount 0 holds
   * nothing back at all and gets no `absorb`: on the 60 logs that is Time
   * Dilation / Stretch Time (they defer — what the log calls absorbed lands
   * later as the unit's own damage, FT-T02b), Fortifying Brew and one
   * trinket (242 of 31,657 applications that absorb lines name;
   * fix-FT/t08-absorb-amount0.txt).
   *
   * Not `APPLIED amount − REMOVED amount`: on the 60 raw logs of the
   * 2026-10-08 re-eval that difference equals the absorbed sum in 26,331
   * applications and is short of it in 2,445 (a shield that grows without a
   * REFRESH line: Soul Leech, Holy Bulwark, Yu'lon's Grace), over it in 104 (a
   * shield that decays: First In, Last Out), and 2,761 more were refreshed
   * (fix-FT/t08-absorb-reconcile.txt).
   */
  absorb?: { absorbed: number; left?: number };
}

type TakeLine = NonNullable<ICombatUnit["actionIn"]>[number];
type AuraLine = ICombatUnit["auraEvents"][number];

/** A knot with more take lines or removals than this is not enumerated:
 * everything in it stays unclear. */
const TAKE_KNOT_MAX = 8;

/**
 * Which removal each dispel / steal line of one spell on one holder took.
 * The line names the spell and the holder, not the copy.
 *
 * Measured on the 60 raw logs of the 2026-10-08 re-eval (7,043 take lines,
 * fix-FT/t08-dispel-removed-gap.txt): the nearest SPELL_AURA_REMOVED of that
 * spell on that unit is in the same ms for 6,605 and 1 ms away for 350 more
 * (98.8 %) — one event's lines on either side of a millisecond boundary, as
 * with `AURA_REBROADCAST_GAP_MS`; 57 sit 2–50 ms away; and for 60 lines two
 * or three removals sit inside the pairing tolerance.
 *
 * So, per knot of lines and removals linked through the tolerance: every
 * assignment of lines to distinct removals is weighed — first as many lines
 * placed as possible (each line took something), then as few of them as
 * possible further than that 1 ms from their removal — and a removal is
 * "taken by X" only when EVERY best assignment gives it a line of the same
 * taker, spell and kind; "not taken" when none gives it a line; otherwise
 * the log leaves it open (`unclear`). No nearest-first shortcut: the reviews
 * of step 3a (codex rounds 1–2, agy round 3) each broke one.
 */
function pairTakesWithRemovals(
  takes: readonly TakeLine[],
  removals: readonly AuraLine[],
  tolMs: number,
  /** only the knots these removals sit in are worked out */
  wanted: readonly AuraLine[],
): { takenBy: Map<AuraLine, TakeLine>; unclear: Set<AuraLine> } {
  const takenBy = new Map<AuraLine, TakeLine>();
  const unclear = new Set<AuraLine>();
  const gap = (t: TakeLine, r: AuraLine) =>
    Math.abs(t.logLine.timestamp - r.logLine.timestamp);
  const keyOf = (t: TakeLine) =>
    `${t.srcUnitId}|${t.spellId}|${t.logLine.event}`;
  const done = new Set<AuraLine>();
  for (const r0 of wanted) {
    if (done.has(r0)) continue;
    const knotR: AuraLine[] = [r0];
    const knotT: TakeLine[] = [];
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of takes)
        if (!knotT.includes(t) && knotR.some((r) => gap(t, r) <= tolMs)) {
          knotT.push(t);
          grew = true;
        }
      for (const r of removals)
        if (!knotR.includes(r) && knotT.some((t) => gap(t, r) <= tolMs)) {
          knotR.push(r);
          grew = true;
        }
    }
    for (const r of knotR) done.add(r);
    if (knotT.length === 0) continue;
    if (knotT.length > TAKE_KNOT_MAX || knotR.length > TAKE_KNOT_MAX) {
      for (const r of knotR) unclear.add(r);
      continue;
    }
    // every assignment: [lines placed, lines placed off the same event's ms]
    let best: [number, number] = [-1, 0];
    let bestAssignments: Array<Array<TakeLine | undefined>> = [];
    const cur: Array<TakeLine | undefined> = knotR.map(() => undefined);
    const walk = (ti: number, placed: number, off: number): void => {
      if (ti === knotT.length) {
        const better =
          placed > best[0] || (placed === best[0] && off < best[1]);
        if (better) {
          best = [placed, off];
          bestAssignments = [];
        }
        if (better || (placed === best[0] && off === best[1]))
          bestAssignments.push([...cur]);
        return;
      }
      const t = knotT[ti]!;
      for (let ri = 0; ri < knotR.length; ri++) {
        const g = gap(t, knotR[ri]!);
        if (cur[ri] !== undefined || g > tolMs) continue;
        cur[ri] = t;
        walk(ti + 1, placed + 1, off + (g > AURA_REBROADCAST_GAP_MS ? 1 : 0));
        cur[ri] = undefined;
      }
      walk(ti + 1, placed, off);
    };
    walk(0, 0, 0);
    knotR.forEach((r, ri) => {
      const outcomes = new Set(
        bestAssignments.map((a) => (a[ri] ? keyOf(a[ri]!) : "")),
      );
      if (outcomes.size > 1) unclear.add(r);
      else if (!outcomes.has("")) takenBy.set(r, bestAssignments[0]![ri]!);
    });
  }
  return { takenBy, unclear };
}

/**
 * How far before the caller's own start of an application (`span.fromMs`)
 * its aura lines may sit. The press's cast line trails the aura it put up by
 * tens of ms (Dark Pact, 605-file sample 169: APPLIED 58 ms before its
 * SPELL_CAST_SUCCESS); nothing of the application is a second older.
 */
const SPAN_START_SLACK_MS = 1_000;

/**
 * Reads the end of ONE aura application off its holder's own records: the
 * dispel / steal event, the holder's death, the absorb lines that name the
 * aura. States nothing the log does not: no cause found means the aura
 * expired, was cancelled or was replaced — the log does not tell those apart.
 *
 * `span.removedMs` is the application's SPELL_AURA_REMOVED and `span.fromMs`
 * where the CALLER's reader says it began (the aura's start, or the press
 * that put it up). The aura's life is read off its own lines — APPLIED, the
 * REFRESH of a re-press, an earlier REMOVED — and never reaches back past
 * the caller's start: with an APPLIED missing from the log, the previous
 * application is not this one (codex review round 2). `srcUnitId` narrows it
 * to one caster's copy (two priests' shields on one unit); omit it for "any
 * source".
 */
export function auraEndFromLog(
  holder: Pick<ICombatUnit, "auraEvents"> &
    Partial<Pick<ICombatUnit, "actionIn" | "deathRecords" | "absorbsIn">>,
  spellId: string,
  span: { fromMs: number; removedMs: number },
  srcUnitId?: string,
): IAuraEndFromLog {
  const { fromMs, removedMs } = span;
  const tolMs = ALLY_DISPEL_MATCH_TOLERANCE_S * 1000;
  // re-broadcast pairs are not removals — the reader's own notion of "one aura"
  const ofSpell = dropAuraRebroadcasts(
    (holder.auraEvents ?? []).filter((a) => a.spellId === spellId),
  );
  const mine = (a: { srcUnitId?: string }) =>
    srcUnitId === undefined || a.srcUnitId === srcUnitId;
  const isRemoved = (a: AuraLine) =>
    (a.logLine.event as LogEvent) === LogEvent.SPELL_AURA_REMOVED;
  const ours = (a: AuraLine) =>
    isRemoved(a) && a.logLine.timestamp === removedMs && mine(a);

  // ── what it absorbed, and what its REMOVED line had left ──────────────────
  // The aura's life up to this removal: it opens at an APPLIED (or at a
  // REFRESH when the APPLIED predates the log), a REFRESH or a second
  // APPLIED inside it sets a new shield amount without starting a new life,
  // and an earlier REMOVED ends the previous life — whose own last hit, at
  // that very ms, is not this one's.
  let open = false;
  let lifeFromMs = Number.NEGATIVE_INFINITY;
  let lifeFromExclusive = false;
  let size: number | undefined; // the last positive amount an APPLIED / REFRESH set
  let sawAmount = false;
  let removedAmount: number | undefined;
  for (const a of ofSpell) {
    if (!mine(a)) continue;
    const t = a.logLine.timestamp;
    if (t > removedMs) break;
    const ev = a.logLine.event as LogEvent;
    if (ours(a)) {
      removedAmount = a.amount;
      break;
    }
    if (
      ev === LogEvent.SPELL_AURA_APPLIED ||
      ev === LogEvent.SPELL_AURA_REFRESH
    ) {
      if (!open) {
        open = true;
        lifeFromMs = t;
        lifeFromExclusive = false;
        size = undefined;
        sawAmount = false;
      }
      if (a.amount !== undefined) {
        sawAmount = true;
        // a duplicate APPLIED carrying 0 is not a new, empty shield
        if (a.amount > 0) size = a.amount;
      }
    } else if (ev === LogEvent.SPELL_AURA_REMOVED) {
      open = false;
      lifeFromMs = t;
      lifeFromExclusive = true;
      size = undefined;
      sawAmount = false;
    }
  }
  const floorMs = fromMs - SPAN_START_SLACK_MS;
  const sumFromMs = Math.max(lifeFromMs, floorMs);
  const sumFromExclusive = lifeFromExclusive && lifeFromMs >= floorMs;
  let absorbed = 0;
  for (const x of holder.absorbsIn ?? []) {
    if (x.spellId !== spellId || !mine(x)) continue;
    const t = x.logLine.timestamp;
    if (t > removedMs || t < sumFromMs) continue;
    if (sumFromExclusive && t === sumFromMs) continue;
    absorbed += x.absorbedAmount;
  }
  const left =
    size !== undefined &&
    removedAmount !== undefined &&
    removedAmount >= 0 &&
    removedAmount < size
      ? removedAmount
      : undefined;
  // amounts on its lines, none of them positive: the aura holds nothing back
  const holdsNothing = sawAmount && size === undefined;
  // "any source" mixes several casters' shields of one spell: their absorb
  // lines, sizes and remainders are not one shield's — no absorb is read
  const absorb =
    srcUnitId !== undefined && absorbed > 0 && !holdsNothing
      ? { absorbed, ...(left !== undefined ? { left } : {}) }
      : undefined;

  // ── a dispel / steal line that is THIS application's ──────────────────────
  const takes = (holder.actionIn ?? []).filter(
    (x) =>
      ((x.logLine.event as LogEvent) === LogEvent.SPELL_DISPEL ||
        (x.logLine.event as LogEvent) === LogEvent.SPELL_STOLEN) &&
      x.extraSpellId === spellId,
  );
  const removals = ofSpell.filter(isRemoved);
  const oursRemoved = removals.filter(ours);
  const pairing =
    takes.length > 0
      ? pairTakesWithRemovals(takes, removals, tolMs, oursRemoved)
      : undefined;
  // "any source" can match several removals in one ms: a claim only when
  // they all read the same
  const taken = pairing
    ? oursRemoved.map((r) => pairing.takenBy.get(r))
    : [];
  const one = taken[0];
  const sameTaker =
    one !== undefined &&
    taken.every(
      (t) =>
        t !== undefined &&
        t.srcUnitId === one.srcUnitId &&
        t.spellId === one.spellId &&
        t.logLine.event === one.logLine.event,
    );
  const takenBy = sameTaker
    ? {
        kind:
          (one.logLine.event as LogEvent) === LogEvent.SPELL_STOLEN
            ? ("stolen" as const)
            : ("dispelled" as const),
        unitId: one.srcUnitId,
        unitName: one.srcUnitName,
        spellName: getEnglishSpellName(one.spellId ?? "", one.spellName ?? ""),
      }
    : undefined;
  const takeUnclear =
    !takenBy &&
    pairing !== undefined &&
    (taken.some((t) => t !== undefined) ||
      oursRemoved.some((r) => pairing.unclear.has(r)));

  const holderDied = (holder.deathRecords ?? []).some((d) => {
    const gap = (d.timestamp as number) - removedMs;
    return gap >= 0 && gap <= DEATH_CASCADE_MS;
  });

  return {
    ...(takenBy ? { takenBy } : {}),
    ...(takeUnclear ? { takeUnclear: true as const } : {}),
    holderDied,
    ...(absorb ? { absorb } : {}),
  };
}
