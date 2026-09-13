# Temporal-evidence experiment — healer crisis (step 1 of the coaching-layer umbrella)

Status: **bounded experiment, not a design.** Per the codex ruling (2026-09-12, R4) the design
document is written only after step 3 passes; this file holds the four things allowed before
that: the question, the definitions, the frozen selection procedure and the acceptance criteria.
User ruling 2026-09-12: run the experiment; #93 (the HoT-as-response / retreat-as-kite defects) is
deferred and is NOT fixed inside this experiment.

## Question

At this healer crisis, **was there a new action, ongoing protection, or insufficient evidence?**

The current product line (`crisis-no-response`) answers a different question — "did anything
that counts as a response happen within 3 s" — and its "response" union includes healing that
was already ticking and distance gains the attackers may have produced. The experiment asks
whether separating _new action_ from _ongoing protection_ from _unknown_, with every premise
marked, changes what a reader concludes.

## Definitions (pre-registered)

- **Crisis crossing**: the existing `crisisDecisionPoints` crossing (`gridHpPct` ≤ 40 % on the
  render grid with `dmg2s` ≥ 10 % of max HP in the prior 2 s), owner = the logging player when
  they are a healer. Same predicate, same numbers; nothing re-derived.
- **Pre-action evidence** (everything observed at or before `tSec`, each item marked
  **known** / **estimated** / **unknown**):
  - HP and dmg2s at the crossing — _known_ (the `[STATE]` tick's own reading).
  - Attackers in the prior 2 s, and whether an enemy offensive cooldown was active in the prior
    8 s — _known_ (`attackers2s`, `enemyBurst`).
  - Auras active on the owner at `tSec`, split into self-cast HoTs that started **before** the
    crossing, other own buffs, externals from teammates — _known_ (aura intervals with observed
    starts); an aura whose start is inferred is _estimated_.
  - Personal wall / own external / control major readiness — _estimated_ (via `cdAvailableAt`,
    which carries the ±0.5 s rendered-second slack by contract; a never-observed cooldown is
    _unknown_, never "ready").
  - CC / lockout on the owner at `tSec` — _known_.
  - Nearest attacker distance and LoS — _estimated_ when both position samples are within
    tolerance and the arena has geometry, otherwise _unknown_.
  - Teammates' intended cover, target choice, communication — always _unknown_ (not logged).
- **Feasible options**: the tools whose readiness is _estimated_ or _known_ at `tSec`; listed,
  never asserted as "should have".
- **Follow-up** (revealed only after selection): new successful owner casts in `(t, t+3 s]`
  (_known_); healing received from own sources in the window, split into ticks of HoTs that
  started before `t` vs healing from new casts (_known_); the existing `responses` flags and
  `responded` verdict as the product computes them today (for the before/after ledger); the
  10 s death outcome, last.
- **Permitted comparison sentence**: the existing `behaviorPriorGenerated.json` cell for this
  bracket × role × damage band, rendered as _"Among recorded {bracket} healer crises in this
  damage band, {deathNoResp}% of players who recorded no qualifying response died within 10 s
  (n={nNoResp}) vs {deathResp}% of those who did (n={nResp}). Those groups include passive healing
  and distance gains and are not matched on your HoT, kit or line of sight."_ No other numbers.

## Frozen selection (20 moments)

1. Manifest: the local library, `pickRows(minDurationS: 60)`, first 400 rounds (the same slice
   every other 2026-09 probe used), owner = logging player, healer specs only.
2. Per round, the **earliest** crisis crossing that is `dangerous` and not `inCC` / `lockedOut`
   at `tSec` — all three are pre-action facts. `feasible` is NOT used (it reads the 3 s
   follow-up), nor `responded`, nor any outcome, nor data completeness.
3. Round ids sorted by SHA-1 of the id; the first 20 distinct rounds are the frozen set. The
   ordering is recorded in the ledger so the selection is reproducible and could not have been
   steered by outcomes.

## Acceptance criteria

- **Step 1** (this file's deliverable): one complete real-match output for the value decision.
  Kill: the user rejects it as unhelpful, or its essential premise cannot be established.
- **Step 2** (only after step 1 passes): 0 unexplained changes to legacy facts; 0 pre-action
  features that change when events after `tSec` are removed; unit tests for the three
  counterexamples (HoT-as-response, retreating attacker, render slack).
- **Step 3**: over the 20, ≥ 8 gain an independently verifiable material premise absent from the
  current candidate facts; ≥ 4 gain a materially better interpretation or a justified abstention;
  0 unsupported positive feasibility claims. Below that: stop, report, do not generalise.

## Tooling

`packages/eval/scripts/crisisEvidenceProbe.ts` — selects and renders; no model calls; reuses
`crisisDecisionPoints`, `buildAuraIntervals`, `extractMajorCooldowns` + `cdAvailableAt`,
`getUnitPositionAtTime` + `hasLineOfSight`, `lookupBehaviorPrior`. The 20-moment ledger is
written to `$GLADLOG_EVAL_HOME/reports/temporal-evidence-2026-09-13/`.
