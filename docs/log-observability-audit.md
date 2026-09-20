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

**Current conclusion:** preserving the actor's observed orientation with timestamp/provenance is a credible data-layer direction. “Facing target X”, continuous facing, camera direction and tactical judgements remain unapproved/unvalidated. Outstanding checks are independent axis/unit calibration, the 15 third-actor casts, same-ms discrepancies, and round/player/time-weighted gap coverage. No product changes were made.

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

**Last follow-up, not yet classified:** inspecting the 15 actor-neither-endpoint rows found that all are `SPELL_CAST_SUCCESS`, spell **145629 / Anti-Magic Zone**, source GUID `0000000000000000`, with a Player advanced actor different from the Player destination. They occur in two sampled files. This identifies a concentrated event shape, not a proven parser bug, ground-target coordinate, or ownership explanation. The next agent should inspect surrounding events and actor roster membership before deciding how to interpret it.

**Private artifacts:** `$GLADLOG_EVAL_HOME/reports/log-observability-2026-09-19/` contains `pilot.json`, `committed-script-replay.json` (deep-equal across every field and content hash), `facing-round-bounded.json` (canonical facing results cited above), the initial report and a saved diagnostic `facing-anomalies.ts`. `facing-pilot.json` is the earlier file-local prototype: it did not break pairs at round boundaries and must not supply the current gap numbers. The diagnostic script uses this machine's absolute paths; the two committed scripts are the supported rerun entry points. Keep source paths, GUIDs and raw logs private.

**Next steps, in order:**

1. Read this document, repository instructions and current Git status. Do not rerun the original inventory or the whole archive merely to regain context.
2. Finish direction 1: inspect the concentrated AMZ rows, same-ms discrepancies and actor membership; calibrate angle units/axis using independent evidence. Measure sampling coverage per round/player/time, not just event-pair quantiles. Use the same recorded file set first, without overwriting artifacts.
3. Report whether facing can be preserved as an observed fact and what must remain unknown. Do not implement a tactical-facing accusation or assume camera/target intent. A decision to store a field is separate from a decision to coach on it.
4. Then proceed to skipped state fields, resource flows, NPC lifecycle, equipment/dynamic talents one direction at a time. Larger scans follow explicit definitions and stable denominators; no per-match model calls.

**Prior direction decisions remain in GitHub:** #70 describes observed consequences without unsupported causation; #68 alternative-play suggestions approved in principle but deferred; #69 broader positive feedback approved but low priority; #77 conservative whole-round usage statistics and death-review control-as-peel options, without claiming the control would save the victim; #82 stays open and, if pursued, must become more conservative. #66 trinket decision design was introduced but **not ruled on**. The user then replaced that coaching-decision queue with this data-layer audit. Do not resume that old queue by default.

**Verification already performed:** original/reusable pilot JSON deep equality; all-workspace typecheck after the inventory script; eval typecheck and lint after the facing script; whitespace checks. At handoff, full `npm run presubmit` also passed (lint with warnings, doc-command checks, workspace typechecks/tests, verify:vision with zero divergences, production build). This does not certify comprehensive corpus correctness. To discuss with the same Claude again, session `3ec89cdd-5b66-45d5-8135-25782e4f777f` was the local Opus 5 session, but its agreed findings and rejected claims are already recorded above; resuming it is optional.
