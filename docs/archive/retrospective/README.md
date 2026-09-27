# gladlog Development Process Archive

Reconstructed from the git history of two repositories, all local AI session records from 2026-03-31 to 08-02,
and in-repo documentation. **Every number has a source and can be verified.**

---

## What is inside

| File | What is it | Lines | When to read |
|---|---|---|---|
| [`talk-24days-1010commits.md`](talk-24days-1010commits.md) | Speech + 36-page slide outline, scalable (20/45/90 mins) | 724 | When presenting the entire process externally |
| [`incidents-forensics.md`](incidents-forensics.md) | Narrative forensics of six incidents: your exact words + root cause + before/after numbers | 595 | When discussing a specific incident |
| [`code-forensics.md`](code-forensics.md) | Code level: files, functions, original text before fix, diff after fix | 684 | For engineers to read, or for personal retrospective |
| [`hallucination-attribution.md`](hallucination-attribution.md) | Hallucination attribution layer 1: table of seven mechanisms | 497 | When discussing "Why AI lies" |
| [`hallucination-attribution-deep.md`](hallucination-attribution-deep.md) | Layer 2: crash history of anti-hallucination tools + origins in previous work | 488 | When diving deep into methodology |

> ⚠️ **The positioning of the speech draft has changed.** It was written to "tell the complete story", but later you said not to tell the full story.
> The structure and numbers inside are still valid, but **it is now material, not a finished product**. The real main storyline is in the latter four documents.

---

## Three Reading Paths

**"I want to present it to others"** → Speech draft → Pick 2-3 incidents from the narrative forensics to insert
**"I want to understand what happened back then"** → Incident narratives → Code forensics
**"I want to understand why AI is unreliable"** → Hallucination attribution → Layer 2 attribution (Order cannot be reversed, Layer 2 assumes you've read Layer 1)

---

## Main Number Table

Just check this table before presenting or writing an article, no need to recalculate.

### Scale

| Metric | Value | Source | Note on scope |
|---|---|---|---|
| gladlog commit | **1,010** | `git log` | 2026-07-10 → 08-02, all types included |
| Timespan | **24 days** | 7-10 decision to rewrite → 8-02 release v0.1.19 | Calendar days |
| My messages (gladlog) | **749 msgs** | Session logs, system injections excluded | Median **55 chars** |
| My prompts (Claude all projects) | **2,880 msgs** | `~/.claude/history.jsonl` | 2026-03-31 → 08-02 |
| My prompts (agy) | **1,203 msgs** | `~/.gemini/antigravity-cli/history.jsonl` | From 2026-05-20; wow two projects account for 71% |
| Message turns / Tool calls | **105,388 / 87,453** | `~/.claude/stats-cache.json` | **Only covers 36 active days from 5-21→7-23, this is the lower bound** |
| Peak daily tool calls | **10,834** | Same as above | 2026-07-01 |
| Code | **86,938 lines / 7 modules / 273 test files** | `wc -l packages/*/src` | Excludes generated outputs |
| Version | **v0.1.19**(2026-08-02) | `git tag` | |
| Model generations | **4 times** | `model` field in session logs | May opus-4.7 → June 4.8 → July fable-5 → Aug opus-5 |

### Money

| Metric | Value | Note on scope |
|---|---|---|
| Total tokens | **24.9 billion** | Mostly cache read (17.2 billion), **not 24.9 billion new tokens** |
| Output tokens | **81.4 million** | "Amount actually written by AI" |
| API list price | **$30,217 – $36,093** | Range based on cache write priced at 1.25x vs 2x |
| Actual paid | **$340** | Pro $20×3 (Apr/May/Jun) + Max 20x $200×1 (Jul upgrade) + agy $20×4 |
| Multiplier | **≈ 89×** | Divided using lower bound $30,217, safer to report |

> **Must state this as well**: $30k is the **lower bound** — records for April and early May were cleared by the system,
> and usage for agy / Gemini / Codex was not counted at all.

### Quality System

| Metric | Value | Source |
|---|---|---|
| Predicate index | **64 rules** | `docs/predicate-index.md` |
| Consistency tests | **682 lines** | `packages/eval/test/predicateIndex.test.ts` |
| Deterministic hard gates | **4 gates** | `hardFailures` in `promptQualityCheck.ts` |
| Previous work archive entries | **279 entries** (32 related to hallucination/misjudgment) | `wowarenalogs/TRACKER_ARCHIVE.md` |

---

## Incident Index

`Narrative` = incidents-forensics · `Code` = code-forensics · `Hallucination` = hallucination-attribution · `Deep` = same name -deep

| # | Incident | Date | Key commit | Before/After | Located in |
|---|---|---|---|---|---|
| 1 | **Four levels of "Fixed it"** | 07-20 | `3cd5342`→`0e13264`→`dbe61bd`→`c820ad4` | See next 3 lines | Narrative · Code |
| 1a | └ Type A: Same-second HP contradiction | | `0e13264` | 26/50 → 0/50 matches | Narrative · Code |
| 1b | └ Type B: p50 > p90 (NaN comparator) | | `0e13264` | 14/50 → 0/50 matches | Narrative · Code |
| 1c | └ Type D: Two cooldown values for same spell | | `c820ad4` | 1/50 → 0/50 matches | Narrative · Code |
| 2 | **`"1\r" !== "1"`** Feign death counted as real | 07-11 | `ac35614` | 3 phantom deaths in 1 match → 0 | Narrative · Code |
| 3 | **Fences misjudged as bad-json** | 07-20 | `132b3da` | 39/40 → 40/40 matches | Narrative · Code |
| 3b | └ Production "Only 2 items" | 07-25 | `9ca89e8` | Kept 2/5 → 6/6 items | Narrative · Code |
| 4 | **Memory 2GB and growing** | 07-25/26 | `ea8ef76` and 6 others | Open 1 match 1244ms → 37ms | Narrative · Code |
| 5 | **Agent escaped into my checkout** | 08-01 | — (Memory bank incident archive) | Lossless recovery | Narrative |
| 6 | **Official data vs Heuristics** | 07-25 | `028e625` | Caught 2 misjudgments + 1 silent failure | Narrative |
| 7 | **causalLint crashed 9 times itself** | 07-12 / 07-31 | 9 commits | 0/300 → 107/300 → 143/180 | Deep |
| 8 | **Semantic smuggling (Gates bypassed by context)** | 08-01 | `37f5df2` | Unprotected without guard annotation 72/92 → 0/92 | Hallucination |

---

## Hallucination Attribution Quick Reference

**Three Source Layers** (Core discovery in Layer 2 doc):

```
Data Layer      —— Analytics code fabricated events itself      ← Grounding layer provides zero protection
Model Layer     —— Data is correct, model fabricated it
Context Layer   —— Not fabrication, picked wrongly from similar neighbors
```

**Seven Mechanisms**:

| # | Mechanism | Handling | Verifiability |
|---|---|---|---|
| 1 | Number fabrication | **Remove capability entirely** (Placeholders + Main process interpolation) | Impossible by design |
| 2 | Event fabrication | Menu system + grounding layer | Deterministically verifiable |
| 3 | Causal fabrication | **Don't verify truth, ban the language** | **Unverifiable** |
| 4 | Semantic smuggling | Guard annotation for predicates | Partially |
| 5 | Narrative completion | Before/After numbers with predicates | Verifiable ex-post |
| 6 | Intent taken as fact | **No automated defense** | — |
| 7 | Single sample extrapolation | Independent second opinion | Verifiable ex-post |

**Three most counter-intuitive conclusions**:

1. **Hallucination is not always accompanied by false confidence.** `3cd5342` honestly wrote "TODO: End-to-end A/B" —
   The defense line was effective at that moment, what failed was me not reading line 37.
2. **Verification mechanisms can produce false verifications.** The number layer missed integers, marking "You died at 47s"
   (actually 30s) as "Verified". This is worse than having no verification.
3. **Silence will be auto-completed.** To suppress an inference, you must state it explicitly, not take the material away.
   The previous work (`X: not cast this round`) and gladlog (guard annotations) independently hit this same truth.

---

## Known Gaps (Honest List)

Things I must know before presenting or publishing, where I cannot show firsthand evidence or it's outdated:

| # | Gap | Handling Suggestion |
|---|---|---|
| 1 | **Original text of AI's "six weeks" is lost** — Only your "Why spread it over six weeks" remains | Quote your own sentence; don't claim to have a screenshot |
| 2 | **$30k is just the lower bound** — Apr/early May logs cleared, agy/Gemini/Codex not included | Mention this every time you report numbers |
| 3 | **`CLAUDE.md` lists 54 predicates, actually 64** | Pending fix (change both EN/ZH versions together) |
| 4 | **No true model A/B test on the end-effect of guard annotations** | `37f5df2` wrote this itself, just copy it |
| 5 | Speech draft cost page hardcoded $340, but slide 27b "Daring to say this because I bought enough quota" is my inferred causality | Delete that page if it wasn't your actual thought then |

---

## Yet to dig

- **Raw outputs per match from 50-match A/B on 7-20** — In `~/code/gladlog-eval-private/`
- **Full categorization of 279 archive entries in previous work** — Only read the 32 hallucination-related ones this time
- **Raw data from `positioningScan` full corpus geometry audit** — That batch of 141,237 distance claims

---

## Verification

Every doc has a "Verification Commands" section at the end, ready to paste into terminal. The fastest three:

```bash
cd ~/code/gladlog
git show 3cd5342 | tail -12                     # That "TODO: End-to-end A/B" line
git show be36279 --name-only --format='' | grep -c drAnalysis   # → 0, message lying confirmed
sed -n '394,425p' packages/analysis/src/utils/cooldowns.ts      # The 5 lines where fake fix couldn't possibly work
```
