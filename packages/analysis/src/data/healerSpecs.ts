import { CombatUnitSpec } from "@gladlog/parser-compat";

/**
 * The healer specs. A leaf module so the data tables that cannot import
 * `utils/cooldowns` (`healerHeldOffensive.ts`) read the same set as
 * `isHealerSpec` there.
 */
export const HEALER_SPECS: ReadonlySet<CombatUnitSpec> = new Set([
  CombatUnitSpec.Druid_Restoration,
  CombatUnitSpec.Monk_Mistweaver,
  CombatUnitSpec.Paladin_Holy,
  CombatUnitSpec.Priest_Discipline,
  CombatUnitSpec.Priest_Holy,
  CombatUnitSpec.Shaman_Restoration,
  CombatUnitSpec.Evoker_Preservation,
]);
