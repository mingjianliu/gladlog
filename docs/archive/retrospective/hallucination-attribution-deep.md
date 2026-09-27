# Hallucination Attribution (Layer 2): Crash history of anti-hallucination tools, and origins in previous work

Companion doc: `hallucination-attribution.md` (Table of seven mechanisms).
This document digs into two things: **How the anti-hallucination tool itself went wrong**, and **What this methodology looked like in the previous work**.

---

# Part 1 · causalLint: Nine rounds of fixes for a single gate

Causal hallucination is unverifiable, so the solution is to "ban this language."
**Then how reliable is this "language checking" tool itself?** The complete answer is in its commit history.

## Commit History: Two days, nine times

```
2026-07-12   1046bf9  Created
             2ff8aec  Opus cross-family review rejected (REQUEST_CHANGES)
             ab05545  agy re-verification: 3 regexes too broad
             cdebdf1  agy cross-family bug hunt: 7 more items
                      ── Rejected three times by three parties on the day it was born ──

2026-07-31   d249c3a  Zero coverage for Chinese (live for 19 days)
             aed104d  Re-check four items: negation guards
             22eb6f2  Re-check round 2: single-character negation bypass
             1b48d39  Two whitelist rots: is/isn't + hedge blind spots
             91f7d0e  Re-check caught Critical false negative
                      ── Five rounds in one day, each round found by the previous round's re-check ──
```

---

## Day One (2026-07-12): Rejected three times on the day it was born

### Rejection One · Numeric layer missed integers (`2ff8aec`)

Opus cross-family review gave REQUEST_CHANGES. First item:

> **bare INTEGER stats passed the numeric layer** — the reused compare claimChecker
> only catches decimals/%/percentiles, but **analysis fabrication is integer-heavy
> (times, damage)**. **'You died at 47s' (real death 30s) was shown as verified.**

**Read that sentence three times.**

The anti-hallucination numeric layer was reused from the compare module. In the compare scenario, numbers are decimals and percentages
("your healing ranks at 73% among peers"), so the checker catches decimals, `%`, percentiles.

**But analysis-scenario fabrications are integer-heavy** — timestamps, damage amounts.
"You died at 47 seconds" (actual 30 seconds) **passed all checks and was labeled "verified."**

**The verification mechanism itself produced false verification.** This is worse than having no verification: it gave a false guarantee.

Fix: `auditFindings` changed to forbid **any** bare numbers outside `{{placeholders}}`.

### Rejection Two · JS semantics pitfall bypassed the grounding layer

> **empty eventIds bypassed grounding (`refs.some` on `[]` is false).**

```js
[].some(r => !r)   // → false
```

Empty array's `.some()` always returns `false`. So the check "did any anchor in this finding fail to resolve"
returned "no problems" for a finding with **no anchors at all**.

**A completely ungrounded assertion sailed through the grounding layer.**

### Rejection Three · Regex too broad, killing true statements (`ab05545`)

agy re-verification confirmed the three fixes above, while also flagging 3 overly broad regexes:

| Pattern | Falsely killed sentence |
|---|---|
| `cost` | "it **cost** you nothing" — meaning "there was no cost" |
| `that's why` / `which is why` | "**which is why** you survived" — **positive encouragement treated as causal assertion** |

Fix: `cost` must be followed by a result noun (game/round/match/series);
`that's why` must be followed by a **negative** outcome — positive reinforcement is preserved.

### A tradeoff declaration left behind that day

Verbatim from `ab05545`, worth quoting in full:

> The strict no-raw-digit rule is **KEPT** (drops legit constants like 'within 5 yards'
> too, **but that's the honest choice vs letting a fabricated '47s' through** — the
> regex-imprecision the spec earmarks LLM-judge/SP-A.1 to resolve).

**Knowingly killing legitimate content ("5" in "within 5 yards"), still keeping the strict rule.**
The rationale is written clearly: better to say less than to say something wrong. And it specifies who will resolve this imprecision in the future.

---

## Day Two (2026-07-31): Zero Chinese coverage — live for 19 days

### Attribution

`d249c3a` title: **"Add Chinese causal deterministic patterns — production default zh had zero coverage until now"**

**This gate had been live since July 12; until July 31, it was completely blind to the production environment's default language.**

The discovery method was not tooling — it was **manual deep reading of 300 production simulations**:

> 300 agy production simulations manually deep-read found **8 real Chinese causal deterministic violations**
> (e.g., "这波你绝对死不了" / "是直接导致输掉比赛的原因"), **English-only regex let all of them through.**

### Before/after numbers

```
before (English-only):    0/300 files hit   ← known, because the regex can't see Chinese
after:                   107/300 files hit (137 matches)
Annotated recall:         8/8 quotes all triggered, 7/7 files all entered the hit set
```

### And they manually reviewed all 137 hits

> Manual review of all 137 hits: **2 (1.5%) confirmed as false positives** (negation sentence "没有导致", coincidental adjacency)

**137 items, read one by one.** This is the real cost of the "before/after numbers" iron rule.

### The bug fixed along the way was planted on Day One

> The gap regex's sentence-boundary proxy originally only excluded ASCII `"."` (Chinese never uses it),
> **causing the gate to silently span across sentences in deepDive's 3-5 sentence paragraphs.**

Day One's `[^.]*` was correct for English. Chinese sentences end with "。!?", never with `.`.
So **any "because" and any "death" anywhere in a paragraph would be connected and flagged as causal**.

Correct for English, completely wrong for Chinese — **and this bug is forever green in English tests.**

---

## Rounds Three Through Five: The false-positive ↔ false-negative pendulum

These four commits demonstrate a pattern: **every relaxation to reduce false kills can open a new gap.**

### `aed104d` · Negation treated as assertion

Real corpus sentence (`responses/48357f81.0.txt:14`):

> "所幸**没有导致**后续崩盘。" (Fortunately it **did not lead to** a subsequent collapse.)

This is **negating** causation, yet it was flagged as asserting causation. And the consumer **drops the entire entry on hit** —
**this false positive would delete good content in production.**

Fix: a series of lookbehinds. Before/after numbers precise to single digits:

```
107/300 files → 106/300 (-1, precisely corresponding to that one entry in 48357f81.0, no other files affected)
Annotated recall unchanged: 8/8, 7/7
```

### `22eb6f2` · Single-character negation bypass, zero-change fix

Re-check round 2 used **constructed examples** to prove: guards only listed multi-character words (没有/不会/并未/未曾/从未);
single-character negation placed directly before the connective bypasses them — "这个决策**未导致**后续崩盘" was still falsely flagged.

Before/after numbers:

```
106/300 → 106/300   (no change)
```

The commit message itself explains why zero change:

> The current corpus happens to contain no instances of the single-character negation forms "未导致"/"不导致";
> this fix closes **a bypass proven to exist by constructed examples in re-check round 2, but not sampled by the current corpus**.

**A fix that didn't move a single number was still committed, tested, and documented.** Because the vulnerability was proven to exist —
the corpus just hadn't sampled it.

The same commit also performed an **over-blocking check**, verifying three real corpus structures line by line to confirm they're unaffected:

```
"这不仅导致了团灭"          — character before 导致 is "仅" not "不", still flagged ✓
"不是因为…而是因为"          — character before 因为 is "是" not "不", both clauses unaffected ✓
"你不得不交出减伤,这才导致了" — "不" is at an earlier position; character immediately before "导致" is "才" ✓
```

**Add a guard, then proactively prove it won't cause false kills.** This is the step most people skip.

### `1b48d39` · Hedge blind spot: true statements being swallowed

The second whitelist rot is the most product-relevant item in this round:

> **可能/或许/大概/也许/似乎/恐怕** (zh) and **possibly/perhaps/likely/may have/
> might have/could have** (en) previously **triggered identically to definitive assertions** —
> but **hedging is precisely the expression that product honesty ethics permits**, and the consumer drops the entire entry on hit,
> **so a false positive means true statements being swallowed.**

**The gate was punishing the model's honesty.** The model says "this **might** be why you died" —
exactly what we want it to say — yet it received the same penalty as "this **is** why."

Before/after numbers (this time on 561 corpus files):

```
ds-sim:    43 files / 51  →  40 / 47
agy-sim:  106 files /136  → 102 /132
win16-sim:  1 file  /  1  →   1 /  1
Total:    150 files /188  → 143 /180

All 8 cleared entries manually verified one by one: all contain explicit hedge words, leakage = 0
```

**"leakage = 0" — after relaxation, not a single genuine unhedged assertion slipped through. Verified one by one.**

### `91f7d0e` · The previous round's fix opened a Critical vulnerability

Cross-AI re-check confirmed the previous version's hedge exemption had a **Critical false negative**:

> The exemption was only bounded by sentence boundaries, causing **same-sentence but different-clause** hedges to cross over commas/adversative conjunctions
> and **falsely exempt a completely unhedged causal assertion that follows**:
>
> "**可能**你没看到,**但**没交盾**直接导致了**死亡。"
> ("**Maybe** you didn't see it, **but** not using the shield **directly caused** the death.")
>
> This was previously not flagged. **This is exactly the class that this gate exists to catch.**

The first half's "maybe" exempted the second half's utterly unhedged causal assertion.

Fix: hedge lookback tightened from "don't cross sentences" to "don't cross clauses"; boundary set includes multi-character words
(但是/然而/不过), so character classes won't work — requires `(?:(?!boundary-word).)*`.

**Note this vulnerability was introduced by `1b48d39`** — the exemption added to fix false positives (true statements being swallowed)
created a false negative (lies slipping through). **The other end of the pendulum.**

Before/after numbers:

```
561 corpus files: identical to pre-tightening (150/188 → 143/180, cleared items remain the same 8)
—— corpus contains no real instances of "hedge + adversative conjunction + unhedged assertion"
   This fix has zero net effect on current corpus; purely hardening against adversarial scenarios
   NEW-ONLY leakage count = 0
```

**Another fix where the numbers didn't move.** Vulnerability proven to exist via adversarial constructed examples, fixed, crystallized into tests.

---

## Three conclusions from the causalLint thread

**One · Anti-hallucination tools hallucinate themselves.** It misjudged negation sentences, falsely killed positive encouragement, let integers through,
and was blind to the production language for 19 days. **There is no reason to assume "the checker" is more reliable than "the thing being checked."**

**Two · False positives and false negatives are a seesaw, and the costs at each end are asymmetric.**
False positive = true statements swallowed (user sees less content); false negative = lies ship to production (user is misled).
This project consistently favors false positives — `ab05545`'s "that's the honest choice" says it most directly.

**Three · Two of nine fixes had completely unchanged numbers.** They fixed **vulnerabilities proven to exist by constructed examples
but not sampled by the current corpus**. This is the hardest face of the "before/after numbers" iron rule:
**when the numbers don't move, are you still willing to make the fix.**

---

# Part Two · Previous Work: Three source layers of hallucination

`TRACKER_ARCHIVE.md` has **279 archived entries**, of which **32** are directly related to fabrication/misjudgment.
After reading through them, I discovered that the first attribution **missed an entire layer**.

## Layer One · Data-layer hallucination: analysis code itself fabricated events

### B10 — Its name is literally Hallucination

> **Evoker Stasis "Fake Release" Hallucination** — Stasis release logged on
> **all buff removals, even if buff expired or player died.**
> Fix: only emit release if a Stasis `SPELL_CAST_SUCCESS` occurred during the buffering window.

Stasis is a "store spells, then release all at once" ability. The analysis code recorded **any buff disappearance**
as a "release" — including buffs naturally expiring, including the player dying.

**No model involved. Deterministic code fabricated an event that never happened.**

### More of the same kind

| # | What was fabricated |
|---|---|
| B16 | Stolen buffs recorded as "missed CC break" — because `SPELL_AURA_APPLIED` still carries the original enemy's srcUnit |
| B26 | "Ghost Threat" false positive — didn't check whether the enemy was CC'd or in range |
| B19 | `[RES]` snapshot computed in **code execution order**, not chronological — shared closure state was mutated during calls, and sections execute in source order |
| B13 | Stasis release list empty — only matched 7 hardcoded heal IDs, missing `SPELL_AURA_REMOVED_DOSE` |

### Why this layer is the most dangerous

**All grounding checks pass.**

The three-layer audit's first layer is "the finding must anchor to a real event id that resolves."
An event fabricated by analysis code — **it has an id, it's on the menu, it resolves**.

**The grounding layer verifies "did the model faithfully represent the analysis output," not "did the analysis output faithfully represent the log."**
If the analysis layer itself is fabricating, the protection provided by the grounding layer is **zero**.

This also explains why gladlog's gates ultimately took the form of **"re-parse the already-rendered prompt text
and independently recalculate from the raw log"** — it bypasses the analysis layer and verifies directly against the log.

---

## Layer Two · Model-layer hallucination: data is correct, model fabricated

### B110 — Referencing 2:04 in a 1:45 match

> Healer Response Accuracy: occasional timestamp hallucinations / CC-trinket-sequence
> misreads (**Match 016 hallucinated 2:04/3:40 in a 1:45 match**; Match 003 hallucinated
> trinket CD at 2:02). **Root cause is model behavior, not missing data.**

The match lasted only 1 minute 45 seconds. The model referenced 2:04 and 3:40 — **two moments after the match had ended.**

### The fix then, and the fix now

**Previous work (2026-07-05):** Added a discipline rule to three system prompts —

> cite only times printed on a timeline line and at/before `[MATCH END]`;
> **never extrapolate a time** — e.g. no 2:04 in a 1:45 match

The commit called it a **"model-behavior guardrail"**; verification was "wait for the next full meta-eval
and check for timestamps beyond `[MATCH END]`."

**gladlog (from 2026-07-12):** The model **is not allowed to write any numbers at all** — only `{{t}}`; the main process fills in real values.

### This is the biggest methodological leap between the two generations

```
Previous:  Ask the model not to fabricate  →  Constrain with prompt rules  →  Post-hoc spot checks
gladlog:   Don't give the model the chance →  Constrain with types/placeholders  →  Impossible by construction
```

**From "constraining behavior" to "removing capability."**

---

## Layer Three · Context crosstalk: not fabrication, but taking from the wrong neighbor

### B135 — Cross-round contamination in Solo Shuffle

This entry was explicitly labeled in the previous work as **"Distinct from B110 (intra-match hallucination)"** —
they recognized this was **a different mechanism**.

> findings import events (casts / timestamps / damage / CC / roster) **from an
> ADJACENT round that shares the same combat log + players**, producing hallucinated evidence

Specific cases (each traceable to exact round numbers):

```
1:17 Pain Suppression + 2:12 trinket   →  exceeds the 1:39 match end time (376)
A warrior teammate / Blessing of Spellwarding  →  belongs to sibling rounds (386/389)
304k@2:20 Flame Shock                  →  leaked from round 718 to 719
1:51 Chaos Bolt                        →  imported from round 1034 to 1033
WotF-on-Psychic-Scream                 →  lifted from 1052 to 1053
```

Impact:

> ~10 cards and **the single top accuracy-killer (3 of the 28 inaccurate cards)**

**Out of 28 inaccurate cards, 3 came from this single mechanism — it was the largest single accuracy killer at the time.**

### Attribution: near-identical context

Solo Shuffle has the same players play 6 rounds, **sharing a single combat log**.
The six rounds' prompts **look almost identical** — same people, same classes, similar timelines.

The model is not fabricating out of thin air. **It is confusing items between a set of near-identical contexts.**

### Fix: explicit negation, not omission

> stamp each Solo Shuffle round prompt with an **in-body round id / hard round boundary**
> + emit explicit **`X: not cast this round`** markers so sibling-round detail cannot bleed

**The key is the second half: not "don't mention X," but "explicitly state that X was not cast this round."**

Because **silence is ambiguous**. When the context doesn't mention a spell, the model can interpret it as "didn't happen,"
or it can auto-complete it from a nearby similar context. **Must explicitly negate.**

### This and gladlog's semantic smuggling are the same shape

| | Previous work B135 | gladlog `37f5df2` |
|---|---|---|
| Symptom | Imported events from adjacent round | Exported forbidden verdict from loadout tag |
| Wrong intuitive fix | Don't mention the spell | Delete the `[UNUSED]` tag |
| Actual fix | **Explicitly write "not cast this round"** | **Explicitly write "not using defensive was the correct decision"** |
| Principle | Don't omit — negate | **Don't delete facts — declare a stance** |

**Two generations independently arrived at the same principle: in the context given to the model, silence gets auto-completed.
To suppress an inference, you must explicitly state it, not remove the material.**

---

# Part Three · The deepest layer: first enumerate "what data cannot answer"

The previous work's `DATA_AUDIT.md` has a section called **Fundamental Limitations (What is Impossible from Logs)**:

> These are boundaries that **cannot be solved by more advanced tracking or AI** due to
> log format limitations:
>
> - **Line of Sight (LoS) Detection Is Impossible** — even with advanced logging providing X/Y coordinates,
>   we **lack Z-axis (height)** and more critically **lack the 3D collision mesh** (pillars, bridges, ramps).
> - **Perfect Player Latency Context** — the parser only sees server-side timestamps.
>   **Cannot distinguish "panicked keybinding / 3.5-second healing gap" from "player's network lagged 500ms."**
> - **True Pre-match State** — cannot know whether the player used a 2-minute CD in the starting room 30 seconds before the gates opened.
> - **Micro-CDR Math Limits** — hundreds of passive talents, random procs, and set bonus dynamic CD reductions;
>   maintaining 100% accuracy is practically impossible.

**This is the most upstream anti-hallucination measure: before writing any analysis, first document what this data cannot answer.**
Anything downstream that claims to answer these questions can be immediately classified as fabrication.

## An elegant sequel: How "impossible" became "possible within boundaries"

The previous work said LoS is impossible. **gladlog has `hasLineOfSight`.**

This is not a contradiction — it's **narrowing the impossible to a verifiable subset**. See `losAnalysis.ts`'s comment:

```ts
/**
 * Interpolate a unit's game position at a given absolute timestamp (ms).
 * Returns null when advanced logging is absent or the timestamp is outside range.
 *
 * Position snapshots are event-driven (damage taken, heals received, casts),
 * so an idle unit (drinking, stealthed, out of combat) produces none —
 * the straight line interpolated across such a gap is FABRICATED, NOT OBSERVED.
 * Pass `maxGapMs` to return null when the query time is further than maxGapMs
 * from the NEAREST recorded snapshot...
 * Omitted = legacy behavior: interpolate any gap, hold the last position forever.
 */
```

Three things accomplished simultaneously:

1. **Manually built 2D obstacle geometry** (`arenaGeometry.ts`) to replace the unavailable 3D collision mesh —
   giving up the Z-axis, solving only the "pillar blocks line of sight" 2D subproblem
2. **Code comments call their own output fabricated** —
   *"the straight line interpolated across such a gap is **fabricated, not observed**"*
3. **Unsafe default behavior is explicitly documented**:
   *"Omitted = legacy behavior: interpolate any gap, **hold the last position forever**"*

And this `maxGapMs` is exactly the entry in the predicate index:

> `INTERP_MAX_GAP_MS` is the T3 grounding guard that **killed fabricated mid-gap
> interpolation (a false 0.4 yd trained claim)**.

**There was once a real "distance 0.4 yards" melee claim, interpolated out of thin air between two snapshots.**

One more gate above: `positioningScan` recalculates geometry claims across the full corpus; hard gate, 0 violations.

### This evolutionary path is worth remembering on its own

```
Previous:  "LoS is impossible"                →  Don't do it
gladlog:   "3D is impossible, 2D pillars can"  →  Do it, but narrow the scope
         + "Return null when interpolation exceeds gap"  →  Only answer within boundaries
         + "Comments admit interpolation is fabricated"   →  Self-label untrusted regions
         + "Full-corpus geometry recalculation hard gate" →  Independent recalculation as fallback
```

**"Impossible" is not an endpoint — it's a boundary that needs to be precisely partitioned.**

---

# Methodological leap summary table between generations

| Dimension | Previous work (Mar–Jul) | gladlog (Jul–Aug) |
|---|---|---|
| Number hallucination | Prompt discipline "don't extrapolate timestamps" | **Model cannot write numbers at all**, only `{{t}}` |
| Verification method | Post-hoc meta-eval spot checks | **Deterministic hard gates, in CI** |
| Hallucination discovery | Manually reading 1,065 prompts | Full-corpus recalculation + manual deep reading of 300 matches |
| Incident records | 279 numbered entries in TRACKER | **CLAUDE.md three iron rules + 64-entry predicate index** |
| Lesson retention | A paragraph in documentation | **Consistency tests — rename anything and CI goes red** |
| Context crosstalk | Explicit `not cast this round` markers | Same-predicate guard annotations |
| Data boundaries | `DATA_AUDIT.md` enumerating the impossible | Code comments calling their own output `fabricated` |

**In one sentence: the previous work wrote lessons as documentation; gladlog wrote lessons as tests that fail.**

---

# Commands for verification

```bash
# causalLint nine rounds
cd ~/code/gladlog
git log --format='%ad %h %s' --date=short -- packages/analysis/src/analysis/causalLint.ts
for c in 2ff8aec ab05545 d249c3a aed104d 22eb6f2 1b48d39 91f7d0e; do git log -1 --format='%b' $c; done

# LoS: from "impossible" to "bounded"
sed -n '1,30p' packages/analysis/src/utils/losAnalysis.ts
grep -n 'INTERP_MAX_GAP_MS' -r packages/analysis/src/

# Previous work
cd ~/code/wowarenalogs
grep -o 'Evoker Stasis "Fake Release" Hallucination[^|]*' TRACKER_ARCHIVE.md
grep -o 'Cross-round contamination[^|]*' TRACKER_ARCHIVE.md
grep -o 'B110[^|]*timestamp-discipline[^|]*' TRACKER_ARCHIVE.md
sed -n '169,180p' DATA_AUDIT.md          # Fundamental Limitations
```
