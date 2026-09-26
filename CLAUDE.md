# gladlog

Rules first, history second: every rule below was paid for by a specific incident. The incidents are recorded in [`docs/rule-history.md`](docs/rule-history.md) — read that when a rule seems too strict, not before following it. The docs map is [`docs/README.md`](docs/README.md).

## Shared-Predicate Rule

Analysis code (`packages/analysis`) and verification gates (`packages/eval`'s positioningScan / qualityCheck / layerA audit) must share **the same predicate** for **the same fact** (HP, distance, LoS, timestamp): same constant, same sampling function, same tolerance, and **anchored to the rendered value** — the prompt renders `fmtTime` (floor to whole seconds) and the gate re-parses the rendered text, so fractional seconds / raw timestamps inside analysis must be floored to the rendering grid before any gate-recalculated check.

- The fix is always to make analysis consume the gate's predicate, never to relax the gate.
- "Shared predicate" doesn't always mean "shared constant": `cooldowns.ts`'s `HP_SAMPLE_RADIUS_MS` has no gate-side constant at all — the gate verifies by re-parsing the rendered prompt; `positionSampling.ts`'s `LOS_SWEEP_SLACK_S` / `LOS_SWEEP_GAP_MS` are aliased directly by `positioningScan.ts` (structural coupling, harder than "must be equal").
- When adding any new "analysis asserts X, gate verifies X" pair: export the predicate from one place, import on both sides; if that's impossible, write a unit test asserting equality — never rely on comments.
- **Check [`docs/predicate-index.md`](docs/predicate-index.md) before writing new code.** It indexes analysis↔gate pairs *and* two-consumer facts inside the desktop renderer ("Report UI" section), and `packages/eval/test/predicateIndex.test.ts` pins every symbol (renaming/moving one turns CI red). Register newly found duplicates in its "Not yet unified" section; that section also lists entries that are *deliberately* not shared — read it before concluding a duplicate is new.

## Verification Rule

When claiming a bug is "fixed", include **before/after numbers under the same criterion** (e.g. "type-A same-second HP contradiction 26/50 matches → 0/50"). If you can't provide numbers, say so explicitly — **reading the code + writing a convincing commit message does not count as verification.** Never extrapolate from a single sample to a whole class.

Prefer turning criteria into **deterministic text checks baked into the gates** — the `hardFailures` classes in `packages/eval/src/quality/promptQualityCheck.ts` (one `check*` function per class; the file is the list). Don't leave one-off scripts: they vanish with the session and nothing blocks the next regression.

## Curated-List Completeness Rule

Whenever official data is reached **through a hand-maintained list** — a candidate / allowlist / tracking set that decides *which ids the official lookup even runs on*, or which gates the *verdict* — that list is part of the predicate, and its **completeness** must be verified separately from its correctness. Verifying only "is every entry right" proves no false positives; it can never prove no false negatives. A stale id looks exactly like "the game doesn't have that".

- **Forward check**: take the observable ground truth (corpus events — `SPELL_DISPEL`'s `extraSpellId`, observed casts, …) and ask which ids the official path fails to explain. `packages/analysis/src/data/observedSpellIdsGenerated.json` exists for this.
- **Reverse check**: intersect the list's own keys with `observedSpellIdsGenerated.json`; every entry with **zero** corpus occurrences is a renumbered or deleted spell. Spell ids are not stable across expansions.
- **Every hand-maintained id table must register itself in `packages/analysis/src/data/curatedIdRegistry.ts`**, or the scans (`curatedRotScan` reverse, `drGapScan` / `dispelCompletenessScan` forward) cannot see it. Registering is part of adding the table. Runbook and season cadence: [`docs/commands/update-wow-data.md`](docs/commands/update-wow-data.md) §7b.
- A test that pins a dead id is worse than no test — it manufactures confidence.
- Corollary: **when you change what a predicate keys on, re-verify every property its comments claim** (e.g. "self-gating" that was true keyed on the buff's casts and false keyed on the trigger ability).

## Game-Behaviour Rule (hand tables that assert what the game does)

Claims about what the game does — a duration, a modifier, a proc — rot on a patch cycle and are wrong in ways that look exactly like correct data. They need a stricter evidence bar and a re-runnable check.

1. **Three-way evidence, and the mask is the load-bearing third**: (a) the DB2 row, (b) its `SpellClassOptions` mask *or* SpellLabel actually covering the target spell, (c) a corpus split, with (d) the arithmetic reconciling. Ask for **both encodings** (class mask, aura 107/108; label, aura 218/219) — read legs (a)+(b) from `talentEffectInventoryGenerated.json` via `durationCandidatesFromInventory.ts` + `durationTalentScan --candidates`, never from the mask-only `modsRaw`.
2. **Ask DB2 first, use the corpus to choose — not to nominate.**
3. **Never require the control group to lack the talent** (that discards every universally-taken talent).
4. **Read ranks from COMBATANT_INFO; never infer them from the arithmetic** (per-rank vs total-at-max-rank is not uniform across talents).
5. **Run the arithmetic against the DB2 base, not the hand override.**
6. **Before calling a mismatch unexplained, count the casts** (a proc-applied aura carries the trigger's duration; a never-cast aura is applied by a different ability).
7. **Direction is a safety argument**: an aura cannot outlive its duration, so patch *upward* on corpus evidence, never downward without a mechanism. Control keeps its official number regardless (user ruling; see `ccFullDurationSeconds`).
8. **It has to be re-runnable**: `packages/eval/scripts/buffDurationScan.ts` (ROT / GAP), in the season runbook §7b. Known-open deviations stay FLAGged and documented in the entry's note, never suppressed.

## Value-Gate Rule (new coaching signals)

The rules above guard whether a number is *correct*; this one asks whether the thing is *worth existing*, and the higher the engineering quality the more expensive that gap gets.

1. **Value gate before engineering gate**: the first step after a new signal runs is a **complete real-match output example**, shown and approved. No calibration, no A/B, no batched model calls before that.
2. **Attribution-shaped work is written backwards**: hand-write the target conclusion sentence for a real match first, get it approved, then build the smallest engine that produces it.
3. **Feasibility gate — could the player actually have done it at that moment?** Was the resource ready, was the thing reactable, was the target reachable? The dispel family (`missedPurgeEvents`) does all three; copy it.
4. **Discrimination must be opportunity-normalised** before it means anything. Ask what the denominator is before reading the sign.
5. **Win/loss is a circular axis; rating bracket is external truth — and the corpus must be stratified before it is compared.** `aggregateGradient` refuses a pooled call (unit-tested).
6. **Two judge dimensions cannot adjudicate an A/B.** Current judge noise floors are in `docs/rule-history.md`. Fixes to prompt-internal consistency are adopted **on deterministic evidence**, stated as such — never dressed up as a blind-A/B win.

Evidence base: [`docs/coaching-grounding-audit.md`](docs/coaching-grounding-audit.md) and `docs/BACKLOG.md` #34. Retiring a signal is a user call, not an aggregate-number call. New / resurrected / retired signals go through `.claude/skills/signal-value-probe`.

## Bilingual Docs Rule

The following 13 documents have **English as the canonical version with a `.zh-CN` suffix for Chinese**; both versions must be equivalent — update one side, update the other, or don't update at all:

`README.md` · `CHANGELOG.md` · `docs/user-guide.md` · `docs/FAQ.md` ·
`docs/setup-windows-claude-cli.md` · `docs/developer-guide.md` ·
`docs/BUILD-WINDOWS.md` · `docs/verifiability-roadmap.md` ·
`docs/DATA-COMPLIANCE.md` · `docs/pvp-log-archive.md` ·
`docs/architecture.md` · `docs/predicate-index.md` ·
`docs/log-observability-audit.md`

**Package-level READMEs follow the same rule**: wherever `packages/<pkg>/README.zh-CN.md` exists, `README.md` is the canonical version and both must be equivalent.

Each document has a language bar on the line immediately below the H1 heading (current language bolded without a link, the other language as a link); cross-links stay **within the same language**. New user-facing docs follow this pattern as well. Everything else (source comments, CI comments, skills, plans, backlog, rule history) is free-form, mostly Chinese — deliberate, see the language-policy section of `docs/developer-guide.md`. `scripts/check-markdown-links.mjs` checks links and language bars.

## Common Commands

- Type check: `npm run typecheck` (never `tsc -b` — it emits .js files into src).
- Before pushing: `npm run presubmit` (= `eslint .` + `verify:doc-commands` + typecheck + **all-workspace** tests + `verify:vision` + `electron-vite build`). It is a superset of the CI `test` workflow's `static` and `unit` jobs (`frontend-qa` is separate and never run locally). Do **not** hand-type the old three-piece (`npm test --workspace=packages/desktop && npm run typecheck && npx eslint .`): it skips `verify:vision` and the production build, and the build step is the only local thing that catches a renderer value-importing `src/main/*`. Two scope traps: lint must be `eslint .` from the **repo root** (a `cd` into a package silently narrows it), and tests must be all-workspace.
- Locally, `npm test` in `analysis` / `eval` shares the module cache for files listed in their `vitest.shared.json` (fail-closed: new test files run isolated until listed; CI is always fully isolated; `GLADLOG_TEST_ISOLATE=all` forces full isolation) — see `docs/developer-guide.md`.
- Engineering conventions: `.claude/skills/desktop-dev` (desktop) and `.claude/skills/analysis-dev` (analysis). Autonomous issue work: `.claude/skills/gh-issue-loop`. Sub-agents / worktrees: `.claude/skills/parallel-sessions`.
- Eval workflow: `/eval-baseline` (find issues) → `/eval-ab` (verify fixes) → `/calibrate-judge` (calibrate scoring) → `/pipeline-audit` (full-corpus audit). Artifacts go in `$GLADLOG_EVAL_HOME` (default `~/code/gladlog-eval-private`).
