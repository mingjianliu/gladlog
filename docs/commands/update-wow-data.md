# update-wow-data — Game Data Update Workflow

Refresh generated data in `packages/analysis/src/data/` when a new WoW retail build is released or during season updates.

## Steps

### 1. Check the Current Data Build

Read the `build` field in `packages/analysis/src/data/datagen-manifest.json` and record it as `CURRENT_BUILD` (if the file does not exist, consider a full update required).

### 2. Check the Latest Retail Build

GET `https://wago.tools/api/builds?branch=retail&product=wow`, take the highest `version`, and record it as `LATEST_BUILD`. If fetching fails, ask the user for the current latest build number.

### 3. Compare

`CURRENT_BUILD == LATEST_BUILD` → Report "Data is already up to date" and stop. Otherwise proceed.

### 4. Run Batch Datagen Generator by Generator (Sequential Execution, Stop on Failure)

Run from repo root. **`DATAGEN_BUILD` must first be pinned to `LATEST_BUILD` discovered in step 2**—
all generators resolve builds through a single source in `lib/wagoCsv.ts`'s `resolveBuild()` (CLI argument >
`DATAGEN_BUILD` > latest wago). Without pinning, if wago releases a new build mid-batch, mixed-build
artifacts will be produced; before 2026-08-11, `genSpellIcons` would also read an old build from the previous
round's manifest (the actual record of an entire batch of icons extracted from the wrong build can be seen in
09ae85b on that day). In addition, set `DATAGEN_CACHE` to reuse large table downloads:

```bash
export DATAGEN_BUILD=<LATEST_BUILD>
export DATAGEN_CACHE=$(mktemp -d)
# 1. Talent trees (raidbots; must run first — spellEffects candidate set reads talentIdMap)
npx tsx packages/analysis/scripts/datagen/fetchTalents.ts
# 2. Spell names (enUS compressed)
npx tsx packages/analysis/scripts/datagen/genSpellNames.ts
# 2b. Spell names zhCN (inline icon display name; depends on 6b icon table existing — move this step after 6b during full refresh)
npx tsx packages/analysis/scripts/datagen/genSpellNamesZh.ts
# 3. Spell effects base layer (PvP duration prioritized; candidate set = curated catalogs ∪ talents ∪ PvpTalent)
npx tsx packages/analysis/scripts/datagen/genSpellEffects.ts
# 4. PvP trinket item ids
npx tsx packages/analysis/scripts/datagen/genTrinketItemIds.ts
# 5. Talent CD modifier extraction
npx tsx packages/analysis/scripts/datagen/genTalentModifiers.ts
# 6. Spell -> class mapping
npx tsx packages/analysis/scripts/datagen/genSpellClassMap.ts
# 6b-pre. Observed spell ID universe (input for icons/offGcd; new season IDs come in via this)
#   Manifest contains absolute paths to logs; logs now reside in ~/gladlog-sync/logs (since
#   2026-08-11, old wowarenalogs/scratch path is dead and fully remapped eval-private ac3a6a2f).
#   Note the `>` redirection in this step: script failure will still truncate the output file first; recover with git checkout if it fails.
npx tsx packages/eval/scripts/observedSpellIds.ts \
  --manifest $GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt \
  --store ~/Library/Application\ Support/gladlog/matches \
  > packages/analysis/src/data/observedSpellIdsGenerated.json
# 6b-pre-2. Behavior-prior reference table (all ranked healers' crisis-decision-point responses, split responded/not, with death-within-10s rates; corpus-driven, NOT DB2).
#   Regenerate at season start and whenever packages/analysis/src/analysis/crisisDecisionPoints.ts changes.
#   ~1 h over the archive; run ≤3 shards with nice. Health test: packages/analysis/src/data/behaviorPrior.test.ts
#   ("every bracket star cell n ≥ 50") goes red when the season is too young — wait for more archive, do not lower the floor.
#   Rated Solo Shuffle cells count ANY friendly death (owner included) within 15 s instead of the owner's own death
#   within 10 s (spec §1c) — a healer diving to 40% in Solo Shuffle usually isn't the kill target.
E=$GLADLOG_EVAL_HOME; R=$E/reports/behavior-prior-$(date +%F); mkdir -p $R
find $E/corpus/archive-gz -name '*.txt.gz' | sort > $R/manifest.txt
for i in 0 1 2; do nice -n 10 npx tsx packages/eval/scripts/behaviorPriorScan.ts scan \
  --manifest $R/manifest.txt --ledger $E/archive/ledger --out $R/shard$i.jsonl \
  --offset $((i*7000)) --limit 7000 > $R/shard$i.log 2>&1 & done; wait
cat $R/shard*.jsonl > $R/opportunities.jsonl
#   Write temp-then-cp — never `>` directly into the imported json (a script failure truncates it first).
npx tsx packages/eval/scripts/behaviorPriorScan.ts emit-table --in $R/opportunities.jsonl \
  --corpus "wowarenalogs archive $(date +%F)" > $R/behaviorPriorGenerated.json \
  && cp $R/behaviorPriorGenerated.json packages/analysis/src/data/behaviorPriorGenerated.json
#   (the scan itself already filters to startTime >= PATCH_121_GOLIVE_EPOCH_MS; when the next
#   season ships, update that epoch first — it is the season gate.)
# 6b-pre-3b. Kill-window defensive-roster audit (GH #31 ②, 2026-09-02): the runtime predicate is the
#   curated KW_MAJOR_DEFENSIVE_IDS roster (abilityProfile.ts) — the official DB2 face was tried as the
#   runtime predicate and REVERTED (boolean absorbs admits 30s spam barriers; immuneSchools is
#   target-side; measured spans +12% / span-kill −5pp). The face's job is this AUDIT: each season run
#   packages/eval/scripts/kwDefAdmitScan.ts (face admissions beyond the roster, intersect with live
#   enemy casts via kwDefDiagScan.ts) and judge each hit by hand — 2026-09-02 run found Ancient of
#   Lore 473909 genuinely missing (added) while correctly rejecting Ice Barrier-class minors.
# 6b-pre-4. Sync-window reference table (GH #13 resurrection, 2026-09-02): per bracket, the share of
#   eligible enemy-healer hard-CC windows in which an enemy died within 15 s, split by whether a
#   friendly canonical offensive CD entered the window. Corpus-driven, NOT DB2.
#   Regenerate at season start and whenever the eligibility predicate in
#   packages/analysis/src/analysis/candidates/cooldownTiming.ts (missedSyncWindowEvents) changes —
#   missed-sync-window quotes these numbers and checkSyncWindowRefConsistency re-checks them plus the
#   >=3pp min-contrast door, so a stale table is a red CI. ~2 h over the archive; <=3 nice shards.
#   Write temp-then-cp — never `>` directly into the imported json.
# R=$GLADLOG_EVAL_HOME/reports/sync-window-$(date +%F); mkdir -p $R
# for i in 0 1 2; do nice -n 10 npx tsx packages/eval/scripts/syncWindowScan.ts scan \
#   --manifest <newseason manifest> --ledger $GLADLOG_EVAL_HOME/archive/ledger \
#   --out $R/shard$i.jsonl --offset $((i*N)) --limit N > $R/shard$i.log 2>&1 & done; wait
# cat $R/shard*.jsonl > $R/windows.jsonl
# npx tsx packages/eval/scripts/syncWindowScan.ts emit-table --in $R/windows.jsonl \
#   --corpus "wowarenalogs archive $(date +%F)" > $R/table.json \
#   && cp $R/table.json packages/analysis/src/data/syncWindowPriorGenerated.json
# 6b-pre-3. Enemy-burst-window reference table (GH #60, wired to the product 2026-09-01): per (bracket, lead CD), the
#   share of feasible burst windows in which a friendly died, split by whether the team answered
#   within 8 s, plus the responders' most common answers. Corpus-driven, NOT DB2.
#   Regenerate at season start and whenever packages/analysis/src/analysis/burstWindowDecisionPoints.ts
#   changes (that file's own header states the same red line) — the `slow-defensive-response`
#   candidate quotes these numbers and the checkBurstWindowRefConsistency gate re-checks them, so a
#   stale table is a red CI, not a silent drift. ~1 h over the archive; ≤3 nice shards.
#   NOTE the --out flag: emit-table writes a temp file and copies it in, so a crash cannot truncate
#   the json the product imports — do NOT replace it with a `>` redirection.
E=$GLADLOG_EVAL_HOME; R=$E/reports/burst-window-$(date +%F); mkdir -p $R
for i in 0 1 2; do nice -n 10 npx tsx packages/eval/scripts/burstWindowScan.ts scan \
  --manifest $E/corpus/manifest-archive-2026-08-28-newseason.txt --ledger $E/archive/ledger \
  --out $R/shard$i.jsonl --offset $((i*6045)) --limit 6045 > $R/shard$i.log 2>&1 & done; wait
cat $R/shard*.jsonl > $R/windows.jsonl
npx tsx packages/eval/scripts/burstWindowScan.ts report --in $R/windows.jsonl > $R/report.md
npx tsx packages/eval/scripts/burstWindowScan.ts emit-table --in $R/windows.jsonl \
  --out packages/analysis/src/data/burstWindowPriorGenerated.json \
  --corpus "wowarenalogs archive $(date +%F)"
# 6b-pre-4. Corpus-attested dispellable id set (dispelObservedGenerated.ts; gates the dispellability claim
#   behind missed-cleanse / missed-purge — "someone actually dispelled it in a real match", GH #32 kind
#   predicate). Corpus-driven, NOT DB2; additive across seasons ("hasn't happened ≠ can't happen"), so
#   feed it the union of the local 12.0 library manifest and the current-season archive manifest.
#   Single process, no shards: ~0.75 s per archive file (18k files ≈ 4 h, run it nice'd in the background);
#   the 70 local 12.0 logs at the top of the union (single files up to 375 MB) spike RSS to ~6 GB —
#   a transient peak, not a leak. Same `>` caveat as 6b-pre: write to a scratch file first, then copy in.
#   Afterwards re-run the batch's step 7 (writeManifest) — it counts this table's ids. (BACKLOG #24-5, 2026-09-01)
cat $GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt \
    $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt > /tmp/manifest-dispel-union.txt
nice -n 10 npx tsx packages/eval/scripts/confidenceAudit.ts --manifest /tmp/manifest-dispel-union.txt \
  --emit-table --date $(date +%F) > /tmp/dispelObservedGenerated.ts \
  && cp /tmp/dispelObservedGenerated.ts packages/analysis/src/data/dispelObservedGenerated.ts
# 6b-pre-6. Save-cooldown cohort trigger-HP table ([CD PRIOR] context fact; GH #54 (f) / BACKLOG #38 (a)(h),
#   user ruling 2026-09-04 option 1). Per (spec | hero tree | spellId): the median lowest-alive-friendly gridHpPct
#   at which healers of that cohort press that save cooldown, plus a spec-wide `|*|` roll-up. Corpus-driven, NOT DB2.
#   Regenerate at season start and whenever packages/analysis/src/analysis/cdTriggerPrior.ts (the observation
#   predicate) or cooldownTiming.ts' isSpendableDefensiveCd (the roster) changes. ~50 min over the archive as
#   3 nice shards. `report` prints the tree-vs-spec-wide and hi-vs-all deltas the cohort choice is made on;
#   `--cohort hi` (percentile >= 60 within bracket x ISO week) is the alternative to the default `all`.
#   Health test: packages/analysis/src/data/cdTriggerPrior.test.ts.
E=$GLADLOG_EVAL_HOME; R=$E/reports/cd-trigger-prior-$(date +%F); mkdir -p $R
for i in 0 1 2; do nice -n 10 npx tsx packages/eval/scripts/cdTriggerPriorScan.ts scan \
  --manifest $E/corpus/manifest-archive-2026-08-28-newseason.txt --ledger $E/archive/ledger \
  --out $R/shard$i.jsonl --offset $((i*6045)) --limit 6045 2> $R/shard$i.err & done; wait
cat $R/shard*.jsonl > $R/rows.jsonl
npx tsx packages/eval/scripts/cdTriggerPriorScan.ts report --in $R/rows.jsonl > $R/report.md
#   emit-table writes temp-then-cp itself; --out may point straight at the imported json.
npx tsx packages/eval/scripts/cdTriggerPriorScan.ts emit-table --in $R/rows.jsonl \
  --out packages/analysis/src/data/cdTriggerPriorGenerated.json --corpus "wowarenalogs archive $(date +%F)"

# 6b-pre-5. Kick school-lockout lengths (kickLockoutObservedGenerated.json; consumed by
#   kickLockoutSeconds → the [RES] `-Ns[kick]` field, the kick-eaten candidate's lockout fact and the
#   "dispeller was locked out" cleanse exemption). Corpus-driven, NOT DB2: a kick is Effect 68 with no
#   SpellDuration row, so the lockout is only observable — first same-school cast after SPELL_INTERRUPT,
#   0.5 s-bin mode. Every 30th archive file is enough (≈600 files, ~1 min, 5k+ pairs); ids under 20 pairs
#   keep the 3 s fallback. Season-dependent (12.1: Counterspell 6, Spell Lock 5, Quell 4, Wind Shear 2,
#   melee kicks 3), so re-run per season and diff the entries. Then re-run step 7 (writeManifest). (GH #62)
npx tsx packages/eval/scripts/kickLockoutScan.ts \
  --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt --every 30
# 6b. Spell icon names (desktop swimlane/replay icons; SpellMisc -> ManifestInterfaceData;
#     universe = observed ∪ SpellCooldowns ∪ candidates; do not revert to full table — 13.8MB busts initial render budget)
npx tsx packages/analysis/scripts/datagen/genSpellIcons.ts
# 6c. PvP talent replacement table (PvpTalent.OverridesSpellID; consumed by cd-waste ledger)
npx tsx packages/analysis/scripts/datagen/genPvpTalentReplaces.ts
# 6d. PvP talent pool (PvpTalent SpecID/SpellID/ActionBarSpellID; consumed by talentOwnershipOf)
npx tsx packages/analysis/scripts/datagen/genPvpTalentPool.ts
# 6e. DR category table (SpellCategories.DiminishType; consumed by drAnalysis, aura ID key)
npx tsx packages/analysis/scripts/datagen/genDrCategories.ts
# Per-spell reach (cast range / area radius) for the ally-castable defensives —
# GH #34 ②: feeds deathOutcomeAnalysis's "could a teammate have thrown it"
# distance check; id universe = externalDefensiveSpellIds. Darkness 196718 has
# no radius in DB2 (stays on the hand fallback in code).
npx tsx packages/analysis/scripts/datagen/genSpellReach.ts
# 6f. off-GCD active abilities table (SpellCooldowns StartRecoveryTime==0; consumed by swimlane folding)
npx tsx packages/analysis/scripts/datagen/genOffGcd.ts
# 6g. Damage mitigation table (#17 foundation; whitelist = big ∪ external 35 items, curated overrides in mitigationData.ts)
npx tsx packages/analysis/scripts/datagen/genMitigation.ts
# 6g2. Talent-granted damage reduction (2026-08-18; zhCN tooltip predicate over the talent universe
#      incl. the PvP pool; two positive controls throw on failure — 473909 知识古树 / 431873 瞬息之隔.
#      Registered in the manifest but MISSED by the 69382 season refresh because this runbook lacked
#      the line — the manifest records artifacts, only this file drives regeneration.)
npx tsx packages/analysis/scripts/datagen/genTalentMitigation.ts
# 6h. Usable while CC'd table (B1; SpellMisc.Attributes bitwise union search, anchored to usableWhileCcAnchors.ts;
#     only stunned dimension converges to a unique bit combination; feared/confused are known gaps — see generated file header
#     comments and task-3-report.md. 2026-08-14 correction: cooldowns.ts USABLE_WHILE_CC_SPELL_IDS
#     has migrated since Task 5 to "stunned generated set ∪ unconditional manual gap layer"; the overall semantics are stunned-
#     specific, no longer the old model of "handwritten layer backstopping feared/confused" — feared/confused currently have no
#     ground-truth layer; consumers (wasLockedOutByStunOnly, etc.) handle each CC type separately: only query this table during pure stunned
#     lockout windows; non-stun hard CCs (fear/disorient/incap) are unconditionally forgiven and must not be evaluated against
#     the stunned table. Non-zero exit = stunned no longer converges; rerun anchoring/bit search from scratch,
#     do not relax criteria to force table generation)
npx tsx packages/analysis/scripts/datagen/genUsableWhileCc.ts
# 6i. Official targeting flags (GH #28; SpellEffect.ImplicitTarget over the mined universe —
#      "does pressing this reach a friendly unit other than the caster". Consumed by
#      cooldowns.ts's canHelpAnotherUnit, which gates every "you had X and your teammate
#      died" surface. The script asserts BOTH directions of ground truth before it writes:
#      every externalDefensiveSpellIds entry must come out ally-reaching, and a control set
#      of personal defensives must come out self-only. Non-zero exit = a patch introduced a
#      SpellImplicitTarget value the decode table does not know; add it there with evidence,
#      do NOT relax the assertion.)
npx tsx packages/analysis/scripts/datagen/genSpellTargeting.ts
# 6j. Official school / immunity facts (GH #29 阶段 1; SpellMisc.SchoolMask +
#      SpellEffect aura 39/77 —— 「这法术是什么学派」与「这个免疫挡哪些学派/机制」。
#      消费方 data/spellSchools.ts 的 immunityCoversSpell,给 cc-avoidable 判定
#      「你本可以用 X 躲这个控」。非零退出 = 学派/免疫真值对照组不匹配(如
#      保护祝福不再是纯物理免疫),按实测改对照组,不要放宽断言。)
npx tsx packages/analysis/scripts/datagen/genSpellSchools.ts
# 6k. Ability effect facts (GH #29 阶段 2 地基;SpellEffect aura69 吸收 /
#      Effect 10,136 + aura 8,20 治疗(按 ImplicitTarget 分自愈与他愈)/ aura118,259
#      受治疗增益 / aura31 加速。消费方 data/abilityProfile.ts。非零退出 = 正反
#      对照组不匹配(如自由祝福的 0 点 aura31 死槽又被当成加速),按实测改规则,
#      不要放宽断言。)
npx tsx packages/analysis/scripts/datagen/genAbilityEffects.ts
# 7. Manifest summary
npx tsx packages/analysis/scripts/datagen/writeManifest.ts
```

If any script exits non-zero: display error, stop, and report to the user; do not proceed with subsequent scripts.

### 4b. Empirical Verification of Official Tables (2026-07-25 Lesson: Official ≠ Exemption from Verification)

Official DB2 tables themselves may be incomplete or link fields to incorrect IDs: SkillLineAbility lacks 12.x modern
trait abilities (a pure spellbook gate will falsely eliminate 20+ real keybinds like Cleanse/Penance); DR/dispel
fields link to **aura IDs**, whereas manual tables often write cast IDs (Shockwave 46968 dead entry). After introducing or
refreshing any official criteria, measure error rates in both directions on real corpus (manual review of false-positive list +
spot checks of false-negatives) before applying, with accompanying re-scans: parserInvariants / confidenceAudit / evidenceDist.

### 5. Curated Catalog Validation (Manual Adjudication Gate)

```bash
DATAGEN_CACHE=$DATAGEN_CACHE npx tsx packages/analysis/scripts/datagen/validateCatalogs.ts
```

Non-zero exit = curated IDs invalidated in the new build. Adjudicate manually item by item:

- Spell removed but still needed for historical logs → Add to `KNOWN_REMOVED_SPELLS` in `validateCatalogs.ts` (note spell name and adjudication date)
- Spell renamed / ID changed → Fix corresponding curated catalog
- Catalog typo → Fix catalog

### 6. Regression Gate

```bash
npm test --workspaces && npm run typecheck --workspaces --if-present
```

### 7. Whitelist Rot Check (Corpus Coverage Regression)

New builds often accompany ability reworks / ID changes, causing curated whitelists to rot silently (2026-07 spec-level audit:
Frost Mage / Windwalker / Survival Hunter none-tracked rate was 100%, root cause was entirely reworks). After data refresh, rebuild sample prompts on recent
corpus and check two rates:

```bash
# Enemy CD tracking gap: calculate none-tracked rate by spec (check denominator! Absolute numbers can be deceptive)
grep -rB6 "<cooldowns>none tracked" <runDir>/prompts | grep -o 'spec="[^"]*"' | sort | uniq -c | sort -rn
# DR category gap: any [DR: spell:<id> fallback rendering indicates missing mapping
grep -rho "\[DR: spell:[0-9]*" <runDir>/prompts | sort | uniq -c
```

If any spec rate spikes → Supplement via "corpus empirical evidence" workflow: mine SPELL_CAST_SUCCESS for that spec to find new
burst IDs (filtering with CD data will **happen to miss new IDs**; inspect unfiltered top first, then add overrides;
CD/duration measured empirically from corpus: min inter-cast gap / median buff applied→removed).
Known expected gaps (do not falsely report): Retribution Radiant Glory passive AW, Enhancement Doom Winds per-strike
proc — cast-type trackers cannot resolve these; commented in spellCategories.ts.

Must be all green. If step 4a data calibration assertions fail due to new data: prioritize manually calibrated values → add correct values into `SPELL_EFFECT_OVERRIDES` (override layer always wins), do not modify tests.

### 7b. Reverse Pass — Curated Lists vs. the Current Season's Corpus (2026-08-21)

Step 7 and the completeness check in the Notes are the **forward** direction (the corpus uses an id no list
knows). The reverse direction — a list asserts an id the corpus **never shows** — is the GH #23 shape (a patch
renumbered Unstable Affliction; `DISPEL_PENALTY_SPELLS` kept the dead ids looking authoritative for a whole
expansion). It is one set intersection per table, and it is now a standing tool:

```bash
# 1. Observed ids of the CURRENT season only (not the cumulative universe — that still carries every id ever
#    seen and hides staleness). The PvP archive manifest lists .gz files; the script gunzips in memory.
npx tsx packages/eval/scripts/observedSpellIds.ts \
  --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt \
  > $GLADLOG_EVAL_HOME/corpus/observedSpellIds-S<n>-archive-<date>.json
# 2. Every hand-maintained spell-id table (data/curatedIdRegistry.ts, 60 tables) against that set
npx tsx packages/eval/scripts/curatedRotScan.ts \
  --observed $GLADLOG_EVAL_HOME/corpus/observedSpellIds-S<n>-archive-<date>.json \
  --baseline packages/analysis/src/data/observedSpellIdsGenerated.json \
  --md $GLADLOG_EVAL_HOME/reports/curated-rot-<date>.md
# 3. Forward checks with the same observed set: CC ids the official DR table has and the corpus shows, but
#    SPELL_CATEGORIES doesn't classify (→ [CC] labels / cc-cooldown candidates blind); and the dispel
#    ground truth vs getDispelType (the awk extraction from the Notes below, over .gz via gzip -dc).
npx tsx packages/eval/scripts/drGapScan.ts $GLADLOG_EVAL_HOME/corpus/observedSpellIds-S<n>-archive-<date>.json
npx tsx packages/eval/scripts/dispelCompletenessScan.ts <dispel-counts.txt>
# 4. Official durations vs the game (GH #44 tail, 2026-09-02): every CC / root id's observed aura lifetime
#    (APPLIED→REMOVED, 0.5 s-bin mode) against ccFullDurationSeconds (DB2 PvP duration + CORPUS_DURATION_PATCHES).
#    ~1 min on every 30th archive file. A FLAG row is a ruling question — DB2 wins unless the corpus contradicts it
#    this clearly (Binding Shot 2 s vs 3.0 s ×1084 was the one that did); fix goes into CORPUS_DURATION_PATCHES.
npx tsx packages/eval/scripts/ccLifetimeScan.ts \
  --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt --every 30
```

npm aliases for the same three (identical flags): `npm run -w @gladlog/eval scan:rot` ·
`scan:dr-gap` · `scan:dispel`.

Read the report top-down: `gone` rows (in the baseline universe, absent this season) are the renumber
signature and get adjudicated first; `never` rows are either wrong-from-day-one or ids that legitimately don't
log as events (talent ids, passives). A table at 100% stale is the GH #23 case. When you add a new hand table
of spell ids anywhere in `packages/analysis`, register it in `curatedIdRegistry.ts` — the registry is the
index, and the rule was never the missing piece.

### 7c. Standing Prompt-Level Scans (Shared-Predicate Audits)

Steps 7/7b audit the **id tables**. These three audit the **rendered prompt** and are equally standing
— run them after any data refresh, and after any change to the candidate menu or the timeline.
Their `--prompts` / `--dir` argument is an **A/B run's `prompts/` directory** (e.g.
`$GLADLOG_EVAL_HOME/ab/<abId>/treatment/prompts`), **not** the `runs/<runId>` root and not the arm
root — pointing at the arm root finds zero `.txt` files and exits 1, which reads like "clean".

```bash
# 1. crisis-HP ⟺ same-second [STATE] tick (11th hardFailure class; flag is --prompts, not --dir)
npx tsx packages/eval/scripts/crisisHpStateScan.ts \
  --prompts "$GLADLOG_EVAL_HOME/ab/<abId>/treatment/prompts" [--examples 5]
# or: npm run -w @gladlog/eval scan:crisis-hp -- --prompts <prompts-dir>

# 2. candidate-menu time facts vs fmtTime-floored timeline markers (13th hardFailure class)
npx tsx packages/eval/scripts/menuTRenderGridScan.ts \
  --dir "$GLADLOG_EVAL_HOME/ab/<abId>/treatment/prompts"
# or: npm run -w @gladlog/eval scan:menu-t -- --dir <prompts-dir>
```

Both re-run the _same_ function their hard-failure gate calls (`crisisHpStateProbes`,
`scanMenuTRenderGrid` in `promptQualityCheck.ts`) — there is no second implementation to drift.
The gate answers pass/fail on one prompt; these answer "how many, of what type, and here are
examples" over a whole corpus, which is what a before/after number needs.

**3. `signalOutcomeProbe.ts` — outcome reference probe for coaching signals.**
**Not on `main`.** It lives on branch `probe/signal-outcomes` at `abdf08df`; check that branch out to
run it. It walks the archive corpus (3,000 matches / 272,841 decision points in the 2026-08-30 run)
and asks, per signal, whether the thing the signal fires on actually precedes a worse outcome —
the instrument that replaced seven-dimension baselines for signal keep/retire rulings. Output landed
in `$GLADLOG_EVAL_HOME/reports/signal-outcomes-2026-08-30/`. Run it whenever a new season's data
could have moved a signal's grounding, and read it next to
[`docs/coaching-grounding-audit.md`](../coaching-grounding-audit.md).

### 8. Summary

```bash
git diff --stat packages/analysis/src/data/
```

Report: changed files, old/new builds, key counts (number of mined entries, talentModifiers ability count, spec count). Note the build number in the commit message.

## Notes

### Candidate-list completeness (2026-08-17/18 — read this before trusting any "official data covers it" claim)

Three generators (`genSpellEffects`, `genSpellClassMap`, `genSpellIcons`) mine DB2 only for ids returned by
`lib/candidates.ts`'s `collectCandidateIds`, and `genTalentModifiers` filters its output through its own
`trackedSpellIds`. Both lists are assembled from HAND-MAINTAINED tables. That makes them part of the predicate:
a spell nobody listed is not "absent from Blizzard's data", it is **never asked about**, and downstream that is
indistinguishable from "the game says no".

Both lists now include `observedSpellIdsGenerated.json` (corpus-observed ids) as a source — keep it that way, and
when adding a new generator of this shape, include it from the start. See CLAUDE.md's **Curated-List Completeness
Rule** for the measured cost (76.5% of all corpus dispels were invisible).

**The completeness check** (re-run it whenever a list changes): pull the ground truth out of raw.txt and ask what the
official path fails to explain, e.g. for dispels —

```bash
# every cross-unit DEBUFF dispel performed by a real dispel ability, by removed spell id
find "$GLADLOG_MATCH_DIR" -maxdepth 2 -name raw.txt -print0 | xargs -0 grep -h "SPELL_DISPEL" \
  | awk -F',' '$2 != $6 && $16 ~ /DEBUFF/ {print $13"|"$14"|"$10"|"$11}' | sort | uniq -c | sort -rn
```

then cross-reference the removed ids against `spellEffectGenerated.json`'s `dispelType`. Note the same file also
records self-removals — Disengage / Master's Call / Tiger's Lust / Rescue strip snares and are logged as
`SPELL_DISPEL` too, so filter to cross-unit (`$2 != $6`) and check the casting ability before concluding anything.

### DB2 gotchas found the hard way

- **`SpellCategories.DispelType` enum**: 1=Magic, 2=Curse, 3=Disease, 4=Poison, **11=Bleed**, 9=Enrage
  (soothe/Tranquilizing Shot territory — an OFFENSIVE dispel, not a defensive cleanse). 11 was missing from
  `genSpellEffects`'s map until 2026-08-18, so the whole Bleed branch (`BLEED_REMOVERS`, `canDefensiveCleanse`'s
  Bleed case) was dead code with no data to feed it.
- **Signs are meaningful — never `Math.abs` a cooldown effect.** `EffectBasePointsF` is negative for a reduction and
  positive for an INCREASE. Celerity (115173) → −5000 = Roll −5s; Unyielding Will (457574) → +20000 = Anti-Magic
  Shell **+20s** (wowhead: "increases its cooldown by 20 sec"). Stripping the sign turned that into a −20s
  reduction — a 40s error in the wrong direction, which would have the ledger claim AMS was ready 40s early.
- **Hero talents live in `heroNodes` / `subTreeNodes`**, not `classNodes`/`specNodes`. Any scan that walks only the
  latter two silently drops every hero talent (build 12.1.0.69273: 695 of them, carrying 44 CD/charge effect rows).
- **Charge abilities carry their cooldown as a charge-recovery aura** (`EffectAura=453`, `MiscValue_0` = the
  ChargeCategory, matched via the charge-category path), not as a `SPELLMOD_COOLDOWN` flat mod.
- **PvP variants usually get their own spell id** rather than a PvP-specific cooldown column (there is none in
  `SpellCooldowns`). Bloodlust: PvE `2825` = 40s/300s and is rejected in arena (corpus: 3 occurrences, all
  `SPELL_CAST_FAILED`); the usable PvP-talent version is `204361` = 10s/60s. Durations DO have a PvP column and
  `genSpellEffects` already prefers `PvPDurationIndex`.

### Talent lookups

`murlok.io` (note the spelling — not "murloc") serves per-spec talent pages with usable effect text, e.g.
`https://murlok.io/evoker/preservation/talents`. wowhead spell pages are JS-rendered and WebFetch reads only the
shell — the "cooldown" it returns is the cast time/GCD, not the real cooldown; use wowhead via search-result
snippets or the DB2 CSVs instead.

- Override layer maintenance tax (final judgment by spec on record): PvP durations / server-side modifiers are not encoded in DB2; when deviations are found, add `SPELL_EFFECT_OVERRIDES` entries in place.
- `spellNames.json` at 12MB is expected; optimizing slow dev initial load is a separate matter.
- Icons are fetched at runtime + cached to disk, not involved in data updates.
