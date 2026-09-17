# Teammate crisis — design (GH #95)

Status: measured through two codex rounds, awaiting user ruling. 2026-09-17.

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

**After codex R1 (2026-09-16, absorbs attributed by spell id, B also priced over its FULL duration):** priced 4,024; B's contribution over the overlap p50 5.1 % max HP, over B's full run p50 9 % (p75 16.9 %, p90 26.8 %) — 702 of 3,756 priced pairs have B blocking ≥ 20 % of max HP after A expired. So the overlap-only number understates B by about half: codex finding 5 confirmed. "One sufficed" is therefore not a defensible counterfactual.

**User ruling 2026-09-16:** "我觉得我们是不是有点还是'技能给得太重了'?…一个人给了大技能的话,另外一个人其实给个小技能,或者稍微规避一下位置,也许就能错开…第二个技能还能挡致命伤。或者说,我们甚至有可能算错了" — **给重了 is a FACT card only, never an accusation.** Render: A by whom, B by whom, overlap seconds, B's blocked damage over the overlap AND over its full run where priceable (immunity / Sacrifice / Guardian Spirit: no number), and the alternatives the second caster had at that moment (a minor defensive off cooldown, or repositioning). The player judges; the product does not.

## After codex R1 (2026-09-16): the recorded rule

codex astra R1 was OPPOSE (7 findings, verified against the code; conversation codex:01a0ad30-2695-7852-8944-22bbb570699a). Adopted: (1) healer feasibility over the whole window (blocked at t, t+1, t+2, t+3 s → out; a cast started before the window with no success = channelling → out; LoS from `hasLineOfSight`, false → out; a missing position sample is unknown, never "did not move"); (2) a HoT the healer placed earlier COUNTS as answered (the user's 2026-09-15 ruling, which the first probe contradicted), and a fresh heal must come from a spell cast ON THIS TEAMMATE inside the window; (3) clean-idle vs healer-answered deaths stratified by bracket × 2 s damage; (4) no teammate-side feasibility gate (a stunned teammate is a reason to act; excluding 3 s deaths selects on survival); (5) double-defensive priced over B's full run; (6) absorbs attributed by spell id. Not adopted as an accusation: (7) timing — see below.

Same 1/10 slice, 11,536 rounds: 60,413 dangerous teammate crossings (teammate died within 3 s 3,681, teammate in CC 5,932 — both kept). Healer removed: blocked at t 18,959, blocked later in the window 7,954, channelling 101, out of reach 2,228, LoS blocked 1,246. **Accusable 29,925.**

Healer answered (fresh heal on the teammate / external / protective / peel / earlier HoT ticking): 29,753. Earlier-HoT-only answers: 23,192 — the single biggest category; without the user's ruling these would have been accusations.

**Nobody answered: 172** (0.015 / round). Of those, healer casting on someone else 54; idle 118; idle minus a cast start in the window 0 minus a ≥ 8 yd move 4 → **79 clean idle points, 0.0068 / round (one in ~150 rounds), teammate death 78 %**; healer-answered death 10–16 % in every bracket × severity stratum. 71 of the 79 are 3v3 (20 / 22 / 29 across 10–20 / 20–30 / ≥ 30 % damage, death 90 / 77 / 72 %); Solo Shuffle 4, 2v2 4. 93 of the 172 coincide with no existing candidate (cd-hoarded is the usual overlap).

Reading: once the healer's own earlier HoTs count and the whole window is checked, "the healer did nothing while a teammate dropped" is rare and almost always fatal. The contrast survives stratification, but it is a descriptive association (codex 3): access and competing danger are only partly observed.

## After codex R2 (2026-09-17): the recorded rule

codex R2 was OPPOSE with three conditions, all verified in code and adopted: (1) unknown LoS no longer passes (it had been counted and admitted); healer mana at t from the advanced-actor power samples, < 10 % = no usable action; a long inactive stretch (no cast for ≥ 15 s on either side of the window) is a healer who is not playing — disconnected / AFK — reported separately, never an accusation; absorbs attributed by spell AND caster; (2) the answered comparator now enters the stratum only after the same feasibility / reach / LoS exclusions as clean idle (it had been counted before them); (3) the 3v3 concentration is not an exclusion artifact — raw idle is 106 in 3v3 vs 8 in Solo Shuffle vs 4 in 2v2 before any position filter, on 19,853 / 31,277 / 9,283 opportunities — and the position-missing cases are round-end cases (33 of 35 within 3 s of the round's end), which the "unknown ≠ did not move" rule already excludes.

Same slice, final: nobody answered 172 → idle 118 → minus round-end position gaps 35, moved 4, out of mana 6, inactive stretch 17 (14 of those teammates died — the disconnected-healer class) → **60 clean idle points, 0.0052 / round (one in ~190 rounds), teammate death 77 %**, against 7–13 % for healers who answered under the SAME filters, in every stratum with a sample: 3v3 10–20 % 18 idle (89 %) vs 1,605 answered (9 %); 20–30 % 16 (75 %) vs 2,604 (12 %); ≥ 30 % 24 (75 %) vs 4,760 (13 %). 58 of the 60 are 3v3.

Hand-read cards under this rule (6): every teammate died within 10 s; the healer had an external off cooldown in 4 of 6, was 7–34 yd away, had no HoT on the teammate, cast nothing for 4.5 s. What the log cannot show: whether the healer was under pressure elsewhere on screen, drinking, or simply not reacting. This is a descriptive association (codex 3), rare, and almost always fatal.

## codex R3 ruling (2026-09-17, ruling only, no code read)

OPPOSE an accusation; **approves an observation card** with two conditions: (1) render the documented facts and ask "出现这个情况以后,你会开什么技能补救?" with no blame, no mistake score, no claim that a rescue was available — the question must stay open to "no usable response"; (2) drop "如果提前开了也许能规避" (no timing predicate supports it); any mortality reference stays explicitly observational. Conceded: unknown-LoS and comparator fixes; the 3v3 concentration is real. Remaining objection: attribution — 77 % mortality makes the moment worth reviewing, it does not establish an avoidable mistake. No further measurement needed for the observation-only version.

## Proposed product shapes (for the user)

1. **`teammate-crisis-idle` — accuse (rare, ~1 in 190 rounds) or render as an observation — codex still opposes an accusation; user's call.** Owner = healer; a teammate crossing (shipped predicate, dangerous); healer not blocked at any second of the window (`actionBlockedAt`), no channel in progress, within 40 yd with LoS, no cast success, no cast start, no ≥ 8 yd move in [t − 1.5 s, t + 3 s], positions known; no answer toward the teammate — fresh heal cast on them, external, protective, peel, OR an earlier HoT still ticking on them. Facts rendered: teammate HP and 2 s damage, attackers, externals off cooldown, carried HoT healing ("your earlier HoTs restored N %"). Phrasing per the user: "如果提前开了也许能规避;出现这个情况以后,你会开什么技能补救?" Reference table: teammate death ≤ 10 s, idle vs answered, per bracket. Expected ~0.024 / round.
2. **"casting elsewhere" — fact, not accusation.** 2,303 of the 2,723 nobody-answered points had the healer casting on someone else; that is triage. Render "[TEAMMATE CRISIS] X at 35 %, you were casting on Y" as context; no candidate.
3. **`double-defensive` — fact only (user ruling 2026-09-16, above).** Two majors from two casters, target in crisis, second's contribution added back keeps the target above 40 %, second is a major cooldown (never Fade / PW:S). Render "队友已交 A,你又给了 B,B 多挡了约 N %". Unpriced pairs (immunity / Sacrifice / Guardian Spirit) render without a number. Expected ~0.05 / round.
4. **Timing** — no predicate. codex R1 (7): a post-crossing inactivity test cannot establish an earlier warning cue, so "如果提前开了也许能规避" is not supported by evidence; the question form "出现这个情况以后,你会开什么技能补救?" is. **Whether the pre-emptive sentence stays is the user's call.**

Overlap with existing signals: 1,682 of the 2,723 nobody-answered points coincide with a cd-hoarded / healing-gap / slow-defensive-response / external-unused candidate within 3 s; the user ruled overlap is not a reason to skip. Dedup at the menu (one crisis, one card) is an implementation question.

## Costs

New shared predicate (`teammateCrisisDecisionPoints` on top of `crisisDecisionPoints` + `actionBlockedAt` + `kiteAttribution`), one new reference table over the full archive (~4 h), gate class in `promptQualityCheck`, `PROMPT_VERSION`, predicate-index rows (en + zh-CN), curatedIdRegistry if any new id list.

## User rulings 2026-09-17 and what shipped

The user answered the four questions above, then overruled codex R3 on the shape:

1. **Shape 1 is an ACCUSATION, not an observation card** — 「另外我发现我们基本上不做指控,我觉得这个东西可以做一下指控,我觉得价值其实挺高的」. Shipped as the healer candidate **`teammate-crisis-idle`** (`analysis/teammateCrisis.ts` predicate + `candidates/teammateCrisisIdle.ts` producer), same discipline as `crisis-no-response`: outcome reference, producer never reads `diedWithin10s`, cite-not-prescribe legend. The feasibility door is what makes the accusation defensible (every codex R1/R2 exclusion is inside the predicate; the answered comparator is filtered identically).
2. **Timing sentence — a strict version is allowed**: 「我觉得我们可以严格一点,开大技能现在玩家有插件监视的,只要说的靠谱就行」. Shipped as `facts.burstCue=yes` when the enemy's offensive-cooldown press came ≥ `TEAMMATE_CRISIS_CUE_MIN_S` (2 s) before the crossing — the legend tells the model to state it as a cooldown-tracker cue, never as "you would have avoided it" (codex R3 condition 2 still holds for the counterfactual).
3. **给重了 fact card** — approved as proposed; shipped as the `[STACKED DEFENSIVES]` context line (`analysis/stackedDefensives.ts` + `context/stackedDefensives.ts`): who cast A / B, overlap on the grid, B's blocked % over the overlap and over its full run (pct auras) or the absorbs credited to B's spell AND caster; no "one would have sufficed".
4. **"casting elsewhere" — measure whether the OTHER teammate was in danger first**: 「4 要看一下另外一个队友是否危险」. The predicate now records `busyOn` (first in-window recipient and their `gridHpPct` at the cast) and `busyOnInCrisis` (any in-window cast to a friendly at ≤ 40 %); `teammateCrisisPriorScan.ts report` splits the busy points by it. Not built as a card until the numbers are in.

Smoke run (1/200 archive, 317 files, 567 rounds, predicate as shipped): 2,932 dangerous teammate points; excluded — healer blocked 1,299, out of reach 98, LoS blocked 54, out of mana 24, channelling 10; comparator 1,447 of which answered 1,438 (died 135 = 9 %), clean idle 1 (died), busy elsewhere 4 (other in crisis 0 / not in crisis 3 / unknown 1), inactive stretch 2, position unknown 2. Full-archive scan (63,303 files, 116,063 rounds, 2026-09-17 → `teammateCrisisPriorGenerated.json`, 12 cells): 604,392 dangerous teammate points; excluded — healer blocked 268,671, out of reach 22,593, LoS blocked 11,959, out of mana 5,524, channelling 1,048; comparator 294,597 → answered 291,927 (teammate died within 10 s 10 %), **clean idle 534 (0.0046 per round), died 442 = 83 %** (3v3: 490 idle, 86 % vs 11 % answered, every severity bin ≥ 133; Solo Shuffle: 38 idle, 45 % vs 10 % — under the 50 floor, so nothing renders there; 2v2: 6). Idle reasons: busy elsewhere 1,039, position unknown 466, inactive stretch 168 (died 130), moved 81, cast started 29. Question 4 (busy elsewhere 1,039): the other recipient was in crisis 215 (this teammate died 18 %), was NOT in crisis 305 (died 35 %), no friendly recipient / HP unknown 519.
