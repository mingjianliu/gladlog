/**
 * 「这个免疫挡不挡得住那个法术」——官方学派掩码,一个谓词。
 *
 * GH #29 阶段 1。此前这件事由两张手工表的一条**单向**规则表达
 * (`ccTrinketAnalysis.ts`):`MAGIC_ONLY_IMMUNITY_IDS`(5 条)× `PHYSICAL_CC_IDS`
 * (9 条),意思是「纯魔法免疫挡不住物理控」。没有反向规则,于是**纯物理免疫被
 * 推荐去躲魔法控** —— 250 场实测 2 条:建议用保护祝福躲 Sleep Walk。官方数据
 * 一句话判死:保护祝福的 SCHOOL_IMMUNITY 掩码是 `1`(仅物理),Sleep Walk 的
 * SchoolMask 是 `8`(自然系)。
 *
 * 两张手工表本身没写错,是**写不全**:官方 SchoolMask 一列就给出全部物理控,
 * 而手工的 9 条里没有制裁之锤(2/神圣)、暗影之怒(32)、混沌新星(124)这些
 * 魔法控——CLAUDE.md 手工名单完备性规则里「只能证伪不能证全」的标准形状。
 *
 * 数据来源:`scripts/datagen/genSpellSchools.ts`(DB2 SpellMisc.SchoolMask +
 * SpellEffect aura 39/77),写盘前双向断言真值。
 *
 * **缺数据 = 未知,不是「挡不住」**:反魔法护罩(靠吸收 aura69)、法术反射
 * (aura28)、剑刃风暴、龟盾都没有 aura39 行。这些技能的判断必须回退到调用方
 * 原有的手工规则,所以本模块的核心函数返回 `boolean | undefined` 三态,
 * 而不是二值。
 */
import { SPELL_SCHOOLS_GENERATED } from "./spellSchoolsGenerated";

/** SpellMisc.SchoolMask 的位:1 物理 · 2 神圣 · 4 火焰 · 8 自然 · 16 冰霜 ·
 *  32 暗影 · 64 奥术。126 = 全部魔法(127 去掉物理位),127 = 全部。 */
export const SCHOOL_PHYSICAL = 1;
export const SCHOOL_ALL_MAGIC = 126;

/** 这个法术**是**什么学派(未知返回 undefined)。 */
export function spellSchoolMask(spellId: string): number | undefined {
  return SPELL_SCHOOLS_GENERATED[spellId]?.school;
}

/**
 * Is a spell of school mask `spellMask` shut out by an interrupt that locked
 * `lockedMask` (the interrupted spell's schools)? Only when **every** school
 * the spell belongs to is locked — a multi-school spell with one school still
 * open goes out.
 *
 * Game-behaviour check (triage 2026-09-29, kick-eaten R6 / tier-C C5; 605 S2
 * files, 6,133 kicks, plain victims): spells with one school inside the lock
 * and one outside it succeeded inside the lockout 891× and started a cast
 * 287× (Dark Harvest 0x24, Chaos Bolt 0x7c, Starsurge 0x48, Voltaic Blaze
 * 0xc), spread through the window (dt / L p50 0.43) — against 14 not-ready
 * failures that neither the GCD nor the spell's own cooldown explains. The
 * control, fully locked spells: 2,025 such failures. The any-overlap test
 * this replaces called Starsurge locked by a Nature lock and printed its GCD
 * presses as lockout rejects (2c6e85ec).
 *
 * One predicate for the post-kick classifier (`ccTrinketAnalysis.ts`), the
 * kick-eaten text (`postKickFact`) and the first-success cut.
 */
export function schoolLockedBy(spellMask: number, lockedMask: number): boolean {
  return spellMask !== 0 && (spellMask & ~lockedMask) === 0;
}

/** 这个法术是不是纯物理(官方口径)。未知返回 undefined —— 调用方自己决定
 *  未知时怎么办,不要在这里替它假设。 */
export function isPhysicalSpell(spellId: string): boolean | undefined {
  const mask = spellSchoolMask(spellId);
  return mask === undefined ? undefined : mask === SCHOOL_PHYSICAL;
}

/** 这个技能给的学派免疫掩码(没有 SCHOOL_IMMUNITY 效果 → undefined)。 */
export function immunitySchoolMask(spellId: string): number | undefined {
  return SPELL_SCHOOLS_GENERATED[spellId]?.immuneSchools;
}

/** 这个技能让你免疫哪些机制(mechanic id,如 12=昏迷)。 */
export function immunityMechanics(spellId: string): number[] | undefined {
  return SPELL_SCHOOLS_GENERATED[spellId]?.immuneMechanics;
}

/**
 * `immunityId` 这个免疫能不能挡住 `spellId`。
 *
 * - `true` / `false`:官方两边都知道,按掩码判定。
 * - `undefined`:任一边没有官方数据 → **未知**,调用方必须回退到自己的手工
 *   规则(见模块头:反魔法护罩这类根本没有 aura39 行)。
 *
 * 判据是「**完全覆盖**」(`school & ~immunity === 0`)而不是「有交集」:
 * 多学派法术(混沌新星 124 = 火/自然/冰/暗影)只有在免疫覆盖它每一位时才算
 * 挡得住。方向是保守的 —— 我们只在能证明挡得住时才敢说「你本可以用它躲」。
 */
export function immunityCoversSpell(
  immunityId: string,
  spellId: string,
): boolean | undefined {
  const immunity = immunitySchoolMask(immunityId);
  const school = spellSchoolMask(spellId);
  if (immunity === undefined || school === undefined) return undefined;
  return (school & ~immunity) === 0;
}
