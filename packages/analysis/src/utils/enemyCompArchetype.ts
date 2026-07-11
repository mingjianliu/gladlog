import type { ICombatUnit } from "@gladlog/parser-compat";
import { isHealerSpec, isMeleeSpec } from "./cooldowns";

/**
 * cohort-celling 的敌方阵容轴。粗 4 桶,兼顾战术上下文(治疗指标画像随敌方 comp 变)
 * 与样本量(桶少)。cohort 与用户对局用同一函数分类,保证 SP-B2 查 cell 一致。
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
