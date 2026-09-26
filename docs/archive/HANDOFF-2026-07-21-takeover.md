# Takeover Instructions — 2026-07-21

> **Archived 2026-09-26** — historical handoff; paths and state may no longer match the repo.

**For the session taking over this work.** From here on you have full ownership — no need to come back and ask what the previous round did.
Reading this document plus the two documents it references is sufficient. **Do not dig through old session logs.**

---

## 0. Do These Three Things First (skipping them will cause problems)

1. **Verify sub-agent quota is active**: `echo $CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` should output `2000`.
   Already written into the `env` block of `~/.claude/settings.json`, but **only takes effect in a new session**. If the output is empty,
   you are still in an old process — restart the session. The previous round stalled precisely because it hit the 200 cap.
2. **Read `CLAUDE.md`** — the two iron rules (gate-rule predicate is the spec; fixes must include before/after numbers) are not suggestions;
   they are lessons this project paid for. All tasks below are accepted against these two rules.
3. **`git log --oneline -8`** to glance at history. `main` is clean; commit + push directly to main —
   no branches, no PRs (see memory `gladlog-commit-workflow`).

---

## 1. ~~The Only Hard Action Item: Test Third-Round Rubric Changes~~ ✅ Done (2026-07-21)

> **Results in `docs/reports/2026-07-21-judge-variance-v3.md` (commit `277e80d`).**
> All 30 items completed; criteria crystallized into `packages/eval/scripts/judgeVariance.ts` (`4ded221`).
> One-liner: registered criterion accuracy range 1.00 → 0.80 → **0.50**, but the win is not "judges became more consistent" —
> anchor application noise zeroed out (30/30 deterministic mapping), verification detections tripled (6 → 11 → **21**),
> while judges' substantive disagreement (errCount range) went 0.50 → 0.30 → **0.50**, back to v1.
> Side effect: noise dimension 50% FAIL → **90% PASS**, confirming its FAIL was a projection of accuracy variance.
>
> Remaining 50 items also completed (all 80). 7-dimension verdict: 4/7 → **5/7**, passing the scoring threshold for the first time.
> But it was fragile, and a rule bug was found: accuracy's two "not detected" cases were eaten by the 12-item audit set cap.
>
> **Cap fixed** (`d39b34b`: 12 → 20; when over limit, take first 10 + last 10; validator + docs synced with unit tests).
> All 80 items re-evaluated under the new rule (`scores-det3`), **final 4/7 → 5/7 → 6/7, with comfortable margins** —
> among the six PASSes, only labelBias sits at the 80% line; the rest are 90–100%.
> **Layer B can now proceed.**
>
> The only FAIL is `sufficiency` (20%; 8/10 not detected, all zero-response cases, fifth reproduction) —
> a pure blind spot; stop trying to fix it with rubric changes. Per `eval-ab.md`, delegate to `qualityCheck`'s deterministic coverage gate.
> Report §7ter also notes a point for you to decide: sufficiency is simultaneously the largest leakage source; removing it from specificity
> checks would raise the other six dimensions to 90–100%, but that amounts to "tuning gate rules until they turn green" — I did not adopt this unilaterally.
>
> Below is the original task description, kept for the record.

**This is the only thing left unfinished from the previous round — blocked on sub-agent quota, which is now available.**

Full context in **`docs/HANDOFF-2026-07-20-judge-variance.md`**; that document is accurate, follow it as-is.
Condensed version:

- Layer B scoring requires 5 of 7 dimensions to pass; currently at **4/7**.
- Two real blockers: accuracy inter-judge variance ±2 (dragging noise/labelBias specificity down with it),
  and sufficiency true blind spot (all death lines deleted yet judge deducts zero — reproduced across three independent measurements).
- The landed but **unverified** change is `3d92ba3` (accuracy anchor switched to lookup table + claims containing numbers must include
  `response:X | prompt:Y`).
- **How to test**: re-evaluate 30 items (10 sources × `{none, severity-labels, duplicated-noise}`) to
  `scores-det2/`; **5 already completed** (case-01/06/08/13/14), complete the remaining 25.
- **Criteria are pre-registered — do not change**: accuracy range across each source's three items; report mean / max / number of sources with range ≥2.
  Baseline v1 = 1.00, v2 = 0.80.

### ⚠ Result-Reading Pitfall (must read — skipping will lead to wrong conclusions)

The lookup-table anchor changed "exactly 1 minor error" from 3 points to 4 points. **A decrease in range does not equal a decrease in variance** — in the 5 items
already returned, four shifted from 3 to 4, purely a mapping uplift; judges' substantive disagreement has not changed at all.

**Therefore the primary criterion should be "whether the error sets found by judges are consistent"** (`factAudit` entries where verdict ∈
refuted/unsupported); range is demoted to a secondary criterion. `HANDOFF-2026-07-20` §3 has a detailed breakdown,
plus the already-completed mechanism analysis ((a) verification miss vs (b) anchor mapping; primary cause is (a)).

### Two More Process Iron Rules

- **Sub-agents rewrite files during post-completion validation.** You must **run `checkCalibration` twice and get identical hashes**
  before using the numbers; otherwise you will be reading half-finished artifacts (the first time v2 was evaluated in the previous round, three outputs all differed).
- **When modifying judge workflow, any script that validates that workflow's artifacts must be updated in the same commit.** The previous round changed
  the PASS 1 audit set size without syncing `checkScoreProvenance.ts`'s length convention — a self-inflicted wound.

---

## 2. ~~Two Product Decisions Awaiting My Call~~ ✅ Both decided and landed (2026-07-22)

> **Decision one = infer as available** (with requirement: quantify noise impact). `getTrinketStateAtTime` not observed
> in use → return true; type tightened to boolean. Full-corpus measurement: [OPPORTUNITY] 1491 → 101
> ("status unknown" supported 1424 → 0; true on-CD opportunities 67 → 101, previously crowded out of top-N by unknown entries);
> [CONTESTED] unknown 151 → 0, all converted to available; on CD 46 unchanged; conservation with zero loss.
> Noise impact: template/exact duplication rate unchanged (0.304/0.021), token p50 −0.35%.
> **Decision two = add only discrete active CDs.** 7 spells (8 aura IDs; Nature's Swiftness has dual IDs) added to
> spellCategories + HIGH_VALUE_PURGEABLE_BUFFS; IDs reverse-extracted from EN corpus, verified against full CN corpus
> by ID, dispelType=Magic sourced from DB2; durations are corpus applied→removed p50.
> MISSED PURGE 2251 → 2571 (+320; Innervate 0 — no instances in corpus where enemy side sat for full 3s;
> pathway guaranteed by purgeWhitelist test). All three Layer A gates green. Original text kept below for the record.

The previous round conducted an evidence-gap census; three of five items were fixed/closed, **two are blocked on product judgment — I wasn't awake,
so I deliberately did not act**. You should not act on them either, unless I explicitly say what to do. Full numbers in
**`docs/reports/2026-07-21-evidence-gap-survey.md` §6.5**.

### Decision One: Should enemy trinket "not observed in use" be inferred as "available"?

The friendly path treats "not used" as available; the enemy path marks it as "unknown" — the same asymmetry. Arena starts reset cooldowns,
so logically it should be inferred as available. However:

```
[OPPORTUNITY] total 1491 lines
  Supported by "status unknown"  1424 lines = 95.5%
```

**Fixing this would delete 95% of this entire section** — the opposite direction from my "too little evidence" complaint. Conversely, if the inference
is valid, those 1424 lines are suggesting a nonexistent opportunity — worse than lacking evidence. `[CONTESTED]` has the same root cause.

**The key question here is not code — it is the game fact of "whether arena-start trinket is guaranteed ready."** I will decide.

### Decision Two: Should persistent buffs (HoTs / shields) be included in missed-purge detection?

Measured impact of enabling this category: **103 → 892 lines (8.7×)**, of which 59% are Wild Growth 201,
Enveloping Mist 112, Rejuvenation 82, Riptide 80, Lifebloom 52 — buffs that are always up. Telling a healer
201 times "you didn't purge the enemy's Rejuvenation" is noise, not evidence.

But several **discrete active CDs** clearly should be included but are not: Blessing of Sanctuary, Innervate,
Nether Ward, Time Stop, Tip the Scales, Nature's Swiftness, Spiritwalker's Grace.
These are the same class as those already on the whitelist (Power Infusion, Combustion, Alter Time).

**I lean toward adding only discrete active CDs and not persistent buffs, but need to confirm before acting.**

---

## 3. Already Closed — Do Not Redo

| Item                              | Status                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------- |
| Enemy major CD `none tracked` 65% | ✅ `bf17ccf`, 805/1245 → 1/1245, 0 lost +15073 new                               |
| Missed-purge whitelist: 9 entries, 7 dead | ✅ `2f1954c`, 822 → 2251 lines, all gates green                             |
| `[KILL WINDOW]` cap at 6          | ❌ No change needed; all 595 omitted windows have rollup fallback                 |
| POSITIONING missing 34%           | ❌ Not a bug; `CLOSE_RANGE_YARDS=12` only classifies openers where owner is in melee; healers staying at range is correct play |
| Layer A full-corpus audit         | ✅ All three gates green @ `92f96d2`; re-run after every subsequent change         |
| v0.0.16                           | ✅ Released, all four assets present                                               |

**`docs/reports/2026-07-21-evidence-gap-survey.md` §4 has a "looks broken but actually isn't" table** —
five items, all near-false-positives I almost filed. Scan it before starting work; it will save you hours.

---

## 4. Things in This Project That Will Bite You

- **Do not guess section header strings from memory to measure coverage.** The previous round got it wrong five out of five times (`KILL SEQUENCE`
  actually appears in 250/1245, but I added brackets and searched for 0). **Either verify against emitter source-code literals, or reverse-extract from the corpus.**
- **Do not extrapolate from a single confirmed case to the entire class.** The previous round confirmed one real contradiction at ord 181 and declared "all 8 encounters are real";
  after per-item attribution review, **6/9 turned out to be gate-rule errors**. Suspect the checker first.
- **Looking only at headline numbers after a fix will ship with hidden regressions.** P1's first version made `972 → 1` look great;
  per-item **content** review revealed 1418 offensive CDs were lost (replacement instead of union). **Always do a "what was lost" conservation check.**
- **`npm test --workspace=packages/analysis`** — do not run `npx vitest run packages/analysis` from root
  — globals config won't take effect; all 58 files will report `describe is not defined`, which are false failures.
- **Type-check with `npm run typecheck`** — never `tsc -b` (it emits .js into src).
- **`ls` on large directories will flood the terminal** (runs/*/manifests has 1245 files); use `| wc -l`.

## 5. Commonly Used Commands

```bash
# Build corpus (10 logs ≈ 211 encounters, ~1 min; full 70 logs = 1245 encounters, ~15 min, recommend running in background)
npx tsx packages/eval/scripts/buildCorpus.ts --manifest <manifest> --run <runId>

# Layer A three gates (run full suite after every analysis code change)
node "$GLADLOG_EVAL_HOME/audit/layerAAudit.mjs" "$GLADLOG_EVAL_HOME/runs/<runId>"
BASE_DIR=$GLADLOG_EVAL_HOME/runs/<runId> MANIFEST=<manifest> npx tsx packages/eval/scripts/positioningScan.ts
npx tsx packages/eval/scripts/qualityCheck.ts --run <runId>
```

`$GLADLOG_EVAL_HOME` defaults to `~/code/gladlog-eval-private`; the full manifest is at
`$GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt`.

---

## 6. Your Priorities

1. **§1 judge variance verification** — this is the only thing blocking Layer B; the quota increase was requested for this.
2. Once done, wait for me to decide on the two §2 decisions.
3. In the meantime, **do not open new fronts**. The census has already covered everything that needed checking; the table in §3 is the boundary.
