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
 *  v407 (2026-10-17, F15 batch 4 — user rulings 2026-10-17 「只读事件开始之后」 and
 *  「改成真最低」, 605 preview approved 「接受」): an event span's minimum reads
 *  only what happened inside it — `hpTroughInWindow`'s span mode counts a tick
 *  only when the sample it read lies inside the span (kick-eaten ourLow /
 *  theirLow, [CONSEQ], missed-sync-window enemyMinHpPct, [KILL WINDOW] team
 *  min; 62fdbf2e `theirLowPct=37` was the 1:51 tick read 0.5 s before the kick,
 *  the in-lockout low 43 %). STAYED IN (a burst span whose line pairs its
 *  minimum with the start second's tick) is left as it was (predicate-index
 *  NYU). [SLACK] / [CONTESTED] `team min HP` is the true minimum inside the
 *  span (`teamMinHpPctOver` → `hpTroughInWindow`), with a legend line saying
 *  the span is judged on the whole-second readings. `checkCrisisHpStateConsistency`
 *  does not adjudicate a kick-eaten trough on the lockout's edge seconds. 605
 *  files: kick-eaten −9 (12 rows leave — their only ≤ 40 % low was read before
 *  the kick — 3 kicks of the same rounds take the capped slots), 66 kick-eaten
 *  and 68 msw rows' HP facts move, [CONSEQ] 250 / [KILL WINDOW] 232 lines;
 *  troughFactScan: [SLACK] / [CONTESTED] team min above the log 502 → 0 of 919,
 *  kick-eaten lows below every in-lockout reading 70 → 12 of 790 (the 12 are
 *  the printed t / lockout rounding at the lock's last instant).
 *  v408 (2026-10-17, F15 batch 5 — fact1215 R8, 605 preview approved 「接受」):
 *  aura re-broadcasts and refreshes read as one aura. ABILITIES INTO's walls are
 *  the shared `buildAuraIntervals` (09195b87: one Time Dilation split at a same-ms
 *  REMOVED + APPLIED printed a second wall); a missed-purge window is not opened
 *  again by a re-log inside a window already emitted for the same buff (62fdbf2e
 *  Alter Time, 105-1 Power Infusion 0:18 + 0:21); an enemy cooldown pressed while
 *  its aura was already up reads that aura's end (519781fd Malevolence 1:21–1:47,
 *  not the official 20 s), and an end the builder clamped to the combat's end is
 *  no observed end (26bfd4f3 Kingsbane / 101-5 Army of the Dead `6s left`). 605
 *  files: position-mistake −4, missed-sync-window −2, kick-eaten +1 net,
 *  slow-defensive-response +1; 87 duplicate [MISSED PURGE OPPORTUNITY] lines go;
 *  ABILITIES INTO 156 lines, [RES] `s left` 2,881, burst / kill windows 132.
 *  v409 (2026-10-17, F15 batch 6 — fact1215 C2, facts only): a school-limited
 *  immunity's [ENEMY DEF] label names the schools it stops — `immune to magic`
 *  (Cloak of Shadows, Blessing of Spellwarding) / `immune to physical` (Blessing
 *  of Protection) — read off `limitedImmunitySchoolMask`, the mask KILL ATTEMPTS
 *  gates the same aura on; the legend says so (0f894aee 5:00: Cloak `immune`
 *  while 9 physical hits landed). 605 files: no candidate added or removed;
 *  4,426 [ENEMY DEF] lines change label (4,341 magic, 85 physical); new gate
 *  checkSchoolLimitedImmuneLabel 906 → 0.
 *  v410 (2026-10-17, F15 batch 7 — fact1215 C9, facts only): "is this a stun"
 *  reads the aura's official mechanic as well as its DR category
 *  (`isStunDrAura` / `isStunCcInstance`): Infernal Awakening 22703 is a stun
 *  (mechanic 12) with no DR family, and KILL ATTEMPTS said "(no stun)" over it
 *  and the [RES] `cc:` slot gave it no [stun] (0b86016f, 15b4d4ec). The two
 *  readers that hand-tested `"Stun"` (resourceSnapshot, killAttempts) read the
 *  predicate. 605 files: no candidate added or removed; 232 contexts change —
 *  KILL ATTEMPTS gains Infernal Awakening stun openers, [RES] `cc:` tags them.
 *  v411 (2026-10-17, F15 batch 8 — fact1215 C10 item 91, facts only): the burst
 *  ledger's "target had a major defensive up" matches a wall that logs under an
 *  aura id other than its cast's (`SELF_WALL_AURA_TO_CAST_ID`: Greater
 *  Invisibility 110960, Blur 212800, Fortifying Brew 120954) — 62fdbf2e Burst #2
 *  missed Vizine's Greater Invisibility that KILL ATTEMPTS named. 605 files: no
 *  candidate added or removed (burst-into-mitigation prices those aura ids at no
 *  wall, as before); 504 ledger lines added (320 Greater Invisibility, 184 Blur /
 *  Fortifying Brew).
 *  v412 (2026-10-18, F15 — codex post-hoc 60-POSTHOC-02 U2, facts only): a
 *  dispel backlash is a control for the castability questions (UA's silence
 *  196364 a silence, VT's horror 87204 hard CC); a friendly breaker's BROKEN
 *  row ends a CC; a set of spells is stopped while every member is, per time
 *  (`blockedForEverySpell`). 605 files: no candidate added or removed; one
 *  kick-eaten `ccInWindowS` 2.8 → 0.9.
 *  v413 (2026-10-18, F15 batch 9 — fact1215 R4 + C4, user 「接受」 the 605
 *  preview): who broke an aura reads the hit behind a BROKEN_SPELL row that
 *  names the holder, and a Blessing of Sacrifice split onto the paladin as the
 *  paladin's spell (`breakerOfBrokenRow`); the paladin's own 6940 link is no
 *  protection (`isCasterSideLinkAura`). 605 files: cd-hoarded +14,
 *  crisis-no-response +1; 744 `broken by` lines; +30 [CC BROKEN].
 *  v414 (2026-10-18, F15 batch 10 — codex post-hoc 60-POSTHOC-03 U3, facts
 *  only): a burst window's outcome readings share the end of its last
 *  rendered second; the burst ledger drops post-round presses before
 *  grouping; a HoT tick is a fresh self-heal only when the HoT went on the
 *  owner inside the window. 605 files: no candidate added or removed;
 *  [BURST ANSWERED] −14 / +20; gate checkBurstLedgerSpellSpans 4 → 0.
 *  v415 (2026-10-18, F15 batch 11 — fact1215 R5 + R6, facts only): the
 *  avoidance aura up when a control hit is read in log order, capped at its
 *  length when never closed, forms exclusive (`ccAvoidanceBuffsUpAt`); a
 *  delayed control is read at the instant it hit. 605 files: no candidate
 *  added or removed; immuneCauseConsumed 100 → 0, delayedAvoidAtHit 28 → 0.
 *  v416 (2026-10-18, F15 batch 12 — fact1215 R9 + R10, facts only): a refused
 *  press goes to the control of the mechanic its reason names; a channelled
 *  control ended by a kick on its caster says so; a channel with no caster
 *  aura counts as busy to its kick or last tick. 605 files: no candidate
 *  added or removed; +310 `on its caster` ends.
 *  v417 (2026-10-18, F15 batch 13 — fact1215 C5, facts only): a wall copy
 *  no press put up reads `[no press logged]` and is never early on length;
 *  a friendly [PROC] says `(with X)`; Radiant Glory's cast-less Avenging
 *  Wrath gets its `(no press)` [ENEMY CD] line. 605 files: no candidate added
 *  or removed.
 *  v418 (2026-10-18, F15 batch 14 — fact1215 C10 rest, facts only): a
 *  damage miss of Wake of Ashes is no `[CC NOT LANDED]` (`missReportsControl`);
 *  a warlock's purge follows the pet the log shows (`warlockRanPurgePet`);
 *  Ice Nova 157997 is a root (user approved −4 slow-defensive-response).
 *  v419 (2026-10-18, F15 batch 15 — fact1215 C7 fact half): an enemy's press
 *  of a roster Utility row no other enemy family prints (Champion's Spear,
 *  Smoke Bomb, Tremor Totem) gets an `[ENEMY UTILITY]` line (user ruling: a
 *  new tag). 605 files: no candidate added or removed.
 *  v420 (2026-10-18, F15 batch 16 — fact1215 R7): `defenseless a–b` is cut
 *  by the target's own immunity and absorb shield and by an area save whose
 *  aura it carried; a legend line says what the span reads (user approved:
 *  kick-priority-missed 45 → 38, kick-priority-team 67 → 58).
 *  v421 (2026-10-18, F15 batch 17 — fact1215 R11 fact half): a spam fold
 *  counts its death-window per-cast lines; [RES] cc: names the longest
 *  control; an empowered cast's dispel comes with its release; Dampening is
 *  read on the line's own team; the cc-avoidable legend states its
 *  predicate. 605 files: no candidate added or removed.
 *  v422 (2026-10-19, F15 batch 18 — fact1215 R11 rest): a redirect save the
 *  owner pressed for the crisis unit answers cd-hoarded (user approved:
 *  cd-hoarded −24); a missed purge whose window saw our purge take another
 *  buff says so.
 *  v423 (2026-10-19, F15 batch 19 — fact1215 112-1): a control's expiry and
 *  its source's recast inside the re-send gap are two controls for the CC
 *  windows, the DR histories and the break analysis (`ccRecastSplitsResend`).
 *  605 files: no candidate added or removed.
 *  v424 (2026-10-19, F15 batch 20 — fact1215 R11 Solar Beam): a silence
 *  the log writes no aura for, proven by the owner's press refused as
 *  silenced, gets a `[SILENCE] … | no aura logged — silenced at m:ss (X
 *  refused); length not logged` line (user approved). 605 files: no
 *  candidate added or removed.
 *  v425 (2026-10-20, GH #115 batched regen #5): the reference tables, the
 *  reference vectors and CD_HOARDED_OUTCOME_REF regenerated on the fact1215
 *  code (cc8b22e8c) — printed reference rates and n move; slow-defensive-
 *  response +1 / −1 (two burst-window cells crossed the 3-point contrast
 *  door); Restoration Druid's Tree of Life and Nature's Swiftness `[RES]`
 *  cooldowns read a range (new / lower recast floor).
 *  v426 (2026-10-20, GH #154): Druid cooldown talents the ledger missed —
 *  Control of the Dream (the time a spell sat ready comes off its next
 *  cooldown, ≤ 15 s), Cenarius' Guidance (Tree of Life −5 s per Grove
 *  Guardian fade; Restoration Convoke −60 s), Call of Ohn'ahra dated by the
 *  log (+30 s before the 2026-09-22 hotfix). 605 files: missed-sync-window
 *  +7 (Balance Force of Nature back inside the window; user approved).
 *  v427 (2026-10-20, F16 — fact2 round-2 audit + v0.1.36 retest): every
 *  cast-keyed reader resolves an aura to its cast; the [STATE] sampler,
 *  trough and press-HP readings; kill-attempt target / anchor; hard-cast
 *  outcomes; user rulings 2026-10-20 (absorbed hits count in burst
 *  detection; a trough reads its death second; Time Dilation's held-back
 *  damage is mitigation; a ready Alter Time is a defensive in hand; racial
 *  damage buffs and Ultimate Penitence are offensive cooldowns). 605 files:
 *  cd-hoarded −43 / −25, missed-cleanse +29 / +21, other types ±1–4 (user
 *  approved the preview).
 *  v428 (2026-10-20, cooldown mastery batch 1): talent rows the tooltip
 *  gives to one spec only (`$?c3[…$s3…]`) now apply to that spec only —
 *  Elemental Affinity's Fire-spell row is the Frost mage's, its Frost-spell
 *  rows the Fire mage's (Fire Dragon's Breath 28 → 40 s, Frost Ring of Frost
 *  / Frost Nova back to unreduced; 45 rows of 17 talents gated);
 *  Improved Feign Death per rank (25 → 20 s); Feral Convoke 120 → 60 s
 *  (Ashamane's Guidance). 605 files (measured on the pre-F16 base): no
 *  candidate added or removed.
 *  v429 (2026-10-20, cooldown mastery batch 1b): talent points as DB2 really
 *  has them — per purchased rank (TraitDefinitionEffectPoints + CurvePoint)
 *  and per spec where a spec passive rewrites them by label: Holy Paladin's
 *  Blessing of Sacrifice with Sacrifice of the Just is 105 s, not 60
 *  (corpus floor 104–105 s over 581 recasts); Avenging Crusader with Call
 *  of the Righteous 52.5 / 45 s by rank, not 30. 605 files: cd-hoarded
 *  −14 +1, external-unused −7, slow-defensive-response −2 (user approved).
 *  v430 (2026-10-20, cooldown mastery batch 2): one cooldown model for the
 *  readers outside the ledger (`unitCooldownEntry`): kit readiness, the
 *  enemy cooldown timeline, kill-window defensives, defenseless windows,
 *  the death recap fallback and contested-trade CC now read the ledger's
 *  press identification and per-press effects. 605 files:
 *  kick-priority-missed / -team −1 each, kick-eaten −2 (user approved).
 *  v431 (2026-10-21, F16 follow-up — user rulings 2026-10-20 「都要」):
 *  Counterspell locks 5 s for a kicker without Improved Counterspell; the
 *  kill-window roster gains Survival of the Fittest, Retribution's Divine
 *  Protection and Dark Pact; a roster defensive the kit tags [UNUSED] (not
 *  a heal, not ally-only) keeps its owner out of every `defenseless` span;
 *  Shield of Vengeance gets its own [ENEMY DEF] line. 605 files:
 *  kick-priority-missed −3, kick-priority-team +1 / −1 (user approved).
 *  v432 (2026-10-21, cooldown mastery batch 3 — GH #124): event-based
 *  cooldown reductions are modelled (user ruling 2026-10-20) — power spent,
 *  interrupts, hits, consumed buffs, attacks taken, own aura ends, resets —
 *  on single and charge spells; rate windows from carriers outside the
 *  talent inventory; Ret / Prot Sacrifice of the Just and Ret Unbreakable
 *  Spirit dated to their hotfixes (user ruling); the 12.1.0 talent map for
 *  12.1.0 logs. 605 files: missed-sync-window +88, kick-eaten +7,
 *  external-unused −9 +5, cd-hoarded −4 +1 (user approved).
 *  v433 (2026-10-21, GH #155): talent duration extensions read off the talent
 *  tooltips and confirmed on the corpus (`TOOLTIP_DURATION_ROWS` — Apotheosis
 *  +12 s, Cloak of Shadows +2, Zenith +5, Desperate Prayer +10, Power Word:
 *  Shield +5 …; Spiritwalker's Momentum per press, loadout `lasts 15–19s`).
 *  605 files: no candidate added or removed; 1,875 contexts change in the
 *  loadout's `lasts` and in 25 kill-window lines.
 *  v434 (2026-10-21, codex 20-F16-01..04): a deferral shield's absorb is
 *  out of every burst / kill reader, a Spell Reflection return goes to the
 *  nearest damaging reflected spell, a disarm or silence that ran its
 *  official length is not "broken" by a later Medallion, opener [RES] rows
 *  honour Forbearance, suppressed [RES] rows keep the delta state. 605
 *  files: no candidate added or removed; 220 contexts change.
 *  v435 (2026-10-21, F16 same-round retest + codex 20-F16-07/08 + user
 *  rulings): no kick of a cast inside Spirit of Redemption; the burst
 *  window's answers include the crisis side's (Bear Form, Frenzied
 *  Regeneration, Roar of Sacrifice …); [CONSEQ] starts at the landing
 *  instant and a quiet line prints its readings; Frost Nova 8 s with
 *  Improved Frost Nova; one avoidance per ground-control hit; Nether Ward
 *  returns; a warlock purges only while the Felhunter is out. 605 files:
 *  kick-priority-missed −6, kick-priority-team −9, slow-defensive-response
 *  −19, death-setup +3, burst-into-mitigation −1 (user approved).
 *  v436 (2026-10-21, user rulings on the retest's open questions): the
 *  target's own Power Word: Shield / Void Shield and an Intervene on it end
 *  `defenseless` while up; a mage in Ice Block is no ready kicker. 605
 *  files: kick-priority-missed +1, kick-priority-team +2 (one event), user
 *  approved; [KILL WINDOW] 8,443 → 8,338, [VULNERABLE] 411 → 435.
 *  v437 (2026-10-21, codex 20-F16-09): a mechanic-limited avoidance names
 *  only a control it stops; Karma's window ends at its own monk's redirect
 *  removal; a reflected control broken by damage is no trinket's; controls
 *  into Aspect of the Turtle count. 605 files: no candidate added or
 *  removed; 14 contexts change.
 *  v438 (2026-10-21, round-3 fact audit fix batch + corpusFactScan batch 1
 *  + user rulings): IMMUNE causes (no magic-only / reflect-only avoidance
 *  for a control it cannot stop, no mobility credit once a miss row proves
 *  the hit, Command Squadron off the avoidance list); presses made while
 *  unseen are presses (`[pressed while unseen]`); DR'd no-REMOVED ends;
 *  reflect returns (own DoT out, damage-id / pre-REFLECT rows in); Turtle,
 *  Mass Invisibility, Phase Shift, Intervene, Vanish in the kill windows
 *  (user rulings); kick-priority judges every overlapping window; dispel
 *  backlash silences as [SILENCE]; Medallion / break presses at their own
 *  aura; Intervene 3 s, Berserk / Celestial Alignment 15 s, AMS 444741
 *  6 s. 605 files vs v437: kick-priority-missed +17, kick-priority-team
 *  +22, kick-eaten +1, position-mistake +1, questionable-external −6,
 *  cd-waste −6, cd-hoarded +1, external-unused −9, backlash-dispel −1.
 *
 * v439 (2026-10-22, fix-F16 regression net + corpusFactScan residue):
 *  reflect returns (backlash excluded, one chain per spell by id or name,
 *  the reflected copy logged reflector → caster, a reflector's own hits
 *  after the projectile's flight, own-id rows by the nearest REFLECT row,
 *  Fel Lance's return); hidden presses vetoed only by a same-id
 *  re-statement, found by the press's own effect aura (Alter Time);
 *  castless Blessing of Sacrifice; an enemy break racial out of a
 *  reflected control; offensive aura runs paired per source; a trinket
 *  after a logged cause in the removal's ms. 605 files vs v438: cd-waste
 *  −1, cd-hoarded −1 (one castless Blessing of Sacrifice, 103-2 0:58).
 *
 * v440 (2026-10-22, GH #153 leftovers + corpusFactScan2 batch-2 inputs):
 *  press HP reads a HoT's first tick up to the aura-before-cast lag; the
 *  kit's rate-warped range; Divine Toll reaches allies; Blessing of the
 *  Bronze speeds Leap of Faith (aura-454 category carriers, ally-applied,
 *  from COMBATANT_INFO); defenseless ends under an own PRESSED absorb shield
 *  within a minute of its press; an IMMUNE control / silence row on our
 *  player is stated with its log cause; DB2-explained avoidance auras
 *  (facts only); Herald's proc bundle is no hidden press; a ground
 *  control's go-off bounds the move credited with dodging it. 605 files vs
 *  v439 (b39 → b45): healer cd-hoarded +8 (14 new, all Holy Paladin
 *  Divine Toll ready while a teammate was in crisis; 9 removed where the
 *  pressed Divine Toll now answers it).
 *
 * v441 (2026-10-22, user rulings 「可以」): the DB2-explained avoidance
 *  buttons (Blink, Icebound Fortitude, Lichborne, Demolish, Aura Mastery,
 *  Unending Resolve, Obsidian Scales, Zen Focus Tea) are cc-avoidable tools;
 *  backlash-dispel's target HP is read at the decision instant (fact3 D45,
 *  the fourth signed exception). 605 files vs v440 (b45 → b46):
 *  backlash-dispel −1 (two crossed out of the HP band, one in), 39 HP facts
 *  re-read; cc-avoidable unchanged.
 *
 * v442 (2026-10-22, fact4 F17 batch 1 — the round-4 regressions and D28,
 *  user approved 「A」/「批准」): Aspect of the Turtle is an own defensive
 *  again (a deflection: `[ENEMY DEF]`, KILL ATTEMPTS `popped`); a channel
 *  tick (Divine Hymn 64844) is no burst answer; hard-cast results pair in
 *  throw order; crisis-no-response's "could act" is the cd-hoarded owner
 *  gate's (≥ 1 s free of the cannot-cast intervals in [t, t + 3 s], legend
 *  reworded) and its `burst` is an enemy burst running at t. 605 files vs
 *  v441 (b46 → f1): healer crisis-no-response +2 (silenced / stunned at the
 *  crossing, 1.5–2 s free after it); cd-hoarded 28 points swapped under the
 *  cap by the enemy-burst ordering, net −1 (the new pick failed the intent
 *  guard after the cap).
 *
 * v443 (2026-10-22/23, fact4 F17 batch 2 — controls removed and delayed,
 *  user approved 「批准」): an ally's Blessing of Sanctuary removes Fear /
 *  Silence / Stun / Horror (DB2 aura-232 mechanics) — `[CC REMOVED]` names
 *  silences, KILL ATTEMPTS reads `broke out (Blessing of Sanctuary)`;
 *  Freezing Trap / Binding Shot / Snowdrift land over their area's life;
 *  Snowdrift's pulse rows are no presses; one failed-control row is one
 *  line; a pet's or guardian's control names the pet; a Command Demon press
 *  and its pet's cast are one control / one kick. 605 files vs v442 (f1 →
 *  f2c): healer slow-defensive-response −1 (a Snowdrift stun that landed on
 *  the burst caster now answers it).
 *
 * v444 (2026-10-23, fact4 F17 batch 3, user approved 「批准」): an advanced
 *  sample's max HP that lags a max-HP change reads the new max (bear exit,
 *  Ursine Vigor falling off — a full-HP druid read 75 / 87 / 76 %; parser-
 *  compat, every HP reader); Hypothermia put on later in the [RES] row's
 *  second counts, and a `≤Ns` cooldown under the debuff prints
 *  `(≤Ns; Hypothermia Ms)`; the [RES] legend states the half-second slack;
 *  Dampening on a unit's own line is its own; Cauterize's heal 1286444 is
 *  its proc when the burn aura is not logged; Burrow is on the friendly
 *  ledger; a snare copy's miss is no control failing; Mutilate's off-hand
 *  and Germination's 774 companion are no presses. 605 files vs v443 (f2c →
 *  f3b): dps cd-hoarded −1 (the crisis unit's own Cauterize saved it).
 *
 * v445 (2026-10-23, fact4 F17 batch 4, user approved 「批准」): the healer
 *  save roster's heal amplifiers (Nature's Swiftness, Evangelism, Stasis,
 *  Tip the Scales, Convoke, Holy Avenging Wrath) help an ally — no longer
 *  "self-only defensives correctly HELD", and a press of one answers a
 *  teammate's crisis; the NOTE's hold test counts refused presses; a
 *  multi-charge cooldown is available while one charge is (STAYED IN reads
 *  the [RES] ledger); codex 21-R12-a: a death window ends at the round's
 *  end, an un-removed hidden buff expires after its duration, `used up`
 *  needs the spender cast, inferred control ends settle in apply order
 *  with DR; an inferred-end own shield runs to its last absorb. 605 files
 *  vs v444 (f3b → f4): healer cd-hoarded 574 → 571 (35 answered by such a
 *  press, 32 new — 25 with only such a cooldown ready).
 *
 * v446 (2026-10-23, fact4 F17 batch 5 — review follow-ups, user approved
 *  「批准」): a heal or hit that moves current HP by a max-HP change's ratio
 *  is no max-HP lag, and the report's HP timeline and replay read the same
 *  corrected max HP; a line's own Dampening only from its unit's first dose;
 *  crisis feasibility ends at the last playable instant; a control with its
 *  own logged miss row is answered only by its caster's landing of that
 *  trigger (a later trap, another caster's Capacitor Totem no longer hide
 *  it); a pet-executed kick's miss row is paired at the pet's instant; a
 *  control the charmed holder's own team put on it locks its casting; a
 *  warlock's purge is locked while no Felhunter is out, per pet unit; an
 *  unclosed casting lock runs its official length. 605 files vs v445 (f4 →
 *  f5b): healer crisis-no-response 8 → 7 (a crossing in a Solo Shuffle
 *  round's last second); `[CC AVOIDED?] … logged` lines 6,354 → 6,416.
 *
 * v447 (2026-10-23, fact4 F17 batch 6a — the cooldown model on one
 *  reading): a press's realised return counts the rate windows after it,
 *  and its event reductions and resets act on the warped clock (Emerald
 *  Communion / Rewind print `(a–Ns)` with their real return as a); a charge
 *  entry's own reductions reach every reader; event triggers in the press's
 *  own instant count (Rumbling Earth); a trinket locks Will to Survive 60 s;
 *  the healer-offense facts read the shared cooldown model (Holy Word:
 *  Chastise brought back early); a buff whose REMOVED was lost ends at its
 *  official length, a logged one is its end; Dampening probes read the
 *  unit's own doses. 605 files vs v446 (f5b → f6b): no candidate added or
 *  removed; `[OPPORTUNITY] … Holy Word: Chastise ready` 17 → 37.
 *
 * v448 (2026-10-23, fact4 F17 batch 6b+6c — round-end clips, lost
 *  REMOVEDs, affordability): facts about a window stop at the round's end
 *  (sync window, kick priority, Innervate, silence, [CD PRIOR] trough,
 *  kick pressure, Psyfiend, stacked defensives, roots, disarm); a buff whose
 *  REMOVED was lost ends at its official length (Spirit of Redemption,
 *  Obsidian Mettle, Death Pact, Power Infusion, dispel windows, friendly
 *  Cyclone) and an inferred end prints no [ENEMY BUFF END]; Innervate's
 *  free casts count as affordable only while it is up, and "could not pay"
 *  is its own fact apart from control; an external is unused only when it
 *  was back AND the caster free at the same time; a kicked enemy bar is no
 *  hard cast, and its target falls back to the completion (a summon by its
 *  English name). 605 files vs v447 (f6b → f7): external-unused 144 → 137
 *  (each back and its caster free together < 1.5 s of the last 5 s).
 *
 * v449 (2026-10-23, fact4 F17 batches 7+8 — fades, control state, counts):
 *  a press that missed and put no aura up has no [BUFF FADED]; Alter Time
 *  ended by its return says so, a channel stopped under half its DB2
 *  length says "ended early" (Divine Hymn / Tranquility back to DB2 5 s /
 *  6 s); a target is not CC-able under an immunity the press line names
 *  for that control (Anti-Magic Shell vs a trap) nor under Mass
 *  Invisibility; an enemy's own reflected control is DR history; a
 *  [CONTESTED] span needs the enemy healer free; an aura applied after the
 *  kick's IMMUNE row is no reason; GCD refusals do not split a [REJECTED]
 *  run; minor dispels are counted by press; a heal the press itself
 *  triggers is not in its HP; an ally-copied Obsidian Scales answers a
 *  burst; a cast bar stopped as an enemy Shadowmelded says so; a sacrificed
 *  demon lends no purge; a castless Blind is a press. 605 files vs v448
 *  (f7 → f8): no candidate added or removed; [CONTESTED] 435 → 312.
 *
 * v450 (2026-10-24, fact4 F17 final batch — user rulings of 2026-10-23):
 *  Obsidian Scales of a Lifecinders evoker can reach an ally
 *  (`ALLY_REACH_GRANTED_BY_TALENT`): it is a ready save for a teammate's
 *  crisis, and pressed on an ally it still answers the caster's own; a
 *  root the owner landed is offensive output on [SLACK]; a channel taken
 *  over by its own re-cast was not cut by CC. 605 files vs v449 (f8 →
 *  f9b): cd-hoarded +2, slow-defensive-response +1 (each an evoker's
 *  Obsidian Scales in hand for a teammate), 10 rows list it ready.
 *
 * v451 (2026-10-24, fact4 F17 D31 — user ruling 2026-10-23): a press line's
 *  HP may be a reading of the press's own millisecond logged before its cast
 *  row, when nobody healed the unit in the lead (the parser now keeps each
 *  advanced sample's line). 605 files vs v450 (f9b → f10): no candidate
 *  added or removed; 226 press HPs lower (median −1), 58 [YOU] [CD] lines
 *  gain one.
 *
 * v452 (2026-10-24, fact4 F17 review follow-ups — missed readers of the
 *  unified facts): charges read on the recovery-rate clock; a same-ms event
 *  reduction is in the countdown; reflected DR reaches the expected-length
 *  walk; Spirit of Redemption's cap is the priest's own (Afterlife); the
 *  enemy-defensive press HP finds its press by the aura; a re-cast channel
 *  restarts at its REFRESH; "could not pay" reaches the deep dive and the
 *  desktop card; a talent-shared wall given to an ally stays its caster's
 *  wall; ready ∩ free reads every not-ready span; a max-HP lag is not ruled
 *  out by a logged hit of the same ratio.
 *
 * v453 (2026-10-24, weekly review of the 10-17…10-24 commits): an unseen-end
 *  invisibility / stealth (Greater / Mass Invisibility, Vanish, Burrow)
 *  ends at its holder's own press or direct hit — not its pet's hit or a
 *  DoT tick — and in the burst ledger only when the log showed no end
 *  (`holderFirstOwnActionAfterMs`); the uncredited `[CC AVOIDED?] …
 *  logged IMMUNE (a Cyclone was on them)` reads the [CC NOT LANDED] note's
 *  capped walk (`damageImmuneControlUpAt`). No corpus in the session that
 *  made it: no 605-file numbers, unit tests only.
 *
 * v454 (2026-10-24, real-log pass over the public wowarenalogs testlogs):
 *  a COMBATANT_INFO whose interesting-auras list is three pairs decodes
 *  (the player no longer falls out of the round's roster); a client-locale
 *  (CJK) log name is never a spell name's fallback — the id is; a rider
 *  shield's `[no press logged]` only when the log has no press of it; an
 *  unseen-end invisibility no longer ends at its own press's cast row.
 *  13 public arena logs, healer / dps / recorder views: hardFailures
 *  16 / 16 / 16 → 0 / 0 / 0, prompts built 35 / 39 / 37 → 39 / 40 / 40,
 *  bare unmapped names 21 → 0, corpusFactScan auraCastGap 27 → 0. No
 *  605-file numbers (no corpus in the session).
 *
 * v455 (2026-10-24, predicate-index "Not yet unified" pass): an absorbed
 *  hit's `Top sources` / `killed by` entry carries its school
 *  (`absorbedHitSchoolMask`, the school split's reading); a channel is one
 *  span per cast with the aura allowed the measured lead
 *  (`channelSpans`, read by `[channel cut by CC]` too); the Oppressing
 *  Roar and roster-label entries closed without output change. 13 public
 *  logs: Top sources entries without a school 13 → 2, candidates
 *  unchanged.
 *
 * v456 (2026-10-24, the user's rulings on the predicate-index entries,
 *  「全按建议」): no timeline event after a Solo Shuffle round's deciding
 *  death (A1); roots, the slack sweep and Stasis end at the round (A2–A4);
 *  the KILL ATTEMPTS Cyclone clause and its legend read the bracket and
 *  the 5 s after it (B4); damage rows and cast targets carry the roster
 *  label (`6(MHunter) — Bleak Arrows`, `→ 5(RPaladin)`, D3); a full-charge
 *  release is tagged by its own level (D2). 13 public logs: 63 of 119
 *  prompts change, 460 lines by the label and 9 lines gone after the
 *  round's end; every gate passes. No 605-file numbers.
 *
 * v457 (2026-10-25, fact5 round-5 fixes F18 batch 1 — the recurring fact
 *  classes, each with a corpusFactScan4 check): a spell is matched to its
 *  damage by the spell, not the row id (Execute 281000 → 260798; an
 *  empower counts at its release); Fel Armor is a deferral shield; Tempered
 *  in Battle is redistribution; a GCD-refused press of a ready cooldown is
 *  `attempted` on cd-waste / missed-cleanse / slow-defensive-response too
 *  (ruling C1, extended 2026-10-25); a healing gap names its refused
 *  presses; an enemy offensive cooldown's aura with no press is a `(no
 *  press)` occurrence; an unseen press is read through its same-named
 *  variants; an aura-only external of any kind is an [ENEMY DEF] line; "X
 *  ready on enemy healer" needs the CC to reach the healer; an external
 *  pressed on an ally is no protection on its caster; the pressed Spirit
 *  of Redemption is a major defensive in hand; STAYED IN names a defensive
 *  back inside the span. 605 capture (PV455 base → this batch): candidate
 *  deltas kick-eaten +6, kick-priority +3, burst-into-mitigation +1,
 *  position-mistake −3 (user-approved preview); gates unchanged.
 */
/*
 * v458 (2026-10-26, fact5 round-5 fixes F18 batch 2): a player's side is
 *  its COMBATANT_INFO team (a Solo Shuffle round no longer reads 4 against
 *  2); an enemy healer's Evangelism / Tip the Scales / Nature's Swiftness /
 *  Divine Toll / Celestial Conduit / Frenzied Regeneration / Convoke print
 *  [ENEMY HEAL CD] for their spec (the save-cooldown roster's forward
 *  check); Roar of Sacrifice ends `defenseless` like Intervene (user ruling
 *  2026-10-25); a burst is answered by a control only on a caster of the
 *  CDs inside its 8 s; a cleanse "on cooldown" only for a dispel that
 *  removes the debuff's type; a teammate's aimed CC with no control aura
 *  says so; a ground control is dodged before its own pulse row. 605 / wide
 *  (main 5032b4e4f → batch): slow-defensive-response +15 / +34,
 *  missed-cleanse +3 / +13, kick-priority −3 / −3, cd-waste 0 / −1 (preview
 *  approved by the user 2026-10-26); gates and scan1–3 unchanged.
 */
/*
 * v459 (2026-10-26, fact5 round-5 fixes F18 batches 3+4): an aimed control
 *  with no control aura names the avoidance aura up on its target at the
 *  cast; a triggered ≤ 100 ms aura is no standing immunity of its parent
 *  (Spirit Walk, Vengeful Retreat, Wraith Walk read their movement); a DoT
 *  tick a shield ate no longer ends an unseen save; Spell Reflection is a
 *  Warrior Utility press (user 2026-10-26); a channel's cast row naming the
 *  caster's teammate is said; a trinket press names the root it removed
 *  (user 2026-10-26); a wall pressed after an attempt opened was in hand at
 *  it; a pet dispel its owner commanded is deliberate; the external
 *  window's absorbed part counts the ally's summons; an enemy CD's span runs
 *  on the aura its effect lives on (The Hunt's DoT); an unseen press's own
 *  aura is no second `(no press)` line; a recast channel is its own span; a
 *  save pressed at or after the round's end is no kill attempt's cause.
 *  605 / wide (PV458 → batch): kick-eaten +1 / 0, burst-into-mitigation
 *  0 / +1 (accepted by the user 2026-10-26); checkEnemyDefRefConsistency
 *  3 → 0 / 24 → 0, other gates unchanged.
 */
/*
 * v460 (2026-10-27, fact5 round-5 fixes F18 batch 5, user rulings
 *  2026-10-26): Rake's stun is a CC threat only with stealth up or a means
 *  to it in hand (Incarnation, Shadowmeld); KILL ATTEMPTS names a
 *  teammate's area save on the target as an external; Die by the Sword is a
 *  parry against melee, only its 30 % wall against spells; Transcendence:
 *  Transfer is an [ENEMY UTILITY] press. 605 / wide (PV459 → batch):
 *  candidates unchanged, gates unchanged; [HEALER EXPOSURE] Rake mentions
 *  1,836 → 822 on wide.
 */
export const PROMPT_VERSION = 460;
