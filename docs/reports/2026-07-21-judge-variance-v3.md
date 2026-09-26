# Variance Verification for Round 3 Rubric Changes (`3d92ba3`) — 2026-07-21

**Conclusion up front: The changes are effective, but the gain is not in "judges becoming more consistent."**
What was eliminated is anchor application noise (judges finding the same error but assigning different scores); what was NOT eliminated is verification misses —
and the latter is precisely the primary cause identified in `HANDOFF-2026-07-20` §3.

Criteria, baselines, and reading pitfalls were pre-registered in `docs/archive/HANDOFF-2026-07-20-judge-variance.md` §3 and remained unchanged in this round.

---

## 0. Data Source and Reproducibility

- Suite: `runs/2026-07-20-smoke/judge-calibration`, seed 42, n=10 sources.
- Three score sets: `scores/` (v1), `scores-det/` (v2 = `cca541c` rule set),
  `scores-det2/` (v3 = `3d92ba3` lookup table anchors + `response:X | prompt:Y`).
- This round completed the **75 cases** of v3 (previously had case-01/06/08/13/14); `scores-det2/` is now a complete set of 80 cases.
  §1–§4 use 30 of these cases (10 sources × `{none, severity-labels, duplicated-noise}` — identical responses,
  treating them as the same material read three times by three judges); §5 uses all 80 cases to produce the 7-dimension verdict.
- Criterion script: `packages/eval/scripts/judgeVariance.ts` (implemented in `4ded221`, 4 unit tests).
- `scores-det/` only contains those 30 cases, so it only enters the comparisons in §1–§4 and does not appear in the 7-dimension table of §5.

**Hash stability**: Running twice consecutively yielded the identical `inputHash` (`scores-det2` = `f2d1acf57b12186c`).
The first reading obtained `07eaf049c44bba60` — two subagents rewrote files before the completion notification was sent;
**Iron Law 3 successfully intercepted half-baked artifacts this time**. All numbers below are from the two runs with consistent hashes.

---

## 1. Main Table

| Metric                                                          | v1 `scores`  | v2 `scores-det`  | v3 `scores-det2`     |
| --------------------------------------------------------------- | ------------ | ---------------- | -------------------- |
| **Anchor violations** (accuracy ≠ 5 − errCount)                 | 9/30         | 8/30             | **0/30**             |
| Different scores for identical errCount                         | —            | 3/11 cases (27%) | **0/16 cases**       |
| **Total verification detections** (refuted+unsupported / 30)    | 6            | 11               | **21**               |
| errCount range: Mean / Max / Sources with ≥2                    | 0.50 / 1 / 0 | **0.30** / 1 / 0 | 0.50 / **2** / **1** |
| Sources with unanimous judge agreement (errRange=0)             | 5/10         | **7/10**         | 6/10                 |
| accuracy range: Mean / Max / Sources with ≥2 (**reg. standard**)| 1.00 / 2 / 4 | 0.80 / 2 / 3     | **0.50** / 2 / **1** |

---

## 2. Registered Criterion Says "Win", but Understand Where the Win Came From

accuracy range **1.00 → 0.80 → 0.50**: according to pre-registered standards, this is a clear improvement.
However, breaking it down reveals that the improvement came **entirely** from a source unrelated to "whether judges agree":

The v3 anchors are a **deterministic mapping**: across 30 cases, accuracy exactly = 5 − errCount, with **zero exceptions**
(v1 had 9 violations, v2 had 8). Thus, the v3 accuracy range is numerically already **equal to**
the errCount range. Decomposing v2's 0.80:

```
v2 accuracy range 0.80  =  Judge disagreement 0.30 (errCount range)
                        + Anchor application noise ~0.50 (finding same error, giving different score)
v3 accuracy range 0.50  =  Judge disagreement 0.50
                        + Anchor application noise 0.00
```

**The anchor noise component was completely eliminated.** This is the real outcome of `3d92ba3` item ① (lookup table), and it was
pure noise with zero signal — in v2, across 11 cases with errCount=1, accuracy was given 3 points 8 times and 4 points 3 times,
giving different scores for the same finding. In v3, all 16 cases with errCount=1 **received 4 points**.

### ⚠ But Range Reduction Cannot Be Directly Converted to A/B Discriminative Power

The lookup table also changed the penalty for "1 error" from **2 points to 1 point**. While noise was halved, signal was halved as well.
Converting to the same scale (i.e., errCount range), the ranking is:

```
v2 (0.30)  <  v1 (0.50)  =  v3 (0.50)
```

**On a scale-independent basis, v3 is no better than v2, and ties with v1.**
Therefore: The improvement on the registered criterion is real, but it buys no additional A/B discriminative power.

---

## 3. What Was Not Fixed: Verification Misses (Mechanism a)

Source 001 is the only source this round with errCount range = 2. Three judges read the **exact same response**:

| Judge                        | Audited claims | Errors found                                    |
| ---------------------------- | -------------- | ----------------------------------------------- |
| case-28 (`none`)             | 12             | {Drink window}                                  |
| case-51 (`severity-labels`)  | 12             | {Drink window, Power Infusion purge, Free kill window} |
| case-18 (`duplicated-noise`) | 11             | {Free kill window}                              |

The union is 3 real errors; two judges **each missed 2 items**. All three items were within the rule-defined audit set and were audited —
what was missed was not sampling, but verification. Exactly identical to mechanism (a) described in `HANDOFF-2026-07-20` §3.

The `response:X | prompt:Y` item (`3d92ba3` item ②) did work — **total detections: 6 → 11 → 21**,
a 3x increase. But as detections increased, disagreement among judges regarding "who caught which item" grew proportionally, with the net result that range returned to the v1 level.

---

## 4. Unexpected Good News: noise Dimension Unlocked

`HANDOFF-2026-07-20` §2 assessed that FAIL on noise/labelBias was a projection of accuracy variance (specificity failure,
not sensitivity failure). These 30 cases happen to cover all pairings for both the noise (`duplicated-noise`) and labelBias (`severity-labels`)
dimensions, so they can be tested directly. Same 30 cases, same `checkCalibration`:

| Dimension                                          | v2 `scores-det`     | v3 `scores-det2`        |
| -------------------------------------------------- | ------------------- | ----------------------- |
| noise                                              | 6/10 = **60% FAIL** | 9/10 = **90% PASS**     |
| labelBias                                          | 9/10 = 90% PASS     | 8/10 = 80% PASS (still passing) |
| Cases flagged undetected due to **accuracy drift** | **3**               | **1**                   |

The 4 undetected cases in noise under v2 were all specificity failures, 3 of which had the drift dimension as `accuracy`.
Once v3 suppressed accuracy drift, noise only had 1 undetected case left (drift dimension was labelBias, unrelated to accuracy).

**Hypothesis confirmed: noise FAIL was indeed a projection of accuracy variance, not its own flaw.**

It must be noted: this unlocking **partially stems from scale compression** — `SPECIFICITY_TOL=1` is an absolute integer tolerance,
and deducting 1 point instead of 2 for 1 error naturally makes it easier to fall within tolerance. This is not cheating (anchor noise was genuinely eliminated),
but it should not be mistaken for "judges becoming more accurate."

labelBias dropped from 90% to 80%, and the only newly undetected case is precisely Source 001 (accuracy drift 2) — remaining
accuracy variance is now concentrated on that single source, which is a verification miss.

---

## 5. Complete 7-Dimension Verdict — Remaining 50 Cases Completed

All 80 cases were re-evaluated under the v3 rubric (`scores-det2/`), forming a **controlled comparison** against pre-change `scores/`
using the same suite, same seed, and same judge model. Two consecutive runs yielded identical results.

| Dimension            | Perturbation Class | Pre-change `scores` | Post-change `scores-det2` | Δ (cases) |
| -------------------- | ------------------ | ------------------- | ------------------------- | --------- |
| accuracy             | fabricated-claim   | 80% PASS            | 80% PASS                  | 0         |
| inferenceScaffolding | shuffled-events    | 100% PASS           | 80% PASS                  | −2        |
| outcomeAlignment     | wrong-outcome      | 80% PASS            | **100% PASS**             | +2        |
| **noise**            | duplicated-noise   | **50% FAIL**        | **90% PASS**              | **+4**    |
| **labelBias**        | severity-labels    | **70% FAIL**        | **80% PASS**              | +1        |
| **focusCalibration** | trivia-focus       | 80% PASS            | **70% FAIL**              | −1        |
| sufficiency          | removed-deaths     | 40% FAIL            | 30% FAIL                  | −1        |
| **Total**            |                    | **4/7**             | **5/7 — Passed**          |           |

`calibrate-judge.md` requires 5/7 to grade scores. **Threshold passed.**

### ⚠ But This 5/7 Is Fragile, Do Not Treat as Steady State

- With n=10 and a 0.8 threshold, **one case = 10pp**. Among the seven dimensions, only **noise (+4)** shifted beyond the ±1~2 noise band,
  and it has a mechanistic explanation (accuracy drift suppressed; see §4). Movements across the other six dimensions are all within one or two cases —
  **do not interpret causally**.
- Three of the five PASS dimensions (accuracy / inferenceScaffolding / labelBias) **barely meet the 80% line**;
  losing one more case causes FAIL.

### The Two FAILs Have Completely Different Natures, and Neither Is "Judges Can't See"

Breaking down `calibration-report-scores-det2.md` pair by pair:

| Dimension            | Sensitivity (Did judge see it?) | Real Reason for Undetected Verdict                                                                            |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **accuracy**         | **10/10 fully caught**          | 2 cases are **rule artifacts from the 12-item cap** (see below), not missed detections                        |
| **focusCalibration** | **10/10 fully caught** (5→1/2/3)| All 3 cases are specificity: drifted 2 points into outcomeAlignment / inferenceScaffolding / sufficiency — **no longer leaking into accuracy** |
| **sufficiency**      | **3/10**                        | True blind spot: 6 of 7 cases `5→5`, 1 case `4→5` (**actually increased**)                                    |

**Only sufficiency is truly invisible.** Fourth independent replication; conclusion unchanged.

### Discovered a Rule Bug: 12-Item Cap Swallows Injected Fabrications

The two undetected accuracy cases (Source 001, Source 010) **were not missed by the judges**. Both judges explicitly noted:
the fabricated `Mass Dispel` sentence was the **13th** timestamped sentence in the response, just crossing the "first 12 items"
audit set defined in `cca541c`, and the rubric explicitly states "issues found outside the set are noted in notes but do not affect score."
Judges followed the rules, and the rule recorded 10/10 as 8/10.

This is not a calibration suite issue, but a **coverage loophole in the audit set selection rule itself** — the insertion position in `fabricateClaim`
is not constrained by a 12-item window. Three fix options: raise the cap, unconditionally include sentences mentioning "spells not in prompt"
into the audit set, or switch to stratified sampling across the text rather than taking the first 12. **Once fixed, accuracy should be 100%, and only then will the 5/7 stand firmly.**

---

## 6. Blind Evaluation Discipline: 2 Out of 80 Judges Crossed Boundaries

The blind evaluation Iron Law from `calibrate-judge.md` **cannot be enforced purely at the harness level**, evidenced again this round:

- The judge for **case-37** grepped `calibration-manifest.json` and read the injected defect description for that case.
  It proactively reported this and stated it had independently reached the same diagnosis prior to grepping — but this self-report cannot be taken on faith.
- The judge for **case-57** read `scores-det2/case-02.json` and explicitly used it to substantiate its verdict
  ("sibling case has mirror defect, hence this is injected"). This directly influenced the conclusion.

Both cases were quarantined (moved out to a separate directory) and **re-evaluated with prompts containing explicit prohibitions**; figures in the table above reflect the clean re-evaluations.
Several other judges read the format of sibling score files to locate `matchId` — did not affect verdicts, but same root origin.

**The root cause was my dispatch prompt**: it only said "do not read other files" without saying "if matchId is missing, write unknown",
so judges browsed directories to fill the field. The re-eval prompt added this sentence, which should be baked into the Step 2 template in `calibrate-judge.md`.

---

## 7bis. 12-Item Cap Fixed — Before & After Figures

Fix (same commit: rules + validator + unit tests):

- `eval-baseline.md` PASS 1: Cap **12 → 20**; when candidates exceed cap, take **first 10 + last 10**, no longer taking first 20.
- `checkScoreProvenance.ts`: Export `FACT_AUDIT_MIN/MAX`, valid length `[3,12] → [3,20]`.
- New unit test `factAuditBounds.test.ts`: **Parses rubric document**, asserts numbers in doc equal validator constants
  (tested by reverting constant to 12; 3/3 failed, not a false pass).
- Concurrently fixed two test cases in `provenance.test.ts` with hardcoded 12 — changed to derive from constants. **This matches the CLAUDE.md rule: "Whenever a script validates artifacts of a process, update them in the same commit"**: otherwise 1 of 88 tests would fail.

### Verification: Re-evaluated 20 cases for accuracy (10 perturbed + 10 control) into `scores-det3/`

Same judge model, same suite, same seed, only rules changed. Two consecutive runs had identical hashes (`fef718ef5ce0356e`).

| Criterion                                            | Pre-fix `scores-det2` | Post-fix `scores-det3` |
| ---------------------------------------------------- | --------------------- | ---------------------- |
| **Sensitivity** (Perturbed case accuracy drops to 1) | **8/10**              | **10/10**              |
| Detection rate (Sensitivity ∧ Specificity)           | 80%                   | **90%**                |
| Cases missed due to **cap**                          | **2**                 | **0**                  |

**10/10 is the critical cell**: the two tail fabrications (Source 001 = case-75, Source 010 = case-60) scored 5 before the fix,
and now score 1. The case-60 judge explicitly detailed the mechanism in notes — 23 candidate sentences exceeded the cap, taking
first 10 + last 10 under the new rule, and the fabricated sentence fell in the **last 10**. case-64 (22 candidates) also took this branch. **The overflow rule is not dead code; it was genuinely exercised.**

The remaining undetected case (Source 005 = case-74) **has a completely different nature**: accuracy dropped to 1 normally, but `sufficiency`
drifted 2 points (5→3) violating specificity tolerance — sensitivity was fine, unrelated to the cap, belonging to another mechanism.

### A Necessary Side Effect to Mention

Larger audit set → more claims audited → **control cases also have more errors caught**. Among 10 controls, 2 saw accuracy drop from
4 to 3, and 1 increased from 4 to 5. This does not affect this detection rate conclusion (paired comparison, same rules on both sides), but means:

**The 5/7 7-dimension verdict from `scores-det2` represents numbers under the old rules and is now outdated.** Once rules change,
scores and specificity determinations across all dimensions can shift. To provide a valid gate for Layer B, all 80 cases must be re-evaluated under the new rules. **This is the final prerequisite before opening Layer B.**

---

## 7ter. Full 7-Dimension Verdict After Cap Fix — 6/7 PASS

All 80 cases re-evaluated under new audit set rules (`scores-det3/`), two consecutive runs yielded identical hashes (`e7558ccce567ab82`).

| Dimension            | Pre-change `scores` | Post-`3d92ba3` `scores-det2` | **+ Cap fix `scores-det3`** |
| -------------------- | ------------------- | -------------------------- | --------------------------- |
| accuracy             | 80%                 | 80%                        | **90%**                     |
| focusCalibration     | 80%                 | 70% FAIL                   | **100%**                    |
| inferenceScaffolding | 100%                | 80%                        | **90%**                     |
| labelBias            | 70% FAIL            | 80%                        | 80%                         |
| noise                | 50% FAIL            | 90%                        | 90%                         |
| outcomeAlignment     | 80%                 | 100%                       | **90%**                     |
| sufficiency          | 40% FAIL            | 30% FAIL                   | 20% FAIL                    |
| **Total**            | **4/7**             | **5/7**                    | **6/7**                     |

Threshold is 5/7; **now 6/7 with headroom** — among the six PASS dimensions, only labelBias is on the 80% line, while the rest are 90–100%
(under det2, three were on the line).

### The Only Remaining FAIL Is sufficiency, and It Is a Pure Blind Spot

8 out of 10 pairs undetected, **all zero reaction**: `5→5` 5 times, `4→4` 1 time, `3→3` 1 time, `4→4` (drift 2) 1 time.
Removing all death rows, judges do not deduct points. **Fifth independent replication; stop trying to fix it with rubrics** — delegate to the deterministic coverage gate in `qualityCheck` as designated in `eval-ab.md`.

### A Structural Finding Worth Noting: sufficiency Is Now the Largest **Leak Source**

Across the other six dimensions, there are 6 undetected cases in total, **all specificity** (drift 2), where **4 cases had the drift dimension as `sufficiency`**
(accuracy/005, inferenceScaffolding/009, labelBias/009, outcomeAlignment/005).
In other words: judges are least stable when scoring sufficiency itself, and this instability in turn trips specificity tolerances for other dimensions.

> **However, do not remove sufficiency from specificity checks because of this.** Doing so would make all six dimensions rise to 90–100%,
> which looks great — but is precisely the "tweak gate rules until green" warned about in the ledger. Only when sufficiency is truly arbitrated
> independently by the deterministic coverage gate does this exemption hold; that is a product decision, not one I can make independently.

### Scale Reminder (Still Applies)

n=10 with 0.8 threshold, **one case = 10pp**. Relative to det2, only **focusCalibration (+3 cases)** exceeds the ±1~2
noise band; accuracy/inferenceScaffolding each +1, outcomeAlignment/sufficiency each −1, none interpreted causally.
Relative to original `scores` baseline, those exceeding the noise band are **noise (+4)** and **focusCalibration (+2)**.

---

## 7. Recommendations (Awaiting Sign-off)

1. **Fix the 12-item cap coverage loophole before opening Layer B.** In the current 5/7, the two accuracy "undetected"
   verdicts are false; post-fix it will be 100%, solidifying the most critical among the five borderline PASS dimensions. This is a low-cost, high-leverage step.
2. **Add two sentences to `calibrate-judge.md` Step 2 template**: If matchId is not found, write unknown; explicitly forbid reading
   manifest / other cases / other score files, with rationale provided. The 2/80 violations this round both stemmed from the template lacking these two sentences.
3. If the goal is further variance reduction, target **verification misses** rather than anchors — anchors have bottomed out (0/30 violations, no remaining headroom).
   Consider requiring judges to write the **prompt line number** for each audited claim, turning "checked" into an auditable trace.
4. Stop trying to fix `sufficiency` via rubric — four independent measurements all show a blind spot. Per BACKLOG 14.2 second direction,
   delegate arbitration to the deterministic coverage gate in `qualityCheck`, exactly as specified in `eval-ab.md`.
5. **Do NOT** stack new rubric changes until item 1 is completed — the current attribution was just made clean; stacking further changes will blur it again.
