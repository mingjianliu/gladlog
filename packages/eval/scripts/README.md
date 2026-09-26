# `packages/eval/scripts` — index

_English-only developer index, regenerated 2026-09-26 from the file set; `lib/` holds the shared CLI helpers, `archive/` the retired one-off probes (see `archive/README.md`). Grouped by name suffix; a script is listed once. Run any of them with `npx tsx packages/eval/scripts/<name>.ts` from the repo root (artifacts go to `$GLADLOG_EVAL_HOME`)._

## Scans (re-runnable corpus scans; the season runbook ones live in `docs/commands/update-wow-data.md` §7b) — 64

| Script | Note |
|---|---|
| `advancedSlotScan.ts` | Direction 2 of the log-observability audit (GH #100): the advanced-block |
| `answersAlignmentScan.ts` | answersAlignmentScan.ts CLI — dumb shell over |
| `auraCooldownModScan.ts` | CLI: buffs players actually carry that change a ledger cooldown's charges, |
| `auraDoubleCloseScan.ts` | auraDoubleCloseScan.ts CLI — dumb shell over |
| `auraProducerScan.ts` | auraProducerScan.ts — WHICH ability put this aura on, and how long does each |
| `behaviorPriorScan.ts` | behaviorPriorScan.ts — exploratory (2026-08-28): "what do top-ranked players |
| `buffDurationScan.ts` | buffDurationScan.ts — 增益时长的腐烂扫描 + 缺口扫描(2026-09-07)。 |
| `burstWindowScan.ts` | burstWindowScan.ts — GH #60 phase 1 corpus scan for the enemy-burst-window |
| `candidateCalibrationScan.ts` | candidateCalibrationScan.ts CLI — dumb shell over |
| `castParamDurationScan.ts` | castParamDurationScan.ts — aura lifetime as a function of a parameter OF THE |
| `ccCloseInScan.ts` | ccCloseInScan.ts — how far a crowd-control caster closes in before the CC |
| `ccLifetimeScan.ts` | ccLifetimeScan.ts — observed aura lifetime per CC / root id vs the official |
| `cdLedgerRotScan.ts` | cdLedgerRotScan.ts CLI — dumb shell over `../src/explore/cdLedgerRot.ts` |
| `cdRecastFloorScan.ts` | CLI: the fastest a major cooldown ever comes back, per (spell, spec) — the |
| `cdTriggerPriorScan.ts` | cdTriggerPriorScan.ts — corpus scan behind the `[CD PRIOR]` context fact |
| `cooldownTalentScan.ts` | cooldownTalentScan.ts — GH #96 M6: do the cooldown modifiers recovered from |
| `crisisHpStateScan.ts` | Standing measurement for the crisis-HP ↔ [STATE] render-grid invariant |
| `crisisResponseCompletenessScan.ts` | crisisResponseCompletenessScan.ts — which healer casts inside crisis windows |
| `curatedRotScan.ts` | Curated-List Completeness Rule — the REVERSE pass, as a standing tool. |
| `discriminationScan.ts` | discriminationScan.ts — 候选类型触发率×胜负判别力扫描(常驻,2026-08-20 |
| `dispelCompletenessScan.ts` | Forward completeness check for dispels (update-wow-data.md Notes, as a tool): |
| `dispelKindScan.ts` | dispelKindScan.ts — Curated-List completeness check for |
| `drGapScan.ts` | Forward completeness check for CC classification: official DR-table ids |
| `drShareScan.ts` | drShareScan.ts — do two CC flavours share a DR category? Measured from the |
| `dupLineScan.ts` | BACKLOG #40 measurement: how often does one press render as TWO [YOU] lines? |
| `durationTalentScan.ts` | durationTalentScan.ts — GH #96 M5: do the 35 DB2 talent duration modifiers |
| `facingCalibrationScan.ts` | Direction-1 follow-up to facingObservabilityScan (GH #100): calibrate what |
| `facingObservabilityScan.ts` | Follow-up to logObservabilityPilot: Player-actor facing attribution and |
| `floorScan.ts` | CLI: measure arena walkable-floor outlines from the corpus (floor occupancy |
| `healerSaveCdScan.ts` | healerSaveCdScan.ts — generate the healer SAVE-cooldown roster from official |
| `hindsightScan.ts` | CLI: hindsightScan — predicate self-test against real corpus menus, or a |
| `hpTieScan.ts` | hpTieScan.ts — how often the `[STATE]` HP sampler has to choose between |
| `immuneCcScan.ts` | Completeness check for the CC-immunity table, using the log's own verdict. |
| `kickEatenCostScan.ts` | kick-eaten 代价门体检:**这条在产指控里,有多少发生在「锁了也不疼」的时刻? |
| `kickLockoutScan.ts` | kickLockoutScan.ts — observed school-lockout length per kick id (GH #62). |
| `killTierValidationScan.ts` | killTierValidationScan.ts — re-validates the kill-opportunity tier model |
| `kwDefAdmitScan.ts` | GH #31 ② forward scan: which corpus-observed ids does the official face |
| `kwDefDiagScan.ts` |  |
| `loadoutChangeScan.ts` | loadoutChangeScan.ts — direction 5 mini-probe of the log-observability audit |
| `losGroundTruthScan.ts` | losGroundTruthScan.ts — measures the arena line-of-sight model against the |
| `menuTRenderGridScan.ts` | menuTRenderGridScan.ts — Shared-Predicate (render-grid) audit for |
| `mitigationStackPairScan.ts` | mitigationStackPairScan.ts — how do TWO percentage damage reductions |
| `mitigationStackScan.ts` | mitigationStackScan.ts — does the un-modelled stacking between mitigation |
| `mitigationTalentScan.ts` | mitigationTalentScan.ts — do talent value-modifiers on percentage defensives |
| `newCandidateScan.ts` | Corpus-empirical scan of the three new candidate types (arenacoach batch 1 |
| `npcRosterScan.ts` | Direction 4 of the log-observability audit (GH #100): the observed NPC |
| `offensiveCdGapScan.ts` | offensiveCdGapScan.ts — FORWARD completeness scan for the canonical |
| `petDeathScan.ts` | petDeathScan.ts — GH #100 follow-up. User, 2026-09-20: a hunter's or |
| `petSideScan.ts` | petSideScan.ts — 宠物/召唤物归因的边一致性扫描(GH #99)。 |
| `positioningScan.ts` | Positioning grounding scan CLI (backlog #3 hard gate). |
| `pvpReplaceScan.ts` | Corpus mining for replacement-type PvP talents (standing tool, 2026-07-25): |
| `resRowFactScan.ts` | resRowFactScan.ts — `[RES]` 里「台账没变化」的那些行到底独占了什么事实(GH #99 item 5)。 |
| `resourceFlowScan.ts` | Direction 3 of the log-observability audit (GH #100): resource gains, drains |
| `responseQuoteScan.ts` | Response quoting metric over a run (GH #103 class C — tracked, not a gate). |
| `rotScan.ts` | CLI: corpus-driven scan for whitelist rot (the mining tool behind |
| `saveCdImpactScan.ts` | saveCdImpactScan.ts — "how big and how fast is this save cooldown, in the |
| `signalSkillGradientScan.ts` | signalSkillGradientScan.ts CLI — dumb shell over |
| `structuralCompletenessScan.ts` | Full-corpus measurement for the structural completeness predicate |
| `syncWindowScan.ts` | syncWindowScan.ts — corpus scan for the REDESIGNED missed-sync-window |
| `talentPickRateScan.ts` | talentPickRateScan.ts — how many players of each spec actually take each |
| `talentScriptedTouchScan.ts` | talentScriptedTouchScan.ts — GH #96 M6 step 2: which scripted talents name a |
| `teammateCrisisPriorScan.ts` | teammateCrisisPriorScan.ts — build the `teammate-crisis-idle` reference |
| `totemLifetimeScan.ts` | totemLifetimeScan.ts — how long does a totem actually stand, measured by its |
| `uwcCorpusScan.ts` | 薄壳:技能事实地基 Task 4(晕)+ 挂账清理 Task E(恐惧/心控)语料观测线 —— |

## Probes (value-gate experiments, `.claude/skills/signal-value-probe`) — 29

| Script | Note |
|---|---|
| `backlashDispelOutcomeProbe.ts` | GH #80 — backlash-dispel cost/benefit over the PvP log archive, and the |
| `burstMitigationOverlapProbe.ts` | burstMitigationOverlapProbe.ts — how long does the wall actually cover the |
| `coachCorpusArchiveProbe.ts` | Coach-corpus probes over the PvP log ARCHIVE (2026-09-11, user: "跑归档,不要 |
| `coachCorpusWeekendProbe.ts` | 三项预注册测量,一次遍历本机库(2026-09-11 夜,给周末人工处理用)。 |
| `coachCorpusWeekendProbe2.ts` | Coach-corpus weekend probe, batch 2 (2026-09-11 overnight). Measurement |
| `consequenceProbe.ts` | consequenceProbe.ts — GH #70 two-arm experiment: may the findings prompt |
| `crisisBurstShareProbe.ts` | crisisBurstShareProbe.ts — share of crisis decision points whose |
| `crisisEvidenceProbe.ts` | crisisEvidenceProbe.ts — step 1 of the temporal-evidence experiment (GH #94, |
| `crisisFollowUpProbe.ts` | crisisFollowUpProbe.ts — for healer crisis points judged "no response", |
| `crisisProcMarkerProbe.ts` | crisisProcMarkerProbe.ts — BACKLOG #43 step 1 (2026-09-17): "怎么认出这是 |
| `crisisUnlistedDefensiveProbe.ts` | crisisUnlistedDefensiveProbe.ts — GH #96 M4 (design D4): when crisis-no-response |
| `deepDiveCausalProbe.ts` | deepDiveCausalProbe.ts — GH #70 tail: align the deep-dive round's causation |
| `deepDivePositionProbe.ts` | Feasibility investigation for a positioning signal (deterministic): for every |
| `doubleDefensiveProbe.ts` | doubleDefensiveProbe.ts — GH #95 "给重了" in the user's strict sense |
| `drTeammateClashProbe.ts` | GH #67 · S3「队内递减类别归属」的价值门探针(2026-09-11)。不是产品判据。 |
| `findingsDeltaProbe.ts` | findingsDeltaProbe.ts — attribute a findings-prompt hash delta to the data |
| `kickPriorityOutcomeProbe.ts` | GH #78 — kick-priority decision points over the PvP log archive: outcome |
| `kickRangeProbe.ts` | kick-eaten 位置事实的**可行性探针**(go/no-go),不是产品代码。 |
| `ledgerImpossibleCastProbe.ts` | ledgerImpossibleCastProbe.ts — "the ledger said it was on cooldown, the |
| `outputTokenBudgetProbe.ts` | Output-token budget probe (GH #92, 2026-09-22). |
| `promptAblationProbe.ts` | Prompt 逐行效果探针 —— 「我们发给 LLM 的每一行,它到底怎么用?」 |
| `promptBaselinePlantProbe.ts` | SPEC BASELINES 聚合行植入探针 —— GH #36 第 1 项 ②(a): |
| `promptPlantProbe.ts` | 植入缺陷探针 —— 「prompt 里那半句结论词,模型会不会照单全收?」 |
| `signalOutcomeProbe.ts` | signalOutcomeProbe.ts — exploratory (2026-08-30): apply the "decision point |
| `teammateCrisisAnswerProbe.ts` | teammateCrisisAnswerProbe.ts — GH #95 step 1 (value gate: incidence and |
| `teammateCrisisProbe.ts` | GH #95 probe — teammate crises for a healer owner (user ruling 2026-09-13: |
| `teammateTimingProbe.ts` | GH #95 value-gate probe — teammate crises, TIMING shapes (user ruling |
| `trinketDisciplineProbe.ts` | GH #66 · B1 徽章纪律价值门探针 (Value-Gate Probe). |
| `unsyncedBurstScopeProbe.ts` | `unsynced-burst` 下架依据的**口径复查**(2026-09-07)。 |

## Example generators (real-match output examples for the value gate) — 13

| Script | Note |
|---|---|
| `cdPriorExampleGen.ts` | cdPriorExampleGen.ts — the Value-Gate rule 1 artefact for the `[CD PRIOR]` |
| `deepDiveOffensiveValueGen.ts` | Offensive deep-dive value A/B (generator). before = non-death findings get no |
| `deepDivePositionValueGen.ts` | Value eval for the positioning signal (fix 3) — generator. The "before" state |
| `externalDamageExampleGen.ts` | externalDamageExampleGen.ts — GH #91 (rule 171, split from #85) value-gate |
| `healerReachExampleGen.ts` | healerReachExampleGen.ts — value-gate example generator for GH #83 (owner ↔ |
| `kwV2ExampleGen.ts` | kwV2ExampleGen.ts — GH #31 ① value-gate example generator (THROWAWAY). |
| `offcdExampleGen.ts` | offcdExampleGen.ts — value-gate example generator (2026-09-02, THROWAWAY). |
| `psyfiendIgnoredExampleGen.ts` | psyfiendIgnoredExampleGen.ts — value-gate step 1 for the ACCUSATION half of |
| `shieldAtCrisisExampleGen.ts` | shieldAtCrisisExampleGen.ts — value-gate example generator (GH #100 |
| `summonExampleGen.ts` | summonExampleGen.ts — value-gate generator for GH #86 (user ruling |
| `tremorExampleGen.ts` | tremorExampleGen.ts — exploratory / historical value-gate generator (GH #100 direction 4, |
| `uncontestedSummonExampleGen.ts` | uncontestedSummonExampleGen.ts — value-gate example generator for BACKLOG #51's |
| `unitDestroyedExampleGen.ts` | unitDestroyedExampleGen.ts — value-gate example generator (GH #100 |

## Audits / captures / acceptance / A-B — 14

| Script | Note |
|---|---|
| `abPairSelect.ts` | A/B pair pre-selection (2026-09-12, GH #78/#80 100-pair rerun): walk a |
| `abStats.ts` |  |
| `acceptanceCapture.ts` | acceptanceCapture.ts — 归档日志上的验收采集(常驻,2026-09-02 从 scratchpad 的 |
| `acceptanceDpsCount.ts` | acceptanceDpsCount.ts — DPS 视角验收计数(常驻,2026-08-19 从 zz-tmp 转正)。 |
| `acceptanceHash.ts` | acceptanceHash.ts — 验收基准工具(常驻,2026-08-19 从 zz-tmp 转正)。 |
| `confidenceAudit.ts` | Candidate-evidence confidence audit (permanent tool, 2026-07-24): the |
| `decisionTraceCapture.ts` | decisionTraceCapture.ts — replay a manifest under ONE fact configuration and |
| `deepDiveOffensiveValueAudit.ts` | Offensive deep-dive value A/B — parse + audit + emit a blind-judging bundle. |
| `deepDivePositionValueAudit.ts` | Positioning-value eval — parse + audit + emit a blind-judging pack. The pack |
| `haloBuild.ts` |  |
| `haloCopyResponses.ts` |  |
| `haloStats.ts` |  |
| `modelFormatAudit.ts` | CLI: audit of the model output's SHAPE (the findings JSON path). |
| `postKickSwitchAudit.ts` | `postKick="switched"` 语义体检:**它到底在说「打穿了锁定」,还是「按了个瞬发」? |

## Everything else (CLI shells, one-offs, corpus tooling) — 42

| Script | Note |
|---|---|
| `ablationVocabJoin.ts` | ablationVocabJoin.ts — the deterministic half of a consumption probe: after |
| `absorbSemantics.ts` | absorbsIn semantics probe (coaching-grounding-audit D7). |
| `blindPool.ts` |  |
| `buildCalibration.ts` | CLI: Build judge calibration suite |
| `buildCorpus.ts` | CLI: Build healer prompt corpus from local WoW combat logs |
| `buildReviewSession.ts` | buildReviewSession.ts CLI — dumb shell over `../src/explore/buildSession.ts`. |
| `candidateDiagnostics.ts` | 候选类型体检:触发率 + 判别力。 |
| `cdPriorAblationCueCheck.ts` | cdPriorAblationCueCheck.ts — the targeted read behind the `[CD PRIOR]` |
| `checkCalibration.ts` | CLI: Check judge calibration |
| `checkProvenance.ts` |  |
| `contestedContract.ts` | F193 CONTESTED safety-contract assertions (backlog #4 reprise) -- run over |
| `coverageCorpus.ts` | A3 fixture-coverage corpus (verifiability roadmap): curate a **minimum |
| `decisionDiff.ts` | decisionDiff.ts — decision-level differential replay (GH #96 D6). |
| `demo37.ts` | #37 value-gate demo: build cells from real archive healer rounds through the |
| `durationCandidatesFromInventory.ts` | durationCandidatesFromInventory.ts — build a `durationTalentScan --candidates` |
| `evidenceDist.ts` | Corpus evidence (a permanent tool): run extractCandidateFindings over the |
| `familyBias.ts` | familyBias.ts CLI — D1 同族偏差 2×2 双差分(子项目 D)三子命令: |
| `fetchPublicLogs.ts` | CLI: fetch raw match logs where "the recorder is a DPS" from the public |
| `followupExamples.ts` | Value-gate examples for the follow-up wirings, from real archive rounds: |
| `healReachGroundTruth.ts` | healReachGroundTruth.ts — checks the reach / line-of-sight model behind the |
| `hpReconciliation.ts` | HP reconciliation residual: does the logged heal/damage stream explain the HP |
| `init.ts` |  |
| `interpolateResponses.ts` | interpolateResponses.ts — post-process findings-prompt responses the way the |
| `judgeVariance.ts` | CLI: Measure inter-judge variance on the calibration suite. |
| `kwDefCoverageCheck.ts` |  |
| `logCensus.ts` | logCensus.ts — full-manifest census of the combat-log archive (GH #100, |
| `logObservabilityPilot.ts` | Exploratory raw-log inventory, not a completeness or semantic-correctness gate. |
| `matchExplore.ts` | matchExplore.ts CLI — dumb shell over `../src/explore/{storeAccess,matchExplore}.ts` |
| `observedSpellIds.ts` | The corpus-observed spell id set (permanent, companion to update-wow-data): |
| `parserInvariants.ts` | Full-corpus scanning gate for the A2 parser invariants (verifiability |
| `pipelineFuzz.ts` | CLI: full-pipeline health check (fuzz/audit) over a thousand wild matches. |
| `plantAccuracyAb.ts` |  |
| `promptProbeCompare.ts` | 跨模型对照:把多个消融 run 的 raw.json 并成一张表。 |
| `qualityCheck.ts` |  |
| `recastGapHistogram.ts` | recastGapHistogram.ts — distribution of the gap between consecutive casts |
| `smokeFindingsPrompt.ts` | One-off smoke helper (2026-07-24 team-coordination candidate expansion): pick |
| `smokeTags.ts` | Real-model smoke for the new prompt facts ([MANA] / [IMMUNE] / [EMPOWER] / |
| `sycophancyEval.ts` | sycophancyEval.ts CLI — D2 问教练谄媚性(子项目 D)三子命令: |
| `tagPromptDump.ts` | Dump real new-season prompts containing the remaining new tags ([MANA] / |
| `talentCatalog.ts` | talentCatalog.ts — one row per talent in the game (class / spec / hero / PvP): |
| `talentScriptedTriage.ts` | talentScriptedTriage.ts — GH #96 M6: sort the talents that no compiler can |
| `teammateCrisisCards.ts` | teammateCrisisCards.ts — GH #95 step 3 (value gate 1, CLAUDE.md): print |
