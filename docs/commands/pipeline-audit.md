# pipeline-audit — Full-Corpus Two-Layer Audit Workflow

Perform **full-corpus** (every match, no sampling) bug hunting on the prompt pipeline: hallucinations, false parsing, localization leaks, token waste, and geometric inaccuracies. Outputs an audit report + fix checklist + final sign-off gate metrics. The first full-scale run methodology and lessons learned were established during the 2026-07-13→15 audit (1,245 matches, see eval repo `runs/2026-07-13-fullscale-audit/PIPELINE-AUDIT-REPORT.md`).

> **Division of Responsibility with Other Eval Workflows:**
>
> - `/eval-baseline`: Sampled evaluation of current quality to identify next fixes—lightweight, run frequently.
> - `/eval-ab`: Controlled validation of single builder changes—run after implementing fixes.
> - **This workflow**: Full-corpus two-layer audit—run after major changes, new season/spec data, or periodically (quarterly); expensive, run exhaustively.
>
> Run `/calibrate-judge` (TOL=1) before scoring.

Artifacts are written to `$GLADLOG_EVAL_HOME/runs/<YYYY-MM-DD-slug>`.

> **Which manifest after a season change.** `corpus/manifest-fullscale.txt` (70 logs) used below is
> a **2026-06, pre-12.1** set, as is `corpus/manifest-coverage.txt` (1 log) in `/eval-baseline`. The
> new-season equivalents are `corpus/manifest-ab-newseason.txt` (17 logs → 309 prompts, the sampled
> / A/B set) and `corpus/manifest-archive-2026-08-28-newseason.txt` (the 12.1 PvP archive manifest,
> 18,134 `.gz` entries — the full-corpus one). A "full corpus" audit run on `manifest-fullscale.txt`
> after the season boundary audits the previous season; say which manifest a run used, in the report
> and in the ledger row.
>
> **Cadence, honestly stated:** this workflow last really ran **2026-07-22**, and `/eval-baseline`'s
> last ledger row is **2026-07-22** with its newest `runs/` artifact **2026-08-06**. Signal-level
> rulings since then have gone through the outcome probe + deterministic metrics + the
> opportunity-normalised skill gradient (`packages/eval/src/explore/signalSkillGradient.ts`,
> stratified by rating bracket) rather than through a seven-dimension full-corpus pass; see
> [`docs/coaching-grounding-audit.md`](../coaching-grounding-audit.md). Layer A's deterministic
> gates are still the right tool for "is the rendered artifact self-consistent" and are unaffected
> by that shift.

## Two-Layer Structure

- **Layer A — Deterministic prompt-vs-log** (full corpus). Raw logs are too large to feed into LLMs; the prompt→log direction must be checked programmatically: oracle (`coverageManifest.ts`, built independently from raw parser events, intentionally bypassing prompt builders) + gate scripts.
- **Layer B — LLM evaluation of response-vs-prompt** + seeded defect calibration.

## Layer A Steps

```bash
# 1. Build full corpus at HEAD (Iron Rule 3: all gate metrics must include the commit SHA at measurement time)
npx tsx packages/eval/scripts/buildCorpus.ts --manifest "$GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt" --run <runId>
git rev-parse --short HEAD   # Record in report/ledger

# 2. Three gates
node "$GLADLOG_EVAL_HOME/audit/layerAAudit.mjs" "$GLADLOG_EVAL_HOME/runs/<runId>"   # CJK/death diff/redundancy/token/HP consistency/death-trace
BASE_DIR="$GLADLOG_EVAL_HOME/runs/<runId>" MANIFEST="$GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt" \
  npx tsx packages/eval/scripts/positioningScan.ts --mutate                          # Geometric grounding (--mutate is diagnostic only, see Iron Rule 6)
npx tsx packages/eval/scripts/qualityCheck.ts --run <runId>                          # Coverage hard gate
```

npm aliases for the two eval entry points above (same flags): `npm run -w @gladlog/eval corpus:build`
and `npm run -w @gladlog/eval quality`; the full list is in `packages/eval/package.json` and in
`/eval-baseline` Step 1.

Green = CJK 0, death-trace 0, geometry 0 violations, qualityCheck 0 hard failures. Check any red against Iron Rule 2 before reporting as a bug.

## Layer B Steps

1. `/calibrate-judge` (seed 7 defect types, TOL=1; halo defense = dimension independence rules in eval-baseline.md Step 3). Proceed only on 5/7+.
2. Response generation + scoring: Follow eval-baseline.md Step 2/3, **generate match-by-match** (Iron Rule 4), resumable (skips if output file exists).

There is no cross-family judge: the agy cross-evaluation step was removed (user ruling 2026-11-22) and no replacement has been chosen. Seeded-defect calibration is the only check on the judge, and the report says so.

## Iron Rules (Each corresponds to a real-world failure)

1. **Gate predicates are the specification.** When analytics and validation gates compute the "same fact", analytics must **consume gate predicates verbatim** (shared constants/functions) and **anchor to rendered values** (fmtTime floored seconds, not internal fractional seconds). In one audit, 5 bugs belonged to the same category: HP radius, bounded/unbounded sampling, interpolated/raw/non-simultaneous LoS, fractional seconds vs. rendered seconds. See rule entries in root CLAUDE.md.
2. **Suspect the checker before suspecting the pipeline.** When a new checker reports large-scale violations: first manually verify 3 examples to confirm the checker's mapping assumptions (the two major false alarms in this audit were both checker errors: spike lines placed at window START instead of END → 4,075 false violations; outdated `Deaths:` line format → 1,538 false misses), then run mutation testing (seeding known defects to prove detection capability) before trusting a zero count.
3. **All metrics must include a commit.** Stale artifacts wasted hours twice: "3 false deaths" in old baseline manifest were already fixed; "final" batch runs lagged behind the branch head twice. Write the measurement SHA next to every gate metric in reports/ledger.
4. **Perform content-level integrity checks on batch LLM artifacts.** 16/1,245 responses had correct MATCHID headers but mismatched body content—header validation cannot catch this, facts vs. prompt must be sampled and verified; invalidate old scores via mtime after regenerating responses.
5. **Drivers must be idempotent and resumable.** Use output file existence as the skip key; re-running the same command resumes execution after interruptions (weekly quotas/rate limits).
6. **positioningScan corpus-level mutation rate is diagnostic only** (~60% is normal under real movement noise); 100% sensitivity hard gate lives in synthetic fixture unit tests (`packages/eval/test/positioningScan.test.ts`).

## Sign-off

- Report (run directory `PIPELINE-AUDIT-REPORT.md`): TL;DR, Layer A findings, calibration, scoring, fix checklist (with SHAs), **sign-off gate table (pre-fix → post-fix @ SHA)**, open items.
- `ledger.md` append line (append-only); auto-memory update; fixes submitted via PR.
- After fixing, must **rebuild full corpus at branch head** and re-run all three gates before claiming sign-off (Iron Rule 3).
