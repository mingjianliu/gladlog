import type { ICombatUnit } from "@gladlog/parser-compat";

import { isHealerSpec, isMeleeSpec } from "./cooldowns";

/**
 * The enemy-composition axis for cohort celling. Four coarse buckets, balancing
 * tactical context (a healer's metric profile shifts with the enemy comp)
 * against sample size (few buckets). The cohort and the user's own matches are
 * classified by this same function, which keeps SP-B2's cell lookup
 * consistent.
 */
export function enemyCompArchetype(enemies: ICombatUnit[]): string {
  const dps = enemies.filter((e) => !isHealerSpec(e.spec));
  const melee = dps.filter((e) => isMeleeSpec(e.spec)).length;
  const ranged = dps.length - melee;
  if (melee >= 2) return "melee_cleave";
  if (ranged >= 2) return "caster_cleave";
  if (melee >= 1 && ranged >= 1) return "hybrid";
  return "other";
}
