# Coach-corpus admission audit — Value-Gate target-sentence pool (GH #71)

Date 2026-09-12. Reader: one (Claude), single pass, zero model calls, zero product code. Scope,
rubric and every decision are frozen in the private ledger
`tmp/skillcapped-vod/admission-audit-2026-09-12.json` (regenerate with
`tools/coach-corpus/admission_audit.py --decisions <file>`). The method was re-scoped in a two-round
debate with codex gpt-6-astra before any sentence was read; both rounds ended `PARTIAL` and the
plan below is the ruling that came out of it.

## Why the original plan was dropped

GH #71 proposed reading all high + medium mapped coach sentences next to each predicate's prompt
legend and giving each predicate a ✅ / ❌ verdict, as the 21-sentence table in
`docs/HANDOFF-2026-09-05-skillcapped-coach-corpus.md` (§ "用 high 匹配当 Value-Gate 目标句") did.
Codex's objections, all verified against the cited code:

- **"medium" is defined as "same event family, predicate might not catch this instance"**
  (`tools/coach-corpus/extract_verdicts.py:58`). A medium sentence is not a target for the legend
  until it is admitted against the predicate's real eligibility conditions. Example: "port out of the
  stun to dodge the thrown trap" (gbzpv37hnz/3) — `cc-avoidable` excludes instant CC by design
  (`candidateFindings.ts:1429`, Freezing Trap named). That is an adjacent event, not a legend defect.
- **114 of the 122 pool sentences carry `needs_frame: true`** — most lack independently verified
  premises.
- **"Five signals had the value gate skipped" is not supported.** Zero high-confidence examples in
  this corpus slice says nothing about the user reviews those signals went through at launch
  (`crisis-no-response` rejected four examples before its formulation changed). The defensible
  claim: five signals had no high-confidence mistake example in this corpus slice.
- **The pool was healer-only.** With the DPS-perspective scan (GH #75) `burst-into-mitigation`
  becomes observed and the pool is **149 sentences / 16 predicates**, not 122 / 15.
- **A ✅/❌ table conflates "recognises the event" with "supports the advice"**, and "does the
  legend mention the majority axis" can reward wrong behaviour (`cd-hoarded` forbids prescribing a
  button on purpose).

## Frozen scope and rubric

Pool = `polarity == mistake` ∩ `gladlog_type` observed firing (logger ∪ dps scans of the local
400-round library, `candidateDiagnostics.ts --json`) ∩ `map_confidence ∈ {high, medium}` = 149.
**First pass = 95**: `cc-avoidable` 24 + `burst-into-mitigation` 27 + the five predicates with zero
high-confidence examples in the healer-only pool (`position-mistake` 13, `slow-defensive-response`
12, `cd-hoarded` 9, `death-setup` 6, `crisis-no-response` 4). Predicate versions = `main @ 64f31820`.

Decisions, applied in order, first applicable wins:

1. **EXCLUDED** — an established fact in the sentence contradicts a required predicate condition
   (actor, role, trigger, timing, availability).
2. **UNKNOWN** — at least one material eligibility or advice-feasibility premise of the predicate
   is unresolved by the sentence; the premise is named.
3. **NON-TARGET** — eligibility established, but the sentence is description or consequence only.
4. **ADMITTED** — the sentence establishes the predicate's required eligibility and
   advice-feasibility premises and supplies an actionable recommendation.

Advice axes are recorded separately (multi-label). Confidence and majority vote never decide
admission. Yield threshold (codex R3): **one** verified, actionable discrepancy — an ADMITTED
witness + an exact conflicting instruction or unsupported required fact + a check that the fact is
not available elsewhere + a concrete proposed target sentence — unlocks reading the remaining 54.
Zero means stop and report the bounded result; UNKNOWNs are neither yield nor a pass.

## Result

| predicate               |      n | ADMITTED | UNKNOWN | NON-TARGET | EXCLUDED |
| ----------------------- | -----: | -------: | ------: | ---------: | -------: |
| cc-avoidable            |     24 |        3 |      12 |          0 |        9 |
| burst-into-mitigation   |     27 |        2 |      23 |          0 |        2 |
| position-mistake        |     13 |        4 |       9 |          0 |        0 |
| slow-defensive-response |     12 |        1 |       5 |          0 |        6 |
| cd-hoarded              |      9 |        0 |       9 |          0 |        0 |
| death-setup             |      6 |        4 |       2 |          0 |        0 |
| crisis-no-response      |      4 |        0 |       1 |          0 |        3 |
| **total**               | **95** |   **14** |  **61** |      **0** |   **20** |

**Verified actionable discrepancies with an ADMITTED witness: 0.** Every one of the 14 admitted
sentences names the same event and the same advice axis as its legend:

- `cc-avoidable` ×3 — Fade / Shadowmeld on a visibly cast Cyclone / Hex (the two HIGH sentences in
  the group are both this shape). Legend: "the enemy was VISIBLY CASTING … facts.avoidableWith was
  available … coach reacting with one of these tools". Same.
- `burst-into-mitigation` ×2 — opening go into Icebound / an active defensive while a bleeding,
  undefended target existed. Legend: "state that the mitigation was up and the alternative existed;
  coach target selection at the moment of opening". Same.
- `position-mistake` ×4 — blinked away with no pressure (missed-push), soaking Trueshot in the
  Hunter's line (stayed-in, fix = leave the line), standing in the Devourer (stayed-in, fix = run the
  pillar), Mass Dispel cast with the target moved out (cd-out-of-range, fix = cancel). Legend: "coach
  the movement decision". Same; the cast-cancel one is the loosest fit (target tracking rather than
  movement) but does not conflict.
- `slow-defensive-response` ×1 — healer needed Pain Suppression during the enemy go. Legend's tool
  list includes external. Same.
- `death-setup` ×4 — defensive spent early / trinkets spent aggressively, then the death. Legend:
  neutral sequence + "suggest what to do differently at the setup moment", no causation. The
  coaches DO assert causation ("holding it would have carried him through"); the legend forbids the
  model to — a ruled product stance (see GH #70), not a defect.

So the remaining 54 sentences are **not read**, per the threshold.

## What the 61 UNKNOWN and 20 EXCLUDED say (findings without an admitted witness)

These are recorded as leads, not defects. Each names what would upgrade it.

1. **`cc-avoidable` — two advice axes the predicate cannot express.**
   Of 24 sentences: own-ability 9 (the legend's axis), **line-of-sight / positioning 6**,
   **interrupt-the-CC-cast 4**, mobility 3, consequence-only 2, others 3.
   - LoS: "once the fear cast was visible the student could simply have stepped behind the pillar"
     (kmchvw3ndg/13) states every coach premise; the predicate additionally requires a tool from
     `applicableCCAvoidanceIds` (immunity buff / druid form / repositioning spell) — LoS is not one.
     `ICCInstance` already carries `losBlocked` and `distanceYards` at application, but
     `cc-avoidable`'s facts do not render them, and "a pillar was reachable during the cast" is not
     derived anywhere (needs `arenaGeometry` + the cast-start position). Bucket: **partly present
     elsewhere, not citable; the reachability half not derived.**
   - Interrupt-the-cast (Shadow Word: Death on the Hex / Fear cast, txfx97zrrs/9,/25): per-player
     interrupt availability IS derived since 2026-09-12 (`interruptKitGenerated.json`, kick-priority
     feasibility) but `cc-avoidable` does not consult it. Bucket: **present elsewhere, not wired.**
   - Upgrade path for either: one library instance (own 1,046 rounds) where a hard-cast CC landed at
     Full DR ≥ 4 s, `losBlocked=false` at application, and an obstacle lay within the cast time at
     walking speed — rendered deterministically — plus the coach sentence as the target. Until
     then: proposed targets only.
   - **9 EXCLUDED are all instants** (4 traps, Psychic Scream, Leg Sweep, Blind, Binding Shot, a
     stun) — coaches coach _anticipation_ of instants; the reactability gate (2026-08-22 ruling,
     ~75 % of accusations were instants) excludes them on purpose. Not a defect; a documented
     boundary of the type.

2. **`burst-into-mitigation` — coaches split "swap" vs "wait"; the predicate only speaks when a
   softer target existed.** Axes: swap 11, **wait 8**, swap-or-wait 4. Every "wait" sentence
   ("~5 s of Barkskin left", "parry DR had ~7 s left", "a few more seconds of patience") is UNKNOWN
   solely because the predicate's P3 (a softer target at that instant) is not stated — the coach's
   operative fact is the **remaining duration of the mitigation**, which the predicate does not carry
   although aura intervals give it. Also: 23/27 UNKNOWN is dominated by P3 (14) and P1 "was a burst
   cooldown actually opened vs sustained damage" (8). Two EXCLUDED are design boundaries: Touch of
   Karma _available_ is not a running mitigation; Blessing of Sacrifice / Vigilance are transfer
   effects excluded from `MITIGATION_TABLE` by spec (`mitigationData.ts:79`).
   - Upgrade path: a library burst opened into a target whose registered mitigation had ≤ N s left
     and no softer target — if such instances exist at scale, "wait" is a separate proposal, not a
     legend edit.

3. **`slow-defensive-response` — half the coach sentences are about DPS owners, and the type is
   healer-only.** 6/12 EXCLUDED on role (mage Alter Time, warrior Parry ×2, DK Icebound ×2, mage
   Dragon's Breath). BACKLOG #38 already records lifting the healer gate as a separate, measurable
   step; this is corpus evidence that the demand exists, not a defect in the healer version.

4. **`crisis-no-response` — 3/4 are DPS owners** (DK ×2, hunter) and the DPS branch emits nothing
   because `behaviorPriorGenerated.json` has no `|dps|` cells (GH #59, "made but not shipped").
   Same shape as 3.

5. **`cd-hoarded` — 9/9 UNKNOWN, all on timing.** Every coach sentence is "pressed too late / too
   low"; the predicate fires only when NO major defensive was spent within 5 s of the 40 % crossing.
   The coaches' bar ("nearer half health", "noticeably higher") is _earlier_ than 40 % + 5 s. Whether
   any of the nine would fire depends on the crossing time, which the sentences do not give. Lead:
   the predicate may be more lenient than the coaches, not stricter; only a library timing
   distribution (crossing → press delay) can say.

6. **`position-mistake` — 9/13 UNKNOWN**, mostly because `stayed-in` needs an HP drop and
   `missed-push` a drift distance that round-level sentences do not give; two hinge on whether
   `cd-out-of-range` treats a target behind a pillar / immune as "no valid target" (kps6m8bd53/11,
   n4760tpn40/24) — a predicate-semantics question answerable from code, deferred.

## What was withdrawn

- "The value gate was silently skipped for a third of the shipping signals" (GH #71 comment,
  2026-09-11) — withdrawn; see above.
- The 21-sentence ✅/❌ table in the HANDOFF stays as dated historical evidence; it is not replaced.
- No legend wording change is proposed from this pass. Wording changes remain a separate user
  ruling with a `PROMPT_VERSION` bump.

## Reproduce

```bash
COACH_CORPUS_DATA=tmp/skillcapped-vod python3 tools/coach-corpus/admission_audit.py --pool-only
COACH_CORPUS_DATA=tmp/skillcapped-vod python3 tools/coach-corpus/admission_audit.py \
  --decisions tmp/skillcapped-vod/admission-audit-2026-09-12.decisions.json
```

The decisions file is the hand-written half; the ledger is its merge with the frozen pool.
