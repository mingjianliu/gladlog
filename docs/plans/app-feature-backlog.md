# App Feature Backlog

> **2026-10-20: open items are tracked on GitHub.** §10's deferred row detail is in GH #151; §12–§16, §18 and §19 are in GH #152. §17 is implemented (`autoAnalyze` in settings). This file stays as the design record.

> Desktop App feature requirements (distinct from prompt quality changes, which do not go through /eval-ab; UI/interaction changes are implemented directly with standard testing).

## 1. AI Analysis Language Switching (Chinese / English) ✅ (Implemented 2026-07-18: Chinese/EN segmented control next to analysis button, persisted in settings.aiLanguage (default zh); main side buildCoachSystemPrompt injects system prompt (before local CLI backend prepends prompt); cache key split by language analysis-v2.<lang>.json for bilingual coexistence, legacy keyless cache serves as English fallback; PROMPT_VERSION not bumped)

**Requirement**: Add a language toggle button next to the AI analysis generation trigger (beside the "Analyze" button in AIAnalysisPanel), selectable between Chinese or English, controlling the output language of coach responses.

**Implementation Highlights (Audited from Current State)**:

- **UI**: `packages/desktop/src/renderer/src/report/components/AIAnalysisPanel.tsx` — Add Chinese/EN two-state toggle next to generation button; persist selection.
- **Settings**: `packages/desktop/src/main/settingsStore.ts` add `aiLanguage: "zh" | "en"` (default `"zh"`, consistent with existing UI Chinese); IPC uses existing settings channel.
- **Request**: Stream calls in `packages/desktop/src/main/ai.ts` **currently have no system prompt** (messages only contains user) — add `system` field: coach persona definition + output language instructions ("Respond entirely in Simplified Chinese" / "Respond in English"). This also provides an opportunity to consolidate responder persona prompts into the production pipeline (alignable with eval responder templates).
- **Cache**: Match caches are currently stored as single files `<matchesDir>/<matchId>/analysis.json`; docs need a `language` field; `getCached` treats mismatches with current language as cache misses (or partition filenames as `analysis.<lang>.json` to retain results for both languages simultaneously — latter recommended).
- **Note**: Language is a request parameter rather than a prompt builder alteration, `PROMPT_VERSION` does not need bumping; timeline prompt body maintains English structure (spell name mixing addressed separately, see #2).

## 2. Timeline Spell Name Normalization ✅ (Verified 2026-07-18 as solved by full audit: CJK fixes (getEnglishSpellName full coverage + final tag guard 3cb15ea) resulted in CJK=0 across fresh 176-prompt corpus, spell names are 100% English; no prompt builder changes needed, /eval-ab unnecessary)

Timeline logs in Chinese clients mixed Chinese and English skill names (e.g. Hex / Paralysis vs Hammer of Justice). `getEnglishSpellName` can already translate most names to English; evaluate: fully English prompts (more robust for models) + response language controlled by #1. Classified as prompt builder change; if undertaken, requires /eval-ab (target dimension: accuracy).

> Note (2026-07-13): The **final form of #3/#4/#5 underwent comprehensive redesign** (top-level segmented tabs,
> removal of unit sidebar, arena redraw + real maps, GCD swimlane, AI two-column view, etc.). Current state documented in
> [`2026-07-13-report-ui-current-state.md`](./2026-07-13-report-ui-current-state.md).

## 3. Split AI Analysis into Independent Tab (Detach from right sidebar) ✅ (Implemented 2026-07-12, branch `worktree-report-ui-backlog`)

**Requirement**: AI analysis is currently crammed into the right `rpt-side` sidebar as a sub-state of `sideTab` (Unit Details / AI Analysis). Space is too constrained for large volumes of text. Elevate AI Analysis into a top-level independent Tab with ample horizontal space.

**Current State**: `packages/desktop/src/renderer/src/report/components/MatchReport.tsx` — Layout contains `rpt-body` with `rpt-main` (damage/healing/damage taken meters + timeline) + `rpt-side` (`SideTab = "unit" | "ai"`, narrow aside). The `ai` branch renders `StructuredAnalysisPanel` + `ProComparisonVerified`.

**Implementation Highlights**:

- **Top-level Tab Structure**: Add a view switcher at the top of `MatchReport` (below `ReportHeader`) — e.g. `View = "report" | "ai"` (reserving `"replay"`, see #5). The `report` view retains the main+side layout with side dedicated to "Unit Details"; the `ai` view renders `StructuredAnalysisPanel` + `ProComparisonVerified` in **full width**.
- **Degrade SideTab**: After moving AI out, `rpt-side` no longer needs `unit/ai` switching; `SIDE_TAB_LABEL` / `sideTab` state can be removed or simplified to a pure "Unit Details" header; note that #4 adds dedicated player filter controls to unit details.
- **CSS**: `rpt-side` is a fixed narrow column; the full-width AI view requires a new container style (reusing `rpt-main` width or introducing `rpt-ai-full`) to allow structured analysis long text and comparison tables to expand.
- **State Preservation**: Switching tabs must not lose generated analysis (persisted in `<matchesDir>/<matchId>/analysis.json`, component remounting hits cache seamlessly without duplicate requests).

## 4. Unit Details Enhancement: Merge Casts + Important Auras & Player Filtering ✅ (Implemented 2026-07-12; important = within `@gladlog/analysis` SPELL_CATEGORIES)

**Requirement**: The sidebar "Unit Details" concept is valuable but currently insufficient — (1) Casts and Important Auras are separate tables; merge them into a unified chronological event stream, filtering auras to **only important ones** (defensive CDs, crowd control, major buffs) instead of all aura noise; (2) The panel is currently driven by a single `unitId` clicked from the timeline; allow users to **filter/switch players directly** within the panel.

**Current State**: `packages/desktop/src/renderer/src/report/components/UnitPanel.tsx` — Calls `deriveCasts` and `deriveAuraEvents` (`report/derive/casts.ts`) separately, rendering two distinct `<table>`s. `AuraRow.auraType` only has `"BUFF" | "DEBUFF"`, lacking an "importance" dimension. Unit is passed via `unitId` from `MatchReport`, lacking local selection controls.

**Implementation Highlights**:

- **Merged Event Stream**: Create a new derive function (e.g. `deriveUnitTimeline`) merging `CastRow` with filtered `AuraRow` into `{ t, kind: "cast" | "aura", ... }[]` sorted by `t`; UnitPanel renders a single table, distinguishing casts/auras via icons or columns.
- **Important Aura Allowlist**: Currently lacks "importance" criteria — requires an allowlist of important aura spellIds (defensive/immunity/crowd control/burst buffs) or category inference. Place constants adjacent to `report/data/`, starting with high-value abilities and expanding later. Represents the primary workload of this task.
- **Player Filter Control**: Add player dropdown within UnitPanel (source `source.units`, ordered via `deriveSummary` or grouped by team), invoking `onChange` to `setUnitId` — sharing the same `unitId` state with timeline clicks for bidirectional synchronization.
- **Note**: Related to #3 — with AI moved out of sidebar, unit details monopolizes the sidebar, providing room for filter controls and a wider merged table.

## 5. Replay Tab (2D Simulation) ✅ (Implemented 2026-07-12 v1; coordinates verified feasible — advancedSamples contains x/y/hp for realistic movement interpolation)

**Requirement**: Missing a "Replay" Tab — transforming matches into a 2D top-down simulation replaying unit positions, casts, deaths, etc., synchronized with timeline progression for intuitive match review.

**Implementation Highlights (Requires Prior Feasibility Verification)**:

- **Data Prerequisite**: 2D replay requires **position coordinates**. Confirm whether parsed events include coordinates (some WoW combat log events contain `x/y/facing`, though coverage varies). If coordinates are sparse, replay risks degrading to "event timeline animation" rather than precise movement — verify field availability in `packages/desktop/src/renderer/src/report/derive/` and underlying parser.
- **Integration**: Placed as the third value `"replay"` in top-level `View` introduced by #3, peer to report and AI.
- **Rendering**: Canvas/SVG top-down view scrubbing along timeline — units as dots, faction-colored, casts/CC/deaths indicated via markers or highlights; reusing event sequence from `deriveTimeline` for time synchronization.
- **Scope**: Largest and most uncertain item; recommend conducting a spike to validate coordinate data before finalizing implementation scope.

---

> Items #6–#11 originate from the 2026-07-17 item-by-item comparison against legacy wowarenalogs UI (`~/code/wowarenalogs/packages/shared/src/components/CombatReport/` across 15 tabs).
> Conclusion: The three-view segmented tab structure is **superior** to legacy's 15 flat tabs and remains unchanged; what is missing is legacy's proven useful **content**, along with modern gladlog's unique **evidence chain deep-linking** opportunities.
> General Architectural Fact (Keep in mind prior to implementation): Renderer only depends on `@gladlog/parser` (new parser doc, `u.deaths`/advanced samples contain x/y/hp); **main process already depends on `@gladlog/analysis`** (`src/main/analysis.ts` builds findings prompt). Therefore, whenever analysis predicates/allowlists are needed, prioritize "calculate in main process → IPC to renderer", avoiding duplicate constants in renderer (predicates as specification).
>
> **2026-07-17 Detailed Research**: Code-level verification + per-item design decisions documented in
> [`2026-07-17-ui-backlog-research.md`](./2026-07-17-ui-backlog-research.md) —
> where three cross-cutting findings **adjusted architectural assumptions in this section** (renderer already imports analysis pure data
> exports; #8 evidence chain already half-exists in AI view; #9 is blocked on spellId→icon mapping dataset).
> Execution follows the research document. Implementation sequence revised to #7→#8→#6→#9→#10→#11.

## 6. Death Recap ✅ (Implemented 2026-07-17 `3501c76`: Click death marker → 10s pre-death event stream + unused available defensives + jump to replay at timestamp; covers deaths on both sides; renderer derive consumes analysis predicates directly)

**Requirement**: Primary use case for arena match review. Clicking death markers on HP curves (or new "Deaths" list in report view) → Opens recap drawer for that death: ~10s pre-death damage event stream, healer status (CC'd / casting / repositioning), deceased player's defensive CD status (available but unpressed = highlighted), plus "Jump to replay at this moment" button.

**Legacy Equivalent**: `CombatDeathReports/index.tsx` (128 lines) — Player selection sorted by death count, single `CombatUnitTimelineView` per death, "only show CC" filter; functional but purely an event list.

**GladLog Differentiation Opportunity**: Analysis package possesses **audited death-trace** (0/3733 violation audit rule) — death recap should reuse the exact same predicate chain rather than reinventing event filtering.

**Implementation Highlights**:

- **Data**: Main process adds IPC (e.g. `report:deathRecap(matchId)`), internally invoking `@gladlog/analysis` death-trace path (`parser-compat` conversion already available in main), outputting structured recap: `{ unitId, deathT, events: [{t, kind: dmg|heal|cc|def_used|def_available, ...}], healerState, defensivesUnused }`. **Do not** handcraft duplicate filtering in renderer.
- **Entry UI**: `Timeline.tsx` death marker onClick → Opens recap drawer/card (new component `DeathRecap.tsx`); report view Meters card can display death summary chips below (victim name + timestamp).
- **Navigation**: "Replay this moment" in recap → Switches to replay view with `setT(deathT - 8s)` (playback clock is shared state: `t/playing/speed/selUnits`).
- **Testing**: `dev:ui` testbed fixture verification + unit tests for recap IPC (assertions on victim defensive CD availability).

## 7. Rich Match List Rows ✅ (Implemented 2026-07-17 `8772f4f`: Win-loss / map / duration / rating + spec icons for both teams; legacy fallback + DevPanel index rebuild backfill)

**Requirement**: Current list rows are plain text `[kind] bracket · time · result`. Transform to: **spec icons** for both teams (friendly/enemy grouped), map name, match duration, average rating badge, win/loss color coding — instantly scannable across an evening of matches.

**Legacy Equivalent**: `CombatStubList/rows.tsx` + `bits.tsx` (ResultBadge / RatingBadge / TeamSpecs / durationString / zoneMetadata).

**Implementation Highlights**:

- **Meta Extension**: `src/main/matchStore.ts` `StoredMatchMeta` adds optional fields: `durationS`, `zoneId` (existing), `avgRating?`, `teams?: [{specId, classId}[], ...]` (compact spec array). Index uses JSONL append + `meta.json` fallback rebuild: **new fields strictly optional**, legacy rows render fallback text styles; one-time `rebuildIndex` available.
- **Spec Icons**: Renderer already utilizes `SpellIcon` bridge icon caching (`b.icon.get(name)` → dataURL); reuse for spec icons via specId→icon name mapping (added adjacent to `report/data/gameConstants.ts`).
- **Map Names**: Migrate zoneId→name dataset from legacy `data/zoneMetadata.ts` (public factual data).
- **UI**: `App.tsx` list `li` rearranged in two rows: top row result color bar + map + duration + rating; bottom row two groups of spec icons separated by vs.
- **Testing**: Add assertions in `App.pagination.test.tsx` for fallback rendering when meta fields are absent.

## 8. Evidence Chain Navigation + KILL WINDOW / VULNERABLE Annotations in Replay ✅ (Completed 2026-07-17 `60d9707`+`b825184`: finding/strip "Replay this moment" → seek + gold swimlane flash; scrubber + strip color bands, gold=burst gray-red=vulnerable)

**Requirement**: AI analysis findings carry verified timestamps/event IDs — make every timestamp **clickable**: click → switch to replay view, seek playback clock to t, highlight corresponding GCD swimlane column. Transform "trust the coach" into "verify yourself" — UI implementation of end-to-end verifiability. Additionally: render `[KILL WINDOW]` burst and `[VULNERABLE]` spans on replay scrubber/TimelineStrip (p50 14s, concise and suitable for visualization).

**Implementation Highlights**:

- **Findings Timestamp Parsing**: Audit timestamp formats in findings JSON rendered by `StructuredAnalysisPanel`/`FindingsList` (`mm:ss` text or structured fields); attach structured `refs: [{t, unitId?}]` in main process if text-only.
- **Navigation Pipeline**: `MatchReport` root holds view state + replay clock; pass `seekTo(t, unitIds?)` callback to AI view: click → `setView("replay")` + `setT(t)` + `setSelUnits(unitIds)`.
- **Window Annotations**: Main process runs `computeOffensiveWindows` per match → IPC to renderer `{bursts, vulnSpans}`; `TimelineStrip.tsx`/replay scrubber draws semi-transparent color bands (burst=gold, vulnerable=gray-red), hovering displays target + team damage. **No constant duplication**: calculated in main using `KW_BURST_*`/`computeBurstSubWindows`.
- **Swimlane Highlighting**: `GcdSwimlane` adds temporary flash highlight state for chips near timestamp t.
- **Testing**: Unit tests for seek callbacks + integration test in `dev:ui` for finding click navigation.

## 9. GCD Swimlane Chip Spell Icons ✅ (Implemented 2026-07-17 `b2fc00f`: genSpellIcons mined 3568 entries (update-wow-data step 6b) + chip real icons + SpellIcon Promise memo)

**Requirement**: Swimlane chips currently display text only; icons allow much faster visual scanning. Wide chip = icon+name, narrow chip (during collision compression) = icon only, tooltip title retained.

**Implementation Highlights**:

- `SpellIcon.tsx` exists (bridge icon cache → dataURL, fallback first letter), currently used only by `UnitPanel` — integrate directly into `GcdSwimlane.tsx` chip rendering.
- **spellId→Icon Mapping**: Source icon names in `deriveUnitTimeline` (`report/derive/casts.ts`) from parser doc spell data or `gameConstants` mapping table.
- **Performance**: Hundreds of chips per match; memoize icon requests in renderer memory (`Map<name, Promise<dataURL>>`) on top of bridge-side caching to prevent frame drops.
- **Testing**: Add assertions for icon fallback rendering in swimlane tests.

## 10. Statistics View: Interrupts / CC / Dispels Table ✅ (Implemented 2026-07-17 `f32a4d2`: 4th meter mode "Stats", deriveStatsTable uses analysis predicates directly; detail expansion deferred to v2)

**Requirement**: Hard tabular statistics per player: interrupts landed/taken (counts and /min), total CC duration taken (seconds and percentage), CC output duration, dispels/purges (essential healer metric: 34s CC'd in 6:20 match is a headline statistic). Placement: 4th card alongside report view Meters, or 4th item in meter mode segmented control.

**Legacy Equivalent**: `CombatCC/index.tsx` (53-line table) + `CombatDispels/index.tsx` (262 lines, including dispel breakdown).

**Implementation Highlights**:

- **Data**: Analysis package computes these for prompt generation (interrupts allowlist, CC duration, dispelAnalysis) — main calculates → IPC structured table (`report:statsTable(matchId)`), renderer solely renders. **Do not** reimplement CC detection in renderer.
- **UI**: Add "Stats" option to `Meters.tsx` mode segmented control (damage/healing/damage taken), rendering table (`StatsTable.tsx`) on selection; friendly/enemy colors follow `--ink`/`--ink-2`.
- **Detail Expansion** (deferred to v2): Clicking rows expands breakdown (timestamp + spell), linking timestamps to #8 seekTo.
- **Testing**: Unit tests for IPC table data using fixtures with interrupts and dispels.

## 11. Replay Enhancement Trio ✅ (Implemented 2026-07-17 `c03731f`: HP numbers + dampening tracker + cast flashing; **real cast bars added 2026-07-18**: parser L3 collects castStarts, deriveCastBars pairs start→SUCCESS=complete/recast/4s timeout=interrupted, gold/red progress bars; legacy doc lacks fields naturally, re-importing populates them)

**Requirement & Legacy Equivalent**: (a) **Dampening Tracker** (`ReplayDampeningTracker`) — Persistent dampening % display in replay control bar corner; (b) **Cast Bars** (`ReplayCastBar`) — Progress bars below casting units (start/interrupt/completion events already in doc); (c) **Unit HP Numbers** (`ReplayHpNumbers`) — Numeric HP% text beside health bars.

**Implementation Highlights**:

- Pure renderer implementation, data sourced from parser doc / existing derive layer: dampening inferred from aura events, casts from `deriveCasts` start/end events, HP numbers from interpolated replay samples.
- Integrated into `ReplayView.tsx` sub-rendering; ensure controls layout does not crowd 1x/2x/4x speed controls.
- (b) Detail edge cases: interrupted vs completed vs channeled — align predicates with `matchTimeline` channel semantics (SPELL_CAST_SUCCESS on channels marks beginning, not completion).

---

## Explicit Non-Goals List (2026-07-17 Comparison Conclusions, preventing future re-litigation)

- **15 Flat Tabs Structure**: Fragmented experience; 3-view segmented controls are significantly better.
- **Video/OBS Recording Tab**: Requires full recorder subsystem; diverges from product core.
- **Cloud Sharing URLs / Community / Ladders / CharacterStats / CompetitiveStats**: GladLog is local-first; sharing needs are fulfilled via C3 standalone HTML export rather than cloud infrastructure.
- **CombatMistakes Rule Library Monolith**: Replaced by modern AI + deterministic findings pipeline; however `mistakeKnowledgeBase.ts` remains a useful reference catalogue for potential deterministic checks.
- **CombatLogView Raw Log Viewer**: Developer view (DevPanel) already covers debugging needs.
- **Player Gear/Talent Tabs + External Links** (ArmoryLink/CheckPvP/Drustvar/GearStick/Seramate): Nice-to-have, appropriate for future player popovers, not separate tabs.

**Recommended Implementation Order**: #7 (quick visibility) → #6 (core value) → #8 (differentiation) → #9 → #10 → #11.

---

> Items #12–#19 originate from 2026-07-18 player-perspective brainstorming (evaluating three user personas: rating climber healer / casual player / DPS).
> Priorities: P0 = Dictates first-night retention; P1 = High-frequency friction; P2 = Low-frequency edge cases.
> DPS Direction documented separately (strategic initiative, see `2026-07-18-dps-direction-brainstorm.md`).

## 12. Recording Status Visibility + Prominent Warning for Inactive Logging ⬜ (P0 — Foundation of Trust)

**Requirement**: The fatal failure mode for players is "playing an entire evening forgetting `/combatlog`, recording nothing". "Is it recording?" is currently hidden in developer views. The main interface must permanently display logging status; detect anomalies (monitoring active but no new matches/growth over time) with prominent warnings; recommend auto-logging addons during onboarding.

**Implementation Highlights**:
- Top bar status indicator (● Green = monitoring active & file growing / ● Yellow = monitoring active but no writes today / ● Red = directory unset or unreadable), powered by `logs:getStatus` + `onStatusChanged` (existing IPC used by DevPanel).
- "Played without recording" heuristic: main watcher tracks file size/offset; if app runs >30min and WoW process is active (or fallback: "log un-updated for 2h while app accessed") → render banner: "Type /combatlog in game or install an auto-logger addon".
- Add recommended addon section to onboarding and manual.

## 13. Advanced Combat Logging Guidance ⬜ (P0)

**Requirement**: When Advanced Logging is disabled, replay shows only "No position data", leaving players unsure how to resolve it. Provide step-by-step guidance (System Settings → Network → Advanced Combat Logging) + pre-flight detection.

**Implementation Highlights**: Parser/monitor detects `ADVANCED_LOG_ENABLED,0/1` from log headers; expose `advancedEnabled` in meta/status; render clear enabling instructions in replay empty state and first-launch onboarding; list rows indicate matches lacking advanced data.

## 14. Non-AI Experience Polish + API Key Guidance ⬜ (P0)

**Requirement**: Anthropic API keys present significant onboarding friction for casual players, risking underutilization of AI features. While remaining strictly local-first: ① Highlight deterministic non-AI review features (death recap, stats tables, offensive window bands) in AI empty states ("Available without an API key"); ② Provide a "How to get a key" link in settings with estimated costs (~$0.01 per match); ③ Display deterministic candidate events in AI view when no key is configured (`hadNarration=false` path exists; treat as a feature rather than degradation).

## 15. UI i18n + Spell Name Localized Hover ⬜ (P0 — Bidirectional Pain Point)

**Requirement**: Chinese-only UI hinders international adoption; English spell names in findings feel unfamiliar to CN client users. ① Extract UI strings for i18n (`zh`/`en`, reusing `settings.aiLanguage` or dedicated `uiLanguage`); ② Display localized spell names on hover (swimlane chip titles, stats breakdown, death recap).

**Implementation Highlights**: Centralize UI strings into `renderer/src/i18n.ts` dictionary + `t()`; localized spell name data source = original `zhCN` spellName from logs (present in parser doc!) or datagen multilingual spell table (`genSpellNames` enUS pipeline extensible with locale parameter). Extract in phases (top bar/settings/onboarding first, then report).

## 16. Session Grouping + Nightly Summary ⬜ (P1)

**Requirement**: Arena players queue in sessions and review afterwards. Group match list by sessions (time gaps >1h); render session summary headers (W-L record, most frequent opponents, worst matchups); add "Current Session" filter in dashboard.

**Implementation Highlights**: Pure meta derivation (startTime clustering), add `sessions.ts` adjacent to `dashboard.ts`; session headers = sticky mini-rows; add "session" option to dashboard period selector.

## 17. Auto-Analyze Toggle + Completion Notifications ✅ (P1; `autoAnalyze` in settings — found 2026-10-20)

**Requirement**: Automatically trigger AI analysis upon match completion (opt-in, default off), dispatching desktop notifications when complete.

**Implementation Highlights**: Add `autoAnalyze: boolean` to settings; main process calls `analysis.run` on `matchStored` (if key configured and toggle active); trigger Electron Notification on completion. Manage concurrency against manual generation triggers.

## 18. First-Time Coach Marks ⬜ (P1 — Discoverability, near-zero cost)

**Requirement**: Death triangles, stats mode, swimlane chips, and window bands are clickable but rely on serendipitous discovery. Provide 2–3 one-time tooltip callouts on first visit to each view (persisted in localStorage).

## 19. Operations Trio ⬜ (P2)

- **Disk Cleanup**: Settings page displays matches directory size; archive or prune `raw.txt` by age/count (`match.json` preserved for replays);
- **Large Match Performance**: `MatchReport` computes entire derive suite synchronously on mount — defer `statsRows`/`vulnBands` to idle or view activation (substitute light count derivation for tab visibility);
- **Crash/Quarantine Visibility**: Display user-facing notification when log files are quarantined rather than failing silently.

> **Replay Burst Visuals** (pulsing red highlights on enemy major CD activations, targeting lines during 3-man focus bursts) and **Counter-argument Preemption Findings** (findings explicitly stating "you were not CC'd at the time", etc.) are consolidated into the DPS direction design document — equally critical across both roles.
