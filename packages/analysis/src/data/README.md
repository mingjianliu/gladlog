# `packages/analysis/src/data` — index

_English-only developer index, generated 2026-09-26 (`git log -1 -- <file>` for provenance). Generated files carry the `Generated` suffix (or are `datagen-manifest.json`) and are rewritten by the season runbook `docs/commands/update-wow-data.md`; everything else is hand-maintained and, if it is an id table, must be registered in `curatedIdRegistry.ts` (CLAUDE.md Curated-List Completeness Rule). Tests for this folder live next to the files (`*.test.ts`)._

42 generated · 57 hand-maintained · 22.3 MB total (spellNames.json and talentIdMap.json are lazy-loaded, see `ensure.ts`).

## Generated (do not edit by hand)

| File | Size | Note |
|---|---|---|
| `abilityEffectsGenerated.json` | 92 KB |  |
| `abilityEffectsGenerated.ts` | 2 KB | datagen output |
| `backlashDispelPriorGenerated.json` | 1 KB |  |
| `behaviorPriorGenerated.json` | 4 KB |  |
| `burstWindowPriorGenerated.json` | 50 KB |  |
| `ccCloseInGenerated.json` | 2 KB |  |
| `cdRecastFloorGenerated.json` | 8 KB |  |
| `cdTriggerPriorGenerated.json` | 18 KB |  |
| `datagen-manifest.json` | 5 KB |  |
| `dispelObservedGenerated.ts` | 10 KB | Corpus-attested dispellable id set (GENERATED — do not hand-edit): spellIds |
| `drCategoriesGenerated.ts` | 19 KB | datagen output |
| `healerSaveCdGenerated.json` | 40 KB |  |
| `hotfixOverlayGenerated.json` | 18 KB |  |
| `interruptKitGenerated.json` | 5 KB |  |
| `kickLockoutObservedGenerated.json` | 2 KB |  |
| `kickLockoutObservedGenerated.ts` | 2 KB | Corpus-observed school-lockout length per kick id (GENERATED — do not |
| `kickPriorityHealSpellsGenerated.json` | 1 KB |  |
| `kickPriorityPriorGenerated.json` | 402 B |  |
| `mitigationGenerated.json` | 2 KB |  |
| `observedSpellIdsGenerated.json` | 42 KB |  |
| `offGcdGenerated.ts` | 4 KB | datagen output |
| `pvpTalentPoolGenerated.ts` | 11 KB | datagen output |
| `pvpTalentReplacesGenerated.ts` | 861 B | datagen output |
| `specIconsGenerated.ts` | 2 KB | GENERATED — do not hand-edit. Produced by |
| `spellClassMapGenerated.ts` | 10 KB | datagen output |
| `spellEffectGenerated.json` | 639 KB |  |
| `spellEffectGenerated.ts` | 462 B | datagen output |
| `spellIconsGenerated.json` | 803 KB |  |
| `spellIconsGenerated.ts` | 812 B | datagen output |
| `spellManaCostGenerated.json` | 22 KB |  |
| `spellMechanicsGenerated.json` | 202 KB |  |
| `spellNamesZhGenerated.json` | 983 KB |  |
| `spellReachGenerated.json` | 219 KB |  |
| `spellSchoolsGenerated.json` | 142 KB |  |
| `spellSchoolsGenerated.ts` | 2 KB | datagen output |
| `spellTargetingGenerated.json` | 78 KB |  |
| `spellTargetingGenerated.ts` | 1 KB | datagen output |
| `syncWindowPriorGenerated.json` | 1 KB |  |
| `talentEffectInventoryGenerated.json` | 3610 KB |  |
| `talentMitigationGenerated.json` | 14 KB |  |
| `teammateCrisisPriorGenerated.json` | 3 KB |  |
| `usableWhileCcGenerated.ts` | 13 KB | datagen output |

## Hand-maintained

| File | Size | Note |
|---|---|---|
| `abilityProfile.ts` | 9 KB | 一个技能的**功能画像** —— GH #29 阶段 2 的地基。 |
| `arenaGeometry.ts` | 22 KB | Arena obstacle geometry for line-of-sight checks. |
| `backlashCc.ts` | 2 KB | Dispel-backlash CCs — the ONE table for "which aura lands on a dispeller as a |
| `backlashDispelPrior.ts` | 7 KB | Backlash-dispel reference (corpus-derived, GENERATED json) — GH #80, user |
| `behaviorPrior.ts` | 6 KB | Behavior-prior reference (corpus-derived, GENERATED json): outcome-based |
| `benchmarks.json` | 71 KB |  |
| `burstWindowPrior.ts` | 6 KB | Enemy-burst-window reference (corpus-derived, GENERATED json) — GH #60 |
| `candidateTypeFlags.ts` | 1 KB | Candidate type flags — DERIVED from `candidateTypeRegistry.ts`, never edited |
| `candidateTypeRegistry.ts` | 29 KB | CANDIDATE TYPE REGISTRY — the one table every "is this candidate type live?" |
| `castParamDurations.ts` | 3 KB | Auras whose length is set by a parameter OF THE CAST that produced them — |
| `cdTriggerPrior.ts` | 4 KB | Save-cooldown trigger-HP reference (corpus-derived, GENERATED json) — the |
| `classSpells.ts` | 11 KB | Per-class catalog of major abilities (a compliant replacement for the old |
| `curatedAbilityFacts.ts` | 23 KB | 非官方技能事实签字册(B2,2026-08-14 起正式制度)。 |
| `curatedIdRegistry.ts` | 23 KB | Registry of every HAND-MAINTAINED table keyed by (or containing) WoW spell |
| `discoveryRules.ts` | 725 B | Keywords used to intelligently tag dynamically discovered spells. |
| `dispelVerdicts.ts` | 10 KB | 防御驱散裁定册 —— 「这个 debuff 落在这种角色身上,值不值得花 GCD 驱」。 |
| `drCategories.ts` | 1 KB | DR (diminishing returns) category table. |
| `ensure.ts` | 2 KB | The large data tables (spellNames 12MB / talentIdMap 1.6MB) load in the |
| `healerSaveCd.ts` | 4 KB | Healer SAVE-cooldown roster (corpus + official data, GENERATED json) — |
| `healingVerdicts.ts` | 15 KB | 治疗裁定册 —— 「爆发已经打在脸上,按这个技能算不算一个答案」。 |
| `kickPriorityHealSpells.ts` | 1 KB | Corpus-level table of the healing spells enemy healers HARDCAST in arena |
| `kickPriorityPrior.ts` | 3 KB | Kick-priority reference (corpus-derived, GENERATED json) — GH #78, user |
| `kickedSpellCategories.ts` | 3 KB | Classification of interrupted spells into functional categories (GH #79, BACKLOG #36(f) / B4). |
| `mitigationComponents.ts` | 7 KB | Mitigation components + the one resolver every consumer prices through — |
| `mitigationData.ts` | 13 KB | Damage reduction percentage, 0-100; immunities = 100. |
| `mitigationVerdicts.ts` | 20 KB | 减伤裁定册 —— 「对面交了这个,你还该不该继续打」。 |
| `observedSpellIds.ts` | 259 B | spellIds observed across the corpus (strings, matching the repo-wide id |
| `outcomeRefs.ts` | 2 KB | Corpus-wide OUTCOME references for candidate types (2026-08-30 outcome |
| `racialAbilities.ts` | 10 KB | Racial abilities (2026-08-12). The combat log carries NO race field — |
| `specNames.ts` | 3 KB | Spec display tables shared by the desktop renderer and eval scripts. |
| `spellCategories.ts` | 25 KB | Minimal PvP spell category dataset (a compliant replacement for |
| `spellEffectData.ts` | 67 KB | Dispel type from SpellCategories.db2. null or undefined means the aura cannot be dispelled. |
| `spellEffectOverrides.ts` | 23 KB | A hand-curated minimal spell-effect dataset (the compliant replacement for |
| `spellIdLists.ts` | 6 KB | Spell id lists (a compliance-safe replacement for spellIdLists.json — the |
| `spellManaCost.ts` | 2 KB | Per-spell mana cost lookup (BACKLOG #26 Task 4, raw-streams plan): |
| `spellNameLookup.ts` | 2 KB | English spell name → candidate id list (ascending). Only ids that have an |
| `spellNameStopwords.ts` | 3 KB | Stopword list for the English spell-name inverted index (englishNameIndex() |
| `spellNameZhLintStopwords.ts` | 4 KB | Explicit denylist for spellNameZhLint -- these are NOT "candidates awaiting |
| `spellNameZhLintTable.ts` | 5 KB | Official zh localized spell name -> EN spell name (the lookup table used by |
| `spellNames.json` | 11955 KB |  |
| `spellNamesZh.ts` | 414 B | zhCN ability names (a datagen artifact, limited to the intersection of the |
| `spellReach.ts` | 2 KB | Official per-spell reach (GENERATED json, DB2 SpellMisc.RangeIndex → |
| `spellSchools.ts` | 4 KB | 「这个免疫挡不挡得住那个法术」——官方学派掩码,一个谓词。 |
| `spellTags.ts` | 3 KB | The official DR `silence` category (DB2) — what counts as a SILENCE, as |
| `spellTargeting.ts` | 3 KB | "Can pressing this spell help somebody other than the caster?" — one |
| `spellTypes.ts` | 1 KB | Spell tag enum (originally defined in this repository). |
| `syncWindowPrior.ts` | 5 KB | Sync-window reference (corpus-derived, GENERATED json) — the GH #13 |
| `talentIdMap.json` | 3154 KB |  |
| `talentMitigationModifiers.ts` | 6 KB | Talent value-modifiers on MITIGATION_TABLE auras — GH #96 M3b (design |
| `talentModifiers.json` | 145 KB |  |
| `talentNames.ts` | 757 B |  |
| `talentStrings.ts` | 4 KB | Loaded in the background rather than with a top-level await (same reason as |
| `teammateCrisisPrior.ts` | 5 KB | Corpus reference for the `[MATE CRISIS]` observation card (GH #95, |
| `timelineLineFlags.ts` | 3 KB | Switches for timeline lines that ship with a measured alternative, so an |
| `trinketItemIds.json` | 831 B |  |
| `warlockPets.ts` | 2 KB | Warlock pets by what they DO (GH #86, user ruling 2026-09-22: most summons |
| `zoneMetadata.ts` | 1 KB | Arena zone name table (the compliant replacement for the old |
