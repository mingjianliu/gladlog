# Combat-log observability audit

**English** | [简体中文](log-observability-audit.zh-CN.md)

## Purpose and scope

Tracking: [GH #100](https://github.com/mingjianliu/gladlog/issues/100).

User direction, 2026-09-19: explore what the collected logs already contain but the product does not use, before adding more heuristic coaching. Separate observed facts, inferred state, deliberately omitted presentation, and genuinely unobservable information. This audit does not authorize new coaching accusations.

The first pilot and two discussion rounds with Claude Opus 5 are complete. No product predicates changed. A 600-file stratified exploration and full-archive census have **not** run.

## Reproducible pilot

```sh
npx tsx packages/eval/scripts/logObservabilityPilot.ts \
  "$GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-09-14-newseason.txt" \
  "$GLADLOG_EVAL_HOME/reports/log-observability-2026-09-19/replay.json" 24
```

Set `GLADLOG_EVAL_HOME` to the private evaluation directory and create the output directory first. The script refuses to overwrite an existing result. JSON contains private file paths and per-file decompressed-content hashes; do not commit it. The script reads one decompressed file at a time, not the entire archive into memory.

- Manifest: 63,303 files; SHA-256 `72e05f5de27d095a03f6cb5cde802475442d825c7a9925568a5095b2bd142a1e`.
- Select file index `floor((i + 0.5) * N / 24)` for `i = 0..23`, preserving manifest order.
- Read 671,928 nonempty lines with the existing `splitLine` and `parseLine` functions. All returned a ParsedLine; this does **not** prove correct field semantics or full decoding.
- There were 39 `ARENA_MATCH_START` events, not 39 verified independent complete rounds. This pilot does not segment/deduplicate rounds or stratify compositions.
- An exploratory sample establishes presence and implementation gaps, not season-wide prevalence. Files, lobbies, rounds, actors and repeated perspectives are different denominators.

## Findings

| Information            | Pilot observation                                                                                                                   | Current boundary                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor facing           | 302,684 advanced records with recognized GUID prefixes have finite x/y/facing; 302,131 have nonzero facing                          | L1 decodes facing; L3 `collect.ts` retains hp/maxHp/x/y/powers, not facing. `rawStreams` can still read it. Actor orientation is not camera direction; angle semantics and sample ownership need verification. |
| Periodic resource gain | 1,207 `SPELL_PERIODIC_ENERGIZE`, in 17/24 files                                                                                     | L1 marks these unknown, without base/spell decoding or ordinary L3 action materialization. Resource snapshots already exist; resource-flow attribution is a separate question.                                 |
| Enchant events         | 8 `ENCHANT_APPLIED`, 7 `ENCHANT_REMOVED`, in 2 files                                                                                | L1 marks these unknown. Combat relevance is not established.                                                                                                                                                   |
| Equipment              | 216/216 COMBATANT_INFO records decode; 3,888 slots, including 1,111 with nonzero enchant lists, 3,310 bonus lists and 567 gem lists | Lists exist; effect semantics are not thereby understood. Current identified analysis consumers include item level and trinkets. Repeated actors, placeholder slots and item variants need separate handling.  |
| Resources              | 287,407 valid power readings; 764 advanced records carry multiple resources                                                         | Powers already reach L3/compat and `resourceAt`. Do not report this as wholly unparsed. Snapshots do not establish continuous availability or resource costs.                                                  |
| Heal absorption        | 9,031 `SPELL_HEAL_ABSORBED`, in 6/24 files                                                                                          | Decoded and passed through compat; intentionally not surfaced under an earlier user ruling. Not a new HPS accounting bug.                                                                                      |
| Summons                | 3,301 `SPELL_SUMMON`, in 22/24 files; 77 summoned npcIds                                                                            | Birth, activity, damage taken and some positions can be linked. These are not complete lifetimes or an exhaustive NPC inventory.                                                                               |

File-local joins on summoned GUIDs illustrate the limitation:

| NPC                  | Summoned GUIDs | With source events | With positions | With incoming damage | With matched UNIT_DIED |
| -------------------- | -------------: | -----------------: | -------------: | -------------------: | ---------------------: |
| Healing Stream, 3527 |             96 |                 96 |             96 |                    4 |                      0 |
| Grounding, 5925      |             18 |                  0 |              8 |                    8 |                      0 |
| Healing Tide, 59764  |             17 |                 17 |              0 |                    0 |                      0 |

No death event does not mean survival until round end; the last event is not a despawn timestamp. Psyfiend 121111 was not observed among this sample's summons, which says nothing about archive-wide absence.

## Existing work and rejected false discoveries

- Archived BACKLOG #36 records prior resource, IMMUNE, DAMAGE_SPLIT, EMPOWER and heal-absorb decoding. Current `matchTimeline.ts` consumes IMMUNE and EMPOWER; these are not new missing event types.
- Heal absorption is deliberately not in the prompt: a previous 1,200-round / 1,322-death study found 56 deaths with absorption in the preceding 10 seconds, only six above 20% of victim max HP, and substantial self-imposed effects. Preserve the data; do not reopen that coaching feature on event count alone. Heal absorption and percentage healing reduction are different mechanisms.
- `slim.ts` truncates params to 13 entries and clears fields. `convertParams` preserving an array does not prove old documents retain its raw contents. Distinguish fresh parsing from old-document recovery.
- Actual damage/healing may already include equipment/talent effects. Reconstructing mechanisms or availability needs those effects; summing observed outcomes must not apply their bonuses again.

## Claude discussion

Two read-only rounds used the local Claude CLI, actual backend `claude-opus-5`. Codex ran the pilot and checked the source; Claude did not scan the corpus.

Claude proposed examining skipped advanced fields, COMBATANT_INFO scalar attributes, failed casts and NPC state. These remain investigation hypotheses, especially possible shield remainder, armor, offensive attributes and resource costs: their raw offsets/semantics are **not validated**.

After receiving pilot data and counterexamples, Claude accepted corrections concerning old-document recovery, existing IMMUNE consumers, the deliberate heal-absorb omission, actor-versus-caster ownership, and overclaiming that dynamic cooldowns can never be reconstructed. Pairing healing by caster/spell alone cannot identify healing-reduction strength: dampening, procs, talents, crits and recipient modifiers still confound it.

Further limits retained by Codex: recorder-only coverage of failed casts must be checked rather than assumed; advanced actor samples may come from damage/healing, not just that actor's own casts. A failure constrains an instant, not a whole interval. Angle interpolation needs its own semantic validation.

## Exploration queue and acceptance

### Direction 1: facing, first evidence pass

Run `npx tsx packages/eval/scripts/facingObservabilityScan.ts <pilot.json> <new-output.json>` on the pilot output. The scan verifies input file hashes and resets gap pairing at observed arena start/end events and file boundaries. It is diagnostic only, not a production facing predicate.

On the same 24 files, 223,516 finite Player-actor samples divide into 62,772 actor=source, 160,729 actor=destination, and 15 actor=neither (all SPELL_CAST_SUCCESS). Self-targeted events count in the source bucket. Therefore attaching facing to the spell caster instead of advanced.actorGuid is demonstrably wrong for many records.

Observed facing range is 0–6.2832, compatible with a rounded radian representation but **not proof** of units, zero-axis, rotation direction or world-to-map transform. One value is just above mathematical 2π; do not call that a bad sample without checking precision.

There are 194,566 actor/timestamp groups, 21,503 with multiple records; 15 have differing facing values and 16 differing positions. This does not establish corruption: event ordering and within-millisecond changes need inspection. The scan excludes these ambiguous groups from the stationary-pair diagnostic. Of 57,528 consecutive pairs at exactly the same recorded x/y and within 1.5 seconds, 10,650 change facing. This rejects treating the field as merely movement direction; rounded positions do not prove the actor was physically motionless.

Across 194,350 adjacent sample pairs (not weighted by elapsed time/player), gaps are p50 0.077s, p90 0.375s, p99 1.204s; 1,078 exceed 1.5s, 228 exceed 3s, maximum 29.005s. This is not a claim that 99% of combat time is observable: idle/stealthed periods, missing round boundaries, deaths and uneven actor activity require separate denominators.

**Current conclusion:** preserving the actor's observed orientation with timestamp/provenance is a credible data-layer direction. “Facing target X”, continuous facing, camera direction and tactical judgements remain unapproved/unvalidated. The checks outstanding after this first pass — independent axis/unit calibration, the 15 third-actor casts, same-ms discrepancies, and round/player/time-weighted gap coverage — were closed by the calibration pass below. No product changes were made.

### Direction 1: calibration pass

Run `npx tsx packages/eval/scripts/facingCalibrationScan.ts <pilot.json> <new-output.json>` on the same pilot output. Same 24 hash-checked files, 39 segments: 24 closed by `ARENA_MATCH_END`, 15 closed by the next `ARENA_MATCH_START` (a Solo Shuffle lobby logs a single END) and ended at their first roster death. This is still the exploration sample: it establishes a convention and a mechanism, not season rates.

**Actor ownership.** The 15 actor-neither rows are one mechanism. All are sourceless `SPELL_CAST_SUCCESS` 145629 (the Anti-Magic Zone area aura landing on a player). In 15/15 the advanced actor is a roster Player on the destination's team; its logged position is within 1.5 yd of that actor's **own** previous sample in 15/15 (maximum 1.31 yd) and within 1.5 yd of the destination's in 0/15. In 11/15 the actor cast 51052 (the Anti-Magic Zone ability itself) in the preceding 1.2 s; the other 4 are later re-entries into a standing zone. The advanced block is therefore the zone owner's own state — not the destination's, not a ground coordinate, not a parser bug. Consequence: a facing sample is keyed on `advanced.actorGuid` alone, never on the event's source or destination.

**Angle convention.** All eight axis/sign conventions competed on two independent sources: same-millisecond `SWING_DAMAGE` (attacker sample) paired with `SWING_DAMAGE_LANDED` (target sample), pairs under 1 yd apart skipped; and displacement of at least 1.5 yd at 5–12 yd/s within 0.5 s while facing held steady to 0.1 rad.

| Convention (angle of a logged displacement) | Melee bearing within 90° / 30° (n = 2,038) | Movement heading within 90° / 30° (n = 7,938) |
| ------------------------------------------- | -----------------------------------------: | --------------------------------------------: |
| `atan2(dy, dx)`                             |                           97.25 % / 67.6 % |                               78.9 % / 38.4 % |
| `atan2(-dy, -dx)` (its opposite)            |                             2.75 % / 0.5 % |                                21.2 % / 0.9 % |
| the other six                               |                        48.0–52.0 % / ≤18 % |                           48.8–51.3 % / ≤20 % |

So the field is in radians and θ points along `(cos θ, sin θ)` in the **logged** x/y: 0 is +x, π/2 is +y. Movement agrees only partially by construction — players strafe and backpedal. Not established here: how logged x/y maps onto a rendered map image (the replay's transform is a separate fact), and what the 2.75 % of swings with the target behind the attacker are (not examined; the two samples not being truly simultaneous is one candidate).

**Same-millisecond discrepancies.** 20 differing groups (4 facing only, 5 position only, 11 both), on the order of 1 in 10,000 actor/timestamp groups. Of the 14 with a next sample within 100 ms, the later log line is closer to it in 7 and the earlier line in 7. Line order inside one millisecond therefore carries no usable time order: these are unordered same-timestamp observations. At this rate any deterministic tie-break is harmless provided it is not described as “latest”.

**Coverage, time-weighted per player-round** (span = the player's first sample to their own death or the segment end):

|                                                 |           END-closed |    next-START-closed |
| ----------------------------------------------- | -------------------: | -------------------: |
| Player-rounds / player-seconds                  |         126 / 20,540 |          90 / 10,181 |
| Time inside gaps ≤ 1.5 s                        |               91.3 % |               91.4 % |
| Time inside gaps ≤ 3 s                          |               95.8 % |               97.6 % |
| Per player-round share ≤ 1.5 s: p50 / p10 / min | 92.2 / 77.6 / 54.6 % | 92.3 / 72.1 / 54.5 % |
| Longest gap per player-round: p50 / p90 / max   |   4.2 / 9.2 / 23.0 s |   2.5 / 6.9 / 11.3 s |

No roster player had fewer than two samples. A gap means “no advanced record named this actor”, not “the player did nothing”; stealth, line of sight and idle time are not separated out.

**Direction 1 result.** What can be preserved as an observed fact: per `advanced.actorGuid`, the tuple (timestamp, x, y, facing in radians along `(cos θ, sin θ)` of the logged axes), existing only where some advanced record names that actor. What must stay unknown: facing between samples (the median player-round contains a hole of 2.5–4.2 s, and about 8.7 % of player-time sits in gaps over 1.5 s), camera direction, intended target, and anything about the gaps themselves. “Was unit X inside the actor's front arc at a sample time” is now computable geometry when both positions exist at that time. Whether L3 stores facing, and whether anything consumes it, are two separate user decisions; neither is made here. No product changes were made.

### Direction 1: storage and consumer decision (codex astra debate, 2026-09-19)

Two rounds with codex `gpt-6-astra` (conversation `codex:01a0bcf1-3060-7a10-aa98-7476fca39b98`); it ended `STANCE: CONCEDE` on the ruling below. Opening position: do not store facing in L3, no coaching consumer, at most a display-only replay tick.

Conceded to codex: the Value-Gate rule governs signals and candidates, not retention of decoded observations (heal-absorb is the precedent); the size argument is dead — about 12,600 advanced records per sampled file × 16 bytes ≈ 0.2 MB, roughly 0.3 % of a stored match; `rawStreams` exposes only mana samples and failed casts, so a facing prototype needs new stream extraction; “no interpolation across gaps over 1.5 s” wrongly licenses interpolation below that; 91.3 % is gap coverage and 78.9 % validates the convention — neither is an orientation-accuracy or backpedal-classifier number; and the unexplained 2.75 % of successful swings with the target behind is itself a warning against any hard front-arc gate.

Conceded by codex: its core argument was that not storing is “continuing irreversible deletion”. Checked on the real library: **1,095 / 1,095 stored matches keep a non-empty `raw.txt`** (19 GB) — `matchStore.store()` writes it on every import and `readRawText()` already serves it. Facing stays recoverable for old and future matches, which also refutes the opening claim that slimmed matches cannot be backfilled. Caveat: `reparse()` / `rebuildIndex` re-derive meta from `match.json` only; no path re-parses `raw.txt` into a fresh `match.json`, so a library backfill means building one.

Coaching consumers reviewed and **none approved**: missed kick / front-dependent stun, melee “behind the target”, backpedalling, rogue/feral positionals, healer turned away. Each needs verified per-spell restrictions plus a feasibility argument that event-driven samples cannot give — one sample facing away does not show the player could not turn. The cone-whiff veto of 2026-09-05 stands. Credible non-coaching uses: parser/replay verification through melee events (what the calibration already did) and corroborating video↔log pairing.

**Ruling (both sides):** defer L3 storage until a consumer is approved; then add the optional field, register it with the parser oracle, and build the `raw.txt` re-parse path once. The deciding consideration is recoverability from retained raw logs. **User ruling, 2026-09-20: not doing it — “the benefit is small”. Direction 1 is closed: nothing is stored, nothing consumes facing, and the calibrated convention above stays on record for whoever reopens it.** What had been put to the user: whether to build the first proposed consumer — a selected-player facing tick in the replay showing the observed sample with its age, never an interpolated direction. Prerequisite before building it: validate the complete logged-direction → replay transform, reflections and rotation included; a correctly placed dot does not prove a correctly drawn direction.

### Raw-log retention invariant

No deletion, truncation or lossy replacement of a stored match's `raw.txt` may ship until every audit-listed field absent from the persisted structured data has a verified lossless replacement. Validated fields (facing) are materialised; undecoded fields are preserved verbatim with event identity, timestamp, actor association where known, and provenance — never materialised into a guessed meaning. Verify the replacement before deleting the source. The invariant is referenced from the `raw.txt` write in `packages/desktop/src/main/matchStore.ts` and in the header of `packages/parser/src/slim.ts`.

### Direction 2: skipped advanced slots, first evidence pass

Run `npx tsx packages/eval/scripts/advancedSlotScan.ts <pilot.json> <new-output.json>`. Same 24 hash-checked files, Player actors only. Between `maxHp` and `powerType` every one of the 223,516 records carries **six** slots, not the four older format descriptions list; `slot+N` below means `params[advancedBlockStart + N]`. No slot was named from its position: every slot competed in every test.

| Slot | Independent test                                                                                                                                                     | Result                                                                                                                                                                          | Status                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| +9   | Over a line-ordered interval between two samples of one Player with no aura event on that Player, does the slot move by exactly −Σ(`SPELL_ABSORBED` on that Player)? | 5,232 / 10,199 exact; every other slot 1 / 10,199. With no absorb in the interval it is unchanged in 117,024 / 117,316 (99.75 %). Zero in 80.6 % of records, maximum 1,413,608. | **Verified: total remaining absorb on the actor.**                                                                                                                                                                        |
| +5   | First in-round value vs each raw `COMBATANT_INFO` scalar, zeros ignored                                                                                              | equals `COMBATANT_INFO[5]` for 216 / 216 players, no other scalar matches                                                                                                       | **Verified: the same quantity as `COMBATANT_INFO[5]`** (intellect in the published layout; L1 does not decode these scalars, so the name is the published one, not ours).                                                 |
| +6   | same                                                                                                                                                                 | equals `COMBATANT_INFO[23]` for 211 / 216, no other scalar matches                                                                                                              | **Verified: the same quantity as `COMBATANT_INFO[23]`** (armor in the published layout, the scalar just before the spec id). The 5 misses are unexamined; a form or buff active before the first sample is one candidate. |
| +4   | same                                                                                                                                                                 | matches no scalar; range 311–5,899, changes on 1.1 % of records                                                                                                                 | Unverified. Published layouts call it attack power; nothing here tests that.                                                                                                                                              |
| +7   | same                                                                                                                                                                 | matches no scalar; range 600–5,133, changes on 0.9 % of records                                                                                                                 | **Unverified and unnamed** — it does not exist in the four-slot descriptions.                                                                                                                                             |
| +8   | —                                                                                                                                                                    | 0 in 223,516 / 223,516                                                                                                                                                          | Constant in this sample; nothing to learn.                                                                                                                                                                                |

What the +9 residuals say about snapshot timing: of the 4,967 non-exact intervals, 3,566 show the slot unchanged and 945 equal a prefix or suffix of the interval's absorbs, so 95.5 % of all tested intervals are explained by the sample being taken before or after some of the same-instant `SPELL_ABSORBED` lines. 456 (4.5 %) are not: 284 dropped by less than was absorbed, 129 by more, 43 rose with no aura event. Consequence: the slot reads as “remaining absorb ≈ N at this sample”, **not** as a ledger that can be reconciled hit by hit, and its order relative to same-instant damage is not fixed.

**Direction 2 result so far.** Three of six slots have a verified meaning, one is constant, two remain unknown. L1 decodes none of them and L3 stores none. The absorb slot is the only one that is a changing combat state; whether anything should consume it (for example effective health = hp + remaining absorb wherever the product reasons about how close someone was to dying) is a user decision that, per the Value-Gate rule, starts from one complete real-match example, not from this table.

**Value probe on the absorb slot — negative (2026-09-20).** `npx tsx packages/eval/scripts/shieldAtCrisisExampleGen.ts --manifest <txt> --offset 3000 --limit 600` takes the product's own crisis decision points (`crisisDecisionPoints`, the predicate behind `crisis-no-response`: HP at or below 40 %, at least 10 % of max HP taken in 2 s, a response was feasible) and reads the remaining absorb from the sample nearest the crossing (every point had one within 1 s). The product already counts what a shield **ate** as effective HP after the fact (`absorbShields.ts`, `incomingPressure.ts`); the only new information in this slot is the **unconsumed remainder**, so the question was whether that remainder changes any accusation.

| 600 files                                                     | Points | Remaining absorb = 0 | under 10 % of max HP | 10 % or more |
| ------------------------------------------------------------- | -----: | -------------------: | -------------------: | -----------: |
| Healer, dangerous and feasible                                |    334 |                  278 |                   48 |    8 (2.4 %) |
| Healer, **accused** (no response in 3 s) — the live candidate |     73 |                   63 |                   10 |        **0** |
| DPS, dangerous and feasible                                   |  2,886 |                2,445 |                  365 |   76 (2.6 %) |
| DPS, accused — built, not shipped (#59)                       |  1,184 |                  992 |                  157 |   35 (3.0 %) |

By the time someone is under 40 % and still being hit, the shield is gone: it is the first thing the damage ate. On the one accusation that ships, the remainder never reached 10 % of max HP. On the unshipped DPS form it did in 3.0 % of accusations, and those died within 10 s at 4 / 35 against 150 / 1,149 for the rest — no visible difference at this size. Striking single moments exist (17 % HP under an 84 % shield), but none sits under a live accusation. **Recorded as a negative result: no consumer proposed, nothing stored.** This is a 600-file slice, not the full manifest; it is enough to decline a proposal, and would not be enough to ship one. If the DPS crisis form is ever revived, re-run this first.

**Wrap-up checks (same script, same sample).**

- **+9 is damage absorb only.** Over 3,891 clean Player intervals that contain `SPELL_HEAL_ABSORBED` and no `SPELL_ABSORBED`, the slot is unchanged in 3,859 (99.2 %) and moves by the heal-absorbed amount in 0.
- **Pets and creatures carry the same six slots**, and their last slot reconciles more cleanly than a player's: Pet 7,326 / 7,834 exact (93.5 %), Creature 617 / 629 (98.1 %) — fewer same-instant events, less snapshot-ordering ambiguity. Non-zero on 29.6 % of Pet records and 5.3 % of Creature records.
- **+7 tracks `COMBATANT_INFO[20..22]`** (three equal scalars, versatility in the published layout) at a ratio of 1.8513, within 1 % for 75 % of players. That is co-variation, not identification: the ratio is unexplained and a quarter of players deviate. It stays unnamed.
- **+4 tracks nothing**: its best ratio (to `COMBATANT_INFO[5]`) is within 1 % for 13 % of players. It stays unverified.
- Two records in the sample decode an advanced “actor” that is a bare number rather than a GUID — a mis-located block on some event shape, not examined.

### Direction 3: resource flows

Run `npx tsx packages/eval/scripts/resourceFlowScan.ts <pilot.json> <new-output.json>`. Same 24 hash-checked files. What L1 does today: `SPELL_ENERGIZE` (18,912) and `SPELL_DRAIN` (45) fall through the catch-all branch — source and spell only, **no advanced block, no tail**; `SPELL_PERIODIC_ENERGIZE` (1,207) is `known:false`; the cast's power cost is never read. No `LEECH` event occurs in the sample. All three shapes have 34 params.

| Claim                                                                                    | Identity tested                                                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The last four params of both ENERGIZE shapes are amount, over-cap, power type, max power | tail max equals the block's max for that type whenever the type is in the block; over-cap > 0 ⇒ block current = max | 13,708 / 13,708 and 2,395 / 2,395 (ENERGIZE); 1,089 / 1,089 and 11 / 11 (PERIODIC). The second identity also fixes the timing: the snapshot is taken **after** the gain.                                                                                                                                                                                                       |
| The advanced actor on a gain is the gainer                                               | actor = raw destination GUID                                                                                        | 18,912 / 18,912 and 1,207 / 1,207 — so PERIODIC needs no different handling from ENERGIZE.                                                                                                                                                                                                                                                                                     |
| A cast's snapshot is taken **before** its cost                                           | mana, which regenerates, so closest-of-two against the actor's next sample within 1.5 s                             | 5,424 / 5,940 (91.3 %) nearer current − cost.                                                                                                                                                                                                                                                                                                                                  |
| A block lists only the resources **that event concerns**                                 | discrete types (combo points 4, soul shards 7, holy power 9, chi 12, essence 19) per block                          | They appear in 1,748 of about 320,000 block power entries, every one a `SPELL_CAST_SUCCESS`, and the cast has a non-zero cost in that type in 432 / 432, 600 / 600, 339 / 339, 29 / 29 (shards 273 / 348). A cost is only ever reported for a type in the block: 18,037 / 18,037. So a secondary resource is never sampled on damage or healing lines — only when it is spent. |
| Spends plus ENERGIZE gains form a closed ledger                                          | between two spender casts of one actor: next current = previous current − previous cost + Σ gains                   | **combo points 388 / 399 (97.2 %), holy power 569 / 576 (98.8 %)**. Chi 135 / 325, soul shards 27 / 261, essence 0 / 27 do **not** close: essence regenerates, and chi and shards evidently move through something these events do not carry. Not examined further.                                                                                                            |

What L3 loses by skipping the block on these events: 19,895 Player blocks (4,080 of them carrying mana). Adding them would move time-weighted sample coverage from 91.33 % to 91.67 % inside 1.5 s gaps and add 3.9 % more mana snapshots — measured, and not worth a parser change on its own.

**Direction 3 result.** The gain tail and the cost field are verified, with their snapshot timing (gain: after; cast: before). Combo points and holy power can be reconstructed as an exact ledger from the log alone; chi, soul shards and essence cannot; primary resources are already sampled. The product reads mana only as a percentage change across a window (`resourceDeltaPct`), where a one-cast before/after offset is below anything it reports, so nothing here is a product defect. **No consumer is proposed**: “you sat on five holy power” is an accusation with no evidence base and would need the full value probe first. Nothing stored.

**User ruling, 2026-09-20: resources are closed as a coaching direction.** Mana “does not matter — or rather means little as guidance”; secondary resources belong to the damage/healing rotation and “do not affect the big picture much either”. Do not propose mana or secondary-resource signals from this audit; the verified layouts above stay on record as parser facts only.

### Direction 4: NPC roster and lifecycle

Run `npx tsx packages/eval/scripts/npcRosterScan.ts --manifest <txt> --offset 3000 --limit 600 --out <new.json>`. The product's only NPC knowledge is `CRITICAL_NON_PLAYER_NPC_NAMES` (`timelineHelpers.ts`, 27 hand entries): it supplies English names for localized targets and decides which non-player deaths print as `[UNIT DESTROYED] … killed by: …`. It is a hand-maintained id list that is **not** in `curatedIdRegistry.ts` (the registry is spell-id based), so neither rot scan has ever seen it. 600 files, 116 distinct summoned npcIds.

**The `[UNIT DESTROYED]` line is dead.** It keys on `deathRecords`, which come from `UNIT_DIED`. 12.x logs emit no `UNIT_DESTROYED` at all and emit `UNIT_DIED` for almost no summoned unit: of **13,439** listed units summoned, **5** have one (all Xuen); in the 24-file pilot it is 0 of 345, and `UNIT_DIED` on creatures is confined to death-knight minions that are not listed. Product-side confirmation: 0 of 3,000 saved prompt files in the private eval repo contain the line. The only kill evidence the log still carries is a damage event with overkill > 0: **886** listed units took one from an enemy player.

| Listed unit                                                      |    Summoned | Hit by an enemy player |                                                                               Killed (overkill > 0) |
| ---------------------------------------------------------------- | ----------: | ---------------------: | --------------------------------------------------------------------------------------------------: |
| Grounding Totem                                                  |       1,343 |                   27 % | 359 (27 %) — mostly the totem doing its job; the prompt already marks `[absorbed: Grounding Totem]` |
| Earthgrab Totem                                                  |       1,691 |                   19 % |                                                                                          255 (15 %) |
| Tremor Totem                                                     |         436 |                   20 % |                                                                                           86 (20 %) |
| Spirit Link Totem                                                |         186 |                   44 % |                                                                                           67 (36 %) |
| Capacitor Totem                                                  |         994 |                    8 % |                                                                                            46 (5 %) |
| Healing Stream / Healing Tide Totem                              | 2,653 / 407 |              7 % / 8 % |                                                                                              29 / 3 |
| Mindbender, Shadowfiend, Darkglare, Infernal, Tyrant, Voidwraith |       2,023 |                58–96 % |                                                       14 — attacked constantly, almost never killed |

**Reverse direction — stale ids.** Eight listed ids never occur in 600 files. One is proven stale: **Psyfiend is listed as 121111 (0 occurrences) while the live 101398 was summoned 305 times and killed 146 times (48 %)** — the most-killed summon in the slice, invisible by a renumber. Static Field Totem (179867) is absent from this slice but present in the pilot (9 units), so “absent from 600 files” is a lead, not a verdict; Earthen Wall, Stone Bulwark, Mana Tide, Lightwell, Fel Obelisk and Pit Lord are unresolved.

**Forward direction — unlisted.** 61 unlisted npcIds were hit by enemy players at least five times. Most are damage guardians that are attacked incidentally and never killed (Dire Beast, Treants, Wild Imps: 1 % killed). Beyond Psyfiend, the ones that are actually killed: Denizen of the Dream 66 (19 %), Mirror Image 31, Counterstrike Totem 20 (33 %), Stormstream Totem 14 of 1,080.

**Kill evidence cross-check.** `PARTY_KILL` can name a totem as its destination, but it is a strict subset of overkill: over 200 files, 134 listed units have both, at the same millisecond (lag p50 0 ms, range −1 to 7), and **0** have a `PARTY_KILL` without an overkill; 146 more have overkill alone. `PARTY_KILL` is only written when the killer is in the recorder's party. It therefore validates “overkill > 0 = killed” and adds nothing to it.

**What else the prompt already says about totems** (checked on the first 3,000 saved prompts containing `[STATE]` — a truncated sample, not a random one): `[absorbed: Grounding Totem]` on the owner's own eaten cast is alive (180 files). `[ABSORBED: <spells>]` on the owner's own Grounding Totem cast is **dead** — 0 of 1,817 such cast lines carry it — for two stacked reasons found while fixing it. (1) Grounding Totem is absent from the major-cooldown ledger, so production renders its cast through the B38 promotion path, which never received the note (the trap `manaCooldownNote` already documents). (2) Once wired there it printed `[ABSORBED: Grounding Totem]` on 277 of 298 lines: a `SPELL_ABSORBED` event's spell id is the **shield** (the totem itself), and the attacking spell sits in params the archive slimmer clears. What survives is **who** cast the eaten spell, so the note now reads `[ABSORBED spells from: <caster>]`. **Correction of an earlier statement in this audit:** a grounded spell is NOT logged as a killing damage event. Overkill on a Grounding Totem is someone attacking the totem directly (its own `[UNIT DESTROYED]` line); an eaten spell is a separate `SPELL_ABSORBED`. Naming the eaten SPELL would need a new L3 field plus a re-parse of stored matches — not done. `[CC AVOIDED?] … did not land; Tremor Totem active` exists for a shaman owner only.

**Tremor Totem removing fear — the facts** (300 files; Fear 5782, Psychic Scream 8122, Howl of Terror 5484 on players; the totem itself sources **no** log event of any kind):

| Friendly Tremor Totem                                                                       | Fears | Actual duration p50 |                                                                                                      Ended within 1.5 s |
| ------------------------------------------------------------------------------------------- | ----: | ------------------: | ----------------------------------------------------------------------------------------------------------------------: |
| none                                                                                        | 2,814 |              1.77 s |                                                                                                                  44.8 % |
| already up when the fear landed (summoned ≤ 10 s earlier — nominal lifetime, an assumption) |    91 |              0.65 s |                                                                                                                  86.8 % |
| **dropped during the fear**                                                                 |    50 |                   — | removal lag after the summon: **p50 0 s, p90 0.02 s, 49 / 50 within 1.5 s**; all 50 victims are teammates of the shaman |

“Totem dropped mid-fear → the fear ends the same instant” is a deterministic signature and can be stated as a fact. “Totem was already up” cannot: fear also breaks on damage, so a short fear under a standing totem is strongly suggestive, not attributable. User, 2026-09-20: establish the facts first, adding a line is a later decision (“most likely yes”).

**Lifecycle honesty.** With no `UNIT_DIED`, a summon that was not overkilled has an **unknown** end — expiry, replacement, owner death and despawn are indistinguishable, and the last event naming a unit is not its end. Only “killed by an enemy player's damage” is an observable fact.

**Value-gate example** — `npx tsx packages/eval/scripts/unitDestroyedExampleGen.ts --manifest <txt> --offset 3000 --limit 60` renders today's lines next to overkill-keyed lines for real matches, in the product's own format: 130 rounds, **0 lines today, 106 proposed, in 27 rounds (21 %)**. A median round (spec ids replaced by names):

```
TODAY     0 [UNIT DESTROYED] line(s)
PROPOSED
  0:09  [UNIT DESTROYED]   Grounding Totem (Friendly) killed by: Enemy Shadow Priest
  0:14  [UNIT DESTROYED]   Tremor Totem (Friendly) killed by: Enemy Arcane Mage
  1:31  [UNIT DESTROYED]   Psyfiend (Enemy) killed by: Friendly Enhancement Shaman
  2:05  [UNIT DESTROYED]   Earthgrab Totem (Friendly) killed by: Enemy Arcane Mage
```

**Status: fixed 2026-09-20** (user ruling: “fix it, this is very helpful, totems too — especially Tremor, Spirit Link and Grounding”). `[UNIT DESTROYED]` now keys on `nonPlayerUnitKill` (first `damageIn` event with `overkill > 0`, else a bare `UNIT_DIED`); parser-compat carries `IHpEvent.overkill` on killing blows because `effectiveAmount` is zeroed for pet/guardian targets; the killer comes from the final blow through `damageEventLabel`. Same 605-match / 1,270-round / 3,520-prompt acceptance set, before → after:

|                                                       |                                  Before |                                                                                                                                                      After |
| ----------------------------------------------------- | --------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------: |
| `[UNIT DESTROYED]` lines                              | 24 (Xuen 21, Darkglare 3, **0 totems**) |                                                                                                                           **3,076**, all with `killed by:` |
| of which totems (re-measured after every edit)        |                                       0 | 2,580 — Grounding 1,260, Earthgrab 588, Tremor 226, Static Field 172, Spirit Link 148, Capacitor 73, Totem of Wrath 51, Healing Stream 49, Healing Tide 13 |
| lines with an `Unknown` side                          |                                       — |                                                                                                          20 → 0 once the side falls back to the summoner's |
| Grounding `[ABSORBED …]` note on Grounding cast lines |                                0 of 470 |                                                                                                                                                 277 of 470 |
| findings-prompt hash, every per-type candidate count  |                                       — |                                                                                                                                                  identical |

NPC list, user ruling “probably from earlier versions, gone”: Earthen Wall, Mana Tide, Stone Bulwark, Lightwell and Fel Obelisk removed (zero summons, casts and damage events under any id in 600 files); Pit Lord 196111 → 228574; 105427 renamed Totem of Wrath. Unlisted summons are 24.6 % of all overkill kills but almost all are damage guardians cleaved down at about 1 %; the only totem-like one is Counterstrike Totem (20 / 61) — user: not important, leave it out until it is wanted in the prompt. Reviewed by agy Gemini 3.1 Pro (codex quota was exhausted): APPROVE; its one aside — that `killed by:` could falsely satisfy the friendly-death coverage gate — does not hold, the gate needs the dead player's name or full spec on the line and this line prints numeric ids.

**Permanent pets (user question, 2026-09-20: a hunter's or warlock's pet dying should change how hard they are to kill — do we account for it?).** No: `candidateFindings.ts` treats a pet death as noise and nothing else reads one. `npx tsx packages/eval/scripts/petDeathScan.ts --manifest <txt> --offset 3000 --limit 300 --out <new.json>` measured the facts first. A permanent pet is killed in 5.8 % of hunter rounds (16 / 277), 1.3 % of warlock rounds (3 / 227) and 12.5 % of Unholy rounds (20 / 160); 38 of the 46 kills have overkill as their only evidence. The owner died later in the round 18.8 % / 0 % / 20.0 % of the time, against 21.1 % / 40.2 % / 23.6 % when the pet was never killed — no sign that losing the pet makes the owner easier to kill, on a raw comparison that is confounded and tiny (n = 16 / 3 / 20). “Petless time” could not be measured cleanly: a hunter's median 0.8 s is a second pet acting, not a revive. **Recorded as: rare, and no visible effect at this size — not proposed.** The kill evidence is the same predicate, so it is parseable whenever it is wanted.

Proceed one direction at a time; report a concrete evidence-backed result before widening scope:

1. **Facing:** verify actor ownership, angle units/range, sampling gaps and same-actor same-time consistency. Determine what can be preserved; do not infer camera direction or tactical intent.
2. **Skipped state fields:** test candidate field semantics against independent event evidence. Do not name a shield/attribute slot merely because its position looks plausible.
3. **Resources:** decode and reconcile gains/drains/costs with snapshots; verify before/after-cast timing and coverage.
4. **NPCs:** inventory observed npcIds and preserve observed birth/activity/death versus unknown disappearance. Keep NPC and owner attribution separately.
5. **Equipment and dynamic talents:** connect configuration to observed effects using official evidence; replay visible state transitions, retain uncertainty otherwise. Audit consumers that bypass existing modifiers.

The deliverable is a field-level chain: **raw → L1 → L3 → compat → analysis → prompt**, classified as consumed, undecoded, lost, decoded-unused, deliberately not surfaced, semantics unverified, or unobservable. `known=true` does not mean fully decoded.

After validating definitions, use at most 600 files for stratified exploration (version/date, bracket, map, spec, recorder and advanced-log coverage). Deduplicate lobby/round identities and keep rare-mechanism targeted samples separate. Then run a programmatic, sequential full-manifest census with event/unit/round denominators and explicit missing/error counts. No per-match LLM calls. More observations cannot identify missing intent, camera state or unrecorded inputs.

Changes to product facts require deterministic before/after verification; new coaching conclusions still require a complete real-match example and user review.

## Agent handoff — 2026-09-19

**Stop point:** user requested a wrap-up and handoff, not further exploration. The pilot and first facing pass are complete; direction 1 is **not** fully validated. No product changes, 600-file scan or full-archive scan were made. All scans and both Claude calls launched by this task have exited; there is no process/session to babysit.

**Git checkpoint:** `bd3d7924` records the pilot, `98d044f2` records the facing pass. Both were verified on remote main on 2026-09-19: remote/local main were `087be204745e94a51e80814b27e885eddc7827e2`, worktree clean. Another session committed and published the intervening teammate-crisis retirement; do not undo it or assume the earlier product-status discussion reflects that later change. The earlier “not pushed” issue comment is superseded by this check.

**Last follow-up (since classified — see “Direction 1: calibration pass”; it is the zone owner's own state):** inspecting the 15 actor-neither-endpoint rows found that all are `SPELL_CAST_SUCCESS`, spell **145629 / Anti-Magic Zone**, source GUID `0000000000000000`, with a Player advanced actor different from the Player destination. They occur in two sampled files. This identifies a concentrated event shape, not a proven parser bug, ground-target coordinate, or ownership explanation. The next agent should inspect surrounding events and actor roster membership before deciding how to interpret it.

**Private artifacts:** `$GLADLOG_EVAL_HOME/reports/log-observability-2026-09-19/` contains `pilot.json`, `committed-script-replay.json` (deep-equal across every field and content hash), `facing-round-bounded.json` (canonical facing results cited above), the initial report and a saved diagnostic `facing-anomalies.ts`. `facing-pilot.json` is the earlier file-local prototype: it did not break pairs at round boundaries and must not supply the current gap numbers. The diagnostic script uses this machine's absolute paths; the two committed scripts are the supported rerun entry points. Keep source paths, GUIDs and raw logs private.

**Next steps, in order:**

1. Read this document, repository instructions and current Git status. Do not rerun the original inventory or the whole archive merely to regain context.
2. **Done later on 2026-09-19** (calibration pass above; private outputs `facing-calibration.json`, `amz-neighbours.log`, and the superseded first draft `facing-direction1.json`, whose coverage omitted the 15 shuffle segments). Originally: finish direction 1: inspect the concentrated AMZ rows, same-ms discrepancies and actor membership; calibrate angle units/axis using independent evidence. Measure sampling coverage per round/player/time, not just event-pair quantiles. Use the same recorded file set first, without overwriting artifacts.
3. **Reported** in “Direction 1 result”; the store/consume decisions are the user's and still open. Originally: report whether facing can be preserved as an observed fact and what must remain unknown. Do not implement a tactical-facing accusation or assume camera/target intent. A decision to store a field is separate from a decision to coach on it.
4. Then proceed to skipped state fields, resource flows, NPC lifecycle, equipment/dynamic talents one direction at a time. Larger scans follow explicit definitions and stable denominators; no per-match model calls.

**Prior direction decisions remain in GitHub:** #70 describes observed consequences without unsupported causation; #68 alternative-play suggestions approved in principle but deferred; #69 broader positive feedback approved but low priority; #77 conservative whole-round usage statistics and death-review control-as-peel options, without claiming the control would save the victim; #82 stays open and, if pursued, must become more conservative. #66 trinket decision design was introduced but **not ruled on**. The user then replaced that coaching-decision queue with this data-layer audit. Do not resume that old queue by default.

**Verification already performed:** original/reusable pilot JSON deep equality; all-workspace typecheck after the inventory script; eval typecheck and lint after the facing script; whitespace checks. At handoff, full `npm run presubmit` also passed (lint with warnings, doc-command checks, workspace typechecks/tests, verify:vision with zero divergences, production build). This does not certify comprehensive corpus correctness. To discuss with the same Claude again, session `3ec89cdd-5b66-45d5-8135-25782e4f777f` was the local Opus 5 session, but its agreed findings and rejected claims are already recorded above; resuming it is optional.
