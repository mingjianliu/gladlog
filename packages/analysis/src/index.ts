// @gladlog/analysis 公共 API。
// 入口形状:legacy(@gladlog/parser-compat);类型设计允许未来原生
// StoredMatch 形状 utils 并存、逐 util 迁移(4a spec debate 让步)。
export * from "./context/buildMatchContext";
export * from "./utils/cooldowns";
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
export { ccSpellIds, trinketSpellIds } from './data/spellTags';
export { getEnglishSpellName } from './data/spellEffectData';
