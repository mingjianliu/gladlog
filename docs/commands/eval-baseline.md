# eval-baseline — Baseline Evaluation Workflow

Evaluates healer arena prompt and AI response quality (10–50 matches), producing cross-match quality reports. A four-step pipeline, fully completed within this session (no external APIs).

> **Three eval workflows, choose the right one to use:**
>
> - **This workflow**: Evaluates the current state of prompt/response quality to identify what to fix next.
> - **`/eval-ab`** (`docs/commands/eval-ab.md`): Verifies whether a specific _prompt builder code_ change actually improved scores (controlled A/B on the same corpus).
> - **`/calibrate-judge`**: Calibrates the judge before trusting judge scores.

All artifacts land in the private eval repository (`$GLADLOG_EVAL_HOME`, default `~/code/gladlog-eval-private`; run `npx tsx packages/eval/scripts/init.ts` before first use). Run directory = `$GLADLOG_EVAL_HOME/runs/<runId>` (`runId` recommended format: `YYYY-MM-DD-<slug>`).

## Parameter Handling

- `/eval-baseline <runId>` and the run directory already contains `prompts/` + `index.json` → **Reuse mode**: Skips Step 1 corpus building (used for testing rubric drift: re-evaluating the same set of old prompts).
- `/eval-baseline` (no arguments) → **New mode**: `runId` defaults to `YYYY-MM-DD-baseline`, starting from Step 1.

## Which manifest after a season change

> **The two manifests this document has always named are pre-12.1 (2026-06) logs.**
> `corpus/manifest-coverage.txt` (1 log — the A3 minimum-coverage set, by design) and
> `corpus/manifest-fullscale.txt` (70 logs, used by `/pipeline-audit`) were both cut from the
> 2026-06 season. They still exercise every corner case they were built for, but nothing in them
> reflects 12.1 spell ids, DR windows, or candidate types. For anything whose conclusion is about
> the **current** season, use the new-season equivalents:
>
> | Purpose | Pre-12.1 (2026-06) | New season (12.1) |
> | --- | --- | --- |
> | Sampled / A/B corpus | `corpus/manifest-coverage.txt` (1 log) · `corpus/manifest.txt` (8) | **`corpus/manifest-ab-newseason.txt`** — 17 logs → 309 prompts |
> | Full-corpus audit | `corpus/manifest-fullscale.txt` (70 logs) | **`corpus/manifest-archive-2026-08-28-newseason.txt`** — the PvP archive manifest (18,134 `.gz` entries) |
>
> Say which one a run used, in the ledger row and in the report — "70 matches" means two different
> things before and after the season boundary.

> **Both of these workflows have been idle since 2026-07/08.** The last `## Baseline evals` ledger
> row is **2026-07-22** and the newest `runs/` artifact is **2026-08-06**; `/pipeline-audit` last
> really ran **2026-07-22**. That is not neglect: since then, decisions about whether a coaching
> signal stays or goes have been made on a different instrument — the **outcome probe** (does the
> thing the signal fires on actually precede a worse outcome?), **deterministic metrics** (hard
> failures, coverage counts, `audit-summary.json` kept/dropped), and the **opportunity-normalised
> skill gradient** (`packages/eval/src/explore/signalSkillGradient.ts`, stratified by rating
> bracket — never pooled). The provenance of every signal's grounding lives in
> [`docs/coaching-grounding-audit.md`](../coaching-grounding-audit.md). Use this seven-dimension
> baseline when you want to know *how good the prompt/response text is*; do not use it to
> adjudicate whether a signal earns its place — see CLAUDE.md's Value-Gate Rule, points 4 and 5.

## Step 1: Build Corpus (New Mode)

Log manifest **prefers the A3 coverage manifest** `$GLADLOG_EVAL_HOME/corpus/manifest-coverage.txt`——
It is generated via greedy set coverage by `coverageCorpus.ts`, ensuring all corner cases across 7 healer specs × 3 brackets ×
CRLF/pets/shuffle/near-death are present (the landing point of B3 "Widen eval coverage"); run
`npx tsx packages/eval/scripts/coverageCorpus.ts --check` first to verify that the manifest has not drifted.
If the coverage manifest does not exist or this round needs to reproduce an old run baseline, fall back to `corpus/manifest.txt`
(one local WoWCombatLog path per line); if neither exists, abort and prompt the user to prepare a manifest first.

```bash
npx tsx packages/eval/scripts/buildCorpus.ts --manifest "$GLADLOG_EVAL_HOME/corpus/manifest-coverage.txt" --run <runId>
# or: npm run -w @gladlog/eval corpus:build -- --manifest … --run <runId>
```

> The workflow entry points have npm aliases in `packages/eval/package.json`, so a long path is not
> the only way to name them: `corpus:build` · `quality` · `ab:interpolate` · `ab:pool` · `ab:stats` ·
> `scan:crisis-hp` · `scan:menu-t` · `scan:rot` · `scan:dr-gap` · `scan:dispel` · `acceptance:hash`
> (`npm run -w @gladlog/eval <name> -- <flags>`; flags are unchanged).

Non-zero exit aborts immediately. Once completed, verify that `runs/<runId>/index.json` exists and read the item list (each entry: `ordinal`, `file`, `matchId`, `spec`, `result`). The builder also writes the coverage manifest `manifests/NNN.json`.

Then run deterministic quality checks and read the output:

```bash
BASE_DIR="$GLADLOG_EVAL_HOME/runs/<runId>" npx tsx packages/eval/scripts/qualityCheck.ts
# or: BASE_DIR=… npm run -w @gladlog/eval quality
```

Writes `runs/<runId>/quality-report.json` (per-match coverage: friendly deaths/CC/kicks/dispels/trinkets; noise ratio; bias word hits). The judge in Step 3 **must** use these measured numbers to anchor sufficiency/noise/labelBias, without visual estimation.

## Step 2: Generate Responses (Parallel Subagents)

> **Execution model:** Launch subagents using in-session Agent tools; no external API keys, no new scripts created. Responder and judge subagents run on **Opus 5** (pass `model: "opus"` explicitly), the same model as the product's default coach (`AI_DEFAULT_MODEL`); record it in `judgeModel`. Runs before 2026-09-12 used Sonnet — do not compare scores across that switch without a fresh `/calibrate-judge`. If Agent tools are unavailable, generate per match yourself — you are an AI, do not write wrapper scripts calling external APIs.

For each entry in the index, launch a **background subagent** (prompt is self-contained, substituting actual values item by item):

> You are a WoW arena coach. Your task is to produce coaching advice for a healer player based on a match log.
>
> Read the match prompt from this file:
> `$GLADLOG_EVAL_HOME/runs/<runId>/prompts/FILENAME`
>
> Produce coaching advice for the healer. Focus on:
>
> - What went wrong or right in this match
> - Specific decisions that affected the outcome
> - Concrete adjustments for next time
>
> ACCURACY DISCIPLINE (mandatory): before finalizing, re-verify every specific claim you
> make — each timestamp, count, HP value, cooldown state, and causal attribution — against
> the exact line(s) of the match prompt. If you cannot point to a specific prompt line
> supporting a detail, remove or soften it. Never harden ambiguous log annotations (e.g.
> "ended early — absorbed, dispelled, or cancelled") into one specific cause. When counting
> events (stuns, casts, spikes), recount from the timeline rather than from memory.
>
> Also re-verify WHO each claim is about: match the exact unit tag (e.g. `4(AWarrior)`)
> named on that prompt line, not just its timestamp and value. In dense multi-unit fights
> it is easy to attribute a cast, cooldown, or kill to a plausible-sounding but wrong unit —
> treat unit identity as a fact to check, same as the timestamp and the number.
>
> FOCUS DISCIPLINE: structure the response around the 2-3 windows that actually
> decided the match; give each secondary observation at most one line, and label
> minor items as minor. Do not let "what went right" match the decisive analysis
> in length.
>
> Write your coaching response to:
> `$GLADLOG_EVAL_HOME/runs/<runId>/responses/NNN.txt`
>
> The FIRST line of the file must be exactly `MATCHID: <matchId>`, followed by a blank line, then the coaching response and nothing else — no preamble, no meta-commentary. Create the `responses/` directory if it does not exist.

Dispatch all in parallel at once. After receiving completion notifications, check response files; note missing ordinals and continue without aborting.

**Ordinal integrity check:** The `MATCHID:` header of each response file must match the `matchId` of the index entry with the same ordinal. Mismatch = file misplacement bug (incident 063/064 occurred upstream): exclude both ordinals from scoring and report. Strip the header line before passing to the judge.

## Step 3: Per-Match Scoring (Three-Pass Method + Anchored Rubric)

For each entry with a response: read prompt, read response (verify and strip `MATCHID:` header), note `result`, read the match's `quality-report.json` entry. Write score to `runs/<runId>/scores/NNN.json`.

### Three-Pass Method (Strict Order)

**PASS 1 — Fact Audit (Prior to Any Scoring):** The audit set is **determined by rules, not chosen by you**——

1. In order of appearance in the response body, take **all** assertion sentences containing `M:SS` format timestamps, **capped at 20**.
2. If candidates **exceed 20**, take the **first 10 + last 10** (in order of appearance); do not take the first 20——
   **Prefix truncation turns the end of the response into a blind spot** (see "Why not take the first N" below).
3. If fewer than 3, supplement with assertion sentences containing percentages or damage numbers in order of appearance to make up 3.
4. Pure suggestion sentences ("use it earlier next time") are not assertions and are excluded; suggestions with timestamps are included for their assertive portion.
5. **Assertions containing causal connectives must be included** (caused / direct result of / led to / because of / "caused by" / "resulting in", etc.): causality itself is a claim requiring support —— **temporal proximity does not constitute causal support**;
   the prompt can only prove "sequence", not "causation". Hardening two real events into a single-cause attribution
   (especially exclusionary statements like "no other factor contributed") without log evidence = `unsupported`.
   (B1 calibration test: without this rule, judges missed 3 pairs out of 10 with zero reaction to implanted causal hardening sentences.)

Find the exact prompt line proving or refuting each claim, quoting the original text in `factAudit`. Claims with no supporting line = fabrication.

**`accuracy` is scored strictly based on this set.** Issues found outside the set are written into `notes`, but **do not affect the score**.

**Claims containing numbers must write both values side by side.** For any claim in the audit set with numbers (timestamps, HP%, damage values, counts), `evidence` must be written in the side-by-side format of `response:X | prompt:Y` —— X is the claim in the response, Y is the **original value** in the prompt line you cited. If they differ, it is `refuted`; do not judge it as `verified` because it "mostly matches" or "doesn't change the conclusion" (that belongs to severity judgment in notes, not changing the verdict).

> **Why this rule was added** (2026-07-20 empirical test): After determinizing the audit set, judges reading the same material and auditing the same claims could still diverge by 2 points on accuracy. Case-by-case review of missed errors — `41%(0:31)` was actually `42%(0:31)/41%(0:32)`, `19% was match lowest` was actually `16%`, `only three Drinks` actually had trinket and Angelic Feather ——
> **all were number mismatches, and all were in the audit set and marked as verified after being reviewed by judges**. The problem was not which claims to audit, but whether digits were actually compared side-by-side during audit. Writing values side by side turns "comparison" from an impression into an action: after writing `response:41% | prompt:42%`, it is impossible to mark verified.

> **Why not take the first N** (2026-07-21 empirical test, n=10 calibration suite): The previous rule was "cap at 12, take first 12 if exceeded". An implanted fabrication (`Mass Dispel`) in the calibration suite happened to land on the **13th** timestamped sentence in the response; both judges **found it** and noted it in `notes`, but the rule stated items outside the set don't count towards scores —— accuracy was recorded as 8/10, while the judges' true sensitivity was **10/10**. What missed was not the judge, but the **position bias** of the audit set: prefix truncation effectively announces "the end of response is unchecked", and concluding paragraphs are precisely where fluff and fabrications thrive. Thus the cap was raised to 20 (empirically most response candidates fall between 9–14 sentences; 20 provides full coverage), and when exceeding limits, half is taken from each end so the tail never becomes invisible.

> **Why you are not allowed to self-select** (2026-07-20 empirical test, n=10 calibration suite): The old rule was "self-select the 3 most load-bearing claims". The same response and verifiable content read three times by three independent judges yielded an average accuracy range of 1.00, maximum 2, with 4 out of 10 sources having range ≥2. Case-by-case review showed: every low-scoring judge audited a claim that high-scoring judges **did not audit**, while those errors existed in the response text all along. Other judges voluntarily audited extra claims **outside** the mandated 3 and deducted points. As a result, accuracy measured "how diligently the judge searched" rather than "how accurate the response was" —— the score of the same response depended on sampling luck, with inter-judge variance ±2 structurally exceeding the specificity tolerance ±1; calibration failures for `noise`/`labelBias` almost entirely stemmed from this. A deterministic audit set turns accuracy from a lottery back into a measurement.

**PASS 2 — Anchored Dimension Evaluation:** Write one evidence sentence for each of the 7 dimensions first, then select scores according to the anchors below. For dimensions where `quality-report.json` provides measured values, scores must match the measured values (inlined rules) and cite the numbers.

**Dimension Independence (Discriminant Validity, Mandatory):** Score each of the 7 dimensions independently, evaluating solely against that dimension's definition. Flaws in one dimension must never pull down another dimension — specifically: fabrications/unsupported claims only lower `accuracy`; duplicate/redundant lines only lower `noise`; loaded severity labels only lower `labelBias`; out-of-order events only lower `inferenceScaffolding`; missing key data blocks (deaths/CDs/CC) only lower `sufficiency`; opening/closing frames contradicting match outcome only lower `outcomeAlignment` (only when the frame simultaneously states a real event backwards is `accuracy` counted separately and the claim named in factAudit); trivialities crowding out decisive moments only lower `focusCalibration`. **Self-check before finalizing: If you lowered more than one dimension, you must provide independent, dimension-specific evidence for each dimension; for dimensions lacking specific justification, revert back to the score deserved by the undisturbed version.** An overall impression of "this looks worse/better" is not a basis for adding or subtracting points in any single dimension — discriminant validity requires each score to reflect only its own dimension.

**Three Operational Criteria for accuracy (Empirical Calibration Supplement):** The rule above states "which dimension to lower", but does not specify **what to do when encountering specific situations** —— in the 2026-07-20 full-corpus calibration test, judges did not knowingly violate independence, but genuinely believed they had found factual errors. Criteria for the three scenarios:

1. **Verify by content, not by order.** As long as the prompt line supporting a claim **exists anywhere in the text**, the claim is `verified` —— which line it appears on and its sequence relative to other lines has no effect. Out-of-order prompt events **can never** cause a claim to be judged as `refuted`; difficulty in finding information is a flaw of `inferenceScaffolding`, unrelated to `accuracy`. Search keywords across the entire text before marking `refuted`; do not jump to conclusions just because "it's not where it should be".
2. **Generic advice is not a factual claim.** General coaching content unrelated to this match log (positioning, keybindings, macros, camera angles) does not assert what happened in this match, and therefore **cannot** constitute an `accuracy` flaw —— regardless of how much space it occupies. Crowding out decisive analysis is an issue for `focusCalibration`.
3. **For outcome framing, ask first: "Does it name specific events?"** When opening/closing framing like "a well-earned victory" contradicts `Result:`, lower only `outcomeAlignment`. The criterion is: **Does this sentence assert a specific in-match event while the log says the opposite?** No specific event named → purely framing issue, `accuracy` remains unchanged. Yes → name the claim in `factAudit` before factoring into `accuracy`.

These three criteria were reverse-engineered from empirical leakages, not theoretical purism: in that round, 8 out of 10 specificity violations were `accuracy 5→3`, originating from perturbations of disorder, trivia sections, and outcome inversion respectively —— all falling into the three scenarios above.

**PASS 3 — Generate JSON:** Write the score file only after passes 1–2 are complete.

### Rubric (Anchored at 1 / 3 / 5; 2 and 4 used for intermediate levels)

**Prompt Quality:**

- **sufficiency** — Is the data needed to judge decisive factors present?
  - 5: CC chains with duration, dampening progression, enemy major CDs, and HP context all present.
  - 3: Missing exactly one key block (e.g., CC present but no dampening progression).
  - 1: Major gaps (no CD usage, no CC timing).
  - Consistency rule: quality-report shows missing friendly deaths for this match → sufficiency ≤ 2; any coverage category (cc/kicks/dispels) < 80% → sufficiency ≤ 3.

- **noise** — Do redundant lines dilute attention?
  - 5: No duplicate states/trigger spam; every line represents a state change.
  - 3: Approximately 10–30% lines are duplicate/unchanged states.
  - 1: Timeline >50% spam or duplicate.
  - Consistency rule: Score according to measured metrics for this match and cite numbers in the evidence sentence, no impressions; falling into a bracket for any metric suffices to set the grade, no need to satisfy all simultaneously. **Use two separate standards:**
    - `exactDuplicateRatio` / `resReadySpamLines` follow the 10–30% / >50% anchor brackets directly above.
    - `templateDuplicateRatio` **graded separately: ≤45% is not grounds for deduction; 45–60% → 3; >60% → 1.**
      Number-masked "template duplicates" are naturally 30%+ in structured timelines ([STATE]/[RES] lines are inherently the same template)——
      Across 1,245 full-corpus matches (2026-07-22), p50=31.2%, p90=40.7%, p99=49.1%; thresholds are set outside the natural distribution to capture only abnormal template spam tails. Previously applying the exact 10–30% bracket directly led to whole-corpus noise being re-anchored down to grade 2–3 (35-match mean 3.91 → 2.83) —— that was a measuring tape flaw, not a prompt regression.

- **labelBias** — Do labels introduce bias before reasoning?
  - 5: Neutral headings; severity markers appear only where supported by data (real HP dips below 25%).
  - 3: Mild steering (ordinary 50% HP drops labeled "spike").
  - 1: Loaded language attached to ordinary events ("disastrous", minor trade labeled `[CRITICAL]`).
  - Consistency rule: Measured bias word hits == 0 → labelBias ≥ 4, unless specific biased phrasing missed by the dictionary can be cited.

- **inferenceScaffolding** — Can causality be directly read from structure?
  - 5: Correct timing; death/trinket co-located with damage/CC that triggered it.
  - 3: Correct timing but trigger and reaction separated by filler lines.
  - 1: Out-of-order events or trigger disconnected from outcome.

**Response Quality:**

- **accuracy** — Does the response cite only events present in the prompt? **This dimension score is computed by the system from factAudit (`computeAccuracyFromFactAudit` in checkScoreProvenance); judges do not score freely**: the value you write to `response.accuracy` must equal the value computed from your own factAudit according to the table below; mismatch invalidates the entire file.
  - 5: Zero errors.
  - 4: Exactly 1 minor error.
  - 3: Exactly 2 minor errors.
  - 2: 3 or more minor errors.
  - 1: Any **fabrication** (spells/windows/deaths), or giving advice to dead/absent players —— regardless of number of minor errors, 1 upon sight.
  - Error = entries in factAudit where verdict is `refuted` or `unsupported`; every non-verified entry **must** include a `severity` field: `minor` (minor error = timestamp off by a few seconds, value off by one bracket, minor trigger misnamed) or `fabricated` (fabrication).
  - (Old anchors allowed judges discretion outside table lookup; 2026-07-20 tests showed three judges giving 3/3/4 and 3/4/4 for the same error. Deterministic computation eliminated the last degree of freedom —— 2026-08-05 Subproject A.)
  - Clause F193: Trade-off discussions anchored on `[CONTESTED]` lines that maintain tentative phrasing (≤Medium confidence, no assertions made) **do not count** as fabrication or unsupported —— the line itself is prompt fact; errors are recorded only when the response hardens it into a conclusion ("you should have CC'd then") or invents scenarios unanchored to data.

- **outcomeAlignment** — Does coaching advice explain the actual match result?
  - 5: Identifies causal sequences deciding the match.
  - 3: Mentions result but attributes to generalities.
  - 1: Ignores or states result backwards. (result=Unknown: evaluate based on whether key turning points are captured.)

- **focusCalibration** — Does it prioritize the highest-leverage moments?
  - 5: 2–3 decisive windows dominate the full text.
  - 3: Identifies right moments but trivia shares equal space.
  - 1: Ignores decisive moments, dwells on trivial details.

### Score File Format (Score Contract, Validator-Enforced)

```json
{
  "ordinal": 1,
  "matchId": "abc12345",
  "spec": "Holy Priest",
  "result": "Loss",
  "factAudit": [
    {
      "claim": "Direct quote of load-bearing claim from response.",
      "verdict": "verified",
      "evidence": "Exact prompt line (with timestamp) proving/refuting it; if not found write 'no supporting line found'."
    },
    {
      "claim": "Direct quote of load-bearing claim from response.",
      "verdict": "refuted",
      "severity": "minor",
      "evidence": "Exact prompt line (with timestamp) refuting it."
    }
  ],
  "prompt": {
    "sufficiency": 3,
    "noise": 4,
    "labelBias": 2,
    "inferenceScaffolding": 3,
    "notes": "One-sentence summary of key prompt quality issue, citing quality-report numbers where possible."
  },
  "response": {
    "accuracy": 4,
    "outcomeAlignment": 2,
    "focusCalibration": 3,
    "notes": "One-sentence summary of key response quality issue."
  },
  "provenance": {
    "judgeModel": "<actual judge model>",
    "judgedAt": "<ISO timestamp>",
    "promptSha256": "…",
    "responseSha256": "…"
  }
}
```

All 7 numeric scores are integers from 1–5. `factAudit` records **all entries from the PASS 1 rule set, truncation not allowed** (valid length 3–20, matching the lower and upper bounds of that rule); `verdict` ∈ `verified` / `refuted` / `unsupported`. `provenance` is mandatory for each file: hash is computed with `shasum -a 256 <prompt file> <response file>` **after fully reading both files**; never backfill provenance for score files not evaluated in this round. Entries where `verdict` is not `verified` must include `severity` ∈ `minor` / `fabricated`; `response.accuracy` must equal the computed value from `computeAccuracyFromFactAudit` (enforced by checkProvenance since 2026-08-05; earlier historical runs were verified with validators of that time and are not retroactively re-tested).

Run strict validation after all scores are written (any non-compliant file = entire run invalidated, re-evaluate after fixing):

```bash
BASE_DIR="$GLADLOG_EVAL_HOME/runs/<runId>" npx tsx packages/eval/scripts/checkProvenance.ts
```

## Step 4: Aggregate Report

Read all `scores/*.json`, write `runs/<runId>/eval-report.md`:

```markdown
# Healer Eval Report

**Run date:** YYYY-MM-DD
**Run:** <runId> | **Corpus fingerprint:** <content of fingerprint.txt>
**Matches evaluated:** N
**Spec distribution:** …

## Aggregate Scores

| Dimension             | Min | Max | Avg | % ≤ 2 (flagged) |
| --------------------- | --- | --- | --- | --------------- |
| (row for each 7 dims) |

## Flagged Matches (Any Dimension ≤ 2)

### NNN — Spec Win|Loss (matchId)

- **[dimension]**: score — (one-sentence notes)

## Cross-Spec Patterns

Mean score per dimension for each healer spec (≥2 matches); highlight spec dimensions with score ≤ 2.5.

## Top 3 Issues

Sorted by (number of matches with dimension ≤2) × (5 − mean score), each with common pattern description.

## Recommendations

Give a concrete suggestion for each of the Top 3: which part of `buildMatchContext` (`packages/analysis/src/context/`) or which analysis util to inspect/modify.
```

After writing the report, **append a row** to the Baseline evals table in `$GLADLOG_EVAL_HOME/ledger.md` (date, gladlog commit, corpus fingerprint, 7 dimensions mean±SD, hard-failure count, notes). Score files can be overwritten — the ledger row is the only persistent record of this run, never skip it.

## Notes

- Entire pipeline has no external dependencies, no API keys; do not create new `.ts`/`.js` files, do not modify source code.
- If index exceeds 50 items, evaluate only the first 50.
- Score files can overwrite old run artifacts.
