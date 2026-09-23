# gladlog feature backlog

Ideas not yet scheduled. Each is a starting point for a future brainstorm → spec →
plan cycle, not a committed design. Compliance: where an item references the old
fork (`/Users/mingjianliu/code/wowarenalogs`, CC BY-NC-ND) it's for the _concept_
only — any port is clean-room (controller extracts audit-CLEAN files; the app's
data is already gladlog-native).

---

> Completed items (#2-13, #15, #16, #20, #22, #23, #24 dr reverse, #26-28, #32, #39, #40, multi-model, spellNames, etc.) have been moved to
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
>    巡检时判定已完成的 9 个条目已全部迁档至 [BACKLOG-archive.md](BACKLOG-archive.md)
>    (#22、#23、#24 dr reverse、#26、#27、#28、#32、#39、#40;原处保留标题与跳转锚点)。
>    当前无待迁档条目。
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

- ~~**SP-A.1** — LLM-judge causal audit + digit/constant refinement (deferred from
  the SP-A honesty gate; causal/qualitative claims can't be verified
  deterministically).~~ **Done 2026-07-23** (`473101d2`, verifiability roadmap
  B1): the `causal-hardening` calibration perturbation, detection 50% → 80% after
  the coupled-dimension + rubric fixes. This entry was never struck through —
  accounting closed 2026-09-22 (GH #38).

- **Timeline-prompt token compression** — ~~the timeline-variant prompt is ~76%
  larger than the sparse one; compress it (also helps the slow `claude -p` local
  backend).~~ **Referent gone, awaiting ruling (2026-09-22, GH #38)**: the "+76%"
  was the 2026-07-11 A/B (`ab/2026-07-11-timeline-variant`: sparse 2,851 vs
  timeline 5,016 mean tokens), and the sparse branch was deleted as production
  dead code on 2026-08-21 (`7c91140a`) — there is no smaller variant to compress
  toward. Current size, PROMPT_VERSION 94, newest 30 library matches
  (`packages/desktop/scripts/promptSizeProbe.ts`): mean 38.5k chars / 413 lines
  (median 34.7k, 12.7k–79.0k; Solo Shuffle 34.5k, 2v2 30.1k, 3v3 49.5k), roughly
  10k tokens. Largest buckets: timeline `[STATE]` ticks 15.4%, other timeline
  rows 15.0%, the MATCH TIMELINE legend 8.9% (a constant ~3.4k chars in every
  prompt), `[YOU]` rows 8.6%, HEALER OFFENSE 8.1%, `[CC ON TEAM]` 7.1%, KILL
  ATTEMPTS 6.6%. Options for the user: (a) retire the entry — the size is the
  cost of the timeline design adopted on 2026-07-11; (b) open a scoped item
  (legend → system-prompt-side once per session, or `[STATE]` tick thinning),
  which is a rendered-text change: PROMPT_VERSION bump, every gate re-parses the
  prompt, and a blind A/B on Opus quota with the accuracy noise floor SD ≈ 1.3.

- ~~**CI flake `runtime.quietclose.test.ts`** (filed on GH #38, 2026-09-05: the
  segment quiet valve asserted on real wall-clock sleeps, so a loaded runner
  could overshoot `closeMs` and the valve fired correctly).~~ **Closed
  2026-09-22** (`fa651376`): the test drives the valve on vitest fake timers;
  the mechanism was reproduced deterministically (old assertions + one sleep
  stretched past the threshold → the exact CI error text), 10/10 local runs,
  test body 1.2 s → 28 ms. Pattern recorded in `.claude/skills/desktop-dev`.

- **CI code-signing / notarization** — wire macOS notarization + Windows signing
  secrets into `.github/workflows/build.yml` when certs exist, for zero-warning
  installs. See [[gladlog-packaging-gotchas]].

- **MatchStore hardening (accepted-low-risk today)** — ~~`safeName` id collision →
  phantom duplicates~~ **closed 2026-09-22 (GH #38)**: `safeName` is now injective
  (`%xx` escapes instead of collapsing every unsafe character to `_`; a leading
  `.`/`_` is escaped too so init()'s reconcile never skips the dir as hidden).
  Production ids are 8-hex FNV-1a hashes and pass through verbatim — 1,095/1,095
  library dirs unchanged. Pinned by three tests in `matchStore.test.ts`: before,
  storing `x/y` then `x_y` left one dir and `readRawText("x/y")` returned the
  other match's bytes; after, two dirs, both survive a cold `init()`. Still
  accepted as-is: out-of-band `meta.json` edits go stale (index is a cache) —
  nothing edits `meta.json` outside the app; revisit if the store ever lives in
  a synced folder. Not touched: a 32-bit content-hash collision between two
  different matches dedups the second as "already stored" (≈ n²/2³³, ~1% at
  10k matches); changing the id scheme renumbers every library, so that is a
  user ruling, not a hardening item.

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

1. ~~**DEATH-002 immunity available at death**~~ **不做(用户 2026-09-05,「太明显了」)**:事实已在每份 prompt 的 DEATHS WITH MISSED OPTIONS 段(本地 309 份里自身免疫 9 行 / 队友外放 80 行),不再升级成指控;原 needs immunity sub-table + Hypothermia-class shared debuff ledger
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
5. ~~**OFFENSIVE-001 cone ability whiff**~~ **不做(用户 2026-09-05)**:needs cone spell table + geometric determination.
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

**2026-09-15 status.** Form 1 is over: the upstream discontinued anonymous search on 2026-09-08 (user ruling the same
day: stop, no workaround), and on 2026-09-13 reopened it behind Battle.net sign-in with raw logs metered at **15 distinct
logs per user per UTC day** (flat, no tiers — verified in their source, `accessLimits.ts`). `archivePvpLogs.ts` is retired
and refuses to start; the 63,309-match Drive archive (2026-08-13 → 2026-09-05) is frozen and feeds the reference corpus.
`fetchPvpLogs.ts` was moved to the signed-in grant path and stops on the server's counter — targeted sampling only.
Details and the compliance reasoning: `docs/DATA-COMPLIANCE.md` §3. Forms 2 and 3 are unaffected and remain the only
route to volume.

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

_Archived to [BACKLOG-archive.md#22-temporary-rate-limiting-dispeltrinket-type-candidates-per-round-cap-logged-2026-08-06-temporary-status-ended-2026-08-20--kept-long-term-by-user-ruling-see-the-closing-note-at-the-end-of-this-entry](BACKLOG-archive.md#22-temporary-rate-limiting-dispeltrinket-type-candidates-per-round-cap-logged-2026-08-06-temporary-status-ended-2026-08-20--kept-long-term-by-user-ruling-see-the-closing-note-at-the-end-of-this-entry)._

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

_Archived to [BACKLOG-archive.md#23-github-issues-batch-1-logged-2026-08-11-4-issues-opened-by-users-on-gh](BACKLOG-archive.md#23-github-issues-batch-1-logged-2026-08-11-4-issues-opened-by-users-on-gh)._

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

_Archived to [BACKLOG-archive.md#24-dr-reverse-query-always-empty--analyzeoutgoingccchains-target-side-hardcoded-hostile](BACKLOG-archive.md#24-dr-reverse-query-always-empty--analyzeoutgoingccchains-target-side-hardcoded-hostile)._

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

_Archived to [BACKLOG-archive.md#26-two-high-value-streams-discarded-by-the-parsing-layer-from-raw-logs-mana-values--spell_cast_failed](BACKLOG-archive.md#26-two-high-value-streams-discarded-by-the-parsing-layer-from-raw-logs-mana-values--spell_cast_failed)._

## 27. `aurasActiveAt`'s slice(0,10) truncation can hide critical auras (hard CC pushed out by cosmetic auras)

_Archived to [BACKLOG-archive.md#27-aurasactiveats-slice010-truncation-can-hide-critical-auras-hard-cc-pushed-out-by-cosmetic-auras](BACKLOG-archive.md#27-aurasactiveats-slice010-truncation-can-hide-critical-auras-hard-cc-pushed-out-by-cosmetic-auras)._

## 28. `buildAuraIntervals` dual-close-event race fabricates phantom interval (logged 2026-08-14, root-caused by reviewer from #27 replay)

_Archived to [BACKLOG-archive.md#28-buildauraintervals-dual-close-event-race-fabricates-phantom-interval-logged-2026-08-14-root-caused-by-reviewer-from-27-replay](BACKLOG-archive.md#28-buildauraintervals-dual-close-event-race-fabricates-phantom-interval-logged-2026-08-14-root-caused-by-reviewer-from-27-replay)._

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

_Archived to [BACKLOG-archive.md#32-mana-pressures-oom-windows-are-not-scoped-to-the-reporting-round--cross-round-contamination-in-solo-shuffle-logged-2026-08-16-surfaced-by-26-task-7s-ab-batch-blocking-for-shipping-the-flag--fixed-2026-08-16](BACKLOG-archive.md#32-mana-pressures-oom-windows-are-not-scoped-to-the-reporting-round--cross-round-contamination-in-solo-shuffle-logged-2026-08-16-surfaced-by-26-task-7s-ab-batch-blocking-for-shipping-the-flag--fixed-2026-08-16)._

## 33. Mana attribution conditioned on healing-deficit avoidability (successor to #26's two unshipped candidates)

The meaningful signal per BACKLOG #26's user closeout criteria is **causal attribution of mana expenditure**, distinguishing spent-because-enemy-burst-forced vs. unforced-waste. Candidate types will be built from existing pipeline ingredients:

1. **(a) Whole-match healing mana allocation audit** (efficiency conditioned on pressure windows): expensive spells cast during enemy burst windows are CORRECT play, only unforced-window inefficiency counts as a mistake. Ingredients: `rawStreams` mana curves (all units from Task 1), `threatActiveAt`/`pressureWindows` predicates (team play analysis), opponent healer mana comparison (rawStreams covers both sides).

2. **(b) Per-window mana spend causality** ("a minute ago you dumped too much mana BECAUSE your team failed to avoid XX damage, or the healing deficit wasn't reduced via CC or pre-mitigation/immunity"): links mana-spend windows to damage-intake causes. Ingredients: `rawStreams` mana curves, `threatActiveAt`/`pressureWindows` predicates, **mitigation counterfactual** infrastructure (BACKLOG #17a/b, `computeMitigationAudit` / `computeMissedExternalCounterfactuals` / `computeUnusedSelfCounterfactuals`), **outgoing-CC-chain analysis** (spell rotation + cooldown ledger + `ccWindows` gate), **missed pre-mitigation** (existing predictors, upgradeable with counterfactual per-school attribution), **drinkingSegments** (enemy healer drink interruption windows from deep-dive subcommand).

**Architecture direction (user-ruled 2026-08-16, same-day refinement)**: the attribution engine is **deterministic fixed logic producing conclusion sentences** (divergence point of both healers' mana curves, forced-vs-unforced spend decomposition per pressure window, drink-opportunity ledger, efficiency measured on unforced windows only) — NOT a fact pack fed to the LLM. Rationale: exposing raw facts to the model invites noisy/false attribution (the "rich context bypasses candidate gates" failure class); the LLM only performs multi-angle attribution/back-inference at explicit deep-dive escalation (existing multi-round infra). **Exposure ruling: add NOTHING now — no UI, no candidate, no prompt lines — until the attribution engine exists and is validated; the exposure surface gets decided then.**

**Status(2026-09-05)**: **不做**(用户裁定「49 也不做」),GH #49 关;#26 那两条未上线的法力候选维持退役。

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

**2026-09-05 探针(用户要求「一个一个接线,测试并对 prompt 做 evaluation,看是帮助还是噪音」)**:先把六个函数的产出
整块接上 —— `buildMatchContext` 加默认关闭的 `criticalMomentsBlock` 开关,渲染成 `<critical_moments>` 块
(`formatCriticalMomentsBlock`,字段照引擎原样,不加形容词),`promptAblationProbe` 加 `augment` 模式
(基线 vs 基线+块)。agy,24 回合 / 96 次调用:结论集合 Jaccard 0.781,噪声底 0.804±0.177(z −0.6)—— **在噪声带里**;
加块后只出现在增强版、三次基线里都没有的结论 0.33 条/回合(cc-usage 2、peel 3、kill-window 1、healing-throughput 2,
无死亡类新结论);引用时刻 16.3→17.2、长度 +1.4%。读法:块里的事实(死亡、治疗真空、恐慌交防御、重叠)时间线
已经逐条有了,这套函数是第二套实现,模型拿到重复事实不改结论。整块为零 ⇒ 逐函数拆开不会出现整块没有的信号,
未再分函数跑。**结论:既不帮忙也不加噪,是冗余**;开关留作探针基础设施,默认关。删或留仍是用户裁决(#51)。
**Status(2026-09-05)**:用户裁定「不要了」,模块与其测试已删除,`DEATH_CC_LOOKBACK_S` 搬进唯一消费者 `candidates/death.ts`。GH #51 关。

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

### (f) 结构性:25 类候选没有一条量的是"打法本身" —— **不做(用户 2026-09-05)**

> 2026-09-05:按用户「可以加在 compare」先把四个维度(主动驱散/分、打断/分、施法/分、溢出占比)接到 compare 两侧并出了真实句子(`612aa96f`),
> 用户看后裁定:溢出不重要;驱散对阵不同专精不可比(研究本身也量过单局 ICC 0.41);打断没东西可做;整条不加。已回滚,#64 关。

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

**原语这一句要更正(2026-09-11)**:`aurasActiveAt`(`momentSnapshot.ts`)**不是**能用的那个
原语 —— 它只返回光环**名字**、截断到 10 条、不带 id、不带施法者、不分增益减益。
"目标身上有没有**我自己的**激流/愈合"只能走 `utils/auraIntervals.ts` 的 `buildAuraIntervals`
(`IAuraInterval` 带 `srcUnitName`);用它的判据必须知道一个坑:关闭事件按
`spellId:srcUnitId` 找不到时会**回退到同 spellId 的任意来源**(`auraIntervals.ts:212-223`),
两个人挂同一个 HoT 时会互相关闭。

三条断言的现状也要分开说:

- **激流** —— 现在就能测(`buildAuraIntervals` + 按 `srcUnitName` 过滤)。
- **迅捷治愈** —— 前提已经变了。`Verdant Infusion`(翡翠灌注)让迅捷治愈**不再消耗 HoT**,
  所以"别让回春术被吃掉"只对**没取这个天赋**的人成立;语料实测持有率
  Keeper 52–68% / Wildstalker 24–41%(`healer-study/corpus_rows.jsonl`,早赛季),
  即这条断言对大约一半的奶德不适用。要做就得先按天赋条件化。
- **接地图腾** —— 产品**已经**知道图腾吃掉了什么(`matchTimeline.ts` 的
  `groundingAbsorbNote` → `[ABSORBED: …]`)。真正缺的是**敌方读条区间**的可复用导出:
  同一条 START↔SUCCESS 配对规则今天在仓库里有三份各不相同的实现 ——
  `desktop/…/derive/castBars.ts`(渲染器,analysis 不能 import)、
  `utils/kickAudit.ts`(只产出每次踢的标签)、
  `utils/dispelAnalysis.ts` 的 `hardCastOccupancyWithin`(只产出窗口内占用总量)。
  **这才是 (h) 真正卡住的东西,不是光环。**

#### (h) 的分面调查(2026-09-12,800 场 S2 归档,用户要的是数据不是信号)

问的是「按下那一刻,目标身上有没有**我自己的** X」,五个专精各一个分面;技术分段按
**(赛制, ISO 周) 内百分位**(用户 08-29 裁定,不用绝对分)分上/中/下,再按英雄树 /
关键天赋切。调查用的是 python 流式的最小光环模型(APPLIED/REFRESH → REMOVED,按
(src, dst, spellId) 键,回合边界清空)—— **这是调查用的口径,任何产品谓词必须走
`buildAuraIntervals`**,不许把这个模型抄进产品。

| 分面                                      | 基准率     | 上 vs 下段                                                                                                                       | 结论                                                                                                                                                 |
| ----------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 奶萨 治疗波 → 目标带自己的激流(洪水 +15%) | **84–92%** | 单排 +3.8pp;2v2 +10.7;**Farseer 下段 94.3 > 上段 86.1(反向)**                                                                    | 人人都在做,没有教学空间;按树切开方向不一致                                                                                                           |
| 奶萨 治疗链 → 带激流                      | 41–56%     | 无单调模式                                                                                                                       | 平                                                                                                                                                   |
| 奶萨 治疗波 → 目标带自己的大地之盾        | 22–77%     | 单排 59.0 vs 51.8(+7.2,CI 刚不重叠);Totemic 池化 +13.2、Farseer +6.6;2v2 中段塌到 22% 不单调                                     | **最接近有梯度的一条**,但没过"≥2 赛制单调"门                                                                                                         |
| 奶德 迅捷治愈 → 目标带自己的愈合          | **28–42%** | 单排 下 42.0 > 上 34.8(反向);3v3 上 40.9 > 下 28.2                                                                               | **Lontar 的"几乎不对回春用迅捷治愈"被否定**:顶段最常见的组合是 **Lifebloom+Rejuv 18%**(没有愈合),带愈合的只有 ~35%                                   |
| 戒律 对敌苦修 → 敌人带自己的 SW:P         | ~70%       | 单排 87.7 → 75.0 → 71.9 看着漂亮 —— **顶段 154 次 100% 是 Voidweaver**,树内 Oracle 69.6/72.3、Voidweaver 85.5/91.7/87.7 **全平** | 教科书级辛普森(Value-Gate 第 5 条);树内零判别力                                                                                                      |
| 织雾 振魂 → 三增益齐全                    | —          | n=18                                                                                                                             | **未测到**:Vivify 116670 在 12.1 单排里几乎不出现在施法流(1,743 条裹身光环倒是都在),原因未查                                                         |
| 织雾 裹身 → 目标已带 ≥2 增益              | 41–75%     | 上 > 下 各赛制一致(+14 / +24),但下段 n=49 / 52,CI 宽到 ±14pp;Master of Harmony 中段 > 上段                                       | 方向对、样本薄,不单调                                                                                                                                |
| 奶骑 神圣震击 → 目标带自己的道标          | 33–60%     | 3v3 **上段 33.2 最低**                                                                                                           | **我的代理问错了**:道标会把别处的治疗转给道标目标,高手刻意治疗**非**道标目标以吃转移 —— 低比例可能是好打法。Lontar 说的是"道标在击杀目标上",不是这个 |

**结论**:按 `signal-value-probe` 第 6 步的门(每赛制 ≥3pp、≥2 赛制单调、CI 分离)
**没有一条通过**。这一维作为**指控信号**记负结果;Lontar 的两条断言分别是"人人都做"
(激流 ~88%,与 08-23 的迅捷→治疗波 88–90% 同形)与"顶端并不这么打"(迅捷治愈)。

**用户裁定(2026-09-12):不做,连参照事实的形态也不做 —— 「太 situational」。**
这一维"按下那一刻目标身上有没有我的 X"的每条断言都依赖当时的具体局面(谁在被打、
有没有 GCD 先上激流、道标为什么不在这个人身上),脱离局面的比例数字没有可教性。
(h) 至此关闭:原语缺口的分析保留在上面(`buildAuraIntervals` 与敌方读条区间),
但不再为它立任何候选或参照句。

工具:`scratchpad/probe9.py`(会话临时,逻辑如上;结论以本段为准)。

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

### #36 追加(2026-09-11,来自 Lontar 午夜 S2 七份治疗攻略的对照判读)

攻略当"提取器校准源"(即 (g))这一轮的产出。**攻略本身没有一条进产品**,它只负责指出
该去量什么;下面每条都是语料实测,前后数字在 commit message 里。

1. **(a) 的 `COPY_CAST_IDS` 把青翠之拥这一对写反了。**研究登记表写"360995 是回响副本,
   86% 与 361195 同刻",但"总是结伴出现"只识别出**这一对**,不回答**哪个是按键**。
   三个判据在 400 场 S2 归档上一致指向 360995 才是按键:独立出现率 0.9% vs 361195 的
   18.4%;360995 从不与自己相邻(0/802)而 361195 有 23 次;废灵遮罩(青翠之拥触发,
   用户 2026-08-18 裁定)86% 与 360995 同刻、只有 17% 与 361195 同刻。
   原来的写法**把真按键删掉、把副本留下**:600 场按回合切分后按键数 1269 → 1530(+20.6%),
   而且冷却台账从来没见过按键 id。已交换。
   ⚠ 同表的梦境吐息 355941 顺带复核:它**不是**同刻副本(配对率 0.8%,不是 86%),
   但结论不变 —— 它是 HoT/治疗分量 id(124 次施法 vs 13,778 次周期治疗,按键 355936
   带 375 条 `SPELL_EMPOWER_END`)。证据改对,条目保留。活化烈焰 / 孪生烈焰第二个 id
   的伴随对象我这轮测的不对,**未动**。
2. **`PASSIVE_SPELL_BLOCKLIST` 是英文名键,在非英文日志上整条失效。**三个消费者
   (冷却台账 / `[YOU][CAST]` / `extractRotations`)全部拿**本地化的**原始 `spellName` 比对。
   300 场实测:回收复用(415388)3,604 次施法里 **844 次(23.4%)记成 回收复用 / Rückgewinnung**
   全部漏网。已改 id 键(`PASSIVE_PROC_CAST_IDS` + `isPassiveProcCast`)并**登记进
   `curatedIdRegistry`** —— 它此前从未被反向腐烂扫描看见过,因为登记册只收 id 表。
   反向也测了:另外 7 个名字解析出的 id 在同 300 场里**零施法**,所以它们留在名字兜底层、
   不进 id 表(进去就是永远被 `curatedRotScan` 标红的零occurrence行)。
3. **`genTalentModifiers` 的宇宙不含 PvP 天赋池**,与 `genTalentMitigation`
   早就写明的"PvP talents are NOT in the node tree"是同一个缺口,只是那边补了、这边没补。
   补上后(pin 同一 build 12.1.0.69587,重跑基线与已提交文件**逐字节相同**作对照):
   tracked spells **360 → 402**,新增 **72 条**修正行 = 官方挖到 **70** 条 + 手工 2 条
   (守护天使改值、欧恩哈拉之召唤新增)。
   直接印证了攻略里几条说法:光环掌握 ← 神圣视野 −30 s、福音 ← 极致光辉 −45 s
   (**这条他没上屏,是官方数据替他补的证**)、Restoral ← 静心织魂 −30 s;
   也顺手拿到净化术 ← 净化虚弱 **−4(负值=加冷却)**、纯净术 ← 纯净 **+1 充能**。
   **落地前的方向自查**:新挖到的多数是**减**冷却,而减冷却正是"制造指控"的方向
   (台账会更早说"你有这个技能"),所以进治疗指控路径的三条逐条按持有天赋分组复核
   (700 场,回合内相邻间隔下限):光环掌握带神圣视野 **min 120.0 s**(96 对,
   52 对落在 120–130;不带的 n=3、min 168.3)对上 180−30−30(不屈精神);
   Restoral 带静心织魂 **min 120.0 s**;福音带极致光辉 **min 45.0 s**
   (432 对,227 对落在 40–50;不带的 p25 **90.0**)对上 90−45。
   三条的语料下限与模型值逐条吻合 —— 也就是说**改之前福音被台账多算了 45 秒冷却**。

   ⚠ 奶德的欧恩哈拉之召唤(+30 s 自然迅捷)**DB2 里没有**(萨满的同类 Call of Al'Akir 有),
   属服务端脚本 → 走 `CUSTOM_TALENT_MODIFIERS` 手工补,三条腿齐:A 级 tooltip 文本 +
   语料分裂(700 场按回合切分,按 pvpTalents 分组:**带**该天赋 75 人 186 个间隔,
   p05 63.1 s、p25 73.5 s、仅 **1.1%** 短于 60 s;**不带** 26 人 42 个间隔,
   p05 47.4 s、p25 56.3 s、**36%** 短于 60 s)+ 算术自洽(60 −15 季节变迁 = 45,
   下限实测 32–47 与梦之掌控再减 15 相符;+30 → 75,同样再减 15 → 60,实测 p05 63.1)。
   方向保守:模型偏长只会少说,不会凭空指控。

4. **守护天使是结果条件型冷却,而 `isConditional` 从来没被运行时读过。**台账一直按
   flat 120 s。600 场按回合切分(单排每回合重置冷却,跨回合间隔无意义)、1,166 次施放 →
   496 个回合内相邻间隔:**91.7% 短于 120 s**(台账说不可用的时刻他明明按下去了),
   但**只有 0.2% 短于 60 s**。已改成快档 60 s + 每次施放可覆盖的慢档(救到人 → 官方 180 s,
   判据 `guardianSpiritSaved`,48153 是日志里唯一的"救到了"证据)。
   慢档 n=2 测不了,保持官方 180 s —— 保守方向:偏长只会少说一条,偏短会凭空生成指控。
5. **驱散可行性门的两个错**(都在 `missed-cleanse` 的"他的净化转好了吗"上):
   连带驱散(净化虚弱 199427,250 场 484 条,`dispelKind` 早就判成 proc)被当成烧掉了
   8 s 净化冷却;纯净术的第二层充能不存在(813 对相邻纯净术里 **19% 间隔短于 8 s**)。
   已改:非 `deliberate` 的驱散不计冷却,充能与冷却都走生成的 DB2 修正表(不再手写)。
   顺带:攻略说"圣光闪现/圣光术会驱毒疫",语料里 **`SPELL_DISPEL` 一条都没有** —— 投机修法被数据毙掉。
6. **负结果:同队来源伤害不值得做过滤。**300 场 146 万条伤害事件里同队来源占 **2.01%**,
   其中 **88% 是牺牲祝福**(#40 有意路由到受害者,HP 口径本来就对);
   剩下的(虚空抽取 451963、战火淬炼 469704、灵魂链接)合计 **0.24%**。
   `incomingPressure` 不加来源过滤的判断维持原样。

#### 收尾复核(2026-09-11 同日,1,200 场)

- **70 条新挖的 PvP 修正批量体检:没有一条落在"制造指控"的方向。**判据是回合内相邻
  施法间隔的下限,它能证伪的只有"模型算长了"(有人按得比模型允许的更快);"模型算短了"
  只能靠"带天赋那组的下限恰好落在**没减免**的基础值上"来间接抓。样本够的 13 对里
  5 对精确复现(福音 n=669 下限 45.0 对模型 45;群体隐形术 120.0 对 120;集结呐喊
  60.0 对 60……),7 对被标"模型偏长"**全部是探针自身口径问题** —— 它只算了 PvP 那一条
  减免,没算玩家同时持有的树天赋(光环掌握 120.0 = 180−30 神圣视野−30 不屈精神;
  Restoral 120.0 = 180−30−30 振奋之魂;自然迅捷 p05 63.1 = 90−15 季节变迁−15 梦之掌控)。
  余下 1 对(净化术 ← 净化虚弱)是我判据的 bug:那是**加**冷却行,`p05 = 12.0` 正好等于
  模型的 12,属于完美复现。**若要把这个体检转正成常驻脚本,必须先把树天赋层算进模型**,
  否则每次都会报一堆假阳性。
- **`COPY_CAST_IDS` 里我上一轮没测对的两条,改用"把伴随对象统计出来"而不是猜,均确认原登记正确**
  (500 场,±0.3 s):`1265991 孪生烈焰` 367 次施法、**0% 独立**、99.7% 伴随**回响 364343**
  (不是裂解 —— 我上一轮拿裂解去配才得出 99.2% 独立的假象);`361509 活化烈焰` 292 次、
  3.1% 独立、**75.0% 伴随时序烈焰 431443**,与研究原文的 75% 完全对上。
  顺带:`360995` 在 ±0.3 s 窗口下显示 36.4% 独立、±1.0 s 下只有 0.8% —— 青翠之拥按下到
  落地差 0.3–1 s,**这正是研究当初用单一 ±0.3 s 判据会把按键读成副本的原因**。
- **守护之魂慢档样本从 2 涨到 5**(全 1,200 场):中位 **180.1**(对上官方 180),但 min 93.3
  仍矛盾。维持"慢档保留官方值"的保守实现,不改。
- **`curatedRotScan` 已跑**(对累计观测集):新登记的 `PASSIVE_PROC_CAST_IDS` **1 个 id、0 条腐烂**。
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

### #37 追加(2026-09-11):英雄树优先级高于 keystone 声明(用户裁定)

原先 `keystoneGates.json` 的声明**优先于**英雄树,而全仓只有戒律牧师一条声明 ——
于是七个治疗里**唯独戒律不按英雄树分层**,与 2026-08-23 的裁定直接冲突。
语料实证两棵树确实是两套打法(暗影愈合持有率 Oracle 72–79% vs Voidweaver 41–57%,
`healer-study/corpus_rows.jsonl`,早赛季)。

**已改(两侧同时,必须同口径)**:`perMatchRecord.combatToRecords`(语料侧)与
`desktop/src/main/compare.ts`(用户侧)都改成**英雄树优先、gate 兜底** ——
gate 只在英雄树解析不出来时才用(旧 build、COMBATANT_INFO 缺天赋)。
三条旧测试正好钉的就是兜底路径,原样通过;新增一条钉新优先级。

**读侧按语料实际持有的分组降级(同日补上,不再欠运维)**:候选按裁定顺序
`[英雄树, gate 分组]` 逐个去问**语料里真的有没有这个 spec 的可用 cell**,第一个有的就用,
都没有才落 `*`。于是新语料 → 英雄树;建于裁定之前的旧语料(戒律仍键 `offensive`/`standard`)
→ 保留 gate 分组,**不倒退**;用户机器上缓存的旧语料同理。两条测试钉住这两个方向。

**重建仍然要做,但它不再是 blocker,而且 feed 已经没了**:上游 2026-09-08 关停 match
search(`docs/DATA-COMPLIANCE.md`),`buildCorpus` 的 feed 路径现在是静默返回零 stub。
已给它加归档模式(`ARCHIVE_LEDGER` + `ARCHIVE_ROOT`,见 corpus-tools README 双语)。
实测(2026-09-11,63,309 场归档):

|           | 生产(feed,08-25)   | 归档 2300+   |
| --------- | ------------------ | ------------ |
| 可用 cell | 285                | 207          |
| 其中 3v3  | 17                 | **1**        |
| 治疗 cell | 104                | 67           |
| 戒律分组  | offensive/standard | **只有 `*`** |

即**按生产自己的门槛用归档重建是严格劣于现状的** —— 连要修的那件事(戒律按英雄树拆)
都拿不到。

**为什么拿不到,原因不是"样本绝对值小"**(这一点我先前的解释是错的):低内存估计器
(`est_cells.py`,只流式读 COMBATANT_INFO,不做完整解析)按 (赛制 × 专精 × 英雄树) 数
记录数,得到的是**每格上界**(真 key 还要再按 archetype 切一刀):

| 门槛                 | 戒律 Oracle                      | 戒律 Voidweaver  | 3v3 治疗覆盖                                                                      |
| -------------------- | -------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| 归档 2300+(1,118 场) | 单排 135 / 2v2 99                | 单排 31 / 2v2 27 | 几乎为空(最大 1)                                                                  |
| 归档 2100+(3,020 场) | 单排 361 / 2v2 273 / **3v3 125** | 单排 62 / 2v2 67 | **活的**(奶德 Keeper 331 / 神牧 191 / 奶骑 Lightsmith 181 / 奶龙 Flameshaper 122) |

2300 档的 Oracle 上界有 135,却仍拆不出 cell(真实原因见下面第 1、3 条)。
**2100 档在治疗维度上反而比现在的生产语料更厚**,尤其 3v3(生产现在总共只有 17 个
可用 3v3 cell)。

**这不是"拿代表性换覆盖"(用户 2026-09-12 纠正)**:本赛季 R1 也就 **2400** 封顶,
2300 往上基本排不到队 —— 所以 **2100+ 就是这条天梯的顶端**,原来的 2300 门槛采的是
一条几乎空的尾巴。归档里 2300+ 只有单排 518 / 3v3 50 / 2v2 550(共 63,309 场),
**这串数是天梯的事实,不是采集缺陷**。先前把它写成"代价",是我按往赛季的分数分布
想当然了。

### 门槛定为 2100(用户裁定 2026-09-11),但生产语料这一轮**没有替换**

裁定已记进 corpus-tools 双语 README。执行过程中抓到两个真 bug、推翻了我自己两次因果
判断,最后卡在机器内存上 —— 三件都记在这里,因为下一个人会原地重走。

**1. 聚合器按"有没有 gate 声明"选分支,而不是按"记录实际带什么分组"(已修 + 测试)。**
英雄树优先之后,戒律的记录带的是 `Oracle`/`Voidweaver`,而 `cellAggregator` 对**有声明的
专精**走 pair 规则去数 `offensive`/`standard` —— 数到 0 和 0,于是把整个 (spec,bracket)
打回 `*`。后果是:为了让戒律按英雄树拆而做的改动,反而让它**连原来的 gate 拆分也没了**,
而下游分辨不出这是"拆不动"还是"标签对不上"。现按记录实际携带的分组选分支;
gate-labelled 的记录仍走原 pair 规则,两条测试各钉一边。

**2. `validateCorpus` 对新形状有覆盖缺口(已修)。**它的 build-group 检查键在
"这个 spec 有没有声明"上,于是"有声明的专精 + 英雄树名 cell"两条检查全跳过 ——
名字拼错(`Oracle2`)也能验过。改成键在"**这个 cell 的分组是不是声明里那两个之一**"。

**3. 戒律在 2v2/3v3 拆不开,还有一个独立于 bug 的原因:样本不够。**修好聚合器重建后,
戒律在 2v2 的全部记录是 **122 条**、3v3 **83 条**;按英雄树一拆,Voidweaver 那格就在
`N_floor=30` 上下,而规则要求**每个**观察到的分组都过线,于是整档仍回落 `*`。
(我先前写的"archetype 再切一刀"和后来的"就是聚合器 bug"两个解释都不完整,以此为准。)
⚠ 同时暴露一件事:低内存估计器 `est_cells.py` 给的 Disc 2v2 = 340,builder 实际只有
**122** 条记录,差 2.8 倍 —— 估计器没有 builder 那层 `computeHealerMetrics` 的成功筛选,
**只能当上界用,不能当样本数引用**。

**4. 单排建出来了(600 场),语料已替换 —— 见本节末尾的「已落地」。**原文保留作为过程记录:2100 档单排每场产 ~18 条记录(2v2 是 2 条),
1200 场约 21,600 条;连同每场 ~30MB 日志的解析峰值,在本机被系统内存保护连杀四次
(1200 两次、600 两次,第二次起已按 README 带 `NODE_OPTIONS=--max-old-space-size=4096`),
期间机器上还有另外两个会话各占 ~4GB。按 OOM 纪律没有继续加码。
**没有拿薄单排去替换**:生产语料 285 个可用 cell 里 232 个是单排,用 300–600 场草草建的
单排替换,等于拿最强的那部分做交换。

**已建好的两个赛制(修复后的聚合器,留作下次直接合并的输入)**:3v3 620 场 → 137 cell
(52 可用,治疗 20,4 个按 build 拆;生产同赛制只有 17 可用、0 拆);
2v2 1200 场 → 125 cell(50 可用,治疗 30,6 拆;生产 36 可用、4 拆)。

#### 已落地(2026-09-12):生产语料已换成 2100 档归档版

机器空下来之后单排 **600 场**跑通(1200 与 900 各再被杀一次,上限落在 600–900 之间),
三份合并 → `502 cell / 301 可用 / floor 2100 / build 12.1.0.69587`,7.49 MB
(旧的 7.03 MB,+7%,仍是启动时读盘解析、不进 bundle)。

|           | 生产(2300,feed,08-25) | 已替换(2100,归档)     |
| --------- | --------------------- | --------------------- |
| 可用 cell | 285                   | **301**               |
| 单排      | **232**               | 199                   |
| 2v2       | 36                    | **50**                |
| 3v3       | 17                    | **52**                |
| 治疗 cell | 104                   | **114**               |
| 戒律分组  | offensive/standard    | **Oracle/Voidweaver** |

**唯一退步是单排 cell 数(232 → 199),但它的 cell 更厚**:样本中位 108 → **119**、
p25 **42 → 62**(旧语料四分之一的单排 cell 只是刚过 30 的门槛线)、治疗 cell 样本中位
126 → **136**。总样本 51.5k → 33.3k 是场数 600 vs 1200 的直接结果。
**不再追这 33 个 cell**:本机跑不动 1200,而要补满得改 builder 少攒记录
(`crisisEvents` 是内存大头),那是独立的一件事。

戒律终于按英雄树拆开了(这条裁定的目的):单排 `*×Oracle` n=446、`*×Voidweaver` n=94,
`hybrid×Oracle` n=206;2v2/3v3 记录太少仍是 `*`,读侧按 `corpusHasBuildGroup` 优雅降级
(实测 `戒律/3v3/Oracle → carried=false → hybrid×* n=54`)。

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
**同日后续(GH #63)**:用户问「这些技能是怎么挑的、有没有漏」→ 发现名单是手写目录 + 名字正则,对照 08-23
治疗研究 53 张救人牌漏了 23 张(治疗之潮、圣疗术、还阳术、朱鹤下凡、回溯……根本不在目录里),cd-hoarded 同样看不见。
用户裁「先把数据补上,再逐张调研力度与天赋强化」→ 名单改为官方数据 + 语料生成(`healerSaveCdGenerated.json`,
runbook 6b-pre-7):语料按键比例 ≥2% × 官方冷却 ≥30s × 官方画像能救人(伤害学派免疫才算免疫,控制解除类出局;
图腾类走已登记的团队治疗表)× **用户裁定的门**(`saveCdImpactScan.ts`:按下后 5 秒落到最低血队友的保护量 − 对照 ≥10pp,
或 10 秒阵亡率差 ≥5pp,n≥100)× 签字册 `save_role` / `not_save_role`。最终 7 专精 42 张。裁决记录:
30 秒核心治疗不进(雷霆焦茶、梦境吐息、圣言术:宁/洁、先祖迅捷);奶德自然迅捷、福音、光环掌握、牺牲祝福 6940、
还阳术、天神之道、知识古树签进;圣洁壁垒、神圣武器不进;宁静进。负结果:圣佑术 Δ+1、树皮术 +2、戒律渐隐 0、
狂暴回复 −2、奶德自然迅捷 +2(签进是裁决)。神圣赞美诗 / 神圣化身 = 靠治疗量救人的大招(用户纠正),留。
天赋拆分(`talents` 报告):英雄树解释大头(铁木树皮 Keeper Δ27 vs Wildstalker Δ12),单个天赋位移 5–15pp,
但与树/水平混杂,只作线索。名单进入台账后 [RES] 快照实例按渲染网格取整(≈60% 行 ±1s),门规硬失败 33→0(全是图例误报)。
名单对治疗专精是**权威**:目录/名字正则打的 Defensive 只在有证据时剥掉(`stripDefensive`:用户裁出、画像不合格的控制解除/机动、
n≥100 实测未过门),未实测的目录条目(真言术:障 n<100)保留。验收(605 文件同 manifest,基线干净树):治疗 cd-hoarded
1,082→1,118、cd-waste 234→318、death-setup dps 899→905 / 治疗 450→453(受害者台账变大 → defensive-early 前因变多),
`[CD PRIOR]` 0→231 行 / 166 回合(表重扫:299,722 次按键 / 17,419 场 / 141 格;树≠专精 ≥3pp 仅 3/88)。
**全量复核(2026-09-05,名单 v3)**:力度扫描跑满 18,134 文件 = 859,821 次按键(行文件超 Node 512MB 字符串上限,
report/talents/emit-table 改流式读)。三张先签的牌够样本了:还阳术 n=335 Δ+20.1 / 阵亡 7.8% vs 19.3%、天神之道 n=459 Δ+21.4,
两张自己过门;知识古树 n=1,232 Δ+9.7 差一线仍靠签字。光环掌握 Δ10.9 自己过门;牺牲祝福 9.3/4.9 仍靠签字;
壮胆酒 n=1,570 掉到门下(8.9/4.6),用户裁「进」签回。物品/种族在十倍数据下开始过门,加两条不用手写的规则排除:
被多个职业的治疗按过 = 物品(治疗石),已登记的 `racialAbilities.ts` = 种族(纳鲁的赐福、血性狂怒)。
名单 43 张(+圣疗术 633、+壮胆酒签字)。神圣之手(1242008):复仇十字军带该天赋 n=11,035 Δ14.7 vs 不带 n=480 Δ7.5,
坐实「免费瞬发圣光术」翻倍窗口内收益。参照表按 v3 重扫:286,082 次按键 / 17,382 场 / 132 格。
验收归因(三份两两相减):v3 vs HEAD 数据只动 cd-waste 318→341(壮胆酒回归 + 圣疗术 633);
attempt-into-trinket 1,860→1,848、burst-into-mitigation 120→136 是同日另一会话刷官方数据 69587 + 热修覆盖层所致,非本条。
**反向探针(2026-09-04,`promptAblationProbe` + `cdPriorAblationCueCheck`,agy,24 回合 / 96 次调用)**:删掉整类
`[CD PRIOR]` 行后,结论集合 Jaccard 0.780,噪声底 0.742±0.157 —— 在噪声带里;只看带行的 18 回合:0.794 vs 底 0.748。
窄问题「回答里点没点名那张被攥着的牌」:基线 36/54、删行后 13/18(67% vs 72%,无差);「引没引穿越那一秒」:
基线 15/54、删行后 3/18(28% vs 17%,n 太小)。**结论:测不出模型在用这行**;它点名的牌本来就在冷却台账里。
用户 2026-09-04 裁定**留**(「我觉得可以」);下次盲评卡片再看真人读不读。

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

_Archived to [BACKLOG-archive.md#39-getpriority-的分档是先验不看实际后果logged-2026-08-23用户拍板单独立项34b2-顺带发现](BACKLOG-archive.md#39-getpriority-的分档是先验不看实际后果logged-2026-08-23用户拍板单独立项34b2-顺带发现)._

## 40. 八类"从没读过的日志事件"逐条核对产品侧 + 五条已读进解析层(logged 2026-08-23)

_Archived to [BACKLOG-archive.md#40-八类从没读过的日志事件逐条核对产品侧--五条已读进解析层logged-2026-08-23](BACKLOG-archive.md#40-八类从没读过的日志事件逐条核对产品侧--五条已读进解析层logged-2026-08-23)._

## 41. 外部数据源借用清单:PvpMultiplier / hotfix / 踢技锁定官方化 / 数据刷新(logged 2026-09-04,用户裁决顺序 2→1→3→4)

来源:2026-09-03/04 对「有没有现成模拟器可借」的实测调研(TrinityCore master、SimulationCraft、
私服 playerbots、wago.tools)。结论:**没有可借的竞技场模拟器**(SimC 是 PvE 木桩且无治疗专精模型;
TrinityCore 行为层是逆向近似——DR 手写 switch 40 个 id、不认 PvPDurationIndex、英雄天赋 0 提及;
playerbots 全是 3.3.5),能借的是**数据与语义**。量化:语料观测 5,362 个 id 里 SimC 类模块引用 31.5%、
TrinityCore 15.7%;wago CSV 不含 hotfix(`hotfixes=` 参数被忽略,真言术盾 PvpMultiplier@69587 wago=1.0、
实时 1.15),SimC 生成数据带 134 条效果热修、38 条落在语料技能上、5 条落在手工表 id 上。
用户裁决(2026-09-04):PvP 值为官方值;踢技锁定官方优先、语料做校验门;顺序 2→1→3→4;只记 BACKLOG 不开 issue。

- (1) **生成器消费 `SpellEffect.PvpMultiplier`** —— 它是「PvP 战斗中」的乘区(交叉验证:致死之伤 −50 × 0.5 = −25%、
  圣疗术 100 × 0.75 = 75%、压迫咆哮 50 × 0.6 = 30% 已于 09-02 按此手算),但 genMitigation / genTalentMitigation /
  genAbilityEffects 都不乘,产品一直渲染 PvE 值。暴露面:生成层 39 条 aura87 里 6 条错(圣佑术 498 20→35、
  坚定防御者 31850 30→45、适者生存 264735 30→25、牺牲咆哮 53480 15→25、429642 5→3),手工覆盖 AMZ 145629 15→30、
  真言术:障 81782 20→40;语料 5,362 id 中 607 个带倍率,73 张手工表 464 id 中 63 个带。`MITIGATION_VERDICTS`
  里用户 08-17 签的 officialPct 是 PvE 值,随之改写(用户已裁)。消费方 12 处(counterfactual / killAttempts /
  killWindowTargetSelection / deathOutcomeAnalysis / candidateFindings…),验收 acceptanceCapture 前后对照。
  **2026-09-04 已做**:`scripts/datagen/lib/pvpMultiplier.ts` 一个谓词,三个生成器共用;69404 同 build 重生成——
  生成层 498 20→35 / 31850 30→45 / 264735 30→25,天赋层 31850 30→45、53480 15→25、429642 5→3、
  206967 浮空城意志 20→10、208154 战争印记 10→5、382020 大地祥和 3→5、**31821 光环掌握 9→21**(aura107 −9 × 2.34);
  手工覆盖 AMZ 15→30、真言术:障 20→40;签字表 5 条 officialPct 随裁决改写、档位不动。abilityEffects 的
  healingReceivedPct / hastePct 无变化(带倍率的受治疗行全是负值,本就不收)。
  **留给用户看的一条**:光环掌握 31821 手工覆盖是用户 08-22 裁的 20%,当时官方链路只能推到 12%(3 + 9);按 PvP 倍率
  官方链路现在推到 3 + 21 = 24%,与裁决值只差 4 个点——**2026-09-04 用户裁定「光环掌握是我错了 是24」,已改 24**
  (mitigationData 覆盖 + 签字表 officialPct + spellIdLists 注释)。
  **顺带发现**:`writeManifest.ts` 整体重写 manifest,会丢掉扫描脚本 emit-table 登记的条目(本次丢了
  syncWindowPrior / cdTriggerPrior 两条,已按 HEAD 版本合并回去;`datagenManifest.test.ts` 抓得到)。
  下次全量刷新(4)时要么把这两条登进 writeManifest,要么让它合并已有条目——另一会话正在改 cdTriggerPrior,先不动。
  验收(同 605 场,以 (2) 落地后的采集为基线):dps:burst-into-mitigation 120 → 136(+16),attempt-into-trinket
  dps 1860 → 1848 / healer 930 → 924(−18);其余逐类计数不变。机制只有一个:AMZ 15 → 30 跨过了 killAttempts /
  killWindowTargetSelection 的「≥20% 大减伤」集合,同时圣佑术 35 / AMZ 30 / 真言术:障 40 跨过 burst-into-mitigation
  的 30% 门槛——打进这些减伤的窗口从「打进饰品」改判为「打进减伤」。findings 哈希 29dd8677 → 2264e707。
- (2) **踢技锁定官方优先** —— DB2 `SpellMisc.PvPDurationIndex` 就是锁定时长,`spellEffectGenerated` 早已有
  Kick = 3;GH #62「DB2 无字段」的结论是错的。官方 vs 语料 p25 在 n ≥ 100 的 14 条全部 ≤ 0.45 s;法术反制众数 6
  对官方 5 是分箱伪影(p25 = 5.04)。**2026-09-04 已做**:谓词搬到 spellEffectData.ts(避免循环 import),
  `test/kickLockout.test.ts` 钉 |官方 − p25| ≤ 0.5 s。顺带发现:override 层整对象展开会吞掉生成层的
  `durationSeconds`(与 08-19 dispelType 被吞同类),踢技谓词改为字段级读取;`spellEffectData` 合并本身
  是否也该字段级恢复 duration,另议(会改动 ccFullDurationSeconds 对所有被 override id 的答案)。
  验收(S2 归档 every-30 = 605 场 / 1,270 回合,acceptanceCapture):逐类候选计数**全部不变**(kick-eaten 1030/507 等),
  只有上下文层动——`[kick]` 行 4,001 → 3,851(法术反制少 1 秒锁定,150 个 [RES] 刻不再显示残余锁定;
  改动行全是 Counterspell / Axe Toss),findings 哈希 a808fad9 → 29dd8677 来自 kick-eaten 的 lockout 事实 6 → 5。
- (3) **hotfix 叠加层** —— 新增 datagen 步骤拉 SimC `midnight` 分支的 sc_spell_data.inc,解析三张热修数组
  (field 27 = PvpMultiplier、10 = 系数、14 = 基础值)成 hotfixOverlayGenerated.json,生成器读 SpellEffect 行时叠加;
  manifest 记 hotfix 日期与哈希。依赖 (1)。
  **2026-09-04 已做**:`scripts/datagen/fetchSimcHotfixes.ts` + `lib/simcHotfix.ts`(解析三张热修数组、effect→spell 映射、
  字段号→列名实证映射并每次自校验:PvpMultiplier 20/22、EffectBasePointsF 61/73 与 69404 CSV 旧值相等,低于 50% 即失败),
  产出 `hotfixOverlayGenerated.json`(SimC midnight@ca042f5a,客户端 69587,热修 2026-09-02:123 条效果热修 / 77 个技能 /
  12 条 spell 标志位 / 3 条资源),四个读 SpellEffect 的生成器在派生前先 `applyHotfixOverlay`(120 次写入 / 111 行)。
  **实测效应:在 69404 上叠加后四张产物零变化**——当前热修里落在手工表上的 5 条全是吸收/治疗类技能的 PvP 倍率,
  而 abilityEffects 对它们只记布尔;aura87 减伤行没有被热修。机制就位,今天没有可见增量,价值在下一次 PvP 周调数。
  节奏写进 update-wow-data.md 3b:manifest 的 hotfixDate 晚于最近一次 PvP 调数公告就重跑 3b + 5/6g/6g2/6i/7。
  `writeManifest.ts` 同时改为保留前一版 manifest 里自己不认识的条目(emit-table 登记不再被整体重写丢掉)。
- (4) **数据刷新 69404 → 69587**(最新 retail 2026-09-01),按 update-wow-data.md 全流程 + §7b 三扫描。
  **2026-09-04 已做**:24 个 DB2 生成器(手册序 + 手册漏列的 manaCost / combatUnitEnums / specIcons 三个,已补进手册 6l–6n)
  - validateCatalogs 通过。实质变化:天赋减伤 205411 绝望本能 10→5、354489 转瞬即逝 25→20;DR 表 +1 致盲类
    (202274 Hot Trub);天赋图标补全;spellEffect 条目数 9613 不变。热修映射在同 build 上 PvpMultiplier 22/22、
    EffectBasePointsF 73/73、AP 系数 16/16 全对(69404 上的差异全是 build 差)。数据门测试 11 文件 77/77 绿
    (踢技校验门 / ccFullDuration / 签字漂移 / manifest)。§7b:curatedRotScan 66/1234 未观测(无新增)、drGapScan 55 条
    已知集合、ccLifetimeScan 仅混沌新星 / 虚空新星两条已裁 FLAG。**验收:同代码、刷新前 vs 刷新后 605 场,findings 与 context
    哈希完全相同,逐类计数零变化**——本次 build 差对现有 prompt 无影响。after1→after4 曾见 healer cd-hoarded 1082→1118、
    cd-waste 234→318,隔离对照证明那是 rebase 进来的 GH #63 名单效应,不是刷新。语料驱动的先验表(behaviorPrior /
    burstWindow / syncWindow / cdTriggerPrior / healerSaveCd / observedSpellIds)按赛季与谓词变化重跑,本次未动。
- (5) 文档纠错:update-wow-data.md「PvP modifiers not encoded in DB2」gotcha(09-04 已改)、predicate-index 两份登记。
- (6) **减伤叠加公式进 counterfactual.ts**(TrinityCore:不同光环乘法叠加、同 SpellGroup 取最高)——先数语料里
  「死亡窗口内 ≥2 层减伤同时在」的样本量再决定。排在 (1) 之后。
  **2026-09-04 探针已跑,结论:不建模。** `packages/eval/scripts/mitigationStackScan.ts`(与产品共用
  `whitelistedIntervalsInDeathWindow` 谓词,S2 归档每 30 场 = 605 场 / 1,270 回合 / 1,560 名玩家死亡):416 个死亡(26.7%)
  窗口内有百分比减伤在生效;**64 个(4.1% 的死亡、15.4% 的有减伤死亡)同一瞬间 ≥2 层**(≥3 层 10 个),重叠时长 p50 4.4 s。
  现有逐条独立反推 vs TrinityCore 乘法规则的差:**现模型低估**挡伤总量,占满血 min −6.43 pp / p10 −3.23 / p50 −0.49 /
  p90 −0.03;|Δ| ≥ 5 pp 只有 1 个死亡,≥ 15 pp(决定性档边际)0 个。最常见组合:天神下凡 + 防御姿态 33、防御姿态 +
  剑在人在 7、天神下凡 + 剑在人在 6、天神下凡 + 铁木树皮 6。三档结论不会因此翻转,叠加刻意继续不建模;探针留作
  常备脚本,赛季重跑同参数,数字变大再议。
  **2026-09-13 叠加规则实测(GH #95,为「给重了」判断):乘法。** `packages/eval/scripts/mitigationStackPairScan.ts`
  用战斗日志每下伤害自带的 `baseAmount`(减伤前伤害;解析层 compose 时把它连同高级尾巴一起裁掉了,脚本从原始行重解再按
  时间|来源|目标|技能|数值 回连)算每下「放行比例」,按同一目标同回合无减伤时的中位数归一。单技能校验与表一致
  (防御姿态 0.85、铁木 0.80、圣佑术 0.65、消散 0.25;天赋强化的树皮/不灭决心/痛苦压制实测更强)。**同一玩家身上**
  A 单独/B 单独/A+B 三组中位数,只取两边都有可测减伤的 51 组 311 人:乘法最接近 190 人、相加 70、取高 51;中位误差
  0.026/0.096/0.126。TrinityCore 规则在日志上成立;「同 SpellGroup 取最高」本次没有可测样本。
  同次顺带:暗影斗篷的物理减伤来自英雄天赋 Bait and Switch(457034,aura107 SpellModOp 23 −20,掩码覆盖斗篷
  第 3 条效果 aura87 物理 base 0)。斗篷期间物理伤害按天赋持有分组:有 0.813(n 367)/ 无 0.965(n 2,928)。
  `MITIGATION_OVERRIDES` 的 31224 只登记了法术免疫,持有者的 20% 物理减伤**未登记**(待裁:按天赋加 `pctPhysical` 类字段)。
  **✅ 2026-09-14 已由 GH #96 天赋整合解决**:减伤改为分量表示(`mitigationComponents.ts`),斗篷 = 法术免疫分量 + 物理 20% 天赋分量
  (`talentMitigationModifiers.ts`,全量新赛季 63,303 文件验证:点了的 0.800,区间 0.795–0.800,2,395 单元),开关 `talentMitigation` 已默认打开(84b5d748)。
- (7) 记账不做:SimC 类模块对照 genTalentModifiers(仅 DPS)、SimC APL 档案给 rotation-study 当词表、
  TrinityCore DR 表当缴械/击退第二意见。估值模型 V(s) / 策略模型 π_r(Maia-2 式)是另一条大线,未立项。
- (8) **「被控可用」表改读命名属性位(2026-09-04 用户裁决,已做)。** 借自 SimC `sc_spell_info.cpp` 的属性名表(全局序号 =
  属性组 × 32 + 位)与 TrinityCore `SharedDefines.h`:晕 = 163 ∪ 378,恐惧 = 177,混乱 = 178。08-14 穷举选出的 5#3 ∪ 10#13 里,
  10#13 是「遭遇战结束重置冷却」,把 213 个语料观测过的长 CD 误标成晕中可用(1028 场语料只有能量灌注 8 次晕中施放,其余 0);
  378 恰好就是 wowhead 那句「Allow While Stunned by Stun Mechanic」,自动覆盖手工缺口层全部三条。逼错搜索的是三个签字锚点
  (圣盾术 / 寒冰屏障 / 冰封之韧,只带 244 报错抑制位,晕中施放 1/0/0 次),用户改裁全部不可用。生成表 642 → 437(晕),新增
  恐惧 403 / 混乱 405;锚点门 29 格全部一致;被遗忘者的意志 7744 恐惧可用不走属性位,进 USABLE_WHILE_FEARED_GAP_IDS 手工层。
  **已裁(2026-09-04)**:真气转移 119996 基础技能本身带 378,但用户确认「真气转移本身的确不能晕里用 需要pvp天赋」——签字条件层
  为准,生成器继续把它扣在无条件集之外;命名位是证据不是裁决,与签字裁决冲突时以裁决为准。**未做**:恐惧 / 混乱两维的消费方接线(现在所有消费方对非晕硬控一律无条件豁免)——是新的指控面,先过价值门。
  验收:同代码、光环掌握 24% 采集为基线,605 场 / 1,270 回合:attempt-into-trinket dps 1848 → 2010、healer 924 → 1005(+243),
  burst-into-mitigation 136 → 131(−5),其余逐类不变;findings 哈希 86676417 → 1cacc8bb。机制:killWindowTargetSelection 的
  `STUN_USABLE_MIT_IDS`(减伤表 20–99% ∩ 晕中可用)从 17 条缩到 6 条——掉出去的是光环掌握 / 坚定防御者 / 冰封之韧 / AMZ /
  真言术:障 / 远古列王守卫 / 壮胆酒 / 剑在人在 / 黑暗 / 适者生存 / 黑曜鳞片,全是靠 10#13 长 CD 位混进来的;留下的 6 条
  (圣佑术 / 树皮术 / 痛苦压制 / 消散 / 不灭决心 / 狂怒回复)都带命名位。目标「手里握着晕中可按的墙」的门变窄 → 更多击杀窗口
  被算作 attempt → attempt-into-trinket 增加。**待办**:08-18 那次 8,791 次晕落地的门验证(握墙 0.8% vs 无墙 4.8% 转化)是用
  旧 17 条测的,要用新 6 条重测一遍。
  **重测已做(2026-09-04,`packages/eval/scripts/killTierValidationScan.ts`,常备脚本;同 605 场 / 18,447 次晕落地 Full/50%)**:
  新 6 条门 prime 4.4%(6,242)/ gated 1.0%(580)/ locked 1.8%(11,625);旧 17 条门 prime 4.8%(5,719)/ gated 0.6%(1,103)/
  locked 1.8%。三档排序不变,模型成立。**但要你裁的一点**:从 gated 挪到 prime 的 523 次落地只死了 1 次(0.2%)——剑在人在
  0/115、光环掌握 0/109、适者生存 0/102、黑暗 0/84、冰封之韧 0/64、壮胆酒 1/54、AMZ 0/35、黑曜鳞片 0/25。这些牌虽然晕里按
  不出,但「手里握着大墙」本身就是极强的不转化信号(晕 4–5 秒一过就交)。现门只认「晕中可按的墙」,是否改成「手里任何 20–99%
  大墙」?
  **已裁(2026-09-04「改吧」),已做**:`STUN_USABLE_MIT_IDS` → `WALL_IN_HAND_MIT_IDS`(减伤表 20–99% 全体,17 条),字段
  `stunMitReady` → `wallsInHand`,[kill-opportunity] / [KILL ATTEMPTS] / attempt-into-trinket 文案同步,PROMPT_VERSION 56。
  新门三档验证(同 605 场 / 18,447 次晕落地):prime 5.0%(5,458)/ gated 0.8%(1,364)/ locked 1.8%(11,625)——比命名位表那版(4.4 / 1.0 / 1.8)分得更开;新门 24 张牌,
  gated 里握牌的死亡率:树皮术 4/186、星界转移 2/131、铁木树皮 2/58、圣佑术 1/169、不灭决心 1/111、壮胆酒 1/54,其余 11 张 0。
  验收(基线 = 命名位表落地后的采集):attempt-into-trinket dps 2010 → 1798、healer 1005 → 899(−318;相对本批开始前的 1848/924 净 −75),burst-into-mitigation
  131 → 143,其余逐类不变。机制:握着任何大墙的目标回到 gated,不再被算作 prime 上的攻击尝试。
- (9) **SimC 枚举名表审计(2026-09-04,已做)。** 用 `data_enums.hh` 的 aura / effect 名表核对 datagen 手写的全部编号:
  87 = A_MOD_DAMAGE_PERCENT_TAKEN、69 = A_SCHOOL_ABSORB、118/259 = 受治疗、39/77 = 免疫、10/136 = 治疗、3 = 周期伤害等全部对上,
  **只有 aura 31 错标**:它是 A_MOD_INCREASE_SPEED(移动速度),项目一直叫 `hastePct`(消散 +50%、和风 +30% 其实都是移速);
  已改名 `moveSpeedPct`(生成器 / abilityProfile / 索引),无 prompt 消费方,是事实表纠错不是行为变化。
  用 `racial_spells.inc`(166 条官方种族技能,按种族掩码解码)核对 RACIAL_ABILITIES:语料观测到 59 条,表里缺 20 条;
  12 条有战斗效果的按官方效果事实定 kind 后补入(火箭弹幕 / 艾泽里特涌动 / 荆棘绽放 → offensive;食尸 / 纳鲁的赐福 ×3 /
  超有机光源 / 静思 → utility;滑翔 / 翱翔 / 根行 / 翼手龙俯冲 → mobility),8 条纯形态 / 坐骑切换刻意不收。
  验收:findings 哈希与逐类计数全部不变,只有 context 哈希变化(新收的进攻种族技能——火箭弹幕 / 艾泽里特涌动 / 荆棘绽放——按施放证据进台账行);
  [KILL 行零变化。

## 42. burst-into-mitigation 覆盖门槛 30% 是拍脑袋值,待定(logged 2026-09-14,GH #96)

用户 2026-09-14:「把这个 30% 的拍脑袋数据先留账,我现在不确定 35% 是不是一个更好的数字。」

背景:燃烧账本只要减伤和爆发重叠 ≥ 0.5 秒就记为「打进减伤」,真实例子里 20 秒的天神下凡 + 鲁莽被说成打进了只重叠 0.7 秒的树皮术。用户先定「30% 左右」,已按 `BURST_INTO_MITIGATION_MIN_COVERAGE = 0.3` 上线(随天赋减伤开关一起打开),**数值未验证,属于临时值**。

门槛前后数据(`burstMitigationOverlapProbe.ts`,天赋开关打开,S2 每 30 场,210 条候选;「掉血」= 目标在爆发期间血量下降的百分点中位数):

| 覆盖门槛      | 保留 | 保留组掉血 | 保留组阵亡 | 去掉 | 去掉组掉血 | 去掉组阵亡 |
| ------------- | ---- | ---------- | ---------- | ---- | ---------- | ---------- |
| 25%           | 164  | 11         | 14         | 46   | 18         | 2          |
| **30%(当前)** | 148  | 10         | 13         | 62   | 21         | 3          |
| 35%           | 132  | 8          | 11         | 78   | 18         | 5          |
| 40%           | 117  | 5          | 11         | 93   | 18         | 5          |
| 50%           | 72   | 2          | 8          | 138  | 17         | 8          |

待做:这张表只看目标掉血,没看「换目标是否更好」,也只是 1/30 样本。定值前可在全量上重跑同一探针,并按门槛分档抽真实例子让用户看。改值只动一个常量,但要 bump PROMPT_VERSION。

> 附:用户 2026-09-14 裁定「驱散自己基本帮不了什么的」——清洁术 / 纯净术等驱散自己在危机判定里**不算反应**(现状即如此,无代码改动)。

## 43. 危机里的自动触发(proc)要算进去,但话术和主动交不同(logged 2026-09-14,GH #96 M4/M6)

用户 2026-09-14:「自动 proc 和主动交的是有区别的。我觉得可以算进去,但是你的话术要变,比如说你自动 proc 了什么东西,那你就不用再交其他东西了。这个也留上。」

**和原设计的关系**:D4 原本定「自动触发不改变『玩家有没有反应』的判定」。这条是用户对 D4 的补充,不是推翻:触发**算进**这次危机的应对,但**不能说成玩家主动做了反应**。可用的说法是「你身上自动触发了 X,这一波不需要再交别的」;不可用的说法是「你交了 X」。

**候选(来自 M6 脚本型天赋分类,`reports/talent-integration-2026-09-13/scriptedTriage.md`)**:低血自动触发类——精确本能(生命值低于 40% 自动狂暴回复)、向善祷言(低于 25% 自动免费荣耀圣令)、最后一搏(受到致命伤害变恶魔形态)、梦境向导(低于 40% 自动愈合)等。

**待做**:

1. 语料里怎么认出「这是触发不是主动按」:触发往往没有对应的 SPELL_CAST_SUCCESS,或者是天赋专属的光环 id。逐个用日志核实,不要猜。
2. 危机判定里加一个独立的「proc 兜底」类别(和 `responses.protective` 并列,不并进去),`crisis-no-response` 遇到它时不指控;模型拿到的事实里要单独标出「自动触发」。
3. 话术只在呈现层区分;参照表要不要单列这一类,改的时候一起定。
   改共享谓词会连带重建参照表(全量约 4 小时)并 bump PROMPT_VERSION。

**2026-09-17 用户裁「可以做一下」,已落地(PROMPT_VERSION 73):**

1. 日志核实(`packages/eval/scripts/crisisProcMarkerProbe.ts`,1/40 全量 2,993 回合):**精确本能**触发时游戏给玩家挂内置冷却标记光环 382912(1,039 次全部自施、985 次在 ≤49% 血量),触发出的狂暴回复**几乎不记成施法**(1 秒内 25、3 秒内 92、没有 922)、只在治疗事件里带 22842 → 判定从治疗侧也扣掉它;**梦境向导** 1278914 不是标记(153 次只有 22 次自施、88 次在 ≥80% 血量,是发给别人的 buff)不登记;向善祷言 404357、最后一搏 209258 **没有任何可观测的兄弟 id**,按「不要猜」不登记。只登记精确本能一条。
   **第二轮(用户「好 可以 看看效果」,同日,PROMPT_VERSION 74)**:把全 3,491 条天赋里所有「自动保命 / 防致死」的兄弟 id 逐个过同一探针(自施 ≈100% + 触发瞬间低血;注意同秒 [STATE] 读到的是治疗后的血):**通过** → 抽血 454871(318/318 自施、317 ≤40%)、自然守护者 31616 治疗事件(771/771)、百战活力 441387(220/220,189 ≤50%)、金色瓦格里 393108(6/6);防致死 → 灸灼 87023(251/251、244 ≤40%)、装死 45182(25/25、23 在 0–9%)。**拒绝** → 驳斥命运(8 次 1 人且给队友也加)、炼狱(1)、最后一搏 209261(0)、历战老兵(0)、明志灵药(2)、钢铁漩涡(15 次只 2 次 ≤40%)。防致死单独一臂 `responses.cheatDeath`,话术是「X 替你挡了一次死」不是「不用再交别的」。
2. `crisisDecisionPoints` 新增 `responses.proc`(`CRISIS_PROC_ANSWERS`,已登记 curatedIdRegistry):窗口内标记光环挂上 = 应对了;触发出的施法在 ±1.5 s 内从玩家自己的按键里扣掉,不能再算 selfHeal / wall;它的治疗也不算 carriedHeal。`crisis-no-response` 因此不指控;`procNames` 给呈现层。
3. 参照表键加 `proc`,crisis-no-response 图例解释 `proc` / `carriedHeal` 两个 refTop 记号。行为参照表**已重扫**(2026-09-17 全量 85,604 个机会:没应对 2v2 3,255→2,883、3v3 1,781→1,652;3v3 ≥20% 档 top 出现 proc .25;carriedHeal 份额每格降 ~0.06——之前一大块「HoT 带过来的治疗」其实是精确本能的狂暴回复)。
4. `cd-hoarded`:用户 2026-09-17 裁「可以免,如果人没死的话」→ 已落地:危机点上有 proc / 防致死触发,且危机单位在 `CD_HOARD_RESPONSE_S`(5 s)内没死 → 不指控(trace `proc-answered-survived`);死了照旧指控。

## 44. 持续时间天赋:全量验证后仍没进表的 31 条(logged 2026-09-14,GH #96 M5)

来源:`durationTalentScan.ts` 在全量新赛季归档(63,303 个文件)上的结果,报告在 eval-private `reports/talent-integration-2026-09-13/full-2026-09-14/duration.txt`。进表的只有 5 条:百发百中 +2 秒、恶魔暴君 +5 秒、震荡波眩晕 +1 秒、铁木树皮 +4 秒,以及早已登记的集结呐喊 +3 秒。其余 31 条分四种情况:

**(a) 数字完全对得上,但点了天赋的样本不到 20 个(预先定的门槛)**——最可能进表,等数据:

| 天赋                 | 效果                | 点了的         | 没点的         |
| -------------------- | ------------------- | -------------- | -------------- |
| 强效升变 453729      | 消散 6 → 8 秒       | 12/12 在 8 秒  | 93 在 6 秒     |
| 虚渺斗篷 457022      | 暗影斗篷 5 → 7 秒   | 15/15 在 7 秒  | 590 在 5 秒    |
| 乌索尔的坚韧 393611  | 树皮术 12 → 14 秒   | 13/13 在 14 秒 | 6,831 在 12 秒 |
| 召唤黑眼契约 1279521 | 召唤黑眼 20 → 25 秒 | 11/11 在 25 秒 | 1,291 在 20 秒 |
| 亢奋之血 1259465     | 冲动 15 → 19 秒     | 8/8 在 19 秒   | 927 在 15 秒   |
| 愤怒锁链 389715      | 悲苦咒符 3 → 4 秒   | 3/3 在 4 秒    | 2,361 在 3 秒  |

**用户 2026-09-14:「这些是不是本来也没人用啊」——对。** 选取率(COMBATANT_INFO 全量天赋):强效升变 神牧 0.4% / 暗牧 11%;虚渺斗篷 刺杀 0.2% / 敏锐 6%;邪眼契约 痛苦 1.1%;亢奋之血 狂徒 0%(90 套);乌索尔的坚韧只有 4 套守护德、愤怒锁链只有 1 套复仇 DH。进表对产品输出几乎没有影响 → **维持 20 个门槛,优先级最低**。

问题:这批天赋本赛季点的人很少(恶魔猎手 / 奥术天赋是小众分支),20 个样本的门槛是预先定的,不能因为「数字对得上」就放行。**做法**:下个赛季数据刷新时重跑同一扫描;或者由用户裁定「点了的样本 100% 落在期望值、且没点的也 100% 落在基础值」时是否可以放宽样本门槛。

**(b) 缩短持续时间的天赋(9 条)**——按游戏行为规则第 7 条,用寿命数据永远不能证实缩短(光环提前消失可能是被驱散、死亡、取消),需要别的机制证据。包括:林域庇护(树皮术 −40%)、刺激弥散(致盲 −35%)、正义召唤 / 正义保护者(复仇之怒 −5 秒 / −26.7%)、青龙之心 / 流转之智(怒雷破 −50%)、天神之赐(白虎 −13 秒)、生死循环(割碎 −20%)。控制类(致盲)按用户裁决保持官方时长。**做法**:暂不处理;若要做,需找施法后的 SPELL_AURA_REMOVED 与冷却/资源回退的对应关系等机制证据。

**(c) DB2 数值为 0,效果写在服务器脚本里(5 条)**——旋荡星辰(超凡之盟 / 化身 / 知识古树)、侵蚀之影(暗影之舞)、法术火焰宝珠(燃烧)。燃烧实测点了的人落在 15.5 / 14.5 / 16.5 秒(不是固定加值,像是按事件延长),靠静态加值建不了模。**做法**:按 BACKLOG #43 同类思路,逐个看日志机制再决定;归入 M6 脚本型天赋队列。

**(d) 语料里看不到或判不了**——

- 施法 id 和光环 id 不一致、别名规则也没接上:黑暗(196718,长夜 +3 秒 / 黑暗遮蔽 +2 秒)、反魔法领域(同化 +2 秒)、升腾(飞升卓越 +3 秒)、第一支舞(暗影之舞)。黑暗的光环是 209426,施法者之外的人身上才有,别名规则按「施法者 300 毫秒内施加」没抓到。**做法**:给这几个补光环 id 映射(官方 SpellEffect 触发链或语料),再重跑。
- 冰霜新星(强化冰霜新星 +2 秒):点了的人 214 格里只有 67 格在 8 秒,其余提前断(定身被伤害打断)——这是控制类,寿命被打断污染,**做法**:改用「没有伤害打断的定身段」重测。
- 全量里点了的人为 0:苦痛之焰(灵魂献祭 +50%,没点的 5,924 格全在 5 秒)。割碎(生死循环)没有基础时长数据。

改表规则不变:任何一条进表都要满足预先定的门槛(≥ 20 个点了的样本、≥ 50% 落在期望值 ±0.5 秒、只接受延长),进表后跑验收并 bump PROMPT_VERSION。

## 45. 冷却天赋:官方减少值之外,真实冷却还更短的几个技能(logged 2026-09-14,GH #96 M6)

来源:M6 发现 `genTalentModifiers` 没读两种冷却编码——按法术类别改冷却(aura 341)和按法术标签改数值(aura 218 / 219),补上后新增 274 行冷却修正。`cooldownTalentScan.ts`(规则开跑前提交 5325c993)在全量新赛季 1/5(12,661 个文件)上验证新行,比较点了天赋 / 没点的玩家「两次施放之间最短间隔」:

- **成立(8 行)**:绝望祷言 −20 秒(天使之慈;点了的最快 70 秒,没点的最快 90 秒)、黑暗契约 −15 秒(契约供体;44 / 59.9 秒)、法术反制 −5 秒(慧心灵性)、寒冰墙 −30%、图腾之涌对陷地图腾 / 根基图腾 / 反击图腾 / 清毒图腾 −5 秒。
- **点了的人比「天赋后的冷却」还快**——官方这条减少是真的,但还有别的东西让冷却更短,产品现在的数字仍偏长(方向安全:只会少说「当时技能已经好了」,不会多说):

| 技能 ← 天赋                    | 官方基础 | 天赋后     | 点了的实测最快 | 违例格 / 点了的格          |
| ------------------------------ | -------- | ---------- | -------------- | -------------------------- |
| 猎杀 ← 永恒狩猎                | 90 秒    | 75 秒      | 58.5 秒        | 2,644 / 2,953              |
| 操控时间 ← 时间大师 / 扭转时光 | 60 秒    | 55 / 50 秒 | 40 秒          | 1,696 / 4,049、785 / 1,636 |
| 电能图腾 ← 图腾之涌            | 60 秒    | 55 秒      | 28.2 秒        | 917 / 4,645                |
| 自然之力 ← 早春                | 60 秒    | 45 秒      | 30 秒          | 1,658 / 1,940              |
| 振翼 / 甩尾 ← 沉重振翅 / 横扫  | 180 秒   | 60 秒      | 39.4 / 58.3 秒 | 18 / 422、1 / 20           |

**待做**:逐个找额外的冷却来源——候选是 PvP 天赋、按事件减冷却的脚本型天赋(比如电能图腾「每控到一个敌人缩短冷却」)、官方热修复没进覆盖层。找到后按同一扫描复验再补。猎杀基础 90 秒而实测几乎全员 60 秒左右,优先查它是不是基础值本身就错(赛季改动)。

**2026-09-15 查证(`recastGapHistogram.ts` 全量 1/10,`probeSpellCooldown.ts`)**:

- **猎杀(浩劫)是固定的 60 秒**:两次施放间隔的分布在 60 秒处有一道硬底(58 秒 1 次、60 秒 108 次、61 秒 366 次、62 秒 331 次……),不是随事件缩短。但官方数据里找不到来源:SpellCooldowns 类别冷却 90 秒;按类别(2427)、标签(16 / 66 / 292)、职业掩码能影响它冷却的只有永恒狩猎 −15 秒(另有一个非 PvP 物品 Stalker Sling −30 秒);无职业的 PvP 规则法术、热修复覆盖层里都没有。75 × 0.8 = 60 正好吻合「PvP 里冷却 −20%」这种服务器规则,但没有数据证明。**需要用户裁**:是否按语料补一个「猎杀 PvP 冷却 60 秒」的语料补丁(把冷却改短会让「当时技能已经好了」的判断变多,属于有风险的方向,按游戏行为规则没有机制证据时不自己改)。
- **操控时间(火法 / 冰法)、电能图腾、自然之力是动态缩短**:间隔从 30–40 秒一直均匀铺到基础值,没有硬底——是按事件缩短冷却的脚本型效果(比如电能图腾每控住一人缩短),静态表达不了。现状偏长、方向安全,**不处理**。

- **2026-09-17 用户裁「60 秒」,已落地**:`CORPUS_COOLDOWN_PATCHES`(spellEffectOverrides.ts,已登记 curatedIdRegistry)猎杀 370965 = 60 s、`talentsIncluded`,`applyCdTalentModifiers` 对这类 id 不再叠 DB2 天赋行(永恒狩猎 −15 会把 60 压成 45)。验证 `ledgerImpossibleCastProbe.ts`(1/20 全量,5,876 回合,988 个带猎杀的台账,1,401 个相邻施放间隔):台账说在冷却却放出来了的次数 **75 秒口径 1,196 / 90 秒口径 1,355 → 60 秒口径 0**,最短间隔 60.4 秒。
- **样本不够**:增辉唤魔的交织之线(「你的法术冷却 −10%」)几乎所有技能点了的人都是 0–13 个;咒符 / 月光束 / 风之疾步图腾等少于 20 个。等数据。

## 46. M6 脚本型天赋剩余项(logged 2026-09-15,GH #96)

M6 已做完的:1,190 个脚本型天赋分队列 → 118 个点名了产品追踪的技能 → 逐个看过(结论在设计文档「M6 review」);其中两种冷却编码漏读已修(d0b35723)、焦油缚链进 CC 时长表(dbb680f9)。剩下没做、也不自动做的:

1. **按事件缩短 / 重置冷却**(愤怒掌控、赤红渴望、和谐之声、伺机待发、冰冷渴望、烈日之光、电能图腾等):真实冷却比台账短,产品只会少说「技能已经好了」,方向安全。**不建模**,除非以后要做「技能其实早就好了」类提醒。
2. **按事件延长持续时间**(憎恨不息、焚烧殆尽、电容、破碎的命运等):静态值表达不了,**不建模**。
3. **凝神之怒**(混乱新星 / 虚空新星主目标 +1 秒):全量 1/3 没通过——点了的 1,093 格众数仍是 3 秒,只加主目标、和副目标混在一起。要测需按「主目标」拆光环,**待做**。
4. **驱散副作用**:正义保护(牺牲祝福移除中毒 / 疾病,选取率 46%)、紧急药膏(灵龟 / 假死移除中毒 / 疾病,14%)——查它们会不会让「漏驱散」判定误报,**待查**。
5. **自动触发保命天赋** → #43;**猎杀 60 秒硬底** → #45。

## 47. GH #95 队友危机:指控 + 叠加事实行(logged 2026-09-17)

用户 2026-09-17 裁决(推翻 codex R3 的「只做观察卡」):**做指控**(「我们基本上不做指控,这个东西可以做一下,价值挺高」)。已落地:治疗候选 `teammate-crisis-idle`(`analysis/teammateCrisis.ts` 共享判定 + `candidates/teammateCrisisIdle.ts`)、`[STACKED DEFENSIVES]` 上下文事实行、第 19 类硬失败 `checkTeammateCrisisRefConsistency`、PROMPT_VERSION 72、参照表 `teammateCrisisPriorGenerated.json`(全量 63,303 场扫描)。计时句按用户「可以严格一点,插件能看到开大」改成 `facts.burstCue`:对面开大在穿越前 ≥2 s 才算提示,绝不写「本可规避」。

**待做 / 待裁:**

1. **「治疗在救别人」(问题 4)**:用户要先看另一个队友当时危不危险。判定已记 `busyOn` / `busyOnInCrisis`,`teammateCrisisPriorScan.ts report` 分开数;全量数字出来后给用户看,再定要不要做成事实行 / 卡片。1/200 小样本:busy 4 个,对方在危机 0、不在 3、未知 1。**全量(116,063 回合,2026-09-17)**:在救别人 1,039 个 —— 那个人当时也在危机(≤40%)215 个,本队友 10 秒内阵亡 39(18%);那个人**不在**危机 305 个,阵亡 107(**35%**);施法没有友方目标 / 血量未知 519 个。即「救错人」时死的是「救对人」的两倍。**用户 2026-09-17 裁「我觉得可以」→ 候选 `teammate-crisis-triage` 已落地**(PROMPT_VERSION 76):总体收窄到「队友自己也没应对」(和 idle 卡同口径)后,3v3 只剩 36 / 14、单排 85 / 73(44% vs 21%);50 的样本门下只有单排渲染;参照格从已有全量扫描行直接算(`triageKindOf`),没重扫。放开「队友自己也没应对」的话 3v3 是 70 / 44 但对比反过来(31% vs 39%),所以不放。
2. **真实例子过价值门**:表落地后从 clean-idle 点抽 2–3 场渲染完整卡片(菜单行 + 时间线)给用户看,再决定要不要开 A/B(判官噪声底 |Δ|<0.4 测不出,采纳以确定性证据为准)。
3. **单排 / 2v2 参照格样本**:全量下 clean idle 预计 ~330 个,58/60 在 3v3;2v2、单排格大概率不过 50 的样本门 → 只有 3v3 会渲染,属预期,不要为了让它渲染而降门槛。
4. `teammateCrisisAnswerProbe.ts` / `teammateCrisisCards.ts` / `doubleDefensiveProbe.ts` 三个探针留作历史(它们内联了一份规则,和产品判定可能漂移);以后再量一律走 `teammateCrisisPriorScan.ts`。
5. **手读顺带抓到的共享谓词漏洞(2026-09-17 已修)**:`crisisDecisionPoints` 的「对面 8 秒内开过大」还在用自己从 classMetadata 拼的 34 条表,不是 2026-09-02 统一的 47 条 `OFFENSIVE_CD_SPELL_IDS`(索引说「三个消费者都读它」,漏了第四个)。改读正典后同一 1/60 切片(1,946 回合)危险点里 burst=yes:3v3 1,083→1,644 / 3,616、单排 1,720→2,508 / 5,637、2v2 488→787 / 2,257(`crisisBurstShareProbe.ts`)。**另一个发现待裁**:正典表经 `debuffs_offensive` 收了三条**没有冷却**的东西(虚弱诅咒 702、语言诅咒 1714、点燃 12654)——第一次重打卡片就渲染出「对面 6 秒前开了虚弱诅咒」;队友卡的 burst 事实已加官方冷却 ≥30 s 的门(`TEAMMATE_CRISIS_BURST_MIN_CD_S`),用户问「这是干嘛用的」→ 查证:正典表是三处消费者的「对面开了大」判据,其中敌方 CD 窗口构建器(`reconstructEnemyCDTimeline`)本来就再加一道官方冷却 30–360 s 的界,所以这三条从来开不出窗口;只有两个危机消费者(`enemyBurst`、队友卡)没这道界。处置(同日):把那道界抽成 `utils/enemyCDs.ts` → `isEnemyCdWindowSpell`,三处共用;正典表本身不动(它还给 `hasOffensiveSpellActive` 的光环证据用,那边看的是 buff 在不在,不是冷却)。
6. **回合末的卡(待裁清单 A2)→ 已裁 2026-09-19**:用户「如果已经有人死了 就不要提示;其他时候可以出」。`teammateCrisisPoints` 加 `priorDeath` 排除(任何一方已有玩家阵亡,最后判定;扫描行带 `priorDeathSide`,想收窄成只算己方不用重扫)。1/10 归档干净空闲 57 → 1(56 个在己方减员之后,55 个 3v3;敌方减员 260 个点里会出卡的 0 个);逐场核过三场,全是队友 2–6 秒前刚阵亡的 2v3。**后果:idle 卡在 3v3 过不了样本门,实际不再渲染**,用户看过数字确认照做;候选保持 live(样本够了自然出),不要为了让它渲染降门。**全量重扫(63,303 场,116,063 回合,PROMPT_VERSION 82)**:干净空闲 534 → 39 —— 3v3 490 → 1(被砍的 469 个在己方减员之后,敌方减员只 1 个)、单排 38 → 32、2v2 6 → 6;3v3 有应对对照组 86,959(阵亡 11%)→ 78,109(6%)。triage 卡单排格 85 / 73(44% vs 21%)→ 71 / 60(52% vs 23%),仍过门照出。行文件在 eval-private `teammate-crisis/2026-09-19-priorDeath/`。
7. **两条指控退役 2026-09-19(PROMPT_VERSION 83)**:用户追问「定义是不是有问题」→ codex astra 两轮辩论(引用的代码行逐条核过,全部属实)→ 用户「这个指控感觉有一点太难定义了,现在暂时也不做了吧」。idle + triage 共用新开关 `CANDIDATE_TYPE_FLAGS.teammateCrisis = false`;判定、纯函数、参照表、第 19 类门规都保留。codex 打中的:①triage 两臂都要求治疗没应对这个队友,差别只是另一个被治疗者的血量 —— 比的是局面不是决策,结果还只看这一个队友;②治疗被集火 45% 自疗、给 70% 队友驱散会进「救错人」,且只要求第一个被治疗者血量已知;③idle 的有应对对照组不要求「队友也没应对」(对称后单排 10% → 15%);④别的队友的 peel 算出来了但没进 `responded`;⑤可行性门只在 t 取距离 / 视线、被控只抽查 0/1/2/3 s、无蓝量读数算通过、不要求手上有救人技能;⑥`responded.wall` 只看窗口内按键,不看身上已有的减伤(用户最初的怀疑,现有扫描行没这个字段,占比未量)。现有行上的核对(单排,同口径):有应对 15% / 救错人 52%(71)/ 救对人 23%(60);按承伤档重加权后差距仍 ≈25pp,但竞争威胁 / 已有保护 / 存活时间都没控制。**用户口径:该不该救要把伤情和已有保护结合起来看**(现在没有这个判断)。**没做、待价值门**:triage 降级成不带阵亡对比的事实行;用户 09-13 要的「时机」形态(晚了几秒 / 提前交,`teammateTimingProbe.ts`)从未进产品,比「没管 / 管错人」好定义得多。`[STACKED DEFENSIVES]` 照旧。

## 48. 待裁清单 2026-09-18(logged 2026-09-18)

用户要一份可以慢慢看的裁决清单:`docs/rulings-pending-2026-09-18.md`(A 一句话:#42 覆盖门 / 队友卡回合末 / triage 只单排 / 关 #77 #89 #78 #80 #93 #95;B 定形状:#66 #67 #82 #79 #72 #73 #87 #88 #81;C 立项:#68 #69 #70 #83 #84–#86)。裁完写回对应 issue / BACKLOG 条目。

**2026-09-22 裁决(已写回 issue 与该文档):** A5 关 #93(已关);B8 #88 选项①已落地(`16338aeb` / `4db3c3e0`,已关)。同日不在清单里的裁决:GH #99 item 5 `[RES] rdy:Δ cd:—` 行 → **选项 1 只删零损失行**(`294b9c61`,#99 已关);GH #92 → 不等 API key,本地 CLI 量 output token(`1018f1bf`,已关);GH #91 第 3 步 → **「先通过了看看」**,随后 **「开着 做第二轮」**(见第 52 条,已关)。清单里仍待裁:A1–A4 余项、B 组除 #88、C 组。

## 49. 抬上限的四个杠杆(logged 2026-09-18,用户裁「先 backlog,暂时没能力做」)

2026-09-18 对话结论:逐条信号 + 语料参照 + 价值门这条路已近天花板(#94:多 18/20 条事实判断只好 3/20;价值门砍掉的比留下的多)。能抬上限的四个杠杆,按杠杆大小:

1. **数据层:从推断到事实。** 随游戏跑的插件(精确冷却 GetSpellCooldown、当前目标 / 焦点及切换、UNIT_SPELLCAST_SENT 的施法目标与取消、增益精确到期、不动手队友的坐标)+ 已有 OBS 录像做画面识别(名字板 / 谁在读条 / 镜头朝向 = 玩家看见了什么)。不涨覆盖率,涨每句话的可信度。插件拿不到:地面落点、按键时序、镜头。
2. **方法层:从规则到学出来的先验。** 116,063 回合 / 645,498 玩家视角 + 免费标签(10 秒内死、回合胜负)→ 状态 → 高手行为分布 / 死亡概率模型(Maia 式),替掉手写谓词,#68「另一条线」= 分布里概率最高的动作。风险:混杂、因果表述;先验档稳。memory「模型线 V/Q/π 未立项」即此。
3. **呈现层:对照高手。** 2100+ 参照语料已在手,同专精同时刻直接放一个顶级玩家的真实回合在旁边。不需要新谓词。
4. **产品形态:单场 → 长期。** 自学习骨架已有(库里少料),50 场里反复的同一失误比单场卡片值钱。

推荐顺序:2 为主,1 是燃料,3 是前菜。用户裁决:先记账,不立项。

## 50. 致死效果(减疗)强度建模(logged 2026-09-18,用户裁「backlog」)

来源:Skill Capped「破碎的 PvP 逻辑」一文——各专精的减疗强度不一样,文章给的数:武器战(锐利刀锋)/ 暗牧(灵能魔在场)50%,狂暴战屠宰场是最强的被动叠层,猎人 25%、恶魔术 20%、野德 16%。**这些数字是文章说法,未经 DB2 核对,不得直接进表**(Game-Behaviour Rule:DB2 行 + 掩码 + 语料三方证据)。

现状(2026-09-18 查):`packages/analysis/src` 里没有任何减疗建模——搜 mortal strike / healing reduction / Sharpened Blades / Slaughterhouse 全部 0 命中。也就是说 `healing-gap`、`crisis-no-response`、`[CD PRIOR]` 血线、死亡回顾全都把「治疗打在 50% 减疗目标上」和「治疗打在干净目标上」当一回事。

没做的原因 / 动手前必须先过的门:

- **价值门在前**(Value-Gate Rule 1、2):先手写目标结论句——例如「7:19 你的队友身上有 50% 减疗,这一段你的治疗量实际只有面板一半,所以这个血线该提前交墙」——拿一场真实对局出完整输出例子,批了再建引擎。形态大概率是**上下文事实**(`[STATE]` / 危机窗口旁的一个 `healing-reduced N%` 标注),不是指控。
- **可行性门**:减疗在身上时玩家能做什么?(驱散不掉的物理减疗 vs 能杀掉的灵能魔,见 #51)答不出「当时做得到什么」就不要做成候选。
- **数据路径**:减疗光环 id 清单必须从 DB2(Mod Healing Taken % 的 aura 类型)生成 + `observedSpellIdsGenerated.json` 双向核对,并登记进 `curatedIdRegistry.ts`;叠层的(屠宰场)要读层数。PvpMultiplier 要乘(memory:gladlog-pvp-multiplier-semantics)。

## 51. 非玩家单位的理解:灵能魔 / 图腾 / 其他召唤物(logged 2026-09-18,用户裁「backlog,如果能看到的话」)

**2026-09-20 探针结果(GH #100 方向 4,详见 docs/log-observability-audit.zh-CN.md):**
(1) 出生: SPELL_SUMMON 稳定出现,dest GUID 第 6 段即 npcId;600 场切片 116 种 npcId。
(2) 存活期: 12.x 日志不发 UNIT_DESTROYED,表内被召唤的 13,439 个单位只有 5 个有 UNIT_DIED(全是雪怒);唯一击杀证据是 overkill>0 的伤害事件(886 个表内单位);PARTY_KILL 是其严格子集(134/134 同毫秒)。没被 overkill 的召唤物结局未知,不能当存活。
(3) 有人在打它吗: 可见。被敌方玩家打过的比例: 灵能魔 60%、灵魂链接 44%、根基 27%、战栗 20%、地缚 19%;被打死: 灵能魔 48%、灵魂链接 36%、根基 27%、战栗 20%、地缚 15%。
(5 条里的第 4、5 问未做。)
现状更正: 原文写的 Psyfiend 121111 是过期 id(600 场 0 次),现行 101398,已于 2026-09-20 更正;[UNIT DESTROYED] 此前在 12.x 上实际是死的(605 场验收集 24 行、图腾 0 行),改读 nonPlayerUnitKill 后 3,076 行(用户 2026-09-20 裁决:修,根基图腾也显示)。
以及一条新事实: 战栗图腾自身不产生任何日志事件;「恐惧期间放下战栗 → 恐惧同一瞬间移除」是确定性签名(300 场:延迟 p50 0 秒、p90 0.02 秒、49/50 在 1.5 秒内),「战栗先已在场」只能看到恐惧变短(p50 0.65 秒 对 1.77 秒),与伤害打断无法区分。用户 2026-09-20:先把事实弄明白,加不加上下文行之后定(大概率加)。

**2026-09-20 晚,用户裁「可以偶尔指控;不指控但战栗、根基也可以打,看情况」,事实层已上线(PROMPT_VERSION 86):** [ENEMY SUMMON] 事实行——敌方灵能魔 / 灵魂链接图腾没被打死时写「0 hits from your team」或「hit N× by …」,不写存活时长(日志无消失事件),不指控;605 场验收 0 → 406 行。战栗「看情况」= 只在它起作用时说:[CC ON ENEMY] 行上的「enemy Tremor Totem from N ended this CC」镜像注记,124 条。根基吃掉技能沿用既有 [absorbed: Grounding Totem]。**未做:指控型候选**(灵能魔放出来、够得着、没被控、却没人打)——按 signal-value-probe 流程先出目标句和真实例子,需要可达性与「当时有没有更该打的目标」两道门,灵能魔持续时间必须读官方 DB2 而非手写。

来源同 #50:「竞技场里最危险的目标有时不是玩家而是一个 NPC」——暗牧灵能魔活着 = 全场最强减疗,该杀。

现状(2026-09-18 查):

- `timelineHelpers.ts` 的 `CRITICAL_NON_PLAYER_NPC_NAMES` 手工登记了 27 个 npcId(萨满图腾 13、牧师 6 含 Psyfiend 121111、武僧 1、术士 6、DK 1)——猎人 / 德鲁伊 / 法师等的召唤物一个没有。
- **唯一消费点**是 `matchTimeline.ts` 的 `[UNIT DESTROYED]` 行:关键 NPC 死了才出一行(带前 10 秒伤害来源)。**没死的 NPC 在 prompt 里完全不存在**——「灵能魔放出来、活满全程、没人打」恰好是文章说的那种失误,我们现在看不见。
- 该表是手工 id 表但**没按 npcId 口径做过完整性 / 腐烂核对**(Curated-List Completeness Rule;`observedSpellIdsGenerated.json` 是法术 id,不覆盖 npcId——需要一份观测 npcId 清单)。

「能不能看到」要先回答的问题(探针,先于任何设计):

1. **出生**:`SPELL_SUMMON` 是否对这些单位稳定出现(dest GUID 里带 npcId)?图腾 / 灵能魔 / 守护者类各抽样确认。
2. **存活期**:没有 `UNIT_DIED` 时能否用召唤技能的官方时长推断消失时刻?(图腾被踩掉 vs 到期 vs 被换掉)
3. **它做了什么**:NPC 作为 source 的伤害 / 光环事件有没有(灵能魔的减疗光环来源 GUID 是谁?),玩家对它的伤害有没有(= 有人在打它吗)。
4. **位置**:NPC 作 source/dest 时高级日志参数给不给坐标——决定能不能回答「够不够得到」(可行性门:近战被定身时够不到图腾,参照 #24 定身可达性的做法)。
5. **宠物伤害口径**:游戏计分板不算对宠物 / NPC 的伤害,我们的伤害统计算不算、和计分板差多少——用户拿两边对账时会问。

探针之后的候选形态(都要先过价值门,先出真实对局例子):上下文事实 `[ENEMY UNIT] Psyfiend up 0:42–0:54, 0 damage taken`;「关键 NPC 活满全程且无人攻击」的指控型候选要带可达性 + 当时是否有更该打的目标(对方开大 / 己方危机)两道可行性门。和 #50 的关系:灵能魔是 #50 里唯一**能被玩家动作消除**的减疗来源,两条一起设计。

**2026-09-22 补充(用户要求「把召唤物之类的更多信息融进来」,GH #86 已记):** 存活期那一问缺的「预期存活时长」现在有来源了——M6 inventory 解析的按 SpellLabel 的时长修正里有一批正是召唤物的:卑微暗影 +20%(暗影魔 / 心灵之愚 / 虚空幽魂 / 偶像,暗影魔与彼岸之物已登记)、丰饶绽放 +4 s(自然之力树人)、稳定传送门 +3 s(魔典宠物)、暴君统治 +5 s(恶魔暴君)、强化邪能风暴 +4 s、图腾专注 +3 s(治疗之泉 / 战栗 / 风行 / 净毒图腾)与 +10 s(地缚 / 根基)。有了预期时长,「没被 overkill 的召唤物结局未知」变成「超过预期终点后无事件」这种有界陈述。形状 1 的名册行 = 主人 GUID / 召唤 id / 出生 t / 预期时长(DB2 + 天赋)/ 被打时的 HP 轨迹 / 结束 t 与结束类型(UNIT_DIED / overkill / 主人死亡 / 超预期未观测)。**用户 2026-09-22 裁范围**:大多数召唤物直接 fold 进主人的伤害 / 控制(GUID 归因已经在做),不要通用名册;只记**功能性或大影响**的:功能性图腾(根基、战栗)和带致死 / 控制的召唤物;术士宝宝按功能说(驱散 / 诱惑 / 恐惧 / 晕眩),不当单位记;最重要的是暗牧的暗影魔——**什么时候被击杀**(卑微暗影 ×1.2 = 6 s 预期)。合格清单是手工表 → 登记 curatedIdRegistry,按 §51 的 116 个观测 npcId 查完整性。

**2026-09-22 晚落地(PROMPT_VERSION 97)**:`summonExampleGen.ts` 在 634 场 / 1,144 回合上把候选行渲染出来给用户看(暗影魔 294 次召唤只被杀 4 次、被打没死 81%;根基 1,211 次被杀 394;术士宝宝 418 回合识别 408)。用户两条措辞裁决:**不写「预期」时长**(日志没有消失事件,不确定就只写站了多久、何时被杀);**术士宝宝有功能的全列**,不管语料见没见过。上线的只有两个事实、零新行:(A)每条 `[UNIT DESTROYED]` 末尾 `, N s after it was summoned`(`summonLifetimeAtKillS`);(C)阵容行术士带 `[pet: Felhunter — Spell Lock (kick), Devour Magic (purge)]`(`warlockPetFunction`,表 `data/warlockPets.ts`,npcId 半边靠 `npcRosterScan` 查腐烂、施法半边进 registry)。**明确不做**:暗影魔 / 心灵之愚的「被打没死」行(6 秒宠物 81% 命中率 = 噪声),治疗之潮 / 治疗之泉 / 地缚 / 黑暗之眼 / 地狱火的未击杀行(「没人碰」是多数)。副发现:被杀时间超过 DB2 时长的图腾只在图腾专注持有者身上出现(地缚 32/168 对 0/13),是 #65 label 修正在召唤法术上的腿 (c),登记前要用图腾最后一次自身事件量寿命。

## 52. 外置减伤期间输出事实 `[ENEMY DEF] | during it:`(logged 2026-09-22,GH #91,已关)

规则 171 / `burst-into-mitigation` 的持续版:对方吃到盟友外置减伤的那段时间里,落地前 3 秒内打过接收者的每个友方各做了什么。**形态是事实行,不指控**;用户价值门 2026-09-22「先通过了看看」,随后「开着 做第二轮」。

- **谁拥有事实**:`[ENEMY DEF]` 外置行(#99 item 3 归属规则),每个合格友方一段 `2(FDruid) 271k on target · 86% of their enemy-player damage · direct 130k / periodic 141k · damage in 8 of 8 s · longest gap 0 s`;`burst-into-mitigation` 只在 owner / 目标 / 那次光环区间三者重合时带 `facts.duringExternal`(82 份 DPS 视角里 1 条)。共享谓词 `utils/externalDamage.ts`,第 28 类门规 `checkDuringExternalConsistency`,开关 `TIMELINE_LINE_FLAGS.duringExternal`(维持 `"annotate"`)。
- **契约两次修订都先写 issue**:① absorbed 从受害者键 `absorbsIn` 单独报 `(+Ak absorbed)`,否则 Karma / 护盾下渲染成 `0k on target · damage in 6 of 8 s`;② 第二轮加免疫(`N hits immune`)、Life Cocoon(`EXTERNAL_DAMAGE_SHIELD_IDS`,已登记)、限学派墙(`Nk (P%) of it in the wall's school`,AMZ 实际从不落到单位身上,字段为 0)。仍排除:Guardian Spirit、Blessing of Sacrifice、Rallying Cry、Zephyr、Darkness。
- **验收**(S2 every-30,1,270 回合):外置行 5,455 不变,获标注 1,397(第一轮)→ 2,103(第二轮);去掉追加段与对照逐字节同;候选计数全同。
- **消费**(Opus 5,16 局 DPS 视角,48 次调用):结论集合 Jaccard 0.861 vs 噪声底 0.834±0.138(z +0.6)—— 判决不动;2/16 基线回答逐字引用标注数字、消融臂 0/16。改的是解释,不是判决。工具:`promptAblationProbe.ts --owner dps --require`、键 `[ENEMY DEF:during-it]`、`ablationVocabJoin.ts`。
- **伪影记录**:本机库 store 没有 `missesOut` / `absorbsIn`,免疫 / 吸收只能在归档日志上量。
- 通用主目标时间线仍挂 GH #85 不做。

## 53. 按 SpellLabel 的天赋修正从没接到时长表(logged 2026-09-22,GH #65 / #96 / #101 / #102)

起因是用户一句「你是不是没读天赋说明」:大地生命武器 9 s 那条 09-07 语料补丁写着「没有天赋能解释」,而天赋说明一行就写着「灌魔精通:你的大地生命效果的持续时间延长 3 秒」。这条修正是按 **SpellLabel** 定目标的(aura 219),09-13 目录的 `modsRaw` 只解析按职业掩码的 107/108,所以「没有天赋」只在半个 DB2 里查过;M6(09-14)的 `talentEffectInventoryGenerated.json` 其实早就把两种编码都解析了——**54 条 label 时长修正(47 条目标已解析)八天没有任何消费者**,冷却那 25 条被 genTalentModifiers 吃了,时长这边谁也没接。

- **代价实测**:09-07 的 20 条「无天赋」补丁里 7 条是 label 天赋修正,算术严丝合缝(大地生命 6+3、彼岸之物 20×1.2、处决者 12+6、显现恶魔之魂 9+5、阿古斯支配 10+4、月光射线 8.5+3、狂风 8+2);当天上午我又用同一错误形状打了暗影魔 5→6(卑微暗影 ×1.2)。
- **修法(已落地 `218b0739` / `a5d8f1b9`)**:`durationCandidatesFromInventory.ts` 把 inventory 全部时长修正(掩码 + label,427 对)喂给 `durationTalentScan --candidates`(基值改读 DB2 原值——规则 5;减短带机制单独判定「REDUCTION-CONFIRMED」);`buffDurationScan` 加 PATCH 段(补丁表也复测)、GAP 行打提名门、`--detail` 按专精 × 月份 × 级数拆分。结果 13 晋升 + 18 减短确认 → 天赋时长表 33 → 60 条,3 条平补丁删除、2 条留作典型值。验收:findings prompt 3,520 视角逐字节不变,`[BUFF FADED]` 动 208/14,392 行(207 条冰霜屏障 ended early → expired)。规则写进 CLAUDE.md Game-Behaviour Rule 第 2 条:腿 (a)+(b) 从 inventory 读,两种编码都要,不用目录的 `modsRaw`。
- **验收工具的一个坑**:`acceptanceCapture` 的 findings 哈希同一份代码隔两小时两次跑不一样(语料文件没变,原因没查到),同一时段的前后对照内部一致。改用 `findingsDeltaProbe.ts --dump` 在改前 checkout 与当前树各 dump 一份逐视角比对,这是更严的判据。
- **挂起 / 待做**:
  - GH #101:目录 `modsRaw` 补 218/219(纯工程,验收 = gapAudit 时长 / 冷却缺口数前后)。
  - GH #102:tiered 节点(maxRanks 4)的级数读取——狂暴 24 s ×20 = 狂暴狂战士 12×2、阿古斯支配 +4 s;先确认 `talentRankOf` 读不读 tier。
  - #65 第 1 项扩围:连击点缩放的 DoT(撕裂 / 割裂 / 毒伤,DB2 4 s 是 0 点基值)与灌注缩放同形——**用户 2026-09-22 裁「以后一起做,并到一起」**,第 1 项 = 「时长由施放参数决定」一种形状,两类一起设计,现在不动。
  - 机制已知但本切片 0–3 格、下赛季重扫:阿古斯支配 ×2 ← 阿古斯支配、月光射线 ← 永恒之月、治疗之泉 / 风暴之泉 ← 图腾专注(+3 只到 18,观测 21.5,还差一个因子)、献祭光环 ← 极痛烈焰(9 ≠ 10,且持有者读到 0)、强化锁喉 ← 潜行 +3(9 ≠ 12)。
  - **2026-09-23 第 1 项收口(施放参数定时长)**:`CAST_PARAM_DURATIONS` + 共享谓词 `castParamAt`(灌注等级读 `SPELL_EMPOWER_END`,连击点读终结技那一刻的高级日志块),`buffFullDurationForCaster(…, atMs)` 以公式为基础值再叠天赋层;撕裂 / 割裂 4×(点+1)、毒伤 1×点、梦境吐息 20−4×级、火焰吐息 30−6×级。百分比修正改为相乘(撕裂 24×0.8×1.25=24 实测)。复现率改前→改后:撕裂 13→632/823、梦境吐息 10→899/1,330、割裂 42→776/1,569、毒伤 3→994/1,029、火焰吐息 63→638/1,442;没复现的几乎全是「比预测短」(提前结束)。产品输出逐字节不变(605 场):这些光环目前只进光环区间封顶,而**大多数 `buildAuraIntervals` 调用方不传施法者**(09-06 起的既有缺口),挂账。仍开:火焰吐息 L1 的 28 s 档(+4,两种编码都没有修正)。
  - **2026-09-23 按施加者收口(`730f00e1`)**:#65 第 2 项(射击优胜劣汰 3 s = 烟幕让意气风发触发的第二份,施放那份全专精 8 s)、第 3 项(暗影之刃手工 20 → DB2 16)、第 5 项的强化射击(乱射施加,继承乱射 6 s)、§51 治疗之泉(15 / 图腾专注 18 / 再加辅助灌魔 21.5,后者 +3.5 为语料值)全部落地;工具 `auraProducerScan.ts`、`totemLifetimeScan.ts`。#65 只剩第 1 项。
  - 状态条件的修正没有表形状:天平倾斜 / 燃烧肾上腺素(whileAura)、玉龙 / 赤鹤在场时包裹之雾 +4 s(登记后残差 11 s ×5);恶魔皮肤 −15001 ms(= 无时长)不登记。

## 54. 判官 5.0 vs 5.5 全量盲裁 + 回答错误的根因账(logged 2026-09-23,GH #103,#90 后续,用户裁「先记账」)

起因:Opus 5.5 出了,用户裁「5.5 优于 5 就全切,80 次分不出或更差就报告」。Stage 1(80 次 `claude -p` 测试-重测,baseline 001–020 × 两模型 × 两遍)预注册判定**无差别**(accuracy 重测 SD 0.64 vs 0.69,七维 Σ|Δ| 同为 1.35)。用户要求「配合 codex 深入调查」→ codex R1 辩论(PARTIAL)定下决定性测量:20 份回答的全部 470 句(400 规定审计句 + 70 句越规审计句)双盲裁决,codex + Fable 5.1 两位裁判、分歧由新会话裁。**codex 额度两次耗尽,用户 2026-09-23 裁暂停,充值后用 codex 做完剩下的,再修 bug。** 接续手册:`$GLADLOG_EVAL_HOME/runs/2026-09-23-judge-opus-compare/adjudication/RESUME.md`(预注册 `../PREREGISTRATION.md`)。

- **2026-09-23 做完(用户充值 codex 后)**:codex 470/470 + Fable 470/470,60 条分歧新 codex 会话裁(41 从 codex / 17 从 Fable)。**预注册判定两种口径都 NOT MET → 报用户,未切换**:全部错误召回 8.5% vs 17.0%(Δ 8.5 pp,CI [−1.1, 16.3]);仅事实 9.6% vs 21.2%(Δ 11.5 pp,CI [2.3, 22.5]),只差误报(5.5 1.5 条/20 份,门槛 ≤1)。3 条误报里 1 条是我的句子锚定 bug(修后仅事实恰好 MET,属预注册后敏感性)、1 条是裁判会话错(DB2 Grounding 3 s,5.5 其实对)、1 条两可。两判官召回都 ≤23%。数字见 GH #103 评论、eval-private 0b768536。
- **中期数字(codex 单裁,001–015,不是判定)**:两判官召回都很低——全部错误 5.0 8.3% / 5.5 14.6%,仅事实错误 6.5% / 16.1%(Δ 9.7 pp,CI [1.7, 19.4],门槛 10 pp);误报 0 vs 1 /20 份。即 **accuracy 维不管用哪个判官都漏掉大部分字面错误**,评测里的 accuracy 分数偏乐观(已有的「内部一致性修复凭确定性证据采纳」口径不受影响)。
- **撤回**:Stage 1 后我报的「noise 维规则=5,5.5 违规 20/40」是过度结论——09-15 子代理跑的 5.0 在同 20 件 17/20 给 4;codex 裁 rubric 在「非零但低于扣分线」处 4/5 两可。真实发现只是 5.5 同件两遍来回跳(8/20)。

**全量错误账(2026-09-23 用户「把这次评估发现的所有错误记账 之后我们一起修」)**:20 份回答 66 条裁决错误 = 事实 36 + 因果无据 30,逐句 + prompt 证据在 eval-private `runs/2026-09-23-judge-opus-compare/adjudication/errors-ledger.md`,分类表在 GH #103 评论。事实 36 条的根因:**A prompt 缺口 10**(A1 死亡行无当秒衰减 4 / A2 反噬不写控制类型 2 / A3 敌方打断回转 1 / A4 slack 被读成满血 1 / A5 外置效果时长 1 / A7 走位行只给两端距离 1,另 A6 Grounding 归属 1 条经 DB2 核实补入)· **B 全称/排他说法被 prompt 反驳 10** · **C 引用精度 12**(C1 边界/时刻 7、C2 窗口内低点 3、C3 措辞 2)· **D 过严 4**(不修)。**注意**:这批 prompt 是 PROMPT_VERSION 66(早于 f123004b),修之前每类先在当前 prompt 上复测还在不在。以下 (a)–(f) 是 09-23 暂停时的初稿,以上面的分类为准。

**F 当前代码的确定性门规硬失败(2026-09-23 新 5.5 基线 qualityCheck,PROMPT_VERSION 98,309 份)**:3/309 —— #216 `Ironbark` 被声称 available 但同时刻 `[RES]` 台账在 cd 里(冷却台账一致性类)、#272 `KILL ATTEMPTS … FAILED: popped Ironbark` 同段没有 `[ENEMY DEF]` 行(`checkEnemyDefRefConsistency`)——两条都是新的;#253 Aura Mastery 冷却台账是 09-15 起就有的旧账。

**修复进度(2026-09-23 同日,PROMPT_VERSION 99)**:**F #272 已修**(只有受方光环、缺施法事件的敌方外置也出 `[ENEMY DEF]` 行;605 份归档 +442 行,findings 哈希不变)· **A2 已修**(反噬控制单表 `data/backlashCc.ts`;原硬编码把吸血鬼之触 DoT 34914 本身当控制 → 6,397 条假控制行全删 = `[CC ON TEAM] … [DISPEL BACKLASH CC]` 2,769 + `[CC ON ENEMY] … (0s)` 3,628;真反噬 87204 罪与罚此前看不见,+836 行;标签写出类型 `[DISPEL BACKLASH CC: silence|horror]`;候选 death-setup −12(全是 `ccAtDeath=Vampiric Touch` 的 trinket-early 假指控)+3(罪与罚 healer-locked)、position-mistake +1(假 4 s「控制」曾豁免它),58 场暗牧子集隔离对照逐条复现)· **A6 已修**(`[CC AVOIDED?]` 写出光环提供者 `(own)` / `(from <pid>)`:2,667 行中 own 2,586 / 队友 69 / 未知 12;Grounding 转移归功改为要求本人在图腾寿命内施放,107 次里 7 次原是队友萨满的图腾)。309 份 qualityCheck 硬失败 3 → 2,剩 #216/#253 待裁「渲染秒口径」。**#216/#253 已裁已修(PROMPT_VERSION 100)**:用户 2026-09-23「如果一个东西在1秒内转好了 那么治疗也可能没有gcd 即时有了 也来不及 … 1秒内的不要管 甚至可以放宽到1.5秒 不过先1秒吧」→ `REACTION_WINDOW_S = 1`,「好了没按」类指控走 `cdReadyInTimeAt` / `isReadyInTimeAt`(t − 1 s 已转好且到 t 没按),`cdAvailableAt` 状态与 `[RES]` 台账不变;309 份硬失败 2 → 0;605 份:`[DEATH]` Unused −35 项、DEATHS WITH MISSED OPTIONS −23 行、cd-hoarded −4/−4、external-unused −3、cc-avoidable −1。**挂账**:参照表背后的决策点(`crisisDecisionPoints` 墙/控制就绪、`burstWindowDecisionPoints`、`cdTriggerPrior`)仍用状态口径,切换需重生成参照表(1–2 h);crisis-no-response 因此未吃到反应窗;放宽到 1.5 s 只改一个常量。未动:A1/A3/A4/A5/A7、B、C、E。

**(a) prompt 缺口 —— 代码问题,确定性修 + 前后计数**(codex 在 001–015 判出的 36 条事实错误里约 9 条,我手工粗分):
1. `[CC AVOIDED?] … Grounding Totem active` 与 `[absorbed: Grounding Totem]` 不写图腾是谁的 → 回答写成「你的」(R002-S056 = 争议集 D03:玩家 Grounding 施放在 2:05 / 2:55,2:41 那个无从归属)或反向猜测。
2. 被移除的定身不写来源(R002-S013:2:45 你的 Earthgrab,2:46 移除行无归属)。
3. `[DEATH]` 行不带当秒衰减 → 回答拿别的时刻的值顶(R006-S001、R008-S001)。
4. `[DISPEL BACKLASH CC]` 不说是哪种控制 → 回答猜成「晕」(R012-S004/S005)。
5. 敌方打断技能的冷却 / 回转时刻不渲染 → 回答自行推算(R013-S016)。
6. slack 窗(≥85% 血量门)被读成「满血」(R001-S091,实际 88%)——措辞问题。

**(b) 「全交完 / 只剩这一招 / 独自扛」绝对化 —— 对 `[RES] rdy:` 做确定性 lint**(6 条):R003-S026(「只有灵魂链接」但自然迅捷可用)、R008-S003(「所有大招都交了」但猎人 Roar of Sacrifice / Exhilaration 就绪且随后交了)、R010-S003、R013-S005、R014-S073(「只能靠神化」但守护之魂 + 心灵尖啸就绪)、R015-S002。形状同 causalLint;是否也进产品 auditFindings 待裁。

**(c) 引用精度残余**(约 12 条,#98 QUOTING DISCIPLINE 之后):窗口边界(2:14–2:43 写成 2:14–2:38)、击杀时刻写成铺垫时刻(R011-S006/S078「2:42 击杀」实际 2:55 死)、控制落地时刻写成饰品时刻。

**(d) 低价值 / 过严**(约 6 条):区间四舍五入、「Loss at <死亡时刻>」vs 比赛结束 +2 s(出现 4 次)——记录,不修。

**(e) rubric 缺陷两条(待用户裁)**:① responder 简报要求「围绕真正决定比赛的 2–3 个窗口」,rubric 却把无据的「decided」判为错误——5.5 多抓的错大半是这类(连 GH #70);② noise 维「非零但低于扣分线」4/5 两可,codex 提 min-of-three 查表(E/R <10%→5 …,T ≤45%→5 …),改了要重跑 calibrate-judge 且 duplicated-noise 植入类必须仍能检出。

**(f) 工具坑(在 `~/.claude/skills`,不在仓库)**:`cross-run.mjs` 配额正则含裸 `\b429\b`,run 失败时会被战斗日志里的数字误触而错判成配额耗尽 → 恢复时一律 `--backend codex`;agy 沙箱读不到 eval-private(文件要拷进工作区);agy 用 `verify` 角色会把任务书当「待核实声明」直接 REFUTED,要用 `ask`;4 个 codex 并发一次烧光额度。另:Agent 工具 `model: "opus"` 已解析到 claude-opus-5-5(09-23 实测),固定 5.0 须走 `claude -p --model claude-opus-5`;`eval-baseline.md` 里「Opus 5(传 model: opus)」一句从 09-22 起不准,等判官选定后改。
