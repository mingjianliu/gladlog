# @gladlog/eval

**English** · [中文](README.zh-CN.md)

The evaluation, quality gating, and benchmarking engine of gladlog: verifies prompt fidelity, calibrates LLM judges, enforces deterministic quality gates, and conducts statistically sound A/B evaluations across match corpora. Consumed exclusively in offline maintainer and CI workflows — never bundled into the desktop application.

## Core Architecture

```
Raw Combat Log / Corpus
           │
           ▼
[ Ground-Truth Coverage Manifest (src/quality/coverageManifest.ts) ]
  Extracts every death, CC, interrupt, dispel, and trinket from raw parser events
           │
           ├───────────────────────────────┐
           ▼                               ▼
[ Deterministic Quality Gates ]     [ A/B Evaluation & Benchmarking ]
  promptQualityCheck.ts               blindAbPool.ts / abCompareStats.ts
  20+ hardFailure classes             Non-parametric sign test & bootstrap CI
  Sufficiency, noise & label bias                  │
           │                                       ▼
           └───────────────┬───────────────────────┘
                           ▼
            [ LLM Judge Calibration (src/judge/) ]
              checkCalibration.ts / buildCalibrationSuite.ts
              Anchors subjective dimensions to measured facts
```

## Key Subsystems

### 1. Deterministic Quality Gates (`src/quality/`)

- **`promptQualityCheck.ts`**: Replaces subjective LLM judging for mechanically verifiable criteria.
  - **Sufficiency (Coverage)**: Re-parses raw combat logs to build a ground-truth manifest, asserting that key events (friendly deaths, high-value CC, kicks, dispels, defensive trinkets) are represented in the generated prompt.
  - **Noise & Bias Detection**: Measures exact and template duplicate line ratios, resource-spam patterns, and severity-bias terms.
  - **Hard Failure Invariants**: Enforces 20+ non-negotiable consistency checks (`checkPercentileMonotonicity`, `checkSameSecondHpConsistency`, `checkWindowSpanConsistency`, `checkCooldownLedgerConsistency`, `checkMenuTRenderGrid`, `checkFactsBlockIntegrity`, `checkCjkLeak`, etc.).

### 2. A/B Evaluation & Statistical Rigor (`src/ab/`)

- **`blindAbPool.ts`**: Generates randomized, blind pairwise evaluation pools comparing baseline vs. candidate prompt builders across matching seeds.
- **`abCompareStats.ts`**:
  - Computes non-parametric two-tailed sign tests (`signTestP`).
  - Calculates bootstrap confidence intervals (`bootstrapCI`) across evaluation dimensions.
  - Prevents noisy, non-reproducible wins from passing into production.

### 3. LLM Judge Calibration & Anti-Bias (`src/judge/`, `src/halo/`)

- **`checkCalibration.ts` & `buildCalibrationSuite.ts`**: Calibrates evaluation models against anchored ground-truth cases.
- **`outcomeHalo.ts`**: Measures and detects outcome halo bias (whether win/loss outcomes disproportionately skew coaching evaluations regardless of actual gameplay).
- **`sycophancy.test.ts` & `familyBias.test.ts`**: Audits judges against model flattery and archetype bias.

### 4. Corpus Stratification (`src/corpus/`)

- **`buildCorpus.ts`**: Builds balanced, stratified evaluation corpora across specs, brackets (2v2, 3v3, Solo Shuffle), and team archetypes to eliminate selection bias.

### 5. Executable Anti-Rot Predicate Index (`test/predicateIndex.test.ts`)

- Over 2,100 lines of executable assertions locking `docs/predicate-index.md`, `docs/predicate-index.zh-CN.md`, and code exports in a three-way bind.
- Prevents documentation drift and verifies that analysis and verification gates share the exact same predicates.

## Workflows and Commands

All evaluation artifacts are written to `$GLADLOG_EVAL_HOME` (defaulting to `~/code/gladlog-eval-private`).

```bash
# Run unit tests and deterministic gates
npm test --workspace=packages/eval

# Execute deterministic prompt quality check
npm run quality --workspace=packages/eval

# Scan for candidate-menu render grid alignment
npm run scan:menu-t --workspace=packages/eval

# Scan for curated data rot across game patches
npm run scan:rot --workspace=packages/eval
```

For higher-level evaluation workflows, see the dedicated command guides:
- [A/B Prompt Evaluation](../../docs/commands/eval-ab.md)
- [Baseline Evaluation](../../docs/commands/eval-baseline.md)
- [Judge Calibration](../../docs/commands/calibrate-judge.md)
- [Full Pipeline Audit](../../docs/commands/pipeline-audit.md)
