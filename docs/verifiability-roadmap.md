# gladlog verifiability roadmap

**Goal:** make every layer of gladlog _verifiable_ — its output provably traces
to verifiable inputs, end to end: raw log → parse → analysis → AI prompt/output →
UI → export. The PROMPT pillar already enforces this ("every claim grounded in a
real event"); this roadmap extends the same discipline to LOG and VISION so the
whole app is a chain of grounded, independently-checkable transforms.

**Two audiences — not just CI.** These checks serve two purposes, and the second
is as important as the first:

1. **CI / regression gates** — catch breakage over time.
2. **Cross-agent verification & feedback** — the substrate that lets one agent
   objectively check another's work and hand back _grounded, actionable_ feedback.
   This is how gladlog is actually built (agy/Gemini implements → Claude verifies
   via deterministic gates; Claude writes → agy re-verifies; the eval harness's
   LLM-judge literally is one agent scoring another). A check is only useful for
   this if an agent can **run it headlessly** and read a **legible diff** ("field
   X diverged from source Y at Z") that a fixing agent can act on and a reviewing
   agent can re-confirm. Design every check as a produce → verify → feedback loop
   primitive, not just a red/green CI light.

This is a **roadmap**, not a spec. Each sub-project below gets its own
brainstorm → spec → plan → implementation cycle when picked up.

## Current state (2026-07-24: roadmap complete except F170)

| Pillar     | Today                                                                                                                                                                                                                   | Verdict                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **PROMPT** | 3 honesty gates (`auditFindings` grounding/numeric/causal, `causalLint`, `claimChecker` + template interpolation) + 12-tool eval harness (blind A/B, calibration, provenance, `positioningScan`, `contestedContract`)   | Strong — the reference for the others                     |
| **LOG**    | 13 parser test files, golden fixture test, byte-exact log-pipeline reconstruction, **A1 differential oracle** (2026-07-13), **A2 invariants** (6 codes, 0/1245 corpus violations) + **A3 coverage corpus** (2026-07-23) | Strong — oracle + intrinsic invariants + curated coverage |
| **VISION** | **C1 data-faithfulness** (2026-07-12) + **C2 视觉回归**(Playwright 7 场景 + axe + E2E + 性能预算,2026-07-19)+ **C3 Markdown 导出保真**(导出与渲染共享同一 derive)+ **图片导出**(离屏同 renderer 整页截图,2026-07-24)                      | Strong — all three facets landed |

## Guiding principle

A transform is _verifiable_ when: (1) its output is a pure function of named,
inspectable inputs; (2) an automated check proves the output is consistent with
those inputs; (3) failures are legible (say what diverged and where); (4) the
check runs **headlessly and emits a machine-readable diff**, so an agent — not
just CI — can invoke it, act on the result, and have another agent re-confirm.
PROMPT achieves this via grounding + claim-checking. LOG and VISION should too.

---

## Pillar A — LOG (parsing) verifiability

Prove the parser turns raw combat logs into correct structured matches.

- **A1. Differential oracle** ✅ _(done 2026-07-13)_ — a standing, re-runnable
  parity gate in the private repo (`~/code/gladlog-eval-private/oracle/`) that
  diffs the old-fork parser vs the new parser on real logs: Level-1 core facts
  (roster/spec/team/result/deaths/damage+heal totals, damage & heal checked
  per-combat-total against M4-grounded envelopes) + Level-2 prompt marker-class
  presence (corpus-level, catches a whole analysis block dropped — R1/R3-class).
  Alignment by death-signature LCS; salvage (new-side shuffle/DC recovery)
  adjudicated. Machine-readable `report.json` + non-zero exit on any new
  unadjudicated diff; `npm run verify:parser-oracle` (skips without the private
  repo — never in public CI). Clean-room: only `runOld.ts` touches the old fork,
  emitting JSON the oracle consumes. First run: subset 3696 → 0 unadjudicated,
  and it surfaced a real finding (see backlog: new `[ENEMY HARD CAST]` narrower
  than old). Spec `docs/specs/2026-07-13-parser-differential-oracle-design.md`.
- **A2. Invariants / property tests** ✅ _(done 2026-07-23, release/0.1)_ —
  `packages/parser/src/invariants.ts` `checkParserInvariants`:six codes
  (time-bounds / monotonic / hp-range / death-has-damage / pet-owner-resolves /
  start-before-end), bounds **measure-then-lock** against the 1245-match corpus
  (first sweep 1021/1245 violations under naive bounds → measured real
  distributions: max monotonic regression 2084 ms → tolerance 5 s; max hp/maxHp
  1.582 → bound 1.75×; shuffle-round trailing ≤34.1 s → grace 60 s) → **re-sweep
  0/1245**. Unit tests on the synth generator (which the invariant itself caught
  lying: victim died with zero damageIn — generator fixed) + corpus sweep gate
  `packages/eval/scripts/parserInvariants.ts` (exit 1 on any violation).
- **A3. Fixture-coverage corpus** ✅ _(done 2026-07-23, release/0.1)_ —
  `packages/eval/scripts/coverageCorpus.ts`:greedy set-cover over coverage facts
  (7 healer specs × 3 brackets × edge cases crlf/pets/shuffle/unconscious) picks
  a minimal manifest from the 1245-match corpus; writes eval-private
  `corpus/manifest-coverage.txt` + `coverage-report.json`; `--check` mode detects
  drift (facts no longer covered) for standing re-runs.

## Pillar B — PROMPT (LLM) verifiability

Already strong; close the known holes.

- **B1. LLM-judge causal audit (SP-A.1)** ✅ _(done 2026-07-23, release/0.1)_ —
  new calibration perturbation class **causal-hardening**
  (`buildCalibrationSuite.ts` `hardenCausation`: takes two real timestamps from
  the response and welds them into an unsupported "direct result … no other
  factor contributed" causal chain). Controlled v1→v2 measurement on 20 pairs
  (10 hardened), sonnet judges, provenance-verified (20/20 prompt+response
  hashes match untouched inputs), report hash stable across double runs:
  **v1 detection 5/10 = 50% FAIL** → two fixes — (1)
  `COUPLED_BY_CONSTRUCTION["causal-hardening"]=["outcomeAlignment"]` (the
  injected sentence IS an outcome verdict; judges' notes named it, per-case
  evidence in `checkCalibration.ts`), (2) rubric PASS-1 rule 5 in
  `docs/commands/eval-baseline.md` (causal-connective claims must enter the
  audit set; temporal adjacency ≠ causal support; "no other factor" exclusivity
  without log support = unsupported) → **v2 detection 8/10 = 80% PASS**
  (threshold 0.8; the 2 residual misses are pure sensitivity noise: one 2→2 no
  delta, one 3→4 reversed). Artifacts: eval-private
  `runs/2026-07-23-causal/` (v1 report archived as `calibration-report-v1.md`).
- **B2. Full provenance trace** ✅ _(done 2026-07-23, release/0.1 — event-level)_ —
  finding → candidate event → raw-event deep link in the app: FindingsList
  "⛏ 原始事件" anchors on the earliest evidence event and drives EventsPanel
  into a ±window + unit filter (`inspectReq` prop, nonce-consumed); the events
  view renders the underlying parsed events for any finding. Export (C3)
  carries the same chain into Markdown. **Raw-line level(2026-07-24 补齐):**
  分段器给每条 ParsedLine 记 `lineIndex`(records/rawLines 同步推进的唯一
  对齐点),L3 事件与 compat `ILogLine` 透传,doc 原样携带;`matchStore.rawLine`
  按 shuffle 前序轮 linesTotal 累加偏移读 raw.txt;事件视图逐行「㏒」展开
  原始日志行。门规:A2 新增 `line-resolves` 不变量(事件必带 lineIndex 且
  重解析后 eventName/timestamp 一致),全语料 **0/1245**。旧档无 lineIndex
  → UI 降级隐藏。
- **B3. Robust parsing + eval coverage** ✅ _(done 2026-07-24, release/0.1)_ —
  容错解析半边 2026-07-20 已单源落地(`parseModelJsonArray`,eval 三个审计
  脚本与产品 `analysis.ts` 同谓词);eval 覆盖半边:`/eval-baseline` Step 1
  改为**优先消费 A3 覆盖清单** `corpus/manifest-coverage.txt`(贪心集覆盖保证
  7 治疗专精 × 3 括号 × 4 边角在场,先 `coverageCorpus.ts --check` 验漂移),
  `manifest.txt` 仅作复现旧口径的回退。

## Pillar C — VISION (UI) verifiability _(user: all three facets)_

The weakest pillar; make the UI as honest as the LLM output.

- **C1. Data-faithfulness (the UI can't lie)** ✅ _(done 2026-07-12)_ — the on-brand
  core. Render-math extracted to pure, tested selectors (`report/derive/meterRows`,
  `timelineMarks`, `cohortDims`); the meters/cohort/timeline components are dumb
  renderers. `report/derive/faithfulness.ts` `checkFaithful(kind, root, selectorOutput)`
  walks the rendered DOM and emits `Divergence[]` on (A) view-faithful mismatches
  (rendered ≠ selector, incl. tooltips + non-% units) and (B) non-circular structural
  invariants (meter range/monotonic/max-100/format-roundtrip; cohort percentile
  order-consistency vs p10/p90; timeline bounds/leftpct/maps-to-event). It deliberately
  does NOT re-derive aggregation or percentile (would false-fail on pets / be circular —
  agy debate). Each check has a has-teeth test; `npm run verify:vision` runs headlessly,
  prints JSON diffs, exits non-zero. Spec: `docs/specs/2026-07-12-vision-data-faithfulness-design.md`,
  plan: `docs/superpowers/plans/2026-07-12-vision-data-faithfulness.md`.
- **C2. Visual regression** ✅ _(done 2026-07-19)_ — Playwright 截图 7 个
  URL 可直达的场景(战报/回放/AI/合成/仪表盘/设置/列表),基线是 **linux
  单源**、由 CI 生成与判定、由人审后提交;同一批加载顺带跑 axe(WCAG 2.1
  AA,违规必须 ⊆ 显式豁免清单)。附带落地:`_electron` 驱动的 E2E 三条
  核心链路(导入→报告 / 证据链跳转 / 教练闭环+重启持久化),以及
  measure-then-lock 的三项性能预算(解析/首渲/冷启动)。
  规格 `docs/superpowers/specs/2026-07-19-frontend-qa-design.md`。
- **C3. Export fidelity** ✅ _(done 2026-07-23, release/0.1 — Markdown)_ —
  `report/derive/exportReport.ts` `buildReportMarkdown` builds "Copy Markdown"
  from the **same derive functions the UI renders from** (kickDash / dispelDash /
  auraUptime / mistakes / statsTable …), so exported numbers == rendered numbers
  by construction (shared-predicate rule, not a diff); round-trip tests assert
  exported values match derive output on the real fixture. **Image(2026-07-24
  补齐):**「导出图片」= 主进程离屏窗口加载**同一个 renderer**(hash 路由
  `#export-report=<id>`,`ExportReportPage` 渲染同一 MatchReport),页面自报
  就绪后按全文高度 `capturePage` 整页 PNG —— 像素同源是构造保证,无第二条
  绘制路径;E2E 链路4 锁管线(PNG 魔数/IHDR 尺寸 = 全文高度)。

---

## Cross-cutting — the trust chain

The capstone: one end-to-end test that walks a real log through **every** hop —
parse → analysis → findings/compare → UI render → export — asserting each stage's
output is grounded in the prior stage's. This is the single artifact that says
"nothing between the raw bytes and the shared screenshot is fabricated."

✅ _(done 2026-07-24, release/0.1)_ — `packages/desktop/test/trustchain.test.tsx`:
合成日志走 raw → parse(A2 零违规,含 line-resolves 回源)→ doc(matchStore
落盘形态)→ derive(事件行全部回源到 raw 行、单位名全真、聚合独立重加)→
render(C1 checkFaithful 零分歧)→ export(Markdown 每个数字/名字逐字来自
derive、时间戳全在时长内)。真实日志侧由 eval-private 的 parserInvariants
sweep(1245 场)覆盖 parse 跳。

## Suggested order

1. ~~**C1 (data-faithfulness)**~~ — ✅ done 2026-07-12.
2. ~~**A1 (differential oracle)**~~ — ✅ done 2026-07-13 (found a real F170 gap; see backlog).
3. ~~**C2 (visual regression)**~~ — ✅ done 2026-07-19.
4. ~~**C3 (export)** / **B1/B2 (causal judge + provenance)** / **A2/A3**~~ —
   ✅ all done 2026-07-23 on `release/0.1`.
5. ~~**B3**~~ — ✅ done 2026-07-24(容错解析 + A3 覆盖清单接入 eval-baseline)。
6. ~~**Trust chain**~~ — ✅ done 2026-07-24(trustchain.test.tsx,五跳全断言)。

### Remaining backlog

**2026-07-24:B3 / trust chain / C3 image / B2 raw-line 全部收口 —— 本路线图
除下条外无余项。**

- **F170 `[ENEMY HARD CAST]` narrower than old** — the concrete gladlog finding A1
  surfaced; in `docs/BACKLOG.md`. Fix-or-confirm, then de-allowlist in the oracle.

## Non-goals

- Not a rewrite — reuse the existing gates, eval tools, selectors, and fixtures.
- Not cloud/CI-only — checks run locally (`npm run typecheck`/vitest) first; CI
  is additive. Each is also **agent-invokable** and emits a structured diff, so
  it doubles as a cross-agent verification/feedback primitive (see Two audiences).
- The private differential/eval oracles stay private (compliance), like
  `~/code/gladlog-eval-private`.
