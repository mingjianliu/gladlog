# BACKLOG Archive (Completed Items)

**Completed** items migrated from [BACKLOG.md](BACKLOG.md), retaining original numbering and all implementation notes
(completion dates/commits/spec pointers are in each section heading and body text). Non-blocking incidental leftovers
noted within individual sections have pointers in the Session follow-ups section of BACKLOG.md. Document created 2026-08-06.

## 2. Interrupt (kick) dashboard ✅ (2026-07-22, shipped together with #3, f145aaf: KickDashboard two-team aggregation + per-entry audit + seek; shares the `analyzeKickAudit` predicate with the burst ledger)

A per-match (and maybe cross-match) view of interrupts: kicks landed vs. missed,
by player, interrupt availability windows, locked schools, wasted kicks.

- **Already have the data:** `packages/analysis/src/utils/enemyInterrupts.ts`
  (`computeEnemyInterruptAvailability`) + the `[KICK]` timeline events in
  `buildMatchContext`. This is mostly an **aggregation + renderer** on top of
  existing analysis, not new parsing.
- **Scope signals:** small–medium. A new report tab/panel in the desktop
  renderer + a small aggregator in `analysis` (kicks by caster/target, hit/miss,
  interrupt uptime). Reuse the report UI patterns (FindingsList/TimelineStrip).

## 3. Purge / dispel dashboard ✅ (2026-07-22, shipped together with #2, f145aaf: DispelDashboard bidirectional ledger + missed purge/missed dispel lists + CC removal rate; `reconstructDispelSummary` shared predicate)

A view of offensive purges and dispels: purges done, **missed purge
opportunities** (an enemy buff left up), by player, plus friendly dispels.

- **Already have the data:** `packages/analysis/src/utils/dispelAnalysis.ts` +
  the `[MISSED PURGE OPPORTUNITY]` / `[CLEANSE]` / `[MINOR DISPELS]` timeline
  events in `buildMatchContext`. Again mostly **aggregation + renderer**.
- **Scope signals:** small–medium, parallel to #2 (same shape: aggregator in
  `analysis` + a report panel). Could ship #2 and #3 together as a "utility
  dashboards" sub-project since they share structure.

## 4. Burst-window analysis timeline (visual) ✅ (2026-07-29 shipped: report Timeline bottom pressure lanes with DMG SPIKE click-to-set-window connecting to #16 + HEALER EXPOSURE markers; TimelineStrip deprecated in the same pass — confirmed this component has no instantiation point in production (KeyMomentAxis has replaced it, only exists in faithfulness test fixtures), confirmed 2026-07-29; spec docs/superpowers/specs/2026-07-29-pressure-lanes-design.md)

A visual timeline of offensive/burst windows, damage spikes, and healer-exposure
moments — the "bursting window" timeline from the old repo's analysis view.
Today gladlog only renders _deaths_ on `TimelineStrip`; this adds the burst/
pressure lane.

- **Already have the data:** `buildMatchContext` emits `[OFFENSIVE WINDOW]`,
  `[DMG SPIKE]`, `[HEALER EXPOSURE]` via `computePressureWindows`
  (`packages/analysis/src/utils/healerMetrics.ts` / `context/*`). The candidate
  data exists; this is a **timeline visualization** on top.
- **Old-fork reference (concept):**
  `packages/shared/src/components/CombatReport/CombatAIAnalysis/matchTimeline.ts`
  - `TimelineStrip.tsx` (the burst/offensive-window timeline strip) and
    `CombatReplay/` for the scrubbable timeline. gladlog's own `context/matchTimeline*`
    already ports much of the _data_ side.
- **Scope signals:** medium — extend the existing `TimelineStrip` (currently
  deaths-only, `packages/desktop/src/renderer/src/report/components/TimelineStrip.tsx`)
  to render burst/pressure/exposure lanes with hover detail. Ties in with #1
  (video sync) if that ships — the same timeline could scrub the recording.

## 5. Settings UI (Anthropic API key + model) ✅ (actually already completed, status not updated: settings page with API key/backend/model/language etc. shipped with the 2026-07-18 three-phase UI launch, expanded in multiple subsequent iterations; 2026-08-06 archive note)

There is currently **no GUI to enter the Anthropic API key** — only the DevPanel
AI-backend dropdown. That's why the app shows `NO_API_KEY`. Add a real settings
panel: API key (write-only, redacted like the main-process store already does),
model, WoW dir, AI backend. Small; the IPC (`settings.get/save`, `redactSettings`)
already exists — this is renderer UI.

## 6. 2D positional replay ✅ (actually already completed, status not updated: ReplayView with map + GCD lanes + speed control + deep-dive-this-moment already live, iterated over multiple rounds since 2026-07; 2026-08-06 archive note)

A scrubbable top-down arena replay (positions, HP, casts, dampening over time) —
distinct from #1's video. Old-fork reference: `CombatReport/CombatReplay/` (Pixi.js
— `ReplayCharacter`, `ReplayHealthBar`, `ReplayCastBar`, `ReplayDampeningTracker`,
speed control). gladlog already parses advanced-logging coordinates (positioning
section in `buildMatchContext`), so the data exists. Medium–large; shares the
timeline seam with #4.

## 7. Competitive stats / trends ✅ (actually already completed, status not updated: StatsDashboard with win rate / per-spec / per-map aggregation shipped with the 2026-07-18 three-phase UI launch; 2026-08-06 archive note)

Cross-match aggregation: win rate over time, per-spec/per-comp performance, a tier
list. Old-fork reference: `CompetitiveStats/` (`SpecStats`, `CompStats`,
`TierList`). gladlog stores every match locally, so this is aggregation + a new
view — no cloud needed (unlike the old fork's server-backed version).

## 8. Deterministic mistake detection ✅ v1 (2026-07-23 shipped on release/0.1 branch, c59ba8c: MISTAKE_RULES 8 rules across 3 severity tiers + anti-corruption tests + MistakesCard/timeline ⚠; all consuming existing deterministic predicates, no LLM involved. To add rules, just declare them in the MISTAKE_RULES table)

A rules-based "mistakes" engine that flags concrete errors (trinket held through a
full-DR CC, defensive wasted, kick missed) **without an LLM** — complements the AI
findings with cheap, always-available, fully-verifiable output. Old-fork reference:
`CombatReport/CombatMistakes/` (`analyzeMistakes` + `mistakeKnowledgeBase`). Fits
gladlog's honesty ethos (deterministic, grounded) and reuses the existing
`candidateFindings` / analysis utils. Medium.

## 9. Match search / filter ✅ (2026-07-22 completed, fc2c73b: on top of existing win/loss, bracket, single-spec filters, added comp filter (spec chips, all teammates must match) and date range; after #12 makes all metadata resident, pure client-side filtering covers the full set without touching MatchStore)

Filter the (now paginated) match list by spec, bracket, comp, result, date. Natural
follow-on to the windowed list — extend `MatchStore.page` with predicates and add
filter controls to the sidebar. Small–medium.

---

## 10. Surface the structured analysis (currently LLM-text-only) ✅ closed out (2026-08-01)

gladlog computes a deep per-match analysis (~40 signals) inside `buildMatchContext`
but feeds _all_ of it to the LLM as text — the UI surfaces only the 6 healer
metrics + deaths/cd-waste. The rest is invisible to the user. Items #2 (interrupts),
#3 (purge), #4 (burst timeline) are subsets of this. Other computed-but-unshown
signals worth their own panels/lanes:

- **Diminishing returns / dampening** — `computeIncomingDR`, `computeDampeningTimeline`, `buildDampeningEvents`. ✅
  (2026-08-01: Timeline added `dampening?` lane, `dampeningSeries.ts` changed to consume
  `buildDampeningEvents` + `getInitialDampening` with event-level forward-fill).
- **CC chains** — `analyzeOutgoingCCChains`, `extractAoeCCEvents`, healer-CC-received. ✅
  (2026-08-01: new `CCChainPanel` consumes `analyzeOutgoingCCChains` unfiltered full chains, row expansion showing per-cast + DR tier;
  `dr-clipped-cc` subset already in `MistakesCard`; healer-CC-received aggregation is part of baseline 6 metrics, per-CC-received events shown on
  `KeyMomentAxis`; `extractAoeCCEvents` remains text-only, determined to overlap with CC chain panel info, no separate item created).
- **Kill windows / target selection** — `analyzeKillWindowTargetSelection`, `buildKillSequenceBlock`, contested-trade facts. ✅
  (2026-08-01: `BurstLedgerCard` "window target discipline" section wired to `analyzeKillWindowTargetSelection`,
  `betterTargetExists` highlighted in red showing the preferred target).
- **Positioning / LoS** — `computeOwnerPositionEvents`, `analyzeHealerExposureAtBurst`. ✅
  (2026-08-01: `computeOwnerPositionEvents` piped into barrel, STAYED_IN (requires `stayedInHadRealCost` to verify real cost)
  / MISSED_PUSH / CD_OUT_OF_RANGE — three types routed to `KeyMomentAxis`; `analyzeHealerExposureAtBurst` was previously already
  wired via `computeHealerExposureEvents` as single source into #4 pressure lanes).
- **Defensive management** — `detectFriendlyCDOverlaps` (**dead code, deleted**, along with `IOverlapCast` /
  `IFriendlyCDOverlapGroup` / `formatFriendlyCDOverlapsForContext`, verified zero call sites repo-wide),
  `detectOverlappedDefensives`, `detectPanicDefensives`, `findCheaperDefensiveAlternatives`,
  `computeCDResponseLatency`. ✅ (2026-08-01: `detectPanicDefensives` wired to `DeathRecapCard` /
  `KeyMomentAxis` defensive entries with "panic usage" annotation; `findCheaperDefensiveAlternatives` cheaper-alternative
  text wired to death recap; aggregate ratios/latency already part of baseline 6 metrics, per-cast Early/Optimal/Reactive labels already in
  `KeyMomentAxis`).
- **Healing gaps** — `detectHealingGaps`, `computeSlackSegments`, `computeHealingInWindow`. ✅
  (2026-08-01: `detectHealingGaps` routed to `KeyMomentAxis` (`heal-gap` kind) + `healerMetrics` added
  `healingGapSeconds` / `healingGapCount` scalars, plumbed through ProComparison/corpus-tools/preload).
- **Trinket usage** — `analyzePlayerCCAndTrinket`, `detectTrinketType`. ✅ (2026-08-01 code audit:
  this predicate is already a shared input for `DeathRecapCard` / `KeyMomentAxis` / pressure lanes / `healerMetrics`,
  trinket state is structurally visible at every point, no separate item needed).
- **Death root-cause** — `buildDeathRootCauseTrace`, `findContributingDeath`. ✅ (2026-08-01 code audit:
  these two functions are dead code in the UI path, but the same "why did they die" structured breakdown has been
  superseded by #17b's `computeMitigationAudit` + counterfactual series, rendered per-entry in `DeathRecapCard`,
  no longer "death moment visible, cause is plain text").
- **Match arc / flow** — `buildMatchArc`, `buildMatchFlow`, `extractMatchDynamics`. ✅
  (2026-08-01: new `buildMatchArcStructured` single-source structured early/mid/late phases + turning points, `buildMatchArc` changed to
  purely format its output, prose byte-for-byte unchanged; render layer added `MatchArcLine` report header row with three phases, clickable turning-point jumps;
  `buildMatchFlow` / `extractMatchDynamics` are deprecated/internal auxiliaries, not consumed, out of scope for this round).

Approach: promote these from `buildMatchContext` text into structured events (like
`extractCandidateFindings` does for deaths/cd-waste) so both the UI _and_ the
findings pipeline can use them — and so #8 (deterministic mistakes) has grounded
inputs. Big theme; slice into panels/lanes over several sub-projects.

Note: `extractRotations` is computed but only consumed by offline `corpus-tools`,
not the app — either surface it or leave it corpus-only by design.

**2026-08-01 closed out** (plan `.superpowers/sdd/2026-08-01-backlog10-surfacing/`, 5 tasks,
9 commits, `60441ad..2a85724`): all eight signal groups surfaced, see per-item ✅ notes above. All consuming existing analysis
predicates with zero new computation (the only new function is `buildMatchArcStructured`, which structures previously discarded internal values, prose output
byte-for-byte anti-corruption tested); presubmit all green (lint/typecheck/test/verify:vision/build).

3 incidental minor items left (all logged, non-blocking, to be addressed opportunistically):

- Timeline dampening lane has pointer-events dead zones (hover title overlay doesn't cover the full new lane area).
- `detectPanicDefensives` enemy-side call site and friend-side predicate naming have a second spelling inconsistency.
- `keyMoments.ts` and `ProComparison`'s owner fallback chains should share a single `resolveOwner`; currently each has its own implementation
  (unreachable today, needs consolidation before POV selector ships).

## 11. Report detail breakdown (wowarenalogs original detail level) ✅ (2026-07-18 completed: meters inline expansion, output/healing/damage-taken three modes; damage-taken by source and interrupt/dispel lists not done — user did not select them)

User request (2026-07-18): current report meters only show per-player totals (one row each for damage/healing),
less informative than old wowarenalogs' detail view. Goal: click on a player → detailed breakdown:

- **Output by spell**: total damage/share/count/crit rate/max hit per spell;
- **Healing by spell** (including overheal percentage);
- **Damage taken by source**: who hit you with which spell for how much (essential for death analysis);
- **Healing received by source**; optional: per-entry interrupt/dispel/CC lists.

Data is all in unit event arrays (aggregate damageOut/healOut/damageIn by spellId),
pure derive + expandable UI (meters row click-expand or standalone detail tab). Complementary to #10's
structured panels: this is "raw ledger", #10 is "analysis conclusions".

## 12. Lazy-load background backfill + live stats updates ✅ (2026-07-18 completed, see App.tsx background backfill loop + StatsDashboard matchStored subscription)

User feedback (2026-07-18): current lazy-load (only parse the most recent N matches for first screen) does load fast,
but has two gaps:

1. **No background backfill**: after the first screen, remaining matches are never parsed during idle time, scrolling down the list /
   searching for old matches still shows gaps; after first-screen render, use an idle queue (per-match, interruptible) to backfill remaining
   matches into the in-memory cache.
2. **Stats dashboard doesn't update with backfill**: the stats page still only counts the initially loaded few matches — after a backfill
   batch completes, incrementally recompute aggregations (or at least show "counted X/Y matches" + manual refresh),
   otherwise win rate / per-character stats are wrong for veteran players.

Related: docs/plans/2026-07-19-large-match-load-optimization.md (Plan A's
workerHost async parse + LRU already designed, can serve as execution vehicle for background backfill).

## 13. Deep-dive global anchors / non-kill mistakes as standalone findings (logged 2026-07-19) ✅ (2026-08-01 closed out: auto-sweep version, see end of section)

Current state: deep-dive is a **magnifying glass** — it only collects evidence within the `[-30s, +10s]` window
of moments already marked as findings in round 1 (including positioning), and does no global scan. If a time period
has no round-1 finding, even if there are positioning mistakes or other evidence there, they **will not** enter
deep-dive (see [[gladlog-deepdive-value]]).

Direction: let non-kill mistakes serve as **standalone anchors / new findings**, rather than only supplementing
existing finding windows. The raw signals mostly already exist (`candidateFindings.ts`'s `unconverted-burst` /
`burst-into-immunity` / `off-target-in-window` / `juked-kick` / `dr-clipped-cc` / `cd-waste`, plus positioning
mistakes from `computeOwnerPositionEvents`). Trade-off: this transforms deep-dive from "explain known deaths
thoroughly" to "discover issues that round 1 missed", which requires the same signal gate (hasCoachableSignal
spirit) + audit, otherwise re-introduces noise/filler risk.
Overlaps with #8 (deterministic mistake engine) and #10 (structured signal surfacing) in direction — all three
should be thought through together on the product form of "help during non-kill segments" before starting.
This item is one candidate implementation path from that brainstorm.

> **2026-08-01 code-level audit check**: after 2026-07-23, #8 deterministic mistake engine already lets 9 types of non-kill candidates
> become standalone list items independent of round-1 findings; the round-1 prompt has had non-death coverage hard rules since 2026-07-18
> (`buildFindingsPrompt.ts:47`), evidence menu three-window coverage went from 0/17 → 11/17 (07-24). #16 windowOverride
> (`buildWindowPack`, `deepDive.ts:999`) proved the "arbitrary window + same signal gate" mechanism works, but still requires user-triggered
> selection. What truly remains is just automation: making this mechanism auto-sweep across the entire match, instead of waiting for user clicks
> or round-1 finding hits — `analysisInput.ts:97-134`'s auto deep-dive path still strictly anchors on `finding.eventIds`, zero global scanning.

**2026-08-01 closed out** (spec `docs/superpowers/specs/2026-08-01-backlog13-autosweep-design.md`):
the automation half is now filled in — full-match 20s windows, 10s step, running #16's existing signal gate
(`buildWindowAnalysisRequest`, zero re-implementation), overlaps with existing anchors (round-1 findings time anchors
∪ deterministic mistake list `deriveMistakes`'s `tS`) within ±5s tolerance are discarded, hitting windows are merged with
union boundaries, ranked by signal density (pack.items count) descending and top 3 taken. AI analysis view adds
"Uncovered Highlights" card below the findings section (not rendered when zero highlights), clicking
[AI Analyze This Segment] directly reuses #16's `runWindowAi` (set window + trigger, zero new IPC, shares cache/force semantics).

The sweep itself is fully deterministic (no model calls); only when the user clicks the card button does an actual model call fire
— continuing #16's cost discipline. Implementation: `derive/uncoveredHighlights.ts` (pure geometry, mock
signal gate unit tests covering hit/dedup tolerance boundaries/merge islands/rank trimming) +
`components/UncoveredHighlightsCard.tsx` + `MatchReport.tsx` /
`StructuredAnalysisPanel.tsx` wiring (`onFindingsAnchors` callback feeds round-1 findings
time anchors to parent). Real fixture integration test confirmed this chain truly reuses the gate (90s/9 windows
<30ms, not a fake green disguised as passing).

Boundaries (v1 not doing, see spec): auto-sweep highlights are not auto-promoted to findings; not in batch analysis; not surfaced in
non-AI views; window width/step not configurable.

## ~~spellNames 12MB top-level await blocking first screen~~ ✅ fixed (2026-07-19)

**Symptom**: first screen (report render / app cold start) consistently takes ~22-25 seconds.

**Root cause is not "large file", but "compiled as source code"**: `spellNames.json` has 410K keys,
Vite 5 by default converts JSON to a **JS object literal**, and V8 must parse it as source code. The same data
takes only **42ms** with `JSON.parse` — three orders of magnitude difference.

**Fix**: all three build targets (main/preload/renderer) and the test bench config enable
`json: { stringify: true }`, making Vite output `JSON.parse("…")`. One line of config,
no API changes, no modifications to the 40+ `getEnglishSpellName` call sites.

**Results** (measured in CI):

| Metric             | Before      | After      |
| ------------------ | ----------- | ---------- |
| App cold start     | 18.7–24.0s  | 1.59–1.72s |
| Report first render| 21.9–27.0s  | 2.12–2.19s |
| Visual suite total | 3.0 min     | 22 sec     |
| E2E suite total    | 1.3 min     | 14.5 sec   |

The three budgets in `qa/budgets.ts` were tightened accordingly from 5100/41000/36000 to 4900/3300/2600.

**Lesson for future developers**: before bundling large JSON, verify it goes through `JSON.parse` rather than
an object literal. This pitfall produces no errors, only manifests as "startup is slow", and only becomes visible
above a certain size threshold.
The QA system's performance budgets exist precisely so this kind of regression doesn't rely on humans noticing it —
it was caught by `[budget] coldStart`, not by someone "feeling it was a bit slow".

## 15. AI analysis text inline icons (spell/class names → icon + Chinese name) ✅ (2026-07-28 shipped: render-layer post-processing inlineRich + zhCN dictionary generated artifact; spec docs/superpowers/specs/2026-07-28-inline-spell-icons-design.md)

User's exact words: "In the log analysis, spell names and character classes would be more intuitive as icons — you use icons
on the other pages, why not in the analysis? The AI says I missed a normal Tranquility, and I'm still guessing from the English name."

Current state: other report views (lanes/meters/detail/mistake cards) all render icons via `SPELL_ICONS_GENERATED`,
but AI-produced narrative/findings/deep-dive text is plain text with spell names appearing in English; deep-dive
chips already have `spellId` (icon only), but body text does not. Chinese users have to guess English spell names.

Direction: **render-layer post-processing**, without touching the prompt/audit chain (raw number audit, claimChecker all operate on
text, must interpolate first then replace). Known spell names in findings/deep-dive/narrative text are replaced via an "English name → id"
reverse lookup table with inline components (icon + localized name); class/spec names likewise (`classMetadata`).
Reverse lookup ambiguity (same name, multiple ids) resolved by taking the one with an icon / higher corpus frequency; replacement doesn't
modify stored text, display only.
Scope: small–medium, pure renderer + a shared `<SpellInline>` component.

## 16. Selected time range → [AI Analyze] (arbitrary window on-demand deep-dive) (logged 2026-07-27, Bilibili user feedback) ✅ (2026-07-29 shipped: TimeRangeBar selection → windowOverride pack construction → window-mode deep-dive → WindowAnalysisCard; zero-signal zero-cost path; windowAnalysis.<lang>.json LRU cache; spec docs/superpowers/specs/2026-07-29-window-ai-analysis-design.md; real model filler smoke pending real device)

User scenario: after reading the full match analysis, select a segment on the timeline, click [AI Analyze], and see
"are there other possibilities" for that segment.

Existing foundation: the deep-dive pack is already window-based — `buildDeepDivePack` collects evidence from any
`[minT-30, maxT+10]` window (CC/defensives/enemy CDs/HP/dispels/positioning/available-unused), independent of
the specific round-1 finding type. Swap the window for the user-selected `[from, to]`, create a synthetic
finding anchor, and the entire pipeline is reused (pack → prompt → audit → chips jump to replay).

Same direction as #13 (deep-dive global anchors): #13 is the system automatically finding non-kill anchors, this item is
**user-specified window**, simpler to implement, more intuitive as a product, can serve as an advance validation for #13.
Note: when there's no coachable signal in the window, honestly output "no issues found in this segment"
(hasCoachableSignal gate retained, empty result is valid output, don't force-generate advice for clicks);
latency/cost of a single model call needs UI expectation management.
Scope: medium — renderer selection interaction + IPC + analysisService reusing the deep-dive pipeline.

## Multi-model analysis comparison ✅ shipped (2026-08-01, spec/plan at `.superpowers/sdd/2026-08-01-multi-model-analysis/`)

Analysis cache changed to slotted storage (`AnalysisSlot` / `AnalysisCacheDocV2`, slot key
`${backend}:${model}`) + panel tab switching (only shown when ≥2 slots) + "analyze with another
model" split arrow next to the analyze button (temporarily switches backend/model for one run, doesn't write to global default settings). Final review also fixed a renderer production build hygiene issue: `shared/analysisCache.ts` top-level `import "path"`
was indirectly pulled into the browser bundle by renderer-side `slotLabel.ts`, causing `electron-vite build` to
consistently fail (vitest/tsc can't catch this, only production build does) — extracted zero-fs/path-dependency
`shared/analysisSlots.ts` housing all pure slot logic, `analysisCache.ts` retains only Node-specific
`analysisCachePath` + deprecated v1 envelope, `export *` keeps main-side old import paths unchanged.

**Final review remaining item (handoff item, handle next time `StructuredAnalysisPanel.tsx` is touched)**:
old slot tabs with invalidated cache (prompt version upgrade etc.) correctly show placeholder prompt and don't clear underlying
`result`, but the top status line ("Cached · N findings") and Export still read from the underlying old
`result` — in placeholder state these two will show stale slot numbers/content that don't match the placeholder message, won't
crash, just visually inconsistent, can be disabled or hidden in the same batch. **Closed 2026-09-04 (GH #38)**: status line now shows a stale-slot message and Export is hidden while the placeholder is up.

## 20. AI analysis chat box (logged 2026-07-30, user request) ✅ (actually already completed, status not updated: Ask Coach shipped 2026-08-02, spec docs/superpowers/specs/2026-08-02-coach-chat-design.md, CLI three-backend resume sessions; 2026-08-06 archive note)

Add a **chat box** to the AI analysis view: users can ask follow-up questions about the current match analysis ("why did you say I
used wall too early?" "what should I have done differently during the 2:08 burst?"), and the AI continues the conversation with
existing context (analysis cache findings/deep-dive evidence packs/match data), instead of being a read-only one-way report.

- **Existing foundation**: the analysis service already has complete prompt construction (buildMatchContext/deep-dive evidence packs/
  window mode), streaming emit channel (`gladlog:analysis:delta`), per-match cache; chat =
  adding multi-turn message history + an input box UI on top of these.
- **Think it through before starting**: context strategy (re-sending full match context every turn is expensive, consider first-turn system +
  incremental history), relationship with deep-dive/selected-segment analysis (#16) (chat may replace part of "pre-made follow-ups"),
  whether to persist chat history, cost guardrails (local backend vs API billing).
- **Status**: logged, not scheduled.

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

## Session follow-ups (completed items, migrated from the same-named section in BACKLOG)

- ~~**SP-B2.1**~~ ✅ (2026-07-29 shipped: userData/reference_vectors.json override path,
  bad file falls back to built-in; to swap in new corpus = drop new json into user data directory and restart) — CDN corpus refresh
  (ship an updated `reference_vectors.json` without a full rebuild).

- ~~**zh/EN analysis-language toggle**~~ ✅ (actually already completed, status not updated: settingsStore.aiLanguage + buildCoachSystemPrompt language injection + per-language cache partitioning + SettingsPanel toggle + panel follows, all LLM outputs — narrative/deep-dive/findings/comparison commentary — consume this setting; verified 2026-07-22) — the prompts/output are zh-leaning; a
  language switch for findings + narrative.

- ~~**F170 `[ENEMY HARD CAST]` narrower than old (A1 oracle finding, 2026-07-13)**~~
  ✅ (2026-07-29 root-caused + fixed: wiring bug, not intentional narrowing — F170
  read `enemy.spellCastEvents` filtered for `SPELL_CAST_START`, but the new L3
  parser split that stream so `spellCastEvents` is SUCCESS-only and START events
  live in the sibling `castStartEvents` field; the filter was empty-set-by-construction.
  Fix: point F170 at `enemy.castStartEvents`. Same-sample before/after on 60 seeded
  matches / 208 combats: 0/208 combats emitting → 28/208 (10/60 matches). Regression
  test added (`matchTimeline.hardCast.test.ts`). Oracle allowlist entry retired.

- **Tolerant JSON extraction for local models** — the analysis service does
  `JSON.parse(raw.trim())`; agy/Claude returned clean JSON in testing, but other
  local models may wrap it in ```json fences → parse fails → silent fallback.
  Strip fences / extract the first `[...]` before parsing so local backends are
  robust. (Surfaced by the MODE=local e2e.)
  ✅ (actually already completed, status not updated: 2026-07-31 `parseModelJsonArray` single-source tolerant extraction shipped — strips ```json fences / extracts first array, claude -p tested form regression test pinned; 2026-08-06 archive note)
