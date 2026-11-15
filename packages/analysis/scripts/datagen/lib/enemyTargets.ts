/**
 * SpellImplicitTarget values that denote an ENEMY unit or an enemy area —
 * shared by genAbilityEffects (`hitsEnemy` / `enemyAoE`) and
 * genVisionObscuringAuras (the refused-spell aim table, pipeline T108), so
 * the two cannot drift.
 */
/**
 * 指向敌人的 ImplicitTarget 值 —— 2026-08-22 逐个用已知技能对照钉出来的
 * (GH #29 第 6 项「进攻面 41% 空白」):
 *   6   指定敌人      变形术 / 死亡标记 / 触身通
 *   15  近身范围敌人  刀扇(15,22)
 *   16  目标区域敌人  战争践踏(18,16)/ 冰霜之环(87,16)/ 混沌新星(18,16)/ 枯萎凋零
 *   28  动态区域敌人  火焰之雨(1,28,87)/ 枯萎凋零
 *   104 锥形敌人      震荡波(1,104)
 * **只收验证过的值**:同族的 24(另一个锥形值)没有对照就不收 —— 宁可漏一个
 * (少判一次「打敌人」),不要凭猜把友方/位置标记算成敌方。18/87 是**目的地**
 * 标记不是敌方标记(GH #28 那次 405 条假阳的成因),它们只在与 16/28 同行时
 * 才意味着敌方,所以这里不收。
 */
export const ENEMY_IMPLICIT_TARGETS = new Set(["6", "15", "16", "28", "104"]);
/** 其中属于「范围/锥形」而不是「指定单体」的。 */
export const ENEMY_AREA_TARGETS = new Set(["15", "16", "28", "104"]);
