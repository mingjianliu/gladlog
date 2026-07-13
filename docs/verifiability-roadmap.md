# gladlog verifiability roadmap

**Goal:** make every layer of gladlog _verifiable_ — its output provably traces
to verifiable inputs, end to end: raw log → parse → analysis → AI prompt/output →
UI → export. The PROMPT pillar already enforces this ("every claim grounded in a
real event"); this roadmap extends the same discipline to LOG and VISION so the
whole app is a chain of grounded, independently-checkable transforms.

This is a **roadmap**, not a spec. Each sub-project below gets its own
brainstorm → spec → plan → implementation cycle when picked up.

## Current state (uneven)

| Pillar     | Today                                                                                                                                                                                                                 | Verdict                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **PROMPT** | 3 honesty gates (`auditFindings` grounding/numeric/causal, `causalLint`, `claimChecker` + template interpolation) + 12-tool eval harness (blind A/B, calibration, provenance, `positioningScan`, `contestedContract`) | Strong — the reference for the others                            |
| **LOG**    | 13 parser test files, one golden fixture test (`l3.golden.test.ts`), byte-exact log-pipeline reconstruction                                                                                                           | Moderate — no differential oracle, no invariants                 |
| **VISION** | 4 functional renderer tests                                                                                                                                                                                           | Weak — no data-faithfulness, visual-regression, or export checks |

## Guiding principle

A transform is _verifiable_ when: (1) its output is a pure function of named,
inspectable inputs; (2) an automated check proves the output is consistent with
those inputs; (3) failures are legible (say what diverged and where). PROMPT
achieves this via grounding + claim-checking. LOG and VISION should too.

---

## Pillar A — LOG (parsing) verifiability

Prove the parser turns raw combat logs into correct structured matches.

- **A1. Differential oracle** _(the roadmap's long-planned "private oracle")_ —
  run the old fork's parser (CC-BY-NC-ND is fine for **private** local use) and
  the new parser on the same real logs; diff the structured output on the fields
  the app actually consumes; quantify drift; gate parity. Catches silent parse
  regressions the golden tests miss. Private repo, like the eval ledger.
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

- **C1. Data-faithfulness (the UI can't lie)** — the on-brand core. Every rendered
  number / bar / timeline mark must come from a **pure, tested selector** over the
  match+analysis data; tests assert the rendered DOM value equals the computed
  value (no fabricated, stale, or mis-scaled visuals). This is `claimChecker` for
  pixels: the meters, cohort percentiles, and timeline marks provably match their
  source.
- **C2. Visual regression** — snapshot the rendered report (jsdom DOM snapshot
  now; Playwright/Electron screenshot later) and fail the build on unexpected
  visual diffs. Catches accidental layout/scale breakage.
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

1. **C1 (data-faithfulness)** — biggest gap, highest trust value, on-brand, small–medium.
2. **A1 (differential oracle)** — quantifies parser correctness against the proven old parser; de-risks everything downstream.
3. **C2/C3 (visual regression + export)** — lock the UI once C1 makes it honest.
4. **B1/B2 (causal judge + provenance)** — push the already-strong pillar further.
5. **A2/A3, B3** — breadth/hardening.
6. **Trust chain** — capstone once the pieces exist.

## Non-goals

- Not a rewrite — reuse the existing gates, eval tools, selectors, and fixtures.
- Not cloud/CI-only — checks run locally (`npm run typecheck`/vitest) first; CI
  is additive.
- The private differential/eval oracles stay private (compliance), like
  `~/code/gladlog-eval-private`.
