# Teammate crisis — design (GH #95)

Status: measured, awaiting user ruling. 2026-09-16.

## Rulings so far

- 2026-09-13, user: "我觉得不管重复不重复 队友被打也要算进去" — teammate crises count even where other signals overlap.
- 2026-09-13, user, the three shapes: timing (should have pre-empted — "如果提前开了也许能规避" / "出现这个情况以后,你会开什么技能补救"), double-ups ("给重了"), under-reaction ("给轻了").
- 2026-09-16, user, "给重了" strictly: two MAJOR defensives from two different people on one target when one would have been enough ("牧师给了痛苦压制,奶僧给了复苏之茧,那两个有一个其实就够了"). Small cooldowns never count.

## Measurements (1/10 of the full new-season archive: 6,331 files, 11,536 rounds)

Probes: `packages/eval/scripts/teammateCrisisAnswerProbe.ts`, `teammateCrisisCards.ts`, `doubleDefensiveProbe.ts`. Reports: eval-private `reports/teammate-crisis-2026-09-16*.json`.

### Population

Teammate crossings found by the shipped predicate (`crisisDecisionPoints(teammate)`): 49,789 dangerous and feasible for the teammate. Healer-side feasibility (`actionBlockedAt`, shared with the crisis predicate, + 40 yd reach) removes 16,869 (34 %): healer in CC 12,550, kicked / silenced 2,004, dead 341, out of reach 2,165. **Accusable: 32,920.**

### Definitions that moved the numbers (recorded because each one changed the answer)

| Definition of "the healer answered"                                               | "nobody answered" | note                                                                                                                   |
| --------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| external / protective on the teammate, heal ≥ 15 % max HP, control on an attacker | 4,481             | the self-heal floor is about the owner healing themselves; a healer topping a teammate with two small heals is working |
| + ANY heal event on the teammate                                                  | 137               | wrong: counts ticks of a HoT placed before the crisis (the GH #93 defect)                                              |
| + any heal from a spell CAST inside the window (GH #93 rule)                      | **2,723**         | the recorded rule                                                                                                      |

### Shapes (recorded rule)

| Shape                      | n      | per round | teammate death ≤ 10 s               |
| -------------------------- | ------ | --------- | ----------------------------------- |
| nobody answered            | 2,723  | 0.24      | 18 % (16 / 20 / 20 % by 2 s damage) |
| only the teammate answered | 3,415  | 0.30      | 14 %                                |
| only the healer answered   | 12,249 | 1.06      | 8 %                                 |
| both answered              | 14,533 | 1.26      | 5 %                                 |

16,306 windows had HoT ticks from before the crisis as the only healing on the teammate (carriedHeal — evidence, never an answer).

"Nobody answered" split by what the healer was doing:

| healer                            | n     | death |
| --------------------------------- | ----- | ----- |
| casting elsewhere, external ready | 1,150 | 11 %  |
| casting elsewhere, no external    | 1,153 | 18 %  |
| idle, external ready              | 188   | 37 %  |
| idle, no external                 | 232   | 41 %  |

Idle (420) minus a hard cast in progress (89, `castStartEvents`) minus repositioning ≥ 8 yd (87): **274 clean idle points, 0.024 per round, 47 % teammate death** (8 % when the healer answers). Five hand-read cards: healer not CC'd, in range, 4.5 s with no cast while two enemies took the teammate under 40 %; the healer had an external off cooldown in 4 of 5.

### "给重了" (strict, `doubleDefensiveProbe.ts`)

Major = externalDefensiveSpellIds ∪ bigDefensiveSpellIds; two different casters; overlap ≥ 0.5 s. 7,492 pairs (0.65 / round). The second aura's contribution over the overlap: percentage auras D × b / (1 − b) with b from `resolveMitigation` (talent-aware) and multiplicative stacking (measured 2026-09-13); absorbs from the victim-keyed absorb log. Priced 5,197; unpriced 2,295 (immunity 1,074, Blessing of Sacrifice 750 — redirect, Guardian Spirit 363 — healing-received, Desperate Prayer 89).

"One would have been enough" = the target's lowest HP during the overlap, with the second aura's contribution added back as damage, still above 40 %.

|                                                                         | n                       | death |
| ----------------------------------------------------------------------- | ----------------------- | ----- |
| one sufficed, target in crisis (≤ 40 % from 3 s before the second aura) | **595 (0.052 / round)** | —     |
| one sufficed, pre-emptive (never under 40 %)                            | 1,851                   | —     |
| both needed, in crisis                                                  | 2,422                   | —     |
| both needed, pre-emptive                                                | 329                     | —     |
| one sufficed (all)                                                      | 2,446                   | 0.8 % |
| both needed (all)                                                       | 2,751                   | 4.6 % |

Second-aura contribution: p25 1.1 %, p50 3.7 %, p75 9.9 %, p90 20.3 % of max HP. Top pairs: Blessing of Sacrifice + Guardian Spirit (266 both orders), Guardian Spirit + Ice Block 121, Barkskin + Blessing of Sacrifice 116, Barkskin + Pain Suppression 108.

Hand-read cards: the first is usually the target's own wall (Cloak / IBF / Obsidian Scales) and the healer's external lands 1–4 s later; little damage during the overlap and the target's low point is 55–78 %. Whether the enemy swapped targets BECAUSE two walls were up is not observable.

Outcome caveat (Value-Gate rule 4): stacking two defensives has the LOWEST death rate of every shape; a "wasted" claim rests on the second cooldown's marginal value and cost, never on the outcome.

## Proposed product shapes (for the user)

1. **`teammate-crisis-idle` — accuse.** Owner = healer; a teammate crossing (shipped predicate, dangerous, feasible for the teammate); healer not blocked (`actionBlockedAt`), within 40 yd, no cast success, no cast start, no ≥ 8 yd move in [t − 1.5 s, t + 3 s]; no answer toward the teammate (GH #93 fresh-heal rule). Facts rendered: teammate HP and 2 s damage, attackers, externals off cooldown, carried HoT healing ("your earlier HoTs restored N %"). Phrasing per the user: "如果提前开了也许能规避;出现这个情况以后,你会开什么技能补救?" Reference table: teammate death ≤ 10 s, idle vs answered, per bracket. Expected ~0.024 / round.
2. **"casting elsewhere" — fact, not accusation.** 2,303 of the 2,723 nobody-answered points had the healer casting on someone else; that is triage. Render "[TEAMMATE CRISIS] X at 35 %, you were casting on Y" as context; no candidate.
3. **`double-defensive` — fact, or a low-cap candidate — user's call.** Two majors from two casters, target in crisis, second's contribution added back keeps the target above 40 %, second is a major cooldown (never Fade / PW:S). Render "队友已交 A,你又给了 B,B 多挡了约 N %". Unpriced pairs (immunity / Sacrifice / Guardian Spirit) render without a number. Expected ~0.05 / round.
4. **Timing** folds into shape 1's phrasing; no separate predicate (a pre-emptive rule needs a burst-start fact the log only gives after the fact).

Overlap with existing signals: 1,682 of the 2,723 nobody-answered points coincide with a cd-hoarded / healing-gap / slow-defensive-response / external-unused candidate within 3 s; the user ruled overlap is not a reason to skip. Dedup at the menu (one crisis, one card) is an implementation question.

## Costs

New shared predicate (`teammateCrisisDecisionPoints` on top of `crisisDecisionPoints` + `actionBlockedAt` + `kiteAttribution`), one new reference table over the full archive (~4 h), gate class in `promptQualityCheck`, `PROMPT_VERSION`, predicate-index rows (en + zh-CN), curatedIdRegistry if any new id list.
