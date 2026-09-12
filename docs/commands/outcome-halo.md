# outcome-halo — Judge Outcome Halo Experiment Execution Protocol

> **One-off experiment playbook (2026-08-05), completed; not a standing workflow.** It is kept so the run is reproducible — do not schedule it, and do not treat it as a peer of `/eval-baseline` · `/eval-ab` · `/calibrate-judge` · `/pipeline-audit`. Result: recorded in `$GLADLOG_EVAL_HOME/ledger.md` and written back into the design spec.

One-time experiment (design: docs/superpowers/specs/2026-08-05-outcome-halo-experiment-design.md).
Tools reside in packages/eval; this document is the execution playbook.

## 0. Prerequisites

- In the worktree, `npm run typecheck` and eval package tests are all green.
- Corpus source: $GLADLOG_EVAL_HOME/runs/2026-07-30-wire-unnecessary-baseline (artifact of 300 matches from buildCorpus, index.json contains result).

## 1. Build Arms

```bash
npx tsx packages/eval/scripts/haloBuild.ts --source-run 2026-07-30-wire-unnecessary-baseline --ab 2026-08-05-outcome-halo --seed 20260805 --n-per-stratum 50
```

Expected output: `halo arms: 100 pairs (50 Win + 50 Loss)`.
Spot check: take any ordinal, diff between the two arm prompts should only differ by one Result: token line.

## 2. Responder (100 items)

Execute according to the responsible party protocol in docs/commands/eval-baseline.md Step 2, differing only in paths:
Read control/prompts/NNN-*.txt, write control/responses/<ordinal 3-digit>.txt,
include the first-line MATCHID: <matchId> header as required. Opus 5 subagents (`model: "opus"`), one agent per item, ≤8 concurrency.

After completion:

```bash
npx tsx packages/eval/scripts/haloCopyResponses.ts --ab 2026-08-05-outcome-halo
```

Expected: copied 100 responses.

## 3. Blind Pool Mixing

```bash
npx tsx packages/eval/scripts/blindPool.ts --ab 2026-08-05-outcome-halo
```

Expected: Blind pool: 200 items (100 pairs).

## 4. Blind Evaluation (200 items)

Execute according to docs/commands/eval-ab.md Step 5; contract and anti-unblinding iron rules apply verbatim:
One judge per item (Opus 5); judge only reads blind/items/item-NN/{prompt.txt,response.txt};
Seven dimensions 1–5 integers according to docs/commands/eval-baseline.md rubric; write score JSON to
blind/scores/item-NN.json, filling matchId with blindId as a placeholder.
The orchestrator does not read mapping/items/scores before Step 5.

## 5. Unblinding Statistics

```bash
npx tsx packages/eval/scripts/haloStats.ts --ab 2026-08-05-outcome-halo
```

## 6. Interpretation and Delivery

Interpretation rules follow the spec: if any of the six non-outcome dimensions is contaminated ⇒ branch A adopts a two-pass judge;
if all inconclusive ⇒ maintain single pass. reverse is also counted as "label effect present", enters discussion.
Deliverables: ab/2026-08-05-outcome-halo/report.md (main table + stratified schedule + judgeModel/responderModel
+ seed and corpus source), record in $GLADLOG_EVAL_HOME/ledger.md, and write conclusions back to line A of the spec.
