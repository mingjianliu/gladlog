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

## Amendment 1 (2026-09-13, recorded BEFORE step 2 executed)

**Disclosure.** This amendment was made after step 1 rendered all 20 frozen moments with their
outcomes and the user reviewed one witness (round e9ea8a0c). From here the experiment is a
disclosed development experiment, not an untouched confirmatory test: passing step 3 supports
further development, not general effectiveness. The 20 anchors do not change.

**Question, amended (user ruling 2026-09-13: "putting them together is right, separating doesn't
mean much — look at it as a whole").** At this healer crisis, **was the situation answered —
by everything active on the player plus anything done in the window — or not, or is the evidence
insufficient?** Existing protection and new actions are the same kind of thing. The output never
splits them into categories; timestamps and provenance are kept on every item because they
establish what was present, whom it affected and whether hindsight supplied it.

**Evidence rules (codex ruling S2/S3, 2026-09-13).**

- One evidence list per crisis, two cutoffs: facts _at t_ read only observations `≤ t`; facts
  _in the window_ read only observations `≤ t + 3 s`. The outcome is never evidence.
- Admitted: mitigation auras (`MITIGATION_TABLE`, priced with `mitigationPctFor` on the
  recipient), immunities and absorbs and healing-received modifiers (`abilityProfile`; absorb
  capacity stays unknown), HoTs (an aura active at t whose periodic heal on the owner was already
  observed before t — never classified by a tick after t), CC on the owner (`ccSpellIds`), healing
  received in the window from **any** caster (effective amount, spell, source, event kind),
  absorbed damage in the window, auras applied to the owner in the window, owner casts in the
  window with their official function, CC landed on an identified attacker in the window, and
  owner displacement vs attacker displacement from fresh position samples (enemy retreat is not
  the owner moving; no "kite" label).
- Unclassified auras are one uncertainty note with ids kept in the ledger; unclassified is not
  irrelevant. The "never observed — readiness unknown" cooldown catalogue is removed.
- No threshold, weight or score for "answered". The reader judges answered / unanswered /
  insufficient evidence **before** revealing the outcome; "answered" never means "survived".
- The 42 % / 11 % comparison sentence is dropped: its arms were built with the non-holistic
  definition and are not comparable. Rendered instead: "No corpus comparison is available for
  this combined assessment." The step-1 ledger is kept intact; the product's current verdict is
  stored as baseline metadata for scoring only.

**Step 2 acceptance (unchanged in substance).** Exact equality of every at-t field when all
events after t are removed or adversarially changed, and of every window field when events after
t + 3 s are; every supporting timestamp within its cutoff; unit fixtures for a pre-cast wall
counted as protection, retreating attackers not counted as owner movement, a future aura removal
not changing the at-t view, samples after t not establishing the at-t HP or position, and a
non-periodic heal without a linked cast not rendered as a new healing cast. On the 20 real
anchors: 0 invariance violations.

**Step 3 acceptance (numbers unchanged, definitions sharpened).** ≥ 8/20 gain a verified,
material fact absent from the current candidate evidence — not merely an additional aura name;
≥ 4/20 gain a substantively better holistic interpretation or a justified abstention (the
answered/unanswered call may stay the same, but the added evidence must correct an unsupported
inference or materially qualify it; style does not count); 0 unsupported positive feasibility
claims. Agreement with today's verdict is neither success nor failure. If the combined evidence
changes nothing material, stop generalising.

**Out of scope for step 2.** Shipping predicate, reference tables, `PROMPT_VERSION`, #93; any
threshold or score; a universal state service or candidate migration; new spell-id lists, effect
mining or shield-capacity reconstruction; cooldown-feasibility catalogues or "should have"
wording; corpus reselection, scans, models, rating, action-outcome comparisons.

## Tooling

`packages/eval/scripts/crisisEvidenceProbe.ts` — selects and renders; no model calls; reuses
`crisisDecisionPoints`, `buildAuraIntervals`, `extractMajorCooldowns` + `cdAvailableAt`,
`getUnitPositionAtTime` + `hasLineOfSight`, `lookupBehaviorPrior`. The 20-moment ledger is
written to `$GLADLOG_EVAL_HOME/reports/temporal-evidence-2026-09-13/`.
