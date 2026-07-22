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

## 2. Interrupt (kick) dashboard ✅(2026-07-22 与 #3 打包落地,f145aaf:KickDashboard 两队聚合 + 逐条审计 + seek;与爆发账本同谓词 analyzeKickAudit)

A per-match (and maybe cross-match) view of interrupts: kicks landed vs. missed,
by player, interrupt availability windows, locked schools, wasted kicks.

- **Already have the data:** `packages/analysis/src/utils/enemyInterrupts.ts`
  (`computeEnemyInterruptAvailability`) + the `[KICK]` timeline events in
  `buildMatchContext`. This is mostly an **aggregation + renderer** on top of
  existing analysis, not new parsing.
- **Scope signals:** small–medium. A new report tab/panel in the desktop
  renderer + a small aggregator in `analysis` (kicks by caster/target, hit/miss,
  interrupt uptime). Reuse the report UI patterns (FindingsList/TimelineStrip).

## 3. Purge / dispel dashboard ✅(2026-07-22 与 #2 打包落地,f145aaf:DispelDashboard 账目双向 + 漏 purge/漏解列表 + CC 解除率;reconstructDispelSummary 同谓词)

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

## 9. Match search / filter ✅(2026-07-22 收尾,fc2c73b:原有 胜负/赛制/单专精 基础上补 comp(专精 chips 同队全含)与日期范围;#12 全量 meta 常驻后纯客户端过滤即覆盖全集,未动 MatchStore)

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
- ~~**zh/EN analysis-language toggle**~~ ✅(实为已完成、状态未更新:settingsStore.aiLanguage + buildCoachSystemPrompt 语言注入 + 按语言分缓存 + SettingsPanel 开关 + 面板跟随,全部 LLM 出口——叙事/深挖/findings/对比解说——均消费该设置;2026-07-22 核实)— the prompts/output are zh-leaning; a
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

| 指标           | 修前       | 修后       |
| -------------- | ---------- | ---------- |
| 应用冷启动     | 18.7–24.0s | 1.59–1.72s |
| 报表首渲       | 21.9–27.0s | 2.12–2.19s |
| 视觉套件总耗时 | 3.0 分钟   | 22 秒      |
| E2E 套件总耗时 | 1.3 分钟   | 14.5 秒    |

`qa/budgets.ts` 的三个预算随之从 5100/41000/36000 收紧到 4900/3300/2600。

**留给后来者的教训**:大 JSON 进 bundle 之前先确认它走的是 `JSON.parse` 而不是
对象字面量。这个坑没有任何报错,只表现为「启动很慢」,而且大到一定程度才显形。
质检体系的性能预算就是为了让这类回退不再靠人肉察觉 —— 它是被
`[budget] coldStart` 量出来的,不是被谁「觉得有点慢」发现的。

---

## 14. eval / QA 体系遗留(2026-07-20 记入)

> **2026-07-22 收尾轮补记**:
>
> - **d243f4b 三修复的 judge 层复评已做**(同一 35 个 layerb flagged 场,HEAD 重建 prompt →
>   sonnet 重新回复 + 判分,35/35 provenance 绿):accuracy 均值 **1.89 → 4.14**、flagged
>   **35 → 2**、捏造级 **4 → 0**、DMG SPIKE 起止混淆类 **~13 → 1**、单位归属类 **~11 → 3**。
>   口径限制(回归均值 / 端到端不可拆解归因)与逐条证据见
>   `gladlog-eval-private/runs/2026-07-22-recheck/recheck-report.md`。
> - **✅ noise 重锚定副作用已修(2026-07-22 拍板走 (a) 单独定档)**:`templateDuplicateRatio`
>   在 eval-baseline.md 里单独定档(≤45% 不扣;45–60% → 3;>60% → 1,阈值取自 1245 场
>   自然分布 p50=31.2%/p90=40.7%/p99=49.1% 之外)。规则规定分全语料 3.03 → 4.92
>   (旧规则 1207/1245 场压 3 档;新规则仅 49 场真尾部落 3 档、0 场落 1)。校准不受影响
>   ——校准件无 quality-report,判官本就跳过一致性规则。
> - **✅ §7ter 已启用(2026-07-22 拍板)**:sufficiency(det-gate 维)移出其他维的特异性
>   判定。同一批 `scores-det3` 分数:accuracy 90→100、inferenceScaffolding 90→100、
>   outcomeAlignment 90→100、labelBias 80→90、noise 90 不变、focusCalibration 100 不变
>   ——**7/7 全过且最低 90%**,压线维清零。
> - 14.3 维持 monitor(本轮是 flagged 子集复评,不构成新 baseline,不作观察点)。

这四项来自 2026-07-20 的 prompt 缺陷修复轮 + 盲评 A/B 收官。14.1 已修,
14.2–14.4 未做,按处理顺序排。三项余下的**都在 `packages/eval` 内**(评测体系
自身),不进产品包,不阻塞发版。背景见
`docs/reports/2026-07-20-prompt-defects-and-blind-ab.md`。

### 14.1 `report-replay` 视觉测试 flaky ✅(2026-07-20 已修)

**症状**:CI 在 `0eeabb2` 上失败于 `场景 report-replay 与基线一致`,
1871 px(全图 0.01 比例)不一致。该 commit 只改 `packages/eval/src/quality/`
两个文件、零 renderer 代码;下一个 commit(`258dcdc`)跑同一测试为绿。

**根因不是渲染时序**(本条最初写的「有时间轴/动画,怀疑渲染未静止」是错的,
`playing` 初始为 false,rAF 循环压根没跑)。真根因是**基线里嵌了一张公网图**:
`ReplayView.tsx` 的竞技场底图 `<image href={arenaMapUrl(zoneId)}>` 指向
`images.wowarenalogs.com`,运行时现拉。真底图是「透明背景 + 不透明碰撞体」的
形状图,所以拉到了就多画几块灰色障碍、没拉到就少画 —— 同一份代码两种像素。

从失败产物取的硬证据:差异框死在 x174-279 / y196-272,**actual 侧每个差异像素
都是同一个背景色 `[26,27,40]`**,expected 侧是中性灰 `[98,99,105]`/`[120,121,128]`
—— 不是抖动,是「那一层整个没画」。

**修法**:`qa/support/stubExternal.ts` —— 已知外部资源用就地生成的固定桩 PNG
fulfill,其余一律 abort 并记进**泄漏账本**,由用例断言账本为空。新加 CDN 依赖
会指名打红,而不是留一颗随机红灯。顺带把 Inter 从 Google Fonts 换成
`@fontsource` 自托管(同一类隐患,且产品离线时全 UI 会掉回系统字体)。

**验证**(同一次构建,外网通 vs 断,整页像素比对):

|                     | 差异像素                                        |
| ------------------- | ----------------------------------------------- |
| 修前 · 页面层       | 33192(bbox x16-1261 y28-936,几乎满页)           |
| 修后 · 页面层       | 2286(只剩底图;产品仍从 CDN 取,离线降级为无底图) |
| 修后 · 基线层(打桩) | **0**                                           |

修后页面层的 bbox 与线上那次失败的 x174-279 y196-272 逐像素吻合,即本机完整
复现了故障。基线重生成后七张里只有 report-replay 变动,另外六张字节级一致。

**遗留**:产品侧底图仍走 CDN(vendoring 涉版权+体积,见 `arenaMaps.ts` 注释),
离线用户看到的是无底图降级。此为刻意保留。

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

**订正(2026-07-20 全语料轮)**:原文记的「检出率 20%」把**套件缺陷**算进了判官头上。
`removed-deaths` 删的是 prompt 里的死亡行而 response 不动,回复中关于该死亡的主张
于是真的不再被 prompt 支持,accuracy 本就该掉 —— 判官在正确地做事,却被特异性规则
判违规。修掉这个前提错误后(`751f6bc`,构造性耦合豁免),该维检出率 20% → 60%。

**定稿(n=10 套件,80 件,同日晚)**:盲区是真的,而且比订正稿估的**更严重** ——
10 例里 **6 例 `5→5`**(死亡行全部删光、判官一分不扣),纯敏感性失败。检出率 40%。
n=5 两轮 + n=10 一轮三次独立测量,这一条始终复现。上面两个修法方向仍然成立。

**n=5 不可信,已实证**:同一 rubric 下,focusCalibration 从 40% 变 80%、noise 从
80% 变 50% —— 两维在样本翻倍后几乎对调。除 inferenceScaffolding(n=5 与 n=10 都是
100%)外,任何基于 n=5 的维度级结论都不成立。**校准套件一律 `--source-count ≥10`。**

**终稿(2026-07-21,全 80 件在最新 rubric 下重评,`scores-det3`)**:盲区**第五次复现,
且更深** —— 检出率 40% → 30% → **20%**,10 对里 8 对未检出且**全部零反应**
(`5→5` 五次、`4→4` 两次、`3→3` 一次)。三轮 rubric 改动(`cca541c` / `3d92ba3` /
审计集上限 `d39b34b`)对它**一点作用都没有**,这与「结构性、提示词修不好」的判断一致。

**结论:走第二个方向,别再试第一个。** 交给 `qualityCheck` 的确定性覆盖门,
`eval-ab.md` 本来就是这么规定的。这是绕过,不是修复 —— 但五次测量之后,
「改 rubric 加覆盖清单锚点」这条路没有证据支持继续投入。

**✅ 结案(2026-07-22):覆盖门已落地。** `checkCalibration` 对 removed-deaths 对子改由
确定性覆盖门裁决(`checkFriendlyDeaths` × ground-truth manifest,与生产 `qualityCheck`
同一谓词;`removeDeaths` 扰动也改为 import 同一个 `DEATH_KEYWORDS`,谓词单源)。判官
盲分照常记录,仅无裁决权。同一套件、同一批判官分数(`scores-det3`)前后:**检出
2/10 (20%) FAIL → 6/6 (100%) PASS**(4 对源场无友方死亡,门无管辖权记 unscored,不算
检出也不算漏检);**校准总账 6/7 → 7/7,exit 0**。manifests 被清理过的老 run 需用同一
日志清单重建后按 matchId 对齐拷回(2026-07-20-smoke 已做)。§7ter 的「sufficiency 移出
特异性检查」仍待人拍板 —— 但其前提(该维确由确定性门独立裁决)现已成立。

**附带发现(待人拍板,别自行采纳)**:sufficiency 现在也是**最大的泄漏源** ——
其余六维一共 6 件未检出全是特异性漂移 2,其中 **4 件的漂移维就是 sufficiency**。
把它移出特异性检查,六维会升到 90–100%。**但那是「调门规直到变绿」**,只有当
sufficiency 确实由确定性门独立裁决时才成立。详见
`docs/reports/2026-07-21-judge-variance-v3.md` §7ter。

### 14.5 accuracy 判官间方差 ±2 —— factAudit 的 3 条主张应当固定而非判官自选

**实测**(2026-07-20,n=10 套件):`noise` 与 `labelBias` 的失败**全是特异性**,
敏感性都很好(5→3、5→1),渗漏维一律是 `accuracy` 且 drift=2。

**根因不是套件**。逐案查了 case-06/13/49 被判 refuted 的主张 —— 分别是「Hammer of
Justice 认错人」「Life Cocoon 冷却状态误判」「41% 血量差一秒」,这些错误**在回复
原文里本来就存在**。而 `duplicated-noise` 只改 prompt、不碰 response,对照组与扰动组
判官看的是同一份回复,一个给 accuracy=5、一个给 3。

真机制:rubric(`eval-baseline.md` PASS 1)让判官**自选**"最承重的 3 条主张"做事实
审计。不同判官抽到不同的 3 条 —— 抽中含错的就扣分,没抽中就满分。于是 accuracy 的
判官间方差达 ±2,而特异性容差是 ±1,结构性打不过。

**已试并测量(`cca541c`,同日):把审计集改为规则确定** —— 取回复里全部含 `M:SS`
时间戳的断言句(上限 12,不足 3 补齐),且 accuracy **只按该集合打分**。重评那 30 件
(10 源 × {none, severity-labels, duplicated-noise},即回复与可查证内容完全相同的三类):

| 判据               | 修前(自选 3 条) | 修后(规则集) |
| ------------------ | --------------- | ------------ |
| accuracy 极差 均值 | 1.00            | 0.80         |
| 最大极差           | 2               | 2            |
| 极差 ≥2 的源数     | 4               | 3            |
| 完全一致的源数     | 4               | 5            |

**效果未证实。** 幅度 −20%,n=10 下与噪声不可分;且是位移不是收缩(源 3 从 2 降到 0,
源 1 反而从 0 升到 2)。改动本身是有原则的(消掉一个任意自由度、审计变得可复核),
故保留,但**不得当作已解决**。

---

**结案(2026-07-21)** —— 详见 `docs/reports/2026-07-21-judge-variance-v3.md`。

后续两轮改动把这一条做完了,但**赢的地方跟标题写的不是同一件事**:

| 判据(尺度无关)                      | 自选 3 条 | 规则集 `cca541c` | 查表锚点 `3d92ba3` |
| ----------------------------------- | --------- | ---------------- | ------------------ |
| **errCount 极差均值**(判官实质分歧) | 0.50      | **0.30**         | 0.50               |
| 锚点应用噪声(accuracy ≠ 5−errCount) | 9/30      | 8/30             | **0/30**           |
| 查证检出总数(30 件)                 | 6         | 11               | **21**             |

- **真正修好的是「同一个发现给不同分」**:v2 里 errCount=1 的 11 件,accuracy 给了
  8 次 3 分、3 次 4 分;v3 的 16 件**全是 4 分**,30/30 零例外。这一项是纯噪声、零信号,
  消掉是净收益。
- **判官间实质分歧没降**:errCount 极差回到 0.50,与最初持平。剩余方差**全是查证漏检** ——
  三个判官读完全相同的 response,找到的错误集合可以是 {A} / {A,B,C} / {C}(源 001 实例)。
- **⚠ 登记判据(accuracy 极差 1.00 → 0.80 → 0.50)看着连降两轮,但换不来 A/B 判别力**:
  查表把「1 个错」的扣分由 2 分改成 1 分,噪声与信号同比例缩小。教训已单独记录 ——
  比较评分类指标前,必须换算到不随锚点变化的底层计数。

**锚点这条路已见底**(0/30 违规,无剩余空间)。若还要压方差,方向是**查证漏检**:
可考虑要求判官对每条主张写出它在 prompt 里的**行号**,把「查过了」变成可核对的痕迹。

**校准总账:4/7 → 5/7 → 6/7**(见 14.2 终稿),门槛 5/7 已过,Layer B 不再被挡。

~~**剩余方差在别处**:修后判官审计的是同一批主张,仍能差 2 分 —— 说明分歧在「同一条
主张判 verified 还是 refuted」以及「n 个错映射到哪个锚点分」,即**锚点校准**,不是抽样。
下一步该往这个方向查,而不是继续动审计集。~~
**(2026-07-21 推翻:这条猜对了一半。)** 当时把两个机制混在一起写了。实测拆开是 ——
「n 个错映射到哪个锚点分」确实是问题,而且**已被查表锚点彻底解决**(违规 9/30 → 0/30);
但「同一条主张判 verified 还是 refuted」**不是锚点问题,是查证漏检**,查表对它零作用
(errCount 极差 0.30 → 0.50)。剩余方差全在后者,见上方结案表。

**连带修的自伤**:改 PASS 1 时没同步 `factAudit` 长度约定,格式段与
`checkScoreProvenance.ts` 都还锁着「恰 3 条」,导致重评的 30 件里条数从 3 到 12 都有
(子代理各自解释不同)。已把 validator 放宽为 [3,12] 并要求记录完整规则集(截断等于
丢掉可复核性,而可复核性正是这次改动的目的)。教训:改判官流程时,凡有脚本在
校验该流程产物的,必须同一提交里一起改。

**同一个自伤 2026-07-21 又来了一次**(上限 12 → 20 时,`provenance.test.ts` 两个用例
写死 12,88 个测试里红了 1 个)。这次连带修了,并把常量导出成 `FACT_AUDIT_MIN/MAX`、
用例改为从常量推导,另加 `factAuditBounds.test.ts` **解析 rubric 文档、断言文档里的
数字等于校验器常量**(把常量改回 12 验过,3/3 失败,不是空过)。**同类漂移到此为止。**

**曾走过的弯路**(勿重蹈):一度假设 `duplicated-noise` 构造性耦合 accuracy(复制
改变计数、rubric 要求重新计数),打算加进 `COUPLED_BY_CONSTRUCTION`。逐案验证后
**证伪**。连续放宽豁免表直到门变绿,正是该表注释里警告过的失败模式。

### 14.3 两个 accuracy 代理指标轻微指向 treatment 更差(monitor)

2026-07-20 A/B(50 对)两个独立指标同向:

| 指标                 | Δ      | 95% CI            | n=50 的 MDE |
| -------------------- | ------ | ----------------- | ----------- |
| accuracy(1–5)        | −0.30  | [−0.66, +0.06]    | 0.36        |
| factAudit refuted 率 | +5.3pp | [−2.4pp, +13.1pp] | —           |

**都不显著**,且都在该样本量的可测门槛以下。

**已排除的解释**:不是「prompt 变长 5% / 新增 86 条 DR 标注给了更多可引用的料」——
实测两臂被驳回主张里,claim 原文提及新标注面的**都是 0 条**。

**无进一步动作**;下一轮 baseline 顺带观察。若同向再现且 n 更大,再查。

### 14.4 `blindPool` 盲件缺 matchId 占位约定 ✅(2026-07-22 结案)

本轮盲件不含 `MATCHID:` 头(按设计剥离),但 judge 指令要求 score JSON 写 `matchId`,
于是子代理各自编了 `null` / `"unknown"` / `"NO_MATCHID_HEADER_FOUND"` 三种写法。
不影响本轮统计(`abStats` 按 blindId 关联),但会给后续按 matchId 聚合的分析添堵。

**修法**:占位约定固化为 `matchId = 盲件 id(item-NN)`——盲件目录名本身就是稳定且不
泄漏臂别的 id,真实 matchId 聚合一律经 `blind/mapping.json` 换算。两处落地:
`eval-ab.md` 判官模板明确写「set matchId to exactly ITEMID,不许编、不许找」;
`abCompareStats` 解盲时核对该字段——不合规记警告,**等于真实 matchId 按破盲嫌疑
单独告警**(盲件里没有这个信息,判官只可能越权读文件得到)。
