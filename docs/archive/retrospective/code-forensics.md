# Code-level Forensics: Which line caused each bug

Companion doc: `incidents-forensics.md` (Incident narratives and your exact words).
This document answers only one question: **Where did the code go wrong.**

All paths are relative to the repo root, all `git show` commands can be directly verified.

---

# I. Type A: Same-second HP contradiction

## The Crime Scene

| Role | Location |
|---|---|
| **True culprit** | `packages/analysis/src/context/matchTimeline.ts` → `emitDmgSpikeEntries` |
| **Wrongly accused** | `packages/analysis/src/utils/cooldowns.ts:394` → `getUnitHpAtTimestamp` |
| **Fake fix touched** | `matchTimeline.ts` local constant `HP_SAMPLE_WINDOW_CRITICAL_MS = 1500` |
| **True fix added** | `packages/analysis/src/utils/cooldowns.ts` → `toRenderSecond` |
| **Fallback gate** | `packages/eval/src/quality/promptQualityCheck.ts` → `checkSameSecondHpConsistency` |

## Ironclad proof: why the fake fix physically cannot work

`packages/analysis/src/utils/cooldowns.ts:394`, current source code unchanged:

```ts
export function getUnitHpAtTimestamp(
  unit: ICombatUnit,
  timestampMs: number,
  maxDtMs = 10_000,
): number | null {
  const closestAction = binarySearchClosest(      // ①  First find nearest sample
    unit.advancedActions,
    timestampMs,
    (a) => a.logLine.timestamp,
  );

  if (!closestAction) return null;
  if (closestAction.advancedActorId !== unit.id) return null;
  if (closestAction.advancedActorMaxHp <= 0) return null;

  const dt = Math.abs(closestAction.logLine.timestamp - timestampMs);
  if (dt > maxDtMs) return null;                  // ②  Then use radius to decide accept/reject

  return Math.round(                              // ③  Return value depends only on ①
    (closestAction.advancedActorCurrentHp / closestAction.advancedActorMaxHp) * 100,
  );
}
```

**`maxDtMs` only appears in ②, and the return value depends only on ①.**

`3cd5342` changed exactly this `maxDtMs`. The most it can do is turn a value into `null` —
**it can never change "which sample is retrieved."** There is no causal pathway between the parameter it fixed and the symptom it claimed to fix.

This is not a subtle inference — it's a conclusion reachable by reading five lines of code. But the commit message told a complete story
about a "documented invariant broken on one side," and the story itself was **true** —
`HP_SAMPLE_WINDOW_CRITICAL_MS` was indeed only added to the STATE side.
**It diagnosed a real inconsistency that genuinely existed, then incorrectly concluded it was the cause of the symptom.**

## The real culprit

In `emitDmgSpikeEntries`, sampling uses **fractional seconds**:

```ts
getUnitHpAtTimestamp(targetUnit, matchStartMs + pw.fromSeconds * 1000, …)
//                                              ^^^^^^^^^^^^^^ fractional
```

While the `[STATE]` side samples at **integer seconds**. Two different points in time retrieve two different
`advancedAction`s, and then **`fmtTime` renders them as the same display second**.

```
Real time  12.4s → retrieves sample@12.4 → HP 2%   → renders as "0:12"
Real time  12.0s → retrieves sample@12.0 → HP 88%  → renders as "0:12"
                                                          ^^^^^^ same second, two numbers
```

## The fix

```ts
// packages/analysis/src/utils/cooldowns.ts
export function toRenderSecond(seconds: number): number {
  return Math.floor(seconds);
}
```

Call sites:

```diff
+ const fromSec = toRenderSecond(pw.fromSeconds);
+ const toSec   = toRenderSecond(pw.toSeconds);
  const hpFrom = targetUnit
    ? getUnitHpAtTimestamp(
        targetUnit,
-       matchStartMs + pw.fromSeconds * 1000,
+       matchStartMs + fromSec * 1000,
```

**Nine lines of code.** The earlier fake fix touched two files, added 6 tests, and wrote a 40-line commit message.

## Before/after numbers

```
Type A same-second HP contradiction   26/50 encounters, 33 instances  →  0/50 encounters, 0 instances
Impact: 45/50 encounters had diffs, all confined to DMG SPIKE lines, zero collateral changes
```

## Lesson written into the index

`docs/predicate-index.md`, the `HP_SAMPLE_RADIUS_MS` entry's note:

> 3000 ms everywhere. **Narrowing it "for freshness" was tried and reverted:
> the radius only accepts or rejects a sample, it never changes which sample you get.**

The `getUnitHpAtTimestamp` entry:

> Always pass `HP_SAMPLE_RADIUS_MS` explicitly — **the default parameter is much looser.**

(Note the default is `10_000`, while the project standard is `3000`. This default value is itself a trap.)

---

# II · Type B: p50 > p90 (the most elegant one)

## Crime scene file

Entirely within one file: `packages/analysis/src/benchmark/metrics.ts`.

## Three pieces of code that only cause trouble together

### ① Where NaN is produced (~line 187, pre-fix)

```ts
for (const d of unit.damageIn) {
  const t = (d.logLine.timestamp - matchStartMs) / 1000;
  const bi = Math.min(Math.floor(t / WINDOW_SECONDS), bucketCount - 1);
  buckets[bi] += Math.abs(d.effectiveAmount);
  //             ^^^^^^^^^^^^^^^^^^^^^^^^^^^ effectiveAmount may not exist
  //                                          Math.abs(undefined) === NaN
}
```

**`damageOut` in the same file already had a guard:**

```ts
"effectiveAmount" in d      // ← damageOut has it, damageIn doesn't
```

One file, two nearly symmetrical loops, **only one with a guard.**

### ② The silently failing sort (lines 89–102, pre-fix)

```ts
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
  //     ^^^^^^ indexes purely by position, does not check content at all
}

function toPercentiles(values: number[]): Percentiles {
  const s = [...values].sort((a, b) => a - b);
  //                          ^^^^^^^^^^^^^ returns NaN for NaN
  return { p50: percentile(s, 50), p75: …, p90: …, p95: … };
}
```

**The JS spec leaves behavior undefined when a comparator returns NaN; V8's choice is: no error, silently leave a partially unsorted array.**

So `percentile()` indexes by position and gets the Nth element in a mis-ordered array, not the Nth percentile.

### ③ The third consumer (line 276, pre-fix)

```ts
const sorted = [...used].sort((a, b) => a - b);   // cdFirstUse also has one
```

The same mistake, same file, written twice.

## Why it is extremely hard to detect

Verbatim from the commit message:

> A single NaN can make p50>p90, and **NaN becomes null via `JSON.stringify` and may not land on the selected index**
> — bad data looks like "all normal numbers, just in the wrong order."

**There is no NaN visible in the output file `benchmarks.json`.** What you see is a bunch of reasonable numbers,
just in the wrong arrangement. And symptoms only manifest when the mis-ordering happens to cross the index positions for p50/p90.

```
28 specs  →  4 corrupted
              ├─ 2 visible inversions (p50 > p90)
              └─ 2 silent drifts: Feral Druid / Restoration Shaman
                 happened to remain monotonic after mis-sorting, never showed any symptoms
```

**Half the corruption is invisible.**

## The fix: create a single-source predicate

```ts
// packages/analysis/src/utils/stats.ts — new file
export function toSortedFinite(values: readonly number[]): number[] {
  const finite = values.filter((v) => Number.isFinite(v));   // filter first, then sort
  finite.sort((a, b) => a - b);
  return finite;
}
```

All three call sites changed to `toSortedFinite(...)`.

## A second bug caught during the fix

An additional guard was added in the same hunk, defending against something entirely different:

```ts
// When bi is not finite, buckets[NaN] writes a non-index property — silently dropped on spread, not accumulated.
if (!Number.isInteger(bi) || bi < 0) continue;
```

`buckets[NaN] += x` in JS **doesn't throw** — it attaches a string property named `"NaN"` to the array.
`[...buckets]` spread silently drops this property.

**The result is not a wrong calculation — damage vanishes into thin air.** This is another complete silent failure, fixed as a side effect.

## Before/after numbers

```
Type B percentile inversion   14/50 encounters  →  0/50 encounters
benchmarks.json recalculated with fuzz-1000: 143 percentile blocks, 0 inversions
```

## The entry in the index

> Plain `sort((a, b) => a - b)` over a pool containing NaN silently leaves the array
> unordered — **that is what produced `p50 214k | p90 65k` in 11 of 50 matches.**

---

# III · Type D: Same spell, two cooldown values

## Crime scene file

`packages/analysis/src/utils/deathOutcomeAnalysis.ts`

## The first source of truth (pre-fix, from line 48)

```ts
const EXTERNAL_DEFENSIVE_SPELLS: Record<
  string, { name: string; cooldownSeconds: number; specs: CombatUnitSpec[] }
> = {
  '102342': {
    name: 'Ironbark',
    cooldownSeconds: 45,          // ← hand-written constant
    specs: [CombatUnitSpec.Druid_Restoration],
  },
  '33206': { name: 'Pain Suppression', cooldownSeconds: 180, … },
  '47788': { name: 'Guardian Spirit',  cooldownSeconds: 180, … },
  …
};
```

Consumption point (pre-fix, line 289):

```ts
if (!isAvailableAt(teammate, spellId, spell.cooldownSeconds, atSeconds, matchStartMs)) continue;
//                                    ^^^^^^^^^^^^^^^^^^^^^ uses the local table's 45
```

## The second source of truth

Main path: `extractMajorCooldowns` → `spellEffectData` + talent modifiers → **65s**

The `[RES]` ledger rendering uses this source.

## Result: the same prompt contradicts itself

```
0:52  Ironbark cast

Local table:  0:52 + 45 = 1:37  →  "available" at 1:53
Ledger:       0:52 + 65 = 1:57  →  "still on cooldown (7s)" at 1:53

So in the same prompt:
  [RES]          cd:Ironbark(7s)
  MISSED OPTIONS "had Ironbark available, caster was free"
```

**Both sides' arithmetic is correct. What's wrong is that they aren't using the same number.**

## The fix: not changing 45 to 65

Changed to have the availability determination **query the ledger for the already-resolved value**:

```ts
/**
 * Returns the **resolved** cooldown seconds for a given unit and spell (i.e., the value
 * used by the `[RES]` ledger rendering, including talent modifiers). When provided,
 * this takes priority over the constants in EXTERNAL_DEFENSIVE_SPELLS below.
 *
 * Why this must be passed in: the local table used to have its own cooldownSeconds,
 * maintained independently from the main path, producing two values for the same spell.
 * Evidence (2026-07-20, ord 041): Ironbark local table says 45s, ledger resolves to
 * 65s; after 0:52 cast, at 1:53 this block says "available" while the same-second
 * ledger writes `cd:Ironbark(7s)` — the same prompt gives opposite conclusions for
 * the same cooldown.
 */
resolvedCooldownSeconds?: (
  unit: ICombatUnit,
  spellId: string,
) => number | undefined,
```

Consumption point:

```diff
- if (!isAvailableAt(teammate, spellId, spell.cooldownSeconds, atSeconds, matchStartMs)) continue;
+ // Cooldown value prefers the **resolved** source (same source as [RES] ledger, includes talent modifiers);
+ // falls back to local table constant only when unavailable. See root cause explanation at this function's signature.
+ if (!isAvailableAt(
+       teammate, spellId,
+       resolvedCooldownSeconds?.(teammate, spellId) ?? spell.cooldownSeconds,
+       atSeconds, matchStartMs)) continue;
```

**Why not just change it to 65:** because the next time talents change, 65 will be wrong too.
Fixing the constant fixes this one instance; connecting to the right data source fixes all future instances.

## Before/after numbers

```
Spurious "available" claims: 1/50 encounters  →  0/50 encounters
```

## The fallback gate

`packages/eval/src/quality/promptQualityCheck.ts` → `checkCooldownLedgerConsistency`

The index note reveals that this gate itself had a pitfall:

> Ownership-aware: **mirror comps make name-only matching 67% false-positive.**

(Mirror comps — both teams running the same spec — cause name-based matching to produce 67% false positives. The gate itself was fixed once.)

---

# IV · `"1\r" !== "1"`

## Crime scene file

`packages/parser/src/api.ts` → `GladLogParser.push()`

## Pre-fix source

```ts
public push(rawLine: string): void {
  if (rawLine.trim() === "") {
    return;
  }
  this.linesTotal++;
  const parsed = parseLine(rawLine, { timezone: this.timezone });
  if (parsed === null) {
    this.linesDropped++;
  } else {
    this.segmenter.push(parsed, rawLine);
  }
}
```

Note that `rawLine.trim()` **is only used for the empty check** — what gets parsed and what gets hashed is the **untrimmed original**.

## Why it detonates precisely on feign death

Game logs are CSV. After splitting on `\n`, the CRLF `\r` lands at the **tail of the last field on every line**.

`UNIT_DIED`'s last field happens to be the feign death flag:

```
UNIT_DIED,...,0        ← real death
UNIT_DIED,...,1        ← feign death (Hunter's Feign Death)
UNIT_DIED,...,1\r      ← what's actually read
```

The check code reads `flag === "1"`; `"1\r"` does not equal `"1"`, so **all feign deaths entered `deathRecords`**.

> sample round showed **3 phantom [DEATH] blocks for one BM Hunter**

## The second victim: hash

The desktop's `tailReader` **already strips 0x0d**.
Only the eval corpus path doesn't. So the same match **produces different match IDs on the two paths**.

This is two faces of the same bug: **one corrupts semantics, the other corrupts identity.**

## The fix

```diff
  public push(rawLine: string): void {
+   // CRLF logs split on \n retain trailing \r, contaminating the last parameter of every event
+   // (confirmed: UNIT_DIED feign death flag "1\r" !== "1", all Feign Deaths recorded as real deaths)
+   if (rawLine.endsWith("\r")) {
+     rawLine = rawLine.slice(0, -1);
+   }
    if (rawLine.trim() === "") {
```

Placed at the very top of the function — **both parsing and hashing come after this line**, fixing both faces at once.

The emphasis in the commit message is not filler:

> normalizes trailing \r **before parse AND before rawLines hashing**

## Test

```ts
it("trailing \\r (CRLF logs split on \\n) is stripped before parsing and hashing", () => {
  // UNIT_DIED's feign death flag is the last parameter; trailing \r makes "1\r" !== "1", feign death misclassified as real death
  const run = (suffix: string) => { … };
  // Assert: with \r and without \r produce completely identical output (including hash)
});
```

---

# V · ` ```json ` fence: zero-tolerance parsing

## Crime scene code

One line in the desktop main process:

```ts
JSON.parse(raw.trim())
```

The model returned a **perfectly compliant JSON array**, just wrapped in a markdown fence:

````
```json
[{"category":"…","text":"…"}]
```
````

`raw.trim()` removes leading/trailing whitespace, not fences. `JSON.parse` throws, an entire good analysis is classified as bad-json,
and falls back to deterministic display. The user sees "model returned format error."

## The more hidden second occurrence

> The deep-dive path has the same disease but more hidden — **when fenced, `auditDeepDives` can't get the array, and deep dives silently disappear.**

The first occurrence shows an error to the user; the second **shows no error — the feature is just gone**.

## The most painful point: the answer was already in the repo three weeks earlier

Verbatim from the commit message:

> The eval script comments already said "fault tolerance: response may include ```json fence" —
> **the knowledge existed in the repo but the product path didn't know about it** — exactly the rot that CLAUDE.md's single-source predicate rule is meant to prevent.

**The eval tooling had already hit this pitfall and documented it in comments. The product code didn't know. Same repository.**

## The fix: single source + negative contract locked down

New file `packages/analysis/src/analysis/parseModelJson.ts`:

```ts
/** ```json … ``` / ``` … ``` (allows prose before and after). */
const FENCE = /```(?:json|JSON)?\s*\n([\s\S]*?)\n?```/;

/**
 * Parse a JSON **array** returned by the model. Returns the array on success, null on any failure.
 * Callers handle null via their own fallback — don't try/catch JSON.parse yourself.
 */
export function parseModelJsonArray(raw: string): unknown[] | null {
  for (const c of candidates(raw)) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}
```

**The fault-tolerance boundary is explicitly locked down in the docstring, with negative tests:**

```
- Truncated JSON cannot be salvaged → null (returning half is worse than fallback)
- Top-level is an object → null (the contract is array; this is a real violation, not format noise)
- When a fence contains an object, do not extract an inner array to salvage it
  (the guard must apply to the payload after fence stripping)
```

The comments also state a design principle:

> Only **locate**, don't repair — **repairing means fabricating content on behalf of the model.**

## Consumption point convergence

> Both desktop call sites and both eval audit scripts **all changed to import**; no second copy of fence-handling logic remains in the repo.

## Before/after numbers

```
40 real-corpus matches / agy flash:  pre-fix 39/40  →  post-fix 40/40
1 fenced case salvaged; 0 cases unsalvageable by either version
claudeCli consistently reproduced per-match; some matches 3/3 all fenced
```

**Note the number 39/40.** Looks small in isolation — but it's "consistently reproduced per-match":
some matches trigger 100%. For that user, this feature was **permanently broken**, not occasionally broken.

---

# VI · 12MB table compiled into JS source

## Root cause type

Vite by default compiles `import data from './x.json'` into a **JavaScript object literal**.
A 12MB JSON becomes 12MB of JS source code — requiring AST parsing, evaluation, and object graph construction.

`JSON.parse("…")` is an order of magnitude faster than an equivalent object literal (the engine has a dedicated fast path).

## Code locations and before/after numbers

| Commit | Location | Numbers |
|---|---|---|
| `ea8ef76` | Main process materializes entire object graph before IPC | Opening one encounter **1244ms → 37ms**, main heap delta **207MB → 0** |
| `7b69443` | Top-level await directly importing large table | Renderer first screen no longer serially waits for **12MB** |
| `67ddc95` | `spellEffectGenerated` 295KB `.ts` object literal | Migrated to `.json`; noted as "**the last piece of the same disease as the 22s incident**" |
| `331b1f1` | Icon table storing strings per-entry | Dictionary-encoded 1.5MB → 780KB (41,707 entries with only **7,110 distinct icon names**) |
| `eee7006` | GCD swimlane full reconciliation | Post-windowing steady-state reconciliation reduced **~100×** |
| `bba4ed9` | Timeline hover rebuilding Bézier strings every frame | min/max downsampling + `useMemo` |
| `2d7ecc7` | Playback sampling linear scan | Switched to binary search, point-for-point behavioral equivalence |

## Two items that aren't the same class but are equally absurd

```
d8c1b97  renderer production build enable minify
         — electron-vite defaults to false; 3.6MB raw bundle was never minified
```

**This is a configuration default, not a code bug.** From day one through July 26, every installer's
frontend code was shipped unminified. No test would ever go red because everything functioned correctly.

```
bb1a33b  analysis.test pre-warm deepDive module
         — on slow CI machines, on-demand import counted 12MB table loading toward the 5s test timeout
```

**The performance optimization turned tests red.** Lazy loading shifted the 12MB load time into one test's timing.

---

# VII · Predicate Index: Turning "same fact, two implementations" into a CI red light

Incident One (Types A/B/D) and Incident Five (fence) are fundamentally the same disease: **the same fact, implemented twice in two places.**
The final solution is not "be more careful" — it's a table plus a test.

## `docs/predicate-index.md` — currently 64 entries

> ⚠️ `CLAUDE.md` says 54 entries; that's already stale. The actual count is 64.

| Section | Count | Examples |
|---|---|---|
| Time and render grid | 3 | `fmtTime` · **`toRenderSecond`** (product of Incident One Type A) |
| HP sampling | 2 | **`HP_SAMPLE_RADIUS_MS`** · `getUnitHpAtTimestamp` |
| Cooldown availability | 4 | `cdAvailableAt` (product of Incident One Type D) |
| Position and geometry | **17** | The largest section |
| Order statistics | 2 | **`toSortedFinite`** · `medianFinite` (product of Incident One Type B) |
| Thresholds | 3 | `DMG_SPIKE_THRESHOLD` etc. |
| Classification and name tables | 10 | `specToString` · `ccSpellIds` etc. |
| Format and markers | 3 | `PLACEHOLDER` · `fmtFactNum` |
| Gate-rule side | 10 | All four hard gates are here |
| Corpus archiving | 10 | |

**Four sections were directly spawned by incidents** (the bold ones).

## The enforcement half: `packages/eval/test/predicateIndex.test.ts` (682 lines)

This test does five things:

1. **Imports every predicate in the table by file path** — rename or delete → CI red
2. **Parses both EN and CN versions** — inconsistent predicates between versions → CI red
3. **For predicates that can't share an export, asserts "derived" rather than "retyped literal"**
4. **Asserts that `makeRng` and `IndexEntry` each have exactly one declaration in the entire eval tree**
   (original: *"the only way to pin a type, which the compiler erases"*)
5. **End-to-end asserts that producer/gate are inverses of each other**, each with a **reverse control**, preventing assertions from vacuously passing

Item 5 is the most critical. Example:

> A window rendered via `fmtTime` + `renderedWindowSeconds` must pass
> `checkWindowSpanConsistency`; percentiles extracted via `toSortedFinite` must pass
> `checkPercentileMonotonicity`; a `HEALER_TRAINED` claim produced by **real**
> `computeOwnerPositionEvents` and rendered by a **real** formatter must pass a **real** gate
> — every assertion includes a reverse control.

## The "Not Yet Unified" section — currently empty

On launch day, 5 registered violations were recorded, **all closed the same day**: 4 became shared exports, 1 was determined to not be a duplicate at all.

The most interesting one:

> **"Maximum plausible control distance" was three numbers claiming to be the same fact.** It's actually two facts:
> `CC_MAX_CAST_RANGE_YARDS` (40 — whether the control can reach) and
> `CC_MAX_PLAUSIBLE_RANGE_YARDS` (45 — whether this recalculated distance is trustworthy),
> the latter derived from the former, so order cannot drift.
> **The gate-rule's private 50 yards was deleted: it was looser than the producer's own suppression threshold, so
> `G6_IMPOSSIBLE_CC` could never trigger.**

**A gate rule that, because its threshold was looser than the object it checks, has been dead since launch.**
Tightening it is behavior-neutral on today's corpus: of 141,237 rendered control-distance claims, 0 exceed 50 yards,
0 exceed 45 yards (maximum 44.7).

## There's also a section specifically for "these are not duplicates — don't try to unify them"

Because **over-unification is also a bug**. The longest entry explains why the producer and gate **intentionally** use different sampling:

> The gate's sampling moments are a **strict superset** of the producer's, with a looser gap tolerance, and
> `getUnitPositionAtTime`'s gap **only accepts or rejects a sample, it never changes its value** —
> so `gateMin ≤ producerMin` always holds, and the gate's one-sided test
> ("the claimed distance is closer than what was physically observed") is the correct expression in this direction, not a workaround.
> **Having the producer adopt the gate's gap is actually a regression**: `INTERP_MAX_GAP_MS` is the
> grounding guard that kills "interpolating a midpoint position out of thin air" (it once fabricated a false 0.4-yard melee claim).

Note the shape of this reasoning is **identical** to Incident One: "the gap only accepts or rejects a sample, it never changes its value."
**The same insight, encountered independently on two different predicates.**

---

# Cross-cutting checklist: All code forms of "silent failure"

| # | Code | Mechanism of silence |
|---|---|---|
| 1 | `flag === "1"` vs `"1\r"` | String comparison fails → takes else branch, no exception |
| 2 | `[...v].sort((a,b)=>a-b)` containing NaN | V8 doesn't error, leaves a partially unsorted array |
| 3 | `buckets[NaN] += x` | Attached as a string property, silently dropped on `[...]` spread |
| 4 | `JSON.parse` throws → `auditDeepDives` can't get the array | Deep-dive feature disappears entirely, no notification |
| 5 | `EXTERNAL_DEFENSIVE_SPELLS` constant drift | Both sides' arithmetic is correct, conclusions are opposite |
| 6 | Gate threshold 50 > producer threshold 45 | Gate never triggers, looks like "never violated" |
| 7 | `electron-vite` minify defaults to `false` | Everything works correctly, package is just 3× larger |
| 8 | Whitelist upstream missing entries | Downstream rule doesn't trigger ≡ "this problem never happened" |

**Eight forms, one common thread: erroneous output and correct output look identical to the observer.**

This is why all the gates that were ultimately shipped are **"re-parse the already-rendered text and independently recalculate"**,
rather than unit tests — unit tests are written under the same (potentially wrong) assumptions.

---

# Commands for verification

```bash
cd ~/code/gladlog

# I · Type A: ironclad proof
sed -n '394,430p' packages/analysis/src/utils/cooldowns.ts     # getUnitHpAtTimestamp
grep -B10 -A5 'export function toRenderSecond' packages/analysis/src/utils/cooldowns.ts
git show 3cd5342                                                # Fake fix (see third-to-last line "Not done: end-to-end A/B")
git show 0e13264                                                # Real fix + 26/50→0/50

# II · Type B: NaN
git show 0e13264^:packages/analysis/src/benchmark/metrics.ts | sed -n '89,102p'   # pre-fix
sed -n '1,45p' packages/analysis/src/utils/stats.ts                               # post-fix
git show 0e13264 -U6 -- packages/analysis/src/benchmark/metrics.ts                # guard diff

# III · Type D: Ironbark
git show c820ad4^:packages/analysis/src/utils/deathOutcomeAnalysis.ts | sed -n '48,56p'
git show c820ad4 | grep -B12 -A12 resolvedCooldownSeconds
git show dbe61bd                                                # The overturned intermediate conclusion

# IV · CRLF
git show ac35614^:packages/parser/src/api.ts | sed -n '61,73p'   # pre-fix
git show ac35614 -- packages/parser/src/api.ts

# V · Fence
git show 132b3da | grep -A40 'parseModelJson'
cat packages/analysis/src/analysis/parseModelJson.ts

# VI · Performance
git log --oneline --since=2026-07-25 --until=2026-07-27 | grep perf

# VII · Predicate index
cat docs/predicate-index.md
npm test --workspace=packages/eval -- predicateIndex
```
