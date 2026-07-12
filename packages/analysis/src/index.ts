// @gladlog/analysis 公共 API。
// 入口形状:legacy(@gladlog/parser-compat);类型设计允许未来原生
// StoredMatch 形状 utils 并存、逐 util 迁移(4a spec debate 让步)。
export * from "./context/buildMatchContext";
export * from "./utils/cooldowns";
export * from "./utils/enemyCompArchetype";
export * from "./utils/enemyCDs";
export * from "./utils/offensiveWindows";
export * from "./utils/drAnalysis";
export * from "./utils/ccTrinketAnalysis";
export * from "./utils/dispelAnalysis";
export * from "./utils/healingGaps";
export * from "./utils/healerOffenseAnalysis";
export * from "./utils/killWindowTargetSelection";
export * from "./utils/dampening";
export { SpellTag } from "./data/spellTypes";
export { zoneMetadata } from "./data/zoneMetadata";
export { classMetadata } from "./data/classSpells";
export { spellClassMap } from "./data/drCategories";
export { SPELL_CATEGORIES } from "./data/spellCategories";
export { SPELL_EFFECT_OVERRIDES } from "./data/spellEffectOverrides";
export { default as spellIdLists } from "./data/spellIdLists";
export { ccSpellIds, trinketSpellIds } from "./data/spellTags";
export { getEnglishSpellName } from "./data/spellEffectData";
export { getTalentNames } from "./data/talentNames";
export { nodeMaps } from "./data/talentStrings";
// 几何原语(positioning grounding 扫描器用,backlog #3)
export {
  getUnitPositionAtTime,
  distanceBetween,
  hasLineOfSight,
  type IPosition,
} from "./utils/losAnalysis";
export { arenaObstacles } from "./data/arenaGeometry";
export {
  computeHealerMetrics,
  computeCDResponseLatency,
} from "./utils/healerMetrics";
export type { IHealerMetrics } from "./utils/healerMetrics";
export { extractRotations } from "./utils/crisisEvents";
export type { IExtractedRotations } from "./utils/crisisEvents";

export * from "./compare/corpusTypes";
export * from "./compare/cellLookup";
export * from "./compare/verifiedComparison";
export * from "./compare/claimChecker";
export * from "./compare/buildExemplarLedPrompt";

