/**
 * Damage → the press behind it. One deterministic rule for every fact that
 * asks "was this damage something the player pressed AFTER a moment they
 * could have reacted to?" — B-tier B20a (damage fed into Touch of Karma) and
 * B11a (the owner's hit that broke our own control).
 *
 * The log ties a damage row to its source unit and spell, never to a cast.
 * The rule (the one `fix-BT/p605` hand-checked on 60 matches, B11a ruling
 * 2026-10-07):
 *  - "the same spell" = the same spell id, else the same English spell name
 *    (Mutilate's two damage ids, Deep Breath's damage 353759 ← cast 357210);
 *  - an EMPOWERED spell: the latest hold released at or before the row — the
 *    press is the RELEASE (the SPELL_CAST_SUCCESS the log writes when the
 *    hold begins is not a press);
 *  - anything else: the latest SPELL_CAST_SUCCESS at or before the row; when
 *    a SPELL_CAST_START of that spell sits within CAST_START_LOOKBACK_S
 *    before it, the press is that cast START (the moment the player
 *    committed), otherwise the success itself (a channel's success is the
 *    channel's start);
 *  - both found → the later one.
 * No such cast → no press: an auto-attack, a proc, an effect another ability
 * applied. A pet's or summon's damage has no press either (the row's source
 * is not the player). A spell the game fires IN PLACE of the auto-attack is
 * an auto-attack too, though the log writes a cast row per swing
 * (`AUTO_ATTACK_REPLACEMENT_IDS`).
 *
 * What the rule cannot see: which of two presses of one spell a slow missile
 * belongs to (it takes the later), and a damage id whose name differs from
 * its cast (it finds no press — the conservative side for a "you pressed
 * into it" fact).
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { getEnglishSpellName } from "../data/spellEffectData";
import { empowerSpans, type EmpowerSpanUnit } from "./castCommitSpans";

/** A cast bar's start belongs to the success that follows it within this
 * long (the longest cast bars are ~3 s; a kicked or cancelled bar has no
 * success and is never paired). */
export const CAST_START_LOOKBACK_S = 6;

/**
 * Spells the game swings in place of the auto-attack: the log writes a
 * SPELL_CAST_SUCCESS for every swing, and nobody pressed anything (user
 * ruling 2026-10-07 on the 605 report of B11a: not a press). A hand table,
 * registered in curatedIdRegistry.
 *
 *  - 408385 Crusading Strikes — the Paladin talent 404542 of the same name
 *    is passive and carries aura 361, "override the auto-attack with a
 *    melee spell" (`talentEffectInventoryGenerated.json`, the only aura-361
 *    row of the build; a test pins it and fails on a second one). Corpus:
 *    a Retribution Paladin with 75 such "casts" in one log has 0 swing rows
 *    and 0 Crusader Strike casts of his own. As a press it had been 5 of
 *    the 48 own-cc-broken rows on the 605 files.
 */
export const AUTO_ATTACK_REPLACEMENT_IDS: ReadonlySet<string> = new Set([
  "408385", // Crusading Strikes
]);

export type PressCaster = Pick<ICombatUnit, "spellCastEvents"> &
  Partial<Pick<ICombatUnit, "castStartEvents">> &
  Partial<EmpowerSpanUnit>;

export interface IDamagePress {
  /** epoch ms of the press */
  pressMs: number;
  /** how the press was found */
  kind: "cast" | "cast-start" | "empower-release";
}

/**
 * `caster`'s press behind a damage row of `spellId` at `atMs`, or null when
 * the rule finds none. `spellId` undefined = a swing.
 */
export function pressBehindDamageOf(
  caster: PressCaster,
  spellId: string | undefined,
  spellName: string | undefined,
  atMs: number,
): IDamagePress | null {
  if (!spellId || AUTO_ATTACK_REPLACEMENT_IDS.has(spellId)) return null;
  const name = getEnglishSpellName(spellId, spellName ?? "");
  const same = (id: string | null | undefined, n?: string): 0 | 1 | 2 =>
    !id
      ? 0
      : id === spellId
        ? 2
        : name !== "" && getEnglishSpellName(id, n ?? "") === name
          ? 1
          : 0;

  // the latest released hold of the spell
  let empower: IDamagePress | null = null;
  const holds =
    Array.isArray(caster.empowerStarts) &&
    empowerSpans(caster as EmpowerSpanUnit);
  const holdStarts: number[] = [];
  if (holds)
    for (const h of holds) {
      if (!same(h.spellId, h.spellName)) continue;
      holdStarts.push(h.startMs);
      if (h.interrupted || h.endMs > atMs) continue;
      if (!empower || h.endMs > empower.pressMs)
        empower = { pressMs: h.endMs, kind: "empower-release" };
    }

  // the latest success of the spell: by id first, by name otherwise. The
  // success the log writes at a hold's start is the hold, not a press.
  const isHoldStart = (t: number) =>
    holdStarts.some((s) => Math.abs(s - t) <= 500);
  let byId: number | null = null;
  let byName: number | null = null;
  for (const c of caster.spellCastEvents ?? []) {
    if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
    const t = c.logLine.timestamp;
    if (t > atMs || isHoldStart(t)) continue;
    const m = same(c.spellId, c.spellName);
    if (m === 2 && (byId === null || t > byId)) byId = t;
    else if (m === 1 && (byName === null || t > byName)) byName = t;
  }
  const successMs = byId ?? byName;
  let cast: IDamagePress | null = null;
  if (successMs !== null) {
    let startMs: number | null = null;
    for (const s of caster.castStartEvents ?? []) {
      const t = s.logLine.timestamp;
      if (t > successMs || successMs - t > CAST_START_LOOKBACK_S * 1000)
        continue;
      if (!same(s.spellId, s.spellName)) continue;
      if (startMs === null || t > startMs) startMs = t;
    }
    cast =
      startMs !== null
        ? { pressMs: startMs, kind: "cast-start" }
        : { pressMs: successMs, kind: "cast" };
  }
  if (empower && cast) return empower.pressMs >= cast.pressMs ? empower : cast;
  return empower ?? cast;
}

/** `pressBehindDamageOf`, the instant only. */
export function pressBehindDamage(
  caster: PressCaster,
  spellId: string | undefined,
  spellName: string | undefined,
  atMs: number,
): number | null {
  return pressBehindDamageOf(caster, spellId, spellName, atMs)?.pressMs ?? null;
}

/** Does `spellId` tick for this unit in the round — is there a periodic
 * damage row of it among the unit's own damage? An absorbed hit's row
 * (SPELL_ABSORBED) does not say whether it was a tick; the unit's landed
 * rows of the same spell do. */
export function spellTicksFor(
  unit: Pick<ICombatUnit, "damageOut">,
  spellId: string,
): boolean {
  return (unit.damageOut ?? []).some(
    (d) =>
      d.spellId === spellId &&
      d.logLine.event === LogEvent.SPELL_PERIODIC_DAMAGE,
  );
}
