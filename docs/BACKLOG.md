# gladlog feature backlog

Ideas not yet scheduled. Each is a starting point for a future brainstorm → spec →
plan cycle, not a committed design. Compliance: where an item references the old
fork (`/Users/mingjianliu/code/wowarenalogs`, CC BY-NC-ND) it's for the _concept_
only — any port is clean-room (controller extracts audit-CLEAN files; the app's
data is already gladlog-native).

---

## 1. OBS / video recording integration

Record arena matches (video) and sync playback to the combat-log timeline — click
a death / finding / burst window and jump to that moment in the video.

- **Old-fork reference:** `packages/recorder` (OBS bindings — `manager.ts`,
  `noobs.d.ts`, `activity.ts`, config schema) and the playback UI in
  `packages/shared/src/components/CombatReport/CombatVideo/VideoPlayerTimeline.tsx`
  - `CombatReplay/`. The roadmap explicitly deferred the recorder ("第一版不做"),
    so this is net-new work in gladlog.
- **Scope signals:** largest item here — a recorder subsystem (native OBS/noobs
  integration, Windows-first), on-disk video↔match association, and a
  video-timeline component. Likely its own multi-task sub-project. Decide first:
  drive OBS externally vs. embed a capture lib; how video files map to stored
  matches (by timestamp window).
- **gladlog seam:** the desktop app already stores matches with `startTime`/
  `endTime`; a recording started around a match window can be associated by time.

## 2. Interrupt (kick) dashboard

A per-match (and maybe cross-match) view of interrupts: kicks landed vs. missed,
by player, interrupt availability windows, locked schools, wasted kicks.

- **Already have the data:** `packages/analysis/src/utils/enemyInterrupts.ts`
  (`computeEnemyInterruptAvailability`) + the `[KICK]` timeline events in
  `buildMatchContext`. This is mostly an **aggregation + renderer** on top of
  existing analysis, not new parsing.
- **Scope signals:** small–medium. A new report tab/panel in the desktop
  renderer + a small aggregator in `analysis` (kicks by caster/target, hit/miss,
  interrupt uptime). Reuse the report UI patterns (FindingsList/TimelineStrip).

## 3. Purge / dispel dashboard

A view of offensive purges and dispels: purges done, **missed purge
opportunities** (an enemy buff left up), by player, plus friendly dispels.

- **Already have the data:** `packages/analysis/src/utils/dispelAnalysis.ts` +
  the `[MISSED PURGE OPPORTUNITY]` / `[CLEANSE]` / `[MINOR DISPELS]` timeline
  events in `buildMatchContext`. Again mostly **aggregation + renderer**.
- **Scope signals:** small–medium, parallel to #2 (same shape: aggregator in
  `analysis` + a report panel). Could ship #2 and #3 together as a "utility
  dashboards" sub-project since they share structure.

## 4. Burst-window analysis timeline (visual)

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

## 5. Settings UI (Anthropic API key + model)

There is currently **no GUI to enter the Anthropic API key** — only the DevPanel
AI-backend dropdown. That's why the app shows `NO_API_KEY`. Add a real settings
panel: API key (write-only, redacted like the main-process store already does),
model, WoW dir, AI backend. Small; the IPC (`settings.get/save`, `redactSettings`)
already exists — this is renderer UI.

## 6. 2D positional replay

A scrubbable top-down arena replay (positions, HP, casts, dampening over time) —
distinct from #1's video. Old-fork reference: `CombatReport/CombatReplay/` (Pixi.js
— `ReplayCharacter`, `ReplayHealthBar`, `ReplayCastBar`, `ReplayDampeningTracker`,
speed control). gladlog already parses advanced-logging coordinates (positioning
section in `buildMatchContext`), so the data exists. Medium–large; shares the
timeline seam with #4.

## 7. Competitive stats / trends

Cross-match aggregation: win rate over time, per-spec/per-comp performance, a tier
list. Old-fork reference: `CompetitiveStats/` (`SpecStats`, `CompStats`,
`TierList`). gladlog stores every match locally, so this is aggregation + a new
view — no cloud needed (unlike the old fork's server-backed version).

## 8. Deterministic mistake detection

A rules-based "mistakes" engine that flags concrete errors (trinket held through a
full-DR CC, defensive wasted, kick missed) **without an LLM** — complements the AI
findings with cheap, always-available, fully-verifiable output. Old-fork reference:
`CombatReport/CombatMistakes/` (`analyzeMistakes` + `mistakeKnowledgeBase`). Fits
gladlog's honesty ethos (deterministic, grounded) and reuses the existing
`candidateFindings` / analysis utils. Medium.

## 9. Match search / filter

Filter the (now paginated) match list by spec, bracket, comp, result, date. Natural
follow-on to the windowed list — extend `MatchStore.page` with predicates and add
filter controls to the sidebar. Small–medium.

---

## Session follow-ups & hardening (smaller, not full features)

- **Tolerant JSON extraction for local models** — the analysis service does
  `JSON.parse(raw.trim())`; agy/Claude returned clean JSON in testing, but other
  local models may wrap it in ```json fences → parse fails → silent fallback.
  Strip fences / extract the first `[...]` before parsing so local backends are
  robust. (Surfaced by the MODE=local e2e.)
- **SP-A.1** — LLM-judge causal audit + digit/constant refinement (deferred from
  the SP-A honesty gate; causal/qualitative claims can't be verified
  deterministically).
- **SP-B2.1** — CDN corpus refresh (ship an updated `reference_vectors.json`
  without a full rebuild).
- **zh/EN analysis-language toggle** — the prompts/output are zh-leaning; a
  language switch for findings + narrative.
- **Timeline-prompt token compression** — the timeline-variant prompt is ~76%
  larger than the sparse one; compress it (also helps the slow `claude -p` local
  backend).
- **CI code-signing / notarization** — wire macOS notarization + Windows signing
  secrets into `.github/workflows/build.yml` when certs exist, for zero-warning
  installs. See [[gladlog-packaging-gotchas]].
- **F170 `[ENEMY HARD CAST]` narrower than old (A1 oracle finding, 2026-07-13)** —
  the parser differential oracle found the new timeline pipeline emits
  `[ENEMY HARD CAST]` (`packages/analysis/src/context/matchTimeline.ts:1350`, F170
  hard-cast kill spells Chaos Bolt/Pyroblast) in **zero** aligned combats across the
  subset while the old pipeline emits it systematically. Investigate whether the new
  side's hard-cast spell list / gating is too narrow (a real regression to widen) or
  an intentional scope change (then confirm + leave adjudicated). Currently allowlisted
  in the oracle baseline pending this. Small.
- **MatchStore hardening (accepted-low-risk today)** — `safeName` id collision →
  phantom duplicates; out-of-band `meta.json` edits go stale (index is a cache).
  Fine for the app-private store now; revisit if the store ever lives in a synced
  folder.

## 10. Surface the structured analysis (currently LLM-text-only)

gladlog computes a deep per-match analysis (~40 signals) inside `buildMatchContext`
but feeds _all_ of it to the LLM as text — the UI surfaces only the 6 healer
metrics + deaths/cd-waste. The rest is invisible to the user. Items #2 (interrupts),
#3 (purge), #4 (burst timeline) are subsets of this. Other computed-but-unshown
signals worth their own panels/lanes:

- **Diminishing returns / dampening** — `computeIncomingDR`, `computeDampeningTimeline`, `buildDampeningEvents`.
- **CC chains** — `analyzeOutgoingCCChains`, `extractAoeCCEvents`, healer-CC-received.
- **Kill windows / target selection** — `analyzeKillWindowTargetSelection`, `buildKillSequenceBlock`, contested-trade facts.
- **Positioning / LoS** — `computeOwnerPositionEvents`, `analyzeHealerExposureAtBurst`.
- **Defensive management** — `detectFriendlyCDOverlaps`, `detectOverlappedDefensives`, `detectPanicDefensives`, `findCheaperDefensiveAlternatives`, `computeCDResponseLatency`.
- **Healing gaps** — `detectHealingGaps`, `computeSlackSegments`, `computeHealingInWindow`.
- **Trinket usage** — `analyzePlayerCCAndTrinket`, `detectTrinketType`.
- **Death root-cause** — `buildDeathRootCauseTrace`, `findContributingDeath` (UI shows the death time only; the "why" is text-only).
- **Match arc / flow** — `buildMatchArc`, `buildMatchFlow`, `extractMatchDynamics`.

Approach: promote these from `buildMatchContext` text into structured events (like
`extractCandidateFindings` does for deaths/cd-waste) so both the UI _and_ the
findings pipeline can use them — and so #8 (deterministic mistakes) has grounded
inputs. Big theme; slice into panels/lanes over several sub-projects.

Note: `extractRotations` is computed but only consumed by offline `corpus-tools`,
not the app — either surface it or leave it corpus-only by design.

## 11. 战报明细 breakdown(wowarenalogs 原版 detail 级)✅(2026-07-18 已完成:meters 行内展开,输出/治疗/承伤三模式;承疗按来源与打断/驱散清单未做——用户未选)

用户提出(2026-07-18):当前战报 meters 只有每人总量(伤害/治疗一条),
信息量不如老 wowarenalogs 的 detail 视图。目标:点开一个玩家 → 具体分解:

- **输出按技能分解**:每个技能的总伤害/占比/次数/暴击率/最大一击;
- **治疗按技能分解**(含过量治疗占比);
- **承伤按来源分解**:谁的什么技能打了你多少(死亡分析的常备需求);
- **承疗按来源**;可选:打断/驱散/控制的逐条清单。

数据全在 unit 事件数组里(damageOut/healOut/damageIn 按 spellId 聚合即可),
纯 derive + 展开式 UI(meters 行点击展开或独立 detail tab)。与 #10 的
结构化面板方向互补:这是"原始账目",#10 是"分析结论"。

## 12. 懒加载后台补载 + 战绩动态更新 ✅(2026-07-18 已完成,见 App.tsx 后台补载循环 + StatsDashboard matchStored 订阅)

用户反馈(2026-07-18):当前懒加载(首屏只 parse 最近 N 场)加载确实快了,
但有两个残缺:

1. **没有后台补载**:首屏之后剩余对局不会在空闲时继续 parse,列表往下翻/
   搜索旧场次仍然缺;应在首屏渲染完成后用空闲队列(逐场、可中断)把剩余
   对局补进内存缓存。
2. **战绩仪表盘不随补载更新**:统计页仍然只算最初 load 的那几盘——补载
   完成一批后应增量重算聚合(或至少提供"已统计 X/Y 场"提示 + 手动刷新),
   否则胜率/分角色统计对老玩家是错的。

关联:docs/plans/2026-07-19-large-match-load-optimization.md(方案 A 的
workerHost 异步 parse + LRU 已设计,可作为后台补载的执行载体)。
