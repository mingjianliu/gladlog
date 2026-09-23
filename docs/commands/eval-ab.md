# eval-ab — A/B Validation for Prompt Builder Changes

Validates whether a specific _prompt builder code_ change (`buildMatchContext`, the candidate menu, and their dependencies) truly improves scores: same batch of local logs, two-arm build, blind evaluation, paired statistics. Stateful — reads `$GLADLOG_EVAL_HOME/ab/<abId>/state.json` to determine which phase to run.

> Use `/eval-baseline` to find "what to fix next"; run `/calibrate-judge` before trusting the judge.

Suggested `abId` format: `YYYY-MM-DD-<change-slug>`. gladlog simplification compared to upstream: **no need to save raw logs** — corpus comes from the local log manifest, matchId is a content hash, rebuilding both arms from the same manifest naturally produces pairs (ordinal is determined by the corpus builder; when corpus builder code is not part of the test surface, ordinals are stable across arms; if your change modifies the corpus builder itself, stop first — that cannot be tested by this workflow).

## Argument Handling

- No arguments → Automatically determine phase from state: no state → Phase 1 (Control); `control-ready`/`treatment-ready` → Phase 2 (Treatment)
- `adopt` / `abandon` → Phase 3 (Wrap-up)

## The Standard Form (2026-08-30)

The five candidate-layer A/Bs run on 2026-08-30 (`healing-gap-hp`, `cd-hoarded-dp`, `retire-cd-spent-idle`, `trinket-ref`, `kick-eaten-ref`) established the shape this document now describes. Four things differ from the pre-2026-08 form, and all four exist because the change under test lives in the **candidate menu**, not in the bare match context:

1. **Both arms are built with `GLADLOG_CORPUS_PROMPT=findings`.** The env var is read in `packages/eval/src/corpus/buildCorpus.ts` (`GLADLOG_CORPUS_PROMPT === "findings"`) and switches the corpus builder from the bare rich context to the **production single-shot prompt** — candidate menu + legend + rich context, byte-for-byte what `packages/desktop/src/main/analysis.ts` sends.
   **Abort rule:** in the default raw-context mode a candidate-layer change produces **0 prompt diffs** — both arms come out byte-identical and the Phase 2 pre-flight diff correctly aborts. If you see "no differences" on a change you know touches the candidate menu, the cause is almost always a missing `GLADLOG_CORPUS_PROMPT=findings`, not a broken arm. (All five 2026-08-30 A/Bs hit exactly this.)
2. **One shared control arm per batch.** When several treatments are tested against the _same_ control commit and the _same_ manifest, build the control **once** and reuse it.
3. **The pair set is a subset**, not the whole corpus: prompts that actually differ between the arms ∩ ordinals that already have a control response.
4. **Responders return findings JSON, and the JSON is rendered before judging** — `interpolateResponses.ts` runs the product's own `auditFindings` gate and placeholder interpolation, so blind judges score the text a player would actually read.

## Shared: Response Generation (Common to Both Arms)

Execute `eval-baseline.md` Step 2 (including `MATCHID:` header and ordinal integrity checks) on arm directory `BASE` (Phase 1 = `ab/<abId>/control`, Phase 2 = `ab/<abId>/treatment`), writing responses to `BASE/responses/NNN.txt`; then run deterministic quality checks:

```bash
BASE_DIR="<BASE>" npx tsx packages/eval/scripts/qualityCheck.ts
# or: npm run -w @gladlog/eval quality        (BASE_DIR still comes from the env)
```

Write the responder instructions **once per abId**, to `ab/<abId>/responder-brief.md`, and dispatch every responder subagent with that file's text (one agent per ordinal per arm). One file instead of N inlined copies is what keeps the two arms' instructions provably identical — a wording drift between arms is an uncontrolled variable.

In findings mode the responder returns the **findings JSON array** (the production output contract), not prose. Post-process it before anything reads it as coaching text:

```bash
npx tsx packages/eval/scripts/interpolateResponses.ts --arm "$GLADLOG_EVAL_HOME/ab/<abId>/control"
npx tsx packages/eval/scripts/interpolateResponses.ts --arm "$GLADLOG_EVAL_HOME/ab/<abId>/treatment"
# or: npm run -w @gladlog/eval ab:interpolate -- --arm <armDir>
```

It reconstructs each prompt's candidate menu, runs the product's `auditFindings` gate, interpolates `{{placeholders}}` from the cited events' facts, and writes:

- `<arm>/responses-interpolated/NNN.txt` — the rendered coaching text;
- `<arm>/audit-summary.json` — per ordinal: `kept`, `dropped`, `dropReasons`, `unresolvedPlaceholders`, `typesCited`. **These are deterministic metrics**, on the same footing as `quality-report.json`: kept/dropped counts and drop reasons are reproducible from the arm's own files and carry adjudicative weight, unlike the blind sufficiency/noise rows.

Then make the interpolated text the thing that gets judged:

```bash
mv "<arm>/responses" "<arm>/responses-raw"          # the model's JSON, kept
cp -R "<arm>/responses-interpolated" "<arm>/responses"
```

`blindPool` reads `<arm>/responses/NNN.txt` and nothing else — so `responses/` must hold the interpolated text by the time Phase 2 Step 5 runs, and `responses-raw/` preserves what the model actually returned (needed to re-interpolate if the interpolation itself changes).

**Neither arm is scored individually.** All rubric scoring is performed only once during blind evaluation in Phase 2 Step 5 — scoring while knowing the arm identity (or having implemented the test change) = unblinding bias, forbidden.

## Phase 1 — Control

1. **Ask the user two things** (in a single message): What change is being tested? Which dimension is targeted for improvement? Wait for response.
2. **On control code** (usually = main, without the tested change), build the control arm:
   ```bash
   GLADLOG_CORPUS_PROMPT=findings npx tsx packages/eval/scripts/buildCorpus.ts \
     --manifest "$GLADLOG_EVAL_HOME/corpus/manifest-ab-newseason.txt" --run ab-<abId>-control
   mv "$GLADLOG_EVAL_HOME/runs/ab-<abId>-control" "$GLADLOG_EVAL_HOME/ab/<abId>/control"
   ```
   (`npm run -w @gladlog/eval corpus:build -- --manifest … --run …` is the same thing.) See `/eval-baseline` for which manifest a new season calls for — `manifest-ab-newseason.txt` is the 12.1 set (17 logs → 309 prompts); `manifest-coverage.txt` and `manifest-fullscale.txt` are 2026-06 pre-12.1 logs.
3. Shared response generation (BASE=control), including `interpolateResponses`. **Do not score.**
4. Write `ab/<abId>/state.json`:
   ```json
   {
     "phase": "control-ready",
     "manifest": "<path to used log manifest>",
     "fingerprint": "<control fingerprint.txt content>",
     "promptMode": "findings",
     "controlRunDate": "YYYY-MM-DD",
     "controlCommit": "<git rev-parse --short HEAD>",
     "treatmentRuns": 0,
     "targetDimension": "<dimension>",
     "changeDescription": "<change description>"
   }
   ```
5. Report: control ready (N matches, unscored), prompt user to implement the change before running `/eval-ab` again.

### Shared control arm (a batch of treatments against one control)

When the next A/B in the batch has the **same `controlCommit` and the same manifest**, do not rebuild — copy:

```bash
SRC="$GLADLOG_EVAL_HOME/ab/<first-abId>/control"
DST="$GLADLOG_EVAL_HOME/ab/<next-abId>/control"
mkdir -p "$DST"
cp -R "$SRC"/{prompts,index.json,manifests,quality-report.json,responses-raw} "$DST"/
```

Then re-run the two interpolation/`responses/` steps in the new arm (cheap, deterministic — no model calls), and record the provenance in the new `state.json` so nobody later mistakes it for an independent build:

```json
"controlCommit": "641f683f (shared control arm, copied from 2026-08-30-healing-gap-hp)",
"note": "control arm shared across the five 2026-08-30 A/Bs (same control commit + manifest)"
```

`fingerprint` must be copied verbatim too; Phase 2's fingerprint check then still does its job. Rebuilding an identical control five times is the cost this avoids — it is not a shortcut around the comparison, because a shared control is _more_ controlled, not less.

## Phase 2 — Treatment

1. Read state, print change / target dimension / control information.
2. **On code containing the tested change**, rebuild the treatment arm using the **exact same manifest and the same `GLADLOG_CORPUS_PROMPT=findings`** (same method as Phase 1 Step 2, directory `ab/<abId>/treatment`). Verify that treatment `fingerprint.txt` matches the control fingerprint in state — **mismatch = differing corpus, comparison rejected, abort**.
3. **Both arms must genuinely differ (pre-flight, prior to response generation):** diff prompts between both arms — if all are verbatim identical = one arm used the wrong code (or the corpus was built in raw-context mode, see the abort rule above), abort and investigate. Known pitfall (experienced 2026-07-15): **git worktree + symlinked root node_modules** — workspace package symlink (`node_modules/@gladlog/analysis → ../../packages/analysis`) resolves relatively back to main tree source, causing control arm to silently build using HEAD. Must run `npm install` in the worktree to install its own node_modules.
   ```bash
   diff -qr ab/<abId>/control/prompts ab/<abId>/treatment/prompts | head -3   # differences expected; no difference = abort
   ```
4. **Fix the pair set and record it.** The pair set is
   **{ ordinals whose prompt actually differs between the arms } ∩ { ordinals that already have a control response }**.
   Everything outside it is a pair of identical prompts: it costs two responder calls and two judge calls to measure a guaranteed zero, and it dilutes the paired statistics. Write the list to `ab/<abId>/ab-ordinals.json` (a flat JSON array, e.g. `[9, 10, 17, 24, 30, …]`) and set in state:
   ```json
   "subsetOrdinals": "<path to the batch's subset-ordinals file, when one gates the whole batch>",
   "pairs": 16,
   "pairOrdinals": "ab-ordinals.json (the 16 prompts the change touches)"
   ```
   If the intersection is too small to clear the MDE for the target dimension (see below), **sample extra ordinals** from the corpus at random, add them to `ab-ordinals.json`, and say in the report that they were added as sampled extras — never silently pad, and never report the padded n as if every pair were change-touching.
5. Shared response generation (BASE=treatment), including `interpolateResponses`.
6. **Blind Evaluation** — if the treatment adds **context lines / facts rather than menu items**, blind scoring at n ≤ 24 cannot adjudicate it; run the **Reverse probe** section below as the primary instrument and treat blind scoring as a regression check only.

   ```bash
   AB_DIR="$GLADLOG_EVAL_HOME/ab/<abId>" npx tsx packages/eval/scripts/blindPool.ts
   # or: npm run -w @gladlog/eval ab:pool
   ```

   > **Blind Evaluation Cardinal Rule (Non-negotiable):** Do NOT read `blind/mapping.json` until all blind scores are written — not now, not "just to verify", not even on error. Having implemented the tested change, knowing which item is treatment destroys the comparison. Only `abStats` reads `mapping.json`.
   >
   > **Equal Cardinal Rule — Blind Item Content:** The orchestrator must only **list directories** in `blind/items/` to obtain `ITEMID`s; never read any `prompt.txt`/`response.txt` content, nor read `blind/scores/*.json` (contents or sha256 can be reverse-mapped to arm identities using the files you just built). Check whether score files are complete solely via file existence (`ls`); defer integrity validation until after unblinding.

   Write the judge instructions once, to `ab/<abId>/judge-brief.md`, and dispatch one background scoring subagent per directory in `blind/items/` with that text (self-contained, one agent per item — never feed two items to one agent, or it will recognize pairs):

   > You are scoring a WoW arena coaching prompt/response pair. Read
   > `$GLADLOG_EVAL_HOME/ab/<abId>/blind/items/ITEMID/prompt.txt` and `.../ITEMID/response.txt`.
   > Apply the scoring rubric from `docs/commands/eval-baseline.md` Step 3 exactly (three-pass
   > process, 1/3/5 anchors; there is no quality-report.json for this item — skip the consistency
   > rules that reference it). The response is a numbered list of coaching findings (already rendered
   > from the prompt's event menu); audit every factual claim in it against the prompt's timeline and
   > event-menu lines. **Do not read any other file under `blind/`, not even as a format reference** —
   > not another item, not `mapping.json`, not another item's score file; a second item is enough to
   > recognize the pair, and a "format reference" is the excuse under which that happens. Write ONLY
   > the score JSON (standard 7-dimension format, factAudit + provenance included) to
   > `$GLADLOG_EVAL_HOME/ab/<abId>/blind/scores/ITEMID.json`. In that JSON set `matchId` to
   > exactly `ITEMID` — the blind item id. Do not guess, invent, or go looking for a real match id.
   > Reply with one line: `scored ITEMID`.

   (matchId=ITEMID is a fixed placeholder convention — blind items by design omit the `MATCHID:` header; in the 2026-07-20 run, judges
   invented three different variations: `null`/`"unknown"`/`"NO_MATCHID_HEADER_FOUND"`. abStats checks this field during unblinding:
   values not equal to the blind item id are flagged as non-compliant; values equal to the **real** matchId trigger a dedicated unblinding breach alert.
   All subsequent analyses aggregated by real matchId are converted via `blind/mapping.json`.)

   **K-Replicate Judges (Optional, default K=1):** Empirical acceptance testing on 2026-08-06 (spec
   `2026-08-05-judge-noise-floor-design.md` results) showed K=3 median only reduced same-content paired SD from
   0.93 to 0.75 — replicate errors are correlated, failing the ≤0.5 hard threshold, so it is **not used as default**; A/B defaults to a single judge
   `blind/scores/ITEMID.json`, keeping minimum detectable |Δ| ~0.4, with smaller differences adjudicated by deterministic text criteria.
   If experimentally enabling K-replicates: dispatch K independent judges per ITEMID (judges on the same item remain mutually unaware, preserving
   the one-item-one-agent cardinal rule), writing scores to `blind/scores/ITEMID.r1.json` / `.r2.json` / `.r3.json` respectively.
   abStats automatically recognizes both naming conventions: K-mode takes the per-dimension median for each item before pairing; if an item has fewer than 2 scores,
   the entire pair is dropped due to missing scores; if exactly 2, the mean is taken and annotated in replicateSummary. accuracy is always aggregated using
   the `computeAccuracyFromFactAudit` value calculated from each judge's factAudit (rubric in eval-baseline.md).

   After all scores are written, unblind and compute paired statistics:

   ```bash
   AB_DIR="$GLADLOG_EVAL_HOME/ab/<abId>" npx tsx packages/eval/scripts/abStats.ts
   # or: npm run -w @gladlog/eval ab:stats
   ```

   Outputs per-dimension mean Δ, SD, 95% bootstrap CI, sign test p-value, verdict (improved/regressed = CI excludes 0), and writes `comparison-stats.json`.

7. **Comparison Report** `ab/<abId>/comparison-report.md`, two categories of evidence:
   - **Deterministic Metrics** (basis for adjudicating sufficiency/noise/labelBias): diff `quality-report.json` across both arms — coverage, repetition rate, spammy lines, biased terms, hard failures, approximate token count — **and diff `audit-summary.json` across both arms**: menu lines of the changed type, findings kept/dropped by `auditFindings` with drop reasons, unresolved placeholders, responses that failed to parse as JSON.
   - **Blind Evaluation Statistics** (basis for adjudicating accuracy/outcomeAlignment/focusCalibration/inferenceScaffolding): abStats table.
     The sufficiency/noise rows in the blind evaluation table are for display only with **no adjudicative authority** — blind evaluators review prompts individually without quality-report anchors, unable to see what the builder change added/removed (upstream empirical evidence: F20 pilot, where kick-interrupt coverage differed by 88 percentage points yet both arms received judge sufficiency 4.9). These dimensions rely on deterministic diffs.
   - **When the change adds or edits candidate types, split every blind dimension by signal exposure × owner role** (which new types the prompt offered × healer / DPS owner), not just the pooled mean: the 2026-09-12 n=78 run pooled to accuracy −0.06, which was healer −0.24 / DPS +0.10 because two of the new line types only ever reach healer owners. Also report audited claims per finding per arm — a line that renders more numbers raises the response's audited surface even when the per-claim error rate is unchanged.
   - **Non-verified claims table (mandatory).** List every claim the judges' `factAudit` marked non-verified, per ordinal and per arm, and classify each one as exactly one of:
     **responder error** (the model asserted something the prompt does not support) · **judge misread** (the prompt does support it; the judge read the line wrong) · **genuine prompt contradiction** (the prompt really is self-inconsistent — this one is a bug in the builder and outranks any score).
     Without this column an accuracy delta is uninterpretable: on 2026-08-30 the entire negative accuracy point estimate of the `healing-gap-hp` A/B was **one judge misread of a gap's start timestamp, present identically in both arms**. Do the classification by re-reading the cited prompt lines yourself — after unblinding, so it costs nothing.
     Report structure: Deterministic Metrics table → Consumption table (context-line treatments only: genuine / coincidental / guard-rail per arm, from the Reverse probe section) → Target dimension per-ordinal table (after unblinding) → Non-verified claims table → All-dimension blind eval stats table → Regressions (dimensions where CI is entirely negative + clearly worsened deterministic metrics; inconclusive dimensions with negative point estimates are labeled "(inconclusive — monitor)" and not counted as regressions) → New Issues (items where treatment blind score ≤2 while paired control >2) → Triage (fix now / next cycle / backlog) → Rubric Feedback → Decision (IMPROVED/INCONCLUSIVE/REGRESSED + recommendation ADOPT/ABANDON/ITERATE; state inconclusive plainly, adopting based on deterministic reasons is user discretion — never package inconclusive as a win).
8. Increment `treatmentRuns` in state by 1, keep phase as `treatment-ready`; print summary.

## Phase 3 — Wrap-up (adopt / abandon)

1. Read state and print summary; if `abandon`, remind to revert code changes.
2. **Write ledger before deleting artifacts**: Append a row to the A/B cycles table in `$GLADLOG_EVAL_HOME/ledger.md` (date, commit, change description, target dimension, pairs n, target mean Δ (95% CI), verdict, decision, notes — including justification when adopting on deterministic grounds).
3. **Set the terminal phase and prune, do not delete the directory.** Write into `state.json`:
   ```json
   "phase": "done",
   "treatmentCommit": "<sha> (<branch> <sha> + main)",
   "pairs": <n>,
   "result": "<one-line verdict> — see comparison-report.md"
   ```
   `done` is the phase that says "adjudicated". Leaving a wrapped-up run at `treatment-ready` is what made the five 2026-08-30 runs look like pending treatments to the next argument-less `/eval-ab`.
   Then delete the bulky untracked artifacts — `prompts/`, `manifests/`, `responses*/`, `blind/`, `index.json`, `quality-report.json`, `fingerprint.txt` — and **keep**:
   `comparison-report.md` · `comparison-stats.json` · `state.json` · `ab-ordinals.json` · `{control,treatment}/audit-summary.json` · `responder-brief.md` · `judge-brief.md` · `reverse-probe-brief.md` and `reverse-probe/` when the run had one (the adopt-on-deterministic-grounds verdict rests on them).
   That set is ~40 KB per run and is what makes a ruling re-readable a month later: the decision, the numbers behind it, the exact pair set, the deterministic per-ordinal audit, and the verbatim instructions both models were given. The ledger row alone cannot reconstruct any of them.
4. Print rubric feedback and next steps (adopt → change is live; abandon → revert).

## Must Do Before Starting: Calculate Minimum Detectable Effect (MDE)

**Empirical result 2026-07-20: A full A/B run with 50 pairs and ~200 subagents finished with all seven dimensions inconclusive —
not because the change was useless, but because the ruler's ticks were coarser than the effect being measured.** This section exists to prevent wasting money again.

Before dispatching any subagents, calculate MDE using the noise floor from the table below:

```
MDE ≈ 1.96 × SD / √n        (n = number of pairs)
```

SD of per-pair differences across dimensions (2026-07-20, 50 pairs, sonnet judge, 7-dimension 1–5 integer rubric):

| Dimension            | SD       | Tied in 50 pairs | MDE for n=50 |
| -------------------- | -------- | ---------------- | ------------ |
| focusCalibration     | 0.14     | 49               | 0.04         |
| outcomeAlignment     | 0.25     | 47               | 0.07         |
| labelBias            | 0.43     | 41               | 0.12         |
| inferenceScaffolding | 0.55     | 41               | 0.15         |
| noise                | 0.60     | 32               | 0.17         |
| sufficiency          | 0.65     | 38               | 0.18         |
| **accuracy**         | **1.30** | **14**           | **0.36**     |

### Opus 5.5 Noise Floor (2026-09-23 formal test–retest) — current judge

Since 2026-09-23 the responder, the judge and the product default are Opus 5.5 (`claude-opus-5-5`). Judge calibration on the 80-case suite (`runs/2026-07-20-smoke`, seed 42): **7/7 PASS** — accuracy 10/10, noise 10/10, focusCalibration 9/10, labelBias 9/10, outcomeAlignment 9/10, inferenceScaffolding 8/10, sufficiency (det-gate) 6/6; judged dims 55/60 (Opus 5.0: 58/60), every miss a specificity drift of accuracy by 2 (4 of 5 from one source), sensitivity 60/60. Test–retest: the same 50 responses (`runs/2026-09-15-baseline` 001–050, Opus 5.0 responder) judged twice by independent `claude -p --model claude-opus-5-5` sessions (zero tools, rubric inlined; `runs/2026-09-23-judge-opus-compare`):

| Dimension | Paired SD | Tied in 50 pairs | MDE for n=50 |
|---|---|---|---|
| sufficiency | 0.20 | 48 | 0.06 |
| labelBias | 0.31 | 45 | 0.09 |
| inferenceScaffolding | 0.32 | 45 | 0.09 |
| focusCalibration | 0.40 | 42 | 0.11 |
| outcomeAlignment | 0.47 | 38 | 0.13 |
| noise | 0.61 | 32 | 0.17 |
| **accuracy** | **0.65** | **32** | **0.18** |

Harness caveat: the Sonnet table below came from Agent-tool subagents, this one from `claude -p`; the calibration above used Agent-tool subagents for both 5.0 and 5.5.

### Opus 5.0 Noise Floor (2026-09-16 A/B-derived) — historical

On 2026-09-12 the default model and judge were switched to Opus 5. Judge calibration passed 7/7 on 2026-09-15 (`runs/2026-09-15-calibration`).
The paired SD numbers below are derived from the 2026-09-16 confirmatory A/B run (n=40 pairs, Opus 5 responder + judge; formal test–retest parked for the Opus 5.0 vs 5.5 comparison):

| Dimension | Paired SD | MDE for n=40 | Measurement Method |
|---|---|---|---|
| **accuracy** | **0.57** | **0.18** | A/B-derived (n=40, 2026-09-16) |
| **focusCalibration** | **0.92** | **0.29** | A/B-derived (n=40, 2026-09-16) |

*(Note: Prior Sonnet numbers above remain as historical reference for Sonnet-judged runs and must not be pooled or directly compared across the model switch.)*

**accuracy is an outlier** — SD is 2x the second highest dimension and 9x the lowest, with 36 out of 50 pairs varying.
When choosing it as the target dimension, `|Δ| < 0.36` is completely undetectable at n=50; detecting Δ=0.2 requires n≈331 pairs.

A subset pair set makes this sharper, not laxer: at n=16 (the 2026-08-30 median) the accuracy MDE is ≈0.65, so the blind
dimensions cannot adjudicate anything at all and the decision rests on deterministic metrics. Say so in the report up front,
as those runs did, instead of discovering it after 32 judge calls.

### When Target Dimension is accuracy, Anchor on factAudit Instead

Empirical testing on the same batch of data showed that the variance of `factAudit` refuted **count** (rubric fixes 3 load-bearing claims per item,
so total claims across arms are naturally equal with no count confound) is only **48%** of the accuracy score variance:

| Metric                  | SD    | MDE for n=50 |
| ----------------------- | ----- | ------------ |
| accuracy (1–5 scale)    | 1.298 | 0.36         |
| factAudit refuted count | 0.842 | **0.23**     |

Resolution increases by 36%. Note this is not "stronger signal" (effect sizes d are comparable), but **higher precision**;
the tradeoff is a coarse 0–3 scale, but an observed SD of 0.84 demonstrates sufficient dispersion to support analysis.

### Never Write Labels Alone in Conclusions

If CI spans 0 it is inconclusive, but **do not write just "inconclusive, monitor"** — you must include
point estimate, CI, and MDE for that n, enabling readers to distinguish "measured no difference" from "lacked power to detect a difference":

> accuracy Δ = −0.30 (95% CI −0.66 ~ +0.06), MDE for n=50 = 0.36.
> CI crosses 0, not significant; point estimate is negative, aligned in direction with factAudit refuted rate (8.7% → 14.0%,
> CI −0.024 ~ +0.131). Both fall below the detectable threshold for this sample size, **qualifying as "underpowered to detect"
> rather than "detected no difference"**, labeled (inconclusive — monitor).

## Reverse probe — "did the LLM actually use it?" (2026-09-02, kw-facts)

Run this whenever the treatment adds **context lines or facts** rather than menu items (`[BURST ANSWERED]`, `[KILL WINDOW]` facts, `[ROOT]`). Blind scores at n ≤ 24 are inconclusive by construction; the question that discriminates is consumption, and the user asks for it verbatim ("反向问一下 llm 用没用").

1. **Deterministic join first, zero model calls.** No script exists for this yet (the 2026-09-02 run aggregated by hand) — write `packages/eval/scripts/reverseProbeJoin.ts` and book it. Join key: a finding carries `eventIds`, not `t`; resolve `t`/target through the prompt's menu line (`menuOf()` in `interpolateResponses.ts`), then overlap against the new lines' `M:SS` spans (both are on the `fmtTime` render grid). For every ordinal in both arms, parse the new lines out of `<arm>/prompts/NNN.txt` and the findings JSON out of `<arm>/responses-raw/NNN.txt`; count findings whose resolved `t`/target overlaps a new line's span, findings whose text contains vocabulary that exists **only** in the new lines, and findings that assert what a new line negates. Control on the same ordinals is the denominator for "coincidental overlap" — the 2026-09-02 run audited treatment only and its 3/20 coincidental had no baseline.
2. **Per-item reverse-probe audit, both arms.** Write `ab/<abId>/reverse-probe-brief.md` (precedent: `ab/2026-09-02-kw-facts/reverse-probe-brief.md`, which may have been pruned — the contract is fully stated here): one sonnet subagent per item, reads **only** `prompts/NNN.txt` + `responses-raw/NNN.txt`, is told what the new lines look like and which fact phrases are new, and writes `reverse-probe/<arm>/NNN.json` as `{"item": "...", "usedLines": [finding indices], "usedNewFacts": ["exact quoted fragment", ...], "contradictsFacts": ["exact quoted fragment", ...]}`, quoting fragments verbatim. The control arm gets the identical brief: with the new lines absent, anything it reports as "used" is the probe's false-positive rate, and its accusations are the ones the new line would acquit. Aggregate by **reading the array contents**: the probe writes `"none found"` as an array element, so counting non-empty arrays fabricates consumption.
3. **Read the result in three classes**: genuine consumption (text mirrors the new fact) / coincidental overlap (same timestamp or target, fact not used) / **guard-rail effect** (`contradictsFacts` = 0 while the control arm made the accusation the new line acquits). Findings anchor on menu eventIds, so genuine consumption of context lines is structurally rare (1/20, 2/14 on the two runs); the guard-rail count is where a context line proves its value.
4. **Refuted-claim triage is mandatory, not optional.** Unblind, pair every `factAudit` refuted/unsupported claim by ordinal, and classify each by re-reading the cited prompt lines: **responder error / judge misread / genuine prompt contradiction**, plus a column _touches the new lines?_. A genuine contradiction originating in a new line is a builder bug that outranks every score and becomes a `hardFailures` class; a judge misread of `t=` semantics (gap start, rounding) means the span endpoints must be checked against the render grid; the two 2026-08-30 accuracy deltas were one judge misread duplicated in both arms.

Verdict wording for this shape: "ADOPT on deterministic grounds — blind inconclusive at n = N, zero regression, consumption X/N genuine, guard-rail Y/N, new-line claims refuted 0/K" — never packaged as an A/B win.

## Notes

- Blind scoring is executed by subagents; the orchestrator session **never** scores items directly — it knows what changed.
- Blind evaluation statistics are just noise until the judge passes `/calibrate-judge` — calibrate first.
- Under small samples (10–40 pairs), sign test + bootstrap CI serve as primary evidence; not significant means not significant.
- **Deterministic metrics can independently support ADOPT; lack of detection in blind eval does not constitute a veto.** They do not measure the same thing:
  deterministic checks measure **whether the rendered artifact itself is self-contradictory** (e.g. prompt claiming the same unit at the same second is both 88% and 2%
  HP, which is a correctness property of the artifact regardless of whether anyone notices); blind evaluation measures **whether downstream coaching quality
  improved**, which is a harder and noisier question. A null obtained from an instrument with an already-measured high noise floor
  **is not evidence of absence of effect**. Cross-AI review previously offered an opposing opinion on this point (advocating REJECT),
  but its argument rested on misinterpreting "reducing 185 hard failure lines to zero" as "a line number", and was rejected.
- npm aliases for the entry points (all take the same flags): `npm run -w @gladlog/eval corpus:build` · `quality` · `ab:interpolate` · `ab:pool` · `ab:stats`.
