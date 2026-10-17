/** Version key of the analysis cache: the main process writing the cache, the
 *  main process reading it, and E2E seeding it all share this one constant.
 *
 *  Single-source predicate — a hardcoded copy fails silently on a version bump:
 *  getCached discards the cache, the panel sits idle, and E2E only reports the
 *  undirected failure "there are no findings".
 *
 *  Bump when prompt text or the candidate menu changes; one bump per batch.
 *  Full history in docs/prompt-version-history.md (append new entries there);
 *  the last few entries stay inline so a reader sees the format:
 *
 *  v396 (2026-10-15, FT, agy 40-FT-96, user 「落地」): a CC an enemy pet
 *  broke is broken by damage, not an uncleansed window (a BROKEN row's
 *  source is the breaker). 605 files: missed-cleanse +1 / −2.
 *  v397 (2026-10-15, FT, work order 6 Part 1 — facts only): a burst's
 *  extra another enemy pressed names that enemy; [BUFF FADED] reads the
 *  copy on the unit the press was on and states a logged break; the
 *  death-setup chain prints each entry's span and [HEALER CC] the free time
 *  between runs; legends: [STATE] `dead` in the death second, [RES] as of
 *  m:ss.0 and `cc:`, msw alsoHeldAt, "defenseless" is the target's own;
 *  [BURST ANSWERED] names a second friendly death; a Stasis release after
 *  a kick is the player's press, not a replay. 605 files: no candidate
 *  added or removed.
 *  v398 (2026-10-15, FT, agy 40-FT-98 — facts only): each press of a
 *  buff reads its own target's copy (a removal one press stepped over
 *  stays for the next); the death-setup chain lists kick lockouts and
 *  [HEALER CC] counts a lockout between two CCs as locked, not free. 605
 *  files: no candidate added or removed.
 *  v399 (2026-10-15, FT, agy 40-FT-99 — facts only): a buff pressed again
 *  on the same unit while up was refreshed — no [BUFF FADED] line of its
 *  own, and the copy that ends is the refreshing press's. 605 files: no
 *  candidate added or removed.
 *  v400 (2026-10-15, FT, work order 6 Part 2 n37, user 「按你的建议走」): a
 *  burst's pressured friendly is the one the burst hit who died inside the
 *  window (the first to die), else the lowest HP. 605 files:
 *  slow-defensive-response −1.
 *  v401 (2026-10-15, FT, agy 40-FT-101 — facts only): a dead pressured
 *  friendly has no self-save after its death and is not read kiting off
 *  its corpse; the [BURST ANSWERED] legend states the pressured pick and
 *  the control rule exactly. 605 files: no candidate added or removed.
 *  v402 (2026-10-16, data refresh 12.1.0.69587 → 12.1.5.70391, user
 *  「可以先把数据刷新做一下」): every DB2 generator re-run at the new build
 *  (hotfixes through 2026-10-15). Printed numbers move where the game moved:
 *  Nature's Swiftness with Call of Ohn'ahra +30 s (DB2 −60; the hand −30
 *  that duplicated DB2 is removed), Ice Block +30 s (Winter's Protection
 *  PvpMultiplier 0.5), Merithra's Blessing is Arcane (castable in a Nature
 *  lockout), PvP taunt / Ox Kick / Dark Simulacrum cooldowns, several
 *  defensive durations; Ice Cold's node spell is 414658 and its presses stay
 *  Ice Block's. Data stands for the current build on logs of any date (user
 *  ruling). 605 files: cd-hoarded −1, kick-priority-team +2,
 *  kick-priority-missed +1 (one new kill window: Ice Block on cooldown).
 *  v403 (2026-10-16, user ruling 「沉默本身其实是一种控制。打断的话，实际上
 *  主要是一个 cooldown trade-off 的问题」 — facts only): one "is this a kick"
 *  predicate (`isKickSpellId`) for every reader that counts or audits kicks;
 *  Garrote - Silence, Strangulate, Spider Venom and Tightening Grasp are
 *  silence auras with no school lockout and leave it. A DK's own Strangulate
 *  presses no longer sit in the kick audit (they stay as [SILENCE] / [CONSEQ]
 *  control lines), and the stats table stops counting them as kicks. 605
 *  files: no candidate added or removed; 93 files change — 249 Strangulate
 *  entries leave the `Kicks:` lists (237 silenced, 12 hit nothing) and the
 *  12 matching `[KICK] your Strangulate … hit nothing` lines go.
 *  v404 (2026-10-16, F15 batch 1 — fact1215 deep dive C6 + C1, user-approved
 *  605 preview 「Defensive,接受候选变动」/「接受」): three major cooldowns had no
 *  friendly ledger row — Time Stop 378441 (Evoker roster, Defensive), Incarnation:
 *  Tree of Life 33891 (Druid roster, Utility: the healer save table strips its
 *  Defensive tag for Restoration Druid) and Havoc Metamorphosis (pressed as the
 *  200166 landing → 191427 via SPELL_CANONICAL_IDS). Flameshaper Obsidian Scales
 *  cast on an ally is read from the ally's own copy (`allyCopyRecipient`): the
 *  `[YOU] [CD]` / `[TEAM] [CD]` line names the ally, `[ENEMY DEF]` prints the ally
 *  copy as an external, cd-hoarded's teamAnswered counts it, and ABILITIES INTO /
 *  KILL ATTEMPTS / `defenseless` spans do not read the 15 % copy as a wall. 605
 *  files: cd-waste +8 and cd-hoarded +8 (Time Stop held / never pressed; 5 more
 *  rows' facts change), missed-sync-window +4 net (+7 / −3, friendly
 *  Metamorphosis now seen); lines: [ENEMY DEF] ally Obsidian Scales 0 → 73, press
 *  lines naming the ally 0 → 102, ABILITIES INTO into Obsidian Scales 145 → 81,
 *  Time Stop press lines 1 → 108, Tree of Life 185 → 652, Metamorphosis 0 → 377.
 *  v405 (2026-10-16, F15 batch 2 — fact1215 R1, user ruling relayed by
 *  round1+2: 「我现在只关心事实层的东西」 — every printed "lowest / low / team
 *  min" is the true minimum; point readings keep the 2026-09-23 last-line rule):
 *  `hpTroughInWindow` reads every line of an instant (a hit and the heal it
 *  provoked share one ms — 332b9b2f printed 43 % over 36.8 %); the `[KILL
 *  WINDOW]` team min reads `hpTroughInEventSpan` instead of whole-second ticks
 *  (8cd58545 `team min HP 33%` over a paladin at 3.8 %); `[CD PRIOR]` "bottomed
 *  at" prints the dip's trough (its ranking and gating stay on the grid).
 *  Deliberately unchanged (predicate-index "Not yet unified"): `[SLACK]` /
 *  `[CONTESTED]` team min (the grid band IS the segment), an event span's
 *  first-second tick (62fdbf2e), `hpAtPress`. 605 files: no candidate added or
 *  removed; 49 rows' HP facts move (kick-eaten 25, missed-sync-window 14,
 *  slow-defensive-response 7, position-mistake 3); troughFactScan: [DMG SPIKE]
 *  lows below the log 310 → 0 of 9,468, [KILL WINDOW] team min 2,224 → 0 of
 *  3,891; two burst target lines gain a `(low …)` the same-ms dip now clears.
 *  v406 (2026-10-16, F15 batch 3 — fact1215 R2 + R3, facts only): a pet's
 *  dispel names the pet (`dispelActorLabel`: `5(AWarlock)'s pet` on [PURGE] /
 *  [ENEMY PURGE] / [ENEMY CLEANSE] / [MINOR DISPELS], as the [KICK] lines
 *  already did); what a PvP trinket press removed — the [ENEMY TRINKET] line
 *  falls back from a CC to a disarm (`findBrokenDisarm`, the friendly line's
 *  fallback) to a silence (`pressEndedSilence`, now the [SILENCE] tail's one
 *  predicate, and enemy silences read the enemy's own presses); a press logged
 *  after a removal the log gives another cause for (a damage break / a dispel,
 *  `ccEndedByLoggedCause`) does not take that CC; KILL ATTEMPTS counts every CC
 *  a press ended (`ccsRemovedByPress`), not only the bound one. Deliberately
 *  unchanged: roots (a judgment), an enemy's reflected Cyclone (NYU). 605 files:
 *  no candidate added or removed; breakFactScan: pet dispels credited to the
 *  owner 1,952 → 0 of 2,438, enemy trinket presses that removed our CC /
 *  disarm / silence with no `out of` 356 → 0 of 7,966, trinket credited after a
 *  logged break / dispel 15 → 0 of 73; KILL ATTEMPTS `target trinketed out`
 *  11 → 206 lines.
 */
export const PROMPT_VERSION = 406;
