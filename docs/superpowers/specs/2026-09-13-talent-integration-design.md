# Talent integration — design (GH #96)

Status: approved direction, M0 in progress. 2026-09-13.

## Goal

User, 2026-09-13: every place the product consumes a spell fact that a talent changes, but ignores the talent, gets filled in. Unreferenced talents are classified, and the missing capabilities are named. Impact is measured as changed coaching decisions.

The design went through two codex astra rounds. Round 1 was OPPOSE on a single unified modifier table. Round 2 was PARTIAL: the architecture was conceded, with correctness blockers that are folded in below.

## Inventory (already built, eval-side)

| Artifact                                           | What it holds                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/eval/scripts/talentCatalog.ts`           | 3,491 talents: resolved zhCN description, DB2 effects (talent + two trigger hops + tooltip references), spell modifiers, code references |
| `packages/eval/scripts/talentPickRateScan.ts`      | Pick rate per spec from COMBATANT_INFO (34,093 loadouts)                                                                                 |
| `packages/eval/scripts/mitigationStackPairScan.ts` | Two percentage reductions stack multiplicatively; Cloak physical 20 % comes from Bait and Switch                                         |
| `packages/eval/scripts/mitigationTalentScan.ts`    | Corpus split for the 12 mitigation value modifiers (not yet run)                                                                         |

Gap audit at build 12.1.0.69587:

| Consumer                  | Gaps | Taken by ≥ 50 % |
| ------------------------- | ---- | --------------- |
| Cooldown / charges        | 15   | 6               |
| Aura duration             | 35   | 14              |
| Mitigation value          | 12   | 8               |
| Passive protection        | 62   | 38              |
| Active defensive unlisted | 29   | 23              |
| Active CC unlisted        | 7    | 5               |

1,052 unreferenced talents have no structured effect (script-driven).

## Architecture

### D1 — Talent evidence inventory (generated, analysis data)

`talentEffectInventoryGenerated.json`, produced by datagen with a pinned build, the hotfix overlay and the PvP multiplier.

- **Effect rows** are stored once, keyed by `SpellEffect.ID`. Fields: effect, aura, SpellModOp, base points, PvP multiplier, schoolMask, targets with `via` (mask / chargeCategory / direct), `activation` (passive | whileAura | **unknown**), `origin` (cast | proc | unknown), `rankSemantics` (perRank | total | unknown).
- **Reachability edges** are stored separately: {sourceTalentSpellId, path (node / pvp / trigger hop n), eligibility (specIds, pvpCarrier)}. One row can be reached from several talents. The applied effect is deduplicated only after eligibility is evaluated. Truncated traversal is recorded explicitly.
- **Class family** comes from DB2, not a hand map.
- **Charge-category matching** applies only to category effects (411 / 453 / 454, effects 121 / 148).

### D2 — Typed rule compilers (one per fact)

Each compiler reads the inventory plus a hand-ruling file for its fact. Every compiled row carries three independent axes:

- **Provenance:** db2 | hand.
- **Validation:** none | corpus | contradicted.
- **Unresolved list:** rank, origin, activation, eligibility.

Compilers:

- **cooldown** → `talentModifiers.json`, existing `ICDModifier` shape + `sourceRowId`. Parity gate: row-for-row identical to the M0 generator.
- **duration** → `talentDurationCandidatesGenerated.json`. The product keeps reading the hand tables until a row is validated and promoted.
- **mitigation** → components (D3).

### D3 — Mitigation components and resolver

Components per aura spell: {kind: pct | immunity | probabilistic | delayed, schoolMask, pct, carrier: self | other | any, targetEffectIndex}.

- Cloak = immunity 0x7e + pct 0x1 (base 0).
- BoP = immunity 0x1 + pct 0x7e (base 0).
- Obsidian Scales = pct 30 self / 15 other.

A talent modifier names its target component and its operation: **flat percentage points added to that component** (20 + 20 = 40) versus a relative change. It is not an independent extra reduction (which would give 36).

Resolver: `resolveMitigation({auraSpellId, carrier, caster, school})` returns components with `pctMin` / `pctMax` and an `unresolved` list.

- **Bounds:** unknown ownership or rank must bound every supported configuration. A negative modifier can lower pctMin. Unknown activation or recipient can remove a component.
- **Stacking:** stacking **across** auras stays unmodelled in this milestone. Immunity, probabilistic protection and delayed damage are not percentages.

Consumer arithmetic stays per consumer, and every consumer reads through the resolver:

- **Counterfactual A** (active mitigation backed out): `observed × p / (1 − p)`, per school. A range reaching 100 % has no finite upper bound and is rendered as such.
- **Counterfactual B / narrow gate** (hypothetical added protection): `observed × p`. "Would have survived" uses the **lower** saved bound. Today B reads `entry.pct` raw; it is moved onto the resolver.
- **burst-into-mitigation door (30 %):** M3a keeps the door's meaning (strength of the strongest defensive), computed as component pctMin over all schools. Redefining it as "estimated burst damage prevented" is a separate, separately accepted change. It needs pre-mitigation weighting; the ledger's post-mitigation `effectiveAmount` underweights protected schools.
- **killAttempts "popped a wall ≥ X":** component pctMin.
- **Rendering and positional entries:** burstLedger / abilityProfile render min–max when they differ. Positional components (Darkness) stay skipped where they are skipped today.
- **Ledger fields:** the burst ledger must keep application start / end and caster identity to price talents and select damage inside the real overlap.

### D4 — Observed protective action vs coaching category

These are separate facts:

1. **Actor:** who acted.
2. **Recipient:** who received it.
3. **Intentional or proc:** a pressed cast versus an automatic trigger.
4. **Protection:** which mechanism, which school.
5. **Major-defensive membership:** a user ruling, kept in curatedIdRegistry.
6. **Sufficiency:** whether it was enough.

The crisis predicate judges the **owner's own** answer.

- An **intentional, relevant, unlisted owner cast** with protective capability makes the owner-response verdict `indeterminate`. It is counted and fed to the membership review list.
- **Automatic procs and teammate protection** never change owner-response classification. They belong to danger / adequacy, later.
- **No invented magnitude thresholds.**
- **Pick rate** only orders the review list.

### D5 — Temporary modifiers

Rows with `activation = whileAura` stay in the inventory. They are excluded from permanent arithmetic; M0 already does this for cooldowns. In the same milestone, a readiness claim on a spell carrying such a modifier becomes `uncertain` when the source aura overlapped its recharge. Temporary `replace_spell` rows are excluded from "button exists" logic. A state-transition simulator (activation or expiry during recharge, reset, refresh) is future work.

**M2 measurement (2026-09-13):** the inventory holds 20 temporary cooldown-modifier edges, all reductions (an acceleration can only make a "not ready" claim wrong, never a "ready" one). Their targets are Growl, Mangle, Thrash, Frenzied Regeneration, Force of Nature, Nightmare Echo, Stormstrike, Windstrike, Thunder Clap and Thunder Blast, and none is tracked by the cooldown ledger (`classMetadata` tagged abilities). No product claim can be affected today, so no uncertainty wiring or dormant switch ships. Instead a tripwire test (`test/facts.config.test.ts`) fails the moment any such target enters the ledger, forcing the wiring first.

### D6 — Decision trace and differential replay

Decision predicates are instrumented **before emission**. Each opportunity record carries: {opportunity id including owner, type, eligibility, resolved facts, verdict, suppression reason, candidate ids (0..n)}.

`packages/eval/scripts/decisionDiff.ts` replays one manifest under two immutable fact-provider configurations. Analysis, rendering, gates and reference-table lookups all consume that one configuration; there are no per-consumer branches.

- **Output classes:** corrected-fact / removed / new / indeterminate / unchanged / **evaluation-error**. An exception on one side is never "removed".
- **Normalisation:** per eligible opportunity, stratified by spec × bracket.
- **Labelling:** a flip is "talent-sensitive" until adjudicated.
- **Error handling:** no silent `continue` on exceptions, unlike acceptanceCapture.

Fixtures:

- Indeterminate in both runs stays in the denominator.
- OFF→ON and ON→OFF orders give identical results.

### D7 — Evidence policy

- **Independence:** corpus validation uses independent (match, caster) units. Holders-only comparison against base + delta is valid, and no control group is required (Game-Behaviour Rule 3).
- **Promotion:** requires the uncertainty interval to lie **inside a predeclared, fact-specific equivalence band**, plus resolved rank / origin / activation and a residual check. "Interval covers expected" is rejected: it rewards imprecision.
- **Bands:** percentage points for mitigation, seconds for duration, declared before the scan.
- **Thresholds:** decision uncertainty near a coaching threshold is handled by withholding the claim, never by the validation tolerance.
- **Unvalidated rows** stay in the inventory and only widen ranges.

## Milestones

|         | Scope                                                                                                                                                                                                                                                             | Acceptance                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **M0**  | Cooldown generator fixes: class family, aura 454, temporary sources, row-identity dedup, category-only Path B, one-effect-two-mechanisms reconciliation                                                                                                           | Before/after capture; 737 tests; PROMPT_VERSION 60; reference tables regenerated                                                      |
| **M1**  | Inventory generator (D1) + cooldown compiler parity — **done**: `lib/talentInventory.ts`, 8,225 rows / 4,037 edges / 7 truncated, 742 tests                                                                                                                       | Byte-identical `talentModifiers.json` (met: `cmp` identical on 12.1.0.69587)                                                          |
| **M2**  | Decision trace + immutable fact-provider config + decisionDiff (D6) + D5 readiness uncertainty — **M2a done**: trace/config/harness, cd-hoarded instrumented, D5 tripwire; **M2b**: instrument crisis-no-response, slow-defensive-response, burst-into-mitigation | Fixtures above; zero diff with identical configs (M2a: 635 cd-hoarded opportunities, all unchanged, 0 unmatched, 0 errors, every 600) |
| **M3a** | Mitigation components + resolver + six consumers (both counterfactual paths), **no talent effects**                                                                                                                                                               | decisionDiff: zero changed decisions vs the table                                                                                     |
| **M3b** | Talent components from the 12 modifiers, validated by mitigationTalentScan under D7                                                                                                                                                                               | decisionDiff report; per-modifier promotion record                                                                                    |
| **M4**  | Actor / recipient / intent fields; unlisted intentional owner defensive → indeterminate; membership review list                                                                                                                                                   | Fixtures (trivial absorb, teammate shield unchanged; unlisted owner wall → indeterminate); user ruling on membership                  |
| **M5**  | Duration candidates → validation (buffDurationScan) → promotion                                                                                                                                                                                                   | Per-row promotion record                                                                                                              |
| **M6**  | Scripted-talent review queue                                                                                                                                                                                                                                      | Ranked list for review                                                                                                                |

## M0 results so far

S2 archive every 30 (605 files, 1,270 rounds, 3,520 owners).

**Modifier table:** 607 → 677 rows. +84 added (Monk class set 29, DH 10, Evoker 13, aura 454 32); −14 removed (temporary sources: Berserk, Incarnation: Guardian of Ursoc, Avatar). Row-identity dedup plus mechanism reconciliation leaves the same multiset (677).

**Candidate counts:**

| Type                      | Before | After |
| ------------------------- | ------ | ----- |
| healer:cd-hoarded         | 1,152  | 1,155 |
| dps:missed-sync-window    | 796    | 798   |
| healer:missed-sync-window | 398    | 399   |
| dps:external-unused       | 85     | 86    |

Every other type is unchanged.

**`<cooldowns>` lines:** 33,088, same count; value changes only, no other line changed.

| Spell                  | Before | After | Lines |
| ---------------------- | ------ | ----- | ----- |
| Darkness               | 300 s  | 180 s | 479   |
| Paralysis              | 45 s   | 30 s  | 820   |
| Leg Sweep              | 60 s   | 50 s  | 768   |
| Oppressing Roar        | 120 s  | 90 s  | 183   |
| Tip the Scales         | 120 s  | 90 s  | 181   |
| Fortifying Brew        | 360 s  | 330 s | 154   |
| Invoke the Red Crane   | 120 s  | 60 s  | 66    |
| Invoke the White Tiger | 120 s  | 90 s  | 18    |

"2 Charges" disappearing on some lines is the charge **inference** (`maxChargesDetected`: two casts closer than the old, wrong cooldown) no longer firing.
