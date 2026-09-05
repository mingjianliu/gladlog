/**
 * Generated at: 2026-09-05T00:12:12.455Z
 * Build: 12.1.0.69587
 * Source: DB2 SpellEffect.ImplicitTarget_0/_1 (DifficultyID 0), dummy
 *   effects ignored unless they are all the spell has, one
 *   EffectTriggerSpell hop followed. See scripts/datagen/genSpellTargeting.ts
 *   for the rule, the traps it encodes and the two-directional
 *   ground-truth assertion.
 * true  = at least one effect reaches a FRIENDLY unit other than the caster
 * false = the spell only ever affects the caster (and/or enemies)
 * absent = no official effect row; consumers must fall back, never assume
 * ids: 5367 (530 reach others)
 * The data lives in the .json of the same name (vite json.stringify ->
 * JSON.parse loading — the big-JSON lesson).
 */

// 静态 import,**不要改成动态**(2026-08-22 试过并回退):把这三份挪成懒加载
// chunk 确实让 renderer 主 chunk 从 3,360 回到 3,135 kB,但 firstPaint 反而两次都红
// (5215 / 5269),而静态 + 收缩宇宙那版两次都过(4488 / 4600)—— 首渲用例每次 reload
// 都绕缓存,多三个 chunk 的抓取代价盖过了主 chunk 变小的收益。控制体积靠**收缩宇宙**
// (观测集 ∪ 职业目录 ∪ 手工表),不靠拆 chunk。
import raw from "./spellTargetingGenerated.json";

export const SPELL_REACHES_OTHERS_GENERATED: Record<string, boolean> =
  raw as Record<string, boolean>;
