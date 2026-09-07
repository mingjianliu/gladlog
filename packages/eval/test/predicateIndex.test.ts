/**
 * Anti-rot test for the predicate index — the executable half of
 * `docs/predicate-index.md`.
 *
 * Why it exists: CLAUDE.md's "the gate predicate IS the spec" rule demands
 * "one fact, one predicate", with the fallback "export the predicate from one
 * place and import it on both sides; when that is impossible, write a unit
 * test asserting equality — don't rely on a comment". The 2026-08-01 lesson
 * was that what was missing wasn't the rule but the INDEX — the same person
 * who had read the rule still hand-copied two predicates in a single day (the
 * "known match" criterion and dateKey formatting). The index doc makes them
 * findable; this test keeps the doc from rotting:
 *
 *  1. every export listed in the doc must actually exist (imported by **file
 *     path**, so a rename/move turns this red);
 *  2. the Chinese and English versions must list the **same** set of
 *     predicates, matching this file's list entry by entry (three-way pinning:
 *     miss any one of them and it fails);
 *  3. pairs that cannot share an export get a direct equality assertion —
 *     exactly CLAUDE.md's fallback;
 *  4. the "analysis produces X, the gate verifies X" inverse relations are run
 *     end to end, each with a negative control so it cannot silently no-op.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import * as burstWindowDecisionPoints from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import * as candidateFindings from "@gladlog/analysis/src/analysis/candidateFindings";
import * as burstWindowResponse from "@gladlog/analysis/src/analysis/candidates/burstWindowResponse";
import * as cooldownTiming from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import * as death from "@gladlog/analysis/src/analysis/candidates/death";
import * as candidatesShared from "@gladlog/analysis/src/analysis/candidates/shared";
import * as cdTriggerPrior from "@gladlog/analysis/src/analysis/cdTriggerPrior";
import * as crisisDecisionPoints from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import * as factFormat from "@gladlog/analysis/src/analysis/factFormat";
import * as findingCategories from "@gladlog/analysis/src/analysis/findingCategories";
import * as hindsightLint from "@gladlog/analysis/src/analysis/hindsightLint";
import * as momentSnapshot from "@gladlog/analysis/src/analysis/momentSnapshot";
import * as buildExemplarLedPrompt from "@gladlog/analysis/src/compare/buildExemplarLedPrompt";
import * as cellLookup from "@gladlog/analysis/src/compare/cellLookup";
import * as claimChecker from "@gladlog/analysis/src/compare/claimChecker";
import * as burstAnswered from "@gladlog/analysis/src/context/burstAnswered";
import * as cdPrior from "@gladlog/analysis/src/context/cdPrior";
import * as matchTimelineSections from "@gladlog/analysis/src/context/matchTimelineSections";
import * as timelineHelpers from "@gladlog/analysis/src/context/timelineHelpers";
import * as abilityProfileMod from "@gladlog/analysis/src/data/abilityProfile";
import * as arenaGeometry from "@gladlog/analysis/src/data/arenaGeometry";
import * as behaviorPrior from "@gladlog/analysis/src/data/behaviorPrior";
import * as burstWindowPrior from "@gladlog/analysis/src/data/burstWindowPrior";
import * as candidateTypeFlags from "@gladlog/analysis/src/data/candidateTypeFlags";
import { CANDIDATE_TYPE_FLAGS } from "@gladlog/analysis/src/data/candidateTypeFlags";
import * as cdTriggerPriorData from "@gladlog/analysis/src/data/cdTriggerPrior";
import { DISPEL_FEATURE_FLAGS } from "@gladlog/analysis/src/data/dispelFeatureFlags";
import * as dispelObservedGenerated from "@gladlog/analysis/src/data/dispelObservedGenerated";
import * as dispelVerdicts from "@gladlog/analysis/src/data/dispelVerdicts";
import * as healerSaveCd from "@gladlog/analysis/src/data/healerSaveCd";
import * as healingVerdicts from "@gladlog/analysis/src/data/healingVerdicts";
import * as outcomeRefs from "@gladlog/analysis/src/data/outcomeRefs";
import * as racialAbilities from "@gladlog/analysis/src/data/racialAbilities";
import * as spellCategories from "@gladlog/analysis/src/data/spellCategories";
import * as spellEffectData from "@gladlog/analysis/src/data/spellEffectData";
import * as spellSchools from "@gladlog/analysis/src/data/spellSchools";
import * as spellTags from "@gladlog/analysis/src/data/spellTags";
import * as spellTargeting from "@gladlog/analysis/src/data/spellTargeting";
import * as syncWindowPrior from "@gladlog/analysis/src/data/syncWindowPrior";
import * as auraIntervals from "@gladlog/analysis/src/utils/auraIntervals";
import * as bracketKey from "@gladlog/analysis/src/utils/bracketKey";
import * as cannotCastIntervals from "@gladlog/analysis/src/utils/cannotCastIntervals";
import * as ccTrinketAnalysis from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import * as cooldowns from "@gladlog/analysis/src/utils/cooldowns";
import * as counterfactual from "@gladlog/analysis/src/utils/counterfactual";
import * as deathOutcomeAnalysis from "@gladlog/analysis/src/utils/deathOutcomeAnalysis";
import * as dispelAnalysis from "@gladlog/analysis/src/utils/dispelAnalysis";
import * as dispelKind from "@gladlog/analysis/src/utils/dispelKind";
import * as dpsMetrics from "@gladlog/analysis/src/utils/dpsMetrics";
import * as drAnalysis from "@gladlog/analysis/src/utils/drAnalysis";
import * as enemyCDs from "@gladlog/analysis/src/utils/enemyCDs";
import { HEALER_OFFENSE_FLAGS } from "@gladlog/analysis/src/utils/healerOffenseAnalysis";
import * as incomingPressure from "@gladlog/analysis/src/utils/incomingPressure";
import * as killWindowFactsMod from "@gladlog/analysis/src/utils/killWindowFacts";
import * as killWindowTargetSelection from "@gladlog/analysis/src/utils/killWindowTargetSelection";
import * as losAnalysis from "@gladlog/analysis/src/utils/losAnalysis";
import * as positionAnalysis from "@gladlog/analysis/src/utils/positionAnalysis";
import * as positionSampling from "@gladlog/analysis/src/utils/positionSampling";
import * as rawStreams from "@gladlog/analysis/src/utils/rawStreams";
import * as renderGrid from "@gladlog/analysis/src/utils/renderGrid";
import * as rootReachability from "@gladlog/analysis/src/utils/rootReachability";
import * as spellDanger from "@gladlog/analysis/src/utils/spellDanger";
import * as stats from "@gladlog/analysis/src/utils/stats";
import * as talentBehaviors from "@gladlog/analysis/src/utils/talentBehaviors";
import * as talentOwnership from "@gladlog/analysis/src/utils/talentOwnership";
import * as talents from "@gladlog/analysis/src/utils/talents";
import * as threatAssessment from "@gladlog/analysis/src/utils/threatAssessment";
import * as trinketCooldown from "@gladlog/analysis/src/utils/trinketCooldown";
import {
  decodeAdvanced as parserDecodeAdvanced,
  parseTimestamp as parserParseTimestamp,
  splitLine as parserSplitLine,
} from "@gladlog/parser";
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import * as pvpMultiplier from "../../analysis/scripts/datagen/lib/pvpMultiplier";
import * as simcHotfix from "../../analysis/scripts/datagen/lib/simcHotfix";
// corpus-tools' package.json has `exports: { "." : ... }`, so deep imports are
// rejected — hence the relative paths. The index table lists FILES, so the test
// must be pinned to those exact files.
import * as archiveLedger from "../../corpus-tools/src/archiveLedger";
import * as archivePlan from "../../corpus-tools/src/archivePlan";
import * as driveSync from "../../corpus-tools/src/driveSync";
import * as ownLogArchive from "../../corpus-tools/src/ownLogArchive";
import * as pvpLogFetch from "../../corpus-tools/src/pvpLogFetch";
import * as obsConfigWriter from "../../desktop/src/main/obsConfigWriter";
import * as dashboard from "../../desktop/src/renderer/src/components/dashboard";
import * as analysisInput from "../../desktop/src/renderer/src/report/derive/analysisInput";
import * as flowSeries from "../../desktop/src/renderer/src/report/derive/flowSeries";
import * as meterRows from "../../desktop/src/renderer/src/report/derive/meterRows";
import * as reportMistakes from "../../desktop/src/renderer/src/report/derive/mistakes";
import * as teamSide from "../../desktop/src/renderer/src/report/derive/teamSide";
import * as reportTimeRange from "../../desktop/src/renderer/src/report/derive/timeRange";
// desktop's package.json also restricts deep imports via `exports`, so this
// goes by relative path too, same as corpus-tools above.
import * as obsAsset from "../../desktop/src/shared/obsAsset";
import * as videoTime from "../../desktop/src/shared/videoTime";
// log-pipeline is deliberately dependency-free (that is what lets it deploy
// standalone on the gaming machine), so corpus-tools cannot import it. The
// naming relation between the two is asserted below instead.
import * as collectLogs from "../../log-pipeline/src/collectLogs";
// Desktop renderer predicates (the "Report UI" section). Relative for a
// different reason than corpus-tools: eval has no dependency on the desktop app
// and should not grow one. Both modules are leaf-safe to import — flowSeries
// pulls only `import type`, timeRange pulls nothing — so listing them here adds
// no runtime weight to the eval suite.
import * as abCompareStats from "../src/ab/abCompareStats";
import * as baselineFindings from "../src/explore/baselineFindings";
import * as matchExplore from "../src/explore/matchExplore";
import * as redactOutcome from "../src/halo/redactOutcome";
import * as checkScoreProvenance from "../src/provenance/checkScoreProvenance";
import * as positioningScan from "../src/quality/positioningScan";
import * as promptQualityCheck from "../src/quality/promptQualityCheck";

type Namespace = Record<string, unknown>;

interface PredicateRow {
  /**
   * File holding the authoritative predicate (repo-relative path); must match
   * the index table's second column character for character.
   */
  file: string;
  /** Export name. */
  symbol: string;
  /** That file's module namespace — existence is checked against it. */
  mod: Namespace;
}

const A = "packages/analysis/src";
const E = "packages/eval/src";
const C = "packages/corpus-tools/src";
const D = "packages/desktop/src/renderer/src/report";
const DS = "packages/desktop/src";

/**
 * Machine-readable copy of the index table. Changing it requires the same
 * change in `docs/predicate-index.md` and `docs/predicate-index.zh-CN.md`, and
 * vice versa — the three-way consistency cases below watch for that.
 */
const INDEX: PredicateRow[] = [
  // Time and the render grid
  { file: `${A}/utils/renderGrid.ts`, symbol: "fmtTime", mod: renderGrid },
  {
    file: `${A}/utils/renderGrid.ts`,
    symbol: "toRenderSecond",
    mod: renderGrid,
  },
  {
    file: `${A}/utils/renderGrid.ts`,
    symbol: "renderedWindowSeconds",
    mod: renderGrid,
  },
  {
    file: `${A}/analysis/factFormat.ts`,
    symbol: "fmtFactTime",
    mod: factFormat,
  },
  {
    file: `${A}/utils/drAnalysis.ts`,
    symbol: "PATCH_121_GOLIVE_EPOCH_MS",
    mod: drAnalysis,
  },
  // Raw log streams (raw.txt line split / timestamp / advanced block, BACKLOG #26 Task 1)
  {
    file: `${A}/utils/rawStreams.ts`,
    symbol: "splitRawLine",
    mod: rawStreams,
  },
  {
    file: `${A}/utils/rawStreams.ts`,
    symbol: "parseRawTimestamp",
    mod: rawStreams,
  },
  {
    file: `${A}/utils/rawStreams.ts`,
    symbol: "mirrorDecodeAdvanced",
    mod: rawStreams,
  },
  { file: `${A}/utils/rawStreams.ts`, symbol: "manaPct", mod: rawStreams },
  {
    file: `${A}/utils/rawStreams.ts`,
    symbol: "roundDurationSOf",
    mod: rawStreams,
  },
  {
    file: `${A}/analysis/candidates/shared.ts`,
    symbol: "filterIntentGuardEvidence",
    mod: candidatesShared,
  },
  // HP sampling
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "HP_SAMPLE_RADIUS_MS",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "getUnitHpAtTimestamp",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "gridHpPct",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "isDeadAtRenderSecond",
    mod: cooldowns,
  },
  // Cooldown availability
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "playerTalentIdSets",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/talentBehaviors.ts`,
    symbol: "getTalentAvoidanceTriggers",
    mod: talentBehaviors,
  },
  { file: `${A}/utils/cooldowns.ts`, symbol: "cdAvailableAt", mod: cooldowns },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "chargesAvailableAt",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "selfCastNoopAnnotatedName",
    mod: cooldowns,
  },
  {
    file: `${A}/data/dispelVerdicts.ts`,
    symbol: "DISPEL_VERDICTS",
    mod: dispelVerdicts,
  },
  {
    file: `${E}/explore/matchExplore.ts`,
    symbol: "remainingCdSeconds",
    mod: matchExplore,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "CD_INSTANT_SLACK_S",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/deathOutcomeAnalysis.ts`,
    symbol: "isAvailableAt",
    mod: deathOutcomeAnalysis,
  },
  {
    file: `${A}/utils/killWindowTargetSelection.ts`,
    symbol: "matchMinHpPct",
    mod: killWindowTargetSelection,
  },
  {
    file: `${A}/utils/killWindowTargetSelection.ts`,
    symbol: "getLowestHpPercentInWindow",
    mod: killWindowTargetSelection,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "USABLE_WHILE_CC_SPELL_IDS",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "usableWhileStunned",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/drAnalysis.ts`,
    symbol: "isStunCcInstance",
    mod: drAnalysis,
  },
  {
    file: `${A}/utils/trinketCooldown.ts`,
    symbol: "HEALER_TRINKET_CD_S",
    mod: trinketCooldown,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "MIN_CD_SECONDS",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/deathOutcomeAnalysis.ts`,
    symbol: "externalReachYards",
    mod: deathOutcomeAnalysis,
  },
  {
    file: `${A}/utils/drAnalysis.ts`,
    symbol: "drCategoryIds",
    mod: drAnalysis,
  },
  {
    file: `${A}/analysis/candidateFindings.ts`,
    symbol: "CD_WASTE_PRESSURE_HP_PCT",
    mod: candidateFindings,
  },
  // Threat / pressure (P2)
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "hasOffensiveSpellActive",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "getPressureThreshold",
    mod: cooldowns,
  },
  {
    file: `${A}/utils/threatAssessment.ts`,
    symbol: "threatActiveAt",
    mod: threatAssessment,
  },
  {
    file: `${A}/utils/threatAssessment.ts`,
    symbol: "matchThreatLevel",
    mod: threatAssessment,
  },
  {
    file: `${A}/analysis/candidates/cooldownTiming.ts`,
    symbol: "enemyHealerCcWindows",
    mod: cooldownTiming,
  },
  {
    file: `${A}/utils/incomingPressure.ts`,
    symbol: "incomingPressureEvents",
    mod: incomingPressure,
  },
  // Talent ownership
  {
    file: `${A}/utils/talentOwnership.ts`,
    symbol: "talentOwnershipOf",
    mod: talentOwnership,
  },
  {
    file: `${A}/data/racialAbilities.ts`,
    symbol: "RACIAL_ABILITIES",
    mod: racialAbilities,
  },
  {
    file: `${A}/data/racialAbilities.ts`,
    symbol: "BREAK_RACIAL_SPELL_IDS",
    mod: racialAbilities,
  },
  {
    file: `${A}/data/racialAbilities.ts`,
    symbol: "OFFENSIVE_RACIAL_SPELL_IDS",
    mod: racialAbilities,
  },
  {
    file: `${A}/data/racialAbilities.ts`,
    symbol: "SHARED_CD_RACIAL_SPELL_IDS",
    mod: racialAbilities,
  },
  {
    file: `${A}/data/racialAbilities.ts`,
    symbol: "TRINKET_RACIAL_SHARED_LOCKOUT_MS",
    mod: racialAbilities,
  },
  // Target selection
  {
    file: `${A}/utils/killWindowTargetSelection.ts`,
    symbol: "analyzeKillWindowTargetSelection",
    mod: killWindowTargetSelection,
  },
  // Position and geometry
  {
    file: `${A}/utils/bracketKey.ts`,
    symbol: "bracketKey",
    mod: bracketKey,
  },
  {
    file: `${A}/data/candidateTypeFlags.ts`,
    symbol: "BRACKET_TYPE_ALLOWLIST",
    mod: candidateTypeFlags,
  },
  {
    file: `${A}/analysis/candidates/death.ts`,
    symbol: "IMMUNITY_BREAKERS",
    mod: death,
  },
  {
    file: `${A}/analysis/candidateFindings.ts`,
    symbol: "candidateTypeOfId",
    mod: candidateFindings,
  },
  {
    file: `${A}/utils/positionAnalysis.ts`,
    symbol: "CLOSE_RANGE_YARDS",
    mod: positionAnalysis,
  },
  {
    file: `${A}/utils/positionAnalysis.ts`,
    symbol: "isDeadAt",
    mod: positionAnalysis,
  },
  {
    file: `${A}/utils/rootReachability.ts`,
    symbol: "ROOT_SPELL_IDS",
    mod: rootReachability,
  },
  {
    file: `${A}/utils/rootReachability.ts`,
    symbol: "ROOT_UNREACHABLE_MIN_S",
    mod: rootReachability,
  },
  {
    file: `${A}/utils/rootReachability.ts`,
    symbol: "canReachTargetAt",
    mod: rootReachability,
  },
  {
    file: `${A}/utils/positionSampling.ts`,
    symbol: "LOS_SWEEP_SLACK_S",
    mod: positionSampling,
  },
  {
    file: `${A}/utils/positionSampling.ts`,
    symbol: "LOS_SWEEP_GAP_MS",
    mod: positionSampling,
  },
  {
    file: `${A}/utils/positionSampling.ts`,
    symbol: "INTERP_MAX_GAP_MS",
    mod: positionSampling,
  },
  {
    file: `${A}/utils/positionSampling.ts`,
    symbol: "positionSampleInstants",
    mod: positionSampling,
  },
  {
    file: `${A}/utils/positionSampling.ts`,
    symbol: "CC_MAX_CAST_RANGE_YARDS",
    mod: positionSampling,
  },
  {
    file: `${A}/utils/positionSampling.ts`,
    symbol: "CC_MAX_PLAUSIBLE_RANGE_YARDS",
    mod: positionSampling,
  },
  {
    file: `${A}/utils/positionSampling.ts`,
    symbol: "DISPEL_MAX_RANGE_YARDS",
    mod: positionSampling,
  },
  {
    file: `${A}/data/spellEffectData.ts`,
    symbol: "kickLockoutSeconds",
    mod: spellEffectData,
  },
  {
    file: `${A}/utils/ccTrinketAnalysis.ts`,
    symbol: "CAST_START_LOOKBACK_S",
    mod: ccTrinketAnalysis,
  },
  {
    file: `${A}/data/spellEffectData.ts`,
    symbol: "ccFullDurationSeconds",
    mod: spellEffectData,
  },
  {
    file: "packages/analysis/scripts/datagen/lib/pvpMultiplier.ts",
    symbol: "pvpBasePoints",
    mod: pvpMultiplier,
  },
  {
    file: "packages/analysis/scripts/datagen/lib/simcHotfix.ts",
    symbol: "applyHotfixOverlay",
    mod: simcHotfix,
  },
  {
    file: `${A}/utils/dispelAnalysis.ts`,
    symbol: "DR_CHAIN_LOOKAHEAD_S",
    mod: dispelAnalysis,
  },
  {
    file: `${A}/utils/positionSampling.ts`,
    symbol: "HEALER_TRAINED_YARDS",
    mod: positionSampling,
  },
  {
    file: `${A}/utils/losAnalysis.ts`,
    symbol: "getUnitPositionAtTime",
    mod: losAnalysis,
  },
  {
    file: `${A}/utils/losAnalysis.ts`,
    symbol: "getUnitRawPositionAtTime",
    mod: losAnalysis,
  },
  {
    file: `${A}/utils/losAnalysis.ts`,
    symbol: "distanceBetween",
    mod: losAnalysis,
  },
  {
    file: `${A}/utils/losAnalysis.ts`,
    symbol: "hasLineOfSight",
    mod: losAnalysis,
  },
  {
    file: `${A}/data/arenaGeometry.ts`,
    symbol: "arenaObstacles",
    mod: arenaGeometry,
  },
  {
    file: `${A}/utils/positionAnalysis.ts`,
    symbol: "POSITION_MISTAKES",
    mod: positionAnalysis,
  },
  {
    file: `${A}/utils/positionAnalysis.ts`,
    symbol: "stayedInHadRealCost",
    mod: positionAnalysis,
  },
  // Order statistics
  { file: `${A}/utils/stats.ts`, symbol: "toSortedFinite", mod: stats },
  { file: `${A}/utils/stats.ts`, symbol: "medianFinite", mod: stats },
  // Thresholds
  {
    file: `${A}/context/timelineHelpers.ts`,
    symbol: "DMG_SPIKE_THRESHOLD",
    mod: timelineHelpers,
  },
  {
    file: `${A}/utils/counterfactual.ts`,
    symbol: "COUNTERFACTUAL_WINDOW_S",
    mod: counterfactual,
  },
  {
    file: `${A}/utils/counterfactual.ts`,
    symbol: "DECISIVE_MARGIN_PCT",
    mod: counterfactual,
  },
  {
    file: `${A}/utils/counterfactual.ts`,
    symbol: "whitelistedIntervalsInDeathWindow",
    mod: counterfactual,
  },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "PRE_WALL_SECONDS",
    mod: cooldowns,
  },
  // Classification and name tables
  { file: `${A}/utils/cooldowns.ts`, symbol: "specToString", mod: cooldowns },
  {
    file: `${A}/utils/cooldowns.ts`,
    symbol: "canHelpAnotherUnit",
    mod: cooldowns,
  },
  {
    file: `${A}/data/spellTargeting.ts`,
    symbol: "reachesAlly",
    mod: spellTargeting,
  },
  {
    file: `${A}/data/spellSchools.ts`,
    symbol: "immunityCoversSpell",
    mod: spellSchools,
  },
  {
    file: `${A}/data/healingVerdicts.ts`,
    symbol: "healingVerdictOf",
    mod: healingVerdicts,
  },
  {
    file: `${A}/context/matchTimelineSections.ts`,
    symbol: "emitDmgSpikeEntries",
    mod: matchTimelineSections,
  },
  { file: `${A}/utils/cooldowns.ts`, symbol: "isHealerSpec", mod: cooldowns },
  { file: `${A}/utils/cooldowns.ts`, symbol: "isMeleeSpec", mod: cooldowns },
  {
    file: `${A}/utils/dispelAnalysis.ts`,
    symbol: "canDefensiveCleanse",
    mod: dispelAnalysis,
  },
  {
    file: `${A}/utils/dispelKind.ts`,
    symbol: "classifyDispel",
    mod: dispelKind,
  },
  {
    file: `${A}/utils/dispelKind.ts`,
    symbol: "MOVEMENT_ROOT_BREAK_DISPEL_IDS",
    mod: dispelKind,
  },
  {
    file: `${A}/data/dispelObservedGenerated.ts`,
    symbol: "CORPUS_OBSERVED_DISPEL_IDS",
    mod: dispelObservedGenerated,
  },
  {
    file: `${A}/compare/cellLookup.ts`,
    symbol: "REFERENCE_CELL_N_FLOOR",
    mod: cellLookup,
  },
  {
    file: `${A}/utils/talents.ts`,
    symbol: "heroTreeNames",
    mod: talents,
  },
  {
    file: `${A}/analysis/candidateFindings.ts`,
    symbol: "LEGACY_TOPIC_TYPES",
    mod: candidateFindings,
  },
  { file: `${A}/data/spellTags.ts`, symbol: "ccSpellIds", mod: spellTags },
  { file: `${A}/data/spellTags.ts`, symbol: "trinketSpellIds", mod: spellTags },
  {
    file: `${A}/data/spellEffectData.ts`,
    symbol: "getEnglishSpellName",
    mod: spellEffectData,
  },
  {
    file: `${A}/data/spellCategories.ts`,
    symbol: "isCastBlockingAuraType",
    mod: spellCategories,
  },
  {
    file: `${A}/utils/cannotCastIntervals.ts`,
    symbol: "buildCannotCastIntervals",
    mod: cannotCastIntervals,
  },
  {
    file: `${A}/analysis/findingCategories.ts`,
    symbol: "FINDING_CATEGORIES",
    mod: findingCategories,
  },
  {
    file: `${A}/analysis/findingCategories.ts`,
    symbol: "normalizeFindingCategory",
    mod: findingCategories,
  },
  {
    file: `${A}/utils/dpsMetrics.ts`,
    symbol: "isBurstConverted",
    mod: dpsMetrics,
  },
  {
    file: `${A}/analysis/crisisDecisionPoints.ts`,
    symbol: "crisisDecisionPoints",
    mod: crisisDecisionPoints,
  },
  {
    file: `${A}/analysis/crisisDecisionPoints.ts`,
    symbol: "CRISIS_HP_PCT",
    mod: crisisDecisionPoints,
  },
  {
    file: `${A}/data/behaviorPrior.ts`,
    symbol: "lookupBehaviorPrior",
    mod: behaviorPrior,
  },
  {
    file: `${A}/data/behaviorPrior.ts`,
    symbol: "BEHAVIOR_PRIOR_N_FLOOR",
    mod: behaviorPrior,
  },
  {
    file: `${A}/data/syncWindowPrior.ts`,
    symbol: "lookupSyncWindowPrior",
    mod: syncWindowPrior,
  },
  {
    file: `${A}/data/abilityProfile.ts`,
    symbol: "isKillWindowMajorDefensive",
    mod: abilityProfileMod,
  },
  {
    file: `${A}/utils/killWindowFacts.ts`,
    symbol: "createKillWindowFactsComputer",
    mod: killWindowFactsMod,
  },
  {
    file: `${A}/data/outcomeRefs.ts`,
    symbol: "ATTEMPT_INTO_TRINKET_OUTCOME_REF",
    mod: outcomeRefs,
  },
  {
    file: `${A}/analysis/burstWindowDecisionPoints.ts`,
    symbol: "burstWindowDecisionPoints",
    mod: burstWindowDecisionPoints,
  },
  {
    file: `${A}/data/burstWindowPrior.ts`,
    symbol: "lookupBurstWindowPrior",
    mod: burstWindowPrior,
  },
  {
    file: `${A}/data/burstWindowPrior.ts`,
    symbol: "BURST_WINDOW_PRIOR_N_FLOOR",
    mod: burstWindowPrior,
  },
  {
    file: `${A}/analysis/crisisDecisionPoints.ts`,
    symbol: "kitedAway",
    mod: crisisDecisionPoints,
  },
  {
    file: `${A}/analysis/crisisDecisionPoints.ts`,
    symbol: "KITE_GAIN_YARDS",
    mod: crisisDecisionPoints,
  },
  {
    file: `${A}/utils/enemyCDs.ts`,
    symbol: "SOLO_WINDOW_MIN_WEIGHT",
    mod: enemyCDs,
  },
  {
    file: `${A}/analysis/candidates/burstWindowResponse.ts`,
    symbol: "burstWindowResponseEvents",
    mod: burstWindowResponse,
  },
  {
    file: `${A}/analysis/burstWindowDecisionPoints.ts`,
    symbol: "isBurstWindowOffensiveCd",
    mod: burstWindowDecisionPoints,
  },
  {
    file: `${A}/utils/spellDanger.ts`,
    symbol: "OFFENSIVE_CD_SPELL_IDS",
    mod: spellDanger,
  },
  {
    file: `${A}/analysis/burstWindowDecisionPoints.ts`,
    symbol: "BURST_LEAD_CD_EXCLUDED_IDS",
    mod: burstWindowDecisionPoints,
  },
  {
    file: `${A}/analysis/crisisDecisionPoints.ts`,
    symbol: "CRISIS_HP_PCT_RENDERED",
    mod: crisisDecisionPoints,
  },
  {
    file: `${A}/data/burstWindowPrior.ts`,
    symbol: "burstRefClearsMinContrast",
    mod: burstWindowPrior,
  },
  {
    file: `${A}/data/burstWindowPrior.ts`,
    symbol: "BURST_REF_MIN_CONTRAST_PP",
    mod: burstWindowPrior,
  },
  {
    file: `${A}/analysis/burstWindowDecisionPoints.ts`,
    symbol: "BURST_TRIAGE_MIN_HP_DROP_PP",
    mod: burstWindowDecisionPoints,
  },
  {
    file: `${A}/context/burstAnswered.ts`,
    symbol: "formatBurstAnsweredLines",
    mod: burstAnswered,
  },
  {
    file: `${A}/context/burstAnswered.ts`,
    symbol: "BURST_ANSWERED_CAP",
    mod: burstAnswered,
  },
  {
    file: `${A}/context/burstAnswered.ts`,
    symbol: "BURST_ANSWERED_MAX_HP_PCT",
    mod: burstAnswered,
  },
  // Healer save-cooldown roster (2026-09-04, GH #63)
  {
    file: `${A}/data/healerSaveCd.ts`,
    symbol: "healerSaveCdRoster",
    mod: healerSaveCd,
  },
  // [CD PRIOR] cohort context fact (2026-09-04, GH #54 (f))
  {
    file: `${A}/analysis/candidates/cooldownTiming.ts`,
    symbol: "isSpendableDefensiveCd",
    mod: cooldownTiming,
  },
  {
    file: `${A}/data/cdTriggerPrior.ts`,
    symbol: "lookupCdTriggerPrior",
    mod: cdTriggerPriorData,
  },
  {
    file: `${A}/data/cdTriggerPrior.ts`,
    symbol: "CD_TRIGGER_PRIOR_N_FLOOR",
    mod: cdTriggerPriorData,
  },
  {
    file: `${A}/analysis/cdTriggerPrior.ts`,
    symbol: "cdTriggerObservations",
    mod: cdTriggerPrior,
  },
  {
    file: `${A}/analysis/cdTriggerPrior.ts`,
    symbol: "cdPriorHoldEpisodes",
    mod: cdTriggerPrior,
  },
  {
    file: `${A}/analysis/cdTriggerPrior.ts`,
    symbol: "lowestFriendlyGridHp",
    mod: cdTriggerPrior,
  },
  {
    file: `${A}/analysis/cdTriggerPrior.ts`,
    symbol: "CD_PRIOR_MIN_PERSIST_S",
    mod: cdTriggerPrior,
  },
  {
    file: `${A}/context/cdPrior.ts`,
    symbol: "formatCdPriorLines",
    mod: cdPrior,
  },
  {
    file: `${A}/context/cdPrior.ts`,
    symbol: "CD_PRIOR_CAP",
    mod: cdPrior,
  },
  // Formatting and notation
  {
    file: `${A}/compare/claimChecker.ts`,
    symbol: "PLACEHOLDER",
    mod: claimChecker,
  },
  {
    file: `${A}/compare/buildExemplarLedPrompt.ts`,
    symbol: "COMPARE_PROMPT_VERSION",
    mod: buildExemplarLedPrompt,
  },
  {
    file: `${A}/analysis/factFormat.ts`,
    symbol: "fmtFactNum",
    mod: factFormat,
  },
  // Moment snapshot (deep dive, SDD 2026-08-05 Task 1/2/3)
  {
    file: `${A}/utils/auraIntervals.ts`,
    symbol: "buildAuraIntervals",
    mod: auraIntervals,
  },
  {
    file: `${A}/analysis/momentSnapshot.ts`,
    symbol: "aurasActiveAt",
    mod: momentSnapshot,
  },
  {
    file: `${A}/analysis/momentSnapshot.ts`,
    symbol: "largestCastGap",
    mod: momentSnapshot,
  },
  {
    file: `${A}/analysis/momentSnapshot.ts`,
    symbol: "ACTIVITY_GAP_MIN_S",
    mod: momentSnapshot,
  },
  // Gate side
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "checkPercentileMonotonicity",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "checkSameSecondHpConsistency",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "checkCrisisHpStateConsistency",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "checkBurstWindowRefConsistency",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "checkCdPriorRefConsistency",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "checkWindowSpanConsistency",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "checkCooldownLedgerConsistency",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "checkSnapshotFactsConsistency",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/promptQualityCheck.ts`,
    symbol: "DEATH_KEYWORDS",
    mod: promptQualityCheck,
  },
  {
    file: `${E}/quality/positioningScan.ts`,
    symbol: "extractGeoClaims",
    mod: positioningScan,
  },
  {
    file: `${E}/quality/positioningScan.ts`,
    symbol: "checkGeoClaims",
    mod: positioningScan,
  },
  // Hindsight bias (SDD 2026-08-06-hindsight-predicate). hindsightLint.ts
  // lives under packages/analysis, but the row sits in "Gate side" because
  // its only non-product consumer is hindsightScan.ts, an eval corpus tool.
  {
    file: `${A}/analysis/hindsightLint.ts`,
    symbol: "hindsightViolations",
    mod: hindsightLint,
  },
  {
    file: `${A}/analysis/hindsightLint.ts`,
    symbol: "HINDSIGHT_CLUSTER_SLACK_S",
    mod: hindsightLint,
  },
  {
    file: `${E}/provenance/checkScoreProvenance.ts`,
    symbol: "FACT_AUDIT_MIN",
    mod: checkScoreProvenance,
  },
  {
    file: `${E}/provenance/checkScoreProvenance.ts`,
    symbol: "FACT_AUDIT_MAX",
    mod: checkScoreProvenance,
  },
  {
    file: `${E}/provenance/checkScoreProvenance.ts`,
    symbol: "computeAccuracyFromFactAudit",
    mod: checkScoreProvenance,
  },
  { file: `${E}/ab/abCompareStats.ts`, symbol: "makeRng", mod: abCompareStats },
  {
    file: `${E}/halo/redactOutcome.ts`,
    symbol: "RESULT_LABEL_RE",
    mod: redactOutcome,
  },
  // Baseline review-card evidence line: renderer + parser pair (GH #18);
  // their inverse relation is pinned by explore.answersAlignment.test.ts.
  {
    file: `${E}/explore/baselineFindings.ts`,
    symbol: "candidateEvidence",
    mod: baselineFindings,
  },
  {
    file: `${E}/explore/baselineFindings.ts`,
    symbol: "parseCandidateEvidenceLine",
    mod: baselineFindings,
  },
  // Corpus archiving
  { file: `${C}/archiveLedger.ts`, symbol: "dateKeyOf", mod: archiveLedger },
  {
    file: `${C}/archiveLedger.ts`,
    symbol: "LEDGER_WINDOW_DAYS",
    mod: archiveLedger,
  },
  { file: `${C}/archivePlan.ts`, symbol: "matchDateKey", mod: archivePlan },
  { file: `${C}/archivePlan.ts`, symbol: "isDateKeyDir", mod: archivePlan },
  { file: `${C}/archivePlan.ts`, symbol: "isKnownStub", mod: archivePlan },
  { file: `${C}/archivePlan.ts`, symbol: "shouldArchive", mod: archivePlan },
  {
    file: `${C}/archivePlan.ts`,
    symbol: "shouldStopScanning",
    mod: archivePlan,
  },
  {
    file: `${C}/archivePlan.ts`,
    symbol: "checkArchivePayload",
    mod: archivePlan,
  },
  {
    file: `${C}/pvpLogFetch.ts`,
    symbol: "checkRawPayloadBytes",
    mod: pvpLogFetch,
  },
  {
    file: `${C}/pvpLogFetch.ts`,
    symbol: "checkDecompressedPayload",
    mod: pvpLogFetch,
  },
  { file: `${C}/driveSync.ts`, symbol: "buildRcloneCopyArgs", mod: driveSync },
  { file: `${C}/ownLogArchive.ts`, symbol: "isOwnLogName", mod: ownLogArchive },
  {
    file: `${C}/ownLogArchive.ts`,
    symbol: "selectOwnLogsToArchive",
    mod: ownLogArchive,
  },
  // Recording playback and managed OBS (packages/desktop)
  { file: `${DS}/shared/obsAsset.ts`, symbol: "OBS_VERSION", mod: obsAsset },
  { file: `${DS}/shared/obsAsset.ts`, symbol: "OBS_ZIP_URL", mod: obsAsset },
  {
    file: `${DS}/shared/obsAsset.ts`,
    symbol: "OBS_ZIP_SHA256",
    mod: obsAsset,
  },
  { file: `${DS}/shared/obsAsset.ts`, symbol: "OBS_ZIP_BYTES", mod: obsAsset },
  {
    file: `${DS}/shared/obsAsset.ts`,
    symbol: "MANAGED_WS_PORT",
    mod: obsAsset,
  },
  { file: `${DS}/shared/obsAsset.ts`, symbol: "shouldExtract", mod: obsAsset },
  {
    file: `${DS}/shared/obsAsset.ts`,
    symbol: "PINNED_ENCODER",
    mod: obsAsset,
  },
  {
    file: `${DS}/main/obsConfigWriter.ts`,
    symbol: "MANAGED_CANVAS",
    mod: obsConfigWriter,
  },
  {
    file: `${DS}/shared/videoTime.ts`,
    symbol: "computeVideoWindow",
    mod: videoTime,
  },
  {
    file: `${DS}/shared/videoTime.ts`,
    symbol: "toBattleSeconds",
    mod: videoTime,
  },
  {
    file: `${DS}/shared/videoTime.ts`,
    symbol: "toVideoSeconds",
    mod: videoTime,
  },
  { file: `${DS}/shared/videoTime.ts`, symbol: "seekTargetS", mod: videoTime },
  // Report UI (desktop renderer) — two consumers inside one screen rather than
  // an analysis/gate pair; see the doc's Scope note.
  {
    file: `${D}/derive/flowSeries.ts`,
    symbol: "forEachContribution",
    mod: flowSeries,
  },
  { file: `${D}/derive/flowSeries.ts`, symbol: "petsOf", mod: flowSeries },
  {
    file: `${D}/derive/flowSeries.ts`,
    symbol: "METRIC_BASES",
    mod: flowSeries,
  },
  {
    file: `${D}/derive/timeRange.ts`,
    symbol: "msInRange",
    mod: reportTimeRange,
  },
  { file: `${D}/derive/teamSide.ts`, symbol: "sideOfUnit", mod: teamSide },
  { file: `${D}/derive/meterRows.ts`, symbol: "meterGroups", mod: meterRows },
  {
    file: `${D}/derive/analysisInput.ts`,
    symbol: "resolveOwner",
    mod: analysisInput,
  },
  {
    file: `${D}/derive/mistakes.ts`,
    symbol: "rankMistakeMoments",
    mod: reportMistakes,
  },
  // Dashboard lives outside report/ — spelled out so it matches the doc column
  {
    file: "packages/desktop/src/renderer/src/components/dashboard.ts",
    symbol: "rateDisplay",
    mod: dashboard,
  },
];

const rowKey = (r: { file: string; symbol: string }): string =>
  `${r.file} → ${r.symbol}`;

const REPO_ROOT = join(__dirname, "../../..");
const readRepo = (p: string): string =>
  readFileSync(join(REPO_ROOT, p), "utf8");

/** All .ts sources under packages/eval (repo-relative, test fixtures excluded). */
function evalSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const ent of readdirSync(join(REPO_ROOT, rel), {
      withFileTypes: true,
    })) {
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules") walk(child);
      } else if (ent.name.endsWith(".ts")) {
        out.push(child);
      }
    }
  };
  walk("packages/eval/src");
  walk("packages/eval/scripts");
  return out.sort();
}

// ---------------------------------------------------------------------------
// HEALER_TRAINED fixture: the producer side (whole-second grid +
// INTERP_MAX_GAP_MS) and the gate side (whole seconds + real sample instants +
// sub-second grid + LOS_SWEEP_GAP_MS) are deliberately parameterized
// DIFFERENTLY.
//
// Conclusion (do not try to "unify" them again): the gate's instant set is a
// **strict superset** of the producer's and its gap is looser, while
// getUnitPositionAtTime's gap only accepts/rejects and never changes the
// interpolated value — so gateMin <= producerMin always holds, and the gate's
// one-sided criterion (it only punishes "claimed closer than observed") is not
// papering over the difference but the correct expression of that directional
// relation. Making the producer adopt the gate's 3000ms gap would be wrong:
// INTERP_MAX_GAP_MS is the T3 grounding guard, and loosening it would revive
// mid-segment interpolation across sampling blackouts.
// The fixture pins that directional relation executably: 7.5yd on every whole
// second, dipping to 6.0yd on half seconds (visible to the gate only).
// ---------------------------------------------------------------------------

const FIXTURE_START_MS = 1_000_000;
const FIXTURE_END_MS = FIXTURE_START_MS + 60_000;

function fixtureUnit(
  id: string,
  name: string,
  spec: CombatUnitSpec,
  xAt: (seconds: number) => number,
): any {
  const advancedActions = [];
  for (let ms = 0; ms <= 60_000; ms += 500) {
    advancedActions.push({
      timestamp: FIXTURE_START_MS + ms,
      advanced: true,
      advancedActorCurrentHp: 100,
      advancedActorMaxHp: 100,
      advancedActorPositionX: xAt(ms / 1000),
      advancedActorPositionY: 0,
      advancedActorPowers: [],
    });
  }
  return { id, name, spec, advancedActions, deathRecords: [] };
}

const trainedHealer = (): any =>
  fixtureUnit("1", "Healer-Realm-US", CombatUnitSpec.Paladin_Holy, () => 0);

const trainedEnemy = (): any =>
  fixtureUnit("2", "Trainer-Realm-US", CombatUnitSpec.Warrior_Arms, (t) => {
    if (t >= 40 && t <= 50) return 1; // genuinely camped segment
    if (t < 10 || t > 30) return 40; // not camping
    return Number.isInteger(t) ? 7.5 : 6; // 7.5 on whole seconds, 6.0 on halves
  });

/**
 * Producer side runs the real computeOwnerPositionEvents, then renders prompt
 * lines through the real formatter.
 */
function healerTrainedFixture(): { lines: string[] } {
  const healer = trainedHealer();
  const events = positionAnalysis.computeOwnerPositionEvents({
    owner: healer,
    friends: [healer],
    enemies: [trainedEnemy()],
    combat: { startTime: FIXTURE_START_MS, endTime: FIXTURE_END_MS },
    burstWindows: [],
    ownerCooldowns: [],
    isHealer: true,
    ownerIsMelee: false,
  });
  expect(events.filter((e) => e.type === "HEALER_TRAINED")).toHaveLength(2);
  return { lines: positionAnalysis.formatPositionEventsForContext(events) };
}

function trainedCtx(): any {
  const healer = trainedHealer();
  return {
    owner: healer,
    friends: [healer],
    enemies: [trainedEnemy()],
    zoneId: "1505",
    matchStartMs: FIXTURE_START_MS,
    unitIdMap: new Map<number, string>(),
  };
}

const BEGIN = "<!-- predicate-index:begin -->";
const END = "<!-- predicate-index:end -->";
/**
 * Shape of an index-table cell: `path` → `symbol`. Prose outside the table
 * never participates in matching.
 */
const CELL = /`(packages\/[^`]+\.ts)`\s*→\s*`([A-Za-z_$][\w$]*)`/g;

function docRowKeys(docPath: string): string[] {
  const doc = readRepo(docPath);
  const from = doc.indexOf(BEGIN);
  const to = doc.indexOf(END);
  if (from < 0 || to < 0 || to <= from) {
    throw new Error(`${docPath} 缺少 predicate-index 标记对`);
  }
  const body = doc.slice(from + BEGIN.length, to);
  return [...body.matchAll(CELL)].map((m) => `${m[1]} → ${m[2]}`);
}

// 官方技能事实(targeting / schools / abilityEffects)自 2026-08-22 起动态载入
// (见 spellTargetingGenerated.ts 头部:静态 import 会把 230 kB 压进 renderer 主
// chunk)。谓词在数据到位前按空表回答,所以任何**断言这些谓词具体取值**的地方都
// 必须先 await 聚合入口 —— 不 await 也可能碰巧过(微任务先解决),那是时序侥幸。
beforeAll(async () => {
  await ensureAnalysisData();
});

describe("谓词索引:表里的每个 export 都还在", () => {
  it.each(INDEX.map((r) => [rowKey(r), r] as [string, PredicateRow]))(
    "%s",
    (_key, row) => {
      // Looked up by file path: if a symbol moves to another file the index
      // points at the wrong place, and this must go red.
      expect(Object.keys(row.mod)).toContain(row.symbol);
      expect(row.mod[row.symbol]).toBeDefined();
    },
  );
});

describe("谓词索引:文档与测试三方一致", () => {
  const EN = "docs/predicate-index.md";
  const ZH = "docs/predicate-index.zh-CN.md";

  it("英文版没有重复行", () => {
    const keys = docRowKeys(EN);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it("中英两版列出同一批谓词,顺序也相同", () => {
    // Order is pinned too: the two versions' section structure must be
    // equivalent, otherwise "equivalent content" is just a slogan.
    expect(docRowKeys(ZH)).toEqual(docRowKeys(EN));
  });

  it("文档列出的谓词与本测试的清单逐条相同", () => {
    expect(docRowKeys(EN).sort()).toEqual(INDEX.map(rowKey).sort());
  });
});

// rawStreams.ts (BACKLOG #26 Task 1) parity fixtures: real raw.txt lines
// copied verbatim from match 60ab1e8f (2026-08-15 anchor investigation) —
// mixed event types (CAST_SUCCESS/PERIODIC_HEAL/AURA_REMOVED/UNIT_DIED/
// ARENA_MATCH_START/END/CAST_FAILED), including one dual-power ("9|0"
// pipe-joined) line and the exact line whose mana reading (545/273000)
// anchors the task report's acceptance numbers.
const RAW_STREAMS_REAL_LINES = [
  '7/19/2026 04:10:47.008-4  SPELL_CAST_SUCCESS,Player-11-0E9D0711,"Playdates-Tichondrius-US",0x548,0x80000000,0000000000000000,nil,0x80000000,0x80000000,6673,"战斗怒吼",0x1,Player-11-0E9D0711,0000000000000000,620700,620700,3320,476,1520,2935,0,0,1,0,1050,0,1295.13,1586.44,0,1.7453,298',
  '7/19/2026 04:10:47.593-4  SPELL_CAST_SUCCESS,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x511,0x80000000,Player-11-0EAEB10E,"Bigbacktotem-Tichondrius-US",0x10512,0x80000000,20473,"神圣震击",0x2,Player-57-0E0CB0B6,0000000000000000,612340,612340,3012,2896,2605,2385,0,0,0,273000,273000,5600,1278.80,1721.48,0,4.8195,298',
  '7/19/2026 04:19:05.269-4  SPELL_CAST_SUCCESS,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x10511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,415388,"回收复用",0x2,Player-57-0E0CB0B6,0000000000000000,383863,612340,3094,2975,3126,2385,0,0,0,545,273000,0,1262.06,1652.99,0,1.7406,298',
  '7/19/2026 04:19:15.083-4  SPELL_PERIODIC_HEAL,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x10511,0x80000000,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x10511,0x80000000,156322,"永恒之火",0x6,Player-57-0E0CB0B6,0000000000000000,8277,612340,3012,2896,2605,2800,0,0,0,4067,273000,0,1266.81,1646.62,0,0.2877,298,1147,1147,0,0,nil',
  '7/19/2026 04:10:57.390-4  SPELL_CAST_SUCCESS,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x511,0x80000000,Player-11-0EAEB10E,"Bigbacktotem-Tichondrius-US",0x10512,0x80000000,156322,"永恒之火",0x6,Player-57-0E0CB0B6,0000000000000000,612340,612340,3012,2896,2605,2385,0,0,9|0,3|270177,5|273000,3|1500,1306.72,1681.85,0,4.9752,298',
  '7/19/2026 04:19:12.372-4  SPELL_CAST_SUCCESS,Player-11-0EA3D608,"Tøkyøtønïï-Tichondrius-US",0x512,0x80000000,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x10511,0x80000000,360995,"青翠之拥",0x8,Player-11-0EA3D608,0000000000000000,572160,572160,701,2963,2334,2622,0,317,0,247502,250000,25000,1267.64,1677.43,0,4.4638,298',
  '7/19/2026 04:19:15.499-4  SPELL_AURA_REMOVED,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x511,0x80000000,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x511,0x80000000,157128,"圣光救赎",0x1,BUFF,0',
  '7/19/2026 04:19:15.520-4  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x511,0x80000000,0',
  "7/19/2026 04:10:46.833-4  ARENA_MATCH_START,572,41,3v3,1",
  "7/19/2026 04:19:25.190-4  ARENA_MATCH_END,1,518,2414,2385",
  '7/19/2026 04:19:12.536-4  SPELL_CAST_FAILED,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x10511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,156322,"永恒之火",0x6,"尚未恢复"',
];

describe("谓词索引:无法共享 export 的配对,断言相等", () => {
  it("rawStreams.splitRawLine/parseRawTimestamp 与 parser 的 splitLine/parseTimestamp 在真实 raw.txt 行上逐字节相同(结构性做不到共享 export 的镜像,BACKLOG #26 Task 1)", () => {
    for (const line of RAW_STREAMS_REAL_LINES) {
      const mine = rawStreams.splitRawLine(line);
      const theirs = parserSplitLine(line);
      expect(mine).toEqual(theirs);
      if (mine && theirs) {
        expect(rawStreams.parseRawTimestamp(mine.datePart)).toBe(
          parserParseTimestamp(theirs.datePart),
        );
      }
    }

    // Negative control: a non-combat-log line must be rejected identically.
    const malformed = "not a combat log line at all";
    expect(rawStreams.splitRawLine(malformed)).toBeNull();
    expect(parserSplitLine(malformed)).toBeNull();
  });

  it("parseRawTimestamp 与 parser 的 parseTimestamp 在小数秒 1/2/3 位、显式偏移、无偏移(本地时区回退分支)上逐值相同,含畸形输入的 null 对照", () => {
    const cases = [
      "7/19/2026 04:19:05.2-4",
      "7/19/2026 04:19:05.26-4",
      "7/19/2026 04:19:05.269-4",
      "7/19/2026 04:19:05.269+8",
      "7/19/2026 04:19:05.269", // no offset suffix — local-timezone fallback branch
    ];
    for (const datePart of cases) {
      expect(rawStreams.parseRawTimestamp(datePart, { timezone: "UTC" })).toBe(
        parserParseTimestamp(datePart, { timezone: "UTC" }),
      );
    }
    // Negative control: malformed date parts must both return null, not just
    // "some" value — proves the case above isn't vacuously passing.
    for (const bad of [
      "not-a-date",
      "13/40/2026 04:19:05.269-4",
      "7/19/2026 25:00:00.000-4",
    ]) {
      expect(rawStreams.parseRawTimestamp(bad)).toBeNull();
      expect(parserParseTimestamp(bad)).toBeNull();
    }
  });

  it("mirrorDecodeAdvanced 与 parser 的 decodeAdvanced 在真实 raw.txt 行的 advanced 块上逐字段相同,且 extractManaFromAdvanced 复现 60ab1e8f 的真机蓝量锚点", () => {
    for (const line of RAW_STREAMS_REAL_LINES) {
      const mineSplit = rawStreams.splitRawLine(line);
      const theirSplit = parserSplitLine(line);
      if (!mineSplit || !theirSplit) continue;
      if (
        mineSplit.eventName !== "SPELL_CAST_SUCCESS" &&
        mineSplit.eventName !== "SPELL_PERIODIC_HEAL"
      ) {
        continue; // only advanced-bearing event types carry a real block
      }
      const mine = rawStreams.mirrorDecodeAdvanced(mineSplit.params, 11);
      const theirs = parserDecodeAdvanced(theirSplit.params, 11);
      expect(mine).toEqual(theirs);
    }

    // Real anchor: match 60ab1e8f's healer mana reading ~10s before death.
    const manaLine =
      '7/19/2026 04:19:05.269-4  SPELL_CAST_SUCCESS,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x10511,0x80000000,0000000000000000,nil,0x80000000,0x80000000,415388,"回收复用",0x2,Player-57-0E0CB0B6,0000000000000000,383863,612340,3094,2975,3126,2385,0,0,0,545,273000,0,1262.06,1652.99,0,1.7406,298';
    const manaParams = rawStreams.splitRawLine(manaLine)!.params;
    expect(rawStreams.extractManaFromAdvanced(manaParams, 11)).toEqual({
      mana: 545,
      manaMax: 273000,
    });

    // Dual-power pipe case ("9|0" Holy Power + Mana): mana is parallel index 1.
    const dualLine =
      '7/19/2026 04:10:57.390-4  SPELL_CAST_SUCCESS,Player-57-0E0CB0B6,"Minilay-Illidan-US",0x511,0x80000000,Player-11-0EAEB10E,"Bigbacktotem-Tichondrius-US",0x10512,0x80000000,156322,"永恒之火",0x6,Player-57-0E0CB0B6,0000000000000000,612340,612340,3012,2896,2605,2385,0,0,9|0,3|270177,5|273000,3|1500,1306.72,1681.85,0,4.9752,298';
    const dualParams = rawStreams.splitRawLine(dualLine)!.params;
    expect(rawStreams.extractManaFromAdvanced(dualParams, 11)).toEqual({
      mana: 270177,
      manaMax: 273000,
    });
  });

  it("门规的 LoS 容差仍由分析侧 export 派生,不是手抄的字面量", () => {
    // TIME_SLACK_SECONDS / POSITION_MAX_GAP_MS are private aliases inside
    // positioningScan.ts and cannot be imported, so all we can pin is the
    // derivation itself — the moment someone turns it back into a literal,
    // this goes red.
    const src = readRepo("packages/eval/src/quality/positioningScan.ts");
    expect(src).toMatch(/const TIME_SLACK_SECONDS = LOS_SWEEP_SLACK_S;/);
    expect(src).toMatch(/const POSITION_MAX_GAP_MS = LOS_SWEEP_GAP_MS;/);
    // Negative control: the two gap constants are deliberately unequal — do
    // not merge them just because both are called "gap".
    expect(positionSampling.INTERP_MAX_GAP_MS).not.toBe(
      positionSampling.LOS_SWEEP_GAP_MS,
    );
  });

  it("门规的 CC 上限与贴脸定义仍由分析侧 export 派生,不是手抄的字面量", () => {
    const src = readRepo("packages/eval/src/quality/positioningScan.ts");
    expect(src).toMatch(
      /const MAX_CC_CLAIM_YARDS = CC_MAX_PLAUSIBLE_RANGE_YARDS;/,
    );
    expect(src).toMatch(/const TRAINED_MAX_YARDS = HEALER_TRAINED_YARDS;/);
    // Negative control: cast range and the "trustworthy upper bound on a
    // recomputed distance" are deliberately unequal — three places each used
    // to carry their own number (40 / 45 / 50); do not merge them into one
    // just because all three called themselves "max CC distance".
    expect(positionSampling.CC_MAX_CAST_RANGE_YARDS).not.toBe(
      positionSampling.CC_MAX_PLAUSIBLE_RANGE_YARDS,
    );
    // The ordering is structurally guaranteed by the derivation (trustworthy
    // bound = cast range + observation slack); this only pins the direction.
    expect(positionSampling.CC_MAX_CAST_RANGE_YARDS).toBeLessThan(
      positionSampling.CC_MAX_PLAUSIBLE_RANGE_YARDS,
    );
  });

  it("makeRng 与 IndexEntry 在 packages/eval 里各只有一处声明", () => {
    // Types are erased at compile time, so single-source cannot be proven at
    // runtime by "importing the same object"; what CAN be pinned is "exactly
    // one declaration in the tree". Both have been hand-copied before (the RNG
    // into the calibration-set builder; IndexEntry copied four times, with only
    // the authoritative copy carrying ownerName).
    const declaringFiles = (pattern: RegExp): string[] =>
      evalSourceFiles().filter((f) => pattern.test(readRepo(f)));

    expect(declaringFiles(/\bfunction makeRng\b/)).toEqual([
      "packages/eval/src/ab/abCompareStats.ts",
    ]);
    expect(declaringFiles(/\binterface IndexEntry\b/)).toEqual([
      "packages/eval/src/corpus/buildCorpus.ts",
    ]);
  });

  it("后视偏差聚簇窗常量 = 30s,且 hindsightScan.ts 是直接 import 而非手抄字面量", () => {
    // hindsightViolations/HINDSIGHT_CLUSTER_SLACK_S are structurally single-
    // source already (hindsightScan.ts imports both from @gladlog/analysis,
    // see its header comment) — but the doc's row prose asserts "30s" in
    // words, and nothing pins that number against silent drift in the
    // exported constant. Pin it explicitly, and pin the import so a future
    // hand-copy (the exact failure mode CLAUDE.md's shared-predicate rule
    // exists to catch) turns this red.
    expect(hindsightLint.HINDSIGHT_CLUSTER_SLACK_S).toBe(30);
    const src = readRepo("packages/eval/src/quality/hindsightScan.ts");
    expect(src).toMatch(
      /import\s*\{[^}]*HINDSIGHT_CLUSTER_SLACK_S[^}]*\}\s*from\s*"@gladlog\/analysis"/s,
    );
    // Negative control: a stray hand-copied "30" elsewhere in the same file
    // parameterizing the cluster window would not be caught by the import
    // check above — assert there is exactly one declaration of the constant
    // in the whole eval tree (mirrors the makeRng/IndexEntry single-
    // declaration pin below).
    const declaringFiles = evalSourceFiles().filter((f) =>
      /\bconst HINDSIGHT_CLUSTER_SLACK_S\s*=/.test(readRepo(f)),
    );
    expect(declaringFiles).toEqual([]);
  });

  it("归档目录名与账本分片名出自同一个 dateKey 格式化", () => {
    for (const ms of [
      Date.UTC(2026, 7, 1, 0, 0, 0),
      Date.UTC(2026, 7, 1, 23, 59, 59),
      Date.UTC(2026, 0, 9, 12, 0, 0),
      Date.UTC(2025, 11, 31, 23, 0, 0),
    ]) {
      expect(archivePlan.matchDateKey(ms)).toBe(archiveLedger.dateKeyOf(ms));
    }
  });

  // The own-log archiver decides "is this a log I should upload" in
  // corpus-tools, while the names it must recognise are minted in
  // log-pipeline. Neither package can import the other's predicate, so pin the
  // relation: everything outputNameFor produces must pass isOwnLogName.
  it("自有日志归档的收件判据认得 collector 产出的全部命名", () => {
    for (const ref of [
      {
        logFileName: "WoWCombatLog-082526_200755.txt",
        hostname: "win-pc",
        gen8: "02c540d0",
      },
      {
        logFileName: "WoWCombatLog-042126_002657.txt",
        hostname: "mac-mini",
        gen8: "82bb77ca",
      },
      // logFileName without the .txt suffix — outputNameFor tolerates it.
      {
        logFileName: "WoWCombatLog-061426_015229",
        hostname: "win-pc",
        gen8: "deadbeef",
      },
    ]) {
      const name = collectLogs.outputNameFor(ref as never);
      expect(ownLogArchive.isOwnLogName(name)).toBe(true);
    }
    // Negative control, so the assertion above cannot silently pass on a
    // predicate that accepts everything.
    expect(ownLogArchive.isOwnLogName("manifest.json")).toBe(false);
  });

  it("战报曲线的指标组成 == 榜单 meterValue 的组成(治疗含吸收)", () => {
    // Both halves pinned. METRIC_BASES eats events, meterValue eats totals, so
    // they cannot be one expression — but if either side stops counting
    // absorbs as healing, the chart's bars and the leaderboard bar right next
    // to them start printing different numbers for the same player.
    expect(flowSeries.METRIC_BASES).toEqual({
      damage: ["damageDone"],
      healing: ["healingDone", "absorbsDone"],
      taken: ["damageTaken"],
      healed: ["healingTaken", "absorbsTaken"],
    });
    // The leaderboard half, read off its source: `mode === "healing"` must
    // still add absorbsDone. A literal rewrite there turns this red.
    const src = readRepo(`${D}/derive/meterRows.ts`);
    expect(src).toMatch(/r\.healingDone \+ r\.absorbsDone/);
    expect(src).toMatch(/mode === "damage"\s*\n?\s*\? r\.damageDone/);
    // Third consumer (2026-08-17): the Markdown export's 治疗 column used to
    // read `healingDone` alone, so a Discipline priest's whole shield output
    // vanished from the export while the on-screen leaderboard right above it
    // counted it (b6057f93 round 3: 6,846,504 → 3,908,949, rank 1 → 2). It now
    // calls `meterValue`; a field pick there turns this red.
    const exp = readRepo(`${D}/derive/exportReport.ts`);
    expect(exp).toMatch(/\$\{meterValue\(r, "healing"\)\}/);
    expect(exp).not.toMatch(/\$\{r\.healingDone\}/);
    // Negative control: the two heal-side bases are distinct facts and must
    // not be collapsed into one just because both end up in 治疗.
    expect(flowSeries.METRIC_BASES.healing[0]).not.toBe(
      flowSeries.METRIC_BASES.healing[1],
    );
  });

  it("时间窗边界只有一处比较:eventInRange 与 msInRange 在边界上一致", () => {
    const m = { startTime: 1_000_000 };
    const range = { fromS: 10, toS: 20 };
    const inMs = reportTimeRange.msInRange(m, range);
    const inEvent = reportTimeRange.eventInRange(m, range);
    for (const ms of [
      m.startTime + 9_999, // just outside
      m.startTime + 10_000, // inclusive lower bound
      m.startTime + 15_000,
      m.startTime + 20_000, // inclusive upper bound
      m.startTime + 20_001, // just outside
    ]) {
      expect(inEvent({ timestamp: ms }), String(ms)).toBe(inMs(ms));
    }
    // Boundaries are inclusive on BOTH ends — a half-open window would silently
    // drop an event landing exactly on the edge of a chosen kill window.
    expect(inMs(m.startTime + 10_000)).toBe(true);
    expect(inMs(m.startTime + 20_000)).toBe(true);
    // The defensive branch lives only on the event shape, on purpose.
    expect(inEvent({})).toBe(true);
  });
});

describe("谓词索引:分析产出 X ⇄ 门规验证 X", () => {
  it("经 fmtTime + renderedWindowSeconds 渲染的窗口,门规零违规", () => {
    const lines: string[] = [];
    const raw: [number, number][] = [];
    for (let from = 0; from < 400; from += 37) {
      for (const d of [0.1, 0.5, 0.9, 3.4, 9.6, 18.2]) {
        const to = from + 0.4 + d;
        raw.push([from + 0.4, to]);
        lines.push(
          `${renderGrid.fmtTime(from + 0.4)}–${renderGrid.fmtTime(to)} (${renderGrid.renderedWindowSeconds(from + 0.4, to)}s)`,
        );
      }
    }
    expect(promptQualityCheck.checkWindowSpanConsistency(lines)).toEqual([]);

    // Negative control: labelling the span by rounding the raw fractional
    // seconds must be caught by the gate — proof the case above is not a no-op.
    const naive = raw.map(
      ([f, t]) =>
        `${renderGrid.fmtTime(f)}–${renderGrid.fmtTime(t)} (${Math.round(t - f)}s)`,
    );
    expect(
      promptQualityCheck.checkWindowSpanConsistency(naive).length,
    ).toBeGreaterThan(0);
  });

  it("取自 toSortedFinite 的百分位,门规零违规", () => {
    const pool = [500, NaN, 100, 900, Infinity, 300, 700, NaN, 200];
    const sorted = stats.toSortedFinite(pool);
    const at = (q: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const line = `Restoration Druid (n=${sorted.length}): p50 ${at(0.5)}k | p90 ${at(0.9)}k`;
    expect(promptQualityCheck.checkPercentileMonotonicity([line])).toEqual([]);

    // Negative control: this is what the mis-ordering looks like when NaN is
    // not filtered before sort (shape measured on 2026-07-20).
    expect(
      promptQualityCheck.checkPercentileMonotonicity([
        "Marksmanship Hunter (n=87): p50 214k | p90 65k",
      ]).length,
    ).toBeGreaterThan(0);
  });

  it("HEALER_TRAINED 的 closest 距离,门规零违规(采样刻意不同参,方向由此钉住)", () => {
    const { lines } = healerTrainedFixture();
    const { claims } = positioningScan.extractGeoClaims(lines.join("\n"));
    // Both camped claims must be extracted, otherwise everything below no-ops
    const trained = claims.filter((c) => c.kind === "TRAINED");
    expect(trained).toHaveLength(2);
    expect(
      positioningScan.checkGeoClaims(claims, trainedCtx()).violations,
    ).toEqual([]);

    // If the two sides in fact sampled identically, the case above would be a
    // no-op. This conversely pins "the gate really does see the sub-second dip
    // the producer cannot": the producer claims 7.5yd (whole seconds), the gate
    // observes 6.0yd (half seconds).
    // The criterion is claim < gateMin − max(3, 0.25·claim), so for a 3.5yd
    // claim:
    //   gateMin = 6.0 (the gate's fine grid) → 3.5 < 3.0 is false → pass;
    //   gateMin = 7.5 (if the gate degraded to whole seconds) → 3.5 < 4.5 is
    //   true → violation.
    // So "3.5 passes" is equivalent to asserting gateMin < producerClaim, i.e.
    // the two sides really are parameterized differently.
    expect(trained[0].distanceYards).toBe(7.5);
    expect(
      positioningScan.checkGeoClaims(
        [{ ...trained[0], distanceYards: 3.5 }],
        trainedCtx(),
      ).violations,
    ).toEqual([]);
  });

  it("反向对照:用错窗口采样出的 closest 会被门规抓住", () => {
    // In the fixture the healer is camped to a closest 6.0yd (sub-second)
    // during 0:10–0:31, and only truly camped to 1yd during 0:40–0:51.
    // Pinning the later segment's closest distance onto the earlier one is
    // exactly the shape of "sampled the wrong window".
    const { claims } = positioningScan.extractGeoClaims(
      healerTrainedFixture().lines.join("\n"),
    );
    const trained = claims.filter((c) => c.kind === "TRAINED");
    const wrongWindow = {
      ...trained[0],
      distanceYards: trained[1].distanceYards,
    };
    const violations = positioningScan.checkGeoClaims(
      [wrongWindow],
      trainedCtx(),
    ).violations;
    expect(violations.map((v) => v.code)).toEqual(["G2_TRAINED_DISTANCE"]);
  });

  it("HP 查询时刻先归渲染网格,同秒才不会出现两个 HP", () => {
    // toRenderSecond IS fmtTime's rounding rule — as long as both render paths
    // snap to the grid first, a single displayed second can only have one
    // sample instant (the premise of the same-second HP gate).
    for (const t of [0, 0.4, 7.9, 42.4, 59.999, 60, 125.5]) {
      expect(renderGrid.fmtTime(t)).toBe(
        renderGrid.fmtTime(renderGrid.toRenderSecond(t)),
      );
    }
  });

  it("crisis-no-response 渲染出的参照数字,门规零违规;改动 refDeathNoResp 会被抓住(反向对照)", () => {
    // Same lookup the product renders from and the gate re-derives from —
    // one call, both sides consume its output (CLAUDE.md shared-predicate
    // rule; docs/predicate-index.md's crisisDecisionPoints/behaviorPrior rows).
    const ref = behaviorPrior.lookupBehaviorPrior("3v3", "healer", 0.25);
    expect(ref).not.toBeNull();
    const facts: Record<string, string> = {
      t: "42",
      unit: "Healer-Realm-US",
      hpPct: "35",
      dmg2sPct: "25",
      attackers: "2",
      burst: "yes",
      refNNoResp: String(ref!.nNoResp),
      refDeathNoResp: String(ref!.deathNoRespPct),
      refNResp: String(ref!.nResp),
      refDeathResp: String(ref!.deathRespPct),
      refOutcome: behaviorPrior.outcomePhrase(ref!.outcome),
      refOutcomeKey: ref!.outcome,
      refTop: ref!.top.map(([k, v]) => `${k} ${v}%`).join("; "),
      cellKey: ref!.cellKey,
      fellBack: ref!.fellBack ? "yes" : "no",
    };
    const factsStr = Object.entries(facts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    const line = `  - id=crisis-no-response:1:42 type=crisis-no-response t=42s units=Healer-Realm-US facts={${factsStr}}`;
    expect(promptQualityCheck.checkBehaviorPriorConsistency([line])).toEqual(
      [],
    );

    // Negative control: mutate refDeathNoResp only — must be exactly one
    // failure, proof the case above is not a no-op.
    const mutatedFacts = {
      ...facts,
      refDeathNoResp: String(Number(facts.refDeathNoResp) + 1),
    };
    const mutatedFactsStr = Object.entries(mutatedFacts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    const mutatedLine = `  - id=crisis-no-response:1:42 type=crisis-no-response t=42s units=Healer-Realm-US facts={${mutatedFactsStr}}`;
    expect(
      promptQualityCheck.checkBehaviorPriorConsistency([mutatedLine]),
    ).toHaveLength(1);
  });

  it("attempt-into-trinket 渲染出的语料参照数字,门规零违规;改一个数就被抓住(反向对照)", () => {
    // Same constant both sides — the producer (utils/killAttempts.ts's
    // attemptIntoTrinketEvents) renders String(...) of these exact fields and
    // this gate re-parses them (docs/predicate-index.md's outcomeRefs row).
    // Fuller cases live in packages/eval/test/outcomeRefGate.test.ts.
    const REF = outcomeRefs.ATTEMPT_INTO_TRINKET_OUTCOME_REF;
    const facts: Record<string, string> = {
      t: "1:12",
      target: "Enemy-Realm-US",
      stun: "Kidney Shot",
      stunsN: "2",
      focusPct: "78",
      dmgM: "1.24",
      primeAlt: "Other-Realm-US",
      failedBy: "pressure",
      refN: String(REF.n),
      refKillTrinketDown: String(REF.killPctTrinketDown),
      refKillTrinketUp: String(REF.killPctTrinketUp),
    };
    const render = (f: Record<string, string>): string =>
      `  - id=attempt-into-trinket:1:72 type=attempt-into-trinket t=1:12s units=Enemy-Realm-US/Other-Realm-US facts={${Object.entries(
        f,
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}}`;
    expect(
      promptQualityCheck.checkOutcomeRefConsistency([render(facts)]),
    ).toEqual([]);
    expect(
      promptQualityCheck.checkOutcomeRefConsistency([
        render({ ...facts, refKillTrinketUp: "4.8" }),
      ]),
    ).toHaveLength(1);
  });

  it("kick-eaten t 经 fmtFactTime 渲染,与 fmtTime 渲染的 [KICK] 标记同一渲染秒,门规零违规(反向对照:fmtFactNum 会把 x.95–x.99 舍入进下一秒)", () => {
    // Real analysis-side atSeconds values with fractional parts that
    // fmtFactNum's toFixed(1) rounds UP past a whole-second boundary — the
    // exact 2026-08-30 kick-eaten defect shape (20/209 on the A/B corpus).
    const atSecondsSamples = [9.96, 8.9, 30.5, 70.2, 119.5, 208.96];
    const lines: string[] = [];
    for (const atSeconds of atSecondsSamples) {
      const floored = renderGrid.toRenderSecond(atSeconds);
      lines.push(
        `  - id=kick-eaten:P1:${floored} type=kick-eaten t=${factFormat.fmtFactTime(atSeconds)}s units=Me/Rogue facts={t=${factFormat.fmtFactTime(atSeconds)}, interrupted=Heal, kick=Kick, source=Rogue, lockout=3.0}`,
      );
      lines.push(
        `${renderGrid.fmtTime(atSeconds)}  [KICK]   1(Rogue) interrupted 2(Priest)'s Heal (Kick)`,
      );
    }
    expect(promptQualityCheck.checkMenuTRenderGrid(lines)).toEqual([]);

    // Negative control: render the SAME facts.t with the old fmtFactNum
    // (round, not floor) instead — must be caught, one failure per sample
    // whose fractional part actually crosses the boundary (9.96 and 208.96
    // here; the others are already exact tenths and round to themselves).
    const naiveLines: string[] = [];
    for (const atSeconds of atSecondsSamples) {
      naiveLines.push(
        `  - id=kick-eaten:P1:x type=kick-eaten t=${factFormat.fmtFactNum(atSeconds)}s units=Me/Rogue facts={t=${factFormat.fmtFactNum(atSeconds)}, interrupted=Heal, kick=Kick, source=Rogue, lockout=3.0}`,
      );
      naiveLines.push(
        `${renderGrid.fmtTime(atSeconds)}  [KICK]   1(Rogue) interrupted 2(Priest)'s Heal (Kick)`,
      );
    }
    const naiveFails = promptQualityCheck.checkMenuTRenderGrid(naiveLines);
    expect(naiveFails).toHaveLength(2); // 9.96 -> 10.0 and 208.96 -> 209.0
  });
});

// ---------------------------------------------------------------------------
// Feature flag state — the doc's `## Feature flag state` table, asserted
// against the running values.
// ---------------------------------------------------------------------------
//
// Why a separate, column-parsed table instead of prose in the index rows: on
// 2026-08-15 four candidate flags were flipped to true and six statements
// across the repo kept saying "default off" — including two rows of this very
// document, in both languages. The old test only pinned that a symbol exists,
// so none of it went red. Matching English prose was considered and rejected:
// synonyms slip through, the Chinese doc cannot match an English pattern, and
// a prose matcher stops matching exactly when the wording is edited.

const FLAG_REGISTRIES: Record<string, Record<string, boolean>> = {
  CANDIDATE_TYPE_FLAGS,
  DISPEL_FEATURE_FLAGS,
  HEALER_OFFENSE_FLAGS,
};

const FLAG_BEGIN = "<!-- flag-state:begin -->";
const FLAG_END = "<!-- flag-state:end -->";
/** `| \`REGISTRY.key\` | \`true|false\` |` — the first two columns only. */
const FLAG_ROW =
  /^\|\s*`([A-Z_][A-Z0-9_]*)\.([A-Za-z_$][\w$]*)`\s*\|\s*`(true|false)`\s*\|/gm;

interface FlagRow {
  registry: string;
  key: string;
  expected: boolean;
}

function docFlagRows(docPath: string): FlagRow[] {
  const doc = readRepo(docPath);
  const from = doc.indexOf(FLAG_BEGIN);
  const to = doc.indexOf(FLAG_END);
  if (from < 0 || to < 0 || to <= from) {
    throw new Error(`${docPath} 缺少 flag-state 标记对`);
  }
  const body = doc.slice(from + FLAG_BEGIN.length, to);
  return [...body.matchAll(FLAG_ROW)].map((m) => ({
    registry: m[1]!,
    key: m[2]!,
    expected: m[3] === "true",
  }));
}

describe("特性开关状态:文档写的就是运行时的", () => {
  const EN_DOC = "docs/predicate-index.md";
  const ZH_DOC = "docs/predicate-index.zh-CN.md";
  const rows = docFlagRows(EN_DOC);

  it("表非空(标记对存在且至少解析出一行)", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("中英两版列出同一批开关,顺序也相同", () => {
    expect(docFlagRows(ZH_DOC)).toEqual(rows);
  });

  it("每个注册表的所有开关都登记了,没有漏网的", () => {
    for (const [name, registry] of Object.entries(FLAG_REGISTRIES)) {
      const listed = rows.filter((r) => r.registry === name).map((r) => r.key);
      expect([...listed].sort()).toEqual(Object.keys(registry).sort());
    }
  });

  it.each(rows.map((r) => [`${r.registry}.${r.key}`, r] as [string, FlagRow]))(
    "%s",
    (_name, row) => {
      const registry = FLAG_REGISTRIES[row.registry];
      expect(registry).toBeDefined();
      expect(registry![row.key]).toBe(row.expected);
    },
  );
});
