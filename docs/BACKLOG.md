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

## 13. 深挖全局锚点 / 非击杀失误独立发现(2026-07-19 记入)

现状:深挖是**放大镜**——只在初轮已标记 finding 的时刻窗口 `[-30s,+10s]` 内收
证据(含走位),不做全局扫描。若某时段初轮没标 finding,即使那里有走位失误/其他
证据也**不会**进深挖(见 [[gladlog-deepdive-value]])。

方向:让非击杀失误当**独立锚点 / 新 finding**,而非只作现有 finding 窗口内的补充。
raw 信号大多已有(`candidateFindings.ts` 的 `unconverted-burst` / `burst-into-immunity`
/ `off-target-in-window` / `juked-kick` / `dr-clipped-cc` / `cd-waste`,加 `computeOwnerPositionEvents`
的走位失误)。权衡:这把深挖从「把已知死亡讲透」变成「发现初轮漏掉的新问题」,
必须配同款信号门(hasCoachableSignal 精神)+ 审计,否则重引噪音/填充风险。
与 #8(确定性 mistake 引擎)、#10(结构化信号上浮)方向重叠——三者应一起想清楚
「非击杀时段帮助」的产品形态再动手。本条是那次 brainstorm 的一个候选实现路径。

## ~~spellNames 12MB 顶层 await 阻塞首屏~~ ✅ 已修(2026-07-19)

**症状**:首屏(报表渲染 / 应用冷启动)固定要等 ~22-25 秒。

**根因不是「文件大」,是「编译成了源码」**:`spellNames.json` 有 41 万个键,
Vite 5 默认把 JSON 转成 **JS 对象字面量**,V8 必须把它当源码解析。同一份数据
`JSON.parse` 只要 **42ms** —— 差了三个数量级。

**修法**:三个构建目标(main/preload/renderer)与试验台配置都打开
`json: { stringify: true }`,让 Vite 产出 `JSON.parse("…")`。一行配置,
不动任何 API、不改 40+ 个 `getEnglishSpellName` 调用点。

**效果**(CI 实测):

| 指标 | 修前 | 修后 |
| --- | --- | --- |
| 应用冷启动 | 18.7–24.0s | 1.59–1.72s |
| 报表首渲 | 21.9–27.0s | 2.12–2.19s |
| 视觉套件总耗时 | 3.0 分钟 | 22 秒 |
| E2E 套件总耗时 | 1.3 分钟 | 14.5 秒 |

`qa/budgets.ts` 的三个预算随之从 5100/41000/36000 收紧到 4900/3300/2600。

**留给后来者的教训**:大 JSON 进 bundle 之前先确认它走的是 `JSON.parse` 而不是
对象字面量。这个坑没有任何报错,只表现为「启动很慢」,而且大到一定程度才显形。
质检体系的性能预算就是为了让这类回退不再靠人肉察觉 —— 它是被
`[budget] coldStart` 量出来的,不是被谁「觉得有点慢」发现的。

---

## 14. eval / QA 体系遗留(2026-07-20 记入)

这四项来自 2026-07-20 的 prompt 缺陷修复轮 + 盲评 A/B 收官。全部**未做**,
按处理顺序排。背景见 `HANDOFF-2026-07-20-prompt-defects.md` 与
`HANDOFF-2026-07-20-ab-blind-eval.md`。

### 14.1 `report-replay` 视觉测试 flaky ★ 优先(持续制造假红)

**症状**:CI 在 `0eeabb2` 上失败于 `场景 report-replay 与基线一致`,
1871 px(全图 0.01 比例)不一致。

**已确认不是回归**:该 commit 只改 `packages/eval/src/quality/` 两个文件、
零 renderer 代码;包含它的下一个 commit(`258dcdc`)跑同一测试为绿。

**为什么值得治**:每次假红都要花时间辨真伪,久了会训练出「视觉红先当 flaky」的
习惯 —— 那时真回归就漏了。replay 场景有时间轴/动画,怀疑是渲染时序未完全静止。

**方向**:定位不稳定像素区域(Playwright 的 diff 图),要么把该区域 mask 掉,
要么在截图前等一个确定性信号(而不是靠 `disabled all CSS animations` 兜底)。
**不要**简单调高阈值 —— 那是把灵敏度换安静。

### 14.2 sufficiency 判官盲区(校准检出率 20%)

**实测**(2026-07-20 校准,40 件合成缺陷):删掉某场 prompt 里**全部**死亡相关
行后,5 件里 4 件 judge 给的 sufficiency 分数持平甚至更高(源 002 删 18 行,5→5)。
其余六维检出率 80–100%。

**含义**:judge 只看得见 prompt 里有什么,看不见构建器**没放进来**什么。
这是结构性的,不是提示词能修好的。

**方向**(二选一,未定):
- 改 rubric,给 judge 显式的覆盖清单当锚点;或
- 干脆放弃该维的盲评分,让 `qualityCheck` 的确定性覆盖门直接给分。
  现行 `eval-ab.md` 已规定该维由确定性指标裁决,盲评分无裁决权 —— 那是绕过,不是修复。

### 14.3 两个 accuracy 代理指标轻微指向 treatment 更差(monitor)

2026-07-20 A/B(50 对)两个独立指标同向:

| 指标 | Δ | 95% CI | n=50 的 MDE |
| --- | --- | --- | --- |
| accuracy(1–5) | −0.30 | [−0.66, +0.06] | 0.36 |
| factAudit refuted 率 | +5.3pp | [−2.4pp, +13.1pp] | — |

**都不显著**,且都在该样本量的可测门槛以下。

**已排除的解释**:不是「prompt 变长 5% / 新增 86 条 DR 标注给了更多可引用的料」——
实测两臂被驳回主张里,claim 原文提及新标注面的**都是 0 条**。

**无进一步动作**;下一轮 baseline 顺带观察。若同向再现且 n 更大,再查。

### 14.4 `blindPool` 盲件缺 matchId 占位约定

本轮盲件不含 `MATCHID:` 头(按设计剥离),但 judge 指令要求 score JSON 写 `matchId`,
于是子代理各自编了 `null` / `"unknown"` / `"NO_MATCHID_HEADER_FOUND"` 三种写法。
不影响本轮统计(`abStats` 按 blindId 关联),但会给后续按 matchId 聚合的分析添堵。

**方向**:`blindPool` 生成时在盲件里放一个不泄漏臂别的稳定 id,或在 judge 指令里
明确「本项留空」。
