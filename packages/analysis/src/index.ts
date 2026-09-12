// @gladlog/analysis public API.
// Entry shape: legacy (@gladlog/parser-compat); the type design allows future
// native StoredMatch-shaped utils to coexist and be migrated one util at a time
// (a concession from the 4a spec debate).
export * from "./context/buildMatchContext";
export { classMetadata } from "./data/classSpells";
export type { CuratedIdKind, CuratedIdTable } from "./data/curatedIdRegistry";
export { CURATED_ID_TABLES } from "./data/curatedIdRegistry";
export { spellClassMap } from "./data/drCategories";
export { analysisDataReady, ensureAnalysisData } from "./data/ensure";
export {
  HEALING_VERDICTS,
  type HealingVerdict,
  healingVerdictDomain,
  healingVerdictOf,
  healingVerdictZh,
} from "./data/healingVerdicts";
export {
  type IMitigationEntry,
  MITIGATION_OVERRIDES,
  MITIGATION_TABLE,
  NO_MITIGATION_IDS,
} from "./data/mitigationData";
export { OBSERVED_SPELL_IDS } from "./data/observedSpellIds";
export { SPEC_ICONS } from "./data/specIconsGenerated";
export { SPELL_CATEGORIES } from "./data/spellCategories";
export { getEnglishSpellName } from "./data/spellEffectData";
export { SPELL_EFFECT_OVERRIDES } from "./data/spellEffectOverrides";
export { SPELL_ICONS_GENERATED } from "./data/spellIconsGenerated";
export { default as spellIdLists } from "./data/spellIdLists";
export { englishNameIndex } from "./data/spellNameLookup";
export { SPELL_NAME_STOPWORDS } from "./data/spellNameStopwords";
export { SPELL_NAMES_ZH_GENERATED } from "./data/spellNamesZh";
export { ccSpellIds, trinketSpellIds } from "./data/spellTags";
export { SpellTag } from "./data/spellTypes";
export { getTalentNames } from "./data/talentNames";
export { nodeMaps } from "./data/talentStrings";
export { zoneMetadata } from "./data/zoneMetadata";
export * from "./utils/auraIntervals";
export * from "./utils/burstLedger";
export * from "./utils/ccBreakAnalysis";
export * from "./utils/ccTrinketAnalysis";
export * from "./utils/cooldowns";
export * from "./utils/counterfactual";
export * from "./utils/dampening";
export * from "./utils/deathOutcomeAnalysis";
export * from "./utils/dispelAnalysis";
export * from "./utils/dispelKind";
export * from "./utils/dpsMetrics";
export * from "./utils/drAnalysis";
export * from "./utils/enemyCDs";
export * from "./utils/enemyCompArchetype";
export * from "./utils/healerExposureAnalysis";
export * from "./utils/healerOffenseAnalysis";
export * from "./utils/healingGaps";
export * from "./utils/incomingPressure";
export * from "./utils/kickAudit";
export * from "./utils/killAttempts";
export * from "./utils/killWindowTargetSelection";
export * from "./utils/offensiveWindows";
export * from "./utils/positionSampling";
export * from "./utils/rawStreams";
export * from "./utils/renderGrid";
export * from "./utils/stats";
export * from "./utils/talentOwnership";
export {
  ensureHeroTalents,
  heroBuildGroupOf,
  heroTreeNames,
} from "./utils/talents";
export * from "./utils/threatAssessment";
// Geometry primitives (used by the positioning grounding scanner, backlog #3)
export * from "./analysis/candidateFindings";
export * from "./analysis/types";
export * from "./compare/buildExemplarLedPrompt";
export * from "./compare/cellLookup";
export * from "./compare/claimChecker";
export * from "./compare/corpusTypes";
export * from "./compare/verifiedComparison";
export { arenaObstacles } from "./data/arenaGeometry";
export type { IExtractedRotations } from "./utils/crisisEvents";
export { extractRotations } from "./utils/crisisEvents";
export type { IHealerMetrics } from "./utils/healerMetrics";
export {
  computeCDResponseLatency,
  computeHealerMetrics,
} from "./utils/healerMetrics";
export {
  distanceBetween,
  getUnitPositionAtTime,
  hasLineOfSight,
  type IPosition,
} from "./utils/losAnalysis";
export * from "./utils/positionAnalysis";
// P1/P2 起爆候选开关(2026-08-15,Task 6 A/B harness):候选类型开关本身没有
// index.ts 导出口(candidateFindings.test.ts 用同包内相对路径直接翻转),但 A/B
// harness 按设计（candidateTypeFlags.ts 头部注释）活在 packages/desktop/scripts
// 下,跨包边界翻转开关只能靠公开导出——这一行就是那个口子，没有派生任何新逻辑。
export * from "./analysis/auditFindings";
export * from "./analysis/buildFindingsPrompt";
export * from "./analysis/causalLint";
export * from "./analysis/deepDive";
export * from "./analysis/findingCategories";
export * from "./analysis/hindsightLint";
export * from "./analysis/parseModelJson";
export * from "./analysis/spellNameZhLint";
export {
  METRIC_LABELS,
  METRIC_LOWER_IS_BETTER,
  metricLabel,
  metricScore,
  VERDICT_LABELS,
  verdictLabel,
} from "./compare/metricLabels";
export { CANDIDATE_TYPE_FLAGS } from "./data/candidateTypeFlags";
// The candidate type registry (GH #76): one table, every liveness consumer
// derives from it — the desktop's mistake-card exemptions included.
export {
  CANDIDATE_TYPE_REGISTRY,
  CANDIDATE_TYPE_STRINGS,
  CARD_TYPES,
  MENU_ONLY_TYPES,
  RETIRED_TYPES,
  type CandidateTypeEntry,
  type CandidateTypeStatus,
  type CandidateTypeSurface,
} from "./data/candidateTypeRegistry";
export { OFF_GCD_SPELL_IDS } from "./data/offGcdGenerated";
// Lane pressure/exposure (backlog #4): the damage-spike threshold shared by
// the prompt and the lanes (single-source, see context/timelineHelpers.ts).
export { DMG_SPIKE_THRESHOLD } from "./context/timelineHelpers";
