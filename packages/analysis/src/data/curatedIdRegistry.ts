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
import { IMMUNITY_BREAKERS } from "../analysis/candidates/death";
import {
  HIGH_VALUE_PURGEABLE_BUFFS,
  PURGE_WHITELIST_DATA_BLOCKED,
} from "../context/matchTimeline";
import { DOT_SPELL_IDS } from "../context/matchTimelineSections";
import {
  CHANNELED_CD_SPELL_IDS,
  ENEMY_MAJOR_BUFF_SPELL_IDS,
  HEALER_CAST_SPELL_ID_TO_NAME,
  HEALING_AMPLIFIER_SPELL_IDS,
  MANA_COOLDOWN_SPELL_IDS,
  SPELL_DURATION_OVERRIDES,
} from "../context/timelineHelpers";
import { COPY_CAST_IDS } from "../utils/castPress";
import {
  BREAKABLE_CC_SPELL_IDS,
  CC_AVOIDANCE_BUFF_SPELLS,
  DRUID_FORM_BUFFS,
  GROUND_CC_SPELL_IDS,
  MAGIC_ONLY_IMMUNITY_IDS,
  PHYSICAL_CC_IDS,
  REPOSITIONING_SPELL_IDS,
  TARGETED_CC_DODGE_SPELLS,
  TREMOR_BREAKABLE_CC_IDS,
} from "../utils/ccTrinketAnalysis";
import { STASIS_STORABLE_HEAL_IDS } from "../utils/combatStates";
import {
  ADDITIONAL_OVERLAP_DEFENSIVE_IDS,
  AURA_ONLY_ACTIVATION_IDS,
  CD_ROLE_TAGS,
  FORBEARANCE_GATED_IDS,
  NON_SUBSTITUTE_DEFENSIVE_IDS,
  PROC_ONLY_ACTIVATION_IDS,
  SELF_CAST_NOOP_EXTERNAL_IDS,
  SPEC_EXCLUSIVE_SPELLS,
  TEAM_HEAL_CD_IDS,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
  USABLE_WHILE_CC_CONDITIONAL,
  USABLE_WHILE_CC_GAP_IDS,
  USABLE_WHILE_FEARED_GAP_IDS,
} from "../utils/cooldowns";
import {
  EXTERNAL_DEFENSIVE_SPELLS,
  IMMUNITY_SPELLS,
} from "../utils/deathOutcomeAnalysis";
import {
  BACKLASH_CC_SPELL_IDS,
  COMP_DEPENDENT_PURGE_TARGETS,
  DISPEL_COOLDOWNS_BY_SPELL,
  DISPEL_PENALTY_SPELLS,
  PURGE_BLOCKLIST,
  STELLAR_PROTECTION_PENALIZED_SPELLS,
} from "../utils/dispelAnalysis";
import { MOVEMENT_ROOT_BREAK_DISPEL_IDS } from "../utils/dispelKind";
import { AOE_CC_SPELL_IDS } from "../utils/drAnalysis";
import { CLASS_INTERRUPTS } from "../utils/enemyInterrupts";
import { HEALER_AVOIDANCE_SPELLS } from "../utils/healerExposureAnalysis";
import { PVP_TRINKET_SPELL_IDS } from "../utils/killWindowTargetSelection";
import {
  OFFENSIVE_CD_SPELL_IDS,
  SPELL_EFFECT_OVERRIDES as SPELL_DANGER_OVERRIDES,
} from "../utils/spellDanger";
import {
  OFFENSIVE_PURGE_TALENT_IDS,
  TALENT_BEHAVIORS,
} from "../utils/talentBehaviors";
import { KW_MAJOR_DEFENSIVE_IDS } from "./abilityProfile";
import { classMetadata } from "./classSpells";
import { CURATED_ABILITY_FACTS } from "./curatedAbilityFacts";
import { DISPEL_VERDICTS } from "./dispelVerdicts";
import { spellClassMap } from "./drCategories";
import { HEALING_VERDICTS, PROPOSED_HEALING_VERDICTS } from "./healingVerdicts";
import { MITIGATION_OVERRIDES, NO_MITIGATION_IDS } from "./mitigationData";
import { MITIGATION_VERDICTS } from "./mitigationVerdicts";
import {
  RACIAL_ABILITIES,
  SHARED_CD_RACIAL_SPELL_IDS,
} from "./racialAbilities";
import { SPELL_CATEGORIES } from "./spellCategories";
import {
  CC_DURATION_TALENT_MODIFIERS,
  OPPRESSING_ROAR_SPELL_ID,
} from "./spellEffectData";
import {
  CORPUS_DURATION_PATCHES,
  DISPEL_TYPES,
  SPELL_EFFECT_OVERRIDES,
} from "./spellEffectOverrides";
import spellIdLists from "./spellIdLists";
import { trinketSpellIds } from "./spellTags";

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
  // utils/cooldowns.ts
  t("CD_ROLE_TAGS", "utils/cooldowns.ts", "cast", () => keys(CD_ROLE_TAGS)),
  t("TEAM_HEAL_CD_IDS", "utils/cooldowns.ts", "cast", () =>
    set(TEAM_HEAL_CD_IDS),
  ),
  t("ADDITIONAL_OVERLAP_DEFENSIVE_IDS", "utils/cooldowns.ts", "cast", () =>
    set(ADDITIONAL_OVERLAP_DEFENSIVE_IDS),
  ),
  // EMPTY since 2026-09-04 (its three ids are covered by the named bit 378);
  // stays registered and is named in the test's DELIBERATELY_EMPTY list.
  t("USABLE_WHILE_CC_GAP_IDS", "utils/cooldowns.ts", "cast", () =>
    set(USABLE_WHILE_CC_GAP_IDS),
  ),
  t("USABLE_WHILE_FEARED_GAP_IDS", "utils/cooldowns.ts", "cast", () =>
    set(USABLE_WHILE_FEARED_GAP_IDS),
  ),
  t("USABLE_WHILE_CC_CONDITIONAL", "utils/cooldowns.ts", "cast", () =>
    keys(USABLE_WHILE_CC_CONDITIONAL),
  ),
  t("FORBEARANCE_GATED_IDS", "utils/cooldowns.ts", "cast", () =>
    set(FORBEARANCE_GATED_IDS),
  ),
  t("SPEC_EXCLUSIVE_SPELLS", "utils/cooldowns.ts", "cast", () =>
    keys(SPEC_EXCLUSIVE_SPELLS),
  ),
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
  t("BACKLASH_CC_SPELL_IDS", "utils/dispelAnalysis.ts", "aura", () => [
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
  t("PURGE_BLOCKLIST", "utils/dispelAnalysis.ts", "aura", () =>
    set(PURGE_BLOCKLIST),
  ),
  // Dispelling-spell ids of movement/form riders (UI review 2026-08-21 #3;
  // moved here from eval's coverageManifest). "mixed": some (Cat Form) are
  // casts, others (Phantasm) only ever appear as the SPELL_DISPEL source spell.
  t("MOVEMENT_ROOT_BREAK_DISPEL_IDS", "utils/dispelKind.ts", "mixed", () =>
    set(MOVEMENT_ROOT_BREAK_DISPEL_IDS),
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
  t("IMMUNITY_BREAKERS", "analysis/candidates/death.ts", "cast", () =>
    IMMUNITY_BREAKERS.map((b) => b.spellId),
  ),
  t(
    "BURST_LEAD_CD_EXCLUDED_IDS",
    "analysis/burstWindowDecisionPoints.ts",
    "cast",
    () => set(BURST_LEAD_CD_EXCLUDED_IDS),
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
  // context/
  t("HIGH_VALUE_PURGEABLE_BUFFS", "context/matchTimeline.ts", "aura", () =>
    set(HIGH_VALUE_PURGEABLE_BUFFS),
  ),
  t("PURGE_WHITELIST_DATA_BLOCKED", "context/matchTimeline.ts", "aura", () =>
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
  t("SPELL_DURATION_OVERRIDES", "context/timelineHelpers.ts", "mixed", () =>
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
  t("CLASS_INTERRUPTS", "utils/enemyInterrupts.ts", "cast", () =>
    Object.values(CLASS_INTERRUPTS).map((d) => d?.spellId),
  ),
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
  // CC full-duration predicate (GH #44 tail, 2026-09-02): the corpus-vs-DB2
  // duration corrections and the one aura that lengthens CC in arena. Both are
  // hand-keyed ids a patch can renumber, so both sit under the rot scans.
  t("CORPUS_DURATION_PATCHES", "data/spellEffectOverrides.ts", "aura", () =>
    keys(CORPUS_DURATION_PATCHES),
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
];
