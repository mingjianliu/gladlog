/**
 * Controls that only come from stealth (user ruling 2026-10-26, fact5 retest
 * r2 94e93f63 1:06: a Feral's Rake was listed as a Full-DR stun "IN LoS"
 * while no Prowl, Shadowmeld or Incarnation was up or in hand).
 *
 * Evidence, three legs:
 *  - the tooltip (DB2 Spell 1822 Description, build 12.1.5.70391): "While
 *    stealthed, Rake will also stun the target for $163505d";
 *  - DB2: the stun is no effect of Rake's own (1822 carries a dummy effect,
 *    163505 is applied by script — the condition lives in the tooltip);
 *  - corpus (605 manifest, probes/rakeStealth.py): 441 of 460 Rake stuns
 *    landed with Prowl, Shadowmeld, Incarnation or Sudden Ambush up or removed
 *    by the press itself (≤ 300 ms before); the other 19 open a log
 *    mid-stealth (the round's first rows).
 *
 * A stealth-only control is usable at an instant when a stealth aura of the
 * unit is up then, or a means to stealth in combat is in hand: Incarnation:
 * Avatar of Ashamane (taken, by COMBATANT_INFO or a press this round) or
 * Shadowmeld (a press this round — a race is only ever established by what
 * it does) off its official cooldown.
 */
import type { ICombatUnit } from "@gladlog/parser-compat";
import { LogEvent } from "@gladlog/parser-compat";

import { effectiveCooldownSeconds } from "../data/spellEffectData";
import { playerTalentIdSets } from "./cooldowns";
import { holderFirstOwnActionAfterMs } from "./enemyDefensives";

/** Rake's press and its stun aura. Registered in curatedIdRegistry. */
export const STEALTH_ONLY_CONTROL_IDS: ReadonlySet<string> = new Set([
  "1822", // Rake
  "163505", // Rake (stun)
]);

/** Auras under which a stealth-only control comes out: Prowl (both ids),
 * Shadowmeld, Incarnation: Avatar of Ashamane (both), Sudden Ambush's buff.
 * Registered in curatedIdRegistry. */
export const STEALTH_STATE_AURA_IDS: ReadonlySet<string> = new Set([
  "5215",
  "102547",
  "58984",
  "102543",
  "252071",
  "1244483",
]);

const INCARNATION_ASHAMANE = "102543";
const SHADOWMELD = "58984";

/** Prowl and Shadowmeld break on the holder's first action — and the log
 * can lose their REMOVED (94e93f63: a 102547 Prowl applied at 13.6 s and
 * never removed): they hold until the holder's first own press or direct
 * hit after them (`holderFirstOwnActionAfterMs`, the unseen-save reading). */
const BROKEN_BY_ACTION_IDS: ReadonlySet<string> = new Set([
  "5215",
  "102547",
  "58984",
]);

function stealthAuraUpAt(unit: ICombatUnit, ms: number): boolean {
  const open = new Map<string, number>();
  for (const a of unit.auraEvents ?? []) {
    if (a.logLine.timestamp > ms) break;
    if (!a.spellId || !STEALTH_STATE_AURA_IDS.has(a.spellId)) continue;
    if (a.destUnitId !== unit.id) continue;
    if (a.logLine.event === LogEvent.SPELL_AURA_REMOVED) open.delete(a.spellId);
    else open.set(a.spellId, a.logLine.timestamp);
  }
  for (const [id, from] of open)
    if (
      !BROKEN_BY_ACTION_IDS.has(id) ||
      holderFirstOwnActionAfterMs(unit, from, id) > ms
    )
      return true;
  return false;
}

function meansInHandAt(
  unit: ICombatUnit,
  spellId: string,
  ms: number,
): boolean {
  // its presses: the cast rows, and its own aura going up — the log can lose
  // the cast row (codex 20-F18-09 #1, 94e93f63 r4: an Incarnation up 9.7–
  // 34.4 s with no cast, its next row at 114 s, read "in hand" at 49.7 s)
  const pressMs = [
    ...(unit.spellCastEvents ?? [])
      .filter(
        (c) =>
          c.logLine.event === LogEvent.SPELL_CAST_SUCCESS &&
          c.spellId === spellId,
      )
      .map((c) => c.logLine.timestamp),
    ...(unit.auraEvents ?? [])
      .filter(
        (a) =>
          a.logLine.event === LogEvent.SPELL_AURA_APPLIED &&
          a.spellId === spellId &&
          a.srcUnitId === unit.id &&
          a.destUnitId === unit.id,
      )
      .map((a) => a.logLine.timestamp),
  ];
  const owned =
    pressMs.length > 0 ||
    (spellId === INCARNATION_ASHAMANE &&
      !!playerTalentIdSets(unit).talentedSpellIds?.has(spellId));
  if (!owned) return false;
  const last = pressMs.filter((t) => t <= ms).sort((a, b) => b - a)[0];
  if (last === undefined) return true;
  const cd = effectiveCooldownSeconds(spellId) ?? 0;
  return last + cd * 1000 <= ms;
}

/** Can `unit` put out `spellId` at `ms`, as far as stealth goes? Always true
 * for a control that does not need it. */
export function stealthControlUsableAt(
  unit: ICombatUnit,
  spellId: string,
  ms: number,
): boolean {
  if (!STEALTH_ONLY_CONTROL_IDS.has(spellId)) return true;
  return (
    stealthAuraUpAt(unit, ms) ||
    meansInHandAt(unit, INCARNATION_ASHAMANE, ms) ||
    meansInHandAt(unit, SHADOWMELD, ms)
  );
}
