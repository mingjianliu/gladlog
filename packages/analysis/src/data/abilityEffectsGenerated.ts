/**
 * Generated at: 2026-09-04T23:34:00.426Z
 * Build: 12.1.0.69404
 * Source: DB2 SpellEffect — aura 69 (absorb), Effect 10/136 + aura 8/20
 *   (healing, split self vs ally by ImplicitTarget), aura 118/259
 *   (healing received %), aura 31 (haste %). One EffectTriggerSpell hop,
 *   dummy rows ignored unless they are all the spell has.
 *   See scripts/datagen/genAbilityEffects.ts for the rules and controls.
 * Absent field = the official rows do not show that effect. Treat as
 *   "not known to do this", never as proof of absence for a spell whose
 *   implementation is a dummy row + server script.
 * ids: 2232 — absorb 109, heals self 119, heals others 264, healing-received 9, haste 70, hits enemy 1638, enemy AoE 566, deals damage 1166
 * The data lives in the .json of the same name (vite json.stringify ->
 * JSON.parse loading — the big-JSON lesson).
 */

// 静态 import,**不要改成动态**(2026-08-22 试过并回退):把这三份挪成懒加载
// chunk 确实让 renderer 主 chunk 从 3,360 回到 3,135 kB,但 firstPaint 反而两次都红
// (5215 / 5269),而静态 + 收缩宇宙那版两次都过(4488 / 4600)—— 首渲用例每次 reload
// 都绕缓存,多三个 chunk 的抓取代价盖过了主 chunk 变小的收益。控制体积靠**收缩宇宙**
// (观测集 ∪ 职业目录 ∪ 手工表),不靠拆 chunk。
import raw from "./abilityEffectsGenerated.json";

export type AbilityEffectFacts = {
  absorbs?: true;
  healsSelf?: true;
  healsOthers?: true;
  healingReceivedPct?: number;
  hastePct?: number;
  hitsEnemy?: true;
  enemyAoE?: true;
  dealsDamage?: true;
};

export const ABILITY_EFFECTS_GENERATED: Record<string, AbilityEffectFacts> =
  raw as Record<string, AbilityEffectFacts>;
