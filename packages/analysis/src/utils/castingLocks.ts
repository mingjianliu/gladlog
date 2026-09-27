import { ICombatUnit } from "@gladlog/parser-compat";

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

export function castingLockIntervalsOf(
  unit: ICombatUnit,
  combat: { startTime: number; endTime: number },
  /** the ability the caller asks about; omitted → every lock counts */
  forSpellId?: string,
): Array<{ from: number; to: number }> {
  const exempt =
    forSpellId !== undefined &&
    USABLE_IN_BLADESTORM_WITH_TALENT.has(forSpellId) &&
    talentOwnershipOf(unit, UNRELENTING_ONSLAUGHT_TALENT_ID) === "yes";
  return buildAuraIntervals(unit, combat)
    .filter((iv) => auraLocksCasting(iv.spellId))
    .filter((iv) => !(exempt && BLADESTORM_AURA_IDS.has(iv.spellId)))
    .map((iv) => ({
      from: combat.startTime + iv.fromS * 1000,
      to: combat.startTime + iv.toS * 1000,
    }));
}
