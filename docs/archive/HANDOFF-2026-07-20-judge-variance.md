# Handoff — Judge Variance and Layer B Blockage (2026-07-20 Night)

> **Archived 2026-09-26** — historical handoff; paths and state may no longer match the repo.

**This document has real action items** — it is not a completed archive. There is only one core action item: measure the effect of the third-round rubric changes.

---

## 1. Completed — Do Not Touch

### Layer A Full-Corpus Audit — All Three Gates Green

Corpus `manifest-fullscale.txt` (70 logs → **1245 encounters**), fingerprint `1245: 6e46b50e..c22e9165`,
final SHA **`92f96d2`**.

| Gate                                       | Pre-fix     | Final      |
| ------------------------------------------ | ----------- | ---------- |
| CJK / localized name leaks                 | 1/1245      | **0/1245** |
| Deaths reverse diff (hallucination/drop/drift) | 0/0/0       | 0/0/0      |
| Inline sequence redundancy                 | 0           | 0          |
| HP consistency (DMG SPIKE vs STATE same-sec) | 0/6322      | 0/6322     |
| death-trace stale reads                    | 0/3947      | 0/3947     |
| Geometry grounding                         | 0/24881     | 0/24881    |
| qualityCheck hard failures                 | 9 items / 8 encounters | **0**      |

Three findings — two real, one false — all fixed and verified:

- **#1 `[HEALER CC]` caster label** (real bug, `2967959`) — used `pid()` instead of the shared predicate
  `actorLabel()`; bare names **100/100 → 0/100**. The same class of bug was fixed on two paths on 2026-07-17; this was the missed third path.
- **#2a Death `[RES]` snapshot taking T-3s** (real bug, `92f96d2`) — snapshot placed right at `[DEATH]` but without its own
  timestamp; readers and gate rules both interpreted it as the same instant. Hard failures **3 → 0**.
- **#2b Gate rule discarding `N:` attribution prefix** (**checker bug**, `4997308`) — misattribution in mirror comps;
  9 reports, 6 false positives (**67%**) → 0 false positives.

Report at `$GLADLOG_EVAL_HOME/runs/2026-07-20-fullscale-audit/PIPELINE-AUDIT-REPORT.md`.

### v0.0.16 Released

All four assets present (win exe/zip + mac dmg/zip), CI green.

---

## 2. Why Layer B Has Not Run Yet

`calibrate-judge.md` requires **5/7 dimensions to pass before scoring**. n=10 suite (80 items, seed 42) results:

| PASS                      | FAIL            |
| ------------------------- | --------------- |
| inferenceScaffolding 100% | sufficiency 40% |
| accuracy 80%              | noise 50%       |
| outcomeAlignment 80%      | labelBias 70%   |
| focusCalibration 80%      |                 |

**4/7.** But the three FAILs differ in nature — that is the key point:

### Blocker A — accuracy Inter-Judge Variance ±2 (BACKLOG 14.5)

The `noise` and `labelBias` failures **are entirely specificity failures, not sensitivity failures**: judges nail the target defects hard and accurately
(5→3, 5→1), but accuracy simultaneously drifts by 2 points, exceeding the ±1 tolerance and triggering a failure.

The variance is measured, not inferred. Method: `none` / `severity-labels` / `duplicated-noise` — all three perturbation types
**delete no content and alter no response**, so the three items from the same source = **the same material read three times by three independent judges**.
Measured accuracy range mean: **1.00**; 4 out of 10 sources have range ≥2.

**Therefore, the noise/labelBias FAILs are projections of accuracy variance, not defects of their own.**

### Blocker B — sufficiency True Blind Spot (BACKLOG 14.2)

Unrelated to variance: out of 10 cases, **6 scored `5→5`** — all death lines deleted from the prompt, yet the judge deducted zero points. Pure sensitivity
failure; reproduced across **three independent measurements** (n=5 two rounds + n=10 one round). Neither direction in the BACKLOG has been attempted.

---

## 3. The Only Action Item: Test the Third-Round Changes

### Three Commits Landed but **Not Verified**

| Commit    | What Changed                                                                  | Effect                                             |
| --------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| `cca541c` | PASS 1 audit set determined by rules (all assertive sentences containing `M:SS`, capped at 12); accuracy scored only on that set | **Tested, not confirmed** (1.00 → 0.80, indistinguishable from noise at n=10) |
| `5e9415e` | `factAudit` length [3,12] + validator + two unit tests                        | Fixes an inconsistency I introduced myself (see §5) |
| `3d92ba3` | ① accuracy anchor changed to **lookup table**; ② claims containing numbers must include `response:X \| prompt:Y` as evidence | **Not tested** ← action item                       |

### How to Test (criteria pre-registered — do not change)

1. Re-evaluate **30 items**: 10 sources × `{none, severity-labels, duplicated-noise}` in `judge-calibration/cases/`,
   output to `scores-det2/` (**5 already completed**: case-01/06/08/13/14).
2. Criteria: **accuracy range across the three items per source**, report mean / max / number of sources with range ≥2.
3. Baseline: v1 hand-picked 3 items = **1.00**, v2 rule-based set = **0.80**.

### ⚠ Pitfall When Reading Results (exposed by data from the 5 completed items)

The lookup-table anchor changed "exactly 1 minor error" from 3 to 4. In the 5 items already returned, **four shifted from 3 to 4** — purely a mapping uplift;
the judges' substantive disagreement has not changed at all. The none/dup pair for source 8 saw its range drop from 2 to 1 for the same reason —
one judge found 0 errors, the other found 1; **the disagreement remains**, but the finer scale compressed the gap to 1 notch.

**Therefore, a decrease in range does not equal a decrease in variance.** You must also compare **whether the error sets found by judges are consistent**
(`factAudit` entries where verdict ∈ refuted/unsupported) — that is the substantive metric. Recommendation: make this the primary criterion and demote range to a secondary criterion.

### Mechanism Breakdown (already done — use directly)

Per-case analysis of `scores-det`; the 5 sources that still showed disagreement post-fix fall into two categories:

| Mechanism                 | Sources | Range | Behavior                                      |
| ------------------------- | ------- | ----- | --------------------------------------------- |
| **(a) Verification miss** | 1, 4, 8 | **2** | One judge found the error; the other two ruled verified |
| **(b) Anchor mapping**    | 2, 6    | 1     | All three judges found **the same error** but scored 3/3/4 and 3/4/4 |

**The primary cause is (a), not (b).** Key finding: the misses were **not due to failing to sample the claim**. Source 4's
"41%(0:31)→21%(0:33)" contains timestamps and is necessarily in the rule-based set; all three judges audited it, two caught it,
one ruled verified. Nearly all missed errors are numerical mismatches: `41%` vs `42%`, `0:31` vs `0:32`,
`19% lowest` vs actual `16%`, "only three Drinks" when there were also trinket and Angelic Feather.

The two rules in `3d92ba3` target (a) and (b) respectively.

---

## 4. Dead Ends — Do Not Revisit (burned through tonight)

1. **Extrapolating from a single confirmed case to the entire class.** Confirmed one real contradiction at ord 181, then claimed "all 8 encounters are real." After per-item attribution review,
   **6/9 turned out to be gate-rule errors**. Caught by Iron Rule 2 (suspect the checker first).
2. **`duplicated-noise` constructively coupling with accuracy.** Hypothesized "duplication changes counts; rubric requires recounting,
   so the response's correct count becomes wrong" → planned to add to `COUPLED_BY_CONSTRUCTION`. Per-case review of case-06/13/49
   refuted claims showed **all errors pre-existed in the original response text**, unrelated to line duplication. **Falsified; not added.**
3. **Deterministic audit set can resolve variance.** Mechanism is clear, per-case evidence exists, measured 1.00 → 0.80, but **indistinguishable
   from noise at n=10**. Change retained (eliminates one arbitrary degree of freedom) but does not count as resolved.

All three times, numbers pulled the conclusion back — none passed on "sounds reasonable."

---

## 5. Environment and Process Pitfalls (will bite you)

- **Sub-agent cap at 200/session.** Hit the limit tonight; third-round verification could not be completed. To continue: new session + increase
  `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`; the remaining 25 items to re-evaluate need roughly 30 more quota.
- **Blind evaluation iron rule is not enforced at the harness level.** Sub-agent completion notifications automatically push score summaries into the orchestrator's context;
  this cannot be blocked. Harmless this round (all dispatched before any results returned, agents isolated from each other, verdicts computed by script), but
  `calibrate-judge.md` should explicitly state this — do not let anyone assume this rule holds automatically.
- **Sub-agents rewrite files during post-completion validation.** The first time v2 was evaluated, numbers differed across three outputs because execution was mid-flight.
  **You must run `checkCalibration` twice and get identical hashes** before using the numbers (Iron Rule 3).
- **When modifying judge workflow, any script that validates that workflow's artifacts must be updated in the same commit.** I changed the PASS 1
  audit set size without updating the `factAudit` length convention (format section + `checkScoreProvenance.ts` both locked to
  "exactly 3 items"); re-evaluating 30 items produced anywhere from 3 to 12 entries. Fixed (`5e9415e`), but this was a self-inflicted wound.
- **Concurrent sessions use `git add -A` and sweep up in-progress artifacts.** Tonight `65f795c`/`a4d2e87`/`f6dce47` — three
  docs commits with unrelated titles — contained my changes mixed in. No content lost, but history attribution is dirty.

---

## 6. Shortest Path

1. Complete the remaining 25 items → obtain third-round numbers (use §3 criteria; watch for that pitfall).
2. If (a) does drop: `noise` and `labelBias` will likely flip to PASS → **4/7 → 6/7**.
3. `sufficiency` bypassed via BACKLOG 14.2's second direction (delegate to `qualityCheck`'s deterministic coverage gate;
   `eval-ab.md` already specifies that this dimension is adjudicated by deterministic metrics) → **7/7 all have adjudicative power**.
4. Only then open Layer B for scoring.

Do not touch the rubric until step 1 produces numbers — there are currently three unverified changes pending; stacking more on top makes it impossible to attribute effects.
