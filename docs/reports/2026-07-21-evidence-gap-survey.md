# Evidence Gap Survey (2026-07-21)

**Origin**: User feedback indicated "there's barely any evidence; a lot gets gated or discarded." This document turns that impression into numbers.

**Corpus**: `manifest-fullscale`, **1245 matches, 100% healer perspective** (Mistweaver 334 / Disc 263 /
Preservation 181 / Resto Shaman 161 / Holy Priest 119 / Holy Paladin 97 / Resto Druid 90),
run `2026-07-20-postfix-anchor` @ `92f96d2`.

**Methodology Warning (Important)**: When measuring section coverage based on guessed string patterns, **5 out of 5 attempts were wrong** (see §4 for details). All numbers in this document have either been verified against emitter source code string literals or extracted backwards from the corpus. **Please maintain this discipline when taking over.**

---

## 1. Real Evidence Gaps (Ranked by Impact)

> **Status has been fully updated in §6.5** — The table below shows raw observations at survey time; all five items **now have conclusions item-by-item**.
> Do not use this table alone to decide what to do next. Summary:

| Gap                                   | Coverage            | Conclusion (details in §6.5)                                                     |
| ------------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| Enemy major cooldowns `none tracked`  | **805 / 1245 (65%)**| ✅ Fixed in `bf17ccf` → 1/1245                                                   |
| trinket state `never observed`        | 1094 / 1245 (88%)   | ⚠️ Root cause located; **fix requires a product decision, left to humans**       |
| `[MISSED PURGE OPPORTUNITY]` empty    | 954 / 1245 (77%)    | ✅ Fixed deterministic half in `2f1954c` → 822 lines up to 2251; rest is curation|
| `[CONTESTED]` empty                   | 1069 / 1245 (86%)   | ⚠️ Same root as trinket, deferred together to humans                             |
| `POSITIONING` section missing         | 429 / 1245 (34%)    | ❌ Not a bug, coverage boundary (healer keeping distance = correct)              |

### P1 — Enemy Cooldown Asymmetry (Root cause located, mechanism ready)

```
Friendly: classMetadata enumerates full ability kit → mark uncast ones as [UNUSED]
      cooldowns.ts:514  classMetadata.find(c => c.unitClass === unit.class)
      cooldowns.ts:774  neverUsed: casts.length === 0

Enemy:    only lists what was actually cast in this match; never cast → completely disappears from list → "none tracked"
      enemyCDs.ts:115   for (const cast of enemy.spellCastEvents)   ← purely observation-driven
      enemyCDs.ts:152   if (offensiveCDs.length > 0)                ← if empty, drops the whole player
      resourceSnapshot.ts:141-154  fallback prints "none tracked"
```

Friendly looks like this:

```
<cooldowns>Divine Shield [270s], Blessing of Protection [285s] [UNUSED],
           Blessing of Spellwarding [165s] [UNUSED], Avenging Wrath [116s, 2 Charges], ...
```

Enemy looks like this:

```
<cooldowns>none tracked</cooldowns>
```

**Why this matters most**: For a healer coach, the most valuable piece of enemy information is **"what does he still have available?"** Currently, the coach
can say "you held onto Guardian Spirit without using it", but cannot say "he still has Trueshot in hand" — yet the latter is the half that
dictates how to play the next window.

**Closing the evidence chain**: In tonight's n=10 calibration, multiple independent judges gave `sufficiency` a score of 3, with almost identical reasoning
— "2 out of 3 enemies had none tracked". At the time, I recorded it as a **judge observation** without tracing upstream. It is actually a
**product evidence gap** correctly caught by judges.

**Fix**: Symmetrize — enemy side also uses `classMetadata` to enumerate abilities tagged Offensive, marking unobserved casts as
`[UNUSED]`. No new data sources needed; `enemy.spec` / `enemy.class` are on the same line.

**Known limitation**: `classMetadata` is indexed by **class** rather than spec, so it lists all major CDs for that class, including
those a spec might not have talented. Friendly currently operates at this precision; it is not a new problem, but worth deciding whether to narrow down during implementation.

---

## 2. Truncation (Caps Are Genuinely Trimming Material)

| Cap                     | Value | Matches Hitting Cap  |
| ----------------------- | ----- | -------------------- |
| `MAX_KILL_WINDOW_LINES` | 6     | **264 / 1245 (21%)** |
| `MAX_CONTESTED_FACTS`   | 2     | 28                   |

`[KILL WINDOW]` hits **exactly 6** in one-fifth of matches, with maximum value being 6 — indicating things are being cut off,
but whether what is cut is valuable requires examining the discarded portion before judging.

There are 6 other hardcoded truncations whose impact has not been individually audited:

```
timelineHelpers.ts:878      .slice(0, 2)
candidateFindings.ts:409    .slice(0, 2)
criticalMoments.ts:790      .slice(0, 5)
crisisEvents.ts:42          .slice(0, 3)
buildExemplarLedPrompt.ts:15 .slice(0, 8)
dispelAnalysis.ts:1254      .slice(0, 8)
```

---

## 3. Folded Sections

`[MINOR DISPELS] ... (low-priority, folded)` — **5079 lines, 1238 / 1245 matches (99%)**.
`matchTimeline.ts:1868-1925`: Low/medium dispels filtered out by F163 are not placed on the timeline individually, but folded into a single line grouped by
(source, dispel spell).

**Before deciding, examine**: what was actually folded away. If it's all trivial minor dispels, folding is correct (it was designed
for noise reduction); if it contains coachable missed dispels, then evidence is being lost. ~~Not expanded this round.~~ **Expanded, see §6.5 —
26% of the 8696 entries are offensive dispels our team actually landed.**

---

## 4. Looks Broken, but Actually Isn't (Do Not Pursue)

During the survey, 5 potential false alarms were caught by verifying numbers against source code. Recorded one by one to save the next person from repeating:

| Phenomenon                                                                                                           | Looks like                         | Reality                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `MISSED PUSH` 0/1245                                                                                                 | Dead feature                       | **DPS positioning detector running on pure healer corpus** — requires "offensive CD available but disengaged", conditions healers rarely meet |
| `OFFENSIVE CD OUT OF RANGE` 0/1245                                                                                   | Dead feature                       | Same as above                                                                                                             |
| rotScan `SPELL_DISPEL` column reports 69 unclassified, including core dispels like `Purify`/`Dispel Magic`/`Greater Purge`| Whitelist heavily decayed          | **Scanned wrong directory** — `dispelAnalysis.ts` uses a **per-spec dispel capability table** (who can dispel what type), not `SPELL_CATEGORIES` table lookups |
| rotScan `SPELL_AURA_APPLIED` column reports 386 unclassified                                                         | CC table heavily decayed           | Top entries are `Flame Shock` 5765x, `Judgment` 5326x — **DoTs/debuffs were never meant to enter CC table**; requires manual ID-by-ID review to find real gaps |
| `KILL SEQUENCE` 0/1245                                                                                               | Section never appears              | **My search string added square brackets**; real header is `KILL SEQUENCE` (`timelineHelpers.ts:911`), actually 250/1245 |

**Lesson**: Section coverage must be **extracted backwards from corpus** or **verified against emitter string literals**, not guessed from memory.
All numbers in §1–§3 of this document were obtained this way.

---

## 5. Section Coverage (Top-Level Headers Extracted Backwards from Corpus)

```
MATCH TIMELINE               1245/1245  100%
PURGE RESPONSIBILITY         1245/1245  100%
MATCH FACTS                  1245/1245  100%
KILL SEQUENCE                 250/1245   20%
DEATHS WITH MISSED OPTIONS    165/1245   13%
ABILITIES INTO IMMUNITY/DR    112/1245    9%
```

The three low-coverage sections are not necessarily defective — `DEATHS WITH MISSED OPTIONS` only appears when "someone died while defensive
options were available", and 13% might be the true occurrence rate. **Must be compared against an oracle to judge**, which was not done in this round.

---

## 6. Unchecked Items (Deferred to Next Round)

- **Finding-level gates**: `candidateFindings.ts` has 22 instances of `filter`/`return []`/`continue`;
  how many candidates were generated and survived was not measured. Measuring requires instrumentation.
- **Catalog silent drops**: `spellEffectData` / `isOffensiveSpell` `continue` on lookup failure
  (`enemyCDs.ts:119-121`), silently dropping unknown amounts. rotScan is not suited for measuring this (see §4).
- **How many real CDs are excluded by `MIN_CD_SECONDS = 30` / `MAX_CD_SECONDS = 360`**.
- Sampled review of §3 folded content.

---

## 6.5 Item-by-Item Resolution Results (Night of 2026-07-21, Proceeding via "Fix One by One")

### P1 Enemy Abilities Kit — ✅ Fixed and Deployed (`bf17ccf`)

| Criterion                                  | Pre-fix         | Post-fix       |
| ------------------------------------------ | --------------- | -------------- |
| Matches containing `none tracked`          | 805 / 1245(65%) | **1 / 1245**   |
| Enemy ability entries Lost / Added         | —               | **0 / +15073** |
| token p50                                  | 6486            | 6553(+1%)      |

Layer A three gates rerun all green. **Made one mistake midway**: first version did direct replacement instead of union,
losing 1418 offensive burst CD entries (`Frozen Orb` 203, `Army of the Dead` 109, `Shadow Dance` 84...), caught only by line-by-line comparison of **content** —
looking only at the pretty `972 → 1` number would have shipped an invisible regression.

### P2 `[KILL WINDOW]` Cap — ❌ No Change Needed

264 matches maxed out at the cap; 235 matches genuinely had omissions, totaling 595 omitted windows — **all backed by rollup aggregations**:

```
[+N more windows omitted (least free time): your damage Xk total, CC cast in M of N]
```

Retention rule is sorted descending by `ownerFreeSeconds` (most free time = most coachable), median omission is only 2.
Cap design is reasonable, **not silently dropping evidence**.

### P3 trinket `never observed` 88% — ⚠️ Root Cause Located, **but Fix Is a Product Decision, Left Untouched**

Ruled out two hypotheses:

- **Not a catalog gap** — Verified 228 players were 100% Gladiator (`336126`), which was already in
  `PVP_TRINKET_SPELL_IDS`. (`getTrinketStateAtTime` did miss Adaptation `195756`
  and Relentless's "no active trinket" semantics, but these account for 0% of the corpus, with no practical bite.)
- **Not a lack of evidence** — `[OPPORTUNITY]` is only emitted when trinket is **unavailable or unknown**; when trinket is available,
  `killWindowTargetSelection` proactively `continue` skips it (available = they can just trinket out, not an opportunity).

**Real root cause is inference, and once again the asymmetry from P1:**

```
Friendly (matchTimelineSections.ts): lastUse === undefined  → available
Enemy (getTrinketStateAtTime):       lastUseSeconds === null → null (unknown)
```

Arena starts with cooldowns reset; "no usage observed in this match" should imply "trinket in hand". If this interpretation holds,
those opportunities **should never have been reported in the first place**.

**Impact scope — why it was left untouched:**

```
[OPPORTUNITY] Total 1491 lines
  trinket on CD (confirmed)         67 lines
  state unknown (backed by unknown) 1424 lines = 95.5%
```

Fixing this inference would **delete 95% of the section**. This goes in the opposite direction of the "too little evidence" complaint,
and relies on my domain understanding of arena CD reset mechanics rather than explicit facts in code — **this is a product call, not a bug fix, left for humans to decide**.

However, we cannot pretend everything is fine: if the inference holds, those 1424 lines are **implying non-existent opportunities**,
which is worse than missing evidence. `[CONTESTED]` is similarly affected (unknown 151 / on CD 46 / available 7).

### POSITIONING Missing 34% — ❌ Not a Bug, Coverage Boundary

429 matches have no POSITIONING section; **424 of them have coordinate-derived distance data** (only 5 matches genuinely lacked advanced logs),
and **not a single match had "no burst window"**. Thus, it is not a data issue.

Root cause is `CLOSE_RANGE_YARDS = 12`: STAYED_IN / KITED only classifies owners who **were already within 12 yards at burst start**.
A healer playing well should be at 20–40 yards, so they are classified as neither "stayed in" nor "kited out",
producing no events.

**This is correct behavior, but "maintained distance throughout" is currently not expressed as anything** — whether to articulate this as positive
evidence is a product enhancement, not a bug fix.

### `[MISSED PURGE OPPORTUNITY]` Empty 77% — ✅ Fixed Deterministic Half (`2f1954c`), Other Half Is a Product Decision

The number "77% empty" is **misleading in itself**. Breakdown:

| Category                                   | Matches | Nature                                                                 |
| ------------------------------------------ | ------: | ---------------------------------------------------------------------- |
| owner lacks offensive purge tools          | **702** | Intentionally gated by B117, **correct** — only report what owner can do |
| owner can purge, has output                |     288 | Normal                                                                 |
| owner can purge, whitelist missed          | **255** | ← Real gap                                                             |

So the true gap is 255 matches (20%), not 954 matches.

**Root cause is four gates, the fourth being strictest and broken.** For a missed purge to reach the prompt, it must pass:

```
① spellEffectData[id].dispelType === "Magic"      (DB2 mining covers only 123 out of 3560 entries)
② SPELL_CATEGORIES[id].type → Critical/High       (Uncollected → Low → Discarded)
③ canOffensivePurge(owner)                        (B117, correct)
④ HIGH_VALUE_PURGEABLE_BUFFS.has(id)              (matchTimeline.ts:183 handwritten 9 entries)
```

**Checking these 9 items one by one, 7 could never reach the emitter** — ①② filter them out first:

| Whitelist Entry                                                      | dispelType | Category        | Emittable? |
| -------------------------------------------------------------------- | ---------- | --------------- | ---------- |
| Power Infusion                                                       | Magic      | buffs_offensive | ✅         |
| Blessing of Protection                                               | Magic      | immunities      | ✅         |
| Blessing of Freedom                                                  | Magic      | **None**        | ❌         |
| Dark Soul ×2 / Combustion / Icy Veins / Temporal Shield / Alter Time | **None**   | Partial         | ❌         |

This explains why the entire corpus of 1245 matches only saw Power Infusion and BoP. **No difference is visible in corpus —
"never happened" and "unable to emit" look identical**, caught only by reading code.

This is the archetype of the CLAUDE.md rule: **the same fact ("this buff is purgeable and worth reporting") was asserted by three separate
lists without a shared predicate**, decaying independently with no gate firing.

**Fixed** (`2f1954c`): Freedom / Sacrifice had `dispelType=Magic` from DB2 (authoritative) originally,
only lacking classification tags, which were added. **Full corpus test across 1245 matches:**

| Criterion                                | Pre-fix |                                      Post-fix |
| ---------------------------------------- | ------: | --------------------------------------------: |
| `[MISSED PURGE OPPORTUNITY]` lines       |     822 | **2251** (+893 Freedom, +536 Sacrifice)      |
| Matches containing this section          |     291 |                                **371** / 1245 |
| `[PURGE]` (dispels completed by us) lines|     141 |                                       **382** |
| `[ENEMY PURGE]` lines                    |     148 |                                       **297** |
| token p50                                |    6553 |                                  6563(+0.15%) |

The last two rows are **incidental promotions** rather than new additions: these dispels were previously folded into `[MINOR DISPELS]` rollups,
and are now elevated to first-class citizens. Conservation verified line-by-line — the only "disappeared" `[ENEMY PURGE]` was a same-second merge
(`stripped Power Infusion` → `stripped Blessing of Freedom, Power Infusion`),
245 `[MINOR DISPELS]` were rollup rewrites (`Greater Purge x3` → `x1` + 2 promoted entries),
28 `[YOU]` added `[removed: ...]`. **No content lost.**

Full gate rerun all green: CJK 0/1245, deaths 0/0/0, inline redundancy 0, HP 0/6322, death-trace
0/3947, geometry 0/24881, qualityCheck 0 hard failures. Also added
`matchTimeline.purgeWhitelist.test.ts`: every whitelist item must either be emittable or in exemptions list,
and exemptions cannot retain fixed items — silent decay turned into test failures.

**Unfixed**: Remaining 6 items lack `dispelType` data itself. Missing ≠ unpurgeable, just unmined by DB2;
without authoritative basis for whether Combustion / Icy Veins can truly be dispelled, **guessing would fabricate fake opportunities**,
worse than missing evidence. Logged in `PURGE_WHITELIST_DATA_BLOCKED` awaiting data refresh.

**Left for humans to decide**: Whether to include permanent buffs (HoTs / shields). Testing expansion to Wild Growth /
Rejuvenation / Riptide / Enveloping Mist / Earth Shield:

```
211 match sample   103 → 892 lines (8.7×), matches containing section 37 → 87
Where 59% are permanent HoTs (Wild Growth 201, Enveloping Mist 112, Rejuv 82, Riptide 80, Lifebloom 52)
```

Telling a healer 201 times "you didn't purge their Rejuvenation" is noise, not evidence — B117 was written specifically to suppress this.
But several **discrete active CDs** clearly belong: Blessing of Sanctuary, Innervate,
Nether Ward, Time Stop, Tip the Scales, Nature's Swiftness, Spiritwalker's Grace.
**This is a curation judgment, not made on behalf.**

### `[CONTESTED]` Empty 86% — Same Root as P3, Deferred Together to Humans

unknown 151 / on CD 46 / available 7 — Same asymmetry of `getTrinketStateAtTime` returning `null`.
Decided however P3 is decided.

### Folded 5079 Lines of Minor Dispels — ⚠️ 26% Inside Is Evidence of Good Play

Expanded folded content across 1238 matches, 8696 entries:

| Category                                                           |  Entries | Proportion |
| ------------------------------------------------------------------ | -------: | ---------: |
| **Offensive dispels completed by us**                              | **2262** |    **26%** |
| Movement/shapeshift self-cleanses (Phantasm, Disengage, Bear Form…)|     1865 |        21% |
| Remaining (low-priority defensive purges, etc.)                    |     4569 |        53% |

The latter two categories are correctly folded. But the first category — Dispel Magic 493, Greater Purge 465, Spellsteal 424,
Tranquilizing Shot 353, Consume Magic 349 — represents **the team genuinely stripping enemy buffs**, yet because the
stripped buff wasn't in the catalog, it was judged low-priority and folded into rollup lines.

**Thus, a thin catalog doesn't just miss opportunities, it discards evidence of good play as well.** This shares the same root as the curation decision above:
once the catalog is populated, these will automatically be promoted to first-class citizens (`2f1954c` already shows 33 such promotions).

---

## 7. Recommended Order

1. **P1 Enemy cooldown symmetrization** — Covers 65% of matches, clear root cause, mechanism ready, single change can be measured before/after
   (`none tracked` lines → 0).
2. **P2 `[KILL WINDOW]` cap** — Inspect discarded items starting from #7 before deciding whether to raise cap or change sorting.
3. **P3 trinket `never observed` 88%** — For healers, trinket is the most critical CC countermeasure; unknown state renders this entire area uncoachable.
4. Expand remaining items per §6.

**Coupling note**: Any change alters every prompt; tonight's Layer A three-gate numbers and calibration baselines were measured on
current state. Rerunning Layer A three gates is cheap (fully automated), calibration is expensive (80 cases). Recommend running Layer A after P1 lands to
verify no new violations, deferring calibration until `docs/archive/HANDOFF-2026-07-20-judge-variance.md` concludes.
