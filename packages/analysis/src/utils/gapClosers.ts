/**
 * Gap-closers — abilities that carry the CASTER onto a target or a chosen
 * spot (charge, leap, teleport, forward dash) — and whether a unit had one in
 * hand at an instant.
 *
 * Triage 2026-09-29 kick-eaten F-K6b, user ruling A12 = B (2026-09-30), with
 * the supplement U2. The kick-eaten legend used to license "cast from outside
 * kick range" on `yourReachYd > kickRangeYd` alone, so it fired against a
 * Warrior 10.5 yd away who had cast Charge 0.33 s before the cast started
 * (dfcccbf2 @79.3). Out-range advice is a PERMISSION: it is given only when
 * the kicker could not have closed the gap, so every unknown here closes it.
 *
 * What is on the list (hand table, registered in `curatedIdRegistry.ts`):
 * spells whose effect moves the caster to the target or to a point they
 * pick. DB2 nominates what it can (SpellEffect CHARGE 96, CHARGE_DEST 149,
 * LEAP 29, JUMP 41 / JUMP_DEST 42 / JUMP_CHARGE 254: Wild Charge, The Hunt,
 * Heroic Leap, Feral Lunge, Blink, Shimmer, Metamorphosis, Pursuit); the rest
 * are scripted or triggered (Charge 100, Shadowstep, Fel Rush, Roll, Harpoon,
 * Felblade) and come from the corpus.
 *
 * What is NOT on it, on purpose:
 *  - pulls that move the TARGET to the caster (Death Grip 49576, Gorefiend's
 *    Grasp 108199) — ruling U2: "a pull is not a gap-closer";
 *  - backward leaps (Disengage, Vengeful Retreat, Gust of Wind — LEAP_BACK);
 *  - speed boosts (Sprint, Dash, Divine Steed, Aspect of the Cheetah,
 *    Stampeding Roar, Death's Advance): running is `kickPriority.ts`'s
 *    `meleeKickReachYd`, a different and deliberately separate model (see
 *    `docs/predicate-index.md`, "Not yet unified").
 *
 * Forward check (Curated-List Completeness Rule): `kickEatenScan.ts` writes,
 * for every kick whose source was outside its kick range at cast start, the
 * casts that source made before the kick landed (`srcCasts`); a spell that
 * recurs there and is not on this list is a candidate.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import {
  effectiveCooldownSeconds,
  getEnglishSpellName,
} from "../data/spellEffectData";
import { chargesAvailableAt, unitCooldownOf } from "./cooldowns";

/**
 * One entry per button; an entry with several ids is one cooldown seen under
 * several ids — Wild Charge's three forms share DB2 cooldown category 1205
 * (15 s), The Hunt has a second cast id in 12.1, Chi Torpedo replaces Roll
 * and Shimmer replaces Blink. Reading them apart called a Feral Druid's Wild
 * Charge "ready" 3 s after the cat-form cast because the bear-form id had not
 * been cast yet (138e632d @138).
 */
/** @internal exported for test/gapClosers.test.ts (every button resolves to
 * a cooldown row or is a pinned unknown) */
export const GAP_CLOSER_BUTTONS: ReadonlyArray<readonly string[]> = [
  ["100"], // Charge (Warrior)
  // Heroic Leap: 6544 is the spell and carries the cooldown row, but the
  // SPELL_CAST_SUCCESS a Warrior logs is 52174 (605-file scan, casts by a
  // kick's source in the 3 s before it: 6544 x0, 52174 x19) — with 6544 alone
  // the button was never "seen" and the leap never closed the advice
  // (49643222 @154.9: Heroic Leap then Pummel read `outRangeable=yes`).
  ["6544", "52174"], // Heroic Leap (Warrior)
  ["3411"], // Intervene (Warrior: charges to an ally, 11 casts in that scan)
  ["195072"], // Fel Rush (Demon Hunter)
  ["370965", "1246167"], // The Hunt (Demon Hunter; 12.1 second cast id)
  ["232893"], // Felblade (Demon Hunter)
  // Metamorphosis: 191427 carries the cooldown, the logged cast is 200166
  // (the same scan: 191427 x0, 200166 x6)
  ["191427", "200166"], // Metamorphosis (Havoc: leaps to the chosen spot)
  ["36554"], // Shadowstep (Rogue)
  ["185438"], // Shadowstrike (Subtlety: teleports to the target from stealth)
  ["195457"], // Grappling Hook (Outlaw)
  ["102401", "49376", "16979"], // Wild Charge (caster / Cat / Bear form)
  ["109132", "115008"], // Roll / Chi Torpedo (Monk)
  ["101545"], // Flying Serpent Kick (Windwalker)
  ["190925"], // Harpoon (Survival Hunter)
  ["196884"], // Feral Lunge (Enhancement Shaman)
  ["1953", "212653"], // Blink / Shimmer (Mage)
  ["30151"], // Pursuit (Felguard — the unit that casts Axe Toss)
];

/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const GAP_CLOSER_SPELL_IDS: ReadonlySet<string> = new Set(
  GAP_CLOSER_BUTTONS.flat(),
);

/** A gap-closer cast this long before the instant counts as "just used": the
 * kicker is already on their way (ruling A12: 1 s). */
export const GAP_CLOSER_USED_WINDOW_S = 1;

/** Listed ids whose cooldown DB2 does not give us: Shadowstep's is a charge
 * category the generator does not resolve, Shadowstrike has none (it needs
 * stealth instead). A unit seen casting one reads `unknown`. Pinned by
 * `test/gapClosers.test.ts` — when datagen learns one, the test goes red and
 * the id leaves this set. */
export const GAP_CLOSER_COOLDOWN_UNKNOWN_IDS: ReadonlySet<string> = new Set([
  "36554",
  "185438",
]);

export type GapCloserState =
  /** cast in the last `GAP_CLOSER_USED_WINDOW_S` */
  | { state: "used"; spellId: string; spellName: string; agoS: number }
  /** seen from this unit this round and at least one charge up */
  | { state: "ready"; spellId: string; spellName: string }
  /** seen from this unit this round, cooldown not in DB2 — or known only as
   * the untalented base (no talent blob: a pet, a player without
   * COMBATANT_INFO talents) and not up by that number — cannot be ruled out */
  | { state: "unknown"; spellId: string; spellName: string }
  /** `gapCloserStateOver` only: cast between its two instants */
  | { state: "used-during"; spellId: string; spellName: string; afterS: number }
  /** `gapCloserStateOver` only: came off cooldown between its two instants */
  | { state: "ready-during"; spellId: string; spellName: string };

/**
 * The unit's gap-closer state at `atMs`, or null when none was just used,
 * ready or unknown.
 *
 * Three-state on purpose (codex review of the triage entry, 2026-09-30):
 *  - readiness is read at the exact instant — `chargesAvailableAt(…) >= 1` —
 *    not through `kitSpellReadyAt`, whose extra "a charge one reaction
 *    window earlier" test reads a Charge that recharged in the last second as
 *    not ready and would wrongly open the advice;
 *  - a gap-closer the unit was seen casting whose cooldown DB2 does not give
 *    (Shadowstep 36554) is `unknown`, and unknown closes;
 *  - a gap-closer the unit never cast this round is not in its kit as far as
 *    the log shows, and is not counted (the caller's wording says so).
 * Cooldown and charges are the unit's own (`unitCooldownOf`: DB2 +
 * `applyCdTalentModifiers`) — no second table. When the unit's talents are
 * not known (`talentsKnown === false`) that number is the untalented base,
 * which can only be too LONG: "not up by the base" is then `unknown`, not
 * null (a Felguard's Pursuit read 15 s with the owner's −5 s talent
 * unapplied).
 */
export function gapCloserStateAt(
  unit: ICombatUnit,
  atMs: number,
  matchStartMs: number,
): GapCloserState | null {
  const casts = (unit.spellCastEvents ?? []).filter(
    (e) =>
      e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
      !!e.spellId &&
      GAP_CLOSER_SPELL_IDS.has(e.spellId),
  );
  if (casts.length === 0) return null;
  const name = (id: string) =>
    getEnglishSpellName(id, casts.find((c) => c.spellId === id)?.spellName);
  const fromMs = atMs - GAP_CLOSER_USED_WINDOW_S * 1000;
  const used = casts
    .filter((c) => c.logLine.timestamp <= atMs && c.logLine.timestamp >= fromMs)
    .sort((a, b) => b.logLine.timestamp - a.logLine.timestamp)[0];
  if (used)
    return {
      state: "used",
      spellId: used.spellId!,
      spellName: name(used.spellId!),
      agoS: (atMs - used.logLine.timestamp) / 1000,
    };
  const atS = (atMs - matchStartMs) / 1000;
  let unknown: GapCloserState | null = null;
  for (const ids of GAP_CLOSER_BUTTONS) {
    const mine = casts.filter((c) => ids.includes(c.spellId!));
    if (mine.length === 0) continue; // never seen from this unit this round
    const seenId = mine[0]!.spellId!;
    // The button's first id with a cooldown row — for Blink / Shimmer that is
    // Blink's (DB2 20 s) for a Shimmer caster too, and deliberately so
    // (Fable review of the batch proposed the seen id's own 30 s row).
    // "Ready" closes the advice, and a Mage's real recharge is only ever
    // shorter than a row: Shifting Power takes seconds off every cooldown and
    // is modelled nowhere. On 605 files 53 of 545 three-cast Shimmer spans
    // (two charges: the third cast needs the first's recharge) are under
    // 28.5 s, 13 under 18.5 s. The shorter row can print "Shimmer ready" a
    // few seconds early; the longer one could leave the advice open while
    // Shimmer was up.
    const cdId = ids.find((id) => effectiveCooldownSeconds(id) !== undefined);
    const cd = cdId ? unitCooldownOf(unit, cdId) : undefined;
    if (!cd) {
      unknown ??= {
        state: "unknown",
        spellId: seenId,
        spellName: name(seenId),
      };
      continue;
    }
    if (
      chargesAvailableAt(
        mine.map((c) => (c.logLine.timestamp - matchStartMs) / 1000),
        cd.cooldownSeconds,
        cd.charges,
        atS,
      ) >= 1
    )
      return { state: "ready", spellId: seenId, spellName: name(seenId) };
    if (!cd.talentsKnown)
      unknown ??= {
        state: "unknown",
        spellId: seenId,
        spellName: name(seenId),
      };
  }
  return unknown;
}

/**
 * The same question over a span — a kicked cast, from its start to the kick:
 * could the unit have closed the gap at any point of it? The state at
 * `fromMs` when there is one; otherwise a gap-closer cast inside
 * (`fromMs`, `toMs`] (`used-during`), or one that was up by `toMs`
 * (`ready-during`), or unknown there. Reading the start alone left the advice
 * open for a Warrior whose Charge came back 0.1 s into the cast and was
 * pressed before the Pummel (pre-review of the batch; 605-file scan: three
 * `yes` lines where the source cast a listed gap-closer in the 3 s before
 * its kick — 0284fcd9 @97.4 Grappling Hook, d5f35ce9 @29.6 Charge, be070452
 * @116.2 Fel Rush).
 */
export function gapCloserStateOver(
  unit: ICombatUnit,
  fromMs: number,
  toMs: number,
  matchStartMs: number,
): GapCloserState | null {
  const atStart = gapCloserStateAt(unit, fromMs, matchStartMs);
  // a cast inside the span says more than "unknown" at its start
  if ((atStart && atStart.state !== "unknown") || !(toMs > fromMs))
    return atStart;
  const during = (unit.spellCastEvents ?? [])
    .filter(
      (e) =>
        e.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
        !!e.spellId &&
        GAP_CLOSER_SPELL_IDS.has(e.spellId) &&
        e.logLine.timestamp > fromMs &&
        e.logLine.timestamp <= toMs,
    )
    .sort((a, b) => a.logLine.timestamp - b.logLine.timestamp)[0];
  if (during)
    return {
      state: "used-during",
      spellId: during.spellId!,
      spellName: getEnglishSpellName(during.spellId!, during.spellName),
      afterS: (during.logLine.timestamp - fromMs) / 1000,
    };
  if (atStart) return atStart;
  const atEnd = gapCloserStateAt(unit, toMs, matchStartMs);
  return atEnd?.state === "ready"
    ? {
        state: "ready-during",
        spellId: atEnd.spellId,
        spellName: atEnd.spellName,
      }
    : atEnd;
}
