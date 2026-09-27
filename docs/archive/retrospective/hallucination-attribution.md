# Hallucination Attribution: Seven Mechanisms and How Each Was Handled

First, distinguish two categories — their causes and solutions are completely different:

- **Product side** — the AI coach writes things not in the logs
- **Development side** — the AI programmer claims to have done something it didn't do

---

# Part One · Product Side: AI Coach Hallucinations

## Overall Architecture: Route by "Verifiability," Not by "Severity"

This is the single most critical decision in the entire design. Four types of hallucination, **each handled completely differently**:

| Hallucination type | Verifiability | Handling approach |
|---|---|---|
| Numbers | Yes | **Eliminate by construction** — the model has no ability to write numbers |
| Event anchors | Yes | Deterministic hard-gate interception |
| Causal | **No** | **Ban the language**, rather than verifying the claim |
| Semantic smuggling | Partial | Same-predicate guard annotation (the last category discovered) |

---

## Mechanism One · Number Hallucination → Remove the Capability

### Attribution

The model writes "you dropped to 12% HP at 43 seconds" — there are two numbers here, either of which could be fabricated.
And **fabricated numbers look identical to real numbers** — they cannot be distinguished after the fact.

### Solution: The model is not allowed to write numbers — not a single one

The hard rule given to the model in `packages/analysis/src/analysis/buildFindingsPrompt.ts`:

> `Write NO digits at all in "explanation". Every number must be a {{key}} placeholder
> drawn from the referenced events' facts (e.g. {{t}}). For counts or durations you have
> no placeholder for, use words ("twice", "briefly", "early", "a few globals") — never a
> raw number. **An explanation containing any bare digit will be discarded.**`

What the model writes:

```
You dropped to {{hp}}% at {{t}}s
```

**The main process then replaces `{{t}}` / `{{hp}}` with the real values from the log.**

### Why this is called "impossible by construction"

The model **has no opportunity** to fabricate numbers — what it writes in those positions are not numbers at all, but key names.
A key name either resolves to a value in the facts table (making it a real value) or fails to resolve (and the entire entry is discarded).

The dual check in `claimChecker.ts`:

```ts
// 1. every {{key}} must resolve
if (!Object.prototype.hasOwnProperty.call(facts, m[1]))
  violations.push(`unknown placeholder {{${m[1]}}}`);

// 2. strip placeholder spans, then scan the prose for raw stat-like numbers
const prose = rawText.replace(PLACEHOLDER, " ");
```

Note the order of step 2: **first remove placeholder spans, then scan the remaining prose for bare numbers.**
This way legitimate placeholders aren't falsely flagged, and any bare numbers that slip through are caught.

### This constraint itself was A/B tested

Comment in `buildFindingsPrompt.ts`:

> accuracy **+0.71 [0.43, 1.00] (p=0.004, 42/42 claims verified)** for the free-text eval coach.
> **Do not weaken these constraints without an A/B.**

Not "feels better" — quantified: accuracy improvement of 0.71 points, confidence interval doesn't cross zero, p=0.004.

---

## Mechanism Two · Event Anchor Hallucination → Menu System + Three-Layer Audit

### Attribution

The model can claim out of thin air "you missed a dispel in the mid-game" — an event that never happened.

### Solution One: Give a menu only, no freestyle creation

Verbatim from the prompt:

> `Event menu (**the ONLY things that provably happened** — every finding must reference these ids)`
> `Reference only event ids from the menu (in "eventIds"). **Never invent an event.**`

All candidate events are deterministically computed from the log (`candidateFindings.ts`),
each with an id and a set of facts. The model can only **pick from the menu** — it cannot order off-menu.

### Solution Two: Three-layer audit (`auditFindings.ts`)

```
Layer 1  grounding   — eventIds is non-empty, and every id resolves to a real event
Layer 2  claimChecker — every {{key}} resolves + no bare numbers in prose
Layer 3  causalLint   — no strong causal assertions
```

Layer 1's original comment:

> the finding must anchor to >=1 event, and every eventId must resolve.
> **(Empty eventIds is unanchored → drop.)**

### Pitfall encountered here: an overly strict gate is also a bug

Fixed once each on 2026-07-24 and 07-25; comments document the traces:

> **Refined 2026-07-24**: drop only when the explanation *actually uses* a colliding key —
> the old rule dropped the whole finding whenever a colliding key merely existed, which
> also killed the multi-event chains the prompt explicitly encourages…
> **a smoke run measured 3/7 findings dying this way.**

> **reproduced in production 2026-07-25**: 3 of 5 findings in a Chinese reply died this way
> **and the user saw only 2.**

**The anti-hallucination gate itself caused two production incidents.** This is the real cost of this design.

---

## Mechanism Three · Causal Hallucination → Don't Verify the Truth, Ban the Language

### Attribution (this is the most insightful step in the entire design)

"You died **because** you positioned too aggressively" — this statement cannot be verified.
You cannot determine from logs whether it is true or false. The counterfactual does not exist in the data.

The conclusion from a cross-AI debate (agy) was recorded as a policy: **avoid-causality-by-design** —
qualitative/causal claims **cannot be verified by construction**.

### So the solution is not "verify causation" but "do not allow writing causation"

`causalLint.ts` opens with this statement right at the top:

> This checks causal **LANGUAGE** (enforcing the policy), **not causal TRUTH** (unverifiable).

Hard rule on the prompt side:

> `Do NOT assert causation. No "because … you lost", "cost you the game", "that's why",
> "led to the loss". **State observations and suggestions only.**`

Even "death chains" — the most natural scenario for causal language — are explicitly given a neutral form:

> Describe the sequence neutrally — "at {{t}}s X happened; at {{deathT}}s the death followed"
> — and suggest what to do differently at the setup moment.
> **The no-causation hard rule still applies: never write that the setup "led to"/"caused"/"resulted in" the death.**

### How hard this "simple" checker is to write

`causalLint.ts` comments document three rounds of patches, each one prompted by real corpus data proving it wrong:

**Pitfall 1 — Sentence boundaries (2026-07-31)**

The original gap pattern used `[^.]*` (non-period), which works for English but **completely fails for Chinese**:

> Pre-2026-07-31 this class was ASCII-only `[^.]*` — invisible as a bug for English text
> (which does use "." to end declarative sentences) but it **silently let a zh gap-pattern
> span an entire multi-sentence paragraph.**

Chinese sentences end with "。!?", never with "."; and the deepDive prompt explicitly requires 3–5 sentences per paragraph,
with production default language being Chinese. So any "because" and any "death" anywhere in a paragraph would be connected and flagged as causal.

**Pitfall 2 — Negation treated as assertion**

Real corpus sentence: "幸好**没有导致**后续崩盘" (Fortunately it **did not lead to** a subsequent collapse) — this is **negating** causation, yet it was flagged as asserting causation.

The fix was a series of lookbehinds:

```js
const NEG_LOOKBEHIND = "(?<!没有)(?<!不会)(?<!并未)(?<!未曾)(?<!从未)(?<!未)(?<!不)";
```

The comment explains why both single-character and multi-character forms must be listed (not redundant):

> "未导致" is caught by `(?<!未)` but NOT by `(?<!未曾)` (the immediately-preceding char
> there is "曾", not "未"); "未曾导致" is the reverse.

**Pitfall 3 — Over-blocking check**

After adding the negation guards, they proactively verified that they wouldn't cause false kills:

> Over-block check for the new `(?<!不)`: every real 2-3 char Chinese word ending in 不
> immediately before one of these markers (毫不/绝不/决不/从不) **is ITSELF a negation
> of the causal claim, so blocking is correct there, not an over-block.**

**After adding a guard, proactively proving it won't cause false kills — this is the step most people skip.**

---

## Mechanism Four · Semantic Smuggling: The Gate Blocks the Menu, but Context Bypasses the Gate

**This was the last category discovered, and the hardest to defend against.** 2026-08-01, reported by me during real usage.

### Symptom

The analysis said "you didn't use your own defensives," but **I barely took damage that round.**

### Attribution (quantitative)

`37f5df2` commit message, measured across 40 matches / 163 rounds from local library:

```
cd-waste candidate gate (minHP≥60 suppresses) works correctly: low-pressure 92 rounds  0 candidates
                                                                ↑ gate is fine

But in the timeline prompt's <player_loadout>, the owner's unused defensive [UNUSED] tag
                                                                ↑ ignores pressure

Low-pressure rounds: 72/92 (78%) carry unguarded tags
Rounds with damage taken <10% maxHp as symptom: 3/3 all hit
```

**The gate blocked this coaching point from the menu. But a different section of the same prompt
still bluntly tells the model "this defensive wasn't used."** The model riffs from there.

### Why the audit can't catch it

Verbatim from memory:

> **findings only need to anchor to any menu id; the audit cannot detect semantic smuggling.**

The three-layer audit checks: does the anchor exist, are the numbers fabricated, is there causal language.
**It does not check "is what this sentence discusses actually about this anchor's topic."**

The model can anchor to a real death event and then in the explanation discuss a completely different,
gate-rejected topic. **Every audit layer will pass.**

### Root cause in one sentence

> **If the "facts" given to the model are not co-sourced with the coaching gate, the gate is effectively open — facts still induce the model to produce verdicts the gate had rejected.**

**This is the "single-source predicate" iron rule, applied to prompt context rather than code.**
The gate and the context each independently determine the same fact ("should this defensive be criticized"), using different criteria.

### Fix: Same-predicate guard annotation

Not by deleting the `[UNUSED]` tag (**honesty ethics: do not delete facts**), but by adding a stance annotation when pressure is low:

```
lowPressureUnusedDefensiveNote  ——  consumes the same
                                    CD_WASTE_PRESSURE_HP_PCT + matchMinHpPct
                                    as cdWasteEvents
```

The threshold is **exactly complementary** to the candidate gate: ≥threshold suppresses → annotation appears; <threshold → candidate fires, no annotation. Pinned with unit tests.

### Before/after numbers

```
Low-pressure rounds [UNUSED] unguarded:  72/92  →  0/92
Candidate gate behavior unchanged: cd-waste low-pressure 0→0, real-pressure 57→57
Symptom rounds 3/3 carry annotation
PROMPT_VERSION 13→14 (stale caches with this class of false positive also invalidated)
```

### It declared what wasn't verified

Last line of the commit message:

> Note: **the guard annotation's downstream effect on model behavior was not A/B tested with a real model**; the verifiable surface of this fix is the deterministic prompt layer.

**What was fixed is "what the model sees," not "what the model says as a result." The latter was not verified. This was explicitly written down.**

---

# Part Two · Development Side: AI Programmer Hallucinations

Product-side hallucinations can be eliminated through architecture; development-side ones cannot — **because writing code has no placeholder mechanism available.**

## Mechanism Five · Plausible Narrative Substituting for Causal Verification (`3cd5342`)

### Phenomenon

The root cause it gave:

> A documented invariant, broken on one side by a subsequent change.

### Line-by-line verification: every local fact is true

| Its claim | Fact |
|---|---|
| docstring mandates both sides must use the same radius | ✅ True — `HP_SAMPLE_RADIUS_MS`'s comment does say this |
| `HP_SAMPLE_WINDOW_CRITICAL_MS = 1500` is a later-added local constant | ✅ True |
| It was only added to the STATE side | ✅ True |
| DMG SPIKE only occurs in critical windows | ✅ True |
| **Therefore the two necessarily sample different values** | ❌ **False** |

**The first four are correct. Only the "therefore" in the fifth is fabricated.**

### Where the fabrication is

It didn't read the implementation of `getUnitHpAtTimestamp`. If it had, five lines would show:
the radius only appears once in `if (dt > maxDtMs) return null`,
while the return value comes from the earlier `binarySearchClosest` — **there is no causal pathway between them**.

### Mechanism naming: narrative completion overriding causal tracing

What it was doing was **completing a story**: there is a documented invariant, there is a one-sided modification, there is a symptom —
these three things together form an **extremely common, extremely real bug pattern**.
The model recognized this pattern and then **assumed** the instance fit the pattern, **without verifying that this particular instance's data flow actually worked that way**.

**It was fitting the shape of a bug, not this bug.**

### It knew

Third-to-last line of the commit message:

> **Not done: end-to-end A/B (criterion = Type A encounter count 31→0).**

**It honestly labeled the unverified part. I merged without reading that line.**

This one is particularly worth noting: **hallucination is not always accompanied by false confidence.**
This time, uncertainty was correctly labeled — just on the third-to-last line of a 40-line message.

---

## Mechanism Six · Commit Message Describes Intent, Not the Diff (`be36279`)

### Proof

`be36279`'s message says:

> Incidental fix: analyzeOutgoingCCChains' comment says "only returns chains with at least one downgrade,"
> actual filter condition is applications.length > 0 — comment is stale, **now aligned to actual behavior**.

Actual changes:

```
 packages/analysis/src/context/matchTimeline.ts | 29 +++++++++++++++++++++++++-
 1 file changed, 28 insertions(+), 1 deletion(-)
```

**One file. `drAnalysis.ts` was never touched.** (`git show be36279 --name-only | grep -c drAnalysis` → 0)

### Attribution

The commit message was written **after the action sequence ended**; its content came from **the plan and reasoning process at the time**,
not from `git diff`. "Incidentally fix this comment" was in the plan, the reasoning discussed it,
so it entered the message — **while the actual edit never happened**.

### Why this type is the most dangerous

- Bad code → tests go red
- Bad logic → A/B can detect it
- **Message not matching diff → no automation will ever catch it**

What it contaminates is the history that **future selves and future people** will read. Three months later someone runs `git log` to find
"when was this comment fixed," finds `be36279`, and then stares in confusion at the code still showing the old version.

### How it was caught

Not by tooling — it was stumbled upon when `dbe61bd`'s round **went back to read that file**.
Pure coincidence.

---

## Mechanism Seven · Single-Sample Extrapolation (`dbe61bd`'s Type D Conclusion)

### Phenomenon

At 12:37, `dbe61bd` determined that Type D issues were "not data inconsistency, just readers unable to distinguish 'not tracked' from 'unavailable'" —
only added a legend.

At 13:56, `c820ad4` opened with one word:

> **Wrong.**

### Attribution

`c820ad4`'s own retrospective:

> I myself misidentified the data source as SPELL_CATEGORIES when reviewing Type D in the previous round, reaching the opposite conclusion.

It checked one spell (Lay on Hands), found it absent from both data sources, and thus inferred "this is not a data inconsistency issue."
**But that spell was cast only once across thousands of matches (2,525 fights) — n=1.**

The real problem spell was Ironbark, which had two different values in two tables. It didn't find it.

### Who caught it

> This counterexample was found by **the blind-eval A/B responder sub-agent** — it refused to trust the MISSED OPTIONS
> claim, reasoning that it "contradicts the RES ledger in the same prompt." **An extra pair of independent eyes was worth the cost.**

**Note this sub-agent was not sent to look for bugs.** Its task was to play a coach answering questions.
It stumbled upon the contradiction while doing its own job, and **refused to continue answering on top of the contradiction**.

---

# Part Three · Why "Being More Careful" Doesn't Solve It

Three measurement blind spots, each one quantified.

## Blind Spot One · Unit Tests Are Blind to Prompt-Model Interaction

From `gladlog-deepdive-eval` records:

> **Placeholder / bare-number / causal-discipline features have a systematic blind spot in synthetic pack unit tests** —
> hand-aligned placeholder unit tests **stay green forever**, but real models fail on prompt-model interaction.

Real model smoke testing measured: **discipline pass rate 50% → 100%**, after two rounds of prompt changes.

Two specific failure modes:

1. `units=X` in the checklist printed as a standalone top-level token → model writes nonexistent `{{pN.units}}` → dropped
2. HP field names `hpT15/10/5` encode offsets into the key name → model writes **bare numbers** for "15 seconds before death" → dropped;
   server name (Area52) contains digits, model writes the full name → bare-number audit **false kill**

**Neither of these is the model's fault — it's the prompt's data shape forcing the behavior.** The model behavior in unit tests was assumed by me,
so it can never be tested this way.

**Conclusion written into a rule:** Any change to "model output must pass placeholder/discipline audit"
must run a real model smoke test (≥6 real corpus anchor points) before landing — don't rely only on unit tests.

## Blind Spot Two · LLM Judges Can't Adjudicate Half Their Dimensions

From `gladlog-judge-noise-floor`, two independent methods reaching the same conclusion:

```
accuracy    paired SD = 1.30   →  |Δ| < 0.4 simply unmeasurable
            (the other six dimensions 0.14–0.65; it is 2–9× worse)
sufficiency detection rate 1/5 = 20% → injected "delete all death lines," 4 of 5 items the judge scored equal or higher
```

**"Delete all death data" — this blatant defect is invisible to the judge 80% of the time.**

The inference was written into an iron rule:

> Prompt internal-consistency fixes **should not be expected to be verifiable by blind eval**. The 2026-07-20 round's
> deterministic metrics for eight types of defect fixes were hard-failure **185→0, 80/98 encounters→0/98**; blind eval was **inconclusive across all seven dimensions**
> (accuracy point estimate was even negative at −0.30).
> **Adoption rationale must read "by deterministic metrics" — do not package it as an A/B win.**

**This is the most honest engineering rule I've seen: it's fixed, but you are not allowed to say A/B proved it, because A/B didn't detect it.**

## Blind Spot Three · "Never Happened" and "Can't Fire" Look the Same in the Corpus

Upstream data table missing an entry → downstream rule stops triggering entirely → on the UI it looks like "this problem never occurred."

At least two instances of dead gates in the same category:
- `G6_IMPOSSIBLE_CC`: gate threshold 50 yards > producer suppression threshold 45 yards, **has been impossible to trigger since launch**
- DR table officialization caught "**2 misjudgments + 1 silent failure**"

---

# Attribution Summary Table

| # | Mechanism | One-liner | Handling approach | Verifiability |
|---|---|---|---|---|
| 1 | Number fabrication | Fabricated numbers look the same as real ones | **Remove the capability** (placeholders + main-process interpolation) | Impossible by construction |
| 2 | Event fabrication | Claiming something that didn't happen | Menu system + grounding layer | Deterministically verifiable |
| 3 | Causal fabrication | "Because…you lost" | **Don't verify the truth — ban the language** | **Not verifiable** |
| 4 | Semantic smuggling | Anchored to A, discussing forbidden B | Same-predicate guard annotation | Partial (prompt layer verifiable, behavior layer not verified) |
| 5 | Narrative completion | Fitting the shape of a bug, not this bug | Same-criterion before/after numbers | Verifiable after the fact |
| 6 | Intent as fact | Message describes plans, not the diff | **No automated defense** | — |
| 7 | Single-sample extrapolation | Drawing conclusions from n=1 | Independent second opinion | Verifiable after the fact |

## Three Conclusions Running Throughout

**One · Hallucination is not one thing.** Number hallucination can be eliminated by construction; causal hallucination can never be verified;
semantic smuggling is invisible even to audits. **Treating them as the same problem means spending effort in the wrong places.**

**Two · The most expensive hallucinations happen at the reasoning layer, not the output layer.** Output-layer fabrications (numbers, events) have been
architecturally resolved. Everything remaining is at the **reasoning layer**: an argument chain where every step is correct but only the connectives are false.
**No automation can block this — the only defense is "run the same criterion again."**

**Three · When the model labels uncertainty, humans need to actually read it.**
`3cd5342` **did write** "Not done: end-to-end A/B." The defense was effective at that moment —
**the link that failed was me not reading that line.**
The subsequent solution was not to make the model more cautious, but to move such declarations from line 37 of a commit message
**into a place where CI will block it**.

---

# Commands for verification

```bash
cd ~/code/gladlog

# Product-side four lines of defense
sed -n '80,92p' packages/analysis/src/analysis/buildFindingsPrompt.ts   # Hard rules given to the model
sed -n '1,60p'  packages/analysis/src/compare/claimChecker.ts           # Placeholder + bare numbers
sed -n '15,50p' packages/analysis/src/analysis/auditFindings.ts         # Three-layer audit
sed -n '1,75p'  packages/analysis/src/analysis/causalLint.ts            # Causation: check language, not truth
git show 37f5df2                                                        # Semantic smuggling 72/92→0/92

# Development-side three mechanisms
git show 3cd5342 | tail -12                    # "Not done: end-to-end A/B"
git show be36279 --stat --format=''            # Only 1 file changed
git show be36279 --name-only --format='' | grep -c drAnalysis   # → 0, message lie confirmed
git show c820ad4 | head -30                    # "Wrong." + n=1 extrapolation retrospective

# Three blind spots
cat ~/.claude/projects/-Users-mingjianliu-code-gladlog/memory/gladlog-deepdive-eval.md
cat ~/.claude/projects/-Users-mingjianliu-code-gladlog/memory/gladlog-judge-noise-floor.md
```
