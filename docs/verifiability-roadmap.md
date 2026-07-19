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

## Current state (uneven)

| Pillar     | Today                                                                                                                                                                                                                 | Verdict                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **PROMPT** | 3 honesty gates (`auditFindings` grounding/numeric/causal, `causalLint`, `claimChecker` + template interpolation) + 12-tool eval harness (blind A/B, calibration, provenance, `positioningScan`, `contestedContract`) | Strong — the reference for the others                                             |
| **LOG**    | 13 parser test files, one golden fixture test (`l3.golden.test.ts`), byte-exact log-pipeline reconstruction                                                                                                           | Moderate — no differential oracle, no invariants                                  |
| **VISION** | 4 functional renderer tests + **C1 data-faithfulness** (pure selectors + `checkFaithful` DOM harness + `verify:vision`, done 2026-07-12)                                                                              | Improving — data-faithfulness landed; **C2 视觉回归已落地**(Playwright:7 场景 linux 单源基线 + axe WCAG AA + E2E 三链路 + 三项性能预算,2026-07-19);export (C3) remains |

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
- **A2. Invariants / property tests** — assertions that hold on ANY parsed match:
  monotonic timestamps, HP ∈ [0,100], every death has a damage source, offsets
  consistent, `firstLineChecksum` stable, round boundaries well-formed. Fuzz over
  a real-log corpus.
- **A3. Fixture-coverage corpus** — a curated set of diverse real logs (every
  healer spec, each bracket, edge cases: pets, disconnects, resets, CRLF) frozen
  as golden tests, with a coverage manifest (which log shapes are exercised).

## Pillar B — PROMPT (LLM) verifiability

Already strong; close the known holes.

- **B1. LLM-judge causal audit (SP-A.1)** — the one class the deterministic gates
  can't check: causal/qualitative claims. A calibrated LLM-judge audit + digit/
  constant refinement (already deferred as SP-A.1).
- **B2. Full provenance trace** — every AI finding → its candidate event → the
  source log line/offset, auditable and exportable ("why did it say this?").
  Extends `checkScoreProvenance`/`judgeSpotAudit` from eval into the app.
- **B3. Robust parsing + eval coverage** — tolerant JSON extraction (local models
  may fence JSON), and widen `coverageManifest` so more spec/bracket/backend
  combinations are eval-covered.

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
- **C3. Export fidelity** — round-trip check that "Copy Markdown" / "Export Image"
  output matches the on-screen data (exported numbers == rendered numbers ==
  computed values), so a shared report is as trustworthy as the live one.

---

## Cross-cutting — the trust chain

The capstone: one end-to-end test that walks a real log through **every** hop —
parse → analysis → findings/compare → UI render → export — asserting each stage's
output is grounded in the prior stage's. This is the single artifact that says
"nothing between the raw bytes and the shared screenshot is fabricated." Build it
after the per-pillar checks exist (it composes them).

## Suggested order

1. ~~**C1 (data-faithfulness)**~~ — ✅ done 2026-07-12.
2. ~~**A1 (differential oracle)**~~ — ✅ done 2026-07-13 (found a real F170 gap; see backlog).
3. ~~**C2 (visual regression)**~~ — ✅ done 2026-07-19。**C3 (export)** 待做。
4. **B1/B2 (causal judge + provenance)** — push the already-strong pillar further.
5. **A2/A3, B3** — breadth/hardening.
6. **Trust chain** — capstone once the pieces exist.

### Next up (backlog, post C1+A1) — each its own brainstorm → spec → plan

- **C3 — export fidelity** _(next)_: round-trip "Copy Markdown" / "Export Image" output ==
  rendered == computed. Pairs with C2. Small–medium.
- **B1 — LLM-judge causal audit (SP-A.1)**: calibrated judge for causal/qualitative
  claims the deterministic gates can't check. Medium.
- **B2 — full provenance trace**: every AI finding → candidate event → source log
  line/offset, exportable ("why did it say this?"). Medium.
- **A2 — parser invariants / property tests**: monotonic timestamps, HP∈[0,100],
  every death has a source, offsets consistent, round boundaries well-formed; fuzz
  over the real-log corpus. Complements A1 (A1 = vs old parser; A2 = intrinsic).
- **A3 — fixture-coverage corpus**: curated diverse real logs (every healer spec,
  each bracket, pets/DC/reset/CRLF) frozen as golden tests + coverage manifest.
- **B3 — tolerant JSON extraction + wider eval coverage** (also in `BACKLOG.md`).
- **Trust chain** — capstone e2e once the per-pillar checks exist.
- **F170 `[ENEMY HARD CAST]` narrower than old** — the concrete gladlog finding A1
  surfaced; in `docs/BACKLOG.md`. Fix-or-confirm, then de-allowlist in the oracle.

## Non-goals

- Not a rewrite — reuse the existing gates, eval tools, selectors, and fixtures.
- Not cloud/CI-only — checks run locally (`npm run typecheck`/vitest) first; CI
  is additive. Each is also **agent-invokable** and emits a structured diff, so
  it doubles as a cross-agent verification/feedback primitive (see Two audiences).
- The private differential/eval oracles stay private (compliance), like
  `~/code/gladlog-eval-private`.
