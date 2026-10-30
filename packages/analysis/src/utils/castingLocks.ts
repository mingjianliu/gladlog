import { ICombatUnit } from "@gladlog/parser-compat";

import { abilityProfile } from "../data/abilityProfile";
import { buildAuraIntervals } from "./auraIntervals";
import { auraLocksCasting } from "./spellMechanics";
import { talentOwnershipOf } from "./talentOwnership";

/**
 * Auras on a unit that stop it casting its other abilities (official
 * `locksCasting`: Ice Block, Dispersion, Bladestorm, Hex …), as ms
 * intervals — minus the talent exceptions below for the ability asked about.
 *
 * Unrelenting Onslaught 444780 (Arms / Protection hero talent): "Pummel and
 * Storm Bolt can be used during Bladestorm". Talent impact audit 2026-09-26:
 * kick-priority never read a friend's own Bladestorm (a non-holder was told
 * they could have kicked mid-Bladestorm), and the peel options dropped a
 * holder's Storm Bolt for the whole Bladestorm. Unknown talents keep the
 * lock (no claim that the button was free). Registered in curatedIdRegistry.
 */
export const BLADESTORM_AURA_IDS: ReadonlySet<string> = new Set([
  "227847",
  "446035",
]);
export const UNRELENTING_ONSLAUGHT_TALENT_ID = "444780";
export const USABLE_IN_BLADESTORM_WITH_TALENT: ReadonlySet<string> = new Set([
  "6552", // Pummel
  "107570", // Storm Bolt
]);

/**
 * fact3 D43 (2026-10-21): auras under which the holder cannot ATTACK — its
 * single-target damaging spells on an enemy are locked, everything else is
 * not. Aspect of the Turtle 186265: the official tooltip "deflects all
 * attacks … but you cannot attack"; it is no DB2 casting lock (its effects
 * are auras 184 / 185 / 186 / 28 / 87 / 77 / 288). 605 capture (every 30th
 * new-season file), 224 Turtle spans: the hunter's casts inside were traps,
 * Exhilaration, Binding Shot, Disengage, pet commands — enemy-targeted only
 * Intimidation ×5, Tracker's Net, Sticky Tar Bomb (no damage), and not one
 * damaging single-target spell. 8888b780 r3 1:57: Scatter Shot "usable 4 s,
 * not used" while its owner sat in Turtle. Registered in curatedIdRegistry.
 */
export const ATTACK_LOCK_AURA_IDS: ReadonlySet<string> = new Set([
  "186265", // Aspect of the Turtle
]);

/** A spell an attack lock stops: it damages one enemy (official profile). */
function isSingleTargetAttack(spellId: string): boolean {
  const p = abilityProfile(spellId);
  return p.hitsEnemy && !p.enemyAoE && p.dealsDamage;
}

export function castingLockIntervalsOf(
  unit: ICombatUnit,
  combat: { startTime: number; endTime: number },
  /** the ability the caller asks about; omitted → every lock counts */
  forSpellId?: string,
): Array<{ from: number; to: number; spellId: string }> {
  const exempt =
    forSpellId !== undefined &&
    USABLE_IN_BLADESTORM_WITH_TALENT.has(forSpellId) &&
    talentOwnershipOf(unit, UNRELENTING_ONSLAUGHT_TALENT_ID) === "yes";
  const attack = forSpellId !== undefined && isSingleTargetAttack(forSpellId);
  return buildAuraIntervals(unit, combat)
    .filter(
      (iv) =>
        auraLocksCasting(iv.spellId) ||
        // Turtle is self-only: whoever carries it is its caster
        (attack && ATTACK_LOCK_AURA_IDS.has(iv.spellId)),
    )
    .filter((iv) => !(exempt && BLADESTORM_AURA_IDS.has(iv.spellId)))
    .map((iv) => ({
      from: combat.startTime + iv.fromS * 1000,
      to: combat.startTime + iv.toS * 1000,
      spellId: iv.spellId,
    }));
}
