/**
 * Which effect an Aura Mastery press had — pipeline T213 (fact14 D37 / D38,
 * user ruling R53, 2026-11-18).
 *
 * Aura Mastery 31821 empowers the aura its paladin is running. Under
 * Devotion Aura 465 it is the team-wide reduction `MITIGATION_TABLE` prices.
 * Under Concentration Aura 317920 the press puts 317929 on the team for 8 s
 * — DB2 aura 77 (mechanic immunity), mechanics 9 / 26, silence and
 * interrupt; no aura 87 row — and reduces nothing. The cast's own aura 31821
 * goes on the paladin in BOTH branches, so every reader that took that aura
 * (or the press, or the button in hand) for the wall priced a reduction the
 * press did not give.
 *
 * Game-Behaviour Rule, the immunity branch: (a) DB2 317929, aura 77
 * [9, 26], no reduction row; (b) the log shows 317929 on every teammate in
 * the press's own millisecond; (c) corpus split on the 605 files
 * (scan5/t213: same attacker, same spell, last non-crit hit in the 4 s
 * before the press against the first in the 8 s after, (amount + absorbed +
 * blocked) / baseAmount): median 1.000, n 281 (p25 0.979, p75 1.008);
 * (d) no reduction = 1.000.
 *
 * R53: such a press is not a wall in any reader — no `defenseless` cut, no
 * `popped Aura Mastery`, no `gated (Aura Mastery in hand)`, no `Target had a
 * major defensive up`, no 24 % in the death audit. Its `[ENEMY DEF]` line
 * reads `Aura Mastery (silence / interrupt immunity, 8.0s)` and our own
 * `[YOU] / [TEAM] [CD]` press lines carry `(silence / interrupt immunity)`.
 *
 * The branch is the log's own, three readings of one fact:
 *  - a PRESS (`auraMasteryPressIsImmunityBranch`): a 317929 APPLIED /
 *    REFRESH from the paladin on itself within
 *    `AURA_MASTERY_BRANCH_PAIR_MS` of it;
 *  - an aura INTERVAL (`withoutImmunityBranchWalls`): the paladin's own
 *    31821 interval whose start is such a press — dropped for the readers
 *    that state or price the wall off the unit's intervals;
 *  - the button in a UNIT's hand over a round (`auraMasteryIsNoWallOf`):
 *    every press of the round took the immunity branch, or — with no press —
 *    Concentration Aura is on the paladin at the round's end (the latest
 *    aura row or the log's start list, `auraRowsUpAt`) and its own Devotion
 *    Aura was on it at no point of the round. A round the log reads both
 *    ways keeps the wall reading, as does a paladin whose running aura it
 *    does not show.
 * Registered in curatedIdRegistry.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { immunityMechanics } from "../data/spellSchools";
import { auraRowsUpAt } from "./auraRowsUpAt";
import { buffFullDurationForCaster } from "./buffDuration";

export const AURA_MASTERY_ID = "31821";
/** what the press puts on the team under Concentration Aura */
export const AURA_MASTERY_IMMUNITY_AURA_ID = "317929";
export const CONCENTRATION_AURA_ID = "317920";
/** the aura under which the press IS the wall (`AURA_EMPOWERING_WALLS`) */
export const DEVOTION_AURA_ID = "465";
/** press ↔ the immunity aura's row on the paladin (same millisecond on the
 * repro; the slack is the log's row order) */
export const AURA_MASTERY_BRANCH_PAIR_MS = 500;

/** DB2 `SpellMechanic` ids the immunity aura names, as its label prints
 * them. Local on purpose: `selfDefensiveMechanism`'s map names the controls
 * a unit can be put under, and its labels must not grow words by this. */
const BRANCH_MECHANIC_NAMES: Readonly<Record<number, string>> = {
  9: "silence",
  26: "interrupt",
};

/** The mechanics the immunity branch's label names, from DB2
 * (`immunityMechanics(317929)`): `["silence", "interrupt"]`. */
export function auraMasteryImmunityMechanics(): string[] {
  return (immunityMechanics(AURA_MASTERY_IMMUNITY_AURA_ID) ?? [])
    .slice()
    .sort((a, b) => a - b)
    .flatMap((m) => BRANCH_MECHANIC_NAMES[m] ?? []);
}

/** The tag an owner-side `[CD]` press line carries for such a press, and
 * the words the `[ENEMY DEF]` label opens with (`selfDefensiveLabelWords`
 * writes the same from the mechanism). */
export function auraMasteryImmunityLabelWords(): string {
  return `${auraMasteryImmunityMechanics().join(" / ")} immunity`;
}

type Rows = Pick<ICombatUnit, "id" | "auraEvents">;

/** the paladin's own 317929 row beside the press */
function pressHasImmunityRow(caster: Rows, atMs: number): boolean {
  return (caster.auraEvents ?? []).some(
    (a) =>
      a.spellId === AURA_MASTERY_IMMUNITY_AURA_ID &&
      a.srcUnitId === caster.id &&
      (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
        a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
      Math.abs(a.logLine.timestamp - atMs) <= AURA_MASTERY_BRANCH_PAIR_MS,
  );
}

/** When the 31821 a press at `atMs` put on the paladin ended: its REMOVED
 * row, or the official length after the press when the log has none. */
function pressAuraEndMs(caster: Rows, atMs: number): number {
  const removed = (caster.auraEvents ?? [])
    .filter(
      (a) =>
        a.spellId === AURA_MASTERY_ID &&
        a.srcUnitId === caster.id &&
        a.destUnitId === caster.id &&
        a.logLine.event === LogEvent.SPELL_AURA_REMOVED &&
        a.logLine.timestamp > atMs,
    )
    .map((a) => a.logLine.timestamp)
    .sort((a, b) => a - b)[0];
  const official =
    atMs + (buffFullDurationForCaster(AURA_MASTERY_ID, undefined) ?? 8) * 1000;
  return removed === undefined ? official : Math.min(removed, official + 1000);
}

/** Did the press at `atMs` open in the immunity branch and switch to the
 * wall while it ran (`immunityBranchWallFromMs`)? The press itself stays the
 * immunity; its wall begins at the switch (`auraMasteryWallFromMs`). */
export function auraMasteryPressSwitchedToWall(
  caster: Rows,
  atMs: number,
): boolean {
  return auraMasteryWallFromMs(caster, atMs) !== undefined;
}

/** The instant (ms) the Aura Mastery pressed at `atMs` in the immunity
 * branch became the wall — the paladin's own Devotion Aura going up while
 * the press's 31821 still ran. Undefined for a press that never switched,
 * and for a press that was the wall from the start. */
export function auraMasteryWallFromMs(
  caster: Rows,
  atMs: number,
): number | undefined {
  return pressHasImmunityRow(caster, atMs)
    ? immunityBranchWallFromMs(caster, atMs, pressAuraEndMs(caster, atMs))
    : undefined;
}

/** Is the Aura Mastery `caster` pressed at `atMs` the immunity: its own
 * 317929 row beside it. The press is read by the aura it was pressed under
 * (assembly review 80-PIPE-170-B156 #1): a later switch to Devotion Aura
 * opens the wall from the switch on (`auraMasteryWallFromMs`,
 * `withoutImmunityBranchWalls`) and leaves the press what it was. The one
 * decision every press label reads. */
export function auraMasteryPressIsImmunityBranch(
  caster: Rows,
  atMs: number,
): boolean {
  return pressHasImmunityRow(caster, atMs);
}

/** The instant (ms) an immunity-branch Aura Mastery up over
 * (`fromMs`, `toMs`) became the wall: the paladin's own Devotion Aura going
 * up on it while the press's 31821 still ran — the press then empowers the
 * aura it switched to. Undefined when it never did.
 *
 * Evidence (one press on the 605 files, of 26 immunity-branch presses:
 * c051aa9a round 1, press 19.8 s, Devotion Aura 21.1 s, 31821 off 27.8 s):
 * 317929 leaves every teammate in the switch's millisecond, and the same
 * attacker's non-crit hits on the paladin go from 0.940 to 0.639 of base
 * (Frost Fever, 20.9 s -> 22.4 / 23.9 / 25.4 s) and 0.883 to 0.600 (Glacial
 * Advance, 21.0 s -> 22.1 / 24.2 s): x0.68 across the switch.
 *
 * NOT established game behaviour: a single press, no DB2 leg, no second
 * sample. The reading kept is the cautious one — it keeps a wall and adds no
 * accusation (without it that round gained a `cd-hoarded` row at 22 s). The
 * reverse switch (Devotion -> Concentration while the press runs) has no
 * sample on the 605 files and is not handled: such a press stays the wall
 * for its whole interval.
 *
 * The wall runs from the switch on, not from the press (assembly review
 * 80-PIPE-170-B156 #1: c051aa9a's press at 19.815 s read as a wall for the
 * 1.258 s before its switch at 21.073 s, and lost its immunity label): the
 * press keeps its immunity label and tag, the 31821 interval the wall
 * readers see starts at the switch (`withoutImmunityBranchWalls`). A unit
 * with such a press has a wall in the round (`auraMasteryIsNoWallOf` is
 * false for it). */
export function immunityBranchWallFromMs(
  holder: Rows,
  fromMs: number,
  toMs: number,
): number | undefined {
  return (holder.auraEvents ?? [])
    .filter(
      (a) =>
        a.spellId === DEVOTION_AURA_ID &&
        a.srcUnitId === holder.id &&
        a.destUnitId === holder.id &&
        a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
        a.logLine.timestamp > fromMs &&
        a.logLine.timestamp < toMs,
    )
    .map((a) => a.logLine.timestamp)
    .sort((a, b) => a - b)[0];
}

/** `ivs` (the holder's own aura intervals, seconds since `startMs`) without
 * the part of an Aura Mastery interval that is no wall — for a reader that
 * states or prices the wall. An immunity-branch press's interval is dropped;
 * one that switched to the wall while it ran is kept from the switch on. */
export function withoutImmunityBranchWalls<
  T extends { spellId: string; fromS: number },
>(holder: Rows, ivs: readonly T[], startMs: number): T[] {
  return ivs.flatMap((iv) => {
    if (iv.spellId !== AURA_MASTERY_ID) return [iv];
    const pressMs = startMs + iv.fromS * 1000;
    if (!auraMasteryPressIsImmunityBranch(holder, pressMs)) return [iv];
    const wallFromMs = auraMasteryWallFromMs(holder, pressMs);
    return wallFromMs === undefined
      ? []
      : [{ ...iv, fromS: (wallFromMs - startMs) / 1000 }];
  });
}

/** Is `unit`'s Aura Mastery no wall over this round — pressed or in hand? */
export function auraMasteryIsNoWallOf(
  unit: Pick<ICombatUnit, "id" | "auraEvents" | "spellCastEvents"> &
    Partial<Pick<ICombatUnit, "info">>,
  round: { startTime: number; endTime: number },
): boolean {
  const presses = (unit.spellCastEvents ?? []).filter(
    (c) =>
      c.spellId === AURA_MASTERY_ID &&
      c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      c.logLine.timestamp >= round.startTime &&
      c.logLine.timestamp <= round.endTime,
  );
  if (presses.length > 0)
    return presses.every(
      (c) =>
        auraMasteryPressIsImmunityBranch(unit, c.logLine.timestamp) &&
        // a press that switched to the wall while it ran: the round has a
        // wall
        !auraMasteryPressSwitchedToWall(unit, c.logLine.timestamp),
    );
  return (
    auraRowsUpAt(unit, CONCENTRATION_AURA_ID, round.endTime) &&
    !auraRowsUpAt(unit, DEVOTION_AURA_ID, round.startTime) &&
    !(unit.auraEvents ?? []).some(
      (a) =>
        a.spellId === DEVOTION_AURA_ID &&
        a.srcUnitId === unit.id &&
        (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
          a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
        a.logLine.timestamp >= round.startTime &&
        a.logLine.timestamp <= round.endTime,
    )
  );
}

/** `auraMasteryIsNoWallOf` asked of one roster spell: true only for Aura
 * Mastery on such a unit — the one call a roster reader makes. */
export function isNoWallButtonOf(
  spellId: string,
  unit: Parameters<typeof auraMasteryIsNoWallOf>[0],
  round: { startTime: number; endTime: number },
): boolean {
  return spellId === AURA_MASTERY_ID && auraMasteryIsNoWallOf(unit, round);
}

/** What an owner-side `[YOU] / [TEAM] [CD]` press line carries after the
 * spell's name for such a press (ruling R53 (b)): ` (silence / interrupt
 * immunity)`; empty for every other press. */
export function auraMasteryPressTag(
  spellId: string,
  caster: Rows,
  pressMs: number,
): string {
  return spellId === AURA_MASTERY_ID &&
    auraMasteryPressIsImmunityBranch(caster, pressMs)
    ? ` (${auraMasteryImmunityLabelWords()})`
    : "";
}

/** What a roster kit entry carries after the spell's name for a unit whose
 * Aura Mastery is no wall over the round (`auraMasteryIsNoWallOf`, the
 * reading the kill-opportunity tier shares; user ruling R74): `Aura Mastery
 * (silence / interrupt immunity) [150s, lasts 8s] [UNUSED]`. Empty for every
 * other entry. */
export function auraMasteryKitTag(
  spellId: string,
  unit: Parameters<typeof auraMasteryIsNoWallOf>[0],
  round: { startTime: number; endTime: number },
): string {
  return isNoWallButtonOf(spellId, unit, round)
    ? ` (${auraMasteryImmunityLabelWords()})`
    : "";
}

/** Does a kit entry's printed name carry `auraMasteryKitTag`? The gate's
 * reading of the tag (`checkKillTierWallOwnership` leaves such an entry out
 * of the walls in hand). */
export function kitNameCarriesNoWallTag(printedName: string): boolean {
  return printedName.endsWith(` (${auraMasteryImmunityLabelWords()})`);
}

/** A kit entry's printed name without `auraMasteryKitTag` — the spell's own
 * name, for a reader that keys the kit by name. */
export function kitNameWithoutNoWallTag(printedName: string): string {
  return kitNameCarriesNoWallTag(printedName)
    ? printedName.slice(
        0,
        printedName.length - ` (${auraMasteryImmunityLabelWords()})`.length,
      )
    : printedName;
}

/** A kit line's text (or any text holding kit entries) with every
 * `auraMasteryKitTag` taken out — for a reader that parses entries as
 * `Name [..]` and keys them by name (codex 85-tk-WIN-T213-2 #4). */
export function kitTextWithoutNoWallTags(kitText: string): string {
  return kitText.split(` (${auraMasteryImmunityLabelWords()}) [`).join(" [");
}

/** `auraMasteryPressIsImmunityBranch` asked of one roster spell's press:
 * true only for an Aura Mastery press that is the immunity. The per-press
 * reading — a round's other presses say nothing of this one (codex
 * 85-tk-WIN-T213-2 #3). */
export function isNoWallPress(
  spellId: string,
  caster: Rows,
  pressMs: number,
): boolean {
  return (
    spellId === AURA_MASTERY_ID &&
    auraMasteryPressIsImmunityBranch(caster, pressMs)
  );
}
