# Wave 5 handoff (2026-11-21)

Handoff for the next fix wave. It packages everything wave 4 left open plus GH #225 and GH #227. Fix lanes run on Claude Fable 5.2 (maintainer, 2026-11-21); codex fills in only while Claude quota is short. Reviews stay with codex. From this wave the WSL foreman assembles and pushes batches itself (eval-private `pipeline/PROTOCOL.md`).

## 0. Where things stand

- `main` = `309ff9fb7` = **v0.1.44**, `PROMPT_VERSION` 662. Wave 4 (PV574 → 662, 88 batches) is fully landed and released. Its notes are in `CHANGELOG.md`.
- There is no fix work in flight. Every lane worktree is gone. The only WIP is on the private lanes remote: `lanes/tk/T188-wip` at `5ce03a8b1`.
- Ticket records (history, attempts, codex review notes) live in the private eval repo, `$GLADLOG_EVAL_HOME/pipeline/tickets/T<nnn>.json`. Read a ticket's JSON before starting it. This doc only summarises.
- The 605-file regression capture of current main is `$GLADLOG_EVAL_HOME/runs/batch-checks/caps/e26df660a/`. The capture was taken at `e26df660a` (B191); the release commit after it only touched the version and changelog. Use it as the "before" for every ticket.
- The full 63 k-match archive is **not** local any more; only the 605 are. The GH #115 regeneration (§2.F) has to pull it from Drive first (`$GLADLOG_EVAL_HOME/DRIVE-BACKUP.md` has the command; about 42 GB).

## 1. Read before touching code

1. `CLAUDE.md`: every rule applies to codex exactly as to Claude. These are the ones that bite most:
   - Shared-Predicate (analysis and the gate share one predicate, anchored to the rendered value, with the five signed exceptions);
   - Verification (before/after numbers under one criterion);
   - Curated-List Completeness (every hand id table registers in `curatedIdRegistry.ts`);
   - Game-Behaviour (DB2 + mask + corpus, patch upward only);
   - Value-Gate (no new accusation type without the maintainer).
2. `docs/predicate-index.md`, before writing any new analysis↔gate pair. Its "Not yet unified" section lists known duplicates. `packages/eval/test/predicateIndex.test.ts` pins every symbol.
3. `.claude/skills/analysis-dev/SKILL.md` and `.claude/skills/desktop-dev/SKILL.md`: the engineering conventions.
4. `docs/rule-history.md`: read it when a rule looks too strict, not before following it.

## 2. Scope

### 2.A Ready tickets carried from wave 4 (do these)

| Ticket | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Files (start here)                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| T190   | Defy Fate (Chronowarden cheat-death) is missing from the cheat-death registry, so its proc has no `[PROC]` line. Do a forward check of the registry against DB2 for other missing cheat-death talents.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `context/timelineSections/friendlyCheatDeath.ts`, its registry, `data/curatedIdRegistry.ts`                              |
| T189   | Press HP for an effect aura whose press is a different trigger spell: the trigger's own heal, logged before the cast row, is not recognised as the press's heal (Peaceweaver prints `100 %`; the unit was at 94 % before Restoral). Same predicate as T188; do it after T188.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `context/timelineSections/enemyDef.ts`, `utils/cooldowns.ts`                                                             |
| T235   | Kill attempts: `broke out (X)` / `target trinketed out` must also name a co-occurring `saved by external (Y)` (user ruling R98; 40 of 235 changed lines lost their external in the B164 check).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `utils/killAttempts.ts` (~L1649 outcome assembly)                                                                        |
| T166   | KILL ATTEMPTS residue: the named press lands 2–14 s after the bracket opens (17 lines, 6 facts). Separately, `Target had a major defensive up` names a school-limited wall (Anti-Magic Zone) whatever schools the burst had.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `utils/killAttempts.ts`                                                                                                  |
| T193   | Virulent Plague / Dread Plague run 18 s for an Ebon Fever holder while the model says 24 s (163 of 169 `shortenedDuration` rows). Game-Behaviour Rule: talent from COMBATANT_INFO, DB2 first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `data/spellEffectData.ts`, `utils/buffDuration.ts`                                                                       |
| T225   | The control-aura forward scan covers only DB2 aura types stun / fear / confuse / charm. Extend it to pacify-silence (Hex), possess (Mind Control) and the remaining control aura types, regenerate the `ctrlAura` column and rescan the 605. Also register `scan5/t125.ts`'s hand `RULED_OUT` list in `curatedIdRegistry`, and fix t125's `false` = "does not take control" overclaim.                                                                                                                                                                                                                                                                                                                                                          | `spellMechanicsGenerated` (ctrlAura / `auraTakesControl`), `scan5/t177`, `scan5/t125`                                    |
| T192   | 451 `ended after` lines with an unknown spender. Decide them from DB2 `ProcCharges`; this needs a generated table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | data (new generated table), the `ended after` producer                                                                   |
| T194   | Count-first bundle of 14 items: one deterministic 605 count each, fix only what is actually wrong. The items are GH #218 (2.7, 2.10, 3.6, 5.3, 6.5), #173 (35, 50), #179 (7, 14), #207 (6, 8, 9, 12) and #199 (4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | new `scan5/t<nn>.ts`; product files per finding                                                                          |
| T237   | Round end disagrees: `combat.endTime` and `roundEndMs()` differ in 798 rounds on the 605 (791 have endTime later; median 2.0 s, max 2.3 s). T228 / T234 stop at endTime, about 2 s after the Solo Shuffle decisive death. Count what each choice moves, then **ask the maintainer which one is the round's end** before unifying. It is registered in predicate-index "Not yet unified".                                                                                                                                                                                                                                                                                                                                                        | every `roundEndMs` / `endTime` reader                                                                                    |
| T188   | User ruling A18: for a press with no HP cost, the cast row's own HP reading is the press HP; the gate predicate moves with it. Example: Dragonrage printed 79 %, the row says 83 %. **WIP exists**: `lanes/tk/T188-wip` (5ce03a8b1) has the `hpAtPress` change, 7 unit tests, `scan5/t188` and the predicate-index rows. On 20 audited logs: D30 79 → 83, 50 press lines move, menus identical. Still open: settle the id list from DB2 (Dark Pact 108416 and Alter Time return 342247 are provisional), rebase onto main, run the 605 capture, then add the CLAUDE.md signed-exception (1) sentence as its own commit. **That CLAUDE.md edit needs the maintainer's explicit approval.** Notes: `$GLADLOG_EVAL_HOME/runs/tk-CC/T188/NOTES.md`. | `utils/cooldowns.ts` (`hpAtPress`), `promptQualityCheck` (`PRESS_HP_LINE_TAGS`), `CLAUDE.md`, `docs/predicate-index*.md` |

### 2.B New triage tickets from the end of wave 4

| Ticket | What                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T239   | Desktop `GcdSwimlane` tooltip (~L203) prints a self-only buff's raw cast destination: Survival of the Fittest shows an enemy target (match `69915cc5` r1). It is the same false target T238 fixed in the prompt, in another reader. Gate it with `cdCanHelpAnotherUnit` or the spell's self-only flag.                                                                                                                              |
| T240   | Rushing Wind Kick (467307, Mistweaver) cooldown model: on 12.1.0, 1,107 of 1,574 recasts on the 605 are impossible under the 12 s model. Find the reduction or charge mechanism in DB2 + talents before touching the number.                                                                                                                                                                                                        |
| T241   | 12.1.5 cooldown models are longer than the game (from the T195 wide read). Impossible recasts: Voidblade 1480 57 / 225 (min ratio 0.637), Tiger's Fury 14 / 283, Eye Beam 14 / 582, Harpoon 10 / 99, Demonic Circle 3 / 57. Standing gaps on both patches: Discipline Penance (two charges) and Swiftmend. Patch only upward, and only with a mechanism. Check every reader that prints a `back at` / ready time from these models. |
| T242   | Range models measured short against the game (GH #227, re-measured 2026-11-21 on the 12.1.x wide set and the 605). Casts accepted beyond model + 5 yd: Sap 28.5 % (Assassination, 10 yd) / 16.5 % (Subtlety, 15 yd), Hammer of Justice ~9 % (Holy / Retribution, 10 yd), Scatter Shot 8.7 % (Marksmanship, 20 yd), Blind 4–6 % (15 yd), Prescience 13.8 % (25 yd). Also 29 placeholder ranges (≥ 100 yd) on pet kicks / CC (Spell Lock 119910, Seduction 119909, Axe Toss 119914, Intimidation 19577, Skull Bash 93985, …): first find which product readers use them, since a 50000 yd range makes "could reach" always true. DB2 mechanism first (Game-Behaviour Rule), fix in datagen, re-run `spellRangeGroundTruth.ts`, capture before / after. Line of sight needs no change (false "blocked" ≤ 0.96 % on 14 of 15 maps). |

### 2.C GH #225: audit-method pilot findings (new, from the maintainer)

- **Section B (12 confirmed defects): fix them.** Each was verified against raw log lines. Open the dossiers in `$GLADLOG_EVAL_HOME/runs/{away-pilot-2026-11-19,codex-portfolio-pilot-2026-11-21,codex-e2e-audit-2026-11-21}` for the exact lines.
  - Cheap and self-contained: the Heroic Leap 52174 ↔ 6544 alias on the press-line exact-id check (`gapClosers.ts` already accepts it); guardian CC CAST rows labelled as the owner; the Capacitor Totem window compared against `roundEndMs`; the Solar Beam `baitedKicks` double reading.
  - The first bullet (kit identity by display name, 525 duplicate groups in 469 prompts) is a new class: build its class check first.
  - The Leap of Faith press-HP bullet extends the same predicate as T188 / T189; do it with them.
  - The three "uncapped audit prompt only" bullets do not reach users. Fix them only where the fix sits in a shared predicate.
- **Section C, still present from round 14 (#222):** D5, D6 / D7, D8, D14, D16, D18 and D19. Each one's status is in the e2e run's `dossiers/recall.json`. Fix them like the B items.
- **Section A (13 ruling questions): do not decide any of them.** For each one you reach, prepare one real example (match, round, the rendered line and the raw rows) and the count on the 605, then put it to the maintainer as a short multiple-choice question. Until answered, leave the behaviour unchanged.

### 2.D GH #226: wave-4 leftovers (46 items), triage only

Most of these were recorded and deliberately left alone. Apply the wave rules:

- **Constructed-only** (codex found them on synthetic inputs; 0 on the 605): leave them recorded. Do not fix them unless a real corpus case turns up. That covers items 18, 20, 27, 29, 30, 33, 35, 36, 37, 41 and 44.
- **Pure wording** belongs to #208: items 24, 28 and 31. A _false_ statement is still fixed.
- **Maintainer calls**, to ask with an example: 2, 8, 13, 16, 17, 38, 40 and 43.
- **Fixable inside this wave** once counted:
  - 9: in-flight projectile read as "gone before the burst", 9 windows;
  - 10: Felstorm duration ignores haste, 274 runs shorter;
  - 14: seven raw-only LoS readers; decide per reader which side is the assertion;
  - 34: Ancient of Lore missing from `ENEMY_HEAL_CD_IDS`; count first, since it adds enemy lines;
  - 42: remove the `readPrintedAnswer` workaround now that T184 and T232 are both on main;
  - 46: `cdBackForPressInSecond`'s teammate half reads raw `toSeconds`; floor it like T167.
  - Item 5 is two readers missing the T153 healer-racial exclusion, with 0 cases on the 605; fix it only because it is the same fact as T153.
- **Regeneration-bound** items go with §2.F: 11, 22 (needs a wide rescan) and 26.

### 2.E Needs a ruling before any code

- **T159**: `damageInWindow` counts damage from any source in the danger score. Count first (`utils/enemyCDs.ts`, `utils/offensiveWindows.ts`, `candidates/burstWindowResponse.ts`), then ask whether only damage aimed at the unit should count.
- **T161**: an effect's span and a burst's end are read from another unit's copy of the aura. Example: the hunter's Power Infusion copy ran on after the owner's was purged (`observedEffectEnd` in `utils/enemyCDs.ts`). Ask with the example.

### 2.F The GH #115 regeneration batch (do last, once)

Several tables are stale on purpose until one full regeneration:

- T227 drops redistributed health (Spirit Link / Void Leech / Tempered in Battle) from crisis `dmg2s`. It must land together with the crisis reference-table regen, **never one without the other**. Known extra movement: B166's self-only-heal fallback flips `856fd105` r2 at 142 s.
- T230 splits or filters the Aura Mastery `[CD PRIOR]` cohort: wall presses (Devotion) versus immunity-only presses (Concentration). 27 lines on the 605.
- #226 items 11 (`burstWindowPriorGenerated` built on the old, wider `responded` set) and 26 (no Champion's Spear cell; re-check the 38-4-294 contrast row).

Steps:

1. Pull the archive back from Drive.
2. Regenerate per `docs/commands/update-wow-data.md`.
3. Land the code change together with its tables.
4. Report the moved candidate rows by ticket.

### 2.G Out of scope

- The 17 `record-only` tickets: T50, T53, T54, T56, T57, T62, T63, T66, T67, T70, T71, T82, T145, T149, T151, T229 and T236. Leave them unless the maintainer says otherwise. T149's failed-attempt patch is archived in `$GLADLOG_EVAL_HOME/runs/wsl-worktree-salvage-2026-11-21/`.
- New accusation types and new coaching signals (Value-Gate Rule): always the maintainer's call.

## 3. How to work a ticket

1. **Count first.** Write the deterministic class check before the fix: a `scan5` module under `packages/eval/scripts/` (one-off scripts don't count), or a `check*` class in `packages/eval/src/quality/promptQualityCheck.ts` when it is a prompt-text invariant. Run it on the base capture to get the "before" number.
2. **Fix at the predicate**, with every reader of the fact: search `docs/predicate-index.md` and the code for all consumers. Never relax a gate to make analysis pass.
3. **Capture and compare** on the 605:
   ```bash
   E=$GLADLOG_EVAL_HOME
   # always through the slot lock (one heavy job per slot; parallel corpus jobs have frozen the machine before)
   python3 $E/pipeline/pipe.py slot run codex "capture <sha9>" --prio branch -- \
     nice -n 10 npx tsx packages/eval/scripts/verify/capture.ts \
       --manifest $E/runs/g1-2026-11-01/manifest-605.txt --out $E/runs/batch-checks/caps/<sha9> --shards 3
   python3 $E/pipeline/tools/capdiff2.py $E/runs/batch-checks/caps/e26df660a $E/runs/batch-checks/caps/<sha9> diff.txt
   python3 $E/pipeline/pipe.py slot run codex "scan5 <sha9>" --prio branch -- \
     nice -n 10 npx tsx packages/eval/scripts/corpusFactScan5.ts $E/runs/batch-checks/caps/<sha9> --examples 2 --json full5.json
   python3 $E/pipeline/pipe.py slot run codex "gates <sha9>" --prio branch -- \
     nice -n 10 npx tsx packages/eval/scripts/verify/run.ts $E/runs/batch-checks/caps/<sha9> --out gates --scans gates --workers 3
   ```
   Every changed line in the diff must be explained by the ticket. Full scan5 must show no rise versus the base, except a new module or a kind outside the total. Gates must be 0.
4. **Report numbers** in the commit message under one criterion, for example `controlAuraNoCcLine 37/2,104 → 0/2,104; 61 lines changed, all [CC] gaining …`. If you have no number, say so.
5. **`PROMPT_VERSION`**: when prompt text changes, bump `packages/desktop/src/shared/promptVersion.ts` and add the entry to `docs/prompt-version-history.md`, in a separate `chore: PROMPT_VERSION <n> (<ticket>)` commit, as wave 4 did.
6. **Before every push**: run `npm run presubmit` from the repo root. Never `tsc -b`, never local `npm run test:visual`, never generate load to reproduce a flake.
7. **Commit straight to `main`**: no branches, no PRs. Use subjects like `fix(analysis): … (T190)` and only `git add` your own paths. If CI goes red, fix it.
8. **Bilingual docs**: `docs/predicate-index.md` and the other 12 listed in CLAUDE.md change together with their `.zh-CN.md` twin.
9. **Close the loop**: set the ticket JSON's `state` to `published` with the commit hashes, and comment on or close the GH issue items you fixed. Never put player, character or realm names or private paths in the public repo or on GitHub.

### Questions for the maintainer

Anything marked "ask" above, any choice with no defensible default, and any CLAUDE.md edit go to the maintainer. Asking them is the only approval that counts.

When you ask, the maintainer reads Chinese:

- give 2–4 options, with the recommended one first;
- include one real example: the match id, the rendered line and the raw rows;
- give the 605 count each option moves.

## 4. Suggested order

1. Small, self-contained fixes: T190 → T239 → #225-B Heroic Leap alias / guardian label / Capacitor window / Solar Beam → T235 → T166.
2. Game behaviour: T193 → T240 → T241 → T242 (ranges, GH #227) → #226-10 (Felstorm).
3. Scans and generated tables: T225 → T192 → T194.
4. The press-HP family: T188 (rebase the WIP; the CLAUDE.md sentence needs approval) → T189 → the #225-B Leap of Faith bullet.
5. #225-B kit identity class and the remaining B items, then #225-C (#222 residue) and the fixable #226 items.
6. T237 once the maintainer has answered. T159 / T161 / #225-A as answers arrive.
7. The #115 regeneration batch (§2.F), once, at the end.
