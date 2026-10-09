/**
 * Registry of every HAND-MAINTAINED table keyed by (or containing) WoW spell
 * ids. Exists for one purpose: the Curated-List Completeness Rule's **reverse
 * pass** — intersect each list's own keys with the corpus-observed id set and
 * surface entries with zero occurrences. Spell ids are not stable across
 * expansions (GH #23: `DISPEL_PENALTY_SPELLS` knew Unstable Affliction only by
 * two ids that occur 0× in 1178 rounds while the live id had 1153
 * applications); an entry that was right when written stays in the file
 * looking authoritative forever, and nothing downstream can tell "the game
 * doesn't have that" from "the list is stale".
 *
 * Generated tables (official DB2 mining) are deliberately NOT here — they are
 * refreshed by datagen, not hand-kept, and their universe is the whole game.
 * Mixed tables (generated ∪ hand layer) list only the hand layer.
 *
 * Consumers: `packages/eval/scripts/curatedRotScan.ts` (report) and
 * `test/curatedIdRegistry.test.ts` (shape). When you add a new hand table of
 * spell ids anywhere in this package, add an entry — the registry is the
 * index, and the rule has never been the missing piece (CLAUDE.md).
 */
import { BURST_LEAD_CD_EXCLUDED_IDS } from "../analysis/burstWindowDecisionPoints";
import { CD_WASTE_EXCLUDED_IDS } from "../analysis/candidateFindings";
import { HEALER_TEAM_BURST_IDS } from "../analysis/candidates/cooldownTiming";
import { ZONE_EXTERNAL_RADIUS_YD } from "../analysis/candidates/death";
import {
  CRISIS_MOBILITY_PRESS_IDS,
  CRISIS_PROC_ANSWERS,
  CRISIS_PROTECTIVE_ANSWER_IDS,
} from "../analysis/crisisDecisionPoints";
import { DOT_SPELL_IDS } from "../context/matchTimelineSections";
import { DEFERRED_DAMAGE_SPELL_IDS } from "../context/timelineHelpers";
import {
  CHANNELED_CD_SPELL_IDS,
  ENEMY_MAJOR_BUFF_SPELL_IDS,
  HEALER_CAST_SPELL_ID_TO_NAME,
  HEALING_AMPLIFIER_SPELL_IDS,
  MANA_COOLDOWN_SPELL_IDS,
} from "../context/timelineHelpers";
import {
  NO_FIXED_DURATION_IDS,
  SPELL_DURATION_OVERRIDES,
} from "../utils/buffDuration";
import {
  BLADESTORM_AURA_IDS,
  UNRELENTING_ONSLAUGHT_TALENT_ID,
  USABLE_IN_BLADESTORM_WITH_TALENT,
} from "../utils/castingLocks";
import { DISPLACEMENT_EVIDENCE_IDS } from "../utils/castStopEvidence";
import { HEAL_ABSORB_SELF_SAVE_IDS } from "../utils/healAbsorbSave";
import { AUTO_ATTACK_REPLACEMENT_IDS } from "../utils/damagePress";
import { TOUCH_OF_KARMA_FEED_IDS } from "../utils/karmaFeed";
import { KILL_ATTEMPT_NON_ANCHOR_CDS } from "../utils/killAttempts";
import { EXECUTE_KILLING_BLOW_IDS } from "../utils/killingBlow";
import { COPY_CAST_IDS } from "../utils/castPress";
import {
  BREAKABLE_CC_SPELL_IDS,
  CC_AVOIDANCE_BUFF_SPELLS,
  DRUID_FORM_BUFFS,
  GROUND_CC_SPELL_IDS,
  LOCK_IGNORING_CAST_IDS,
  MAGIC_ONLY_IMMUNITY_IDS,
  TARGET_BOUND_MOBILITY_IDS,
  PHYSICAL_CC_IDS,
  PRE_TELEPORT_POSITION_SPELL_IDS,
  REPOSITIONING_SPELL_IDS,
  TARGETED_CC_DODGE_SPELLS,
  TREMOR_BREAKABLE_CC_IDS,
} from "../utils/ccTrinketAnalysis";
import { STASIS_STORABLE_HEAL_IDS } from "../utils/combatStates";
import {
  ADDITIONAL_OVERLAP_DEFENSIVE_IDS,
  ALLY_REACH_REQUIRES_PVP_TALENT,
  AURA_ACTIVATION_PROVES_BUTTON_IDS,
  AURA_IS_THE_PRESS_IDS,
  AURA_ONLY_ACTIVATION_IDS,
  BASELINE_DEFENSIVE_BY_SPEC,
  CD_ROLE_TAGS,
  ENEMY_TARGET_DEFENSIVE_IDS,
  FORBEARANCE_GATED_IDS,
  NON_SUBSTITUTE_DEFENSIVE_IDS,
  PASSIVE_PROC_CAST_IDS,
  PROC_ONLY_ACTIVATION_IDS,
  RESPONSE_ONLY_DEFENSIVE_IDS,
  SELF_CAST_NOOP_EXTERNAL_IDS,
  SPEC_EXCLUSIVE_SPELLS,
  SPELL_CANONICAL_IDS,
  TEAM_HEAL_CD_IDS,
  TEAM_SAVE_CD_IDS,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
  USABLE_WHILE_CC_CONDITIONAL,
  STUN_PURGE_WITHHELD_IDS,
  USABLE_WHILE_CC_GAP_IDS,
  USABLE_WHILE_FEARED_GAP_IDS,
} from "../utils/cooldowns";
import { UNUSED_SELF_COVERAGE_UNMODELLED } from "../utils/counterfactual";
import {
  DEFERRAL_SHIELD_DAMAGE_IDS,
  REDISTRIBUTION_DAMAGE_IDS,
} from "../utils/incomingPressure";
import {
  EXTERNAL_DEFENSIVE_SPELLS,
  IMMUNITY_SPELLS,
} from "../utils/deathOutcomeAnalysis";
import {
  BACKLASH_CC_SPELL_IDS,
  CLEANSE_SPELLS_BY_TYPE,
  COMP_DEPENDENT_PURGE_TARGETS,
  DISPEL_COOLDOWNS_BY_SPELL,
  DISPEL_PENALTY_SPELLS,
  DISPEL_TYPE_TALENT_GATES,
  GREATER_PURGE_SPELL_ID,
  PURGE_BLOCKLIST,
  PURGE_GATE_SPELL_BY_SPEC,
  PURGE_SPELLS_BY_SPEC,
  STELLAR_PROTECTION_PENALIZED_SPELLS,
  UNPURGEABLE_MAGIC_AURAS,
} from "../utils/dispelAnalysis";
import { MOVEMENT_ROOT_BREAK_DISPEL_IDS } from "../utils/dispelKind";
import { AOE_CC_SPELL_IDS } from "../utils/drAnalysis";
import { NON_PLAYER_INTERRUPT_IDS } from "../utils/enemyInterrupts";
import { KICK_LOCKOUT_VICTIM_MODIFIERS } from "../utils/kickLockout";
import { EXTERNAL_DAMAGE_SHIELD_IDS } from "../utils/externalDamage";
import { SPEC_PRIMARY_CC } from "../utils/healerExposureAnalysis";
import { HEALER_AVOIDANCE_SPELLS } from "../utils/healerExposureAnalysis";
import { PVP_TRINKET_SPELL_IDS } from "../utils/killWindowTargetSelection";
import {
  ASCENDANCE_ENH_ID,
  DOOM_WINDS_PRESS_ID,
  EYE_BEAM_ID,
  METAMORPHOSIS_PRESS_CAST_IDS,
  OFFENSIVE_AURA_EVIDENCE,
} from "../utils/offensiveAuraOccurrences";
import {
  ADAPTATION_LOCKOUT_AURA_ID,
  ADAPTATION_TRIGGER_AURA_ID,
} from "../utils/pvpTrinketUses";
import { FREE_CAST_AURA_IDS } from "../utils/resourceAt";
import {
  OFFENSIVE_CD_SPELL_IDS,
  OFFENSIVE_EFFECT_ACTIVATION_IDS,
  SPELL_EFFECT_OVERRIDES as SPELL_DANGER_OVERRIDES,
} from "../utils/spellDanger";
import { GAP_CLOSER_SPELL_IDS } from "../utils/gapClosers";
import { HEALER_REACH_SPELLS } from "../utils/spellRange";
import {
  OFFENSIVE_PURGE_TALENT_IDS,
  TALENT_BEHAVIORS,
} from "../utils/talentBehaviors";
import {
  PER_RANK_COOLDOWN_TALENTS,
  RULED_COOLDOWN_VALUES,
} from "../utils/talentModifiers";
import { KW_MAJOR_DEFENSIVE_IDS } from "./abilityProfile";
import { castEffectPairs } from "./castEffectAuras";
import { CAST_PARAM_DURATIONS } from "./castParamDurations";
import { classMetadata } from "./classSpells";
import { CURATED_ABILITY_FACTS } from "./curatedAbilityFacts";
import { DISPEL_VERDICTS } from "./dispelVerdicts";
import { spellClassMap } from "./drCategories";
import { DRUID_FORM_AURA_IDS, FORM_BOUND_BUFF_IDS } from "./druidForms";
import { ENEMY_HEAL_CD_IDS } from "./enemyHealCds";
import { HEALING_VERDICTS, PROPOSED_HEALING_VERDICTS } from "./healingVerdicts";
import {
  KICKED_CONTROL_OVERRIDE_IDS,
  KICKED_DAMAGE_OVERRIDE_IDS,
  KICKED_HEAL_OVERRIDE_IDS,
  KICKED_OTHER_OVERRIDE_IDS,
} from "./kickedSpellCategories";
import {
  AURA_KEYED_BREAK_RACIALS,
  CLASS_CC_BREAK_ABILITIES,
} from "./ccBreakAbilities";
import {
  MITIGATION_OVERRIDES,
  NO_MITIGATION_IDS,
  SELF_WALL_AURA_TO_CAST_ID,
} from "./mitigationData";
import { MITIGATION_VERDICTS } from "./mitigationVerdicts";
import { CHANNEL_PROXY_IDS, DRINK_AURA_IDS } from "./occupancyAuras";
import {
  HIGH_VALUE_PURGEABLE_BUFFS,
  PURGE_WHITELIST_DATA_BLOCKED,
} from "./purgeWhitelist";
import {
  RACIAL_ABILITIES,
  SHARED_CD_RACIAL_SPELL_IDS,
} from "./racialAbilities";
import {
  DISENTANGLEMENT_EFFECT_ID,
  SHATTERING_THROW_CAST_ID,
  SHATTERING_THROW_DISPEL_ID,
  SHATTERING_THROW_REMOVES,
  SHIV_REMOVES,
  SHIV_SPELL_ID,
} from "./scopedPurges";
import { SPELL_CATEGORIES } from "./spellCategories";
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  CC_DURATION_TALENT_MODIFIERS,
  OPPRESSING_ROAR_SPELL_ID,
} from "./spellEffectData";
import {
  CORPUS_COOLDOWN_PATCHES,
  CORPUS_DURATION_PATCHES,
  DISPEL_TYPES,
  SPELL_EFFECT_OVERRIDES,
} from "./spellEffectOverrides";
import spellIdLists, {
  ENEMY_AREA_SAVE_IDS,
  ENEMY_ALLY_SAVE_IDS,
  ENEMY_IMMUNITY_EXTERNAL_CASTS,
  ENEMY_IMMUNITY_HEAL_PROCS,
  ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS,
  ENEMY_IMMUNITY_SAVE_AURAS,
  ENEMY_REDIRECT_SAVE_IDS,
  ENEMY_SELF_SAVE_ONLY_IDS,
} from "./spellIdLists";
import { trinketSpellIds } from "./spellTags";
import { TALENT_MITIGATION_MODIFIERS } from "./talentMitigationModifiers";
import { TALENT_REPLACES } from "./talentReplaces";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  FREE_RECAST_WINDOWS,
} from "./talentScriptedCooldowns";
import { WARLOCK_PET_CAST_FUNCTION } from "./warlockPets";

/** What kind of id the list holds — decides which corpus event stream can vouch for it. */
export type CuratedIdKind = "cast" | "aura" | "talent" | "mixed";

export interface CuratedIdTable {
  /** Export name, unique. */
  name: string;
  /** Source file, repo-relative to packages/analysis/src. */
  file: string;
  kind: CuratedIdKind;
  /** All spell ids the table asserts anything about, as numeric strings. */
  ids: () => string[];
}

const keys = (o: object) => Object.keys(o);
const set = (s: Iterable<string | number>) => [...s].map(String);
const t = (
  name: string,
  file: string,
  kind: CuratedIdKind,
  ids: () => Array<string | number | undefined | null>,
): CuratedIdTable => ({
  name,
  file,
  kind,
  ids: () => [
    ...new Set(
      ids()
        .filter((x) => x != null)
        .map(String),
    ),
  ],
});

export const CURATED_ID_TABLES: readonly CuratedIdTable[] = [
  // data/
  t("SPELL_CATEGORIES", "data/spellCategories.ts", "mixed", () =>
    keys(SPELL_CATEGORIES),
  ),
  t("classMetadata", "data/classSpells.ts", "cast", () =>
    classMetadata.flatMap((c) => c.abilities.map((a) => a.spellId)),
  ),
  t("SPELL_EFFECT_OVERRIDES", "data/spellEffectOverrides.ts", "cast", () =>
    keys(SPELL_EFFECT_OVERRIDES),
  ),
  // GH #86 (2026-09-22): a warlock pet's signature casts, the fallback that
  // names the pet when its npcId is not listed; the npcId half of the same
  // table rides on npcRosterScan.ts like CRITICAL_NON_PLAYER_NPC_NAMES.
  t("WARLOCK_PET_CAST_FUNCTION", "data/warlockPets.ts", "cast", () =>
    keys(WARLOCK_PET_CAST_FUNCTION),
  ),
  t("DISPEL_TYPES", "data/spellEffectOverrides.ts", "aura", () =>
    keys(DISPEL_TYPES),
  ),
  t(
    "spellIdLists.bigDefensiveSpellIds",
    "data/spellIdLists.ts",
    "cast",
    () => spellIdLists.bigDefensiveSpellIds,
  ),
  t(
    "spellIdLists.attributedMitigationSpellIds",
    "data/spellIdLists.ts",
    "cast",
    () => spellIdLists.attributedMitigationSpellIds,
  ),
  t(
    "spellIdLists.externalDefensiveSpellIds",
    "data/spellIdLists.ts",
    "cast",
    () => spellIdLists.externalDefensiveSpellIds,
  ),
  // Triage 2026-09-29 (enemy-def F-E7 / F-E4 / F-E9): the enemy-only save
  // sets — read by enemyDefensives.ts alone ([ENEMY DEF] + KILL ATTEMPTS).
  t(
    "spellIdLists.ENEMY_SELF_SAVE_ONLY_IDS",
    "data/spellIdLists.ts",
    "cast",
    () => set(ENEMY_SELF_SAVE_ONLY_IDS),
  ),
  t("spellIdLists.ENEMY_ALLY_SAVE_IDS", "data/spellIdLists.ts", "cast", () =>
    set(ENEMY_ALLY_SAVE_IDS),
  ),
  t(
    "spellIdLists.ENEMY_REDIRECT_SAVE_IDS",
    "data/spellIdLists.ts",
    "cast",
    () => set(ENEMY_REDIRECT_SAVE_IDS),
  ),
  // enemy-def F-E5 / F-E6 (ruling A25): the immunity-kind saves. Aura-keyed
  // (Cheat Death and Cauterize log only their proc aura), a heal-proc id, and
  // the cast → aura pairs of immunities put on an ally.
  t(
    "spellIdLists.ENEMY_IMMUNITY_SAVE_AURAS",
    "data/spellIdLists.ts",
    "aura",
    () => keys(ENEMY_IMMUNITY_SAVE_AURAS),
  ),
  // user ruling U-KA3: the immunity-kind auras that hold while they are up
  t(
    "spellIdLists.ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS",
    "data/spellIdLists.ts",
    "aura",
    () => set(ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS),
  ),
  t(
    "spellIdLists.ENEMY_IMMUNITY_HEAL_PROCS",
    "data/spellIdLists.ts",
    "aura",
    () => keys(ENEMY_IMMUNITY_HEAL_PROCS),
  ),
  t(
    "spellIdLists.ENEMY_IMMUNITY_EXTERNAL_CASTS",
    "data/spellIdLists.ts",
    "mixed",
    () => [
      ...keys(ENEMY_IMMUNITY_EXTERNAL_CASTS),
      ...Object.values(ENEMY_IMMUNITY_EXTERNAL_CASTS),
    ],
  ),
  // enemy-def F-E21 (ruling A′15): class abilities that remove control, and
  // the break racials logged only as a buff (buff id → racial cast id).
  t("CLASS_CC_BREAK_ABILITIES", "data/ccBreakAbilities.ts", "cast", () =>
    keys(CLASS_CC_BREAK_ABILITIES),
  ),
  t("AURA_KEYED_BREAK_RACIALS", "data/ccBreakAbilities.ts", "aura", () =>
    keys(AURA_KEYED_BREAK_RACIALS),
  ),
  // enemy-def F-E1a: logged aura id → the cast id its wall row is keyed by.
  t("SELF_WALL_AURA_TO_CAST_ID", "data/mitigationData.ts", "mixed", () => [
    ...keys(SELF_WALL_AURA_TO_CAST_ID),
    ...Object.values(SELF_WALL_AURA_TO_CAST_ID),
  ]),
  // enemy-def F-E1b / crisis-external F-A1b (ruling A15): cast-anchored area saves.
  t("spellIdLists.ENEMY_AREA_SAVE_IDS", "data/spellIdLists.ts", "cast", () =>
    set(ENEMY_AREA_SAVE_IDS),
  ),
  // GH #91 round 2 (2026-09-22): the ally-applied absorb shields the
  // during-external contract admits (one member, Life Cocoon).
  t(
    "externalDamage.EXTERNAL_DAMAGE_SHIELD_IDS",
    "utils/externalDamage.ts",
    "aura",
    () => [...EXTERNAL_DAMAGE_SHIELD_IDS],
  ),
  // GH #29 阶段 0(2026-08-22):这张并集表**过去不在登记里**,而它正是
  // `MAJOR_DEFENSIVE_IDS`(9 个生产消费者,含 candidateFindings / momentSnapshot)
  // 的原料。反向腐烂扫描因此扫不到它:有 4 个 id 只存在于这张并集里,另外两张
  // 分表没有 —— 闪避 5277、神圣赞美诗 64843、宁静 740、神圣显灵 200183
  // (2026-08-22 实测四条在 S2 语料里都还活着,所以是盲区不是事故)。
  t(
    "spellIdLists.externalOrBigDefensiveSpellIds",
    "data/spellIdLists.ts",
    "cast",
    () => spellIdLists.externalOrBigDefensiveSpellIds,
  ),
  // GH #31 ②(2026-09-02):kill-window 家族的单源花名册(旧 externalOrBig
  // 手工表 − Apotheosis + Ancient of Lore;官方面方案实测被否,降级为审计,
  // 见 abilityProfile.ts 该常量的 doc comment)。
  t(
    "abilityProfile.KW_MAJOR_DEFENSIVE_IDS",
    "data/abilityProfile.ts",
    "cast",
    () => [...KW_MAJOR_DEFENSIVE_IDS],
  ),
  t("RACIAL_ABILITIES", "data/racialAbilities.ts", "cast", () =>
    keys(RACIAL_ABILITIES),
  ),
  t("SHARED_CD_RACIAL_SPELL_IDS", "data/racialAbilities.ts", "cast", () =>
    set(SHARED_CD_RACIAL_SPELL_IDS),
  ),
  t("MITIGATION_OVERRIDES", "data/mitigationData.ts", "cast", () =>
    keys(MITIGATION_OVERRIDES),
  ),
  t("NO_MITIGATION_IDS", "data/mitigationData.ts", "cast", () =>
    set(NO_MITIGATION_IDS),
  ),
  // 治疗裁定册:登记的是**正册 ∪ 暂存区**的并集 —— 建册当天正册为空,而空表在扫描
  // 里和「100% 健康」长得一模一样。这两张表加起来才是「这张手工表对哪些 id 有断言」。
  t("HEALING_VERDICTS", "data/healingVerdicts.ts", "cast", () => [
    ...keys(HEALING_VERDICTS),
    ...keys(PROPOSED_HEALING_VERDICTS),
  ]),
  t("MITIGATION_VERDICTS", "data/mitigationVerdicts.ts", "cast", () =>
    keys(MITIGATION_VERDICTS),
  ),
  t("DISPEL_VERDICTS", "data/dispelVerdicts.ts", "aura", () =>
    keys(DISPEL_VERDICTS),
  ),
  t("spellClassMap.disarm+knockback", "data/drCategories.ts", "aura", () =>
    [
      ...spellClassMap.diminishingReturns.disarm,
      ...spellClassMap.diminishingReturns.knockback,
    ].map((e) => e.spellId),
  ),
  t("CURATED_ABILITY_FACTS", "data/curatedAbilityFacts.ts", "mixed", () =>
    CURATED_ABILITY_FACTS.map((f) => f.id),
  ),
  t("trinketSpellIds", "data/spellTags.ts", "cast", () => trinketSpellIds),
  t("TALENT_REPLACES", "data/talentReplaces.ts", "mixed", () => [
    ...keys(TALENT_REPLACES),
    ...Object.values(TALENT_REPLACES).flat(),
  ]),
  // utils/cooldowns.ts
  // 2026-09-11: this table was invisible to the rot scans for its whole life —
  // it existed only as eight ENGLISH NAMES (PASSIVE_SPELL_BLOCKLIST), and the
  // registry indexes id tables. Being name-keyed it also silently matched
  // nothing on non-English clients (23.4% of Reclamation's casts).
  t("PASSIVE_PROC_CAST_IDS", "utils/cooldowns.ts", "cast", () => [
    ...PASSIVE_PROC_CAST_IDS.keys(),
  ]),
  t("CD_ROLE_TAGS", "utils/cooldowns.ts", "cast", () => keys(CD_ROLE_TAGS)),
  t("TEAM_HEAL_CD_IDS", "utils/cooldowns.ts", "cast", () =>
    set(TEAM_HEAL_CD_IDS),
  ),
  t("FREE_CAST_AURA_IDS", "utils/resourceAt.ts", "aura", () =>
    set(FREE_CAST_AURA_IDS),
  ),
  t("AURA_ACTIVATION_PROVES_BUTTON_IDS", "utils/cooldowns.ts", "cast", () =>
    set(AURA_ACTIVATION_PROVES_BUTTON_IDS),
  ),
  t("CD_WASTE_EXCLUDED_IDS", "analysis/candidateFindings.ts", "cast", () =>
    set(CD_WASTE_EXCLUDED_IDS),
  ),
  t("RESPONSE_ONLY_DEFENSIVE_IDS", "utils/cooldowns.ts", "cast", () =>
    set(RESPONSE_ONLY_DEFENSIVE_IDS),
  ),
  // generated (data/baselineDefensivesGenerated.json), registered all the
  // same: a renumbered baseline button would sit in every such spec's ledger
  // as "never used" (triage cd-hoarded F-W6)
  t("BASELINE_DEFENSIVE_BY_SPEC", "utils/cooldowns.ts", "cast", () => [
    ...new Set(Object.values(BASELINE_DEFENSIVE_BY_SPEC).flat()),
  ]),
  // generated too: a renumbered Touch of Karma would drop out of the
  // enemy-in-reach gate and come back as a held save (codex round 6, F-W6)
  t("ENEMY_TARGET_DEFENSIVE_IDS", "utils/cooldowns.ts", "cast", () =>
    set(ENEMY_TARGET_DEFENSIVE_IDS),
  ),
  t("ALLY_REACH_REQUIRES_PVP_TALENT", "utils/cooldowns.ts", "cast", () =>
    keys(ALLY_REACH_REQUIRES_PVP_TALENT),
  ),
  t(
    "ALLY_REACH_REQUIRES_PVP_TALENT.talent",
    "utils/cooldowns.ts",
    "talent",
    () => set(Object.values(ALLY_REACH_REQUIRES_PVP_TALENT)),
  ),
  t("ADDITIONAL_OVERLAP_DEFENSIVE_IDS", "utils/cooldowns.ts", "cast", () =>
    set(ADDITIONAL_OVERLAP_DEFENSIVE_IDS),
  ),
  // EMPTY since 2026-09-04 (its three ids are covered by the named bit 378);
  // stays registered and is named in the test's DELIBERATELY_EMPTY list.
  t("USABLE_WHILE_CC_GAP_IDS", "utils/cooldowns.ts", "cast", () =>
    set(USABLE_WHILE_CC_GAP_IDS),
  ),
  // user ruling U-T1b: nominated by DB2's immunity route, not taken
  t("STUN_PURGE_WITHHELD_IDS", "utils/cooldowns.ts", "cast", () =>
    set(STUN_PURGE_WITHHELD_IDS),
  ),
  t("USABLE_WHILE_FEARED_GAP_IDS", "utils/cooldowns.ts", "cast", () =>
    set(USABLE_WHILE_FEARED_GAP_IDS),
  ),
  t("USABLE_WHILE_CC_CONDITIONAL", "utils/cooldowns.ts", "cast", () =>
    keys(USABLE_WHILE_CC_CONDITIONAL),
  ),
  t("SPELL_CANONICAL_IDS", "utils/cooldowns.ts", "mixed", () => [
    ...keys(SPELL_CANONICAL_IDS),
    ...Object.values(SPELL_CANONICAL_IDS),
  ]),
  t("FORBEARANCE_GATED_IDS", "utils/cooldowns.ts", "cast", () =>
    set(FORBEARANCE_GATED_IDS),
  ),
  t("SPEC_EXCLUSIVE_SPELLS", "utils/cooldowns.ts", "cast", () =>
    keys(SPEC_EXCLUSIVE_SPELLS),
  ),
  // GH #106 step 2 (2026-09-24): aura-only entries whose buff is the press
  // itself (read even when a real cast was logged).
  t("AURA_IS_THE_PRESS_IDS", "utils/cooldowns.ts", "cast", () => [
    ...AURA_IS_THE_PRESS_IDS,
  ]),
  t("AURA_ONLY_ACTIVATION_IDS", "utils/cooldowns.ts", "mixed", () => [
    ...keys(AURA_ONLY_ACTIVATION_IDS),
    ...Object.values(AURA_ONLY_ACTIVATION_IDS).flat(),
  ]),
  // 无按键能力表:键是 cast id,但它们**结构上永远没有 cast 行** —— 反向腐烂扫描
  // 已按 AURA_ONLY_ACTIVATION_IDS 查光环兜底(见 curatedRotScan 的 auraAlive)。
  t("PROC_ONLY_ACTIVATION_IDS", "utils/cooldowns.ts", "cast", () =>
    set(PROC_ONLY_ACTIVATION_IDS),
  ),
  t("NON_SUBSTITUTE_DEFENSIVE_IDS", "utils/cooldowns.ts", "cast", () =>
    set(NON_SUBSTITUTE_DEFENSIVE_IDS),
  ),
  t("SELF_CAST_NOOP_EXTERNAL_IDS", "utils/cooldowns.ts", "cast", () =>
    set(SELF_CAST_NOOP_EXTERNAL_IDS),
  ),
  t("THROUGHPUT_EMPOWER_DEFENSIVE_IDS", "utils/cooldowns.ts", "cast", () =>
    set(THROUGHPUT_EMPOWER_DEFENSIVE_IDS),
  ),
  // utils/dispelAnalysis.ts
  t("DISPEL_PENALTY_SPELLS", "utils/dispelAnalysis.ts", "aura", () =>
    set(DISPEL_PENALTY_SPELLS.keys()),
  ),
  t("BACKLASH_CC_SPELL_IDS", "data/backlashCc.ts", "aura", () => [
    ...BACKLASH_CC_SPELL_IDS.keys(),
    ...[...BACKLASH_CC_SPELL_IDS.values()].map((v) => v.backlashSpellId),
  ]),
  t(
    "STELLAR_PROTECTION_PENALIZED_SPELLS",
    "utils/dispelAnalysis.ts",
    "aura",
    () => set(STELLAR_PROTECTION_PENALIZED_SPELLS.keys()),
  ),
  t("DISPEL_COOLDOWNS_BY_SPELL", "utils/dispelAnalysis.ts", "cast", () =>
    set(DISPEL_COOLDOWNS_BY_SPELL.keys()),
  ),
  // talent impact audit 2026-09-26: dispel types that need a talent
  t("BLADESTORM_AURA_IDS", "utils/castingLocks.ts", "aura", () =>
    set(BLADESTORM_AURA_IDS),
  ),
  t("USABLE_IN_BLADESTORM_WITH_TALENT", "utils/castingLocks.ts", "cast", () => [
    ...USABLE_IN_BLADESTORM_WITH_TALENT,
    UNRELENTING_ONSLAUGHT_TALENT_ID,
  ]),
  // kick-eaten F-K8 (ruling A23, 2026-09-30): a victim talent that shortens a
  // kick's lockout for some interrupted spells (Storm Conduit 1217092 on
  // Lightning Bolt / Chain Lightning)
  t("KICK_LOCKOUT_VICTIM_MODIFIERS", "utils/kickLockout.ts", "mixed", () =>
    KICK_LOCKOUT_VICTIM_MODIFIERS.flatMap((m) => [
      m.talentId,
      ...m.interruptedSpellIds,
    ]),
  ),
  // position F-D1: teleports whose caster keeps its pre-teleport position
  // in the log for a moment (Shadowstep)
  t(
    "PRE_TELEPORT_POSITION_SPELL_IDS",
    "utils/ccTrinketAnalysis.ts",
    "cast",
    () => set(PRE_TELEPORT_POSITION_SPELL_IDS),
  ),
  t("NON_PLAYER_INTERRUPT_IDS", "utils/enemyInterrupts.ts", "cast", () =>
    set(NON_PLAYER_INTERRUPT_IDS),
  ),
  t("DISPEL_TYPE_TALENT_GATES", "utils/dispelAnalysis.ts", "talent", () =>
    Object.values(DISPEL_TYPE_TALENT_GATES).flatMap((g) =>
      Object.values(g ?? {}).flat(),
    ),
  ),
  t("PURGE_BLOCKLIST", "utils/dispelAnalysis.ts", "aura", () =>
    set(PURGE_BLOCKLIST),
  ),
  // B-tier B13e (user ruling 2026-10-07): the blocklist's subset no purge
  // can remove — what the purgeable-buff count leaves out.
  t("UNPURGEABLE_MAGIC_AURAS", "utils/dispelAnalysis.ts", "aura", () =>
    set(UNPURGEABLE_MAGIC_AURAS),
  ),
  // GH #83: the spell each spec dispels with — its range is the reach gate
  t("CLEANSE_SPELLS_BY_TYPE", "utils/dispelAnalysis.ts", "cast", () =>
    set(
      Object.values(CLEANSE_SPELLS_BY_TYPE).flatMap((bySpec) =>
        Object.values(bySpec).flatMap((ids) => [...(ids ?? [])]),
      ),
    ),
  ),
  // GH #83: the fallback CC per class for enemies not yet seen casting one
  t("SPEC_PRIMARY_CC", "utils/healerExposureAnalysis.ts", "aura", () =>
    SPEC_PRIMARY_CC.map((e) => e.spellId),
  ),
  // Triage 2026-09-29 F-K10b (ruling A′17): enemy displacements that break a
  // cast bar — the knockback family plus Typhoon's daze aura.
  t("DISPLACEMENT_EVIDENCE_IDS", "utils/castStopEvidence.ts", "mixed", () =>
    set(DISPLACEMENT_EVIDENCE_IDS),
  ),
  // Triage 2026-09-29 F-K6b (ruling A12 + U2): caster-displacing abilities
  // an enemy kicker can close a gap with — kick-eaten's out-range gate.
  t("GAP_CLOSER_SPELL_IDS", "utils/gapClosers.ts", "cast", () =>
    set(GAP_CLOSER_SPELL_IDS),
  ),
  t("HEALER_REACH_SPELLS", "utils/spellRange.ts", "cast", () =>
    set(Object.values(HEALER_REACH_SPELLS).flat()),
  ),
  t("PURGE_GATE_SPELL_BY_SPEC", "utils/dispelAnalysis.ts", "cast", () => [
    ...Object.values(PURGE_GATE_SPELL_BY_SPEC),
    GREATER_PURGE_SPELL_ID,
  ]),
  t("PURGE_SPELLS_BY_SPEC", "utils/dispelAnalysis.ts", "cast", () =>
    set(Object.values(PURGE_SPELLS_BY_SPEC).flatMap((ids) => [...(ids ?? [])])),
  ),
  // P-P5b = C (2026-10-01): scoped removals — what Shattering Throw and Shiv
  // take off (auras), and the spells themselves (64380 / 233674 appear only
  // as a SPELL_DISPEL source, hence "mixed")
  t("SCOPED_PURGE_REMOVES", "data/scopedPurges.ts", "aura", () => [
    ...SHATTERING_THROW_REMOVES,
    ...SHIV_REMOVES,
  ]),
  t("SCOPED_PURGE_SPELLS", "data/scopedPurges.ts", "mixed", () => [
    SHATTERING_THROW_CAST_ID,
    SHATTERING_THROW_DISPEL_ID,
    SHIV_SPELL_ID,
    DISENTANGLEMENT_EFFECT_ID,
  ]),
  // Dispelling-spell ids of movement/form riders (UI review 2026-08-21 #3;
  // moved here from eval's coverageManifest). "mixed": some (Cat Form) are
  // casts, others (Phantasm) only ever appear as the SPELL_DISPEL source spell.
  t("MOVEMENT_ROOT_BREAK_DISPEL_IDS", "utils/dispelKind.ts", "mixed", () =>
    set(MOVEMENT_ROOT_BREAK_DISPEL_IDS),
  ),
  t("DRUID_FORM_AURA_IDS", "data/druidForms.ts", "aura", () =>
    set(DRUID_FORM_AURA_IDS),
  ),
  t("FORM_BOUND_BUFF_IDS", "data/druidForms.ts", "aura", () =>
    set(FORM_BOUND_BUFF_IDS),
  ),
  t("ZONE_EXTERNAL_RADIUS_YD", "analysis/candidates/death.ts", "cast", () =>
    keys(ZONE_EXTERNAL_RADIUS_YD),
  ),
  t("TEAM_SAVE_CD_IDS", "utils/cooldowns.ts", "cast", () =>
    set(TEAM_SAVE_CD_IDS),
  ),
  t("DEFERRED_DAMAGE_SPELL_IDS", "context/timelineHelpers.ts", "cast", () =>
    set(DEFERRED_DAMAGE_SPELL_IDS),
  ),
  t("REDISTRIBUTION_DAMAGE_IDS", "utils/incomingPressure.ts", "cast", () =>
    set(REDISTRIBUTION_DAMAGE_IDS),
  ),
  t("DEFERRAL_SHIELD_DAMAGE_IDS", "utils/incomingPressure.ts", "aura", () =>
    keys(DEFERRAL_SHIELD_DAMAGE_IDS),
  ),
  t("COMP_DEPENDENT_PURGE_TARGETS", "utils/dispelAnalysis.ts", "aura", () =>
    set(COMP_DEPENDENT_PURGE_TARGETS),
  ),
  // utils/ccTrinketAnalysis.ts
  t("CC_AVOIDANCE_BUFF_SPELLS", "utils/ccTrinketAnalysis.ts", "aura", () =>
    set(CC_AVOIDANCE_BUFF_SPELLS.keys()),
  ),
  t("DRUID_FORM_BUFFS", "utils/ccTrinketAnalysis.ts", "aura", () =>
    set(DRUID_FORM_BUFFS.keys()),
  ),
  t("BREAKABLE_CC_SPELL_IDS", "utils/ccTrinketAnalysis.ts", "aura", () =>
    set(BREAKABLE_CC_SPELL_IDS),
  ),
  t("GROUND_CC_SPELL_IDS", "utils/ccTrinketAnalysis.ts", "cast", () =>
    set(GROUND_CC_SPELL_IDS),
  ),
  t("MAGIC_ONLY_IMMUNITY_IDS", "utils/ccTrinketAnalysis.ts", "aura", () =>
    set(MAGIC_ONLY_IMMUNITY_IDS),
  ),
  t("TARGET_BOUND_MOBILITY_IDS", "utils/ccTrinketAnalysis.ts", "cast", () =>
    set(TARGET_BOUND_MOBILITY_IDS),
  ),
  t(
    "BURST_LEAD_CD_EXCLUDED_IDS",
    "analysis/burstWindowDecisionPoints.ts",
    "cast",
    () => set(BURST_LEAD_CD_EXCLUDED_IDS),
  ),
  t(
    "HEALER_TEAM_BURST_IDS",
    "analysis/candidates/cooldownTiming.ts",
    "cast",
    () => set(HEALER_TEAM_BURST_IDS),
  ),
  // B-tier B15c-U10 (user ruling 2026-10-06): a Holy Paladin's Avenging Wrath
  // does not anchor a kill attempt of its own team.
  t("KILL_ATTEMPT_NON_ANCHOR_CDS", "utils/killAttempts.ts", "cast", () =>
    set([...KILL_ATTEMPT_NON_ANCHOR_CDS.values()].flatMap((s) => [...s])),
  ),
  // B-tier B15a step 2 (user ruling 2026-10-06): self-saves whose aura is a
  // heal absorb on the caster — the press line says what it ate.
  t("HEAL_ABSORB_SELF_SAVE_IDS", "utils/healAbsorbSave.ts", "cast", () =>
    set(HEAL_ABSORB_SELF_SAVE_IDS),
  ),
  // B-tier B20a (user ruling 2026-10-06/07): Touch of Karma's cast / shield
  // id and the id of the damage it sends back — the `| fed by` clause.
  t("TOUCH_OF_KARMA_FEED_IDS", "utils/karmaFeed.ts", "mixed", () =>
    set(TOUCH_OF_KARMA_FEED_IDS),
  ),
  // User ruling 2026-10-07 (B11a's 605 report): spells swung in place of the
  // auto-attack are not a press (`pressBehindDamageOf`).
  t("AUTO_ATTACK_REPLACEMENT_IDS", "utils/damagePress.ts", "cast", () =>
    set(AUTO_ATTACK_REPLACEMENT_IDS),
  ),
  // B-tier B15c-U11 (user ruling 2026-10-06): killing blows the friendly
  // [DEATH] block names as an execute.
  t("EXECUTE_KILLING_BLOW_IDS", "utils/killingBlow.ts", "cast", () =>
    set(EXECUTE_KILLING_BLOW_IDS),
  ),
  t("PHYSICAL_CC_IDS", "utils/ccTrinketAnalysis.ts", "aura", () =>
    set(PHYSICAL_CC_IDS),
  ),
  t("REPOSITIONING_SPELL_IDS", "utils/ccTrinketAnalysis.ts", "cast", () =>
    set(REPOSITIONING_SPELL_IDS.keys()),
  ),
  t("TARGETED_CC_DODGE_SPELLS", "utils/ccTrinketAnalysis.ts", "cast", () =>
    set(TARGETED_CC_DODGE_SPELLS),
  ),
  t("TREMOR_BREAKABLE_CC_IDS", "utils/ccTrinketAnalysis.ts", "aura", () =>
    set(TREMOR_BREAKABLE_CC_IDS),
  ),
  // Triage 2026-09-29 F-K7a: casts that succeed inside a lock on their own
  // school (Demonic Circle: Teleport — FLAG, no DB2 mechanism).
  t("LOCK_IGNORING_CAST_IDS", "utils/ccTrinketAnalysis.ts", "cast", () =>
    set(LOCK_IGNORING_CAST_IDS),
  ),
  // context/
  t("HIGH_VALUE_PURGEABLE_BUFFS", "data/purgeWhitelist.ts", "aura", () =>
    set(HIGH_VALUE_PURGEABLE_BUFFS),
  ),
  t("PURGE_WHITELIST_DATA_BLOCKED", "data/purgeWhitelist.ts", "aura", () =>
    set(PURGE_WHITELIST_DATA_BLOCKED),
  ),
  t("HEALER_CAST_SPELL_ID_TO_NAME", "context/timelineHelpers.ts", "cast", () =>
    keys(HEALER_CAST_SPELL_ID_TO_NAME),
  ),
  t("ENEMY_MAJOR_BUFF_SPELL_IDS", "context/timelineHelpers.ts", "aura", () =>
    keys(ENEMY_MAJOR_BUFF_SPELL_IDS),
  ),
  t("CHANNELED_CD_SPELL_IDS", "context/timelineHelpers.ts", "cast", () =>
    set(CHANNELED_CD_SPELL_IDS),
  ),
  t("NO_FIXED_DURATION_IDS", "utils/buffDuration.ts", "cast", () =>
    set(NO_FIXED_DURATION_IDS),
  ),
  t("SPELL_DURATION_OVERRIDES", "utils/buffDuration.ts", "mixed", () =>
    keys(SPELL_DURATION_OVERRIDES),
  ),
  t("HEALING_AMPLIFIER_SPELL_IDS", "context/timelineHelpers.ts", "aura", () =>
    set(HEALING_AMPLIFIER_SPELL_IDS),
  ),
  t("MANA_COOLDOWN_SPELL_IDS", "context/timelineHelpers.ts", "aura", () =>
    set(MANA_COOLDOWN_SPELL_IDS),
  ),
  t("COPY_CAST_IDS", "utils/castPress.ts", "cast", () => [
    ...COPY_CAST_IDS.keys(),
  ]),
  t("DOT_SPELL_IDS", "context/matchTimelineSections.ts", "aura", () =>
    set(DOT_SPELL_IDS),
  ),
  t("UNUSED_SELF_COVERAGE_UNMODELLED", "utils/counterfactual.ts", "cast", () =>
    set(UNUSED_SELF_COVERAGE_UNMODELLED),
  ),
  // other utils/
  t("TALENT_BEHAVIORS", "utils/talentBehaviors.ts", "mixed", () =>
    TALENT_BEHAVIORS.flatMap((b) => [
      b.talentSpellId,
      b.buffSpellId,
      ...(b.triggerSpellIds ?? []),
      b.conditionAuraId,
      b.abilitySpellId,
    ]),
  ),
  t("OFFENSIVE_PURGE_TALENT_IDS", "utils/talentBehaviors.ts", "talent", () =>
    set(OFFENSIVE_PURGE_TALENT_IDS),
  ),
  t("AOE_CC_SPELL_IDS", "utils/drAnalysis.ts", "cast", () =>
    set(AOE_CC_SPELL_IDS),
  ),
  // Triage G3 (2026-10-02, ruling A10 = both): the one cast id → effect aura
  // table, which absorbed GH #111's hand list `CC_CAST_EFFECT_AURA`. Generated
  // — but from a CORPUS measurement over DB2 nominations, so its pairs are a
  // season's snapshot like a hand list's: registered (ruling A10) so the
  // reverse pass sees a renumbered cast or aura.
  t("castEffectAuraGenerated", "data/castEffectAuras.ts", "mixed", () =>
    castEffectPairs().flatMap(([cast, aura]) => [cast, aura]),
  ),
  t("IMMUNITY_SPELLS", "utils/deathOutcomeAnalysis.ts", "mixed", () =>
    Object.entries(IMMUNITY_SPELLS).flatMap(([k, v]) => [
      k,
      v.lockoutSpellId,
      ...(v.resetSpellIds ?? []),
    ]),
  ),
  t("EXTERNAL_DEFENSIVE_SPELLS", "utils/deathOutcomeAnalysis.ts", "cast", () =>
    keys(EXTERNAL_DEFENSIVE_SPELLS),
  ),
  // CLASS_INTERRUPTS (hand table, class-wide) was replaced 2026-09-12 by the
  // generated data/interruptKitGenerated.json (DB2 SkillLineAbility +
  // SpecializationSpells + talent trees) — its id universe is SPELL_CATEGORIES
  // type "interrupts", already registered above.
  t("ADAPTATION_TRINKET_AURAS", "utils/pvpTrinketUses.ts", "aura", () => [
    ADAPTATION_TRIGGER_AURA_ID,
    ADAPTATION_LOCKOUT_AURA_ID,
  ]),
  t("PVP_TRINKET_SPELL_IDS", "utils/killWindowTargetSelection.ts", "cast", () =>
    set(PVP_TRINKET_SPELL_IDS),
  ),
  t("STASIS_STORABLE_HEAL_IDS", "utils/combatStates.ts", "cast", () =>
    set(STASIS_STORABLE_HEAL_IDS),
  ),
  t("HEALER_AVOIDANCE_SPELLS", "utils/healerExposureAnalysis.ts", "cast", () =>
    Object.values(HEALER_AVOIDANCE_SPELLS).flatMap((arr) =>
      (arr ?? []).map((e) => e.spellId),
    ),
  ),
  t("spellDanger.SPELL_EFFECT_OVERRIDES", "utils/spellDanger.ts", "aura", () =>
    keys(SPELL_DANGER_OVERRIDES),
  ),
  // The canonical offensive-cooldown table (GH #60 tail, unified 2026-09-02).
  // Union of SPELL_CATEGORIES offensive types (aura ids) and classMetadata
  // SpellTag.Offensive (cast ids) minus the corpus-dead exclusions, hence
  // "mixed". Registering the union keeps the rot scans watching the very set
  // consumers key on — the two source tables are registered above, but the
  // dead-id exclusion layer is new hand curation.
  t("OFFENSIVE_CD_SPELL_IDS", "utils/spellDanger.ts", "mixed", () =>
    set(OFFENSIVE_CD_SPELL_IDS),
  ),
  // GH #115 (2026-09-26): activations of an offensive cooldown's EFFECT that
  // arrive under another id (Radiant Glory's Avenging Wrath 454351 → 31884).
  // Both sides are hand-keyed ids a patch can renumber.
  t("OFFENSIVE_EFFECT_ACTIVATION_IDS", "utils/spellDanger.ts", "mixed", () => [
    ...OFFENSIVE_EFFECT_ACTIVATION_IDS.keys(),
    ...OFFENSIVE_EFFECT_ACTIVATION_IDS.values(),
  ]),
  // GH #119 (2026-09-26): offensive effects whose only evidence is an aura —
  // the aura ids, the cooldowns they map to, and every cast id read as
  // evidence (Metamorphosis landing / button, Eye Beam, Doom Winds press,
  // Ascendance). All hand-keyed ids a patch can renumber.
  t(
    "OFFENSIVE_AURA_EVIDENCE",
    "utils/offensiveAuraOccurrences.ts",
    "mixed",
    () => [
      ...OFFENSIVE_AURA_EVIDENCE.keys(),
      ...[...OFFENSIVE_AURA_EVIDENCE.values()].map((v) => v.cooldownId),
      ...METAMORPHOSIS_PRESS_CAST_IDS,
      EYE_BEAM_ID,
      DOOM_WINDS_PRESS_ID,
      ASCENDANCE_ENH_ID,
    ],
  ),
  // CC full-duration predicate (GH #44 tail, 2026-09-02): the corpus-vs-DB2
  // duration corrections and the one aura that lengthens CC in arena. Both are
  // hand-keyed ids a patch can renumber, so both sit under the rot scans.
  t("CORPUS_DURATION_PATCHES", "data/spellEffectOverrides.ts", "aura", () =>
    keys(CORPUS_DURATION_PATCHES),
  ),
  // GH #65 item 1 (2026-09-23): auras priced by their producing cast's
  // parameter, and the casts that carry it.
  t("CAST_PARAM_DURATIONS", "data/castParamDurations.ts", "aura", () =>
    keys(CAST_PARAM_DURATIONS),
  ),
  t("CAST_PARAM_DURATIONS.castIds", "data/castParamDurations.ts", "cast", () =>
    Object.values(CAST_PARAM_DURATIONS).flatMap((c) => c.castIds),
  ),
  // BACKLOG #45 (2026-09-17) / GH #106 (2026-09-24): corpus-corrected arena
  // cooldowns (Pillar of Frost 45 s, Summon Demonic Tyrant 60 s).
  t("CORPUS_COOLDOWN_PATCHES", "data/spellEffectOverrides.ts", "cast", () =>
    keys(CORPUS_COOLDOWN_PATCHES),
  ),
  // GH #106 (2026-09-24): talents whose cooldown row scales with rank — a
  // renumbered talent would silently fall back to the value-once reading.
  t("PER_RANK_COOLDOWN_TALENTS", "utils/talentModifiers.ts", "talent", () => [
    ...PER_RANK_COOLDOWN_TALENTS,
  ]),
  t("RULED_COOLDOWN_VALUES", "utils/talentModifiers.ts", "talent", () =>
    Object.keys(RULED_COOLDOWN_VALUES),
  ),
  // Talent impact audit (2026-09-26): scripted cooldown effects — the talents
  // (vouched by COMBATANT_INFO) and the spells they act on (vouched by casts).
  t("FREE_RECAST_WINDOWS", "data/talentScriptedCooldowns.ts", "mixed", () => [
    ...Object.keys(FREE_RECAST_WINDOWS),
    ...Object.values(FREE_RECAST_WINDOWS).map((w) => w.spellId),
  ]),
  t(
    "EVENT_COOLDOWN_REDUCTIONS",
    "data/talentScriptedCooldowns.ts",
    "mixed",
    () => [
      ...Object.keys(EVENT_COOLDOWN_REDUCTIONS),
      ...Object.values(EVENT_COOLDOWN_REDUCTIONS).flatMap((r) => [
        ...r.targets,
        ...r.triggerCastIds,
      ]),
    ],
  ),
  t("OPPRESSING_ROAR_SPELL_ID", "data/spellEffectData.ts", "aura", () => [
    OPPRESSING_ROAR_SPELL_ID,
  ]),
  // Talent-conditional CC duration modifiers (GH #44 tail, 2026-09-02): the CC
  // aura ids it keys on plus the talent spell ids it gates on — a renumbered
  // talent would silently stop lengthening the CC, so both sets sit under the
  // rot scans ("mixed": aura ids + talent ids).
  t("CC_DURATION_TALENT_MODIFIERS", "data/spellEffectData.ts", "mixed", () => [
    ...keys(CC_DURATION_TALENT_MODIFIERS),
    ...Object.values(CC_DURATION_TALENT_MODIFIERS).flatMap((mods) =>
      mods.map((m) => m.talentSpellId),
    ),
  ]),
  // Same shape as its CC twin above: buff aura ids + the talent spell ids that
  // lengthen them. A renumbered talent id would silently stop lengthening the
  // buff and the expiry line would quietly go back to being wrong, which is
  // exactly what this table was created to fix — so both sets are scanned.
  t(
    "BUFF_DURATION_TALENT_MODIFIERS",
    "data/spellEffectData.ts",
    "mixed",
    () => [
      ...keys(BUFF_DURATION_TALENT_MODIFIERS),
      ...Object.values(BUFF_DURATION_TALENT_MODIFIERS).flatMap((mods) =>
        mods.map((m) => m.talentSpellId),
      ),
    ],
  ),
  // GH #96 M4, user ruling 2026-09-14: healer crisis answers outside the
  // wall / external lists (crisis-no-response "responded").
  t(
    "CRISIS_PROTECTIVE_ANSWER_IDS",
    "analysis/crisisDecisionPoints.ts",
    "cast",
    () => [...CRISIS_PROTECTIVE_ANSWER_IDS],
  ),
  // BACKLOG #43 (2026-09-17): low-HP proc marker auras + the casts they make.
  t("CRISIS_PROC_ANSWERS", "analysis/crisisDecisionPoints.ts", "mixed", () => [
    ...CRISIS_PROC_ANSWERS.keys(),
    ...[...CRISIS_PROC_ANSWERS.values()].flatMap((v) => [...v.triggers]),
  ]),
  t(
    "CRISIS_MOBILITY_PRESS_IDS",
    "analysis/crisisDecisionPoints.ts",
    "cast",
    () => [...CRISIS_MOBILITY_PRESS_IDS],
  ),
  // GH #96 M3b: mitigation aura ids + the talent ids that strengthen them. A
  // talent never "occurs" in a log on its own (passives are not cast), so the
  // talent half shows up as zero-occurrence by construction — the aura half is
  // what rot scanning can check.
  t(
    "TALENT_MITIGATION_MODIFIERS",
    "data/talentMitigationModifiers.ts",
    "mixed",
    () => [
      ...TALENT_MITIGATION_MODIFIERS.map((m) => m.auraSpellId),
      ...TALENT_MITIGATION_MODIFIERS.map((m) => m.talentSpellId),
    ],
  ),
  t("ENEMY_HEAL_CD_IDS", "data/enemyHealCds.ts", "cast", () =>
    set(ENEMY_HEAL_CD_IDS),
  ),
  t("CHANNEL_PROXY_IDS", "data/occupancyAuras.ts", "aura", () =>
    set(CHANNEL_PROXY_IDS),
  ),
  t("DRINK_AURA_IDS", "data/occupancyAuras.ts", "aura", () =>
    set(DRINK_AURA_IDS),
  ),
  // GH #79 / B4: classification overrides for interrupted spells.
  t("KICKED_SPELL_OVERRIDES", "data/kickedSpellCategories.ts", "cast", () => [
    ...KICKED_HEAL_OVERRIDE_IDS,
    ...KICKED_CONTROL_OVERRIDE_IDS,
    ...KICKED_DAMAGE_OVERRIDE_IDS,
    ...KICKED_OTHER_OVERRIDE_IDS,
  ]),
];
