# @gladlog/analysis

**English** · [中文](README.zh-CN.md)

The combat-analysis core of gladlog: turns a parsed WoW arena/shuffle match into structured facts, an AI-coaching prompt, cohort comparison data, and cross-match learning signals. It has one workspace dependency (`@gladlog/parser-compat`) and no dependency on Electron, React, or any UI framework — it's pure TypeScript, consumed by `packages/desktop` (renderer `derive/` layer) and `packages/eval` (verification gates, corpus building). At roughly 35,000 lines / 128 files under `src/` (including co-located tests), it's the largest package in the repo.

This document assumes you can already write TypeScript and are new to this codebase. Every claim below is grounded in a specific file; when in doubt, open the cited file.

## What it is, and its input shape

`src/index.ts` is a ~90-line public-API barrel. Its own header states the deliberate scope: "入口形状:legacy(`@gladlog/parser-compat`);类型设计允许未来原生 StoredMatch 形状 utils 并存、逐 util 迁移" — i.e. every exported function still consumes the **legacy shape** defined in `@gladlog/parser-compat` (this package's only dependency), and a native-shape migration is intentionally partial, not something to assume is finished.

Concretely, the top-level entry point `buildMatchContext` (`src/context/buildMatchContext.ts`) has this signature:

```ts
export function buildMatchContext(
  combat: AtomicArenaCombat,
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
  options: { useTimelinePrompt?: boolean; owner?: ICombatUnit } = {},
): string;
```

`ICombatUnit` and `AtomicArenaCombat` (`= IArenaMatch | IShuffleRound`) are both defined in `packages/parser-compat/src/types.ts` and imported from there — the same pattern repeats across most of `src/utils/`.

**One correction worth flagging:** the function that actually produces this legacy shape from a raw parsed doc, `toLegacyMatch`, is exported by `@gladlog/parser-compat` — but the commonly-referenced name `toLegacySafe` is **not** part of this package's dependency surface. `toLegacySafe` is a small desktop-local wrapper (`packages/desktop/src/renderer/src/report/derive/legacySource.ts`) that pads unit-event arrays missing from trimmed test fixtures before calling `toLegacyMatch`, so this analysis package doesn't need to know about it — it only ever sees the finished legacy shape, produced however the caller likes.

## The seven subdirectories

- **`context/`** (10 files) — the top-level assembler. `buildMatchContext.ts` pulls in nearly every `utils/*` module and every relevant `data/*` table and renders the AI-facing prompt string. `matchTimeline.ts` / `matchTimelineSections.ts` build the `[STATE]`/`[DMG SPIKE]`/`[CD]` rendered timeline lines — this is the "rendered value" side of the shared-predicate rule (see below). `criticalMoments.ts` / `criticalWindows.ts` decide which seconds get denser sampling. `matchNarrative.ts` builds narrative text; `resourceSnapshot.ts` builds resource (mana/rage/etc.) snapshots; `timelineHelpers.ts` holds cross-cutting helpers.

- **`analysis/`** (18 files) — the AI-facing finding/prompt pipeline, in three stages:
  1. `candidateFindings.ts` — deterministic. `extractCandidateFindings` plus ~16 per-type `xEvents` functions turn raw analysis output into `CandidateEvent[]` (a `type`, a deterministic `id`, and a `facts: Record<string,string>` — the only values the model may cite).
  2. `buildFindingsPrompt.ts` — renders the candidate menu plus a per-type legend (`DPS_LEGENDS`/`CHAIN_LEGENDS`) into the prompt actually sent to the model.
  3. `auditFindings.ts` — post-model grounding audit: every model-returned finding's `eventIds` must resolve to a real candidate, and every `{{placeholder}}` must resolve unambiguously. This file is generic (zero per-finding-type logic).

  Supporting: `findingCategories.ts` (normalizes the model's free-text category to a fixed 8-value enum: `survival, cooldowns, positioning, target-selection, cc, interrupts, dispels, offense`), `causalLint.ts` / `spellNameZhLint.ts` (text-level linters run inside the audit), `deepDive.ts` (multi-round automated follow-up, with its own routing sets like `OFFENSIVE_CANDIDATE_TYPES`), `parseModelJson.ts` (tolerant model-JSON parsing), `factFormat.ts` (numeric fact formatting).

- **`compare/`** (10 files) — cohort/percentile comparison against a reference corpus built by `packages/eval`. `verifiedComparison.ts` exports `percentileRank`/`verdictFor` (piecewise-linear percentile from stored p10/p50/p90 anchors, clamped to [10,90]). `cellLookup.ts`'s `assignBuildGroup` matches a match's talents to a reference cell. `claimChecker.ts` owns the single-source placeholder syntax `PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g`, explicitly shared by interpolation, claim-checking, and deep-dive auditing to avoid drift. `buildExemplarLedPrompt.ts` renders the "cohort exemplar" text block; `metricLabels.ts` is the single-source en/zh label table for comparison dimensions.

- **`learning/`** (7 files) — cross-match, deterministic "recurring habit" detection layered under an LLM-distillation step (design: `docs/superpowers/specs/2026-07-26-self-learning-rules-design.md`). `patternScan.ts` is the deterministic filter (`PATTERN_WINDOW_MATCHES=20`, `PATTERN_MIN_HITS=5`, `RULE_RETIRE_MAX_HITS=2` and others), whose predicates `findingMatchesGroup`/`matchInCondition` are the documented single source shared with rule-application. `distillRules.ts` turns stable patterns into rule text under the same "no bare numbers, only `{{hits}}`-style placeholders" discipline as findings. `matchRules.ts`'s `ruleAppliesToFinding` applies learned rules to new matches by importing (not copying) `patternScan`'s predicates. Consumed by `packages/desktop/src/main/learning.ts`.

- **`benchmark/`** (3 files) — corpus-wide statistics, separate from `compare/`'s per-match lookup. `metrics.ts` computes per-spec `SpecStats`/percentiles over a batch of matches (pressure windows, HPS/DPS samples, CD first-use timing, purge rate, dampening-at-death; `WINDOW_SECONDS=10`, `MIN_SAMPLES_FOR_SUMMARY=5`). `stratify.ts`'s `stratifiedSample` does deterministic (first-N) stratified sampling by spec×archetype with a per-stratum cap, for building balanced eval corpora.

- **`data/`** — the game-data substrate everything else reads from; see the dedicated section below.

- **`utils/`** (39 non-test files) — the largest, most heterogeneous directory. Rough clusters, with example files:
  - Cooldown/CD tracking & the rendering-grid predicates: `cooldowns.ts` (the biggest file — `HP_SAMPLE_RADIUS_MS`, `fmtTime`, `toRenderSecond`, `extractMajorCooldowns`, `cdAvailableAt`), `enemyCDs.ts`, `dampening.ts`.
  - DR/CC tracking: `drAnalysis.ts`, `ccTrinketAnalysis.ts`, `auraIntervals.ts`.
  - Positioning/geometry/LoS: `losAnalysis.ts` (position interpolation, `hasLineOfSight`, `distanceBetween`), `positionSampling.ts` (the shared-predicate single-source module — see below), `positionAnalysis.ts`.
  - Healer-specific metrics: `healerExposureAnalysis.ts`, `healerMetrics.ts`, `healerOffenseAnalysis.ts`, `healingGaps.ts`.
  - Burst/damage/offense: `burstLedger.ts`, `dpsMetrics.ts`, `offensiveWindows.ts`, `offensiveWasteAnalysis.ts`, `killWindowTargetSelection.ts`, `counterfactual.ts`.
  - Dispel/kick/interrupt: `dispelAnalysis.ts`, `kickAudit.ts`, `enemyInterrupts.ts`.
  - Death/outcome: `deathOutcomeAnalysis.ts`, `crisisEvents.ts` (`extractRotations`).
  - Archetype/comp classification: `archetypeInference.ts`, `archetypeInjection.ts`, `enemyCompArchetype.ts`, `matchArchetype.ts`.
  - Talent/spell metadata helpers: `talentBehaviors.ts` (curated from official tooltips, explicitly _not_ inferred from logs — "only well-understood talents belong here"), `talentModifiers.ts`, `talents.ts`, `spellDanger.ts`, `spellSchools.ts`.
  - Low-level/generic: `binarySearch.ts`, `stats.ts` (`toSortedFinite` — single source for sorted stats, avoids `NaN`-corrupted comparator bugs), `memoize.ts`, `combatStates.ts`, `specBaselines.ts`.

## `src/data/`: generated vs. curated

This split is important to get right before editing anything here.

**Generated** (produced by a script, carrying a "生成文件" / "Generated at:" marker — the exact wording varies by file, but the intent is consistent: don't hand-edit):

| File                                        | Produced by                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `spellClassMapGenerated.ts`                 | `scripts/datagen/genSpellClassMap.ts`                                               |
| `spellEffectGenerated.ts` + `.json` sidecar | `scripts/datagen/genSpellEffects.ts`                                                |
| `spellIconsGenerated.ts` + `.json` sidecar  | `scripts/datagen/genSpellIcons.ts`                                                  |
| `spellNamesZhGenerated.json`                | `scripts/datagen/genSpellNamesZh.ts`                                                |
| `drCategoriesGenerated.ts`                  | `scripts/datagen/genDrCategories.ts`                                                |
| `offGcdGenerated.ts`                        | `scripts/datagen/genOffGcd.ts`                                                      |
| `pvpTalentReplacesGenerated.ts`             | `scripts/datagen/genPvpTalentReplaces.ts`                                           |
| `specIconsGenerated.ts`                     | `scripts/datagen/genSpecIcons.ts`                                                   |
| `mitigationGenerated.json`                  | `scripts/datagen/genMitigation.ts`                                                  |
| `talentIdMap.json`                          | `scripts/datagen/fetchTalents.ts`                                                   |
| `spellNames.json`                           | `scripts/datagen/genSpellNames.ts`                                                  |
| `talentModifiers.json`                      | `scripts/datagen/genTalentModifiers.ts`                                             |
| `trinketItemIds.json`                       | `scripts/datagen/genTrinketItemIds.ts`                                              |
| `dispelObservedGenerated.ts`                | **not** `scripts/datagen` — `packages/eval/scripts/confidenceAudit.ts --emit-table` |
| `observedSpellIdsGenerated.json`            | **not** `scripts/datagen` — `packages/eval/scripts/observedSpellIds.ts`             |

Two things worth knowing before touching this list: some JSON sidecars carry no header at all (JSON can't have comments) and are only identifiable by filename convention or a `"generatedAt"` field inside the body (e.g. `trinketItemIds.json`); and two of the generated files — `dispelObservedGenerated.ts`, `observedSpellIdsGenerated.json` — come from a _corpus-mining_ script in `packages/eval`, not from this package's own `scripts/datagen`, because they encode "what has actually been observed resolved/dispelled in real logs," which only eval's corpus tooling has access to.

**Hand-curated** (human judgment, no generated marker): `classSpells.ts`, `spellCategories.ts`, `spellIdLists.ts`, `zoneMetadata.ts` (share near-identical header language noting they're minimal hand-written replacements for older files that illegitimately mixed in non-owned upstream data — a data-compliance rewrite); `spellEffectOverrides.ts` (hand-picked corrections layered over `spellEffectGenerated`); `talentBehaviors.ts` (tooltip-sourced, not log-inferred, by design); `spellNameStopwords.ts` / `spellNameZhLintStopwords.ts` (the zh one is explicitly a denylist of _proven_ false positives, not a "candidate list"); `spellNameZhLintTable.ts` (sourced from a specific production incident); `discoveryRules.ts`, `dispelFeatureFlags.ts`, `arenaGeometry.ts`, `spellTags.ts`, `spellTypes.ts` (explicitly original to this repo, not derived from upstream), `talentNames.ts`, `talentStrings.ts`, `spellNameLookup.ts`, `spellEffectData.ts`, `ensure.ts`.

Some files are neither purely one nor the other — a **two-layer merge**: `spellEffectData.ts` and `mitigationData.ts` both combine a generated base layer with a curated override layer that always wins ("生成底 + 策展覆盖恒赢"). `spellEffectData.ts` also documents a real perf lesson: the 12MB `spellNames.json` load is deliberately backgrounded, not top-level-awaited, so the match-list first paint (which never looks up a spell name) isn't blocked on it — but the prompt-building path _must_ `await ensureSpellNames()` (in `data/ensure.ts`) since it can't tolerate a fallback name.

**`datagen-manifest.json`** (written by `scripts/datagen/writeManifest.ts`) is a build-stamp/provenance summary: the DB2 `build` string, a `generatedAt` timestamp, and per-artifact size/entry counts for most (not all) of the files above, plus one artifact that lives _outside_ this package (`parser-compat/enumsGenerated.ts`) purely so the `/update-wow-data` workflow knows to regenerate it too. It's read only by the datagen scripts themselves, never by this package's exported runtime API — its purpose is letting that workflow decide whether a new game build needs a data refresh, by diffing `build`.

**There is no single script that runs datagen end-to-end** — neither this package's nor the root `package.json` has a `datagen` script. The pipeline is an ordered sequence of `npx tsx scripts/datagen/*.ts` invocations documented in `docs/commands/update-wow-data.md` (talents first, since spell-effect generation reads the talent candidate set; icons before zh-names; `writeManifest.ts` last), followed by `validateCatalogs.ts` (a curated-catalog validation gate) and the full test suite.

## Adding a new analysis predicate: the file checklist

Traced from a real example (the `juked-kick` finding type):

1. **Pure detection function** — `src/utils/<name>.ts`. Example: `analyzeKickAudit` in `src/utils/kickAudit.ts`.
2. **Turn it into a `CandidateEvent`** in `src/analysis/candidateFindings.ts` — pick a new, unique `type: "..."` string, a deterministic `id` (pattern: `` `${type}:${owner.id}:${Math.round(t)}` ``), and a `facts: Record<string,string>` (only values the model may cite). 17 `type` values already exist here (`cd-waste`, `death`, `missed-cleanse`, `missed-purge`, `cc-locked`, `kick-eaten`, `wasted-trinket`, `death-setup`, `death-unused-defensive`, `external-unused`, `questionable-external`, `unconverted-burst`, `burst-into-immunity`, `off-target-in-window`, `juked-kick`, `dr-clipped-cc`, `crisis-no-response`) — use them as the pattern to follow.
3. **Add a legend line** in `src/analysis/buildFindingsPrompt.ts` — a new `type` needs an entry in `DPS_LEGENDS` or `CHAIN_LEGENDS` (both keyed by exactly the `type` string) so the model is told what the event means. Skipping this doesn't break anything mechanically, but the model sees an unexplained event.
4. **`findingCategories.ts` usually doesn't need a change** — its 8-value enum is coarse and model-assigned; a new finding type just needs to plausibly fall under an existing category.
5. **`auditFindings.ts` needs no per-type change** — its grounding/placeholder/lint logic is generic across all candidate types.
6. **Optional: `deepDive.ts` routing** — if the new type should be eligible for automated multi-round follow-up, add it to a relevant set (e.g. `OFFENSIVE_CANDIDATE_TYPES`); some types are deliberately excluded based on A/B results, so don't add by default.
7. **Tests** — a detection-function unit test in `candidateFindings.test.ts` or `test/ported/<name>.test.ts`, plus prompt-rendering coverage in `buildFindingsPrompt.test.ts` if the legend/menu logic changed.
8. **Data, if needed** — extend a curated file in `src/data/` (e.g. `spellCategories.ts`/`spellTags.ts` for CC classification) or, for corpus-observed facts, go through the datagen pipeline above.

## The shared-predicate rule, in this package

The repo's `CLAUDE.md` states a hard rule: analysis code and `packages/eval`'s verification gates must share the exact same predicate — same constants, same sampling function, same tolerance — for the same fact, anchored on the _rendered_ value. Two concrete cases in this package illustrate two different (both legitimate) ways that gets enforced:

**`LOS_SWEEP_SLACK_S` / `LOS_SWEEP_GAP_MS` — literal single-export, both sides import.** Defined once, in `src/utils/positionSampling.ts`:

```ts
export const LOS_SWEEP_SLACK_S = 2;
export const LOS_SWEEP_GAP_MS = 3_000;
```

This module's own header explains why it exists as a dedicated file: these constants used to be four separate private declarations tied together only by a comment saying "must stay equal to positioningScan.ts" — exactly the anti-pattern the rule forbids — until the 2026-07 full-scale audit found 5 independent bugs of this shape and they were consolidated here. `healerExposureAnalysis.ts` imports and uses them directly; they're re-exported from `src/index.ts`; and `packages/eval/src/quality/positioningScan.ts` imports the same two constants straight from `@gladlog/analysis` and aliases them locally (`const TIME_SLACK_SECONDS = LOS_SWEEP_SLACK_S`, `const POSITION_MAX_GAP_MS = LOS_SWEEP_GAP_MS`). A third constant in the same file, `INTERP_MAX_GAP_MS = 1_500`, is deliberately a _different_ value for a different purpose (single-point position-interpolation grounding, stricter than the LoS sweep) — the file's comment warns not to conflate them, since both were once literally named `POSITION_MAX_GAP_MS` at different values (1500 vs 3000) and that was easy to eyeball as "the same thing." A unit test (`positionSampling.test.ts`) asserts both exact values and asserts `INTERP_MAX_GAP_MS !== LOS_SWEEP_GAP_MS`, guarding specifically against that historical confusion recurring.

**`HP_SAMPLE_RADIUS_MS` — no matching eval-side constant, because the fix for that bug class abandoned constant-matching entirely.** Defined once in `src/utils/cooldowns.ts` (`export const HP_SAMPLE_RADIUS_MS = 3_000`) and reused throughout this package (`matchTimeline.ts`, `matchTimelineSections.ts`, `candidateFindings.ts`, `killWindowTargetSelection.ts`, `burstLedger.ts`, `enemyCDs.ts`, `counterfactual.ts`) so that different call sites building the same prompt don't disagree on which HP sample to use. There is **no** constant of this name, or a same-value duplicate, anywhere in `packages/eval`. Instead, `packages/eval/src/quality/promptQualityCheck.ts`'s `checkSameSecondHpConsistency` — one of exactly four `hardFailures` checks wired into that file (percentile monotonicity, same-second HP consistency, window-span consistency, cooldown-ledger consistency) — re-parses the **already-rendered prompt text** looking for two independent mentions of the same unit's HP at the same rendered `m:ss` second (a `[STATE]` line vs. a `[DMG SPIKE]` or inline mention) and asserts they agree within `HP_AGREEMENT_TOLERANCE_PP = 3` points. It does not re-sample raw combat-log data at all.

This isn't an oversight — it's a documented lesson. `cooldowns.ts` keeps a postmortem comment where a second, tighter constant (`HP_SAMPLE_RADIUS_CRITICAL_MS = 1500`) was deleted after a 2026-07-20 fix attempt: "实测 26/50 → 26/50,一个数都没动" (measured: 26/50 matches with contradictions before, 26/50 after — the radius only controls accept/reject, it never changes _which_ sample gets picked; the real bug was that the query timestamp wasn't on the same rendering grid as the displayed second). `promptQualityCheck.ts` carries the mirror-image note on the gate side, with the same before/after numbers (26/50 matches, 33 contradictions, median 7pp / max 25pp, before the fix). **The lesson generalizes:** when adding a new analysis predicate that a gate will re-check, first ask whether the gate should re-derive the same value from raw data using an identical constant (the LOS_SWEEP case), or whether it should instead re-parse the rendered prompt text for internal consistency (the HP case) — and if you claim a fix worked, get the same measured before/after numbers this package's own history uses to catch itself being wrong twice on the same bug.
