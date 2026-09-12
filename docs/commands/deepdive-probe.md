# deepdive-probe — Deep Dive Upper Bound Experiment Runbook

Single match experiment: An agent uses the strongest model to perform an **unlimited budget** deep dive on a real match (multiple rounds of `matchExplore` queries + hypothesis verification). Its findings and the existing product pipeline's (`analysis-v2` cache baseline findings) are then blind-mixed and handed to you (the actual player of the match) for item-by-item scoring, followed by a final unblinded comparison. The goal is not to prove that "deep dive is definitely better" — it is to measure whether the deep dive can unearth findings that the baseline cannot: **real, retrospectively acknowledged, and actionable**, as well as the cost (hallucination rate, number of query rounds). Produces three things: upper bound report (what this round of deep dive unearthed), gold standard set (your item-by-item annotations, `answers.json` accumulates across rounds), and distillable list (which finding patterns are worth pushing down into the product prompt).

> **Do not draw conclusions on "whether deep dive is better" before the first game is finished.** Fixes must provide before/after numbers, experiments must provide item-by-item annotations — the sample size of one game proves nothing, accumulate the gold standard set first.

Toolchain background (Tasks 1-8, all merged into `main`): `matchExplore.ts` (ten queries + `overview`, single source predicates — gate logic recalculation also uses this), `buildReviewSession.ts` (machine pre-screening + baseline merging + blind shuffling), `dev:ui` testbed's `?review=<name>` blind review workbench (left battle report / right review panel, unblinded only after answering).

## Step 0: Match Selection Prerequisites — First Confirm Baseline is Comparable

After selecting a match (next section) and before writing the deep dive findings, **first confirm that this match already has non-empty product AI analysis results** — otherwise, the blind review session will only have deep dive cards and zero baseline cards, degrading the entire experiment into a "self-review of deep dive findings" where nothing can be compared. Real-world testing on 2026-08-12: The vast majority of matches in the local match library that have run analysis are **0-finding caches** (empty baseline), so an analysis must be re-triggered.

```bash
ls "$HOME/Library/Application Support/gladlog/matches/<matchId>/" | grep analysis-v2
```

- If the file does not exist, or exists but the "AI Analysis" tab in the product shows an empty findings list: open the gladlog desktop app → find this match → go to the "AI Analysis" tab on the right → click "AI Analysis" (or click "Re-analyze" if old results exist) → wait for it to finish.
- After running, take another look at the findings list: proceed if it's non-empty. If it's still 0 (model's occasional output was entirely discarded by audit) — switch matches, or click "Re-analyze" again to retry.
- Do not skip this step and try to make up for it later — `buildReviewSession.ts` reads the baseline cache snapshot at the exact moment the session is built (see Step 3), so the analysis must occur **before** session building.

## Step 1: Match Selection

```bash
npx tsx packages/eval/scripts/matchExplore.ts pick --min-duration 120
```

The output is a tab-separated table of the local match library (`id kind duration playerName result bracket`). Pick one match:

- `playerName` must be your own character (do not pick matches uploaded/downloaded by others — only the actual player can make the "retrospectively acknowledged" blind review judgment).
- Duration > 2 minutes (`--min-duration 120` has already filtered out short games).
- Must have deaths or obvious turning points — verify with the `overview` subcommand (one line per player, with `[Death: m:ss, …]`):

```bash
npx tsx packages/eval/scripts/matchExplore.ts <matchId> overview
```

Matches without any death records usually have nothing worth deep diving into; pick another match. For `kind=shuffle` matches, remember to include `--round N` in all subsequent commands (N is the **array index** of `doc.data.rounds`, not `sequenceNumber` — the two are not necessarily equal, as shuffle swaps sides every round).

Once selected, confirm Step 0 is complete (the matchId has a non-empty baseline cache) before proceeding.

## Step 2: Deep Dive Agent Opening Prompt (Can Be Pasted in Full)

Start a **new session**, specify the **strongest available model** (do not use the default economy tier for batch subagents), and paste the whole block:

> You are a WoW Arena deep dive analysis agent. Task: Perform an **unlimited budget** deep dive on a real 3v3/2v2/solo shuffle match, finding things that the product's existing AI analysis pipeline is highly likely to miss — not repeating obvious information like "who dealt the most damage", but rather causal chains, misjudgments, and timing windows that require cross-validating multiple data dimensions (HP, distance, LoS, CD, auras, CC chains, spell flow).
>
> **Data Access Method**: The only channel is the CLI below. Fabricating any timestamp, HP value, distance, or spell name from memory/speculation is strictly prohibited — every specific fact you intend to write into the final output must point to the output line of a real invocation.
>
> ```bash
> npx tsx packages/eval/scripts/matchExplore.ts <matchId> [--round N] [--store <dir>] <subcommand> [flags]
> ```
>
> matchId = `<substitute id selected in Step 1>`; if shuffle, `--round <substitute selected array index>`.
>
> | Subcommand                         | Params                                                                       | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
> | ---------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `overview`                         | None                                                                         | One line per player (faction/death timestamp) + duration                                                                                                                                                                                                                                                                                                                                                                                                       |
> | `cd --t S`                         | S=seconds                                                                    | Major CDs ready/on CD (remaining seconds) for each player at time S                                                                                                                                                                                                                                                                                                                                                                                            |
> | `hp --t S`                         | S=seconds                                                                    | HP% for each player at time S                                                                                                                                                                                                                                                                                                                                                                                                                                  |
> | `hpcurve --from A --to B --step N` | Range + step                                                                 | Point-by-point HP% curve in range (multi-line, equivalent to multiple `hp`)                                                                                                                                                                                                                                                                                                                                                                                    |
> | `auras --t S`                      | S=seconds                                                                    | Aura list for each player at time S                                                                                                                                                                                                                                                                                                                                                                                                                            |
> | `pos --t S`                        | S=seconds                                                                    | Distance (yd) from you (owner) to each other player + LoS (clear/blocked/unknown)                                                                                                                                                                                                                                                                                                                                                                              |
> | `dr --from A --to B`               | Time range                                                                   | Two-way CC chains in range (caster→target, including DR tier, duration)                                                                                                                                                                                                                                                                                                                                                                                        |
> | `flow --from A --to B`             | Time range                                                                   | Spellcast ledger in range (who cast what at what time)                                                                                                                                                                                                                                                                                                                                                                                                         |
> | `gaps`                             | None                                                                         | Missing healing windows for each friendly healer                                                                                                                                                                                                                                                                                                                                                                                                               |
> | `mana --unit X [--from A --to B]`  | Unit name (exact or substring) + optional range, defaults to the whole round | Decimated mana trajectory (peaks/troughs + endpoints), terminal mana at `--to`, OOM windows (<10% mana), and rejected-cast list (time/spell/reject reason) for that unit                                                                                                                                                                                                                                                                                       |
> | `drink [--min-gain N]`             | Optional minimum mana-gained filter, default 0 (no filtering)                | Both sides' healers' mana-rising segments, sorted by mana gained descending within each healer (start/end, mana gained, whether a damage event landed on that healer during the segment or ≤1s after — note the underlying predicate also catches ordinary in-combat mana regen, not only literal drink-item use; the descending sort puts genuine sit-and-drink segments — an order of magnitude larger than regen ticks — at the top of each healer's block) |
>
> All times must be in **render seconds** (the integer seconds corresponding to `m:ss`, do not use raw timestamps with decimals — the query internally already `floor`s to the render grid, and any floating-point seconds you provide will be treated similarly. But to ensure subsequent evidence lines can be reproduced exactly, pass integers directly).
>
> **Discipline (Mandatory Sequence, No Skipping Steps)**:
>
> 1. Run `overview` first to read the whole match skeleton (death times, duration).
> 2. For each death/turning point, propose **specific hypotheses** (e.g., "Was B's damage reduction CD on cooldown before A died", "Did C leave LoS cover before being focused", which are questions that can be directly verified using a subcommand).
> 3. Query the data rows using the corresponding subcommand to verify or refute the hypothesis. **A single hypothesis may require cross-referencing two or three subcommands** (e.g., `cd` to confirm a CD state + `pos` to confirm distance/LoS + `hp` to confirm damage taken).
> 4. If verified → write it as a claim (see output format below); if not verified → abandon this hypothesis, do not force evidence together, and do not downgrade to a vague statement just because "you already looked it up".
> 5. **Stopping criteria: Stop if two consecutive rounds (two loops of "propose hypothesis → verify") yield no new claims that pass verification.** Do not dig forcefully just to make up numbers. The value of a deep dive lies in the hit rate, not the quantity.
>
> **Depth Benchmark (Anything below this line does not count as a deep dive)**: A single data reading ("Someone's HP is 74% at 1:30") by itself **is not** a finding — the player can see the health bar at the time. Cards like this will be judged as "I knew it at the time / too generic" by the reviewer. A qualified finding is a **counterfactual causal chain**: damage could have been avoided, CC could have landed, CDs could have been traded.
>
> **The following perspectives are seed examples of depth, not a checklist** — the possibility space cannot be exhausted, and your value lies precisely in proposing new hypothesis types outside of these three; any hypothesis where the "factual leg can be verified via query", regardless of whether it belongs to the listed perspectives, should be proposed. Run this hypothesis template at least once for every moment of heavy damage:
>
> 1. Use `hpcurve` to find time t when HP plummeted;
> 2. Use `flow --from t-6 --to t` to see whose spell this damage came from — is it a casted ability?
> 3. Use `cd --t t-5` to check which of your (and your teammates') countermeasures were ready at that time: spell reflection / interrupt / CC / damage reduction / external;
> 4. If the countermeasure is a CC: use `dr --from t-15 --to t` to check the DR tier of that CC category for the opponent, and whether a full CC could land; then use `flow --from 0 --to t` to scan the opponent's **trinket (Gladiator's Medallion)** cast record across the whole match — when was it last used, and based on cooldown, was it on CD at time t (a CC while the trinket is on CD is a deadly CC);
> 5. Only drop the claim if the full chain is established: "Your spell reflection was available at t-4, the opponent's trinket was used at t-40, this cast could have been interrupted — this damage was avoidable", attaching the evidence line of the corresponding query for each step.
>
> Similarly, deduce in reverse on the defensive side: the burst that killed you, could you/your teammates have stopped it with ready survivability, interrupts, or anti-CC 3-5 seconds ago? If you cannot dig out a moment with this depth, it's better to write nothing.

> **Norm Source Discipline (Solidified 2026-08-14 after four cross-spec misattribution cases)**: Every "should do X / shouldn't do Y" must self-answer which level the norm comes from — (a) Universal mechanics (e.g., what skills can be pressed while CC'd — **first check the `usableWhileStunned` predicate / `usableWhileCcGenerated.ts` generation table** (`packages/analysis/src/utils/cooldowns.ts`, official DB2 bit flags ∪ gap layer, spell facts foundation project officialized 2026-08-14). Only for skills not found in the table are you allowed to mark them as prior knowledge, you must not qualitatively claim "cannot be pressed while stunned" from memory); (b) Specialization norms (must match the reviewed player's actual specialization, do not use Feral Druid's Moonfire norms to evaluate a Resto Druid); (c) **Build norms (must be verified using COMBATANT_INFO to decode the player's talents** — Unwavering Resolve turns Divine Protection into a high-frequency rotational damage reduction, hoarding CD norms flip with the build); (d) Playstyle choices (sticking close vs staying far away, can only be written as decision point card suggestions, and must not be qualitatively marked as errors). Normative conclusions without a specified source level cannot become a card. **Mechanic-level "what can be pressed while CC'd" assertions must check the table first (`usableWhileCcGenerated` + `curatedAbilityFacts.ts` sign-off book), and mark as prior knowledge only if not found** — The very first blind review of deep dive on 2026-08-12 fell into this pit: a mechanical misjudgment that Divine Shield "cannot be pressed while stunned". The truth is that mechanically it can be cast under any CC state; the problem lies in the cost norm layer (a five-minute ultimate should not be pushed as a regular CC-blocking means, see `docs/BACKLOG.md` #25). **No-response conclusions must check the CAST_FAILED intent stream first** (#26 intent guard, `rawStreams.ts`'s `castFailedInWindow` — surfaced directly by `matchExplore`'s `mana` subcommand's rejected-cast list) — "did not press" and "pressed but rejected" look identical in the log; only the former is CD-hoarding/abandoning a teammate, while the latter is a genuine attempt blocked by silence/GCD/range — conflating the two under the same defeat narrative misjudges an action the player genuinely pressed as if nothing had been pressed at all.
>
> **The Second Perspective: CD Economy Alignment (horizontal across the match, not anchored to a single moment)**. Use `flow --from 0 --to <full match>` to sweep out the cast times of major CDs (three-minute offensive / crucial defensive) for both sides, and cross-check: when the opponent popped their burst, was your corresponding level countermeasure/defensive exactly on CD (`cd --t t` to see remaining seconds)? If so — look back for the time you previously cast it, was that cast worth it (was there real pressure at the time, verify with `hpcurve`/`flow`). For conclusions like "Your three-minute didn't align with their three-minute", the evidence chain = your previous cast time + low pressure then + opponent burst time + your remaining CD seconds + teammate health line result. All five legs can be checked.
>
> **How to write a decision point card (fact/judgment separation)**: For choices like which defense line a healer chooses under pressure (20% DR aura + burst healing to stabilize, versus popping immunity/external transfers directly), the machine cannot verify which is "better" — you are not allowed to write "should have cast X" as a fact. Correct format: Put all factual legs onto evidence (At time t, A and B are both ready `cd`; what spell from whom is the incoming damage `flow`, judge for yourself whether it's magic or physical; how much did the health line drop `hpcurve`; actually cast A `flow`), and then explicitly write "B might be a safer choice, because..." as **coach's advice** (use phrasing like "could consider / safer" in the claim), letting the blind reviewer judge the advice itself using "actionable / would do it". For opponent behavioral adaptations and cross-window resource global ledgers that cannot be deduced without a simulator, do not write them. **For skills listed in cost_norm (Divine Shield / Ice Block, etc., check the `kind === "cost_norm"` entries in `curatedAbilityFacts.ts`), the "should have cast X" suggestion must carry a cost note** — these skills can mechanically be cast at any time, but cost norms prohibit pushing them as normal reactions (a five-minute ultimate should not be suggested to block a normal CC chain). A "should have cast Divine Shield" suggestion without a cost note belongs to the same motif as the misjudgment mentioned at the beginning of this section (`#25`).
>
> **The Third Perspective: Pacing/Positioning Style and Composition Match Signature (Strategic Level)**. First, use `flow`/`dr` to judge the style of the opponent's and your team's DPS: high target switching frequency, CC chains dumped on multiple targets = fast-switch style; sustained, even damage, little switching, opponent's health long under pressure = raw output suppression style. Then, sweep `pos` across the match at 10-15 second intervals to get a distance portrait of the healer (owner): healing from afar the whole time, or sticking close and participating. Cross-reference the two to find a mismatch signature — for example, if your team is a fast-switch style while the healer stays at 30+ yards all game (teammates have to pull back to find the healer, interrupting their own offensive pacing), or the opponent is a raw output style while the healer frequently pushes forward (taking risks when they should ensure stable error tolerance). Once the mismatch signature is complete, write it as a decision point card: put all signature legs onto evidence, and write "should pull back / should stay far" as a suggestion. **Note two things**: (1) For a single game, you can only say "a mismatch signature appeared in this match", you are not allowed to elevate it to "your habit is..." — habits require cross-match corpus to be established; (2) **Mana/resources ARE available via the `mana`/`drink` subcommands** (BACKLOG #26 Task 5, landed 2026-08-15 — raw.txt's per-event mana stream + SPELL_CAST_FAILED rejection reasons, both read through the single-sourced `rawStreams.ts`; see the subcommand table above): `mana --unit X [--from A --to B]` returns a decimated mana trajectory, OOM windows, and rejected-cast reasons for one unit; `drink` returns both sides' healers' mana-rising segments. CLI-based deep dives may now cite mana/resource facts — the Ironclad Rule for Evidence Lines below still applies in full, so every mana claim must point to an exact verbatim `mana`/`drink` output line, never a number recalled from memory or extrapolated from a raw.txt grep.
>
> **Output Format**: Write the final result as a JSON file. The content is `DeepFindingInput[]` (TypeScript type definition from `packages/eval/src/explore/reviewTypes.ts`, copied exactly):
>
> ```ts
> export interface EvidenceRef {
>   cmd: string; // e.g. "hp --t 90"
>   line: string; // the exact row from that query's output that proves this claim, copied as-is
> }
>
> export interface DeepFindingInput {
>   claim: string; // write the finding clearly in natural language
>   anchorT: number; // the time this finding is anchored to (seconds, render seconds)
>   unitNames: string[]; // full names of the units involved (matching names from outputs like overview/hp)
>   evidence: EvidenceRef[]; // one or more query evidences supporting this claim
>   severity: "high" | "med" | "low";
> }
> ```
>
> **Ironclad Rule for Evidence Lines**: `evidence[].line` must be an **exact verbatim line** from the output of an actual call (no rewriting, no merging multiple lines, no unit conversions). `evidence[].cmd` is the parameter string of the call that produced this line (e.g., `"hp --t 90"`, corresponding to what you actually typed: `matchExplore.ts <matchId> hp --t 90`). If you cannot produce such an evidence line for a conclusion — you are not allowed to put it in `claim`. After writing, self-check: can you paste every `evidence.line` back into the output of re-running the corresponding `evidence.cmd` and find it word-for-word? If not, delete that claim or correct the evidence line.
>
> Write the final JSON array to: `$GLADLOG_EVAL_HOME/review-sessions/<name>.deep.json`
> (Defaults to `~/code/gladlog-eval-private` if `$GLADLOG_EVAL_HOME` is unset; `<name>` is a name you and the user agree upon for this experiment round, recommended `YYYY-MM-DD-<first 8 chars of matchId>`).

## Step 3: Build + Review + Unblind

After the deep dive agent finishes writing `<name>.deep.json`:

```bash
# Machine pre-screening (re-runs runQuery on every evidence cmd, checks if the line hits verbatim)
# + merges baseline findings for that match (the cache confirmed non-empty in Step 0) + blind shuffling
# Uses the same --round semantics as Task 1 loadLegacyRound (array index)
npx tsx packages/eval/scripts/buildReviewSession.ts --name <name> --match <matchId> [--round N]
# Output: wrote .../review-sessions/<name>.session.json (N cards)
```

`buildReviewSession.ts` has already re-run every deep dive evidence piece through pre-screening (`verified`/`mismatch`/`unverifiable`), but the terminal will not print the results — the pre-screening verdict is only shown in the UI after you unblind (even you won't see it during the blind review, this is by design, not an omission). Start the testbed:

```bash
cd packages/desktop && npm run dev:ui   # Stays in background, http://localhost:5199/
```

Open `http://localhost:5199/?review=<name>` in your browser and blindly review each card (it will not show whether the card comes from deep dive or baseline, nor will it show the pre-screening verdict, until you have answered all cards).

> **Known Weak Blindness (Approved by user on 2026-08-12)**: The two pipelines naturally have different card writing styles / evidence formats (baseline is "Title - Explanation" + candidate fact key-value pairs; deep dive is prose + CLI output lines), so the source can be inferred by looking closely at the styling. The reviewer is aware and self-disciplines to score based on content, evaluating it as a real-world use scenario, without unifying the format. Keep this bias in mind when interpreting the unblinded comparison.

For each card: Click the timestamp to jump to the battle report replay on the left to verify the moment. After answering the five questions (Is it true? / Were you aware of it? / Is the advice actionable? / Will you follow it next time? / Impact on win/loss), it auto-saves and flips to the next card (POSTed to disk at `<name>.answers.json`, supports resuming — refreshing the page will not lose answered items). Once all are answered, the panel automatically switches to an unblinded summary (Deep Dive vs Existing Pipeline: total / answered / verified new findings count, plus a 5-dimension distribution comparison table).

> The "AI Analysis" tab button on the left battle report page will stay stuck on "Analyzing..." in review mode — the testbed uses a mock analysis backend, this button is not connected to the product analysis pipeline. It is not a bug, do not click it waiting for results: the real review actions are entirely within the cards on the right.

```bash
cat "$GLADLOG_EVAL_HOME/review-sessions/<name>.answers.json"   # Raw item-by-item annotations, the core of the gold standard set
```

## Step 4: Reference Layer (No Rulings Made, Displayed Side-by-Side Only)

The conclusions of this layer **cannot** be used to rule "deep dive won / lost" — it is just to leave some circumstantial evidence for the ledger in Step 5. The true ruling power lies in your hands (the blind review in Step 3).

**A second AI independently reviews the deep dive findings once** (checks if the evidence chain holds up, without looking at your annotations) — codex gpt-6-astra, falling back to agy only when codex is out of quota; the output's header line records which backend actually ran:

```bash
node ~/.claude/skills/cross-ai/scripts/cross-run.mjs review \
  --files "$GLADLOG_EVAL_HOME/review-sessions/<name>.deep.json" \
  "Check item-by-item whether the evidence for these claims actually supports the claim (instead of citing line-of-sight while the conclusion is about distance, etc.), and mark the items where you think the evidence is insufficient or over-inferred." \
  > "$GLADLOG_EVAL_HOME/review-sessions/<name>.xai-review.txt" 2>&1
```

**Seven-dimension judge runs as usual** (Treats the deep dive findings as a "reply", applying the 3-pass scoring method from Step 3 of `docs/commands/eval-baseline.md`, using only the `accuracy`/`inferenceScaffolding` dimensions as reference — sufficiency / noise / labelBias / outcomeAlignment / focusCalibration were designed for a coach reply style, and are meaningless when applied to a set of discrete claims, do not force-fill them). This step is an optional re-anchoring and can be skipped if short-handed; it does not affect the blind review results of Step 3.

## Step 5: Single Match Wrap-Up — Update the Ledger

Regardless of whether Step 4 was done, **this step cannot be skipped**: The score/session files will be overwritten by the next round of experiments, and the ledger is the only record that accumulates across rounds. **Append a prose section to `$GLADLOG_EVAL_HOME/ledger.md` dated with this round's date** (`## <YYYY-MM-DD> deep-dive probe — <name>`, append-only, do not modify old lines), covering the fields below in sentences. This matches what the 2026-08-12 and 2026-08-14 rounds actually wrote: the ledger has **no** `## Deepdive probe runs` table and never had one — a deep-dive round produces one match's worth of narrative (what the dive found that the baseline missed, where the blind reviewer disagreed) that a fixed-width row cannot hold. Do not create the table now; a table with two rows in it and the real findings in prose beside it is worse than either.

Cover every one of these, in order:

| Field                 | Content                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Date                  | Date of this round                                                                                                 |
| Name                  | `<name>`                                                                                                           |
| Match                 | matchId (+ round, if shuffle)                                                                                      |
| Deep cards            | Number of deep dive cards                                                                                          |
| Baseline cards        | Number of baseline cards (the non-empty cache confirmed in Step 0)                                                 |
| Deep Verified New     | "Verified new findings" count in the Deep Dive column of the unblinded table                                       |
| Baseline Verified New | Same as above, for the baseline column                                                                             |
| Deep Hallucinations   | Number of items with `truth=false` among deep dive cards                                                           |
| Notes                 | One sentence: what this round's deep dive found that baseline missed, any divergence in the Step 4 reference layer |

## Notes

- No external API keys are used throughout the process (the deep dive agent is a standard Claude Code/agy/Codex session, and product analysis uses the desktop app's built-in model config).
- Once `<name>` is set, do not change it halfway — the three files `session.json`/`answers.json`/`deep.json` align via filename, renaming means losing the resume capability.
- `?review=` is an exclusive entry point for the `dev:ui` testbed; it does not enter `dev/scenes.ts`, does not enter the visual baseline, and this route does not exist in the production desktop app.
