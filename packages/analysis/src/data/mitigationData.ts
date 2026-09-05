import generated from "./mitigationGenerated.json";

export interface IMitigationEntry {
  /** Damage reduction percentage, 0-100; immunities = 100. */
  pct: number;
  /** School mask this applies to, same bit semantics as the log's
   * spellSchoolId (0x7F all / 0x7E magic only / 0x1 physical only). */
  schoolMask: number;
  /**
   * Applies only to units standing inside the spell's area; consumers MUST
   * combine it with a coordinate check (advanced position data) before counting
   * this mitigation — without that check it must not be counted.
   */
  positional?: true;
}

/**
 * Curated override layer (always wins): every entry states its source and why
 * it overrides. Entries the generation layer cannot extract (unresolved / zero
 * hits) or extracts wrongly (contradicting game facts) are pinned here.
 *
 * Evidence basis (2026-07 human review, DB2 build 12.1.0.68629, full
 * SpellEffect table of 628107 rows):
 * - "aura39/40" = DB2 school-immunity / damage-immunity rows (immunities are
 *   pct=100 per the spec decision);
 * - "DR aura <id>" = the cast id itself has no aura-87 row; the actual
 *   mitigation aura hangs off a different id, that id has been observed in this
 *   library's real match logs (observedSpellIdsGenerated.json), and the value is
 *   taken from that aura id's current DB2 aura-87 row;
 * - the 4 pending entries (115203/357170/196718/374227) were each decided by the
 *   user on 2026-07-30; conclusions are in the inline "user decision" comments
 *   and in task-2-report.md. 196718 was originally ruled no-mitigation and then
 *   overturned by the user — see that entry's comment.
 */
export const MITIGATION_OVERRIDES: Record<string, IMitigationEntry> = {
  // —— Immunities (spec decision: immunity = pct 100 + the correct school mask) ——
  "642": { pct: 100, schoolMask: 0x7f }, // Divine Shield: full immunity; DB2 aura39 misc0=127+126; zero hits in the generation layer (immunities don't use aura87)
  "45438": { pct: 100, schoolMask: 0x7f }, // Ice Block: full immunity; DB2 aura39 misc0=1+127
  "1022": { pct: 100, schoolMask: 0x1 }, // Blessing of Protection: physical immunity only; DB2 aura39 misc0=1 (its aura87 points=0 row is a leftover dead slot, Task 1 unresolved)
  "204018": { pct: 100, schoolMask: 0x7e }, // Blessing of Spellwarding: magic immunity only; DB2 aura39 misc0=126
  "31224": { pct: 100, schoolMask: 0x7e }, // Cloak of Shadows: magic immunity only; DB2 aura186 points=-200 (spell hit -200%); spec decision; the aura87 0 row is a dead slot
  "186265": { pct: 100, schoolMask: 0x7f }, // Aspect of the Turtle: deflection = immunity (DB2 aura184/185/186 are all -200% hit); the spec decision overrides the generation layer's 30 with immunity semantics (that 30 is the residual mitigation on damage that isn't deflected)

  // —— The mitigation aura hangs off a different id (the generation layer can't find it by cast id) ——
  "51052": { pct: 30, schoolMask: 0x7e }, // Anti-Magic Zone: DR aura 145629 (observed), aura87 −15/126 × PvpMultiplier 2 = 30 % in PvP (2026-09-04 user ruling "PvP 值为官方值", BACKLOG #41; was 15 = the PvE number); the same-named 332831 (-20) is not observed and judged not live
  "198589": { pct: 25, schoolMask: 0x7f }, // Blur 疾影术:DR aura 212800(S2 归档已观测),`aura87 pts=-25 misc=127`;cast id 198589 自己只有一条 `E64 trig=212800`,所以生成层按 cast id 找不到它。2026-08-22 用户确认「的确是减伤,而且是大技能」后补登记
  "62618": { pct: 40, schoolMask: 0x7f }, // Power Word: Barrier: DR aura 81782 (observed), aura87 −20/127 × PvpMultiplier 2 = 40 % in PvP (2026-09-04 user ruling, BACKLOG #41; was 20 = the PvE number)
  "98008": { pct: 10, schoolMask: 0x7f }, // Spirit Link Totem: DR aura 325174 (observed), currently -10/127 (98007 has the same value but is not observed)
  "61336": { pct: 50, schoolMask: 0x7f }, // Survival Instincts: the cast id is dummy only (points=50); same-named 50322/236157 are both currently -50/127; stable at 50% long-term
  "115203": { pct: 20, schoolMask: 0x7f }, // Fortifying Brew: the cast id's dummy effect is ±20 (wowhead currently shows -20 too); the actual buff 120954 has aura87 base value 0 filled in by script, and a separate -15 variant exists (243435, not observed). 2026-07-30 user decision: take 20%
  "357170": { pct: 50, schoolMask: 0x7f }, // Time Dilation: mechanic = proportional absorb (aura69 all schools + dummy points=50); the absorbed 50% is re-settled ~10s later (time shift) so total damage is unchanged, but on a death/burst-window basis it is equivalent to 50% mitigation. 2026-07-30 user decision: adopt that basis (the strict total-damage no-mitigation alternative was presented and rejected)

  // —— Multi-row cast ids the generation layer cannot resolve (a real row plus a dead 0 slot) ——
  "386208": { pct: 15, schoolMask: 0x7f }, // Defensive Stance: DB2 aura87 on the cast id itself is -15/127, alongside a 0/126 dead slot — the generator rejects the pair as "multiple-conflicting-87-rows", the same dead-slot pattern already documented for Blessing of Protection and Cloak of Shadows (2026-08-12 audit)

  // —— Modifier-delivered mitigation (the cast id modifies another aura's value; there is no readable id) ——
  "31821": { pct: 24, schoolMask: 0x7f }, // Aura Mastery: **2026-09-04 用户改裁「是我错了,是 24」** —— 官方 PvP 链路:虔诚光环 465 aura87 −3 + 光环大师 31821 aura107 −9 × PvpMultiplier 2.34 = −21.06 → 3 + 21 = 24%(talentMitigationGenerated 同日 9 → 21)。原 2026-08-22 裁定「光掌是大技能,20% 全团」时官方链路只能推到 12%(虔诚光环 465 的 aura87 = -3/127,光环大师 31821 自己没有减伤行,只有 aura107 pts=-9 misc=3 的平坦修正,3+9=12);**没能验证的一环**是 SpellModOp 码 3 是否指「光环的效果数值」,DB2 里也没有任何一个 -12 的可观测 id 可以对账 —— 这正是 Darkness(196718)那条「用户推翻推导值」的同类先例。语料实证(250 场):光环大师施放 192 次,虔诚光环 465 的光环事件 2,729 次 vs 专注光环 317920 的 170 次,即这套语料里跑的基本都是减伤那一路;另一路(专注光环 → 大师给的是 317929,aura77 misc=9/26 免沉默+免打断,根本不是减伤)只占约 10%,不进这张表
  // —— Conditional mitigation (only in specific positions/conditions; consumers must evaluate the condition themselves) ——
  "196718": { pct: 40, schoolMask: 0x7f, positional: true }, // Darkness: 2026-07-30 user reversal — count it as 40% (a major cooldown cannot count as 0), but position MUST be evaluated: not standing in the Darkness means it doesn't count. The dividing line is whether the condition is decidable from the log: Darkness's condition (position) is, hence a value + positional; Zephyr's (374227) condition (whether the damage is AoE) is not, so it stays omitted
};

/**
 * Whitelisted entries that genuinely have no (percentage-type) mitigation
 * attribute — pure absorb shields / healing / damage-transfer effects, each with
 * its reason. Mutually exclusive with MITIGATION_TABLE; the anti-rot test
 * guards that there is no third state.
 */
export const NO_MITIGATION_IDS: ReadonlySet<string> = new Set([
  "6940", // Blessing of Sacrifice: damage transfer (30% redirected to the paladin); the spec states transfer effects don't enter the table; its aura87 points=0 row is a dead slot
  "19236", // Desperate Prayer: pure healing + max health, DB2 has no aura87 row at all
  "47788", // Guardian Spirit: +60% healing received (aura118) + death prevention, no percentage mitigation (the same-named new id 1247928 has a -10 row but is not observed, see the pending-decision section note)
  "97462", // Rallying Cry: +10% max health (the actual buff is 97463), no mitigation
  "116849", // Life Cocoon: pure absorb shield (aura69) + healing bonus, no percentage mitigation
  "122470", // Touch of Karma: absorb + damage transfer to the target (aura69), not percentage mitigation
  "1966", // Feint: AoE-only damage reduction (aura229, like Zephyr below), plus a 0-point aura87 dead slot on the cast id — this table's shape cannot express AoE-conditional mitigation (2026-08-12 audit)
  "5277", // Evasion: dodge/parry chance, not percentage mitigation — the cast id's two aura87 rows are both 0-point dead slots (2026-08-12 audit)
  "11426", // Ice Barrier: absorb shield (aura69); its only aura87 row is a 0-point dead slot. Absorbs are accounted for as effective HP from the log's own SPELL_ABSORBED events, not through this percentage table (2026-08-12)
  "974", // Earth Shield: the cast id's aura87 is a 0-point dead slot; the same-named -10/-15/-20 ids belong to other spells and none is corroborated by this library's logs, so no value is pinned (2026-08-12 audit)
  "17", // Power Word: Shield: pure absorb (aura69) — accounted as effective HP from SPELL_ABSORBED, see absorbShields.ts (2026-08-12)
  "421453", // Ultimate Penitence: pure absorb (aura69), same accounting (2026-08-12)
  "108416", // Dark Pact: absorb plus self-heal (aura69 + periodic), no percentage component (2026-08-12)
  "374348", // Renewing Blaze 复苏烈焰:把受到的伤害转成随时间回复的治疗,不是百分比减伤 —— 归档 400 文件里光环 374349 有 3,145 条 SPELL_PERIODIC_HEAL、零减伤证据,官方也只有一条 `aura4 pts=100` 的 dummy。2026-08-23 用户裁定「是大技能,虽然不是减伤」
  "374227", // Zephyr: only 20% AoE mitigation (aura229, not aura87); this table's shape cannot express conditional mitigation. 2026-07-30 user decision: no-mitigation, better omitted (196718 Darkness is also conditional, but its condition — position — is decidable from the log, so it was moved into MITIGATION_OVERRIDES; see the comment there)
]);

const gen = (
  generated as unknown as {
    entries: Record<string, IMitigationEntry>;
  }
).entries;

/** Merged table: generated base + curated overrides always winning (same
 * two-layer scheme as spellEffectData). */
// 2026-08-21 S2 corpus scan (10,682 matches): removed Netherwalk 196555 — 0 occurrences, ability gone in 12.x (eval-private/reports/s2-health-2026-08-21)
export const MITIGATION_TABLE: Record<string, IMitigationEntry> = {
  ...gen,
  ...MITIGATION_OVERRIDES,
};
