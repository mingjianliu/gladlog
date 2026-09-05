/**
 * Generated at: 2026-09-05T00:12:16.291Z
 * Build: 12.1.0.69587
 * Source: DB2 SpellMisc.SchoolMask (what school the spell IS) +
 *   SpellEffect aura 39 / 77 (which schools / mechanics it makes you
 *   immune to), one EffectTriggerSpell hop, dummy rows ignored unless
 *   they are all the spell has. See scripts/datagen/genSpellSchools.ts.
 * School mask bits: 1 Physical · 2 Holy · 4 Fire · 8 Nature · 16 Frost ·
 *   32 Shadow · 64 Arcane (126 = all magic, 127 = everything).
 * Absent field = no official row. Consumers MUST treat that as unknown
 *   and fall back, never as "stops nothing" (Anti-Magic Shell, Spell
 *   Reflection, Bladestorm and Aspect of the Turtle all have no aura 39).
 * ids: 6447 (6447 with a school, 21 with school immunity, 62 with mechanic immunity)
 * The data lives in the .json of the same name (vite json.stringify ->
 * JSON.parse loading — the big-JSON lesson).
 */

// 静态 import,**不要改成动态**(2026-08-22 试过并回退):把这三份挪成懒加载
// chunk 确实让 renderer 主 chunk 从 3,360 回到 3,135 kB,但 firstPaint 反而两次都红
// (5215 / 5269),而静态 + 收缩宇宙那版两次都过(4488 / 4600)—— 首渲用例每次 reload
// 都绕缓存,多三个 chunk 的抓取代价盖过了主 chunk 变小的收益。控制体积靠**收缩宇宙**
// (观测集 ∪ 职业目录 ∪ 手工表),不靠拆 chunk。
import raw from "./spellSchoolsGenerated.json";

export type SpellSchoolFacts = {
  school?: number;
  immuneSchools?: number;
  immuneMechanics?: number[];
};

export const SPELL_SCHOOLS_GENERATED: Record<string, SpellSchoolFacts> =
  raw as Record<string, SpellSchoolFacts>;
