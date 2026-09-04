# gladlog feature backlog

Ideas not yet scheduled. Each is a starting point for a future brainstorm → spec →
plan cycle, not a committed design. Compliance: where an item references the old
fork (`/Users/mingjianliu/code/wowarenalogs`, CC BY-NC-ND) it's for the _concept_
only — any port is clean-room (controller extracts audit-CLEAN files; the app's
data is already gladlog-native).

---

> Completed items (#2-13, #15, #16, #20, multi-model, spellNames, etc.) have been moved to
> [BACKLOG-archive.md](BACKLOG-archive.md), retaining original numbering and landing notes.

> **Numbering warnings — read before citing a bare `#N`.**
>
> 1. **This file's numbers and GitHub issue numbers are different namespaces.** They
>    overlap and mean different things: BACKLOG #24 vs GH #24, BACKLOG #25 vs GH #25,
>    BACKLOG #26 vs GH #26 are three unrelated pairs. Write `BACKLOG #N` or `GH #N`
>    — never a bare `#N` — in commit messages, code comments and reports.
>    **2026-08-26:全部未完条目已镜像到 GitHub issues(#37–#54)。** 本文件保留为
>    详细背景的单源,**新增待办请直接开 GH issue**;镜像映射:
>    #1→GH37 · Session follow-ups→GH38 · #17残→GH39 · #18→GH40 · #19→GH41 ·
>    #21→GH42 · #14→GH43 · #24(12.1批)残→GH44 · #25残→GH45 · #30残→GH46 ·
>    #29→GH47 · #31→GH48 · #33→GH49 · #34→GH50 · #35→GH51 · #36→GH52 ·
>    #37→GH53 · #38→GH54。
>    巡检时判定**已完成、待迁档**的条目(未建 issue):#22(2026-08-20 用户裁定长期保留,
>    终结 TEMPORARY 身份)· #23(GH #8/#9/#11 均结)· #24(dr reverse,2026-08-14 修)·
>    #26(rawStreams 落地,#40 5/5)· #27(2026-08-14 挂账批修)· #28(auraIntervals
>    权威构建器收口)· #32(FIXED 2026-08-16)· #39 · #40。
>
> 2. **`## 24.` appears twice below** (the 12.1/S2 data wrap-up batch, and the `dr`
>    reverse-query fix). Both are already cited from source: bare `#24` in
>    `drAnalysis.ts` / `dispelVerdicts.ts` / `drOutgoingCCReverse.test.ts` means the
>    **`dr` reverse** entry, while `#24-1` / `#24-2` / `#24-8` mean **sub-items of the
>    12.1/S2 batch**. Renumbering either one now would invalidate those comments, so
>    the collision is documented rather than silently resolved — resolving it properly
>    is a deliberate change that has to touch those files too.

## 1. OBS / video recording integration

Record arena matches (video) and sync playback to the combat-log timeline — click
a death / finding / burst window and jump to that moment in the video.

> **2026-07-27 evaluation complete (not yet approved)**: three approaches (external control via obs-websocket / embedded noobs /
> two-phase) + seam-by-seam verification + risk inventory documented in
> `docs/plans/2026-07-27-obs-recording-integration-eval.md`, leaning toward two-phase starting with external control.
>
> **2026-07-28 phase 1 started (approach C approved)**: external control via obs-websocket, `feature/obs-recording`
> branch; plan at `docs/plans/2026-07-28-obs-recording-phase1-plan.md`. All unit tests green;
> real-machine (Windows + OBS) end-to-end awaiting user testing.

- **Old-fork reference:** `packages/recorder` (OBS bindings — `manager.ts`,
  `noobs.d.ts`, `activity.ts`, config schema) and the playback UI in
  `packages/shared/src/components/CombatReport/CombatVideo/VideoPlayerTimeline.tsx`
  - `CombatReplay/`. The roadmap explicitly deferred the recorder ("not in v1"),
    so this is net-new work in gladlog.
- **Scope signals:** largest item here — a recorder subsystem (native OBS/noobs
  integration, Windows-first), on-disk video↔match association, and a
  video-timeline component. Likely its own multi-task sub-project. Decide first:
  drive OBS externally vs. embed a capture lib; how video files map to stored
  matches (by timestamp window).
- **gladlog seam:** the desktop app already stores matches with `startTime`/
  `endTime`; a recording started around a match window can be associated by time.

## Session follow-ups & hardening (smaller, not full features)

- **SP-A.1** — LLM-judge causal audit + digit/constant refinement (deferred from
  the SP-A honesty gate; causal/qualitative claims can't be verified
  deterministically).

- **Timeline-prompt token compression** — the timeline-variant prompt is ~76%
  larger than the sparse one; compress it (also helps the slow `claude -p` local
  backend).

- **CI code-signing / notarization** — wire macOS notarization + Windows signing
  secrets into `.github/workflows/build.yml` when certs exist, for zero-warning
  installs. See [[gladlog-packaging-gotchas]].

- **MatchStore hardening (accepted-low-risk today)** — `safeName` id collision →
  phantom duplicates; out-of-band `meta.json` edits go stale (index is a cache).
  Fine for the app-private store now; revisit if the store ever lives in a synced
  folder.

- **Residual items from archived entries (details in the corresponding sections of BACKLOG-archive.md)**: ~~#10 three non-blocking minors (dampening swim-lane dead zone / panic predicate typo / resolveOwner convergence)~~ **all three closed 2026-09-02 (GH #38)**: the dampening lane now draws pct=0 runs as opacity-0 rects so the pre-dampening stretch hovers "Dampening 0%" (SVG hit-testing ignores opacity; pinned by a Timeline test); `deathRecap.ts`'s `panicsHostile` renamed `panicsEnemy` to match the predicate's `friends`/`enemies` vocabulary; `keyMoments.ts` and `ProComparisonVerified.tsx` now call `resolveOwner` instead of their inline chains (`keyMoments` keeps the explicit POV `ownerId` override in front and `friends[0]` behind; S2 605-file parity probe in the commit message; index row "Who the report is about" lists both). Still open: #16 real-model filler smoke pending real machine. ~~Multi-model comparison stale slot placeholder state row and Export tearing~~ **closed 2026-09-04 (GH #38)**: while an invalidated slot is selected (placeholder note shown), the header status line now reads "旧版本槽 · 无可用结果" and the Copy Markdown export is hidden, instead of both reading the retained previous-slot `result` ("已缓存 · N 条 findings" + exporting the other slot's findings under this tab); pinned by the extended I-2 test in `StructuredAnalysisPanel.test.tsx`.

## 17. Mitigation numerical counterfactual trio (logged 2026-07-27, same thread as Bilibili user feedback)

User request (paraphrased from a warrior's perspective): after Shield Wall there's 20% magic damage reduction, "I don't know if 20% is enough" —
wants AI to numerically back-validate the experience-based conclusion drawn from a CC perspective (after stacking full DR, Shield Wall can skip Spell Reflect;
without full DR stacking, it's not enough); plus "possibility hints" that only rearrange skill timing/order while keeping established facts unchanged (using trinket
earlier → Shield Wall covers 2 casts instead of 1), not requiring 100% correctness — users will iterate through trial and error themselves.
"Not just a checklist of what hasn't been used yet."

Three sub-items, ordered by dependency:

1. **Unnecessary external determination** (can go first, small): enemy burst CDs all far away, no damage spike, target at full HP
   when casting Spell Reflect/externals → new candidate `questionable external`. Criteria already exist (enemy CD ledger +
   damage curve + `annotateDefensiveTimings`), currently Early is only defined as "N seconds before burst window",
   casts with no window and no pressure fall to Unknown and aren't flagged — just add one tier. Addresses user's "you can't just say my Spell Reflect usage was fine."
   ✅ Landed (2026-07-30: `questionable-external` candidate + MISTAKE_RULES dual registration, spec
   `docs/superpowers/specs/2026-07-30-counterfactual-design.md`; full-corpus fixed-seed empirical
   incidence rate 0.52% (cast-level, 25/4780 external casts hit all three negation conditions), not falling in either
   "criteria too strict ≈0" or "too broad >50%" stop zones, shipped with threshold per plan;
   `UNNECESSARY_TARGET_HP_PCT=80` is a prior value, pending user testing for tuning)
2. **Mitigation percentage table + per-school damage breakdown** (shared foundation for 1 and 3): each major mitigation's
   {percentage, school of magic} (Shield Wall 20% magic only, Ironbark 20% all, Spell Reflect 40%…). Follow
   [[official-data-over-heuristics]] via DB2 official fields, but need to empirically test coverage (same issue as the DR table).
   School field already exists in logs (`spellSchoolId`, parsed by parser-compat, not consumed by analysis layer).
   ✅ Table foundation (2026-07-30: MITIGATION_TABLE two-layer 35 entries with no third state, spec
   `docs/superpowers/specs/2026-07-30-mitigation-table-design.md`; school coverage
   quantified at 148/148 windows ≥90% attributable; per-school damage breakdown consumption deferred to #17 main body. Includes
   `positional?: true` contract — conditional mitigations (Darkness 196718) delegate positional check
   responsibility to #17 consumer when providing values; if not checked, must not be counted — see spec decision record item 4)
   ✅ Consumer landed (2026-07-30, see sub-item 3 notes): A/B/narrow-gate all three forms of arithmetic fully filter
   in-window hit damage by `schoolMask`, per-school damage breakdown is no longer a TODO.
3. **Death window arithmetic counterfactual + timing reorder enumeration** (large) ⚠ 2026-07-30 full-corpus quantification (1310 deaths): "available but unused" opening rate only 5.6% (rough estimate 79.7% was a kit-coverage denominator illusion, off by 13x), main form needs to pivot — "already-used mitigation audit" opening 33.2% / "external available but not given" 23.0%, see docs/reports/2026-07-30-counterfactual-feasibility.md; also discovered deathOutcome external whitelist 7≠14 and deathRecap zoneId shape suspected bug: actual damage stream N seconds before death × hypothetical mitigation
   × per-school, compared against (max HP + actual healing received), output three tiers — clearly survivable / borderline / still dead;
   only "clearly survivable" (margin > 15% max HP or similar hard threshold) opens up. Reorder enumeration narrowed to
   "each CC break point within the window × trinket/unused defensive" ~dozen combinations, only reporting the one clearly better option.
   ✅ A/B/narrow-gate arithmetic landed (2026-07-30, spec
   `docs/superpowers/specs/2026-07-30-counterfactual-design.md`): three-tier predicate single-source
   (`counterfactualTier`, same denominator as quantification report) + three forms (`computeMitigationAudit`
   already-used mitigation audit / `computeMissedExternalCounterfactuals` external available but not given /
   `computeUnusedSelfCounterfactuals` self available but unused narrow gate) land in death recap card deterministic
   display + `[DEATH]` prompt facts dual output (same arithmetic, facts floor to render
   seconds before entering text). B's two prerequisite fixes (external whitelist 7→14 convergence + deathRecap zoneId dual-fix)
   shipped with this round, see Task 2 commit (`ff8243e`) with before/after numbers on same criteria. **17c (timing reorder
   enumeration) not done this round, remains an open item** — decision record confirmed 17c deferred, not in scope for this round.

Note (deferred, unresolved): During Task 2 whitelist convergence verification, also discovered that `cooldowns.ts`'s
`FORBEARANCE_GATED_IDS` contains `633` (Lay on Hands), but that id is not in
`spellIdLists.externalDefensiveSpellIds`/`bigDefensiveSpellIds`/
`externalOrBigDefensiveSpellIds` any main whitelist (`ff8243e` concurrently removed the same 633 from
deathOutcomeAnalysis's off-list whitelist, reasoning "not in any main whitelist")
— the two treatments of 633 appear inconsistent, not yet determined which is correct (LoH is pure healing,
excluding it from mitigation/self-defensive wall whitelists may be correct, but Forbearance gating depends on it triggering the same
id), needs separate review before deciding whether to change — see git history (`ff8243e` and its discussion).
Wording follows the possibility framework ("if X were stacked in the same window, damage in that segment would drop below lethal threshold"), compatible with causalLint's
causal assertion prohibition — no gate changes needed. **Arithmetic is feasible, simulation is not**: healing behavior would change, opponents would switch targets — these are not modeled; confidence is expressed via tiers. Before starting, empirically measure two things in the corpus: death window school field
coverage rate; "clearly survivable" tier hit rate in real deaths — if 90% fall in the "borderline" tier, the opening rate
won't support a product form.

causalLint regex is English-only, zh output is a blind spot (discovered via agy 300-match simulation) — Chinese causal patterns need to be added.

---

## 18. arenacoach rule absorption batch 2 + batch 1 residuals (logged 2026-07-27)

Batch 1 (DEATH-001/003 + TRINKET-001) already merged (plan `docs/plans/2026-07-27-arenacoach-rules-batch1.md`,
corpus incidence rates 63.6%/14.1%/15.6%, n=1245). Full rule directory landscape and absorption assessment in that day's session conclusion;
batch 2 candidates sorted by whitelist cost:

1. **DEATH-002 immunity available at death**: needs immunity sub-table + Hypothermia-class shared debuff ledger
   (Forbearance has precedent via `FORBEARANCE_GATED_IDS`/`selfForbearanceActiveAt`).
2. ✅ **COOLDOWN-001 CC held >90s**: offensive version of cd-waste, criteria already exist (`availableWindows` ×
   `ccSpellIds`). Merged in 2026-08-06 signal expansion batch 1 (candidate type `cc-held`, threshold set by corpus empirical evidence from
   "60/90s pick one" to 90s — at the 60s threshold, 23% of all CC available windows naturally exceed the line, mixing in too many
   normal cast rhythm gaps). Design in
   `docs/superpowers/specs/2026-08-07-signal-expansion-batch1-design.md`.
3. ✅ **DEFENSIVE-001 healer eats full CC (had avoidance tools)**: merged 2026-08-07 (candidate type
   `cc-avoidable`, table 100% reuses existing `ccTrinketAnalysis.ts`'s
   `CC_AVOIDANCE_BUFF_SPELLS`/`REPOSITIONING_SPELL_IDS`, zero new tables), after excluding overlap with
   `trinketState=available_unused` (64.3%, already covered by `cc-locked`/`wasted-trinket`)
   corpus rescan yielded 96 entries (pre-cap) / 78 entries (post cap 2/round) / hit rate 9.3% of rounds (59/635).
   Design in `docs/superpowers/specs/2026-08-07-defensive-001-design.md`.
   ❌ **DEFENSIVE-002 low HP not cycling minor mitigations: vetoed by data 2026-08-07** (same design doc) —
   widest threshold (HP<50%) hit rate only 1.1% (3/264 judgable rounds), below batch 1's `healing-gap`
   5.3% precedent line; Discipline Priest (194/194 rounds) and Holy Priest (60/60 rounds) under
   `MITIGATION_TABLE` minor mitigation subset have structural 100% zero applicability; Discipline's nominally sole
   applicable Power Word: Barrier saw only 8 successful casts across 808 matches globally — effectively nonexistent. No new
   type added, no field dimensionality upgrade, no longer waiting for user to approve threshold.
   ✅ **DEFENSIVE-003 slow response to enemy burst**: merged 2026-08-11 (candidate type
   `slow-defensive-response`, healer-owner exclusive). Pressure gate empirical selection: absolute damage gate
   300k has no discriminative power at window scale (95.7% of burst windows pass, window span p50=21.6s), switched to the window's
   built-in `damageRatio >= 1.5` (rate-based, 20.2% of windows pass); response set =
   `MAJOR_DEFENSIVE_IDS` ∪ trinkets ∪ `REPOSITIONING_SPELL_IDS` ∪ hard CC against enemies
   (`destUnitId` attribution), zero new tables; threshold 8s set by corpus distribution tiers (response
   delay for pressured + has-tools + not-CC'd rounds p50=6.9s / p75=12.1s, 3s/5s tiers would classify median behavior as mistakes — cc-held rejected
   60s tier with same logic); exemption gates = pre-wall (shared `PRE_WALL_SECONDS`) + no tools available at window start
   (`cdAvailableAt`) + owner CC'd (covered by cc-locked) + windows with render span < 8s don't owe a response; ±10s dedup gate (200-match empirical overlap 70.8%, above DEFENSIVE-001's
   gating precedent of 64.3%). All determinations made on the render grid (agy flash review of 5 same-family cases
   all accepted: delay/pre-wall/window span/dedup boundary raw sub-second vs render-second drift).
   Full corpus rescan (810 matches / 2621 rounds, real production denominator): **76 entries (40 no-response / 36 slow, slow
   delayS p50=15s / p90=19s), round hit rate 2.9% (76/2621), menu share 0.48%**.
   200-match empirical script `packages/desktop/scripts/tmp-slowdef-rates.mts` — deleted after evaluation.
4. ✅ **DISPEL late/failed tiering**: merged 2026-08-06, but in a different form than originally envisioned — empirical evidence showed late
   dispels (≥3s) only account for 7.1% (69/972) of total dispels, volume can't support an independent candidate type, changed to field
   dimensionality upgrade on `missed-cleanse` (`latencySeconds`, only carried by late-dispel entries), no new type, no cap change. Same batch, same design doc.
5. **OFFENSIVE-001 cone ability whiff**: needs cone spell table + geometric determination, still an open item.
   ✅ **OFFENSIVE-002 bursting into major mitigation when should switch targets**: merged 2026-08-11 (candidate type
   `burst-into-mitigation`, reuses `MITIGATION_TABLE` (#17) + `analyzeBurstLedger`'s
   dominantTarget.defensivesHit (non-immunity) + `analyzeKillWindowTargetSelection`'s
   betterTargetExists — the latter's `windows` parameter narrowed to `Pick<...>`, fed a synthetic window
   assembled from the burst window's own time span/target, reusing the same soft comparison predicate rather than building a new one.
   `positional: true` entries (Darkness 196718) excluded per #17 spec decision record item 4 contract
   (positional check not implemented, if it can't be checked it must not be counted, consistent with `counterfactual.ts` existing approach). Production
   single-owner denominator (`resolveOwner`) shows 898/899 local corpus matches are healer-recorded, DPS-owner rounds
   0/0 — structural artifact of corpus composition, not the signal itself; rescanned using `deriveMistakes.ts` actual "each
   non-healer friendly as owner" denominator (1794 DPS-owner rounds): 225/1794 rounds
   (**12.5%**) hit ≥1 entry, 263 qualifying windows, mitigation spells not dominated by any single spell (11 types,
   highest Pain Suppression at 34.4% of raw hits). 200 matches / 899 sources zero-model deterministic scan,
   temporary script `packages/desktop/scripts/tmp-off002-rates.mts` — deleted after evaluation.

**2026-08-06 additions (not in the original 5-item list above, surfaced from same-day corpus empirical report)**:

- ✅ **HEAL-001 healing gap**: reuses existing `detectHealingGaps`, adding `freeCastSeconds>=4` and
  `mostDamagedAmount>0` two gates. Candidate type `healing-gap`.
- ✅ **POSITION-001 positioning mistake**: reuses existing `computeOwnerPositionEvents` +
  `stayedInHadRealCost` (same predicate as deepDive.ts, three-state discipline unchanged). Candidate type
  `position-mistake`. MISSED_PUSH/CD_OUT_OF_RANGE have 0 incidence rate in local corpus (healer perspective dominant),
  keeping the check without removing (for future DPS perspective corpus).

> **2026-08-06 `#22` linked to wrap-up, but did not reach removal threshold**: items 2/4 above (CC held, DISPEL tiering)
> plus the added HEAL-001/POSITION-001, three new candidate types have landed, `#22`'s recorded
> `cc-locked`/`missed-purge`/`missed-cleanse`/`wasted-trinket` four-type share dropped from 58.6% to
> **50.0%** (200 matches / 899 sources rescan, same criteria, `extractCandidateFindings` direct call;
> `healing-gap` 53 entries, `position-mistake` 115 entries, `cc-held` 250 entries, closely matching design estimates
> 54/118/259; `missed-cleanse` increased from 500 to 570 entries due to DISPEL-002 latency field upgrade,
> increment of 70 aligns with empirical "69 late dispels"). Three new types combined account for **7.7%** (418/5453) of the menu
> — less than the originally envisioned 15-25%, because the three signals themselves have low corpus incidence rates (HEAL-001 is filtered by
> detectHealingGaps' own three-layer gate + 4s secondary filter; POSITION-001's MISSED_PUSH/
> CD_OUT_OF_RANGE are dead signals on healer-perspective corpus). **`#22`'s stopgap cap is not being removed with this batch** —
> batch 1 expansion share is insufficient to lift the gate, waiting for batch 2 (DEATH-002/OFFENSIVE types) to land before re-evaluating.

Batch 1 residuals (final/re-review deferred items):

- ✅ "available but unused at death" three divergent implementations converged (2026-07-29): matchTimelineSections'
  [DEATH] Unused (originally hand-calculated availableWindows hit), timelineHelpers'
  [DEFENSIVE AVAILABLE] (originally hand-calculated readyAt) changed to directly import and call `cdAvailableAt`;
  candidateFindings' death-unused-defensive/external-unused confirmed to already consume it.
  Semantic difference map: timelineHelpers' implementation is word-for-word equivalent to cdAvailableAt (zero semantic diff),
  matchTimelineSections' sole difference is availableWindows table's GRACE_SECONDS=3s
  short-window trimming (that trimming is designed for "cheaper alternative" suggestions, not applicable to death-time-point queries) —
  boundary difference only triggers in edge cases where window < 3s, does not constitute the "convergence must change output and which side is correct isn't self-evident" stop
  clause. Local corpus fixed seed (20260729) sampled 60 matches for timeline variant buildMatchContext before/after
  comparison (33 with relevant lines): [DEFENSIVE AVAILABLE] 0 matches changed; [DEATH] Unused
  1 match changed, 2 lines (1 diff group, same line from "(Unused: Spirit Walk)" to
  "(Unused: Astral Shift, Spirit Walk)"). Empirical verification direction confirmed: that match's Astral Shift was
  cast at 88.226s, cooldown 60s, readyAt=148.226s, death at 148.583s — ability was indeed ready for
  0.357s, old version trimmed the entire window (only 2.357s < GRACE_SECONDS) resulting in
  false negative, new version correctly catches it, direction confirmed "old implementation was false negative, new version is the fix." Anti-drift unit test
  `packages/analysis/test/cdAvailablePredicateConvergence.test.ts`: constructs 4 synthetic
  ledger groups (never used / just used not ready / already ready / two casts take most recent), simultaneously calls three consumers
  and `cdAvailableAt` itself asserting function-level consistency.
- ✅ Follow-up round (2026-07-29, same day): the "out-of-scope same-type duplication" review confirmed
  criticalMoments.ts three locations (`buildKillMomentFields`' mechanicalAvailability
  "on CD" text determination / interpretation's spentCDs / tieredOptions.unavailable's
  allDefensivesSpent) and matchNarrative.ts' `spentAtEnd` (`buildMatchFlow`
  Final Burst/Phase section) totaling 4 locations, all are single-time-point equivalents of `!cdAvailableAt(cd, t)`
  — mechanically replaced with direct `cdAvailableAt` calls, deleted local readyAt hand-calculations.
  **Liveness correction (previous "is live code" statement was inaccurate, corrected here)**: `identifyCriticalMoments`
  (internally calls `buildKillMomentFields`/`getOwnerCDsAvailable`/`buildDeathRootCauseTrace`)
  is indeed unconditionally computed in `buildMatchContext`, but its rendered text (CRITICAL MOMENTS section,
  including the three locations changed this round) only gets written to `lines` in the `useTimelinePrompt: false` (old sparse variant) branch
  — the timeline branch `return`s before rendering this code (code comment verbatim: "timeline
  branch returns before here and never renders, E2E tested old 139 matches → new 0"). Production side `analysisInput.ts`
  and `buildCorpus.ts` both default to `useTimelinePrompt: true`, meaning the current production pipeline never renders this
  section — **the 4 locations converged this round are in code that still exists but is not rendered by the current default pipeline, i.e. the sparse variant**
  (`buildMatchFlow` goes further: full-repo grep confirms zero call sites, purely
  `@deprecated`/`@internal` dead code). Using the same 60-match seed (20260729) with
  `useTimelinePrompt: false` to rebuild prompt before/after comparison: out of 60 directories only 1 combat's
  CRITICAL MOMENTS section hits text patterns related to this round's changes (small sample, because most
  moments' tieredOptions/mechanicalAvailability branches are empty anyway); that 1 case shows
  0 line changes. The real confidence comes from the anti-drift unit test (same
  `cdAvailablePredicateConvergence.test.ts`, expanded to 5 consumers, 4 synthetic ledger groups
  all passing) — the pre-change formulas at all 4 locations are word-for-word algebraically equivalent to `cdAvailableAt` (no GRACE_SECONDS-type
  boundary differences), zero drift is a provable necessary result, not coincidence.
  **matchNarrative.ts' `ownerDefsAvailableInWindow` (`buildMatchFlow`
  Post-Trade Window section, approx. lines 122-127) does not belong to this category — it's a "cast before window start
  `firstBurst.toSeconds` vs. whether it's ready by window end `midEnd`" dual-time-point
  check (takes the most recent cast at time t1, compares against t2 to check readiness), mechanically replacing with single-time-point
  `cdAvailableAt` would lose "new cast between t1→t2" type information and change behavior, so it was not touched.**
  Left for future generalization of cdAvailableAt to a dual-time-point predicate, or confirmation that the current state (the function itself is
  `@deprecated`/`@internal`, already superseded by `buildMatchArc`, only kept for test coverage) is the
  final form — not tracked as a residual from this round.
  Additionally, out-of-scope new finding: criticalMoments.ts' `getOwnerCDsAvailable` (approx. lines
  108-138) and `buildDeathRootCauseTrace` (approx. lines 218-249) also each hand-calculate the same
  readyAt formula; like the 4 locations this round, they only render in the sparse variant, not in this round's convergence scope
  — left as candidates for the next same-type convergence (if by then the sparse variant is still not on the production path, suggest evaluating
  whether the entire `identifyCriticalMoments` branch should be retired wholesale, rather than patching predicates one by one).
- victimCDs' Pick missing isThroughput (type tightening); reconstructEnemyCDTimeline rebuilt twice within
  extractCandidateFindings (perf); scan script inner try/catch missing failure count.

## 19. Self-built PvP log collection and unified storage (training corpus) (logged 2026-07-29) — step one (collection archival) landed 2026-08-01

Vision: build a product/pipeline for **balanced collection** of others' PvP combat logs with **unified long-term storage**,
as model training data — not on-demand filtered retrieval, but balanced sampling by a quota matrix of spec × bracket × rating tier,
eliminating "only collected popular specs / high brackets / certain days" corpus bias.

**Current state and constraints (2026-07-29 research findings, details in `.claude/skills/fetch-pvp-logs`)**:

- The only public source in the entire ecosystem = wowarenalogs.com feed (**third-party volunteer project, not self-owned** — we only
  forked its code; the prior compliance note in this repo stating "self-owned product" was incorrect, now corrected). Collection must be restrained:
  pagination cap 50, don't page through empty pages, polite rate limiting — communicate with maintainers before heavy usage.
- Feed retrieval window is only ~7 days (GCS objects ~30 days) — to accumulate, must **poll on schedule + self-store**,
  missing data is permanently lost. `fetchPvpLogs.ts`'s resume-from-checkpoint + manifest is already a seed implementation.
- Log timestamps lack year and use uploader's timezone, absolute time is in GCS meta header; matchId = md5 of first
  16KB of log, usable as global dedup key.

**Possible forms (not yet approved, for brainstorming)**:

1. **Polling archiver**: cron running fetchPvpLogs' quota matrix version (N matches/day per tier per spec),
   landing in own storage (local disk / object storage), manifest aggregated into queryable index.

   **✅ Implemented** (`scripts/archivePvpLogs.ts`, design in
   `docs/superpowers/specs/2026-08-01-pvp-log-archive-design.md`). Scope converged to
   collection only, no processing; quota matrix removed per user decision, changed to full collection (one match with 6 players = 6 spec observations,
   filtering by spec would cost more Firestore queries and discard 5/6 of samples).

2. **Self-owned upload client**: long-term, build own collection client (gladlog log-pipeline's cross-machine byte-exact
   relay is already a ready foundation), player-informed uploads, for true data sovereignty and retention policy.
3. **Training data pipeline**: dedup (matchId), filter by parser parsability, anonymization strategy (player names),
   unified schema with existing 794-match self-owned corpus and eval corpus.

Compliance note: WAL's logs are voluntarily publicly uploaded by players, but the **code** fork is CC BY-NC-ND;
review data-side compliance separately before using data for training/commercial purposes — don't conflate with code license.

## 21. 2026-07-31 full-week audit P2 deferred items

This week's full-repo audit (desktop services/main/IPC + analysis + corpus-tools) Important fixes already committed
are in corresponding commits; the following are items discovered during the audit, assessed as P2 (low risk / low incidence / requires real-machine verification),
logged but not scheduled:

1. ~~**DeathRecapCard not connected to inline icons**~~ ✅ Fixed (2026-07-31, `6d36798`, this log entry text wasn't struck through at the time, retroactively marked 2026-08-11 during review): `DeathRecapEvent` now has `spellId?: string` pipeline (five event construction points + `availableImmunities`/`missedExternals`), `DeathRecapCard.tsx` five locations displaying spell names (event table row / immunity available pill / teammate missed-external pill / mitigation audit row / counterfactual row) all connected to `ChipIcon`. Tests in `packages/desktop/test/report.deathrecap.test.tsx` (spellId pass-through assertion + known/unknown id icon rendering assertions).
2. **`isAvailableAt` is a third cooldown availability predicate**: `packages/analysis/src/utils/deathOutcomeAnalysis.ts:229`
   with `resetSpellIds` parameter, reads raw `unit.spellCastEvents`, semantically adjacent to `cooldowns.ts`'s
   `cdAvailableAt` but with different data source/denominator (third one, `FORBEARANCE_GATED_IDS`-type
   reset spells are the existing second). If `cdAvailableAt` adds reset-type spell support in the future, must
   converge simultaneously to prevent three cooldown availability predicates from continuing to drift.
3. **`DMG_SPIKE_THRESHOLD` (`packages/analysis/src/context/timelineHelpers.ts:475`,
   300k, prompt/swim-lane spike) vs. `DAMAGE_SPIKE_THRESHOLD` (`packages/analysis/src/utils/cooldowns.ts:917`,
   50k, timing determination) same-named near-synonyms with different values** — they are indeed different concepts (pressure swim-lane spike vs. single
   timing determination threshold) but names collide, recommend renaming one (e.g., `TIMING_SPIKE_THRESHOLD`)
   to prevent future misuse/wrong constant modification.
4. **`corpusLoader.ts` corrupted override silently falls back with no logging**: `packages/desktop/src/main/corpusLoader.ts`
   L44-58 per-path try/catch, `JSON.parse`/shape rough validation failure always `continue`s to next candidate,
   all failures result in `null` — user placing a bad file (e.g., hand-editing corpus JSON with typo) won't know why it didn't
   take effect, should add a warn log line in the `catch` branch (via `onLoaded` same callback pattern, without introducing
   electron-log dependency).
5. **`obsAutoConfig.ts:55`** `authRequired: raw.auth_required !== false` treats missing
   `auth_required` field as "password required" — when OBS config file schema drifts (field renamed/
   missing), it would falsely report "password required" instead of honestly reporting "uncertain", should change to three-state
   (`true`/`false`/`undefined` each handled separately).
6. **Local CLI backend (claude/agy) has no version detection**: `#12` already does zero-config detection, but if the detected
   binary is protocol-incompatible with expectations (old CLI version), failure surfaces as raw stderr output, with no version number/
   friendly message. Add lightweight `--version` detection + readable error when version is incompatible.
7. **OBS password / API key both stored in plaintext in `settings.json`** — evaluate upgrading to Electron
   `safeStorage`. Ecosystem consistency: OBS itself also stores passwords in plaintext in profiles, not urgent,
   logged for evaluation.
8. ~~**Shuffle mid-log rotation discards completed round's `shuffleCallback`**~~ ✅ Fixed (2026-08-15, `85f9d0e1`).
   Root cause: `Segmenter.end()` unconditionally discarded `this.rounds` while in `IN_SHUFFLE` state, regardless of
   how many rounds inside it had already fully closed out in the "next round's `ARENA_MATCH_START` already
   appeared" sense — both batch import (one parser per file, `parser.end()` called at end of file) and the
   desktop app's real-time monitoring rotation hit this path. Side finding along the way:
   `worker/pipeline.ts`'s `processFlush()` rotation branch never called `parser.end()` at all — it just discarded
   the old parser instance whole, so the analysis-side fix couldn't reach the real-time monitoring path on its
   own; fixed in tandem. Fix: `end()` now fires `shuffleCallback` once for the already-fully-closed rounds when
   `rounds.length > 0`, discarding only the genuinely truncated `currentSegment`; the `end` field uses the
   truncated round's own `ARENA_MATCH_START` line (real, not fabricated), with no `arenaEnd`, and
   winner/result fall back to the existing "Unknown" default. `quietSweep`/`teardown`'s `closeOpenSegment()`
   deliberately was NOT touched by this fix — the 40-minute silence valve depends on the same parser instance's
   state being untouched when a late, genuine END later arrives (already locked in by a regression test).
   **Honest incidence-rate disclaimer**: dropped `shuffleCallback`s were never persisted, so historical incidence
   can't be reconstructed retroactively — even though the corpus's meta index records `roundCount`, shuffles
   under 6 rounds happen legitimately in bulk from disconnects/early leaves, so they aren't a reliable signal
   for rotation, and retroactive counting doesn't hold up. The differential oracle gate
   (`gladlog-eval-private/oracle`) runs green, 0 new diffs.
9. **`quitLifecycle` (`packages/desktop/src/main/index.ts` / `quitLifecycle.test.ts`)
   only stops recording on exit**, AI analysis flow (DeepSeek fetch / CLI subprocess) not actively aborted.
   Low risk (connections naturally drop when host process exits), logged for completeness, not a bug.
10. **`fetch-pvp-logs` (`packages/corpus-tools/scripts/fetchPvpLogs.ts:24`) `BRACKET`
    has no validation** (typo value silently returns empty results, no error) **+ happy-path has no throttle sleep** (only
    error/backoff paths have delays). This is politeness hardening toward the third-party feed, not a functional bug.

11. **#16 honest empty results not cached, reopening same window re-incurs model call**: `packages/desktop/src/main/analysis.ts`'s
    `analyzeWindow` does not write disk cache for `audit-empty` (model honestly answers `[]`) — headless simulation
    (2026-07-31, 79 windows) shows ~22% of runnable windows hit this path, clicking "AI analyze this segment" again on the same window will
    make another model call. Consider caching empty terminal state (with version stamp) or UI-side hint.

## 22. Temporary rate limiting: dispel/trinket-type candidates per-round cap (logged 2026-08-06; **TEMPORARY status ended 2026-08-20 — kept long-term by user ruling**, see the closing note at the end of this entry)

**Motivation**: 200-match candidate menu empirical test (healer perspective default owner — `extractCandidateFindings` defaults to
friendly healer), `cc-locked`/`missed-purge`/`missed-cleanse`/`wasted-trinket` four types combined account for
**64.0%** (3351/5233; `cc-locked` 1629, `missed-purge` 1062, `missed-cleanse`
569, `wasted-trinket` 91) of all candidate events, drowning healer perspective coach output in "all dispel/trinket", crowding out `death-setup`/
`external-unused`/`questionable-external` and nine other types' exposure. User approved: use hard per-round
caps as a stopgap first, **don't do the full signal expansion fix**, log this item pending removal after #18 batch 2 lands.

**Cap values** (`packages/analysis/src/analysis/candidateFindings.ts`, before truncation sort by respective severity
field descending — `missed-cleanse`/`cc-locked` by damage taken, `missed-purge` by (whether in kill window, duration),
`wasted-trinket` by `teamMinHpPct`, keeping the most severe instances):

- `cc-locked`: 3 → **2**
- `missed-purge`: 3 → **2**
- `missed-cleanse`: 3 → **2**
- `wasted-trinket`: no cap → **1** (previously the only type without a per-round cap)

**Empirical before/after numbers** (same criteria, same 200 matches / 899 sources snapshot, tested then changed):

|        | cc-locked | missed-purge | missed-cleanse | wasted-trinket | Four-type total | Share     |
| ------ | --------- | ------------ | -------------- | -------------- | --------------- | --------- |
| Before | 1629      | 1062         | 569            | 91             | 3351/5233       | 64.0%     |
| After  | 1253      | 817          | 500            | 89             | 2659/4541       | **58.6%** |

**Honest disclosure**: pre-change expectation was "~40% range", actual only dropped to 58.6% — below expectations, because most individual matches/rounds were already
well below the old cap (cc-locked averages 1.81 entries per match, old cap of 3 was rarely hit), per-round hard cap has limited ceiling effect on types whose "distribution is already
concentrated at low counts". This stopgap is **real but limited** mitigation, not the complete fix for these four types' disproportionate share; the complete fix remains the signal expansion referenced in the title (see below).

**Removal conditions (2026-08-06 update)**: batch 1 expansion (healing gap HEAL-001 / positioning signal POSITION-001 /
CC held COOLDOWN-001 three new candidate types + dispel DISPEL-002 latency field upgrade) has landed, share dropped from 58.6%
to **50.0%** (200 matches / 899 sources rescan, same criteria), but three new types combined account for only **7.7%** (418/5453) of the menu —
**insufficient to lift the gate**. This item's caps are kept unchanged, pending batch 2 (`#18`'s DEATH-002 / DEFENSIVE-001/002 /
OFFENSIVE-001/002 types) landing before evaluating whether to remove
the const block marked `TEMPORARY, BACKLOG #22` in `candidateFindings.ts` (four cap constants +
comments), restore `MISSED_CLEANSE_CAP`/`MISSED_PURGE_CAP`/`CC_LOCKED_CAP` to 3,
and remove `WASTED_TRINKET_CAP` entirely (restoring no-cap).

- **Cross-reference**: see `#18` entry "2026-08-06 additions" and the COOLDOWN-001/DISPEL late/failed two lines —
  this stopgap was waiting for those, now landed but did not reach removal threshold.

**Gate removal dry run (2026-08-11, after DEFENSIVE-001 + OFFENSIVE-002 landed, temporarily changed constants for empirical test then reverted)**:
Latest 200 matches / 898 rounds, same criteria, dual-run menu layer + agy real selection smoke (n=12, same
`smokeFindingsBackends.ts` denominator):

|                                         | Current (caps 2/2/2/1) | Gate removed (3/3/3/none) |
| --------------------------------------- | ---------------------- | ------------------------- |
| Menu four-type share                    | 53.7% (2729/5083)      | 59.3% (3436/5790)         |
| Rounds with four-type >50%              | 47.3% (425/898)        | 57.9% (520/898)           |
| Average menu entries                    | 5.7                    | 6.4                       |
| agy selection surviving four-type share | 42.5% (previous n=12)  | 46.8% (22/47, n=11)       |

Increase almost entirely from `cc-locked` (1253→1629) and `missed-purge` (817→1062). Selection layer dual safeguards
(prompt selection-limit sentence + `auditFindings` deterministic fallback) keep reports at ~1.9 four-type entries/match (≤2 hard constraint
not breached), new types still get selected from menu as before (healing-gap 1/1, position-mistake 2/2, cc-held 3/4).
**Conclusion: do not remove** — removing yields zero benefit (report side only skews without improving, menu side four-type share rises +5.6pt), new types' combined menu
share still only ~8.5%, removal threshold maintains original judgment: wait for batch 2 expansion (DEATH-002 / OFFENSIVE-001) to land before re-evaluating.
n=12 selection layer difference (+4.3pt) is near judge noise floor, not used as independent evidence — directional consistency with menu layer used only as supporting evidence.

**Closed 2026-08-20 (user ruling, commit `551438fb`): the caps stay, long-term — the TEMPORARY label and the "wait for batch 2"
removal condition above are void.** Re-measured then (after cc-locked / wasted-trinket retired on 2026-08-19, GH #14): with cap=2 the
cleanse/purge family was 16.8 % of the menu, the no-cap simulation was 64.6 % — the same 64 % that triggered this entry — because
missed-purge raw windows ran 12.6 per match; restoring 3 would push the family to ~25 % with no benefit evidence. The ruling and its
numbers live in the `candidateFindings.ts` constant-block comment. Since then: missed-purge was demoted to context facts on 2026-08-29
(`17356e93`, GH #50 (a); `CANDIDATE_TYPE_FLAGS.missedPurge = false`), so the family the caps govern is missed-cleanse alone (28 % of its
producing rounds at cap in the 2026-08-26 at-cap check) plus kick-eaten's own cap. Nothing left to decide; entry kept for the numbers,
listed under "done, pending archive" in the preface. (Bookkeeping fix 2026-09-02: #24-6 and GH #44 had carried the stale "gated on
batch 2" wording for two weeks.)

## 14. eval / QA system residuals (logged 2026-07-20)

> **2026-07-22 wrap-up round addendum**:
>
> - **d243f4b three-fix judge-layer re-evaluation done** (same 35 layerb flagged matches, HEAD rebuilt prompt →
>   sonnet re-responded + scored, 35/35 provenance green): accuracy mean **1.89 → 4.14**, flagged
>   **35 → 2**, fabrication-level **4 → 0**, DMG SPIKE start/end confusion class **~13 → 1**, unit attribution class **~11 → 3**.
>   Denominator limitations (regression to mean / end-to-end attribution not decomposable) and per-case evidence in
>   `gladlog-eval-private/runs/2026-07-22-recheck/recheck-report.md`.
> - **✅ noise re-anchoring side effect fixed (2026-07-22 approved, going with (a) standalone tier)**: `templateDuplicateRatio`
>   given standalone tier in eval-baseline.md (≤45% no deduction; 45–60% → 3; >60% → 1, thresholds from 1245-match
>   natural distribution p50=31.2%/p90=40.7%/p99=49.1% beyond). Rule-based scores across full corpus 3.03 → 4.92
>   (old rules pressed 1207/1245 matches to tier 3; new rules only 49 true tail matches fall to tier 3, 0 to tier 1). Calibration unaffected
>   — calibration cases have no quality-report, judge already skips consistency rules.
> - **✅ §7ter enabled (2026-07-22 approved)**: sufficiency (det-gate dimension) removed from other dimensions' specificity
>   checks. Same batch `scores-det3` scores: accuracy 90→100, inferenceScaffolding 90→100,
>   outcomeAlignment 90→100, labelBias 80→90, noise 90 unchanged, focusCalibration 100 unchanged
>   — **7/7 all pass with minimum 90%**, pressure dimensions cleared to zero.
> - 14.3 maintained as monitor (this round is a flagged-subset re-evaluation, does not constitute a new baseline, not used as observation point).

These four items come from the 2026-07-20 prompt defect fix round + blind A/B wrap-up. 14.1 is fixed,
14.2–14.4 are not done, ordered by processing sequence. The remaining three items are **all within `packages/eval`** (the eval system
itself), don't go into the product package, don't block releases. Background in
`docs/reports/2026-07-20-prompt-defects-and-blind-ab.md`.

### 14.1 `report-replay` visual test flaky ✅ (fixed 2026-07-20)

**Symptom**: CI failed on `0eeabb2` at `scenario report-replay matches baseline`,
1871 px (0.01 ratio of full image) inconsistent. That commit only changed `packages/eval/src/quality/`
two files, zero renderer code; the next commit (`258dcdc`) ran the same test green.

**Root cause is NOT render timing** (this entry originally stated "has timeline/animation, suspected render not settled",
which was wrong — `playing` starts as false, the rAF loop never ran at all). True root cause is **a public network image embedded in the baseline**:
`ReplayView.tsx`'s arena background map `<image href={arenaMapUrl(zoneId)}>` points to
`images.wowarenalogs.com`, fetched at runtime. The real background is a "transparent background + opaque collision bodies"
shape map, so when fetched it draws some gray obstacles, when not fetched it draws fewer — same code, two pixel outputs.

Hard evidence from the failure artifact: diff box locked to x174-279 / y196-272, **every diff pixel on the actual side
is the same background color `[26,27,40]`**, expected side is neutral gray `[98,99,105]`/`[120,121,128]`
— not jitter, it's "that entire layer wasn't drawn."

**Fix**: `qa/support/stubExternal.ts` — known external resources fulfilled with locally generated fixed stub PNGs,
all others aborted and logged to a **leak ledger**, with test cases asserting the ledger is empty. Adding a new CDN dependency
will explicitly fail red, rather than leaving a random red light. Also switched Inter from Google Fonts to
`@fontsource` self-hosted (same class of issue, and the product UI falls back to system fonts when offline).

**Verification** (same build, online vs. offline, full-page pixel comparison):

|                                     | Diff pixels                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Pre-fix · page layer                | 33192 (bbox x16-1261 y28-936, nearly full page)                                                           |
| Post-fix · page layer               | 2286 (only background map remains; product still fetches from CDN, offline degrades to no background map) |
| Post-fix · baseline layer (stubbed) | **0**                                                                                                     |

Post-fix page layer bbox matches the production failure's x174-279 y196-272 pixel-for-pixel, confirming local
reproduction of the failure. After baseline regeneration only report-replay changed out of seven images, the other six are byte-identical.

**Residual**: product-side background map still uses CDN (vendoring involves copyright + bundle size, see `arenaMaps.ts` comment),
offline users see a degraded no-background-map view. This is intentionally preserved.

### 14.2 sufficiency judge blind spot (calibration detection rate 20%) ✅ Closed (2026-07-22, resolved via deterministic coverage gate; rubric anchor point direction rejected after five tests)

**Empirical test** (2026-07-20 calibration, 40 synthetic defects): after deleting **all** death-related
lines from a match's prompt, in 4 of 5 cases the judge gave the same or higher sufficiency score (source 002 deleted 18 lines, 5→5).
Detection rate for all other six dimensions was 80–100%.

**Implication**: the judge can only see what's in the prompt, cannot see what the builder **didn't include**.
This is structural, not fixable via prompt engineering.

**Direction** (choose one, undecided):

- Modify the rubric, give the judge an explicit coverage checklist as anchor points; or
- Simply abandon blind scoring for this dimension, let `qualityCheck`'s deterministic coverage gate score directly.
  The current `eval-ab.md` already specifies this dimension is adjudicated by deterministic metrics, blind scores have no adjudication power — that's a bypass, not a fix.

**Correction (2026-07-20 full-corpus round)**: the original "detection rate 20%" counted **suite defects** against the judge.
`removed-deaths` deletes death lines from the prompt while leaving the response unchanged — claims in the response about that death
are then truly no longer supported by the prompt, so accuracy should indeed drop — the judge was doing its job correctly, but was judged
as violating by the specificity rules. After fixing this premise error (`751f6bc`, constructive coupling exemption), the dimension's detection rate went from 20% → 60%.

**Final version (n=10 suite, 80 cases, same day evening)**: the blind spot is real, and **more severe** than the corrected estimate —
in 10 cases **6 scored `5→5`** (all death lines deleted, judge deducted zero points), pure sensitivity failure. Detection rate 40%.
n=5 two rounds + n=10 one round, three independent measurements, this finding consistently reproduces. The two fix directions above still stand.

**n=5 is unreliable, empirically proven**: under the same rubric, focusCalibration went from 40% to 80%, noise from
80% to 50% — two dimensions nearly swapped after sample doubling. Except for inferenceScaffolding (n=5 and n=10 both
100%), any dimension-level conclusion based on n=5 is invalid. **Calibration suites must use `--source-count ≥10`.**

**Final final version (2026-07-21, all 80 cases re-evaluated under latest rubric, `scores-det3`)**: blind spot **reproduced a fifth time,
and deeper** — detection rate 40% → 30% → **20%**, in 10 pairs 8 were undetected and **all showed zero response**
(`5→5` five times, `4→4` twice, `3→3` once). Three rounds of rubric changes (`cca541c` / `3d92ba3` /
audit set cap `d39b34b`) had **zero effect on it**, consistent with the "structural, not fixable via prompt engineering" judgment.

**Conclusion: go with the second direction, stop trying the first.** Hand it to `qualityCheck`'s deterministic coverage gate,
`eval-ab.md` already specifies this anyway. It's a bypass, not a fix — but after five measurements,
"modify rubric to add coverage checklist anchor points" has no evidence supporting continued investment.

**✅ Closed (2026-07-22): coverage gate landed.** `checkCalibration` for removed-deaths pairs now adjudicated by
deterministic coverage gate (`checkFriendlyDeaths` × ground-truth manifest, same predicate as production `qualityCheck`;
`removeDeaths` perturbation also changed to import the same `DEATH_KEYWORDS`, predicate single-source). Judge
blind scores still recorded, just without adjudication power. Same suite, same batch of judge scores (`scores-det3`) before/after: **detection
2/10 (20%) FAIL → 6/6 (100%) PASS** (4 pairs' source matches had no friendly deaths, gate has no jurisdiction, scored as unscored — not counted
as detection or miss); **calibration total 6/7 → 7/7, exit 0**. Manifests for old runs that were cleaned need to be rebuilt from the same
log list then aligned by matchId and copied back (2026-07-20-smoke already done). §7ter's "remove sufficiency from
specificity check" still awaits human approval — but its prerequisite (this dimension is indeed independently adjudicated by deterministic gate) is now established.

**Incidental finding, adopted 2026-07-22**: sufficiency is now also **the largest leak source** —
the other six dimensions' combined 6 undetected cases are all specificity drift of 2, of which **4 cases' drifting dimension is sufficiency**.
Removing it from specificity checks would raise the six dimensions to 90–100%. The judgment at the time was that this is only valid when sufficiency is truly independently
adjudicated by the deterministic gate, not "adjusting the gate until it turns green" — that prerequisite was established the same day, so removing sufficiency
from specificity checks landed: `packages/eval/src/judge/checkCalibration.ts` (~lines 332-337,
`DET_GATE_DIMENSIONS` skips specificity determination, comment marked "2026-07-22 approved for enabling"). Details in
`docs/reports/2026-07-21-judge-variance-v3.md` §7ter.

### 14.5 accuracy inter-judge variance ±2 — factAudit's 3 claims should be fixed rather than judge-selected ✅ Closed (2026-07-21, lookup-table anchor: anchor noise 0/30; residual errCount disagreement is judgment-capacity noise)

**Empirical test** (2026-07-20, n=10 suite): `noise` and `labelBias` failures are **all specificity**,
sensitivity is good (5→3, 5→1), leaked dimension is always `accuracy` with drift=2.

**Root cause is not the suite**. Examined case-by-case the claims judged refuted in case-06/13/49 — respectively "Hammer of
Justice attributed to wrong person", "Life Cocoon cooldown state misjudged", "41% HP one second off" — these errors **exist
in the original response text**. And `duplicated-noise` only changes the prompt, not the response — control group and perturbation group
judges see the same response, one gives accuracy=5, the other gives 3.

True mechanism: the rubric (`eval-baseline.md` PASS 1) lets the judge **self-select** "the 3 most load-bearing claims" for fact
audit. Different judges pick different 3 claims — if they pick ones containing errors, they deduct; if not, they give full marks. So accuracy's
inter-judge variance reaches ±2, while the specificity tolerance is ±1, structurally unbeatable.

**Tried and measured (`cca541c`, same day): changed the audit set to be rule-determined** — take all assertions in the response containing `M:SS`
timestamps (cap 12, pad to 3 if insufficient), and accuracy **scored only on that set**. Re-evaluated those 30 cases
(10 sources × {none, severity-labels, duplicated-noise}, i.e., the three types where response and verifiable content are identical):

| Criterion                      | Pre-change (self-select 3) | Post-change (rule set) |
| ------------------------------ | -------------------------- | ---------------------- |
| accuracy range mean            | 1.00                       | 0.80                   |
| Maximum range                  | 2                          | 2                      |
| Sources with range ≥2          | 4                          | 3                      |
| Sources with perfect agreement | 4                          | 5                      |

**Effect not confirmed.** Magnitude −20%, at n=10 indistinguishable from noise; and it's displacement not contraction (source 3 dropped from 2 to 0,
source 1 rose from 0 to 2). The change itself is principled (eliminates an arbitrary degree of freedom, audit becomes verifiable),
so it's kept, but **must not be considered resolved**.

---

**Closed (2026-07-21)** — details in `docs/reports/2026-07-21-judge-variance-v3.md`.

The subsequent two rounds of changes completed this item, but **the winning area is not the same thing as the title**:

| Criterion (scale-independent)                            | Self-select 3 | Rule set `cca541c` | Lookup anchor `3d92ba3` |
| -------------------------------------------------------- | ------------- | ------------------ | ----------------------- |
| **errCount range mean** (substantive judge disagreement) | 0.50          | **0.30**           | 0.50                    |
| Anchor application noise (accuracy ≠ 5−errCount)         | 9/30          | 8/30               | **0/30**                |
| Verification detection total (30 cases)                  | 6             | 11                 | **21**                  |

- **What was actually fixed is "same finding given different scores"**: in v2, of 11 cases with errCount=1, accuracy was
  scored 3 eight times and 4 three times; in v3's 16 cases it's **all 4**, 30/30 zero exceptions. This is pure noise, zero signal,
  eliminating it is a net gain.
- **Substantive inter-judge disagreement didn't decrease**: errCount range returned to 0.50, same as the initial level. Remaining variance **is entirely verification misses** —
  three judges reading the exact same response find error sets that can be {A} / {A,B,C} / {C} (source 001 instance).
- **⚠ The registered criterion (accuracy range 1.00 → 0.80 → 0.50) looks like two consecutive drops, but doesn't translate to A/B discriminative power**:
  lookup changed "1 error" deduction from 2 points to 1 point, noise and signal shrink proportionally. Lesson separately documented —
  before comparing scoring-class metrics, must convert to underlying counts that don't change with anchor points.

**The anchor point approach has hit bottom** (0/30 violations, no remaining room). If further variance reduction is needed, the direction is **verification misses**:
consider requiring judges to write the **line number** in the prompt for each claim, turning "I checked it" into a verifiable trace.

**Calibration total: 4/7 → 5/7 → 6/7** (see 14.2 final version), threshold 5/7 met, Layer B no longer blocked.

~~**Remaining variance is elsewhere**: after the fix, judges audit the same set of claims but can still differ by 2 points — indicating disagreement is in "same
claim judged verified vs. refuted" and "n errors maps to which anchor score", i.e. **anchor calibration**, not sampling.
Next step should investigate this direction, not continue modifying the audit set.~~
**(2026-07-21 overturned: this guess was half right.)** At the time, two mechanisms were written together. Empirically decomposed, it turns out —
"n errors maps to which anchor score" is indeed a problem, and **has been completely solved by lookup anchors** (violations 9/30 → 0/30);
but "same claim judged verified vs. refuted" **is not an anchor problem, it's verification misses**, lookup has zero effect on it
(errCount range 0.30 → 0.50). Remaining variance is entirely in the latter — see the closing table above.

**Self-inflicted collateral from the change**: when modifying PASS 1, the `factAudit` length convention wasn't synced — the format section and
`checkScoreProvenance.ts` were both still locked to "exactly 3 items", causing the re-evaluated 30 cases to have item counts ranging from 3 to 12
(sub-agents each interpreted differently). Validator relaxed to [3,12] and required recording the complete rule set (truncation equals
losing verifiability, and verifiability was the whole point of this change). Lesson: when changing judge workflows, any script that
validates that workflow's outputs must be changed in the same commit.

**Same self-inflicted issue recurred 2026-07-21** (when changing cap from 12 → 20, `provenance.test.ts` two test cases
hardcoded 12, 1 of 88 tests went red). Fixed this time, also exported constants as `FACT_AUDIT_MIN/MAX`,
test cases changed to derive from constants, additionally added `factAuditBounds.test.ts` that **parses the rubric document and asserts the document's
numbers equal the validator constants** (verified by changing constant back to 12, 3/3 failed, not a vacuous pass). **Same-type drift stops here.**

**Dead ends tried** (don't repeat): at one point assumed `duplicated-noise` has constructive coupling with accuracy (duplication
changes counts, rubric requires recounting), planned to add to `COUPLED_BY_CONSTRUCTION`. Case-by-case verification
**disproved** it. Progressively relaxing the exemption table until the gate turns green is exactly the failure mode warned about in that table's comments.

### 14.3 Two accuracy proxy metrics slightly pointing toward treatment being worse (monitor)

2026-07-20 A/B (50 pairs) two independent metrics pointing same direction:

| Metric                 | Δ      | 95% CI            | MDE at n=50 |
| ---------------------- | ------ | ----------------- | ----------- |
| accuracy (1–5)         | −0.30  | [−0.66, +0.06]    | 0.36        |
| factAudit refuted rate | +5.3pp | [−2.4pp, +13.1pp] | —           |

**Neither is significant**, and both are below this sample size's minimum detectable effect.

**Ruled-out explanation**: it's not "prompt grew 5% / 86 new DR annotations gave more citable material" —
empirically, in both arms' refuted claims, claims mentioning the new annotation surface are **all 0**.

**No further action**; observe alongside the next baseline run. If the same direction recurs with larger n, investigate.

### 14.4 `blindPool` blind cases missing matchId placeholder convention ✅ (closed 2026-07-22)

This round's blind cases don't contain `MATCHID:` headers (stripped by design), but judge instructions require score JSON to include `matchId`,
so sub-agents each made up `null` / `"unknown"` / `"NO_MATCHID_HEADER_FOUND"` three different formats.
Doesn't affect this round's statistics (`abStats` joins by blindId), but would create problems for future matchId-based aggregation analysis.

**Fix**: placeholder convention hardcoded to `matchId = blind case id (item-NN)` — the blind case directory name itself is a stable id that doesn't
leak arm assignment, real matchId aggregation always goes through `blind/mapping.json` for lookup. Landed in two places:
`eval-ab.md` judge template explicitly states "set matchId to exactly ITEMID, don't make up values, don't look it up";
`abCompareStats` checks this field during unblinding — non-compliant values logged as warning, **values equal to the real matchId trigger a separate alert as suspected unblinding breach**
(this information doesn't exist in the blind case — the judge could only have obtained it by reading files outside their scope).

---

## 23. GitHub issues batch 1 (logged 2026-08-11, 4 issues opened by users on GH)

Classified by suspected root cause; work begins after completing the currently running #3 (enemy burst response delay candidate).

1. **[#8](https://github.com/mingjianliu/gladlog/issues/8) unused abilities include abilities the player doesn't have
   → talent awareness (2026-08-11 user corrected root cause)**: Power Word: Barrier **does
   exist**, but it's a talent 2-pick-1 node and the vast majority don't pick it — the issue isn't table corruption, it's that the **analysis layer
   doesn't know what talents the player chose**, treating "theoretically available to the class" as "this player has it", saying
   "unused CD" for untalented abilities. Supporting evidence same direction: DEFENSIVE-002 rejection measured PW:Barrier with only
   8 casts across 808 global matches, perfectly consistent with "unpopular talent choice."
   **Data status**: parser already parses `COMBATANT_INFO`'s `talents: number[][]` (talent tree
   node entries) and `pvpTalents` (`packages/parser/src/l1/combatantInfo.ts`), attached to
   `u.info`, zero consumption by analysis layer. Missing two pieces:
   (a) **talent entry → granted ability** mapping table (DB2 trait tables, follow
   [[official-data-over-heuristics]], official tables also need empirical coverage testing);
   (b) **ability gate consumption**: all "you have X but didn't use it" type determinations (unused-CD / loadout [UNUSED] /
   death recap availableImmunities / missedExternals etc.) first pass "this player actually has X in their talents."
   Gate should be installed at the **candidate layer** with rich context guard comments (missed-cleanse ability gate 8fba412 and
   [[gladlog-context-bypasses-candidate-gate]] two precedents: only blocking the menu would be bypassed by loadout
   bare facts). Single-source predicate (canDefensiveCleanse pattern) goes into predicate-index.
   Before starting, measure: full-corpus coverage rate of matches with talent data + affected whitelist entry inventory (which kit abilities
   are actually talent pick-one). **Checkpoint: verify whether slim migration preserved info.talents** (doc slim process modified
   params, if talents were trimmed need to restore to storage layer first).
   **✅ Completed (2026-08-11, including "precision: neither false-negatives nor false-positives" acceptance batch)**. Inventory conclusion: kit main
   path `extractMajorCooldowns` and all its downstream (loadout/[UNUSED], cd-waste,
   cc-held, slow-defensive-response, death-unused-defensive, external-unused,
   computeUnusedSelfCounterfactuals, matchNarrative/criticalMoments/
   momentSnapshot) **already talent-aware** (pick-one filtering + pvpTalents + replacement table + dynamic discovery;
   300-match empirical test 29900 kit entries 0 phantoms); the real gap is `deathOutcomeAnalysis`'s
   IMMUNITY_SPELLS / EXTERNAL_DEFENSIVE_SPELLS two spec tables (only gated by spec, feeding
   prompt's DEATHS WITH MISSED OPTIONS, deepDive immunity/external facts, desktop
   DeathRecapCard three locations). Fix: three-state single-source predicate `talentOwnershipOf`
   (analysis/src/utils/talentOwnership.ts, added to predicate-index), ownership set covers
   four sources: class/spec/hero tree (pick-one only counts selected branch) + **official PvP talent pool**
   (new datagen `genPvpTalentPool.ts` → pvpTalentPoolGenerated, DB2 PvpTalent,
   including ActionBar carrier 215982→215769; COMBATANT_INFO pvpTalents=SpellID semantics empirically verified
   at 110/111 across full corpus) + replacement relationships + exclusion-method baseline; two anti-false-positive fallbacks: free/entry auto-granted
   nodes absent → unknown (Chain Lightning 214/214 casters' loadouts all lack that node), loadout contains
   nodes unresolvable in current tree (old build rounds / pet tree rows) → tree judgment no → unknown. Both tables' listing
   loops each add "only filter on confirmed no, unknown passes through" gate + `<player_loadout>` header guard comment.
   **Before/after numbers**: (a) phantom scan (same criteria, latest 200 + sampled 100 matches = 1172 rounds):
   missedExternals phantoms 517/918 (56.3%, PWB 330 / Zephyr 109 / BoP 75) → **0/404**;
   availableImmunities 149→149 zero false-positives; kit 0 phantoms unchanged. (b) **Full-corpus contradiction audit**
   (810 matches 2622 rounds 345,942 cast pairs, criterion = table judges "no" but player actually cast in that round, permanent script
   `packages/desktop/scripts/auditTalentOwnership.ts`): **235 → 7** (0.002%),
   residual 7 each traced to = pre-gate / round-boundary cast timing edge cases (poisons / weapon enchants / sacrament / BoP replaced by PvP talent,
   pvp talents dormant outside arena) and old build node-id drift invisible residuals; production predicate
   all immune via cast evidence fallback. (c) Whitelist determination 17747 unit-instances: unknown 47 (0.26%, all
   old build rounds), 0 when data is available; PWB = yes 12 / no 1542 / unknown 0 (99.2% of Disc rounds
   didn't talent it, issue #8 confirmed). Whitelist 36 (spellId, spec) pairs each classified by official source and pinned in
   `talentWhitelistClassification.test.ts` (data refresh drift would turn red). Coverage
   15650/15650 unit talent data parseable (slim preserved info.talents intact). Solo Shuffle round-level
   empirical evidence: 171/186 shuffle matches had players changing talents between rounds, 361/1099 multi-round players (32.8%) —
   predicate uses per-round unit.info, never caches across rounds.
   **Incidental finding (not addressed, deferred)**: Netherwalk (196555) absent from both 12.1 tree/pool + full-corpus
   808+ matches 0 casts + 414 Havoc units — suspected removed from the game, IMMUNITY_SPELLS entry
   is whitelist rot ([[gladlog-aura-id-rot]] family), will continue producing suspicious "had Netherwalk
   available" claims; pending season data confirmation before removal.
   Numeric corrections (talentModifiers cooldown reduction type) not in scope for this item.
2. **[#9](https://github.com/mingjianliu/gladlog/issues/9) Mind Control causes minimap mode friend/foe
   count errors**: during Mind Control the unit's reaction flips, replay minimap friend/foe
   counts get skewed. Suspected in parser/replay layer's reaction snapshot denominator (using COMBATANT_INFO static
   faction vs. per-event dynamic reaction). First reproduce: find a match with Mind Control and locate the count source.
   **✅ Completed (2026-08-11, two fixes each in independent commits)**. Root cause two layers:
   (a) **Replay chain is the last surface across the entire app that uses reaction flags for friend/foe determination** (predicate split,
   all other surfaces use `sideOfUnit`) — `ReplayTrack.reaction` → `side`, derived from `sideOfUnit`
   (anchored to COMBATANT_INFO teamId), falls back to reaction only for unknown; map both-sides HP bars/
   dot outlines/swim-lane grouping/both-team chips — one change fixes all four surfaces. Empirical test archive fb672a41 round 5:
   Hiyâkun (reaction=Hostile, teamId=friendly) pre-fix in enemy column → post-fix in friendly column, count 2v4→3v3.
   (b) **Perf commit 1c9c05d when deduplicating flagsSeen silently changed reaction voting from
   "by event occurrence count" to "by distinct value count"** (ties bias toward Friendly), units
   touched once by Mind Control get 1-1 tie and flip for the entire match — restored occurrence-count voting (flagCounts count Map,
   preserving dedup's performance benefit). Before/after numbers (full corpus 280 matches with 605 corpus entries, 1325 segments / 7941 player
   units, criterion = voted reaction strictly contradicts COMBATANT_INFO teamId): distinct-value
   voting **1459 instances / 230 matches** → occurrence-count voting **1 instance / 1 match** (residual 1 = fb672a41
   round 5's persistent mechanism flip, caught by (a); investigation estimate was 59 instances / 8 matches, actual blast radius
   25x larger). Incidental finding: oracle parity gate hasn't been run since 1c9c05d, has
   pre-existing red (ENEMY HARD CAST old=0 new=8, old fork structurally lacks
   castStartEvents); (c) this made it 8→13, all 5 new instances individually verified as correctly re-attributed
   (caster teamId confirmed enemy). **✅ Baseline adjudication closed (2026-08-15)**: private repo
   `gladlog-eval-private`'s `oracle/adjudications.md` records the evidence table — all 13 individually verified
   (cast-event source GUID × COMBATANT_INFO teamId, cross-checked against mutual exclusivity with this round's
   friendly teamId), 8 structural (F170 unrelated to the Mind Control voting fix — the old fork's `CombatUnit.ts`
   has no `castStartEvents` field at all, `?? []` always empty) + 5 brought in by the Mind Control voting fix;
   worktree replay of the pre-voting-fix commit reconfirmed the before/after numbers 8/164→13/164, matching this
   item's estimate. `oracle/baseline.json` now records `L2:block-added:ENEMY HARD CAST` (the old `block-removed`
   entry was invalidated by the F170 fix's direction reversal and removed along with it). Gate back to green
   (164 pairs, 13 adjudicated, 0 new diffs).
3. **[#10](https://github.com/mingjianliu/gladlog/issues/10) agy excessive dispel conclusions**
   (no body text): this is the topic domination complaint, already has an entire governance track running — #22 rate limiting (kept, not removed, see gate
   removal dry run documentation) + selection layer diversity (LEGACY_TOPIC_TYPES dual safeguard, agy 61.3%→42.5%) + #18
   signal expansion. This issue tracked on this line, if still unsatisfactory after expansion batch 2 then escalate.
4. **[#11](https://github.com/mingjianliu/gladlog/issues/11) death recap UX**: filter out
   small damage, only keep GCD-related / significant damage and dispels. Pure renderer/derive layer
   (deathRecap derive + DeathRecapCard), be careful not to create a second set of predicates for threshold — if analysis layer
   already has a "significant damage" criterion (e.g., timing's DAMAGE_SPIKE_THRESHOLD area) check
   predicate-index first to evaluate reuse vs. independent UI display threshold, record the trade-off in implementation comments.
   **✅ Completed (2026-08-11)**: per-type processing landed — direct hits (SPELL_DAMAGE) / direct heals filtered by
   `DEATH_RECAP_MIN_EVENT_PCT` (2% maxHp, derive layer independent UI display threshold, maxHp sourced from
   same advancedActions as hpRangeAt; DAMAGE_SPIKE_THRESHOLD is a window cumulative damage criterion,
   not a single-event fact, evaluated and not reused) retain/collapse; DoT/auto-attack and other non-SPELL_DAMAGE subtotaled by
   (spell × source); HoT ticks go into collapse bucket (empirical test: collapse median 24 rows vs. subtotal 26 rows, take the fewer);
   dispel rows consume reconstructDispelSummary bidirectional unconditional retention; collapsed rows expandable +
   "show all" toggle. Before/after numbers (50 matches / 176 deaths same corpus): per-recap row count median
   114→24, p90 245→36, max 607→46; amount conservation 0/176 violations; 158 new dispel rows
   (previously 0 — dispels were not in the event stream before). Incidental: death-before-10s dual-write unified to
   COUNTERFACTUAL_WINDOW_S single source (criticalMoments 10_000 and desktop
   DEATH_RECAP_WINDOW_S both changed to alias consumption, predicate-index bilingual annotated).

---

## 24. 12.1/S2 data wrap-up batch (logged 2026-08-11)

12.1 data refresh (526a3fb, build 12.1.0.69273) and DR era boundary (5856ee0,
`drResetMsAt` 16s/20s, cutpoint 2026-08-11T22:00Z) are in main; the following are remaining data items,
**all dependent on S2 (2026-08-18 season start) corpus becoming available**, will act after sufficient volume:

1. ~~DR 20s cutpoint empirical verification~~ **Empirically verified 2026-08-12 (launch day)**: wowarenalogs
   30 12.1 US matches downloaded (all after cutpoint), `drWindowVerify.mts` verdict — stun-type
   16.5–19.5s interval bucket duration med 1.5s (n=5) ≈ 8–15.5s bucket (both rules at 50%,
   n=25)'s 1.5s, far from 25–60s fresh bucket (n=155)'s 3.0s → **20s rule in effect**,
   cutpoint needs no adjustment. All categories same direction (n=14/43/317). Incidental: parser 30 matches 0 errors,
   1673 observed ids spell name table 0 missing. Bucket A n is small, can rerun same script for reinforcement after more corpus accumulates.
2. **spellEffectOverrides discrepancy review** — majority resolved 2026-08-11 same day, one remaining truly depends
   on 12.1 corpus:
   - ~~Shadow Dance 185313~~ **Ruled to delete**: 12.0 full-corpus empirical bidirectional disproof of override
     (60/8) — cast interval n=1996 min 6.1s / median 18.5s ≈ generated's 20s charge;
     buff 185422 duration n=2261 median 6.5s ≈ generated's 6s. Override's two values were
     already wrong in 12.0, generated is directly correct. Measurement lesson: buff aura is 185422 not cast
     id 185313 (aura-id-rot family, measuring duration requires aura id).
   - ~~Malevolence/Soul Rot/Coordinated Assault~~ **Deleted as redundant** (DB2 and override
     byte-identical; Soul Rot actually unlocked dispelType:Magic that was being masked by the override).
   - ~~**Fel Barrage 258925 (sole remaining)**~~ **Closed 2026-08-22** (`2a6f7e06`, S2 health check
     `eval-private/reports/s2-health-2026-08-21`): 0 occurrences in 10,682 12.1 matches / 3.3M raw lines and no
     same-named live id in DB2 → the ability is gone in 12.x, so the override row was deleted outright (along with
     its `spellCategories` row) rather than "adopt official 8s" — there is nothing left for the value to apply to.
     The id is also out of `spellEffectGenerated.json` (no longer in any candidate universe). Bookkept here 2026-09-01 (GH #44).
3. **rotScan whitelist rot check** (update-wow-data step 7 denominator): scan by spec
   none-tracked rate + `[DR: spell:<id>` fallback scan; ~20 reworked specs are worst hit,
   expected gaps (Retribution Radiant Glory / Enhancement Doom Winds) — don't false-alarm. #23's deferred
   Netherwalk removal also confirmed in this batch.

   > 2026-08-12 launch day initial scan (`noneTrackedScan.mts`, 30 matches): 22 specs 179
   > cooldowns blocks none-tracked **all 0%**, DR fallback 0 — no 2026-07 style full-spec
   > collapse. But 18 specs absent on day one (Subtlety/Outlaw Rogue, Balance/Guardian Druid, Arcane/Fire Mage,
   > Holy/Shadow Priest, Destruction/Demonology Warlock, Brewmaster/Mistweaver Monk, Protection Warrior/Paladin, Blood DK, Augmentation Evoker, etc.),
   > and present specs partially n≤3 — conclusive check still awaits one week of corpus.

   ~~Conclusive check~~ **Done 2026-08-21/22** as the S2 predicate health check (`15ecc63a` + `1696f0a0` tooling,
   `2a6f7e06` rulings landed): the reverse pass (`curatedRotScan`, 60 registered tables vs 10,682-match observed set)
   found 155 never-observed entries → 14 wrong ids corrected and 22 deleted 12.x spells removed from 19 hand tables
   (Netherwalk included — the #23 deferral closed here); rescan 155 → 69 remaining, all expected zero-event ids
   (talent ids / passives). The forward pass (`drGapScan`) found 63 CC ids the DR table has but `SPELL_CATEGORIES`
   lacks — tracked separately (S2 README §"CC 一个事实两套谓词"), not part of this item. Runbook §7b is the
   standing procedure. Bookkept here 2026-09-01 (GH #44).

4. **benchmarks.json rebuild**: current baseline from 2026-07-20 based on 12.0 corpus (2100+),
   healing/damage numbers significantly retuned and now stale; rerun after S2 corpus reaches volume, note
   [[metric-scale-vs-agreement]] — compare scale-independent counts before drawing conclusions.
   ~~Rerun after S2 corpus reaches volume~~ **Rebuilt 2026-09-01 (GH #44)**: `collectBenchmarks.ts` taught to read the
   `.txt.gz` archive, then run over `manifest-archive-2026-08-28-newseason.txt` — 18,134 12.1 files, 0 parse failures,
   minRating 2100 / minN 30 / perStratumCap 40 exactly as the 2026-07-20 run (single nice'd process, ≈1.3 s/file pass 1
   - 1,288 selected logs re-parsed in pass 2, ~2.6 h). Old → new, scale-independent counts first: pool 18,864 samples
     ≥2100 (old corpus was 12.0 local + public-dps), stratified selection Σn 4,215 → 7,041; bySpec 34 → 34 specs but a
     different set — **gained** Arcane Mage / Fire Mage / Havoc DH / Balance Druid / Demonology Warlock / Outlaw Rogue /
     Protection Paladin (absent from the 12.0 corpus), **lost** Augmentation Evoker (6 samples ≥2100 in the whole 12.1
     archive, below minN; old table had it at n=16 — Aug owners no longer get a SPEC BASELINES block, recorded, not
     worked around). Shape identical (same 9 bySpec keys; every spec has defensiveTiming / cdUsage / pressureWindows; *Pct
     fields sum to 100; pressureWindows p50 ≤ p75 ≤ p90 ≤ p95 for all 34 — the percentile-monotonicity gate cannot go
     red on this data). Scale-free rates moved by season-retune amounts, not pathologically: e.g. Pain Suppression used
     96% → 93% of matches (median first use 27 s → 34 s), Aura Mastery 76% → 86%, Resto Druid Barkskin 47% → 52%; the one
     0% → 78% (Preservation Renewing Blaze) is the 2026-08-23 aura-only-activation ruling now being applied by the
     collector, not a data artifact. Acceptance on the 12-file S2 sample (32 rounds / 92 owner views): findings-prompt
     SHA256 identical (benchmarks feed no candidate), match context changes only in the SPEC BASELINES / INCOMING DAMAGE
     BASELINES blocks (n= headers e.g. Resto Druid n=75 → 197, Fury Warrior n=9 → 69; one new block — Balance Druid).
     `packages/analysis/benchmarks/benchmark_data.json` (the collector's default output, which `specBaselines.ts` names as the source — its
     comment and `cooldowns.ts`'s pointed at a non-existent `packages/tools/…` path, both corrected) refreshed in step.
5. **dispelObservedGenerated backfill**: `confidenceAudit --emit-table`,
   observational table "hasn't happened ≠ can't happen", feed new corpus entries back one by one.
   ~~Feed new corpus entries back~~ **Regenerated 2026-09-01 (GH #44)**: `confidenceAudit.ts` taught to read `.txt.gz` and to skip
   the candidate extraction under `--emit-table` (the table only needs the observation side), then run once, single
   nice'd process, over the union manifest `manifest-fullscale.txt` (12.0, 70 files / 1245 matches) ∪
   `manifest-archive-2026-08-28-newseason.txt` (12.1, 18,134 files) — 18,204 files, ≈0.75 s/file, 2 h 56 min (the 70
   local 12.0 logs, single files up to 375 MB, spike RSS to ~6 GB; a transient peak). Kind tally under the GH #32
   predicate: deliberate 786,976 / proc 111,995 / rider 231,060 excluded, 8 rider-only ids. Table 305 → **421 ids
   (+116, −0)** — additive by construction, every old id kept. Top new attestations: Stellar Flare 202347 ×2,426, the
   12.1 Frostbolt ids 1292107 ×785 / 317792 ×360, Denounce 2812 ×564, Hamstring 1715 ×549, Storm of Destruction 424597
   ×524, Chrono Shift 236299 ×356, Time Warp 342242 ×278, two Polymorph variants (161354 / 460392); 23 of the 116 have
   ≥100 observations, 47 have <10. Manifest + runbook step 6b-pre-4 added so the next season does not need this
   archaeology again. Acceptance (same criterion, same code): `acceptanceHash 300` on the local library — 1,127 rounds,
   aggregate prompt SHA256 identical, zero per-type deltas (the library is 12.0-era, the new ids are largely 12.1);
   12 S2 files / 32 rounds / 92 owner views — identical; 605-file S2 sample (every 30th archive file) — identical too (1,270 rounds / 3,520 owner views, healer + every DPS
   owner: findings-prompt and match-context SHA256 unchanged, all 26 per-type counts unchanged, missed-cleanse 231 dps /
   276 healer both sides). **Why zero, and it is not a measurement problem**: `CORPUS_OBSERVED_DISPEL_IDS` filters
   `ds.missedCleanseWindows` _after_ `dispelAnalysis.getPriority` has already decided which debuffs are worth a
   candidate, and that priority is the hand registry (`spellCategories` + the mitigation allow-list — see the
   2026-08-13 entry under the Curated-List rule): **0 of the 116 newly attested ids are in `spellCategories`**, so every
   one of them is `Low` and never reaches the observed-set gate at all. The regeneration removes the observed-set
   gate as a reason those ids are invisible; the priority registry remains the binding one. Which of the 23 ids with
   ≥100 observations (Stellar Flare, the 12.1 Frostbolts, Denounce, Hamstring, Storm of Destruction, Chrono Shift,
   Time Warp, Creeping Venom, …) deserve a tier is a **user ruling** (tier criteria: [[gladlog-dispel-priority-registry]]),
   not something to fill in from counts — parked in GH #44's comment.
   **User rulings 2026-09-02 (GH #44, after the co-removal study — S2 every-10th sample, 1,814 files, one dispel =
   same caster / target / spell within 50 ms; only Denounce and the Polymorph variants are dispelled _deliberately_
   by healers, solo 56% / 73%)**: (i) Denounce 2812 — "不是特别重要", not registered; (ii) the Balance DoT class
   (Stellar Flare 202347 / Moonfire / Sunfire / Astral Smolder, cleansed as one stack, Stellar Flare solo 3%) — "不是很重要",
   the class stays unregistered; (iii) the 8 Polymorph glyph variants (61305, 61721, 161353, 161354, 277787, 277792,
   391622, 460392) — "变形变体和变形一模一样", registered as `cc(8)` exactly like 118 / 28271 / 28272. The remaining
   ids among the 23 with ≥100 observations (12.1 Frostbolts, Hamstring, Storm of Destruction, Chrono Shift, Time Warp,
   Creeping Venom, …) were never tier candidates: proc / rider removals, or purge targets whose consumer (missed-purge)
   is retired.
   **Acceptance for (iii), same code path before/after**: 605-file S2 sample (1,270 rounds / 3,520 owner views, healer
   - every DPS owner): per-type deltas dps:missed-cleanse 231 → 238, healer:missed-cleanse 276 → 280,
     healer:healing-gap 62 → 61, the other 23 types unchanged; match-context lines containing "Polymorph" 13,083 → 13,350
     (267 new lines + 1 relabelled, across 23 files / 187 distinct events). Local library (`acceptanceHash 300`, 1,127
     rounds, healer owner): missed-cleanse 220 → 252, healing-gap 27 → 24, 24 other types unchanged. Every delta traces
     to one of four `SPELL_CATEGORIES` consumers now recognising the variant: `ccBreakAnalysis` (+105 `[CC BROKEN]`
     own-team-break lines), dispel rendering priority Low → Critical (+78 `[ENEMY CLEANSE]`, +69 `[CLEANSE]`),
     `missedCleanseWindows` (+15 `[UNCLEANSED DEBUFF]`, 9 of them self-annotated ON CD / CC'd / no LoS "not actionable"
     by the GH #20 gates), and the healer-CC coverage predicates (`healingGaps.getCCCoveredMs` drops gaps where the
     healer was sheeped → healing-gap −1 / −3; the `enemyCDs` healer-CC multiplier lifts one `[HEALER EXPOSURE]` burst
     label High → Critical). `[CC ON ENEMY]` lines are unchanged — that path reads the official DR table and already
     knew the variants.
     **Polymorph family duration — ruled and closed 2026-09-02** ("羊本身永远是6秒 除非有龙给的加持续时间的debuff").
     The family carried `cc(8)` while DB2 (PvPDurationIndex-aware) says 6 s, visible on one prompt as `[CC BROKEN] …
7.1s of CC wasted` next to `[CC ON ENEMY] … Polymorph … (6s)` (the latter is the _observed_ aura lifetime,
     `ccTrinketAnalysis` removeMs − applyMs — an earlier note here called it "the official table", which was wrong).
     The ruling was applied as a rule, not a one-id patch, because the hand table was wrong far beyond sheep: of 135
     hand durations, 50 disagreed with DB2 and 9 had no DB2 value; the S2 605-file lifetime scan (APPLIED→REMOVED
     mode per id, Oppressing Roar-tagged) sided with DB2 on **21 of the 22 hard-CC / root disagreements** (Polymorph
     ×11 8→6, Hex 8→6, Freezing Trap 8→6, Entangling Roots / Mass Entanglement 8→6, Hammer of Justice 6→5, Cyclone
     6→5, Blind 6→5, Blinding Light 6→4, Leg Sweep 3→4, Freeze 6→8, Imprison 6→3, Gouge / Intimidation / Dragon's
     Breath / Paralysis / Axe Toss / Storm Bolt 4→3, Asphyxiate 5→3, Blinding Sleet 5→4, Chaos Nova 2→3) and against
     it once (Binding Shot 117526: DB2 2 s, observed 3.0 s ×1084). Landed as one predicate:
     `spellEffectData.ccFullDurationSeconds` (official DB2 duration, overrides layered, hand `SPELL_CATEGORIES` value
     only where DB2 is blank — Kidney Shot set to the observed 5 s, three cast-side ids), the Binding Shot correction
     as `CORPUS_DURATION_PATCHES` (layered on the generated entry, registered in `curatedIdRegistry`), 61 DB2-covered
     hand durations removed from `SPELL_CATEGORIES` with `test/ccFullDuration.test.ts` refusing any new duplicate, and
     the one CC-lengthening effect in arena, Oppressing Roar 372048 (DB2 aura 232 basepoints 50 × PvpMultiplier 0.6 =
     **+30 % in PvP**), applied by `ccBreakAnalysis` when the debuff was on the holder at application. Predicate-index
     row added (EN + zh-CN). `[CC ON ENEMY]` and the DR tables never read the hand duration, so nothing else moves.
     **Acceptance, same code path before/after, S2 605 files / 1,270 rounds / 3,520 owner views**: findings-prompt
     SHA256 identical and all 26 per-type candidate counts identical (the estimate feeds a context line only);
     `[CC BROKEN]` lines 7,618 → 6,400 (distinct events 6,067 → 5,082) — the 1,218 dropped lines are breaks whose
     remaining time fell under `CC_BREAK_REPORT_MIN_REMAINING_S` = 2 once the duration shrank (Dragon's Breath 247,
     Gouge 192, Blinding Light 182, Polymorph 169, Freezing Trap 144, Blinding Sleet 77, Paralysis 67, Imprison 52,
     Sigil of Misery 38, Hex 34, Blind 18); "wasted" values ≥ 6 s **646 → 7 lines**, all seven explained (5 Psychic
     Scream lines at 6.8 / 7.2 s = 6 × 1.3 under a same-team Evoker's Oppressing Roar, 2 Freezing Trap lines at
     exactly 6.0 s = broken on landing); 2 lines appear only after (Sleep Walk under Oppressing Roar crossing the
     2 s threshold); 73 lines that used to render without a number (ids with no hand duration) now carry the DB2
     one. Full analysis suite 148 files / 2,372 tests green, predicate-index test 222.
     **Follow-up the same day (user: "把 3 清理掉吧")**: the remaining 70 hand durations on non-CC types (buffs_offensive 28,
     buffs_defensive 18, debuffs_offensive 10, immunities 6, disarms 3, buffs_speed_boost 3, buffs_other 2) had **zero
     consumers** (the only `.duration` readers are `ccFullDurationSeconds` for cc/roots and `kickLockoutSeconds` for
     interrupts) and 30 of them disagreed with DB2 (Earth Shield 600 vs 3600, Summon Infernal 30 vs 0.25, Power Infusion
     20 vs 15, …) — removed; `test/ccFullDuration.test.ts` now pins `duration` to the four cc fallback ids. Acceptance: S2
     605-file capture, findings-prompt and match-context SHA256 both byte-identical to the previous run, 26 per-type counts
     identical. Side finding recorded as GH #62: no `interrupts` entry has ever carried a duration and DB2 gives none for
     kick ids, so `kickLockoutSeconds` has always returned its 3 s fallback for every kick.
     **ccLifetimeScan FLAGs, adjudicated 2026-09-02 (user: "查一下是不是天赋延长,是就登记")**. The promoted scan
     (`packages/eval/scripts/ccLifetimeScan.ts`, highest local-peak bin) left three ids where the observed full
     duration beats DB2 by ≥ 0.5 s. Two-sided check — DB2 duration-modifier rows (aura 108 SPELLMOD_DURATION on the
     spell's class mask) and a corpus split of casters by observed full length vs their COMBATANT_INFO talents:
     - **Intimidating Shout 5246, 7 s vs 6 — talent, registered.** DB2: Resonant Voice 1243660 (Warrior class tree
       node 108685, all three specs) +20 %; corpus: 79 % of casters whose shout lived ~7 s held it, 0 % of those at
       ~6 s (28 vs 88 casters). Landed as `CC_DURATION_TALENT_MODIFIERS` (spellEffectData.ts, registered in
       curatedIdRegistry) + `utils/ccDuration.ts` → `ccFullDurationForCaster` (multiplies only on
       `talentOwnershipOf` === "yes"); `ccBreakAnalysis` now passes the caster. The two other DB2 rows on the same
       mask (Thundering Roar 322093 +100 %, Warchanter 266143 +50 %) are not in the 12.1 trees and separated nobody
       — not registered. The scan labels the 7 s peak `talent` from now on.
     - **Chaos Nova 179057 and Void Nova 1234195, 4 s vs 3 — not a talent, left on DB2.** No DB2 modifier row hits
       either mask; no talent, PvP talent or spec separates the ~4 s casters from the ~3 s ones (Chaos Nova 27 vs 14
       casters, best talent 22 % vs 7 %; Void Nova: all 9 casters with talent data reach 4 s and the 3.0 s cluster
       sits inside the same casters, 4.0 s ×45 vs 3.0 s ×54). Whatever lengthens them is not in the loadout — open
       question, DB2 3 s kept, the scan will keep flagging them until someone finds the mechanism.
       Acceptance (S2 605 files / 1,270 rounds / 3,520 owner views): all candidate types identical; `[CC BROKEN]` lines
       6,400 → 6,416, every changed line an Intimidating Shout break — 130 rewritten (+1.2 s "wasted" for casters holding
       the talent) and 16 that crossed the 2 s report threshold. Tests: `test/ccDuration.test.ts` (real talent tree,
       node 108685 → 7.2 s; unknown loadout → 6 s), a ccBreakAnalysis case (5.7 s vs 4.5 s remaining).
6. **eval baseline / candidate incidence rates full recalibration**: 63.6/14.1/15.6 and other old numbers considered
   expired after 12.1; rerun `/eval-baseline`, rate-limiting type (#22 temporary gate) thresholds reviewed alongside incidence rates.
   > **2026-09-01 status (GH #44)**: the deterministic half already exists — the 2026-08-22 skill-gradient study
   > (`eval-private/reports/signal-skill-gradient-2026-08-22`, 10,301 12.1 matches / 23,056 healer rounds) carries every
   > signal's S2 per-opportunity conversion rate by bracket (#34 rulings were made on it), which supersedes the 12.0
   > per-match incidence numbers as the calibration reference. Still open and **both user calls**: (a) the model-run
   > `/eval-baseline` (batched sonnet responder/judge cost — say the word and it runs); (b) the #22 cap review — the
   > 2026-08-11 dry run ruled "do not remove" pending batch 2 (DEATH-002 / OFFENSIVE-001), and batch 2 has not landed,
   > so the removal condition is still unmet; nothing to re-decide until it does.
   > **2026-09-02: `/eval-baseline` run (user approved).** Run `2026-09-02-baseline` on `manifest-ab-newseason.txt`
   > (309 prompts; judged the every-8th subset n=39 across 6 healer specs — the first-50 rule would have covered 5 with
   > no Resto Druid / Pres Evoker); sonnet responder + sonnet judge, checkProvenance 39/39. Prompt dimensions at ceiling
   > (sufficiency 5.00, noise 4.85, labelBias 4.95, scaffolding 5.00); accuracy 3.74 ± 1.06 — flat against the 2026-07-22
   > 12.0 baseline (3.85 ± 1.03), inside the SD≈1 noise floor. 597 audited claims: 91.8% verified, 34 refuted (numeric /
   > timestamp precision), 15 unsupported (causal hardening, 2× F193 CONTESTED), 1 fabricated. The one actionable
   > prompt bug is deterministic, not judged: 3/309 prompts fail the cooldown-ledger consistency class (death line says an
   > external was `available`, same-second `[RES]` lists it on `cd:`) → filed as its own GH issue. Report:
   > `eval-private/runs/2026-09-02-baseline/eval-report.md`, ledger row added. With this, #24-6's only open item is the
   > #22 cap review, still gated on batch 2.
   > **Correction 2026-09-02**: the #22 cap review was never pending — the user ruled on 2026-08-20 (`551438fb`) that the
   > caps stay long-term (no-cap simulation 64.6 % vs 16.8 % with cap=2), and missed-purge was demoted to context facts on
   > 2026-08-29 (`17356e93`, GH #50 (a)); "(b)" above and the same wording in GH #44 comments were stale. **#24-6 closed.**
7. ~~observedSpellIds +7 new ids into icons/offGcd universe~~ **Done 2026-08-11**
   (pipeline fix ac3a6a2f same-day opportunistic: observed 3346→3353, icons 41729→41734,
   offGcd 295→296, validateCatalogs green) — didn't actually depend on S2 corpus, was incorrectly categorized in this batch.

8. ~~**Ring of Fire new id tracking**~~ **Closed 2026-08-19** (2026-08-13 patch notes review finding): official 12.1
   notes explicitly state "Ring of Fire duration increased to 4 seconds (was 3)" — the ability
   is still alive; yet 363405 was deleted from SpellName@69273 (526a3fb per orphan row deregistration).
   > **Resolution**: not a new id — Blizzard reverted to the classic id family. DB2@69382: `353082` is the
   > only "Ring of Fire" with PvpTalent rows (specs 62/63/64, OverridesSpellID=113724 Ring of Frost);
   > `353084` is the burn aura. The 69382 refresh (17733808) picked everything up automatically:
   > effects table has 353084 dur=4s (the patch-notes buff) dispel=Magic + 353082 cd=45s; DR table has
   > 353084 (incapacitate, DiminishType=16); observed universe has both ids; pvpTalentReplaces has
   > 353082→113724. Nothing to hand-register. **The old ruling's "historical logs still need 363405"
   > clause was empirically false**: 363405 has 0 occurrences in the whole observed universe (3417 ids)
   > — it was a spellbook-only id; logs always used 353082/353084 (verified in 12.0-era logs: 353084
   > SPELL_PERIODIC_DAMAGE present, 363405 absent). Its KNOWN_REMOVED_SPELLS tombstone was therefore
   > dead weight (the @69382 SpellCategories orphan row is also gone) — deleted, validateCatalogs
   > green without it (5 catalogs OK, same counts). SpellName deregistration ruling itself unchanged.
9. ~~**Ancient of Lore (473909) 20% damage reduction not in mitigation table**~~ **Closed 2026-09-01 (GH #44)** — and the
   "don't fill numbers from patch notes" clause earned its keep: the official value is **30%, not 20%**.
   DB2 SpellEffect@12.1.0.69404 has the row on the cast id itself (EffectIndex 2: `aura87 pts=-30 misc=127`, all
   schools; the other 21 rows are the shapeshift/override-bar/mechanic-immunity set), wowhead tooltip says 30% (12s,
   1.5min CD), S2 archive observes the aura (2.0% of a 605-file sample, 12 files, plus the original 7d74b373).
   Registration went through the generation layer, not a hand override: `473909` added to
   `spellIdLists.attributedMitigationSpellIds` (the Blur 198589 precedent) → `genMitigation` regenerated on the same
   build → `mitigationGenerated.json` +1 entry exactly (18 → 19, unresolved 8 → 8); `mitigationVerdicts.ts` gets the
   mandatory entry as `unresolved` (tier is the user's word — precedents: 40% wall → kill-live-gated, 25% Blur → never;
   30% + full CC immunity sits between them); `talentBehaviors` label 20% → 30%. Note `talentMitigationGenerated.json`
   (2026-08-18) had already mined the same −30 for 473909 but that table has zero consumers — product arithmetic reads
   `MITIGATION_TABLE` only.
   **Acceptance (same criterion before/after, 12 S2 files with the aura / 32 rounds / 92 owner views, healer + every
   DPS owner)**: per-type candidate counts identical (burst-into-mitigation 5 → 5; that candidate reads `MITIGATION_TABLE`
   directly and does not consult the verdict — the verdict gates the OFFENSIVE-WASTE context lines instead, and
   `unresolved` renders none of them), findings-prompt SHA256 identical; match-context changed in exactly one mechanism — the kill-attempt
   ledger (`killAttempts.ts` reads `MITIGATION_TABLE` for "popped a real defensive"): 13 of 609 `FAILED:` lines
   (6 distinct attempt windows, rendered per owner view) moved from `not enough damage` ×9 / `popped Barkskin` ×2 /
   `popped Ironbark` ×2 to `popped Ancient of Lore` / `Barkskin/Ancient of Lore` / `Ironbark/Ancient of Lore`.
   **Side finding fixed in the same commit**: the first pass rendered `popped Ancient of Lore/Ancient of Lore/Ancient
of Lore` — the shapeshift aura re-applies on every form refresh (match ad329f4a: 3 casts, 23 `SPELL_AURA_APPLIED`,
   same-millisecond REMOVED+APPLIED pairs) and `defensivePopped` pushed one name per APPLIED; it now dedupes by
   spellId (a wall whose CD exceeds the span cannot be popped twice in one attempt), pinned by a flicker fixture in
   `killAttempts.test.ts`. Not fixed, recorded: an in-span _re-application_ of an aura that was already up before the
   attempt started still counts as "popped during the attempt" — the ledger keys on APPLIED events, not aura
   intervals; a proper fix routes through `buildAuraIntervals` (#28) and is a semantics call, so it is parked here.
   **User ruling 2026-09-02: keep the current behaviour** ("popped" = an APPLIED inside the span + slack); no interval
   rewrite, no new label. Closed as ruled. Verdict tier: the user's 2026-09-02 reply to the entry as recorded was
   "没问题" — it stays `unresolved` (no OFFENSIVE-WASTE lines rendered for it); re-open only when a tier is named.
   Also caught: `writeManifest.ts` did not know `spellReachGenerated.json` (hand-registered with GH #34 ② on
   2026-08-29) and silently dropped it on the next run — the script now emits that entry.

New season log collection/archival (launchd loading etc.) see #19, user-managed, not in this item.

## 24. `dr` reverse query always empty — `analyzeOutgoingCCChains` target side hardcoded Hostile

> **2026-08-14 fixed** (`packages/analysis/src/utils/drAnalysis.ts`): target filter changed from
> `e.reaction === CombatUnitReaction.Hostile` to "Player type + belongs to the passed-in
> second parameter set" id-set membership, `reaction` no longer participates in target determination. All product
> forward callsites (candidateFindings/momentSnapshot/deepDive/ccChainDash etc.)
> behavior unchanged (parity tests pinned). Ripple check found `archetypeInference.ts` already had one
> reverse call (`analyzeOutgoingCCChains(enemies, friends, combat)` computing
> `enemyTeamCCPerMin`), its companion ported test (B53) even manually set friendly units' `reaction`
> to Hostile to work around this bug — after the fix that workaround is no longer necessary but the test still passes;
> that function (`extractMatchDynamics`) is currently not called by any product runtime path, so this
> semantic change has zero product impact. Acceptance: `matchExplore.ts 76ea5f90 dr --from 0 --to 188`
> pre-fix 25 rows (all forward, 0 reverse) → post-fix 55 rows (25 forward unchanged + 30 reverse enemy CC landing on
> Girlbye/Minilay/Boofers etc.). Test: added
> `packages/analysis/test/drOutgoingCCReverse.test.ts` (reverse RED→GREEN +
> forward parity snapshot).

`packages/eval/src/explore/matchExplore.ts`'s `dr` query as designed calls `analyzeOutgoingCCChains` once in each direction,
but the predicate internally filters target side to
`e.reaction === CombatUnitReaction.Hostile` (drAnalysis.ts ~:454), so the reverse call
`(enemies, friends)` has all friendly targets filtered out — enemy-cast CC is always 0 rows. Deep dive ceiling experiment
first match (2026-08-12, match 60ab1e8f) real usage exposed it immediately: enemy hammer forced owner to trinket 5 times,
`dr` showed 0 enemy CC. Product side unaffected (enemy CC uses `analyzePlayerCCAndTrinket`
owner-side predicate).

Fix direction: change the predicate's target filter from hardcoded Hostile to "belongs to the passed-in second parameter set"
(semantically more correct, existing product calls `(friends, enemies)` behavior unchanged), with parity tests + product
callsite regression; or have the `dr` query's enemy direction use `analyzePlayerCCAndTrinket` aggregated per owner.
Check predicate-index before starting (involves DR chain single-source).

> **2026-08-14 ability fact foundation project closing note**: this project (`usableWhileCcGenerated.ts`/
> `usableWhileStunned`/signed register) does not cover this item — `analyzeOutgoingCCChains`' target-side filter
> and "what abilities can be used while CC'd" are two different fact surfaces (former is CC cast attribution direction, latter is self
> ability availability after being CC'd), unrelated to each other — still an independent open item.

## 25. Two cases of mechanistic misuse in product suggestions (caught by deep dive experiment first-match blind review, match 60ab1e8f)

Reviewer (the holy paladin player themselves) judged two types of baseline suggestions as "fundamentally wrong" in 2026-08-12 blind review:

1. ~~**BoS self-cast regression suspected**~~ **Triaged & fixed 2026-08-19 — NEW generation path, not a regression**:
   "Blessing of Sacrifice was still available when downed" implies the dying player could use Sacrifice to self-rescue — Sacrifice
   cannot be cast on self. This type was fixed 2026-08-01 (12→0, see backlog #10 closing notes),
   recurred with promptVersion 24.
   > **Triage verdict**: the 2026-08-01 guard (`SELF_CAST_NOOP_EXTERNAL_IDS`) is intact and had even been
   > extended to three filtering call sites (cheaper-alternative / [DEATH] Unused / death candidates). The
   > reviewed sentence came from a **cooldown-LEDGER surface** built later and never guarded: exact repro —
   > `cdLines(60ab1e8f, 505)` renders `8:25 Minilay-Illidan-US ready: Blessing of Sacrifice,Hammer of
Justice | onCd: ...`, the verbatim line the reviewer annotated ("这是一个bug 我自己的牺牲不能对自己使用").
   > Same undiscriminating `cdAvailableAt` binning exists in `momentSnapshot.ts`'s cd-ledger (product
   > deep-dive pack). **Fix**: ledger surfaces must not FILTER (BoS-ready is genuinely actionable toward a
   > dying teammate) — new shared helper `selfCastNoopAnnotatedName` (cooldowns.ts, next to the set) renders
   > `Blessing of Sacrifice(仅可施于队友,不可自保)`; both renderers wired, registered in predicate-index
   > (three-way pinned by `predicateIndex.test.ts`). **Before/after (same criterion — victim's own row,
   > ready side, bare BoS; 60ab1e8f + 40 S2 matches, 72 deaths)**: cd-ledger bare 1→0 (annotated 0→1),
   > cdLines bare 1→0 (annotated 0→1) — rows preserved, no fact lost. TDD: momentSnapshot.test.ts +2
   > (red→green), explore.queries.test.ts +1.
2. **Immunity-blocks-stun-type counter-suggestion** (2026-08-14 corrected): Divine Shield mechanistically **can be pressed in any CC state**
   (user clarification + flag bits corroborate, original "can't be pressed" judgment was wrong) — the issue is not at the mechanics layer but at the **cost normalization layer**:
   a 5-minute major cooldown shouldn't be recommended as a routine CC counter (Ice Block same situation). Fix = candidate layer cost-norm
   guard comment (signed register entry), not a mechanics gate; "usable while CC'd" mechanics fact officiated by ability fact foundation project.

Reproduction materials: `gladlog-eval-private/review-sessions/2026-08-12-60ab1e8f.*` (session contains
per-card annotations, answers contains reviewer's verbatim notes).

> **2026-08-14 ability fact foundation project closing note**:
>
> 1. **BoS self-cast regression suspected**: not covered by this project, unrelated (involves candidate generation path regression, not
>    an ability fact assertion issue) — still needs prod-triage per original text to locate independently.
> 2. **Immunity-blocks-stun-type counter-suggestion**: mechanics layer now officiated — `usableWhileStunned` confirms Divine Shield
>    (642) / Ice Block (45438) **can be cast while stunned**, official DB2 `SpellMisc.Attributes` bit flags
>    (`usableWhileCcGenerated.ts`) only prove this one point; "mechanistically castable in any CC state" — this broader
>    statement comes from user signed anchor point (Task 2, 2026-08-14), not from the official bit itself — the official bit and user ruling
>    conclusion are consistent, but evidence sources must be distinguished, cannot be broadly attributed to "official DB2 bit flags" (finding #5, 2026-08-14
>    final review correction). There is no such thing as "can't be pressed" — the original judgment was wrong and that conclusion is settled. **Cost normalization layer signed register
>    entries have landed**: 642/45438 two `cost_norm` entries registered in
>    `curatedAbilityFacts.ts` (Task 6, 2026-08-14 user signed: "mechanistically castable in any CC state,
>    but cost too high, must not be recommended as routine CC counter, only as last resort under lethal threat"). **Candidate layer
>    guard comment consumer not yet wired** — the signed register currently has no consumer importing it to filter/downrank
>    candidate suggestions (full-repo search confirmed), meaning "should not be recommended as routine CC counter" is currently only recorded on file,
>    no code actually blocks the model from suggesting 642/45438 as routine responses; this candidate layer wiring left for the next batch
>    of tasks.
>
> **Candidate layer guard comment consumer now wired (2026-08-14, deferred items cleanup Task D, commit 415353e)**:
> `candidateFindings.ts`'s `deathUnusedDefensiveEvents` (defensive available but unused at death) and
> `cdWasteEvents` (major defensive CD unused entire match) — the two locations most likely to produce "should have used 642/45438" suggestions —
> when hitting `curatedAbilityFacts.ts`'s new single-source helper `costNormPhrase(spellId)`,
> attach `facts.costNorm` phrase; `buildFindingsPrompt.ts`'s corresponding legend line explains the field's meaning
> (model can only suggest these abilities as "last resort under lethal threat", must not suggest as routine response).
> `CURATED_ABILITY_FACTS` now has its first consumer (previously the signed register had zero consumers, only a record).
> Deep dive handbook `docs/commands/deepdive-probe.md` "how to write decision point cards" section has a reminder added.

## 26. Two high-value streams discarded by the parsing layer from raw logs: mana values + SPELL_CAST_FAILED

Deep dive experiment free arm (2026-08-14, match 60ab1e8f) empirical evidence: parser's `advancedActorPowers`
being always empty is **a parsing layer choice, not log absence** — raw.txt's advanced parameters contain per-event mana values,
SPELL_CAST_FAILED stream (933 entries/match) contains player key-press intent (spell name + rejection reason). Both streams' unlocked
analysis capabilities have been empirically demonstrated:

- Healer mana war reconstruction (that match's death cause was reclassified as **mana death**: final 10 seconds Holy Shock rejected 15 times,
  mana 545/273000; all four previous rounds of constrained deep dive attributed the cause to defensive rotation, missing the root cause);
- Enemy healer drink detection and harassment prescription (three sit-downs recovering 144k mana, one tick of damage interrupting drink empirically demonstrated);
- Healer spell mana efficiency audit (Flash of Light 29% mana cost only bought 11% effective healing);
- Intent distinction for "no response" type conclusions (pressed but rejected vs. truly didn't press).
  Additionally: trinket (336126) cast is also only visible in raw (previously discovered).
  Direction: parser collects these two streams (or minimally: analysis side builds raw.txt auxiliary predicates), downstream feeds
  candidate layer (mana pressure candidate / drink harassment candidate) and deep dive tools. Evaluate parsing cost and slim migration impact before deciding.
  Reproduction scripts: gladlog-eval-private/review-sessions/freeform-60ab-scripts/.

> **2026-08-14 ability fact foundation project closing note**: not covered by this project, still an open item — mana values /
> `SPELL_CAST_FAILED` are **parsing layer (parser)** discarded raw log streams, not unmined fields in DB2 official data tables,
> and are unrelated to this project's A2 census (`docs/ability-fact-inventory.md` "A2. Official effect surface
> census" section, `dumpTableColumns.ts` per-column mined/unmined inventory of 7 candidate tables including `SpellMisc`/`SpellAuraOptions`) —
> A2's candidate pool has no fields that could substitute for these two streams. If systematic treatment of
> "what the parsing layer discards" is needed in the future, it should be a census dimension independent of A2, not searched for in A2's pool.

---

✅ **2026-08-16 closeout — shipped vs. deferred**.

**Shipped (flags stay OFF, code complete with test coverage)**:

- **rawStreams single-source module** (`packages/analysis/src/utils/rawStreams.ts`, Task 1/1 via `9afc6ef7`): mana values (`manaSamples`) and intent stream (`castFailed` = `SPELL_CAST_FAILED`) extracted from raw.txt during parsing, structured alongside the match's built-in legacy data; consumer signature `parseRawStreams(rawText: string, baseMs: number, roundDurationS?: number)` scopes samples to reporting round with optional third parameter (fixed Task 7b cross-round contamination).

- **Intent guard — "pressed but rejected" correction** (Task 2 via `1c9c05d`, deployed with `cdHoardedEvents`/`death-unused-defensive` candidates): `castFailedInWindow(rawStreams, spellId, fromS, endS)` predicate downgrades severity when a major CD / self-defensive cast was rejected at the moment it was being scouted (36.0% corpus 冤枉面 for cd-hoarded / death-unused combined).

- **matchExplore mana/drink subcommands** (Task 4, CLI `--match <id> mana`/`--match <id> drink`): deep-dive discovery tool for healer OOM windows and enemy healer drinking behavior, consumes rawStreams data directly.

- **SpellPower mana-cost datagen** (Task 4 via SpellPower datagen integration): `spellManaCostGenerated.json` table of mana costs per spell, consumed by `manaEfficiencyEvents`.

**NOT shipped (both flags remain false — user decision 2026-08-16)**:

- **`manaPressure` candidate type** (Task 3/6/7 branch A): healer OOM window × rejected-cast-intent pair detection. Flag `CANDIDATE_TYPE_FLAGS.manaPressure` stays `false`. Rationale: both `mana-pressure` and `mana-efficiency` candidates give **context-free mana advice** ("you spent too much this period" / "this spell bought little healing") that **ignores whether the spending was FORCED by enemy burst windows requiring short-window HPS dumping** — useless without forced-vs-unforced attribution. Reference reports: `gladlog-eval-private/reports/raw-streams-calibration.md` / `raw-streams-ab.md`.

- **`manaEfficiency` candidate type** (Task 4 branch B): whole-match aggregation-level "blue audit" (healing spell mana cost % vs. effective healing %). Flag `CANDIDATE_TYPE_FLAGS.manaEfficiency` stays `false`. Same rationale as `manaPressure` — the cost-to-benefit ratio detects low efficiency in hindsight but provides no causal path (was the low efficiency due to unforced overspending, or unavoidable forced spending on burst cover?). Both types' implementation and test coverage remain in place, candidates are unshipped but compile-ready for a future spec that includes causal attribution.

**Successor project logged separately as BACKLOG #33** (mana attribution with causal conditioning on forced-vs-unforced damage intake).

## 27. `aurasActiveAt`'s slice(0,10) truncation can hide critical auras (hard CC pushed out by cosmetic auras)

`packages/analysis/src/analysis/momentSnapshot.ts:76` hard-truncates the moment aura list to 10 entries, with no priority
sorting — 2026-08-14 free arm empirical evidence (match 76ea5f90): owner 2:48-2:53 frozen by Freezing Trap spanning the teammate's
entire death slide, but the trap aura was pushed out of the top 10, causing constrained arm two rounds (R1 "2:51 BoP could have saved", R2 "healing
gap 5 seconds") to both be built on the false premise of "he could move" — even the reviewer themselves misjudged and accepted. Fix direction:
sort by aura category before truncation (hard CC / immunity / major CD auras always in front, cosmetic at the back), or raise cap + annotate truncation.
Involves auras query and moment snapshot pack dual consumers — check predicate index before changing.

> **2026-08-14 ability fact foundation project closing note**: the truncation bug described here **has still not been fixed, remains
> an open item** (`momentSnapshot.ts:76`'s `slice(0, 10)` unchanged). But this project mitigated from another path
> a portion of the same false-premise family: this item's core mistake is "assuming owner could move" (aura list didn't show
> freeze), not "knowing CC'd but not knowing if abilities can be pressed" — `usableWhileStunned` officiating
> (Task 3/5, `usableWhileCcGenerated.ts` official 468 set ∪ signed register gaps/conditional layer, total 471)
> solves the latter type of misjudgment (e.g., #25's Divine Shield "can't be pressed"), has no help for this item's "CC state itself not being seen" type
> truncation problem — **the two are different stages under the same broad false-premise category, #27 still needs independent fixing**.

> **Fixed (2026-08-14, see commit)**: `aurasActiveAt` now sorts by `auraPriority` before truncation — hard CC
> (`spellId` ∈ `drAnalysis.ts`'s `DR_CATEGORY_MAP`) > major CD/immunity (`spellId` ∈
> `cooldowns.ts`'s `MAJOR_DEFENSIVE_IDS`, which already contains all `IMMUNITY_SPELLS` ids) > rest in original order,
> cap still 10. Replay acceptance (match 76ea5f90, `auras --t 170`, 2:48-2:53 Freezing Trap window):
> pre-fix Minilay aura list had no Freezing Trap, post-fix shows "Freezing Trap, Freezing Trap, …".
>
> **Diagnosis correction (2026-08-14, reviewer re-derived from raw to confirm)**: "Freezing Trap" appearing twice in replay
> is **not** two casts/sources — that window (160-176s) has only one real `APPLIED` (168.075s, caster
> Boofers). At 173.421s and 173.422s two close events arrive in succession (`SPELL_AURA_BROKEN_SPELL`
> caster Brucatodo, then `SPELL_AURA_REMOVED`): the first normally consumes the sole open interval; the second
> arrives with the open interval already consumed, finds no match, falls into `buildAuraIntervals`'s "pre-existing before match" fallback branch
> (`auraIntervals.ts:143-155`), back-projects a phantom interval using official duration (6s)
> `[167.422, 173.422]` — overlapping the real interval `[168.075, 173.421]` at `t=170`, `aurasActiveAt`
> thus renders the same CC as two entries. This is `buildAuraIntervals`'s own **dual-close-event race** pre-existing
> bug (same spellId closed by two different close events in a short window, second one misjudged as "pre-existing before match"),
> this fix only made it visible for the first time in `aurasActiveAt`'s truncated output — **not introduced or
> fixed by this item's fix** — **independently filed as BACKLOG #28, not fixed alongside this item**. Both consumers
> (`auras` CLI query, moment snapshot pack) tests all green; predicate index bilingual annotations synced.

## 28. `buildAuraIntervals` dual-close-event race fabricates phantom interval (logged 2026-08-14, root-caused by reviewer from #27 replay)

`packages/analysis/src/utils/auraIntervals.ts`'s close event handling (`CLOSE_EVENTS` =
`SPELL_AURA_REMOVED`/`SPELL_AURA_BROKEN`/`SPELL_AURA_BROKEN_SPELL`, pairing logic at
`:118-156`) assumes an open interval for the same spellId will only be closed once within the entire matching window. When the same spellId
receives **two different** close events in a very short time window, the first normally consumes the sole open interval; the second
arrives finding no matching open interval, falls into the "pre-existing before match, only seeing it drop this match" fallback branch
(`:143-155`), back-projecting a **phantom interval** using `officialDurationS` — fabricating a record that overlaps heavily
in time with the real interval but has fictitious boundaries.

**Reproduction**: match `76ea5f90`, Minilay, spellId `3355` (Freezing Trap), window 160-176s.
Real `APPLIED` only once (168.075s, caster Boofers). 173.421s's `SPELL_AURA_BROKEN_SPELL`
(caster Brucatodo) arrives first, closes normally, producing real interval `[168.075, 173.421]`; 173.422s (1ms later)
`SPELL_AURA_REMOVED` arrives, finds no open interval, fallback branch back-projects phantom interval using 6s official duration
`[167.422, 173.422]`. Both intervals cover `t=170` — any consumer querying this spellId at a time point will see
"two Freezing Traps" at `t=170`. #27's `aurasActiveAt` truncation priority fix made this
pre-existing but previously truncated/unnoticed phantom interval visible in the output for the first time — **#27's fix did not
create this bug, only stumbled upon it**.

**Mechanism summary**: the fallback branch's trigger condition is "close event arrives and `open` map has no
open interval for that spellId" — this condition was designed to handle the legitimate case of "only seeing the drop, never seeing the apply" across the whole match
(auras existing before match start), but doesn't distinguish "truly never APPLIED" from "APPLIED before but already
consumed by another close event that arrived earlier." The latter is the same real CC being redundantly reported by two close events (WoW
combat logs frequently emit more than one of `BROKEN`/`BROKEN_SPELL`/`REMOVED` for the same drop),
and should not be treated as a second "pre-existing" aura.

**Fix direction** (not designed, only recording direction): when a close event arrives with no matching open interval, if the same spellId
was **just** closed within a very short time window (needs a new constant, can't be arbitrary) (i.e., the most recent entry in `out` for the same
spellId has `toS` close to current event time), should be treated as a duplicate close event for the same CC instance — discard/dedup,
rather than unconditionally entering the "pre-existing" branch to back-project a new interval. The change should only affect this one judgment path, not touch open interval
normal pairing logic (`:96-104`), DOSE semantics, or the existing "exact key priority, same spellId fallback" close
strategy (`:122-129`, the target of the 2026-07-25 fix — don't regress the old problem it solved).

**Impact surface**: `buildAuraIntervals` is the single source for aura intervals — **all** downstream consumers affected —
`aurasActiveAt` (`momentSnapshot.ts`, where #27 stumbled upon it), `auraUptime` (uptime stats/rendering),
`counterfactual.ts` (mitigation counterfactual aura interval filtering), and any future consumers via `utils/auraIntervals.ts`.
**Not** the same thing: `docs/predicate-index.md`'s "not yet unified" section documenting
`utils/utils.ts` and `utils/auraIntervals.ts` having two same-named `buildAuraIntervals` — those are two different functions
(different signatures, different consumers, `utils.ts` version only feeds `burstLedger.ts`), this item
is a race bug internal to the `utils/auraIntervals.ts` function, unrelated to the name collision — fixing this doesn't involve that
name collision registration.

---

✅ **Fixed (2026-08-15)**.

**Measured first** (`packages/eval/scripts/auraDoubleCloseScan.ts` + `src/explore/auraDoubleClose.ts`,
full corpus, 1028 matches, 0 errors): this diagnostic script independently replays `buildAuraIntervals`'s
open/close pairing logic (does not touch production code) and, for every "close event finds no open
interval" fallback-branch trigger, additionally records "gap since the previous close event for the same
spellId" — a signal the production function itself never computes. Corpus-wide: the fallback branch fired
96089 times total, of which 32384 had no prior close at all (genuine "already up before the match, only
saw it drop" cases — unaffected by this fix); the remaining 63705 had a prior close, with the following
cumulative gap distribution: ≤0.01s 45719, ≤0.1s 53421, ≤0.5s 61620, ≤1s 63590, ≤2s 63613, ≤5s 63638,
≤10s 63673, ≤30s 63686 — **gaps cluster sub-second** (≤0.5s already accounts for 96.7% of the non-empty
gaps, ≤1s for 99.8%), and barely grow beyond that (1s→30s is only +96), proving that "redundant close
events double-reporting the same real drop" and "genuinely independent drops separated by a real gap" are
cleanly separated on the gap-distance scale — not an arbitrary call.

Classifying by a 1-second threshold (`DUPLICATE_CLOSE_WINDOW_S`, justification above): **63590 phantom
intervals, affecting 1023/1028 matches (99.5%)**. The incidence is this high because the underlying
mechanism is common — most hard CC (Freezing Trap, Polymorph, Cyclone, Psychic Scream, etc.) drops with
WoW's combat log frequently emitting more than one of `SPELL_AURA_BROKEN`/`BROKEN_SPELL`/`REMOVED` for the
same drop; `76ea5f90` was simply the first case the reviewer happened to run into.

**Mechanism**: when a close event arrives and the `open` map has no open interval for that spellId, the
original code unconditionally judged "already up before the match, this match only saw it drop" and
back-projected a fabricated interval from the official duration. The fix: instead ask whether this spellId's
most recent already-emitted close event (whether from normal pairing or an earlier fallback-branch hit) is
within `DUPLICATE_CLOSE_WINDOW_S` (= 1 second) — a hit is treated as a redundant close-event report of the
same real drop and discarded (no interval produced); a miss falls through to the original fallback branch.
The change touches only this one judgment path (`auraIntervals.ts:118-172`) — normal pairing, DOSE
semantics, and the existing "exact key priority, same-spellId fallback" close strategy are untouched. TDD
coverage (`test/ported/auraIntervals.test.ts`, 4 new cases): exact reproduction of `76ea5f90`'s dual-close
1ms race (now emits only one interval), a triple redundant-close pile-up (still only one interval), and two
negative controls (a genuine already-up-before-match isolated `REMOVED` is unaffected; two drops of the same
spellId 60 seconds apart still both back-project normally — not swallowed).

**Before/after numbers (same criterion)**: `76ea5f90` @173s, `aurasActiveAt` used to render "Freezing Trap,
Freezing Trap" (duplicated) → after the fix, just "Freezing Trap" (single). Two additional spot-checks
(`c84e13b5`'s Eranu multi-`BROKEN_SPELL` Polymorph chain, `d2a90ac4`'s Холод) show no duplicate names either.
The diagnostic script's own count (fallback-branch triggers with a ≤1s prior gap) — **63590 → 0** — uses the
exact threshold logic now running in production (not a re-derivation), so this is not "read the code plus a
convincing commit message"; it is a corpus-wide count-based verification.

**No regression in scope**: `packages/analysis` full suite (incl. `momentSnapshot.test.ts`,
`counterfactual.test.ts`) and `packages/desktop` full suite (incl. `report.aurauptime.test.tsx`) both green;
`npm run typecheck` and `npx eslint . --quiet` clean.

**Predicate-index cross-check**: the `utils/utils.ts` vs `utils/auraIntervals.ts` `buildAuraIntervals`
name-collision entry registered 2026-08-05 in `docs/predicate-index.md`'s "Not yet unified" section is
unrelated to this item (per the existing conclusion in the "Impact surface" paragraph above) — this fix does
not touch that name-collision registration and left the predicate index unchanged.

## 30. P1/P2 distillation final-review debt (logged 2026-08-15, `final-review.md`) — renumbered from the original "## 29" to make way for the cooldown-ledger t=0 blind spot entry below, which now legitimately occupies "## 29"

1. ~~**`extractMajorCooldowns` computes a negative `cooldownSeconds` for a handful of spellIds**~~ ✅ Fixed
   (`2d5993c8` + `547ec6f1`): `packages/analysis/src/utils/cooldowns.ts`'s existing cooldown-derivation logic,
   unrelated to the four new candidate types added by this P1/P2 distillation work. Task 5 calibration
   (`~/code/gladlog-eval-private/reports/p1p2-calibration.md`) sampling 1681 team-offensive major-CD casts from a
   300-match sub-sample found 5 (~0.3%) with negative values: `265187` Summon Demonic Tyrant (×4) and `1719`
   Recklessness (×1). The magnitude was small and did not affect any calibration conclusion, so it was not fixed
   inside the calibration task at the time — flagged here for the next time `cooldowns.ts`'s cooldown-derivation
   logic is touched. **Resolved in two passes**: `2d5993c8` root-caused it to the datagen generation layer, not
   `cooldowns.ts` itself — `genTalentModifiers.ts` classified DB2 aura 107/108
   (`SPELL_AURA_ADD_FLAT/PCT_MODIFIER`, a generic "apply one SpellMod" aura whose `EffectMiscValue_0` is the real
   sub-type selector, a SpellModOp code) as `reduce_cd` regardless of sub-type. Cross-verified against real DB2
   rows (build 12.1.0.69273) and Wowhead tooltips: `265187`'s two negative contributions were actually Master
   Summoner (`1240189`, `MiscValue_0=10=SPELLMOD_CASTING_TIME` — a cast-time reduction, not a cooldown one) and
   Reign of Tyranny (`1276748`, `MiscValue_0=1=SPELLMOD_DURATION` — a duration extension); `1719`'s were Reckless
   Abandon (`396749`, `MiscValue_0=23=SPELLMOD_EFFECT3`) and Rampaging Berserker (`1269310`, also `DURATION`).
   Fix: gate aura 107/108 on `EffectMiscValue_0 === SPELLMOD_COOLDOWN (11)` (effect 148 and the dedicated
   charge-recovery aura 453 unaffected), regenerating `talentModifiers.json` (118 spellIds / 160 modifiers, net
   −296 misclassified `reduce_cd` entries versus the pre-fix 189/456). A full-table invariant over every
   `CD_TALENT_MODIFIERS` spellId (single and stacked extremes, `cooldownSeconds >= 0`) went 61/372 failing → 0/218
   passing (exhaustive over existing data, not a sample); `265187`/`1719` both cleared. Independent review
   (`fix-29a-review.md`) of `2d5993c8` then caught a second, distinct bug: the `SPELLMOD_COOLDOWN` gate fixed
   _whether_ a modifier counted but not _whether its computed number had the right unit_ — DB2 aura 108
   (`SPELL_AURA_ADD_PCT_MODIFIER`) stores a percentage, but `genTalentModifiers.ts` ran it through the same
   flat-seconds path as aura 107, and `cooldowns.ts` then subtracted it as flat seconds too (Unbreakable Spirit is
   really −30%; against Divine Shield's base 300s that is −90s, but the pre-fix code only subtracted 30s — off by
   an order of magnitude). `547ec6f1` fixed this: added `ICDModifier.effect: reduce_cd_pct` and a new
   `cooldowns.ts` export `applyCdTalentModifiers(spellId, base, baseCharges, talentedSpellIds, pvpTalentIds)` that
   owns all modifier-application arithmetic, with flat-then-percentage stacking order matching TrinityCore's
   `Player::ApplySpellMod`/`GetSpellModValues` (`Player.cpp:22636-22860`) — sum all flat amounts first, then
   multiply that sum by all percentage factors. 9 talentSpellIds / 20 target entries affected (Unbreakable Spirit
   −30%, Righteous Protector −50%, Honed Reflexes −10%, Survival of the Fittest −12%, Ursoc's/Elune's Guidance
   −50%, etc.); the invariant test now calls `applyCdTalentModifiers` directly instead of re-deriving its own
   subtraction (`extractMajorCooldowns` and the test share one function — shared-predicate-is-the-spec), coverage
   widened from "`reduce_cd` only" to "`reduce_cd` + `reduce_cd_pct`", 221 cases green. Corpus check (local match
   library, full 1028 documents, 1511 `265187`/`1719` casts): 0 negative-value casts both before and after — the
   local corpus never happened to hit the triggering talent combination (both talents are niche), so there is no
   corpus-level before/after delta to report, recorded as-is; the real acceptance evidence is the full-table
   invariant (61→0, exhaustive not sampled) plus the TDD reproduction from real pre-fix DB2 rows (red→green) for
   both bugs. **Along the way this patch round turned up two adjacent issues it did not fully resolve at the
   time**: ① ~~`addModifier`'s dedup key `(talentSpellId, effect)` was "first-come-first-served", a
   non-deterministic order dependency, whenever two rows with different true values collided~~ ✅ Fixed
   (2026-08-15, `4bb23b99`, "talent-modifier dedup switched to TrinityCore stacking semantics — flat sum / pct
   multiply, order-dependence eliminated"): no longer guesses "which row is authoritative" and drops the other —
   two matched rows are now folded into one only when their values agree (via Path A/B/C multi-path matching, or
   the same aura's two `EffectIndex`es both hitting the same real modifier); when values differ, both are kept as
   two genuinely independent DB2 `SpellEffect` rows on that talent spell, handed to `cooldowns.ts`'s existing
   `applyCdModifiers` (the new pure-function core inside `applyCdTalentModifiers`, shared by
   `extractMajorCooldowns` and this file's own invariant test — stacking arithmetic lives in exactly one place) to
   stack per TrinityCore's `Player::GetSpellModValues`/`ApplySpellMod` (`Player.cpp:22773-22860`,
   `TrinityCore/TrinityCore@master`, verified against source this round) — multiple `SPELLMOD_FLAT` rows sum
   (`*flat += value`), multiple `SPELLMOD_PCT` rows multiply (`*pct *= 1+value/100`). TDD: synthetic fixtures (two
   flat + two pct rows on the same talentSpellId→target pair — different values keep all four, matching values
   fold to one) plus a real-collision regression fixture (all 4 instances the current corpus hits:
   `50334`/`381647`/`344359`/`1270255` against target `11`). Regenerating `talentModifiers.json` produced an empty
   diff — the collision lands on `11` (a deprecated spellId not in `trackedSpellIds`), so `filteredResults`
   filtering had already dropped it before it could reach product code either way; zero product impact, same as
   before, only the semantics changed from "guess one, drop one". `console.warn` narrowed to fire only when values
   agree but `isConditional` conflicts (a shape that should never happen) — it no longer warns on "two rows with
   genuinely different values". ② Unbreakable Spirit's official tooltip lists 4 benefiting spells (Divine
   Shield/Lay on Hands/Ardent Defender/Divine Protection); the existing table's `SpellClassMask` matching hit
   variants of the first three but missed Lay on Hands (`633`) — traced to `633` simply not being in
   `classSpells.ts`/`spellIdLists.ts`'s `trackedSpellIds` at all, a gap one layer earlier in the generation
   pipeline (spell-coverage scope), not an aura-107/108-classification issue from this round — not fixed this
   round, left for the next time `classSpells.ts`'s Paladin spell table is touched. **Re-checked 2026-09-02: closed** — `talentModifiers.json` now carries `633` with the 114154 Unbreakable Spirit −30 % row (plus 378425 / 414720), i.e. Lay on Hands entered `trackedSpellIds` through another source (`cooldowns.ts`'s list that includes 633); nothing left to do here. Corpus note: Lay on Hands is cast 17× in 605 12.1 archive files (6 casters), so the modifier matters rarely.
2. ~~**`unsyncedBurstEvents`'s `healer` fact always takes the first enemy healer, while the CC-overlap check spans
   all enemy healers**~~ ✅ Fixed (`8c4ea6f9`, Task 9 commit 1, "unsynced-burst healer fact covers all enemy
   healers — double-healer mis-attribution fix"): in `packages/analysis/src/analysis/candidateFindings.ts`, the
   `teamPlayEvents` wiring site (originally `enemies.find((e) => isHealerSpec(e.spec))?.name`) fed
   `unsyncedBurstEvents` only the first matching enemy healer, but the `ccWindows` (`enemyHealerCcWindows`) it
   consumes already covers **all** enemy healers — the `hasHardCc` gate reads "was **any** enemy healer hard-CC'd
   inside this window", so a pass (zero overlap) proves every enemy healer was free at the time, not just
   whichever one `.find()` happened to pick. Under a double-healer comp the fact's named healer could be the
   wrong one, mis-attributing blame. Fix: `unsyncedBurstEvents`'s third parameter changed from
   `healerName: string | null` to `healerNames: string[]` — the fact/`unitNames` now name every enemy healer
   (comma-joined, matching the existing `missedSyncWindowEvents`/`readyCds` convention), the wiring site's
   `.find()` became `.filter()`, and `packages/eval/src/explore/candidateCalibration.ts`'s mirror predicate
   (`RoundContext.enemyHealerName` → `enemyHealerNames`) was updated in lockstep to keep parity. New double-healer
   fixture test in `candidateFindings.test.ts`. This was the mandatory precondition (final-review
   `final-review.md` decision i) before `CANDIDATE_TYPE_FLAGS.unsyncedBurst` (Task 9 commit 2) could be flipped
   `true` — now satisfied.

## 29. Cooldown ledger "never cast this round ⇒ ready since t=0" default is wrong under cross-round CD carryover (logged 2026-08-15, surfaced by #26 Task 2 review's reason-distribution forensics)

`extractMajorCooldowns` (`packages/analysis/src/utils/cooldowns.ts`) has no way to see a cooldown state that existed
**before** the current round's own log window began — when a major CD has zero recorded casts in the round so far, the
ledger defaults to "never cast ⇒ available since round start (`readyT`/`facts.t` = 0)". This default is silently wrong
whenever the cast that actually put the ability on cooldown happened in a **previous** round of the same Solo Shuffle
lobby (or, in principle, a prior arena bleeding into the same continuous log session) — the ledger has no cross-round
memory, so it reports the ability as available the whole time even though the game itself would reject a cast.

**How this was found**: not a direct audit of the ledger — the intent guard (#26 Task 2, `castFailedInWindow`) is the
first mechanism ever cross-checking the ledger's "available" windows against the game's own authoritative
`SPELL_CAST_FAILED` signal, and that cross-check is what surfaced the disagreement. Task 2's review did reason-
distribution forensics on a 60-item cd-hoarded sample (201 rounds scanned): of the guard's hits, the single largest
reason bucket, "尚未恢复"/still-on-cooldown (38.7% of all hits), is **not** evenly spread — 73.6% (53/72) concentrated
in one spell, **Ultimate Penitence**. A follow-up 120-item scan isolated to Ultimate-Penitence "尚未恢复" candidates
found **26/26 (100%) have `readyT === 0`** — i.e. every one of these is exactly the "no cast recorded yet this round"
shape. One instance was traced against real raw.txt: match `3df6ccf8`, round 0 — the candidate claims Ultimate
Penitence was ready from `t=0`, but the log shows the owner's own `SPELL_CAST_FAILED` "尚未恢复" firing repeatedly
(5 times) starting well after `t=0`, with the eventual successful `SPELL_CAST_START` landing only at the candidate's
own `castT=126`. The ability was demonstrably **not** available at `t=0` — some prior cast (most likely in an earlier
round of the same shuffle lobby, sharing one continuous raw.txt/session) put it on cooldown, and the ledger simply
can't see across the round boundary. Tranquility shows a smaller instance of the same shape (8/12 "尚未恢复" hits in
the 60-item sample) — plausible same root cause, not traced to the same depth (time budget).

**Current mitigation is a mask, not a fix**: the intent guard already downgrades these specific candidates' severity
one tier (since the player genuinely could not press the button at those instants, whatever the true underlying
reason — downgrading is still defensible in isolation). But the candidate's own `facts.t`/`facts.lateS` values remain
wrong underneath the downgrade — the model may still be coached with "you sat on this for 126s" (just one tier
softer) when the true hoard duration attributable to the player inside this round could be much shorter, or zero.

**Fix direction** (not designed, only recording direction): `extractMajorCooldowns`'s "never cast this round ⇒ ready
since round start" default needs pre-window cooldown-carryover modeling — at minimum for Solo Shuffle rounds sharing
one raw.txt/one continuous session, where the previous round's own cast ledger (or its own raw.txt tail) is directly
available and could seed the next round's "last known cast time" instead of resetting to null. A prior arena bleeding
into the same log session (not a shuffle round boundary) is a harder case with no clean data source and may need to
stay an accepted gap.

**Numbers to start from** (60-item / 201-round sample, cd-hoarded only — see
`.superpowers/sdd/2026-08-15-raw-streams/task-2-review.md` for the full reason-distribution table): 尚未恢复 = 38.7%
of all guard downgrades; 73.6% (53/72) of that bucket is Ultimate Penitence; ~28% of _all_ cd-hoarded guard hits in
the sample are Ultimate-Penitence "尚未恢复"; 100% (26/26) of a wider 120-item Ultimate-Penitence "尚未恢复" sample
have `readyT===0`. death-unused-defensive was not independently forensically audited at this depth (its guard-hit
count is far smaller). Measure incidence rate on the full corpus before designing the fix.

**Resolved (2026-08-17) — the premise was wrong, and the fix landed on the other side of the disagreement.** User
ruling (domain expert): **Solo Shuffle resets ALL cooldowns at every round boundary** — there is no cross-round CD
carryover to model. The corpus confirms it three independent ways: (a) `3df6ccf8` round 1 shows the game accepting
an Ultimate Penitence `SPELL_CAST_START` **140s** after the round-0 `SPELL_CAST_SUCCESS` (CD 240s — impossible
unless the boundary reset it); (b) n=300 (1178 rounds) counts **4681** cross-boundary same-spell success pairs with
gap < CD across all major CDs; (c) every 尚未恢复 failure this entry originally read as "still on cooldown" sits
within GCD range of the player's own casts — e.g. this entry's own traced case: the t≈124 failures are 0.35s before
the successful `CAST_START` at t≈125, and the t≈87 spam burst is 0.76s after a Penance `SPELL_CAST_SUCCESS`. So the
ledger's "never cast this round ⇒ ready since t=0" default is **CORRECT** for shuffle rounds, `facts.t`/`facts.lateS`
were right all along, and the disagreement the intent guard surfaced was the guard **misreading GCD-spam presses as
"pressed but rejected"** — 尚未恢复 fires for the GCD, not only for a spell's own cooldown. n=300 classification of
all 478 尚未恢复 events inside cd-hoarded guard windows: **81.2% spam-then-cast** (≤2s before the same spell's own
successful cast), **15.7% gcd-locked** (≤1.5s after one of the player's own successful casts), **3.1% unexplained**
— 96.9% artifacts; **125/334 guard-hit candidates (37.4%) carried nothing but artifacts**, wrongly triggering both
the severity downgrade and the prompt legend's "never phrase this as hoarding" instruction on the single most
win-discriminative candidate type (+25.4pp). Fix: `filterIntentGuardEvidence`
(`packages/analysis/src/analysis/candidates/shared.ts`, shared by `cdHoardedEvents` and
`deathUnusedDefensiveEvents`) — pre-cast exclusion (any reason, ≤2s before a same-spell ledger cast; 2s = the
ledger's own cast-dedup radius) plus gcd-locked exclusion (尚未恢复-narrowed, ≤1.5s = the game's base GCD ceiling,
so a genuinely blocked CC press adjacent to an own cast is never swallowed; non-zh clients degrade to keeping the
evidence, the safe direction). Before/after under the same n=300 criterion: guard-hit rate **334/928 (36.0%) →
167/928 (18.0%)**; Ultimate Penitence guard hits **107 → 52**; per-type candidate counts unchanged (the guard
annotates, never gates). The old 35.6% "冤枉面" headline should be read as ~18% genuine + ~18% GCD noise. Remaining
accepted tails: the 15 unexplained 尚未恢复 events (3.1% — mostly round-end presses and one Hex case; cd-ledger-rot
material, not this bug), and a prior arena bleeding into a "match"-kind log's session (invisible to any data we
retain, unchanged from the original entry).

## 31. Per-healer name-fallback for cast-id/heal-tick-id drift is scoped, not structural (logged 2026-08-15, #26 Task 4 review M1)

`manaEfficiencyEvents` (`packages/analysis/src/analysis/candidateFindings.ts`) resolves a `healOut`/`absorbsOut`
event back to the cast that produced it via `resolveAgg`: exact `spellId` match first, then a `idByName` fallback —
matching the event's own `spellName` against the healer unit's own cast list — for the real cases where WoW logs a
spell's heal-tick under a **different** numeric spellId than its own cast (found via this task's real-match sanity
check on match `60ab1e8f`: Holy Shock casts as `20473` but its `SPELL_HEAL` events log under `25914`, identical
`spellName` on both; Prayer of Mending similarly casts as `33076` but heals as `33110`).

The fallback is deliberately scoped **per healer unit only** — built fresh from that one unit's own
`spellCastEvents` for each call, not a match-wide or cross-unit table — and the in-code comment reasons through why
a within-one-player name collision across two truly different abilities isn't a realistic risk in modern retail (a
character has exactly one castable ability per display name in their own kit at any time). Review disposition:
acceptable as shipped, not release-blocking (flag off, two regression tests pin the exact 60ab1e8f shape).

**Structural hardening not built here**: if a future consumer needs this same cast-id/heal-tick-id correspondence
match-wide or cross-unit (e.g. a match-level "which spell produced this heal" table, or extending `mana-efficiency`
to score pets/guardians whose heal events might reference the owner's cast list), the per-unit `idByName` closure
built inline in `manaEfficiencyEvents` won't generalize — it would need promoting to a proper shared predicate (own
export, own test, registered in `docs/predicate-index.md` per CLAUDE.md's shared-predicate rule) rather than being
copy-pasted into a second call site. No consumer needs this yet; revisit if/when one does.

## 32. `mana-pressure`'s OOM windows are not scoped to the reporting round — cross-round contamination in Solo Shuffle (logged 2026-08-16, surfaced by #26 Task 7's A/B batch, BLOCKING for shipping the flag) — **FIXED 2026-08-16**

`manaPressureEvents` → `oomWindows`/`castFailedInWindow`/`extendOomTailWithFailedCasts`
(`packages/analysis/src/utils/rawStreams.ts` + `packages/analysis/src/analysis/candidateFindings.ts`) walk **all**
of `RawStreams.manaSamples`/`castFailed` for the healer's unitGuid with no upper/lower bound on `tSeconds` — but
`RawStreams` is parsed from raw.txt, which for a Solo Shuffle match is **one file covering all 6 rounds** (one
continuous WoW zone-in session), not one file per round. `parseRawStreams`'s `baseMs` is the CURRENT round's own
`startTime` (mirroring how the harness/production both read raw.txt — see `packages/desktop/scripts/p1p2Ab.ts`'s
`loadItemInput` and `ipc.ts`'s `getRawStreams` handler, same convention), so a sample belonging to a **different**
round of the same shuffle still gets a `tSeconds` value (relative to the WRONG round's start) and is indistinguishable
from a same-round sample once inside `oomWindows` — there is no filter anywhere in the mana-pressure pipeline that
discards samples whose absolute time falls outside `[round.startTime, round.endTime]`.

**Effect**: a shuffle round's own mana-pressure candidate can describe an OOM window that actually happened in a
**different round** of the same lobby, with `facts.t`/`facts.toT` rendered as if they occurred inside the round being
reported — sometimes wildly out of range (e.g. `t=389` rendered into a round whose own `Duration: 0:25` — 389s is
15× the round's own length). The model faithfully narrates whatever `facts` it's given; several inspected findings
read as coherent, well-hedged coaching text with a completely wrong underlying time reference.

**How this was found**: Task 7's A/B judge spot-check on item `9f4919f8-r0` (mana-pressure treatment) flagged
"t=389s/toT=405s — impossible inside a 0:25 match" as an accuracy concern; tracing it confirmed round 0
(`startTime=1783660181712`, 26s long) but `t=389s` (`1783660181712 + 389000ms = 1783660570712`) falls squarely
inside round 2's own span (`1783660393931`–`1783660588849`) — the candidate is round 2's OOM crisis, mislabeled as
round 0's.

**Quantified on Task 7's 30-item mana-pressure eval set** (seed `p1p2-ab-manaPressure-2026-08-15`, treatment arm,
adopted+audited findings, checked by comparing each `mana-pressure:<healer>:<t>` candidate id's `t` against that
item's own round `[0, endTime-startTime]` from `match.json`, +5s slack): 19/30 items are Solo Shuffle rounds
(11/30 are single-round "match"-kind logs, structurally immune — one continuous match has no other round to leak
from). Of the 19 shuffle items, **16/19 (84.2%) have at least one contaminated candidate** (item-level rate).
**Restricted to the 19 shuffle items**, the total count of distinct adopted mana-pressure candidates is **23**
(not 37 — 37 is the adopted-candidate count across ALL 30 items, 19 shuffle + 11 single-round, the same number
that legitimately appears elsewhere as the 候选覆盖率 numerator "37/39"; using that unrelated whole-evalset count
as this stat's denominator was a fix-round-1-corrected error). Of those 23 shuffle-scoped candidates, **20/23
(87.0%) reference a time window outside the reporting round's own duration** — the true rate is _worse_ than
originally reported (54.1%), not better. This is not a rare tail-extension overrun
(`MANA_PRESSURE_TAIL_MAX_GAP_S=10s` could push a window a few seconds past round end at most) — offsets range from
**2.13× to 31.53×** the round's own length (worst case `80c8d958-r0`: round duration 19.76s, candidate `t=623s`),
consistent with a genuinely different round's data.

**Blast radius, verified against source (fix round 1)**:

- **`mana-efficiency` is structurally unaffected.** `manaEfficiencyEvents`'s signature
  (`packages/analysis/src/analysis/candidateFindings.ts:2423-2442`) takes no `RawStreams` parameter at all —
  only `healer`, `healerUnit` (round-scoped `spellCastEvents`/`healOut`/`absorbsOut` from `legacy`), and
  `matchStartMs`; its own doc comment (`:2398-2410`) explains why (`SPELL_MANA_COST_TABLE.pct` is already a
  per-cast % of max mana, no absolute mana reading — hence no raw.txt dependency — is ever needed). Confirmed
  by Task 7's own pre-flight check (`raw-streams-ab.md`): flag on, rawStreams NOT passed still produced
  `me=1`.
- **Task 2's intent guard (`castFailedInWindow` call sites in `cdHoardedEvents`,
  `candidateFindings.ts:1918-1926`, and the death-unused-defensive builder, `:3415-3431`) is NOT affected.**
  Both call sites' query windows are derived entirely from round-scoped `legacy` data — `readyT`/`endT` come
  from `cd.availableWindows` (`extractMajorCooldowns(owner, legacy)`, `legacy` already being the one round
  `pickSource` selected); `fromS`/`deathT` come from the round's own `w.casts`/death instant. `rawStreams` is
  only queried as a secondary lookup _inside_ an already round-bounded window — unlike mana-pressure, where
  the window itself is _discovered_ by scanning the unbounded stream (`oomWindows`). Since `baseMs` is always
  the current round's own `startTime`, another round's `castFailed` events land at negative `tSeconds`
  (earlier rounds) or well past `endT`/`deathT` (later rounds), landing inside the query window only if
  rounds overlap in time — verified they don't: inter-round gaps on `9f4919f8` (6 rounds) measured at
  33.3s/34.0s/33.1s/34.0s/33.8s, consistently positive, zero overlap. **Task 2's 冤枉面 number (cd-hoarded
  966/2686=36.0%, death-unused-defensive 2/34, combined 968/2720=35.6%, `task-2-report.md`) is NOT put in
  question by this bug.**

**Task 6's calibration headline numbers are very likely affected by the same contamination**, not independently
re-verified here: `packages/eval/src/explore/candidateCalibration.ts`'s scan wiring calls the exact same
`manaPressureEvents(ctx.rawStreams, teamHealer, probes, ...)` with the same unbounded `rawStreams`, and the
corpus this scan ran on (raw-streams-calibration.md, n=1028 matches/3434 rounds) is majority Solo Shuffle. Task 6's
own accuracy anchor (`60ab1e8f`) is a non-shuffle "match"-kind log, which structurally cannot exhibit this bug — so
nothing in Task 3's or Task 6's review process (both real-match sanity checks used non-shuffle anchors) was ever in
a position to catch it. The 19.3% occurrence / 0.257 场均 headline numbers, and the reason-mix breakdown (77.2%
尚未恢复 / 1.9% 法力值不足), are all downstream of this same unbounded scan and should be treated as unverified
until re-measured with round-scoping in place.

**Same root-cause family as #29** (cooldown ledger's cross-round-carryover blind spot): Solo Shuffle rounds share
one continuous raw.txt/session, and a builder that has no explicit round-boundary parameter silently assumes the
data it's handed belongs to the round it's being asked about. #29 is one direction of this (missing history before
the round); this is the other (leaking data from other rounds, before AND after, into the round).

**Fix direction** (not designed, only recording direction): `manaPressureEvents` (or its callers) needs the
reporting round's own `[startTime, endTime]` (already available to every call site — `buildRoundContext`/`buildInput`
both have the round's `legacy.startTime`/duration on hand) threaded through to `oomWindows`/`castFailedInWindow`/
`extendOomTailWithFailedCasts`, filtering `manaSamples`/`castFailed` to that window (with perhaps a small slack for
the tail-extension itself, capped well inside `MANA_PRESSURE_TAIL_MAX_GAP_S`) before scanning. Needs re-running
Task 6's full-corpus calibration afterward — the headline numbers will very likely move.

**Recommendation for #26 Task 8 (裁决收尾)**: do not flip `CANDIDATE_TYPE_FLAGS.manaPressure` to `true` until this is
fixed — the flag's A/B numbers (adoption rate, audit pass rate) measure how the model handles whatever facts it's
given, not whether those facts are true; on this evidence, more than half of what it would be given for Solo Shuffle
rounds (the majority log type) is mislabeled. `manaEfficiency` is structurally unaffected — `manaEfficiencyEvents`
never consumes `RawStreams` at all (see its own doc comment), reading only `legacy`'s already-per-round
`spellCastEvents`/`healOut`/`absorbsOut`, so this bug class does not apply to it.

**Fixed (2026-08-16, task-7b)**: `parseRawStreams(rawText, baseMs, roundDurationS?)`
(`packages/analysis/src/utils/rawStreams.ts`) grew an optional third parameter — when passed, every
`manaSamples`/`castFailed` entry whose `tSeconds` falls outside `[0, roundDurationS]` is excluded at parse time
(zero grace — empirically justified: 300/300 sampled non-shuffle "match"-kind rounds, whose raw.txt genuinely is
the whole round, show ZERO events outside that range even unclamped, see the function's own doc comment). Threaded
through every ROUND-scoped call site: production IPC (`ipc.ts`'s `getRawStreams` handler + `rawStreamsCache.ts`
deriving `roundDurationS` from `legacy.endTime - legacy.startTime`), `matchExplore.ts`'s `mana`/`drink` subcommands,
`candidateCalibration.ts`'s full-corpus scan (`manaCalibrationScan.ts`, 3 call sites), and the P1/P2 A/B harness
(`p1p2Ab.ts`). No caller in this codebase currently omits it (`constraintBudgetAudit.ts` doesn't pass `rawStreams`
at all, so it never reaches `parseRawStreams`) — the parameter stays optional only for forward-compat with a
future whole-match tool that genuinely has no single round in scope. gladlog commit `9afc6ef7`.

**Contamination, before → after**: re-ran the contamination detector (candidate regeneration at production
defaults, `t`/`toT` vs `[0, roundDurationS]` +5s slack) on the Task 7's persisted 19 shuffle items — all-menu
candidates 22/25 (88.0%) → **0/3** out-of-round; adopted (audited) candidates independently reproduced the
reviewed 20/23 (87.0%) pre-fix number → **0/3** out-of-round post-fix regeneration on the same 19 items. A
brand-new, independently-selected 30-item mana-pressure A/B set generated entirely under the fixed code also
checked clean: **0/32** adopted candidates out-of-round.

**Full-corpus calibration re-measured** (same 1028-match/3434-round library, same final constants — no anchor
broke, so per the fix brief's own guard, constants were NOT re-tuned): per-round occurrence 19.3% → **6.1%**,
场均条数(capped)0.257 → **0.070** (-72.8% relative), raw 0.280 → **0.074**. Both hard anchors still pass:
`60ab1e8f` still fires with byte-identical facts (`t=475,toT=507,durationS=32,mana=545/273000,rejectedCount=67,
threat=yes` — non-shuffle, structurally unaffected); `0b89beee` control still 0. Sensitivity grid (200-match
subsample re-swept, since the headline shift exceeds the brief's 20%-relative recheck trigger) kept the same
shape/direction (LOW_PCT=15%/MIN_WINDOW_S=5s still the widest grid corner, MIN_FAILED still flat/non-binding).
Notable side-finding: threat-active share among fired candidates flipped from 26.3% to **99.2%** — most of the
purged phantom candidates were spliced cross-round mana declines with no real corresponding threat instant;
the genuine in-round crises that remain are overwhelmingly threat-correlated. Full numbers, the 60-call A/B
re-run (fresh 30/30 selection, sonnet responder) and the deterministic-metric comparison table are in
`raw-streams-calibration.md` and `raw-streams-ab.md` (gladlog-eval-private), both updated with dated
post-#32 sections. `mana-efficiency` was not re-measured (structurally never consumed `RawStreams`, confirmed
unaffected both times).

## 33. Mana attribution conditioned on healing-deficit avoidability (successor to #26's two unshipped candidates)

The meaningful signal per BACKLOG #26's user closeout criteria is **causal attribution of mana expenditure**, distinguishing spent-because-enemy-burst-forced vs. unforced-waste. Candidate types will be built from existing pipeline ingredients:

1. **(a) Whole-match healing mana allocation audit** (efficiency conditioned on pressure windows): expensive spells cast during enemy burst windows are CORRECT play, only unforced-window inefficiency counts as a mistake. Ingredients: `rawStreams` mana curves (all units from Task 1), `threatActiveAt`/`pressureWindows` predicates (team play analysis), opponent healer mana comparison (rawStreams covers both sides).

2. **(b) Per-window mana spend causality** ("a minute ago you dumped too much mana BECAUSE your team failed to avoid XX damage, or the healing deficit wasn't reduced via CC or pre-mitigation/immunity"): links mana-spend windows to damage-intake causes. Ingredients: `rawStreams` mana curves, `threatActiveAt`/`pressureWindows` predicates, **mitigation counterfactual** infrastructure (BACKLOG #17a/b, `computeMitigationAudit` / `computeMissedExternalCounterfactuals` / `computeUnusedSelfCounterfactuals`), **outgoing-CC-chain analysis** (spell rotation + cooldown ledger + `ccWindows` gate), **missed pre-mitigation** (existing predictors, upgradeable with counterfactual per-school attribution), **drinkingSegments** (enemy healer drink interruption windows from deep-dive subcommand).

**Architecture direction (user-ruled 2026-08-16, same-day refinement)**: the attribution engine is **deterministic fixed logic producing conclusion sentences** (divergence point of both healers' mana curves, forced-vs-unforced spend decomposition per pressure window, drink-opportunity ledger, efficiency measured on unforced windows only) — NOT a fact pack fed to the LLM. Rationale: exposing raw facts to the model invites noisy/false attribution (the "rich context bypasses candidate gates" failure class); the LLM only performs multi-angle attribution/back-inference at explicit deep-dive escalation (existing multi-round infra). **Exposure ruling: add NOTHING now — no UI, no candidate, no prompt lines — until the attribution engine exists and is validated; the exposure surface gets decided then.**

**Status**: Logged, NOT started — needs its own spec cycle with user before implementation begins. No flag, no branch, full test coverage deferred.

**Rationale**: #26's unshipped candidates revealed a structural limitation: mana-as-a-resource coaching cannot be evaluated in isolation from game context — "spent too much" only becomes actionable when paired with "you didn't have to because team could have CC'd / pre-mitigated / drunk earlier" or vice versa. The raw numbers themselves are correct; the narrative is incomplete without causal framing.

## 34. 教练信号正确性:技能梯度实验留下的未决(logged 2026-08-23,来自 12.1 首周 10,301 场 / 23,056 回合归档实验)

背景与全部数字:`$GLADLOG_EVAL_HOME/reports/signal-skill-gradient-2026-08-22/`
(README + round2-findings 五轮 + 三版逐桶表 + 逐回合数据)。方法:用**分段**做外部真相
(回合事件造不出来,不像胜负那条循环轴),逐信号算 `转化率 = 触发 ÷ 有机会`,
**必须按 bracket 分层**(池化会凭空造出 −9.6pp 的假效应,已固化进 `aggregateGradient` 与单测)。

已落地不在此列:`cc-avoidable` 可反应性门(`9a2ae2d8`,−68%,梯度 +12.3→+2.7)、
`unsynced-burst` 可行性门(`3ad24bbb`,−9.5%)、两条坏分母修正(`4c5a66f4`)。

### (a) 四条"高触发 + 无正向证据"的类型待裁定(GH #14 治理规矩)

数字均为单排轮换切片、修正分母后(n=15,306 回合):

| 类型             | 触发率                             | 梯度                  | 已知机制                                                                                        |
| ---------------- | ---------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `missed-purge`   | **63–79%**(有高价值可偷增益的回合) | +4.0,非单调(峰在中段) | 未知。代码里已有完整可行性门(purgeWasOnCD/purgersLockedOut/losReachable),所以**不是**可行性问题 |
| `unsynced-burst` | 62–66%(每个进攻冷却)               | +0.1                  | 已知:被指控队伍**整轮从未控过敌方治疗的占 0%**,平均只差 13–18s。可行性门只解释 9.5%             |
| `death-setup`    | 62–70%(每次友方死亡)               | +7.6                  | 以死亡为前提 ⇒ 判别力循环(candidateDiagnostics 自述),**要处置得重定义类型本身**                 |
| `cc-held`        | 14–21%                             | +6.9                  | 仍无诚实分母(需要"值得交控的进攻窗口"口径)                                                      |

每条的可选处置一致:(1) 维持;(2) 降级为上下文事实(留时间线供模型推理,撤掉指控 ——
v0.1.27 八信号的同款处置);(3) 收窄到能给出机制的子集。
**需要用户逐条拍板**,不宜凭聚合数字批量降级 —— `cc-avoidable` 的教训正是
"看着像对手能动性,实际是要求先知,正确处置是收窄"。

### (b) 把"可行性门"变成新候选的固定审查项

五个类型验下来的结论:纪律本来就存在(驱散家族 #20 三层做得很完整),
**是 2026-08 新上的类型没做**。建议在候选类型上线清单里加一条硬性问题:
"这条指控要求玩家做的事,在那个时刻**做得到吗**?(资源就绪 / 可反应 / 够得着)"
—— 三条通过(kick-eaten 读条可骗、attempt-into-trinket 95% 可达、missed-purge 已有门)、
两条不通过(已修)的记录见报告第四轮。

#### (b2) 第四条检查:「手上是不是已经有活了」(logged 2026-08-23,视频↔日志交叉验证)

上面三条问的都是**别人对你做了什么**(资源被打空 / 被控住 / 够不着)。
漏掉的第四条是**你自己把自己占住了**:窗口内玩家在读一条硬读条。

`buildCannotCastIntervals`(`dispelAnalysis.ts:794`)只建两类区间 —— 敌方施加的
封锁类光环(`isCastBlockingAuraType`)+ 打断锁(`kickLockoutSeconds`)。
`dispellersLockedOutForWindow` 的 `freeMs` 拿它算,所以**自身读条占用完全不在其中**,
自由时间被系统性高估。缺口是读代码确认的,不依赖统计。

**量化(288 场视频配对语料 / 1216 条 missed-cleanse+missed-purge 指控):**
≤10s 真·反应窗口里,玩家空闲不足 1 个 GCD 的指控占 **1.0%–7.5%**(夹逼,非点值);
≤5s 窗口里「窗口开启前就押上读条」的占 **4.3%–8.0%**。
→ **建议不做闸**:影响面小,而判据要把"自身占用"和"被 CC"分开又容易和现有闸缠上。

**比闸更值钱的是话术。** 手工核到底的单例(`4c058bf6` 轮 3,Critical missed-cleanse,
Freezing Trap 6.0s,`postCcDamage=0`):现有四道闸**全部正确通过**,画面也证实
陷阱**全程显示在队友框上**(6 格采样 5 格与倒计时精确吻合)。真实情况是他在这 6 秒里
起手两次精神控制(4.04s,**0 秒是窗口前押上的**),最后成功控住敌方战士。
不是看不见,不是做不到 —— **是选了别的**。而指控写的是「你漏了驱散」。
「你漏了 X」和「这 6 秒你选了 Y」描述的不是同一件事,后者才是可教的。
→ **待用户裁定**:窗口内才起手的读条算不算豁免(我倾向不算,改话术而非出闸)。

**顺带露出的另一件事(与本条无关,归 `getPriority`):**
`missed-cleanse` 里 `postCcDamage=0` 的占 **22.5%(40/178)**;
`priority=Critical` 的 83 条里后果为零的占 **26.5%**。
priority 是按可驱散性+阵容算的**先验**,不是**实际后果**。

**方法(可复用):** 视频↔日志对齐已跑通。YouTube 标题即 OBS 时间戳(秒级),
用画面上的 CC 横幅倒计时精调到 ±0.05s;实测标题给的偏移 1.356s、画面校准 2.21s,
0.85s 的差完全由标题秒级截断解释。288/1095 场本机对局有配对视频。
细节见 `~/.claude/skills/wow-frame-read`。
**结论:视频是发现工具,不是数据源** —— 这一轮里视频没提供任何日志没有的数据,
它的作用是提供了一个能逐秒核对的现场,让聚合数字里看不见的错误暴露出来。
本条统计判据被自我推翻三次(恒等式 / 单例回查 / 手工案例前后对比各抓一次),
没有一次是 code review 抓到的。

**裁定与落地(2026-08-23,用户拍板;实现见 commit 3931ee8c):**

- **① 窗口内起手不豁免、改话术 —— 已落地。** 新导出 `hardCastOccupancyWithin`
  (`dispelAnalysis.ts`,与 `buildCannotCastIntervals` 互斥:读条区间在
  cannot-cast 区间起点截断,CC 时间归旧判据不重复计;② 日后若成闸必须消费
  同一导出)+ missed-cleanse facts 三键
  `ownerCastingS / ownerCastingSpells / ownerCastingPreCommitted`。
  三态:`castStartEvents` 缺失(老归档)或渲染值 0.0(瞬发不产生 CAST_START)
  时三键整体不出现,绝不渲染成「空闲」。
  验收(288 场配对语料):候选数 178/1038 前后一致(零门变);178 条
  missed-cleanse 里 91 条(51%)带上三键,preCommitted yes 32 / no 59;
  手工逐事件核过的 4c058bf6 渲染 `ownerCastingS:"2.8" · 精神控制×2 ·
preCommitted:no`,与手工重建 2.81s 一致 —— 产品谓词的 CC 截断比探针
  v2/v3(6.00/4.04)都准。**missed-purge 未接线**:其窗口是增益全时长
  (中位 10s / 最长 169s),先要口径裁定。
- **③ 后果为零的 Critical → 用户同意单独立项**,见 #39(#38 已被并行会话占号,让号)。
- **②(熔断闸)用户拍板 2026-08-23:不做。** 依据:v4 下界全库仅 6 条触发,
  其中 5 条是「窗口内才起手」—— 按 ① 裁定恰不该删;唯一「真来不及」成分的
  1 条已由 `ownerCastingPreCommitted:"yes"` 事实呈现给教练。判据自身在本轮
  被推翻三次,错闸吃掉的指控与不存在的指控不可区分(白名单腐烂同形状)。
  **④(阈值复用)随 ② 作废。** 本条四问全部闭环。

### (c) 度量口径的已知缺口

- `cd-waste` 的 per-unit 分子受各构建器 `*_CAP` 截断,现值是强度**下界**
  (每 100 个拥有的冷却里 5–8 个被判浪费);要绝对占比需另跑不截断口径。
- `cc-held` / `position-mistake` / `death` 三条仍挂 `rounds ⚠`(`death` 是时间线标记不是指控,
  永远不该按指控解读)。
- 语料偏差:上传者都装了 wowarenalogs 插件,不是随机玩家样本;2400+ 仅 699 回合;
  一周语料(12.1 首周),赛季早期生态未必稳定。

### (d) 运维:归档定时任务仍未装载

`archivePvpLogs.ts` 的 launchd 计划任务阻塞在**用户自建 rclone client_id**
(内置共享 id 2026 年退役,见 `docs/pvp-log-archive.md`)。装载前每次攒语料都要手动跑一次;
feed 只保留 ~7 天,漏跑就永久少一天。

**Status**: 全部 logged,未开工。(a) 需用户逐条裁定后才动代码;(b) 是流程改动;
(c) 是量化口径的自陈缺口;(d) 需用户操作。

---

## 35. `context/criticalMoments.ts` 的 6 个函数:零消费者但用户裁定保留,待想清楚怎么用(logged 2026-08-23)

2026-08-16 的外部管线审查把这个模块(820 行)判为死码建议整体删除;GH #30 C4 的逐符号
复核证实**函数侧确实零非测试消费者**,但用户 2026-08-23 裁定 **先留着,挂帐看之后怎么用**。
所以这条不是"待删除",是"**待接线**" —— 记在这里是为了下一次审计不要再把它当死码提一遍,
以及提醒任何人:**删它之前先看这条**。

### 里面各是什么(逐函数)

| 导出                       | 行数 | 功能                                                                                    | 消费者                                                                                           |
| -------------------------- | ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DEATH_CC_LOOKBACK_S = 12` | 2    | 死亡回溯窗口,"死前 12 秒内被控"的共享判据                                               | **活的** —— `analysis/candidates/death.ts` 的 healer-locked 判据在用。**删模块前必须先把它搬走** |
| `identifyCriticalMoments`  | 375  | 主入口:死亡 / 治疗真空 / 恐慌交防御 / 防御重叠 / 被控扫一遍,挑出"关键时刻"列表          | 零(测试除外)                                                                                     |
| `buildKillMomentFields`    | 153  | 一次击杀的四段结构:机械可用性 → 解读 → 分档选项 → 最终判断                              | 零                                                                                               |
| `buildDeathRootCauseTrace` | 144  | 死因回溯:死时哪些 CD 在转、最后一次是不是恐慌交的、哪些一直没按、死前是否被控且是否可避 | 零                                                                                               |
| `getEnemyStateAtTime`      | 40   | "这一刻对面在干嘛" —— 找覆盖该时刻的爆发窗口,没有就报持续压力峰值                       | 零                                                                                               |
| `getOwnerCDsAvailable`     | 38   | "这一刻你手里有什么" —— 可用 / 转 CD 两列                                               | 零                                                                                               |
| `findContributingDeath`    | 11   | 该时刻之后 N 秒内有没有人死(把时刻和死亡关联起来)                                       | 零                                                                                               |

### 怎么用,是这条挂帐要回答的

功能上最有价值的两个是 `buildDeathRootCauseTrace`(死因回溯)和 `buildKillMomentFields`
(击杀四段结构),它们和**现在活着的** `deathRecap` / `killAttempts` 讲的是同一类事,
但是另一套实现。所以接线之前先要回答:

1. **和现有活代码是替代关系还是补充关系?** 同一个事实两套实现正是 CLAUDE.md 共享谓词
   规则的头号故障形状 —— 直接接线会立刻造出一处重复谓词,必须先定谁是单源。
2. **产物给谁看?** 进 prompt(模型)还是进 desktop 报告(人)?两者对"分档选项 /
   最终判断"这种带主观判断的结构要求完全不同。
3. **价值门**:按 CLAUDE.md 的价值门规则,接线前先拿**一场真实对局**产出完整输出例子给
   用户看,通过了再谈工程。这个模块的四段结构(尤其"最终判断")正是那种
   "写反了就是一堆看着很像分析的废话"的形状。

**Status**: logged,不动代码。模块保持原样,`DEATH_CC_LOOKBACK_S` 继续被 `death.ts` 消费。

---

## 36. 原始日志里还没被消费的信息(logged 2026-08-23,来自 12.1 治疗打法语料研究 + 7 份赛季攻略视频文字稿)

背景与全部数字:`$GLADLOG_EVAL_HOME/healer-study/`(README + `gap_probe.py` + `school_probe.py`

- `vids/`)。方法两条,都不是"盯着聚合数字看"能得到的:

1. **逐行读真实 log**。把一轮渲染成治疗视角的可读时间线(`render.py`)一条条读。
   本轮三个提取 bug 全是这么读出来的(时区偏移无分隔符 / 无目标施法的 `nil` 被正则丢掉 /
   单排每轮换队),其中"无目标施法被丢"让**图腾、宁静、光环掌握、复仇之怒等几乎所有大 CD
   整类不可见**,修正后 2100+ 每分钟施法:织雾 18.2→33.7、恢复萨满 20.7→32.9、
   恢复德鲁伊 26.4→34.8、神圣牧师 22.9→29.4、戒律 23.8→29.1、神圣骑士 25.6→29.6。
2. **玩家的口头讲解当作提取器的校准源**。见 (g)。

### (a) 「一次按键 ≠ 一条 `SPELL_CAST_SUCCESS`」—— 三种形态,污染所有按键率消费者

这是**正确性问题**,不是新能力。任何按 spellId 数施法次数的消费者都受影响
(`extractRotations`、corpus-tools 的 reference_vectors、`cd-waste` 的分母、任何未来的手法基线)。

| 形态                 | 判据                                       | 实例                                                                                                                          |
| -------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 回响复制 / 套装触发  | 独立出现率 ≈0%(前后 0.3s 内必有另一次施法) | 奶龙 `360995 青翠之拥` 86% 与 `361195` 同刻;`1265980 孪生烈焰` **100% 与裂解同刻**                                            |
| **引导跳动**         | 同轮内相邻两次间隔 **≤1.05s**              | `64844 神圣赞美诗` 间隔 1.00s、每轮 5–6 跳,虚高 **5 倍**(18,504 → 3,583 次真施法);`157982 宁静` 0.80s;`450215 虚空冲击` 1.00s |
| **同一次按键记两条** | 间隔 0.00s                                 | `10060 能量灌注` 给队友时同刻记"给队友"+"给自己"(n=90,269)                                                                    |

⚠️ 引导跳动的阈值**不能放到 1.4s**:`愤怒`/`恳求` 这类真填充技能的相邻间隔就是 1.4s。
⚠️ 独立出现率**不能单独当判据**:`治疗链` 0.8%、`神圣赞美诗` 0.0% 也很低,但它们是真按键
(总有别的东西同刻触发)。必须结合"伴随对象是否单一"+ 人工确认。
研究侧已登记在 `healer-study/copy_ids.json` 并在 `seq.load()` 里剔除 + 按 `(t, spellId)` 去重;
**产品侧未处理**。与 #31 相邻但不同:#31 是"治疗跳动 id → 施法 id"的反查,这条是"施法计数本身虚高"。

### (b) 被打断之后:瘫痪还是换学派 —— `kick-eaten` 缺的严重度谓词

`kickEatenEvents` 的代码注释自己挂着这个问题:"840 条锁定时长全部落在 3–4s
(现代 WoW 学派锁定固定),按 `lockoutDurationSeconds` 排序等效稳定序……
若将来要挑「代价最高的被断」,需要新的排序谓词"。

**这就是那个谓词**:被踢之后 5 秒内**有没有用另一个学派继续打**。
数据现成 —— `SPELL_INTERRUPT` 的 **index 11 = 被打断的法术 id,index 13 = 被锁的学派掩码**
(不用查 `spellSchoolsGenerated.json`)。实测(500 场,新赛季):

| 专精       | 被踢后 5s 内换学派 | 整整 5s 没动作 |
| ---------- | ------------------ | -------------- |
| 戒律牧师   | 76–80%             | 6–10%          |
| 生命缚誓者 | 76–84%             | 6–7%           |
| 恢复德鲁伊 | 51–57%             | 2–9%           |
| 神圣牧师   | 36–38%             | 21–22%         |
| 恢复萨满   | 16–24%             | 18–32%         |
| 神圣骑士   | **8%**             | **36%**        |

这个排序和各专精的能力上限吻合(戒律 12.1 把闪现治疗永久升级成暗影愈合 = 两个学派;
萨满单学派 + 风剪 30s CD)。所以它是**能力上限 × 技术水平**的混合量,
拆开才是判据:同专精内部比,"没动作率"才是可教的那一半。
⚠️ 恢复德鲁伊的"换学派"里有相当比例是 `熊形态/猎豹形态`,是不是真的在打输出/治疗要另判。

### (c) 三个事件类型只出现在 `parser-compat/src/enums.ts`,零消费者

实测量级来自 `gap_probe.py`(300 场 / 610 回合):

- **`SPELL_MISSED`**:`IMMUNE` **35,006** 次、`ABSORB` 174,209、`REFLECT` 1,521、`DODGE` 1,423。
  "控制打进免疫 / 打进 DR 免疫"这类**白给的控**现在一次都抓不到 —— 奶龙那份视频里作者
  自己演示了一次(DR 计时器显示 0,梦游打出 immune)。
- **`DAMAGE_SPLIT`**:每回合 **199 次**。牺牲祝福这类把伤害转到自己身上,
  承压**两侧都算错**(施放者少算、被保护者多算)。叠加已知的吸收漏算
  (只读 `SPELL_DAMAGE` 会漏掉戒律 39.0% / 神圣骑士 32.6% / 织雾 22.9% 的入伤),
  "谁在被集火"这个判据目前有两个系统性偏差。
- **`SPELL_ENERGIZE`**:资源**获得**事件(精华爆发、圣能、怒气)。
  注意与 #26 的区别:#26 落地的 `rawStreams.manaSamples` 读的是 advanced 参数里的
  **存量快照**,读不到"这一下回了多少 / 触发了什么"。奶龙那份视频整套 build 的核心
  (内在魔法换精华回复 → 撑起裂解)就活在这个流里。

### (d) 两个事件类型连 enum 都没有

- **`SPELL_EMPOWER_START` / `SPELL_EMPOWER_END`**:`SPELL_EMPOWER_END` 的**最后一个字段就是充能等级**。
  实测梦境吐息 1 级 319 次 vs 3 级 34 次、火焰吐息 1 级 226 vs 3 级 41。
  奶龙/风暴召唤者的**整类机制**(充能到几级放)现在完全不可见,
  视频里的"full charge fire breath 再 tip the scales 补一发"是可测的。
- **`SPELL_HEAL_ABSORBED`**:每回合 **145 次**,300 场合计 1.75 亿治疗量被吸收。
  HPS 口径完全没有这一层(面对吸盾类减疗的治疗会被系统性低估或高估)。

### (e) 「谁把控打断了」没有做归因

`SPELL_AURA_BROKEN_SPELL` 产品是读的(4 个 analysis 文件),但**只用来正确闭合控制区间**
(2026-08-02 修的那个"broken 的 src 是打断者,不能按 src 过滤"就是这条)。
每回合 **12.8 次**,谁把谁的控打断了没有被归因。
⚠️ 实现难点:**打断者的 GUID 不在事件里**,只有打断用的法术 id,要靠同刻伤害事件反推。
**更正(2026-08-25,实测)**:上面这句难点是错的 —— `SPELL_AURA_BROKEN_SPELL`
的 **src 就是打断者**(真实行核过,`ccBreakAnalysis.ts` 头注释也一直这么写,
它自 2026-08-02 起就有完整的谁破谁归因 + squander 象限)。真正缺的只是
**prompt 消费者**(desktop 仪表盘 2026-08-21 起在消费,prompt 从没见过)。

### (f) 结构性:25 类候选没有一条量的是"打法本身"

`candidateFindings` 的 25 个类型全是同一个形状 —— **单场内某个瞬间做错了什么**。
没有一条量的是:这个配装偏了 / 这个按键频率偏了 / 你每场都这样。
语料侧已经证明这三维都有分数梯度(`healer-study/part3.txt`):
天赋二选一节点的选择随分数单调变化(恢复德鲁伊「化身:生命之树」80%→96%、
奶龙「时间螺旋」61%→93%);按键频率随分数上升的**几乎全是工具键**
(恢复萨满「净化灵魂」0.34→0.79 次/分、织雾「清创生血」0.35→0.74);
ICC 显示 HPS/溢出/施法密度/DPS 是稳定的个人属性(0.73–0.85),跨场累计成立,
而驱散/分只有 0.41 —— 必须先按机会归一化。
`extractRotations`(opener / 三连 / crisis)**已经在仓库里,但产品教练链路零引用**,
只被 corpus-tools 的 reference_vectors 消费。

### (g) 方法项:玩家讲解当作提取器的校准源

(a) 里那三种形态,我用统计判据试了三轮都分不开。真正点破的是第一名奶龙视频里的一句
"consuming essence burst sends forth a living flame at 50% effectiveness.
And then twin flame also goes as well." —— 直接解释了 `1265980` 为什么 100% 与裂解同刻。
7 份 12.1 赛季攻略的文字稿存在 `healer-study/vids/`(取字幕的命令见 `vids/SOURCES.md`),
拆成断言后语料验证的结果分三类:**确认**(戒律 真言术:耀→福音 97.6%、
萨满 迅捷→治疗波 88–90%、神牧 守护之魂→圣言术:静 55.2%)、
**否定**(神牧"进赞美诗前先给队友能量灌注"实际只有 14.0%、
萨满"生命释放垫大治疗波"只有 36.7%)、**揭示提取缺口**(本条其余各项)。
建议:每个赛季初把主流攻略的文字稿过一遍,当成提取器的回归测试集。
⚠️ 拉视频前**必须核对 `upload_date`** —— 搜索结果里混着旧赛季同名标题
(本轮有一份看着完全对口,实际是 2024 年 TWW 的,已剔除)。

### (h) 「按下那一刻,目标/敌人是什么状态」—— 原语有了,没有消费者

三条攻略断言都卡在同一个能力上,合并成一项:

| 断言                                                           | 出处                | 要什么                                               |
| -------------------------------------------------------------- | ------------------- | ---------------------------------------------------- |
| 治疗波/治疗链要打在**带激流**的目标上(该天赋加 15%)            | 恢复萨满 Lontar     | 施法瞬间**目标身上**的光环                           |
| 接地图腾要在敌人**读条中**按下,不是读完之后                    | 恢复萨满 Lontar     | 敌方 `SPELL_CAST_START` ↔ `SUCCESS` 配对出的读条窗口 |
| 迅捷治愈按消耗顺序吃 回春术→野性成长→愈合,**别让回春术被吃掉** | 恢复德鲁伊 MMARKERS | 施法瞬间目标身上的 HoT 集合 + `AURA_REMOVED` 归因    |

`aurasActiveAt`(`momentSnapshot.ts`,见 #27)已经是"某一刻某单位身上有什么"的原语,
`SPELL_CAST_START` 也在解析层。缺的是**消费者**:没有任何判据问过
"你按这一下的时候,目标身上该有的东西在不在 / 敌人正在读的是什么"。
这一维一旦有了,上面三条 + 视频里同类的一大批"前置条件"型技术动作都能量化。

### 什么**不**在这条里(已被覆盖 / 我先前说错的)

- **法力值 + `SPELL_CAST_FAILED`** 属于 #26,已落地 `rawStreams.ts`。本条只补 (c) 里
  `SPELL_ENERGIZE`(获得事件)与存量快照的区别。
- **施法 id ≠ 治疗跳动 id** 的反查属于 #31。
- **控制时长**产品**是**算的(`ICCInstance.durationSeconds`,由 apply/remove 配对得出),
  `lockoutDurationSeconds` 也有 —— 我在会话中一度说"只知道被控了不知道锁多久",**是错的**,
  在此更正。(b) 要的不是时长,是**锁定期内的行为**。
- **被踢本身**已有 `kick-eaten` 候选;(b) 补的是它自己挂着的严重度谓词。

**Status(2026-08-25 更新,后续批处置)**:

- **(a) 已落地**:`utils/castPress.ts`(`COPY_CAST_IDS` 8 条移植自研究注册表并进
  curatedIdRegistry + 同刻去重 + ≤1.05s 引导跳动折叠;阈值纪律原样保留)。
  接线三处:`extractRotations`(→ 语料 reference_vectors)、冷却台账
  (复制体会伪造 CD 使用、污染充能可用性)、prompt 施法行。
  3,300 回合验收:**神圣赞美诗 6,288 → 1,223(5.1×),精确命中研究锚**;
  Devourer DH 移除 41.1%、生存猎 0.0%(两端 sanity)。奶龙移除 18.5%,低于研究
  「近 2 倍」—— 那是 2100+/套装盛行样本的数字,全分段混合下偏低是诚实差异,
  不硬凑。顺带解释了 #40 双行修复后的残余:回春术类是**同显示秒两次真实按键**
  (高急速 GCD≈1s;774 单 id、40 文件零同刻对),不是重复记录。
  **2026-09-02 复核形态 3 在冷却台账的影响**:台账只滤复制 id、不折叠同刻双记。S2 605 场
  995,281 条 SPELL_CAST_SUCCESS 里同刻双记只落在 34 个 id 上,几乎全是宠物/触发技能
  (Zap 1,874 对、Soul Fragment 1,720、Stomp 1,007、Throw Glaive 890/658、Dire Beast 529……);
  跟踪的大 CD 里只有能量灌注 10060(99 对,单充能,同刻两条对 cdAvailableAt 的"最近一次施放"
  无影响),没有任何多充能大 CD 出现同刻双记 —— 台账不需要再加折叠,记录不改码。
- **(b) 已落地**:`postKick` 谓词(switched/acted/idle,窗口 5s=研究判据)进
  `IInterruptInstance`,`kick-eaten` 改按 idle 最前排序 + facts 带行为。
  3,300 回合 / 3,494 次被踢验收:**排序完整复现研究锚**(戒律 86%/奶龙 87%
  换学派居顶,神骑 16%/28% 无动作垫底)。
- **(c)(d) 已由 #40 关闭**(五类事件读进解析层 + [MANA]/[IMMUNE]/[EMPOWER] 接线)。
- **(e) 已落地**(注意上方更正):`analyzeCcBreaks(...).friendlySquander` 接进
  prompt 为 `[CC BROKEN]` 行(≥2s 剩余预滤)。真实例:
  `2:08 [CC BROKEN] 1(RShaman)'s Flame Shock broke own team's Intimidating
Shout on 5(RDruid) — 3.7s of CC wasted`。
- **(f) 部分推进**:rotations 进 cell 见 #37 的 2026-08-25 记录。
- **(g)** 流程项,保持(每赛季初攻略文字稿过一遍当回归集)。
- **(h) 未动**(原语在、消费者仍缺 —— 三条断言型判据待立项)。
- 模型行为层 smoke:**已跑通,3/3**。DeepSeek 用户拍板弃用(2026-08-25,
  余额单点);改走 `cliDriver`(agy 当日配额也被探针批打空 → BACKEND=claude)。
  模型对 `[CC BROKEN]` 的消费超预期:专门成节、与击杀窗口交叉引用、给出
  「别在即将被软控的目标身上留 DoT」的可执行建议,并识别为团队习惯但先归因
  自己可控部分。脚本 `packages/eval/scripts/smokeTags.ts`(BACKEND 可切)。
- 另三个标签的 smoke(2026-08-25,claude 后端,9 个真实 prompt,dumper =
  `packages/eval/scripts/tagPromptDump.ts`,103 回合内 3×3 集齐):
  - **[MANA] 2/3 有效消费**("mana was fine (57% at end)" / "Innervate at 1:22
    at 72%, no dry spells" —— 直接引用行内事实);第 3 例 owner 是战士、
    [MANA] 行属于队友牧师,不提反而正确。教训:dumper 选 owner 只按
    「prompt 含标签」太宽,mana 例应限定 owner 为治疗。
  - **[IMMUNE] 5/5 消费**,最好一例把 "Sleep Walk landed for 0s (Immune DR)"
    织进了击杀窗口复盘。
  - **[CC BROKEN] 逢在必提**(含 "your Fire Breath broke your own rogue's
    Gouge — 2.6s of CC wasted" 级别的具体归因)。
  - **[EMPOWER L?] 级别标注 0/3 被提及** —— 但施法行本身被充分消费(围绕
    Fire Breath 驱散时机成节)。样本全是 L1、无对比对象,级别标注价值
    **未证实**(非误导,中性负结果);要证实需要 L1 vs L3 混用的对局或
    消融探针,暂不扩工。
  - **跨模型交叉(2026-08-25,agy `gpt-oss-120b-medium`,同 12 prompt;
    用户指示用 agy 的 GPT 池 —— 配额按模型分,默认模型耗尽时 GPT 可用,
    `smokeTags.ts` 为此加了 MODEL 环境变量透传)**:
    [MANA] 3/3、[IMMUNE] 4/5、**[EMPOWER] 0/3 —— 与 claude 完全一致**,
    级别标注的中性负结果被第二个模型家族独立复证;[CC BROKEN] 5/10,
    明显弱于 claude 的逢在必提(GPT 是较弱的消费者)。质量注记:GPT 回答
    有域内幻觉(发明「Psychic Shroud」、驱散机制错),这条线只用作
    **消费判定**的交叉验证,不作建议质量参照。原始输出:scratchpad
    `smoke_agy_gpt.txt` / `smoke3_agy_gpt.txt`(会话临时,结论以本段为准)。

---

## 37. 「正常打法模型 + 你的偏差」:把 compare 引擎从九个聚合指标扩到打法维度(logged 2026-08-23,用户当场提出)

用户原话:「不光是分析你哪里打得不好,也是分析别人的打法和正常人的玩法,
然后看看具体在你跟别人的偏差是什么」。

这**不是新功能,是已发布 compare 引擎的扩展**。现状:
`packages/analysis/src/compare/`(`lookupCell` / `assignBuildGroup` /
`buildExemplarLedPrompt` / `verifiedComparison` / `claimChecker`)+ desktop 侧
`compare` 服务与 `corpusLoader`,cell = `spec × bracket × archetype × buildGroup`,
内容是 `metrics`(约九个聚合指标的 p10/p50/p90)+ `exemplarCrises`。

### 缺口一:打法维度根本进不了 cell

`ReferenceCell` 里没有任何序列信息。`extractRotations`(opener / 三连 / crisis)
**在 corpus-tools 的管线里算了,但只有 `exemplarCrises` 落进 cell**,
opener 和三连序列在写 `reference_vectors.json` 时就丢了。
所以"循环怎么打 / 爆发怎么应对 / 大 CD 什么顺序交"这三维在产品里**不存在**,
而它们正是用户问的东西。

### 缺口二:build 分组不是英雄天赋,而且只声明了一个专精

`packages/corpus-tools/data/keystoneGates.json` 当前**只有戒律牧师一条**
(keystone 三元组的 any 命中 → `offensive`/`standard`),
其余六个治疗全部落在 `buildGroup: "*"` —— 也就是**不分 build 就直接比**。

用户 2026-08-23 裁定:「每个英雄天赋的玩法都是截然不同的」,且明确**适用于所有治疗**。
语料实测支持(2100+,`$GLADLOG_EVAL_HOME/healer-study/seq_data.json`):

| 专精                       | 第一个交的救人 CD               | 压力下主按键 |
| -------------------------- | ------------------------------- | ------------ |
| 神圣骑士 Lightsmith        | 牺牲祝福 40%                    | 荣耀圣令 23% |
| 神圣骑士 Herald of the Sun | 圣洁鸣钟 26% + 复仇之怒 25%     | 永恒之火 27% |
| 恢复萨满 Totemic           | 治疗之潮图腾 37%                | 治疗链 14%   |
| 恢复萨满 Farseer           | 先祖迅捷 41%                    | 治疗波 19%   |
| 生命缚誓者 Chronowarden    | 时间膨胀 59%                    | 时序烈焰 7%  |
| 生命缚誓者 Flameshaper     | 时间膨胀 38% + **梦境吐息 35%** | 孪生烈焰 11% |

同一专精两棵树是两套打法,合起来算得到的是**没人在打的平均值**。
连"迅捷接大治疗波"这种基础连招都分树:Totemic 用自然迅捷(n=2187)几乎不用先祖迅捷(n=73),
Farseer 完全相反(n=1252 / n=27)。
所以英雄天赋应当是**默认分层维度**,不是可选的 keystone 声明。

### 缺口三:输出形态(用户裁定)

「把统计的信息删掉,我不看,那不是给人看的」。
产出必须写成**文字**,数字只在句子里当证据。
研究侧两个形态都做了:`build_read.py`(读本,采纳)/ `build_seq_html.py`(表格版,仅供数据核对)。

### 已有的可用原型

`$GLADLOG_EVAL_HOME/healer-study/` 整条跑通了(README 有全部判据):

- `pass2.py` 提决策时间轴(每次施法带目标关系 / 目标血 / 队友最低血 / 自身血)
- `seq.py` 三段分析:`loop_profile`(按压力分层的循环)、`burst_response`
  (锚在**敌人开手**,不是锚在血线 —— 锚血线按定义只能找到晚了的反应)、
  `cd_ladder`(交出顺序 + 触发血线 + 给自己还是给队友)、
  `follows`/`precedes`(组合式循环用条件分布,n-gram 撑不住)
- `major_cds` / `save_tier`:大 CD 不靠手写清单认(同技能相邻施法中位间隔 ≥35s,
  与回合长短无关),救人档按**该专精自己的基准率**归一化后再判
  (竞技场里"有人低于 75%"本来就是常态,直接卡 50% 会把所有技能算进来)
- `deviate.py`:对照组按**用户自己的英雄天赋**匹配,否则大半差异只是"你走了另一棵树"

已产出四个专精的偏差(神圣骑士 / 恢复德鲁伊 / 神圣牧师 / 恢复萨满),
样例:2100+ 恢复萨满第一个交治疗之潮图腾 38%,用户只占 10%(先交自然迅捷/先祖迅捷,
第二个 42% 是血性狂怒 —— 对照组没有这个顺序)。

### 拦路的:数据,不是算法

1. **用户自己的新赛季样本只有 64 个治疗回合**(旧版本 1,028 个,天赋树不同不能混)。
   七个专精里只有四个够 20 回合,奶龙 **0 场**。偏差要稳定得等对局攒够,
   或者设计成"跨版本只比结构不比频率"。
2. **公开语料不是天梯顶端**:中位分 1700–1850,2300+ 只有 753 条治疗记录。
   "2100+ 对照组"是比多数人好,不是比用户好 —— 文案不能写成"高手都这么打"。
3. `reference_vectors.json` 的生产重建是独立长任务(`PER_BRACKET=1200`,数十 GB,数小时),
   加维度会同比放大。

### 价值门

按 CLAUDE.md 价值门第 1 条:接线前先拿**一场真实对局**产出完整输出例子给用户看,
通过了再谈标定和 A/B。这条尤其重要 —— 偏差类输出是"倒着写"的形状
(先手写目标结论句"如果这个好,它会对这场说什么",批准了再建引擎),
按价值门第 2 条办,不要先建管线再指望智能自己出现。

### 相关

#34(信号正确性 / 可行性门)、#36(提取缺口,尤其 (a) 的按键计数虚高会直接污染任何手法基线)、
SP-B1.5 的 `buildGroups`(本条要替换的就是它的分组维度)。

**Status**: logged,不动代码。研究侧原型可直接拿来出价值门要的那个例子。

---

### #37 记录(2026-08-25):三个缺口代码全量落地,生产语料重建挂运维

- **缺口二(英雄天赋默认分组)**:共享谓词 `heroBuildGroupOf`(`utils/talents.ts`,
  包着现成的 `findHeroTalent`)。语料侧 `combatToRecords` 无 gate 时用它;
  用户侧 renderer 算好经 `CompareInput.heroGroup` 传入(**3.2MB talentIdMap
  不进 desktop main** —— main 包卫生的老规矩)。keystoneGates 声明仍优先;
  天赋表未加载时返回 `"*"`,lookupCell 按既有链条降级,不猜。
- **缺口一(打法维度进 cell)**:`PerMatchRecord.rotations` →
  `Cell.rotationSummary`(share 聚合;"(used Nx)" 后缀剥离;每记录每序列只计
  一次)。聚合器旧守卫「无 gate 声明 → 折回 *」会吞掉全部英雄分组 ——
  **demo 抓到后泛化**:gate 专精走原配对规则;无 gate 专精观察到 ≥2 组且
  每组 ≥ nFloor 才拆(孤组只会复制 * cell,照池)。三条新测试钉死。
- **缺口三(文字输出)**:exemplar prompt 新增「How this cohort actually
  plays」段,份额转文字(≥50% standard / ≥25% common / occasional),
  **全段零数字**(claimChecker 的模型回声击杀链路碰不到它);
  `COMPARE_PROMPT_VERSION` 2→3,旧 compare.json 缓存按设计失效。
- **真实演示**(200 归档文件 / 1,857 记录,`demo37.ts`,floor=30):
  4 个英雄拆分 cell(奥法 Sunfury N=124 / Spellslinger N=70,武器战
  Slayer/Colossus)。Sunfury 的 cell:common 链
  `Arcane Barrage -> Arcane Missiles -> Arcane Barrage`(43%)等三条,
  prompt 段逐行文字渲染。演示还抓出 opener 用原始日志名(客户端语言)的
  bug —— 同一 opener 分裂中英两条、CJK 会漏进 prompt,已改走
  `getEnglishSpellName`(coreSequences 本就如此)。
- ~~**未完(运维)**~~ **已完成 2026-08-25 晚(`aa10f3e2`,首次生产重建收官)**:生产 `reference_vectors.json` 已重建 —— builtAt 2026-08-25T20:03Z,436 cell 全部带 rotationSummary,26 个 buildGroup,治疗按英雄树拆出 46 个 cell(奶萨 Farseer/Totemic、奶骑 Lightsmith/Herald、奶龙 Flameshaper/Chronowarden、奶德 Keeper/Wildstalker、戒律 standard/offensive)。下面一段是重建前写的,留作记录(2026-09-04 核对时这行仍写着未完,误把它当成待办报给用户)。原文:`buildCorpus.ts`
  已 `await ensureHeroTalents()`,对 2300+ feed 拉取(小时级,LOG_CACHE_DIR
  可复用 eval 缓存)。重建之前 rotationSummary 缺失,prompt 显式降级
  ("no rotation data in this corpus build"),英雄分组同样等重建后生效。
  演示未设分数门,只证形态;生产 cell 的健康检查仍走 validateCorpus。
- 治疗专精在演示样本里未过每树 30 的 floor(200 文件太小),这正是重建要用
  2300+ 全量的原因;用户裁定的输出形态(文字、数字只作证据)由缺口三的
  渲染约束落实。

## 38. 用语料常态改进**已发布**判据(logged 2026-08-23,来自 #36/#37 同一批语料研究)

#36 是"日志里还没读的东西",#37 是"新功能"。这一条不同:**判据都已经上线且标定过,
缺的是「应该是多少」的群体基准**,而语料正好能给。

> **前置**:本条全部依赖 #36 (a) 先修。按键计数虚高(引导跳动 / 回响复制 / 同刻记两条)
> 会污染任何以语料为基准的阈值,先修那条再动这里。

数据源:`$GLADLOG_EVAL_HOME/healer-study/seq_data.json` 的 `ladder.trigger`
(2100+ 语料,13 棵英雄天赋树逐树统计,单个 CD 的 n 从几十到四千余)。

### (a) `cd-hoarded` 的单一 35% 门 → 每个 CD 自己的触发血线【最可动手】

**2026-09-04 裁决与落地(GH #54 (f)):用户裁「选项一 = 上下文事实」,不做硬阈值。**
落地为 `[CD PRIOR]` 时间线行(`analysis/cdTriggerPrior.ts` 引擎、`data/cdTriggerPrior.ts` +
`cdTriggerPriorGenerated.json` 参照表、`context/cdPrior.ts` 渲染、门规 `checkCdPriorRefConsistency`
第 16 类硬失败、扫描 `eval/scripts/cdTriggerPriorScan.ts`、例子 `cdPriorExampleGen.ts`,runbook 6b-pre-6),
PROMPT_VERSION 51→52。表:18,134 文件归档 12.1+,179,342 次救人 CD 按键 / 17,070 场,81 个单元格,
群体 = 全部(`report` 实测:70 个有高分群体的格里只有 3 个 hi−all ≥3pp,不值得引入分数)。
**(f) 的前提被证伪**:49 个树级单元格里只有 2 个与专精级差 ≥3pp(痛苦压制 49/49/50、铁木树皮 48/50、
时间膨胀 49/51、灵魂链接 29/31)—— 树影响的是牌表不是血线,键仍带树、专精级回退。
验收(605 文件 / 1,270 回合同一 manifest):findings prompt 哈希不动(候选层逐字节不变),
context 多出 `[CD PRIOR]` 173 行 / 133 个回合;无持续门时 999 行(54% 是单秒闪跳、37% 低于中位不足 3pp),
持续门 = 下探跨过 3 秒响应窗且 owner 有 ≥3 个能施法的秒(`CD_PRIOR_MIN_PERSIST_S` = `RESPONSE_WINDOW_MS`)。
待裁:神圣赞美诗 + 神圣化身两张牌占 47% 的行(54+28/173),它们是 cd-hoarded 同一份名单里的 Defensive 标签
吞吐/群疗 CD —— 要不要把这两类从 `[CD PRIOR]` 名单里剔掉(改名单就要重扫表)。下一步 = 盲评/反向探针看模型用不用。

**2026-08-30 补记(GH #34 决策点重写)**:`cd-hoarded` 已换成决策点形状 ——
危机判定不再走本条讨论的 `CD_HOARD_CRISIS_HP_PCT`,改用 `crisisDecisionPoints`
自己的 `CRISIS_HP_PCT`(40%,与 `crisis-no-response` 共享同一谓词,见
`crisisDecisionPoints.ts`)。`CD_HOARD_CRISIS_HP_PCT` 仍然存在,但现在**只服务
`md-cyclone-window`**(见该常量在 `cooldownTiming.ts` 里的文档注释)。下面这条
「每 CD 自己的触发血线」建议因此不再适用于 cd-hoarded 本身 —— 如果仍值得做,
应该重新论证成"crisisDecisionPoints 的 40% 门该不该按 CD/专精细分",而不是按
原方案改 `CD_HOARD_CRISIS_HP_PCT`。以下历史分析保留作证据,不是待办。

`CD_HOARD_CRISIS_HP_PCT = 35`(`candidates/cooldownTiming.ts:455`)对**所有 CD、
所有专精**一视同仁。代码注释自己写着这个张力:「45% 会把不算危机的中等压力算进来,
低于 35% 又会漏掉真正的濒死窗」。语料的答案是:**这个数不该是一个数**。

41 个救人 CD 里只有 9 个的实际触发血线落在 30–45%。两头都错:

| 触发血线   | CD                                                                        | 35% 门的后果                                             |
| ---------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| **24%**    | 圣疗术(神圣骑士)                                                          | 门太高 → **误判**:队友 34% 还留着是正常,现在会被指控囤积 |
| **28%**    | 灵魂链接图腾(恢复萨满)                                                    | 同上                                                     |
| 33–45%     | 回溯 / 破咒祝福 / 翡翠交融 / 宁静 / 作茧缚命 / 圣盾术 / 还阳术 / 守护之魂 | 大致吻合                                                 |
| **49%**    | 痛苦压制(戒律) n=1913                                                     | 门太低 → **漏判**                                        |
| **51%**    | 治疗之潮图腾(恢复萨满) n=1178                                             | 同上                                                     |
| **53%**    | 牺牲祝福 / 复仇之怒(神圣骑士)                                             | 同上                                                     |
| **54–55%** | 光环掌握 / 圣洁鸣钟 / 圣佑术(神圣骑士)                                    | 同上                                                     |
| **58%**    | 神圣赞美诗(神圣牧师) n=1915                                               | 同上                                                     |

"漏判"这一档占了大多数:队友从 60% 掉到 40% 全程没交痛苦压制,比群体自己的交牌点晚了
9 个百分点,但因为没跌破 35%,**一次都不会报**。

处置:把常量换成「该 CD 自己的 p50 触发血线」查表。同判据能给前后数字
(按 CLAUDE.md 验证规则,必须报告替换前后的 `cd-hoarded` 发生率与逐类候选计数)。
⚠️ 表要按**英雄天赋**分,见 (f)。

### (b) `slow-defensive-response` —— 已于 2026-09-01 整体重写(GH #60 第二期),以下为历史记录

**2026-09-01 更新:这条已经不是原来那条判据了。**GH #60 第二期把它换成了决策点形态
(`analysis/burstWindowDecisionPoints.ts` + `candidates/burstWindowResponse.ts`):判的是
**按交火切分过的**爆发窗口(旧的判无界构建器窗口,语料 p50 21.6s),问的是**全队**有没有
在 8 秒内应对(旧的只问 owner),可行性按**承压的那个人**判,并加了严重度分诊。下面这段
「不用改」的佐证针对的是**旧判据**,保留是为了记录 8 秒这个数字的来源 —— 新判据沿用了同
一个 8 秒响应窗(`BURST_RESPONSE_WINDOW_MS`),理由相同。

这条已经语料标定过(p50 反应延迟 6.9s、门设在 8s ≈ p66,就是为了不把中位数判成错误,
且已有「工具可用 + 窗口开始时没被控」的门)。本轮独立测得:
**敌人开手后第一个动作就是防御大招的只有 5–9%,各分段一致**(神圣骑士 9%/8%/7%、
戒律 5%/4%、奶龙 6%/5%)。这从另一个角度印证 8s 门是对的 —— 防御 CD 本来就是第二层,
第一层永远是治疗。**结论:保持原样。**

(会话中我一度按「首个动作延迟 0.8–1.0s」去质疑这条门,那是**另一个量**
(任意施法 vs 防御反应),不构成反驳,在此存档以免重复踩。)

**2026-09-01 第二期 c(两道门 + 过度反应探针)。**
两道已批准的收紧上线:(1) **最小对比度门** `BURST_REF_MIN_CONTRAST_PP = 3`
(`data/burstWindowPrior.ts` 的 `burstRefClearsMinContrast`,产出侧与门规侧同一个 import)——
参照 cell 回退定案后的「没应对 − 应对了」死亡率差不足 3 pp 就不出面;
309 prompt 语料 **56 → 39 行**,引用持平/反向对比度的 **8 → 0**,低于门槛的 **17 → 0**。
(2) **窗口内掉血门** `BURST_TRIAGE_MIN_HP_DROP_PP = 15`(引擎新字段
`BurstFriendlyOutcome.startHpPct`)—— 严重度分诊额外要求被压的那个人在窗口内掉了至少 15 点血。
**{10,15,20} 三档实测几乎无差别**(全库 fires 6292 → 6168/6100/6010,死亡占比与
flat/reversed 占比在整个区间内只动 0.2 pp),取 15 是取扫描区间的中位,不是因为它赢了什么;
根因是分诊第一条已经要求最低血 ≤ 40%,而窗口内掉血在 fires 里本来就是
p05 21 / p25 47 / p50 61。**这条实测推翻了第二期交接件里「这是剩下最强的杠杆」的判断** ——
它在 309 语料上一行都没删。参照表不受影响:按 `feasible` 建,从不读 `triaged`,
重新生成后 106 个 cell 逐字节相同。

**过度反应(over-react)探针 —— 三条定义全平,想法作废。**
用户 2026-09-01 提的想法:「为一次不需要的爆发交多了大招,后面会不会被惩罚」。
门槛照 `cd-spent-idle` 2026-08-30 退役时的判据(3.6% vs 3.1%,无代价)。
同一次全库扫描顺带采了 `responsesCount`/`majorsSpent`/`spendWeightS`/严重度/后续惩罚,
报告在 `eval-private/reports/burst-window-2026-09-01/overreact-report.md`。
**关键方法学问题:任务给的「后续惩罚」判据(后面还有一个可行窗口时,当时交出去的某个 CD 还在转)
本身由冷却长度机械决定** —— 180 秒的大招在本回合后面几乎必然还在转。
按这个原始判据 O2/O3 看着「有牙」(+13~+22 pp),但换成回合内配对的
difference-in-differences(同一回合里,落在「已交出去的 CD 阴影内」的后续窗口变坏率
− 阴影外的变坏率,再减去对照组的同一个差)之后:
**O1 −0.0/−8.7/+1.6/+3.8、O2 −6.6/−34.1/+2.0、O3 +0.3/−1.5/−0.2/+4.3(ALL/2v2/3v3/单排)**,
三条定义都没有在两个以上赛制上过 3 pp。阴影效应在触发组和对照组里一样大
(O3 触发 +3.0 vs 对照 +2.7),即「爆发刚过去,后面压力更大」是通用现象,与交多交少无关。
**结论:与 `cd-spent-idle` 同命,不立项。** 探针代码留在
`packages/eval/scripts/burstWindowScan.ts overreact`(引擎侧只有一个默认关闭的
`collectSpend` 选项,产品从不打开),以免下次有人重新提出时又要重跑一次全库。

### (c) `SLOW_DEF_REACTION_IDS` 漏掉专精自己的救人 CD —— 2026-09-01 随该表一起下线,问题换了形态

**2026-09-01:`SLOW_DEF_REACTION_IDS` 这张并集表已随 (b) 的重写删除。**新判据的「算不算应对」
走 `burstWindowDecisionPoints` 的 `wall`/`external`/`healCd`/`control`/`kite` 五类,其中
`healCd` = `TEAM_HEAL_CD_IDS` ∪ `HEALING_VERDICTS` 里用户签过字的 `burst-answer` 条目 ——
两张表都已登记在 `curatedIdRegistry`,反向腐烂扫描能看见。下面点名的那几个技能是否已被覆盖,
仍然值得按同样的观测真值做一次正向体检(圣洁鸣钟、神圣壁垒、终极苦修、麦琳瑟拉的祝福、
风暴涌流图腾),只是要对着新的五类去查,不再是对着这张已删除的表。

`SLOW_DEF_REACTION_IDS = MAJOR_DEFENSIVE_IDS ∪ trinketSpellIds ∪ REPOSITIONING_SPELL_IDS`
是三张手工表的并集。语料按「同技能相邻施法中位间隔 ≥35s + 按该专精基准率归一化的反应性」
认出来的救人档里,有几个**不在任何一张表上**:圣洁鸣钟(神圣骑士,1075 次,触发 54%)、
神圣壁垒 / 圣洁武器、终极苦修(戒律)、麦琳瑟拉的祝福(奶龙)、风暴涌流图腾(恢复萨满,
1983 次,触发 55%)。这些在语料里明确是**反应性交出**的,判据却看不见它们
—— 于是"没有防御反应"会误报在那些确实做了反应、只是用了表外技能的回合上。
按 CLAUDE.md 手工清单完整性规则,这三张表应当拿观测真值做一次反向体检。

### (d) `kick-eaten` 的严重度按专精定 —— 见 #36 (b)

`kickEatenEvents` 注释自己挂着「要挑最贵的被断,需要新的排序谓词」。
被踢的代价差一个数量级:戒律 76–80% 能换学派继续打,神圣骑士只有 8%、
且 **36% 的情况整整 5 秒没动作**。数据与探针见 #36 (b)。

### (e) `healing-gap` 的 free 时间没扣**学派锁定**

`detectHealingGaps` 的 `getCCCoveredMs` **已经**扣掉硬控与沉默(合并区间,避免重复计数)
—— 这点我在会话中说错过,在此更正。真正漏的是**踢造成的学派锁定**:
纯打断(Pummel/Kick 这类)**不产生 `SPELL_AURA_APPLIED`**
(仓库 `spellTags.ts` 自己注明了这一点),所以 `getCCCoveredMs` 看不到它,
被踢后无法施法的 3–4 秒会被算成 `freeCastSeconds`(= 「他本来能施法」)。

影响面按专精分化:能换学派的(戒律 78%、奶龙 80%)几乎不受影响;
**不能换的会被系统性冤枉** —— 神圣骑士被踢后 36% 的情况整整 5 秒没动作,
这些秒目前全部计入"自由时间"。修法:`SPELL_INTERRUPT` 的 index 13 直接给被锁学派,
把锁定窗口并进 `getCCCoveredMs` 的合并区间即可。
**已落地 2026-09-02(GH #54 镜像项)**:不是往 `getCCCoveredMs` 里再抄一份,而是把 dispelAnalysis
「驱散者被锁」门原有的 `buildCannotCastIntervals`(施法阻断光环 ∪ 踢技锁定,锁定时长走 GH #62 的
语料实测表)抽到 `utils/cannotCastIntervals.ts`,两边同一谓词(索引已加行);healingGaps 的
`getCCCoveredMs` 只剩「裁剪 + 合并」。顺带把光环区间的边界统一成 `>=`(同刻 apply/remove 的闪烁
光环此前会把覆盖延伸到下一次移除)。验收(S2 605 场 / 1,270 回合 / 3,520 视角):候选逐类只有
healer:healing-gap 61 → 62 动(+1 来自边界修正:一条被闪烁光环误覆盖的空档重新出现),其余全同;
逐空档探针(1,257 治疗回合、254 个空档):**6 个空档扣掉了踢锁定,合计 11.2 秒**(如 5.1s 空档
free 5.1 → 2.1),7 个空档的光环覆盖因边界修正而变。踢锁定的影响面比 (b) 的百分比暗示的小 ——
被踢后的沉默大多不满足「≥3s 空档 + 队友承压」的立项门,真正被冤枉的是少数几条;单测钉住
反震 6s 锁定吃掉空档 / 3s 近战踢只扣 3s 两种形态。

### (f) 英雄天赋分层影响**所有** spec 级阈值表

`cooldowns.ts` 那一族表(以及 (a) 要新建的血线表)都是按专精的。
但同一专精两棵树连「救人 CD 是哪几个」都不同:
神圣骑士 Lightsmith 第一个交牺牲祝福 40%,Herald 交圣洁鸣钟 26% + 复仇之怒 25%;
奶龙 Flameshaper 把梦境吐息当大招交(第一个交占 35%),Chronowarden 完全没这回事。
任何 spec 级阈值都在平均两个不同的群体。用户 2026-08-23 裁定分层适用于所有治疗(见 #37)。

### (g) 负结果:两条别做

- **溢出治疗率不区分水平**:四个分档全平(戒律 46→47%、恢复德鲁伊 40→39%、
  神圣牧师 29→29%)。它目前只是 prompt 时间轴上的一行渲染文本,**别升级成判据**。
- **随分数上升的几乎全是工具键**(驱散 / 打断 / 位移),治疗键不涨
  (恢复萨满净化灵魂 0.34→0.79 次/分,织雾清创生血 0.35→0.74)。
  这支持 #26 当初不上线 mana 候选的决定:区分水平的不是"奶得省不省"。

### (h) 边界:常态 ≠ 正确

语料给的是**多数人怎么做**,不是**应该怎么做**。中位分只有 1700–1850,
2300+ 只有 755 条治疗记录。所以最稳的用法是**当上下文事实喂给模型**
(「这个专精的群体在 54% 交这张牌,你在 40% 还留着」),而不是直接变成指控 ——
与 v0.1.27 八信号「降级为上下文事实」的处置同型。(a) 若要做成硬判据,
必须先过价值门:拿一场真实对局产出完整输出例子给用户看。

**Status**: logged,不动代码。建议顺序 **(a) → (d) → (e)**:
(a) 是替换一个已有常量、同判据能给前后数字;(d) 有现成数据和仓库自己挂着的问题;
(e) 改动小但影响的是一个高触发类型。(b)(g) 是"别动"的记录,(c)(f)(h) 是前提条件。

---

## 39. getPriority 的分档是先验,不看实际后果(logged 2026-08-23,用户拍板单独立项;#34(b2) 顺带发现)

`dispelAnalysis.getPriority` 按可驱散性 + 阵容给 missed-cleanse 分
Critical/High,从不回看窗口里实际发生了什么。288 场配对语料实测:
`postCcDamage=0`(被控全程零后续伤害)的 missed-cleanse 占 **22.5%(40/178)**;
`priority=Critical` 的 83 条里后果为零的占 **26.5%(22 条)** —— 一条
Critical 指控伴随零伤害,教学价值存疑。

方向:**用户裁定 A(2026-08-25)** —— 分档吸收后果。价值门标本(match
2eb0ff2b:Fear 6s / Howl 6s,均 Critical、`0k taken during`、castBusy=0)
呈给用户后拍板:Critical 必须伴随 postCcDamage>0 **或**目标在窗口附近死亡
(控制本身锁出的击杀),否则降一档到 High —— B 案关心的「坏习惯仍被记一笔」
由降到 High 而非消失来保留。

**实现(2026-08-25)**:`dispelAnalysis.consequenceGatedPriority`(单谓词,
missed/late 两个窗口构建点共用),窗口新增 `consequenceDemoted` 标记(扫描
可直接数出「原本会是 Critical 的」)。死亡关联窗 = [apply, max(removal,
apply+POST_CC_PRESSURE_WINDOW_S)]。注意 postCcDamage 沿用 damageIn 口径
(与 22/125 基线同源);是否并入被吸收压力(incomingPressure)是另一个
待裁定项,勿顺手改。

**验证(1200 回合)**:原本会是 Critical 的 389 窗里 **128 窗
(32.9%)因零后果降档**(配对语料基线 17.6% 只含 busy 场景,全库更高属预期);
门后零伤害的 Critical 剩 0 窗 —— 「Critical + 零后果 + 无死亡」按构造
归零。单测 4 条钉死四个象限(`consequenceGate.test.ts`)。

**Status**: 已实现并验证(ruling A)。
数据:`gladlog-eval-private/video-log-xcheck-2026-08-23/busy*.jsonl`。

## 40. 八类"从没读过的日志事件"逐条核对产品侧 + 五条已读进解析层(logged 2026-08-23)

> **与 #36 的关系**:#36 是同一批语料研究挖出的信息清单(并行会话所写),本条是
> **产品侧的逐条核对结果与实现记录**。本条关闭 #36 的 **(c)**(`SPELL_MISSED` /
> `DAMAGE_SPLIT` / `SPELL_ENERGIZE` 只在 enum 里)与 **(d)**(`SPELL_EMPOWER_END` /
> `SPELL_HEAL_ABSORBED` 连 enum 都没有)。#36 的 (a)(b)(e)(f)(g)(h) 未动。
> 编号两次让给并行会话(先 #36/#37/#38,后 #39=getPriority 先验),本条最终为 40;早期提交信息里写的 #39 指的是本条。

治疗语料研究列了八类日志事件"整类判断做不出来",但那份清单是按**研究侧提取器**
(`healer-study/gap_probe.py`)写的,**不等于产品侧的缺口** —— 逐条对着 `packages/parser`
/ `packages/analysis` 核完之后,8 条里 **2 条落空、1 条部分已有、5 条坐实**。核对结论记在
这里,免得下一个 session 照着那份清单直接动工。

| #   | 研究侧的说法                                                      | 产品侧实况                                                                                                                                                           | 结论                                                                                                                                                          |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 控制真实时长做不出来                                              | `drAnalysis.ts:508` 就是 apply/remove 配对算 `durationSeconds`;`auraIntervals.ts` 是配对单源                                                                         | **落空**(handoff 已于当晚自行更正)                                                                                                                            |
| 6   | `SPELL_AURA_BROKEN_SPELL` 打断者 GUID 不在事件里,要靠同刻伤害反推 | **在事件里**,就是 src。实测行:`SPELL_AURA_BROKEN_SPELL,<打断者>,...,<被控者>,...,115191,"Stealth",0x1,20271,"Judgment"`。`ccBreakAnalysis.ts` 早就按 src=打断者 在用 | **落空**                                                                                                                                                      |
| 8   | 假读条(`SPELL_CAST_START` 无配对 SUCCESS)                         | `l3/collect.ts:176` 收 castStarts,`kickAudit.ts` 已经用"读条被取消"做骗踢判定                                                                                        | **部分已有**;缺的是"被踢掉 / 自己取消"的分类                                                                                                                  |
| 2   | 资源(法力/能量/精华)读不到                                        | `decodeAdvanced` 只取 actorGuid/ownerGuid/hp/maxHp/x/y/facing/mapId,**powerType/currentPower/maxPower 一个都没解**                                                   | **坐实**(与 #26 同族)                                                                                                                                         |
| 3   | `SPELL_MISSED` 的 missType                                        | 事件进了 `LogEvent` 枚举,`parseLine` 走通用 `SPELL_` 分支只解 base+spell,**missType(params[11])丢弃**,analysis 侧零消费者                                            | **坐实**。⚠️ 实测 `missType=ABSORB` 与 `SPELL_ABSORBED` 是**同一发伤害的两条记录**(同刻、同数字),只有 IMMUNE / REFLECT 是新信息,ABSORB 那 174k 次不能再加一遍 |
| 4   | `DAMAGE_SPLIT`(牺牲祝福/灵魂链接)                                 | 只在枚举里有名字;`parseLine` 既不 `endsWith("_DAMAGE")` 也不 `startsWith("SPELL_")` → `isKnown=false`,**整条丢弃**                                                   | **坐实**                                                                                                                                                      |
| 5   | `SPELL_EMPOWER_END` 的充能等级                                    | **枚举里根本没有这个事件**;走通用 `SPELL_` 分支解出 base+spell,最后一个字段(等级)丢弃                                                                                | **坐实**。同时 `SPELL_EMPOWER_START` 也在,dest 是裸 `nil`(产品的 token 拆分器不受影响)                                                                        |
| 7   | `SPELL_HEAL_ABSORBED`                                             | **枚举里没有**;`parseLine` 的 `_ABSORBED` 排除分支把它判 `isKnown=false`,**整条丢弃**。单场实测 263 条                                                               | **坐实**                                                                                                                                                      |

### 已在本轮修掉的(不在上面八条里,来自同一份 handoff §四)

承压漏掉吸收 —— 见本轮提交。剩下 5 条坐实的缺口**没有动**:它们是"读进来"的工程,
但读进来之后要变成教练信号,必须先过 CLAUDE.md 价值门第 1 条(先拿一场真实对局出完整
输出例子给用户看)。按 handoff 的价值排序,下一个是 #2(资源可读),它同时是价值门第 3 条
"当时按得出来吗"的可行性门地基;#4/#7 是**纯口径修正**(承压两边算错、HPS 漏一层),
不需要价值门,可以直接按前后数字做。

### 五条坐实的缺口:解析层已全部接入(2026-08-23)

| #   | 事件                                | 改法                                                                       | 关键判据(都是实测定的,不是照文档写的)                                                                                                                                                                                   |
| --- | ----------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | advanced 的 `powerType/current/max` | `decodeAdvanced` 增 `powers`,锚在自动探测到的 x/y 对之前(`xIdx-4..xIdx-2`) | 一个单位可能同时报多种资源,管道分隔(`13                                                                                                                                                                                 | 0`),占施法行 **2.7%**,必须按列表解 |
| 3   | `SPELL_MISSED` 的 `missType`        | 新增 `decodeMissed`,L3 存 `missesOut`/`missesIn`                           | ⚠️ `missType=ABSORB` 与同刻的 `SPELL_ABSORBED` 是**同一发伤害的两条记录**,再加一遍就是重复计;只有 IMMUNE / REFLECT 是独有信息                                                                                           |
| 4   | `DAMAGE_SPLIT`                      | 按伤害事件解析,**只进 `dest.damageIn`**                                    | src 与 dest **同队 7,354 例 / 敌对 0 例** —— src 是被转移伤害的人(牺牲祝福的受保护者),不是攻击者。进 `src.damageOut` 会凭空造出伤害输出                                                                                 |
| 5   | `SPELL_EMPOWER_END` 的充能等级      | 末位字段解成 `empowerLevel`,L3 存 `empowerEnds`(**不并进 `casts`**)        | 并进 casts 会让每次充能施法重复计数 —— 它本来就另有一条 `SPELL_CAST_SUCCESS`                                                                                                                                            |
| 7   | `SPELL_HEAL_ABSORBED`               | 新增 `decodeHealAbsorbed`,按受害者键存 `healAbsorbsIn`                     | **前缀描述的是吸收不是治疗**(实测 13,809 : 0 —— 拿同刻 `SPELL_HEAL` 对账):p0=施加治疗吸收的人、p4=被吸收者、spell@8=吸收 debuff,extra 才是治疗者+治疗技能。也**不是 HPS 漏算**:D8 已证 `SPELL_HEAL.amount` 本来就是净值 |

`slim.ts` / `invariants.ts` 白名单同步登记(新数组带 params 的要裁剪,`healAbsorbsIn` 只存解好的字段所以不用)。
`mirrorDecodeAdvanced` 同步加 `powers`,`extractManaFromAdvanced` 改成消费它 —— 否则两处各拆一遍管道分隔的资源块,正是共享谓词规则要防的形状;`predicateIndex.test.ts` 的深度相等断言就是靠这个抓到的。

**产品接线到哪一步**:#4 自动生效(它进了 `damageIn`,`incomingPressureEvents` 就看得到)。#2/#3/#5/#7 是**新事实,还没有变成教练信号** —— 按 CLAUDE.md 价值门第 1 条,接线前要先拿一场真实对局出完整输出例子给用户看。

### 接线逐条过价值门(2026-08-23,用户要求「一个一个看怎么帮助 LLM」)

**#7 治疗被吸收 —— 不接线(负结果,勿重新论证)**

解析层保留(它是将来任何「治疗为什么没落地」问题的诚实分母),但**不进 prompt**。
判据链条(1200 回合 / 1,322 次死亡):

| 问题                            | 实测                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| 是 HPS 漏算吗?                  | 否 —— 台账 D8 已证 `SPELL_HEAL.amount` 本来就是扣过治疗吸收的净值                                  |
| 「那口救命的治疗被吃了」成立吗? | 死亡前 10s 有任何被吃的 **56/1,322(4.2%)**;被吃量单独 ≥ 受害者 20% 血量的只有 **6 次(0.5%)**       |
| 死亡窗口里的量级                | 落地 3.71 亿 vs 被吃 405 万(**1.1%**)                                                              |
| 是敌方压力吗?                   | 死亡窗口前三名有两个是**自伤**:天灾契约(DK 自己的代价)、殉道之光(骑士机制)。只有死疽伤口是敌方施加 |
| 那它可执行吗?                   | **不可驱散**。120 个归档文件:死疽伤口上身 361 次,全部 6,372 次 `SPELL_DISPEL` 里驱散它 **0 次**    |

结论:玩家看到这条**没有任何可以做得不一样的事**。按价值门第 1/3 条(先看真实输出、
「当时做得到吗」),它同时挂在「量级不够」和「无可行动作」两条上。⚠️ 注意
`spellEffectGenerated.json` 里死疽伤口**没有 `dispelType` 字段** —— 按策展清单规则
字段缺失不等于不可驱散(可能只是没进候选 id 列表),所以上面用的是**可观测真相**
(语料里有没有人真驱散过),不是那个缺失的字段。

**#3 免疫 —— 已接线,同批查出并修掉免疫表 3 个变体 id 缺口(2026-08-23)**

接线形态不是新增段落,是两件事:

1. **`CC_AVOIDANCE_BUFF_SPELLS` 第一次有了可观测真相可查**。判别器
   `immuneRate(X) = 挂着X时控制被免疫 ÷ (被免疫+落地)`(`immuneCcScan.ts`,
   1200 回合):真免疫自然浮顶(圣盾术 100%、寒冰屏障 100%、预知 95.3%),
   环境 buff 自然沉底。⚠️ 朴素版「取覆盖那一刻的任意 buff」会把耐力祝福排第一
   (目标身上永远有 buff),恒真 —— 判别器必须对比同一情境的两种结局。
   查出 3 个**同名变体 id** 不在表里:剑刃风暴 446035(90.8%)、反魔法护罩
   444741(65.9% —— 表里的 48707 只见到 12 次免疫,**主力 id 在表外,差 9 倍**)、
   410358(Spellwarden)。另加终极忏悔 421453(64.4%,有真 240s CD)。
   验收:未登记且 >50% 的光环 **5 → 1**(剩 The Beast Within 51.2% n=41,
   学派覆盖不明,刻意挂账不进表)。AMS 两个变体同步进 `MAGIC_ONLY_IMMUNITY_IDS`。

2. **`[YOU] [CC]` 行加 `[IMMUNE — X was up]` 标记**。此前控制打进圣盾和落地的
   控制在 prompt 里**长得一模一样**(施法行照出,只是后面没有 DR 标记)。
   真实对局例:`2:51 [YOU] [CC] Dragon's Breath [DR: Disorient Full]
[IMMUNE — Divine Shield was up]`。免疫名只在表里有对应光环覆盖击中瞬间时
   给出,查不到就裸 `[IMMUNE]`,不猜。两个发射点(台账 + 通用施法循环的 CC
   分支)都接了 —— 激活那次的教训;每条 miss 只消费一次,连按不会重复标。

   ⚠️ 价值门例子顺带暴露一个**旧有** prompt bug:妖术这类皮肤变体 id
   (cast=210873,台账记在基础 id 下)会让同一次施法渲染**两行**(台账行 +
   通用行,`seenCasts`/`trackedCastsBySpellId` 去重按 spellId 精确匹配穿透)。
   与本次改动无关、本次未修;`[IMMUNE]` 落在 id 匹配的那行上。归光环双 id
   腐烂同族,修它要把去重键从裸 spellId 换成变体归一后的 id。

**#5 充能等级 —— 已接线(2026-08-23)**

`[YOU] [CD/CAST]` 的充能施法行加 `[EMPOWER L?]`。此前每次释放渲染得一模一样,
模型无法把「梦境吐息放了但没救起来」和「它是 L1 点按」连起来 —— S2 语料梦境吐息
**87% 是 L1 放的**(774/20/104)。真实对局例(奶龙,台账路径):

    0:51  [YOU] [CD]   Dream Breath (self: 100% HP, 0%/s, 0k DPS) [EMPOWER L1]

一个真实回合 12 次释放全 L1、另一回合 13 次里 11 次 L1 —— 例子直接复现语料分布。
标记只陈述事实,不做指控(Flameshaper 点按流是真实打法,L1 对不对是模型结合
天赋判断的事)。三条渲染路径(台账/提升/普通施法行,含破折叠)全接,
`SPELL_EMPOWER_END` 按 spellId ±1.5s 配对、每条只消费一次;
`matchTimeline.empower.test.ts` 钉死。仅奶龙 owner 有此标记,token 成本可忽略。

**Status(终):解析层 5/5;接线 5/5 处置完毕** —— #2 已接(`[MANA]` 行)、
#3 已接(`[IMMUNE]` + 免疫表补全)、#4 自动生效(进 `damageIn` →
`incomingPressureEvents`)、#5 已接(`[EMPOWER L?]`)、#7 **判定不接线**
(负结果,判据表见上,勿重新论证)。每条接线都过了价值门:真实对局的完整
prompt 例子先行,两条(#7 的死亡挂钩、#3 的朴素判别器)被例子/数据当场否掉重做。

### 1000 盘补跑对账(2026-08-24,用户要求每项 ≥1000 盘)

首轮验证多按回合计且部分不足 1000 场,串行补跑(一次一个扫描)后逐项对账,
**六项全过、无一翻车**:

| 验证             | 首轮           | 补跑(≥1000 场)                                                                                                                                                  | 判据     |
| ---------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 激活回蓝机制     | 200 场 / 58 窗 | **1,000 场 / 190 窗**:上升 181 / 下降 0,中位 +9.5→**+12.3pp**,窗口内施法仍耗蓝 16% 不变                                                                         | 过,更硬  |
| 承压漏吸收       | 600 回合       | **1,100 场 / 2,920 回合**:漏 22.2→**20.8%**,覆盖 100%(0/8,025),注记 0→**48.3%**(6,972/14,435),产品对齐 **98.0%** 分毫不动                                       | 过       |
| D7(absorbsIn 键) | 300 回合       | **2,920 回合 / 16,044 单位**:compat 层 **0/2,920 选错、0/16,044 不一致**;L3 层选错 23.8%(反证旧键法之错);图腾分支 1,985/2,466 可输出                            | 过       |
| 免疫表第一批     | 1,200 回合     | **3,300 回合 / 11,827 次免疫**:446035 剑刃风暴 **94.7% (n=209)**、444741 AMS **66.8% (n=392)**;The Beast Within 大样本跌破 50%(51.2% n=41 是噪声)→ **明确排除** | 过       |
| #7 负结果        | 1,322 死亡     | **3,706 死亡**:任何被吃 3.9%、够救命 0.5%、窗口占比 1.0%,头名换成天灾契约(自伤)                                                                                 | 裁定坐实 |
| 五类量级         | 389 场         | **1,260 场 / 3,300 回合**:资源 2,028 万采样、IMMUNE 185k(控制 6.4%)、伤害转移 0.4%/个体 11.6%、梦境吐息 L1 **86.1%**、治疗被吃 22.3% —— 全部同量级              | 过       |

### 免疫表第二批(3,300 回合扫描才过 n≥25 门槛的 7 个 id,2026-08-24)

大样本扫出 9 个未登记 >50%,**逐个做 dest-type 门**(光环落在谁身上 —— Healing
Stream 97.8% 的教训:光环在免控图腾自己身上,是目标类型混杂不是免疫):

- **进表 7 个**(光环全部落在玩家):Deep Breath 433874(93.8%)/357210(85.4%)、
  Command Squadron 1252613/1261393/1261395(92.9–93.8%,曾疑召唤物混杂,实测
  40/40 落玩家)、Stretch Time 410355(93.1%)、Celestial Conduit 443028
  (62.5%,90s CD 引导免疫,与终极忏悔同形)。
- **明确排除 3 个**:5672 Healing Stream(40/40 Creature,图腾混杂)、
  1236943 Deep Breath(40/40 Creature,生物侧变体)、357140 The Beast Within
  (大样本回归 <50%)。
- **after 复扫**:未登记 >50% **9 → 2**,恰为两个记录在案的混杂。

方法论沉淀:immuneRate 判别器 + dest-type 门是这张表以后每个赛季的常规体检
(`immuneCcScan.ts` + dest-type 抽查),不再靠手工回忆哪些技能免控。

### #40 附:后续批(2026-08-25)顺带修掉的双行渲染旧 bug

价值门例子暴露的「妖术皮肤变体 id 穿透去重 → 同一施法双行」已修:台账抑制在
按裸 spellId 精确匹配之外,增加**同名 ±1s** 兜底(`trackedCastTimesByName`
本就在旁边;两次同名真按键塞不进一个 GCD,±1s 安全)。300 局 prompt 实测:
重复 `[YOU]` 组 **171 → 77(-55%)**,受影响 prompt **31.3% → 12.7%**;
台账类(赞美诗 45/妖术 27/牺牲祝福 12/宁静 6)全部清零。残余的回春术 46 组
经原始行核查是**同显示秒两次真实按键**(774 单 id、40 文件零同刻对)——
不是 bug,是测量键的显示秒粒度;圣化之地类同 id 复记归 #36(a) 的折叠管。
测量脚本 `packages/eval/scripts/dupLineScan.ts`(前后同判据)。
