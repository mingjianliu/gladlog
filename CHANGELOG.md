# Changelog

**English** · [Chinese](CHANGELOG.zh-CN.md)

One section per release, listing every change and the commit behind it (on the
`git log v<prev>..v<new>` basis; release and docs-only commits go under "Other").
The release procedure is documented in `.claude/skills/release`.

## v0.1.39 (2026-10-28)

Eight pieces of work. The fact4 round-4 audit (69 confirmed defects) finished with its last batches, fact4 batches 1–8 and a final batch. A weekly review of the previous week's commits found eight problems — two readers of one fact that disagreed, hand id tables the curated scans could not see, tests that had stopped testing what they are named for. A new CI job runs the public wowarenalogs test logs through the parser and every hard gate, and a mutation probe asks whether any test notices when a line of code is wrong; together they found a player falling out of the roster, Chinese spell names leaking into the prompt, and an invisibility that ended at its own press. The fact5 round-5 double audit (15 rounds, 26 defects) was fixed in batches 1–5, each fact class with a deterministic check in the new `corpusFactScan4`. The predicate-index rulings of 2026-10-24 put each listed two-reader fact on one reading. F19 fixed what the codex reader inventory found. The PV463 batch closes the hard gates that still failed on a second, newer corpus. GH #163 prices a Restoration druid's Barkskin at its PvP 40 %. From fact5 on, every batch was measured on the 605-file capture and on that second corpus of 728 newer files; every change that adds or removes an accusation was previewed and approved by the user before landing.

Highlights:
- A Solo Shuffle round ends at its deciding death for every reader — the timeline, roots, the cooldown ledger, cast bars, CC chains, kick-eaten and the desktop panels.
- A player no longer falls out of the roster on a log whose aura list the decoder misread, and a player's side comes from the log's own team field.
- A spell name from a Chinese or Korean client is never printed; an unknown id falls back to the id.
- Aspect of the Turtle is an enemy defensive again, Blessing of Sanctuary's breaks are named in KILL ATTEMPTS, and so are a teammate's area saves (Spirit Link Totem, Rallying Cry …).
- Heal amplifiers (Nature's Swiftness, Evangelism, Tip the Scales …) and a Lifecinders evoker's Obsidian Scales count as help for an ally.
- The enemy heal-cooldown roster gains Evangelism, Tip the Scales, Nature's Swiftness, Divine Toll, Celestial Conduit, Frenzied Regeneration and Convoke.
- A refused press of a ready cooldown counts as an attempt for cd-waste, missed-cleanse and slow-defensive-response, and a healing gap lists the healer's refused presses.
- Second corpus: the 7 hard-gate classes that still failed (49 lines) now read 0.

Review: every batch had its cross-AI (codex) review before or right after landing — fact4's follow-ups (20-F17-*), fact5 (20-F18-01 … 10), F19 (20-F19-01 … 09), the real-log and predicate-index work (30-RV-01 … 04) and this release's last batch (20-G1 … G6). Every finding that changed a printed line is fixed; the remaining limits are recorded on the issue tracker.

### AI coaching — what the report says about you

#### Kill windows, kicks and saves

- `2b966ea8d` **Aspect of the Turtle is an enemy defensive again** (fact4 D6, a regression of v0.1.38): its press prints an `[ENEMY DEF]` line and KILL ATTEMPTS names it. 605 files: Turtle `[ENEMY DEF]` 0 → 328, KILL ATTEMPTS 0 → 109. A channel's last tick (Divine Hymn) no longer answers a burst that began after the channel ended.
- `352e7c962` **An ally's Blessing of Sanctuary:**
  - What it removes is DB2's: fear, silence, stun and horror.
  - KILL ATTEMPTS reads an attempt whose control it removed as `broke out (Blessing of Sanctuary)`, not `not enough damage` (170 attempts on 605 files).
  - `[CC REMOVED]` names the silences it removed (96 lines).
  - A Snowdrift stun that landed on the burst caster answers the burst: healer slow-defensive-response 69 → 68, user-approved.
- `5032b4e4f` **Fact5 batch 1, kill windows and kicks:**
  - A press whose cast row names an ally, with no aura of its own on the caster, does not protect the caster.
  - A pressed Spirit of Redemption ends `defenseless`.
  - STAYED IN names a defensive that comes back inside the span.
  - ABILITIES INTO IMMUNITY / DR matches a cast to its damage by spell (Execute 281000 lands as 260798); an empowered cast counts at its release, a hold never released counts nowhere.
  - 605 files: kick-eaten 1,837 → 1,843, kick-priority-missed 47 → 48, kick-priority-team 72 → 74, burst-into-mitigation 7 → 8, position-mistake 154 → 151, user-approved.
- `c5afbaf42` Roar of Sacrifice ends `defenseless` while it is up, as Intervene does (user ruling 2026-10-25). A control answers a burst only when its target cast one of the burst's cooldowns inside its 8 s: slow-defensive-response +15 on 605 files / +34 on the second corpus; kick-priority −3 / −3; user-approved.
- `6da8c6a08` A 20–99 % wall pressed after a kill attempt opened was in hand at its start. A save pressed at or after the round's end is no attempt's cause. The external window's absorbed part counts the ally's summons. kick-eaten +1 (605), burst-into-mitigation +1 (second corpus), user-approved.
- `28371fe72` **User rulings 2026-10-26:**
  - KILL ATTEMPTS names a teammate's area save (Spirit Link Totem, Rallying Cry, Anti-Magic Zone, Darkness, Power Word: Barrier) whose aura was on the target inside the attempt — Rallying Cry 228 / 624 lines, Spirit Link Totem 79 / 222.
  - Die by the Sword stays an answer to melee, and is judged as its 30 % wall against spells cast from beyond melee.
  - Rake is a `[HEALER EXPOSURE]` stun threat only with stealth up or a way into it in hand (Prowl, Shadowmeld, Incarnation, Sudden Ambush). Evidence: the tooltip ("While stealthed, Rake will also stun") and 441 of 460 Rake stuns on the 605 files. Second corpus: Rake mentions 1,836 → 822.
  - Candidates unchanged (7,630 / 23,421).
- `ff9f603a1` KILL ATTEMPTS' Cyclone clause reads the attempt's bracket and the kill-credit slack after it, as its gate does. Touch of Karma lasts as long as its shield, for every reader.
- `7583b54a3` external-unused needs the external ready and its caster free at the same time: 605 files 144 → 137.
- `33043e8a5` external-unused's "ready and free" is checked over every span the external was not ready. An ally-copied wall keeps the caster's own wall credit.

#### Cooldowns

- `c60affdf9` **The cooldown model on one reading:**
  - A cooldown sped up by a rate window counts the windows after the press, so `[RES]` agrees with the ledger: Emerald Communion `(129s)` → `(119–129s)`, Rewind `(163s)` → `(151–163s)`.
  - Event reductions in the press's own millisecond count (Rumbling Earth 40 s → 25 s); the trinket → Will to Survive lock is 60 s.
  - A charge cooldown's own effects reach its multi-charge windows, death readiness and the sync window's return.
  - No candidate moved; `[OPPORTUNITY] … Holy Word: Chastise ready` 17 → 37.
- `66fc31962` **Hypothermia in `[RES]`:** an application later in the row's own second counts, and a cooldown that may be back under it prints `(≤Ns; Hypothermia Ms)`. The `[RES]` legend states the ledger's half-second slack. Burrow enters the friendly ledger. Mutilate's off-hand row and Germination's companion Rejuvenation are no presses. A Cauterize proc logged without its burn aura still counts: dps cd-hoarded −1, user-approved.
- `347d975ef` **Heal amplifiers help an ally:** Nature's Swiftness, Evangelism, Stasis, Tip the Scales, Convoke and Holy Avenging Wrath are no longer "self-only defensives correctly held". Healer cd-hoarded 574 → 571 (35 answered by such a press, 32 new), user-approved. A multi-charge cooldown's windows follow the ledger: STAYED IN no longer says "no defensive CD available" beside Survival of the Fittest `[1/2]`.
- `0b30ed7a0` **User rulings 2026-10-23:** a Lifecinders evoker's Obsidian Scales reaches allies — a ready save for a teammate's crisis (healer cd-hoarded 571 → 573, slow-defensive-response 68 → 69, user-approved). A root the owner landed on an enemy is offensive output on `[SLACK]`.
- `8ff4820ee` **Press HP** (user ruling 2026-10-23, fact4 D31): with no heal on the unit just before, a reading in the press's own millisecond logged before its cast row is the HP at the press. 605 files: 226 press HPs change, all lower (median −1); 58 `[YOU] [CD]` lines gain an HP.
- `33043e8a5` F17 review follow-ups: charges run on the rate clock; same-millisecond reductions count in the countdown; the Spirit of Redemption cap reads its caster; an enemy defensive's press HP is read by its cast or its effect.
- `805564270` A press that put a copy on its caster and on an ally (Obsidian Scales) answers for each with that recipient's own end.
- `bebed3c02` **F19, the codex reader inventory** (user-approved 2026-10-27):
  - Death options: a save the victim was locked out of just before the death (Forbearance, Hypothermia), or one that does not cover what killed them, is not offered; an owned Blessing of Spellwarding is.
  - A friendly's Spirit Link Totem is a stacked wall named for its shaman; Grounding is credited by the totem's hit; focus fire counts hostiles only.
  - An unclosed enemy offensive aura lasts its official length; charge flips are keyed on whole milliseconds; a multi-charge return counts later resets.
  - missed-sync-window: a folded lock the owner set up is the owner's part of the row.
  - kick-eaten's cast-time median reads the recorder's failure rows.
  - 605 / second corpus: cd-hoarded +7 / +5, cd-waste +9 / +45, external-unused −23 / −32, missed-cleanse +3 / +9, missed-sync-window +11 / +27, crisis-no-response 0 / −1.

#### Crises, healing and cleanses

- `2b966ea8d` **crisis-no-response's "could act"** uses cd-hoarded's owner gate: at least 1 s free in the 3 s after the crossing, not just the crossing instant (a Void Nova 79 ms later held the healer 4 s while the menu said "free"). Its burst is an enemy burst running at the crossing. Healer crisis-no-response 6 → 8, user-approved.
- `4ba2b3ace` Crisis feasibility ends at the round's last playable instant (crisis-no-response 8 → 7, user-approved).
- `5032b4e4f` **Refused presses** (user ruling 2026-10-25): a press of a ready cooldown refused by the GCD and never cast later is an attempt for cd-waste, missed-cleanse and slow-defensive-response too. A healing gap carries the healer's refused presses — on the `[INACTIVITY]` line, as the healing-gap row's `attempted` fact, and in one legend sentence.
- `5032b4e4f` An enemy offensive cooldown's aura with no press is a `(no press)` occurrence with weight 0 (Enduring Rage → Recklessness, Odyn's Fury → Avatar). Tempered in Battle is redistribution, not damage. Fel Armor is a deferral shield. A `[CONTESTED]` / `[OPPORTUNITY]` "X ready on enemy healer" line needs the healer in reach.
- `c5afbaf42` **The enemy heal-cooldown roster** adds Evangelism, Tip the Scales, Nature's Swiftness (Druid and Shaman), Divine Toll, Celestial Conduit, Frenzied Regeneration and Convoke, each for its healer spec only (missing lines 1,175 → 3 / 4,207 → 8). A cleanse is "on cooldown" only for a dispel that removes that debuff's type (Naturalize does not remove a Curse): missed-cleanse +3 / +13, user-approved.
- `ff9f603a1` A control answers a crisis only when its target was hitting the pressured unit over the crisis (13 public logs: control answers 7 → 2). A form re-shift is no protective answer. An aura-proved press counts as evidence of the talent.
- `de008dbac` The healer benchmark's CC-avoidance rate counts only the player's own avoidances — not a Polymorph logged IMMUNE because the enemy hunter's Freezing Trap was on the healer.

### AI coaching — the timeline facts

- `c027aef94` **The second-corpus hard gates that still failed now pass:**
  - A talent-granted Obsidian Scales says `(on an ally — Lifecinders)`.
  - A control that logged IMMUNE and whose caster recast it within 1.5 s says `— recast landed +N.Ns`.
  - One IMMUNE of one control is not stated twice in a second.
  - A zero-length control is not cited as cover in `[DMG SPIKE]`.
  - A Tree of Life form re-shift while its buff is up is not a press.
  - The peel gate reads the order of a second's lines.
  - Master's Call's label is `(removes roots / snares)` (user ruling: on the 605 files 571 root / snare controls were IMMUNE and 545 still landed inside it).
  - A self save with no press of its own — Guardian Spirit while channeling Divine Hymn, Ice Barrier with a Blazing Barrier, Frenzied Regeneration from Well-Honed Instincts — prints its `[ENEMY DEF]` line `[no press logged]` and counts in KILL ATTEMPTS.
  - Stasis no longer lists one Verdant Embrace twice.
  - Wording: `[REFLECTED] … reflected ×N`, counted by cast — one Penance channel is one, two Fire Blasts 943 ms apart are two, each reflected proc (Astral Smolder) is one; `[CC AVOIDED?] … pressed +N.Ns` for a move made after the control hit, never for a ground control that went off after the move; a legend for `[no CC aura logged]`.
  - 605 files: candidates unchanged (7,637); second corpus: 7 gate classes (49 lines) → 0.
- `20ede1a90` `7583b54a3` `bebed3c02` **A Solo Shuffle round ends at its deciding death** (user rulings 2026-10-24 and 2026-10-27):
  - No timeline event after it; a later `[DEATH]` block still prints.
  - Roots, CCs, disarms and outgoing CC chains are cut there and marked as still on at the round's end.
  - The slack and contested sweeps, Stasis' "held through the round", the sync window, kick-priority's cast end, the Innervate note, kick pressure, stacked defensives and Psyfiend reach stop there.
  - So do the cooldown ledger, cast bars, CC breaks, HEALER TRAINED, aura uptime, kick-eaten's post-kick window, CC USE and the kit's started-bar count.
  - 13 public logs: 9 lines gone, none added.
- `2b966ea8d` An enemy hard cast's results pair in the order thrown (Chaos Bolt flight p50 852 ms, Pyroblast 455 ms).
- `352e7c962` **Delayed controls land over their area's life:** Freezing Trap up to 60 s, Binding Shot 10 s, Snowdrift 6 s — a trap that caught a paladin 8 s after it was placed no longer "did not land". A failed-control row on another unit "went off elsewhere". One failed-control row is one line, and Snowdrift's pulses are no presses. A pet's control names its caster (`X's pet`); a Command Demon press and its pet's cast are one control and one kick.
- `66fc31962` A line about one unit reads that unit's own Dampening. A control family's snare-copy miss (Metamorphosis) is no control failing: `[CC AVOIDED?]` Metamorphosis 38 → 0.
- `347d975ef` A hidden buff with no logged removal expires after its duration plus 1 s; inferred control ends settle in apply order, diminishing returns first; an own shield with an inferred end runs to its last absorb.
- `4ba2b3ace` Dampening counts only from the unit's first dose. A control with its own logged miss row is answered only by its caster landing that same trigger. A pet's kick miss pairs at the pet's instant. A control the charmed player's own team put on it locks their casting; a warlock's purge is locked while no Felhunter is out, per pet. `[CC AVOIDED?] … logged` lines 6,354 → 6,416.
- `c60affdf9` An own shield's absorb evidence stops at its next application. An aura whose removal was lost ends at its official length; a logged removal is its end, even past it. Stormkeeper's last charge spent by another spender counts as spent.
- `7583b54a3` **Lost removals:** Spirit of Redemption, Obsidian Mettle, Death Pact and Power Infusion end at their length (an inferred end prints no `[ENEMY BUFF END]`). Innervate's free casts count only while it is up; "could not pay" is told apart from control in the death outcome. A kicked enemy cast bar is no hard cast (hard-cast lines 1,260 → 1,239). `[CD PRIOR]`'s trough reads name, second and HP from one unit's crossing.
- `de35442b3` **Fades, control state, counts:**
  - `[BUFF FADED]`: no estimated fade for a press that missed; Alter Time ends at its return; a channel stopped early reads "ended early"; Divine Hymn and Tranquility last DB2's 5 s and 6 s.
  - `[CONTESTED]` needs the enemy healer free: 435 → 312.
  - GCD refusals are transparent in `[REJECTED]` runs; minor dispels are grouped by the dispeller's press.
  - A press's HP cuts a heal the press itself triggers.
  - An ally-copied Obsidian Scales answers a burst; a cast bar stopped next to an enemy Shadowmeld or Transcendence says so; Grimoire of Sacrifice means no purge; a castless Blind on another unit is a press.
- `0b30ed7a0` A channel taken over by its own re-cast was not cut by CC.
- `6804c59a5` `e9eb723e3` **An invisibility with no logged end** (Greater Invisibility, Mass Invisibility, Vanish, Burrow) ends at its holder's own press or hit — not at a pet's swing or a DoT tick, not past a logged removal, and not at its own cast row logged up to 150 ms after the aura.
- `e5795f619` `(a Cyclone was on them)` on an IMMUNE line uses the capped Cyclone reading: a 0:10 Cyclone with no logged removal is no longer blamed for a 0:44 IMMUNE.
- `aa807f02b` A rider shield (Shield of Vengeance) says `[no press logged]` only when the log has no press of it — an older patch logs one (public logs: 27 contradictions → 0).
- `a2714c8de` `7db75818f` **No client-language spell name:** a name from a Chinese or Korean client is never the fallback; an unknown id prints the id (public logs: 16 hard failures per view → 0).
- `fdb26784f` `7db75818f` **One reading of a channel's start and end:** the aura may lead its cast row by up to 150 ms (30 of 77 channels on the public logs were invisible to missed-cleanse and the kick audit). A span a re-cast took over is no CC cut and no kick stop, and lasts no longer than the channel's official length.
- `9539e006a` Top sources and "killed by" give the school of a fully absorbed hit (`Starsurge [Nature/Arcane]`; entries without a school 13 → 2).
- `db590161e` `7db75818f` One roster-label builder: `[HEALER EXPOSURE]` and `[ROOT]` use the timeline's; cast targets and damage rows now print the roster label too (460 lines in 63 of 119 public prompts).
- `7db75818f` **Predicate-index rulings D1–D7:**
  - `[EMPOWER Ln]` reads the released hold's level (a 2.6 s full charge was missed).
  - A SUCCESS row logged before the bar's own START row is not its end.
  - One cast-time reading for kick depth, the cancel ledger and the cast window.
  - A pet's death or Dismiss Pet ends its kick and the Felhunter's purge until another pet is seen.
  - Opposing hits read the roster sides; the death path's Forbearance and "enemy in CC" read the shared predicates.
- `c5afbaf42` A teammate's aimed CC that put no control aura and logged no miss says `[no CC aura logged]`, as the owner's does; a damage ABSORB miss is no control miss. A ground control's own pulse row is its go-off for the dodge reading (Capacitor Totem).
- `6da8c6a08` **Fact5 batches 3 and 4:**
  - An aimed control with no aura and no miss row names the avoidance up on its target at the cast (`[no CC aura logged — Phase Shift was up]`); a move pressed after the cast is no cause.
  - A triggered aura of 100 ms or less is a cleanse on cast, not a standing immunity (Spirit Walk; four ids).
  - A DoT tick a shield ate no longer ends an unseen save (882 intervals on 605 files).
  - Spell Reflection is a Warrior Utility press (user ruling 2026-10-26); a channel cast on a teammate is said.
  - A PvP trinket press names the root it removed, unless a logged dispel ended it first (user ruling 2026-10-26).
  - A pet's dispel its owner commanded is deliberate, not `(passive)`.
  - An enemy cooldown's span runs on the aura its effect lives on (The Hunt's DoT, not its root); the aura an unseen press was restated from is no second `(no press)`; a recast channel is its own span.
- `28371fe72` Transcendence: Transfer prints an `[ENEMY UTILITY]` press line (303 / 1,053 lines).
- `bebed3c02` **F19, facts:**
  - Enemy pets and totems appear in CC USE, PEEL OPTIONS and summon reach.
  - One press under two names is one press: Blur's second charge, Lightning Lasso's channel phase, a re-announced Guardian Spirit, Greater Invisibility's two success rows.
  - An unsilenceable cast is not blocked by a silence; a control that ran its length was not ended by a trinket in its last millisecond.
  - The deep dive and desktop read the trough; an HP snapshot includes its ends.
  - `[CONTESTED]` / `[OPPORTUNITY]`: ready and in reach in the same second.

### Combat-log parsing

- `60f0c325a` **A player no longer falls out of the roster:** a COMBATANT_INFO aura list of three pairs was read as two triples, the line failed to decode and the round ran 3v2. Public logs: COMBATANT_INFO lines decoded 125/144 → 144/144 on one shuffle; bare unmapped names on prompt lines 21 → 0.
- `c5afbaf42` A player's side comes from the log's COMBATANT_INFO team, not the reaction-flag vote that, in one Solo Shuffle round, filed an enemy Frost Mage as a teammate.
- `66fc31962` `4ba2b3ace` `33043e8a5` **Lagging max HP:** leaving Bear Form rescales current HP at once and the max field about 0.3 s later, so a full-HP druid read 75 %. The reading is corrected at the source for every HP reader (error p50 0.05 pp, from 8.9 pp); a heal or hit that moves HP by the same ratio is no lag.
- `8ff4820ee` The parser keeps each advanced sample's log-line order, so a reading in a press's own millisecond can be placed before or after the cast row. Stored documents grow about 0.7 %.
- `6da8c6a08` Absorbed outgoing damage rows carry the attack's spell id.

### Desktop

- `4ba2b3ace` The HP timeline and the replay read the corrected max-HP samples.
- `7583b54a3` The death recap reads the right second; Key Moments count Adaptation.
- `33043e8a5` The death recap card says when the caster could not pay.
- `ff9f603a1` `bd408042c` The stats table's dispel counts credit a pet's dispel to its owner, as the dispel panel does. No missed-purge kill-window card for a window that could not be acted on.
- `bebed3c02` The replay closes one cast bar per SUCCESS, by row order. Aura uptime, the CC-break dashboard, Key Moments and replay highlights stop at a Solo Shuffle round's ending death.

### Cooldown, talent and spell data

- `6da8c6a08` `genSpellSchools`: a triggered aura of 100 ms or less is no standing immunity of its parent; exactly four ids lose their immune mechanics at 12.1.5.70391.
- `635600c71` Hand id tables the curated scans could not see are registered (the reflect tables, the companion cast rows, the event cooldown-reduction ids, the per-event duration spells); two ids are flagged for the next season pass.
- `1d8360f1d` **A Restoration druid's Barkskin is a 40 % wall** (GH #163), not 30 %: the Restoration PvP aura adds 10 points on top of Barkskin and Oakskin. The corpus split by spec agrees (Restoration takes 0.600, Balance 0.704, Feral 0.700). 605 files: 268 Restoration `[ENEMY DEF]` Barkskin lines 30 % → 40 %, candidates unchanged. A Grove Guardians treant's Swiftmend is no longer read as its owner's.
- `339b56965` Research switches for the data scripts: build the talent catalog without today's hotfix overlay, or write a fresh overlay to a side path. Both default to the old behaviour.

### Reliability / tests / CI

- `8ace671ad` `807b9e44a` **A `real-logs` CI job:** the public wowarenalogs test logs (pinned, fetched at run time, never committed) go through the parser's real-log suites and every hard gate, for every round, healer / dps / recorder views, in both the context and the findings prompt; zero hard failures allowed. It found the roster, CJK and rider-shield defects above.
- `0cfca7f35` `8072afcc5` The shared test helpers build the events the app reads (damage sign, log-line order, fields, unit streams), held to the converted real fixtures by a contract test.
- `e9eb723e3` A log-shape matrix replays the known real-log quirks (lost removals, same-ms re-broadcasts, pet damage folded into the owner, DoT ticks, the aura-before-cast lag) against the core readers; its first run found the invisibility defect above.
- `17be77864` Every exported gate must be called by `checkMatch` (all 103 are).
- `4cc8bdcc9` `2f948f572` `000277592` **`mutationProbe`:** mutates one source file an operator at a time and reports the mutants no test kills. castPress 61.1 % → 100 %, hiddenPress 52.9 % → 91.2 %; it scores only against a passing whole-suite baseline.
- `2b966ea8d` `5032b4e4f` `c5afbaf42` `6da8c6a08` `bebed3c02` New corpus checks: `corpusFactScan3`, `captureFamilyDiff` (a per-family diff of two captures) and `corpusFactScan4`, one deterministic check per audited fact class (for example castDamageIdSplit 580 → 3, enemyCdAuraForward 294 → 3, ccReadyOutOfReach 98 → 0, deathOptionLocked 18 → 2, unusedAfterRoundEnd 46 → 0 on 605 files).
- `352e7c962` `7583b54a3` `7e1d13264` `20ede1a90` `107f759d2` `bebed3c02` New and refined gates: a failed-control line is that trigger's outcome; `[CD PRIOR]`'s crossing HP (2 → 0) with its own test; no event after the round's end, exempting only a later death's own block; an `(area)` `[ENEMY DEF]` line reaches its target for the caster kit's `lasts` (user ruling 2026-10-27).
- `562bc32c9` `4c3e4551b` `7b6dc0c0d` corpusFactScan2: listed auras are judged for applicability, unclosed immunities are capped, a cast-backed refresh is a new control, a dose row neither restarts the cap nor closes the application, and the E6 window is held equal to the product's constant.
- `85115426f` `fe0e8bf38` cooldownRecastScan: charges recharge one at a time, the slack applies to the verdict only, and the summary is per spell, spec, cooldown and charges.
- `842a12757` `20ed91470` `78171ec0e` postKickSwitchAudit names the switch cast production named, by its English name, including a companion just past the window's end.
- `24b7b1ad8` The coverage manifest counts Adaptation uses by its self-aura (605 capture: trinket uses 6,017 → 6,068).
- `7e1d13264` `bd408042c` `60d5f45b1` Tests that had stopped testing what they are named for now do; the stats-table tests compare reactions by the enum.
- `bed34c22b` The aura-activation tables move to their own file, ending an import cycle that broke isolated test runs.

### Other

- `664f93f30` `242717d8c` `f2c30fb7d` `8c48f7247` PROMPT_VERSION 453, 454, 455, 456 (442–452 and 457–461 are carried by their fix commits)
- `1d3c5c835` `42318e9f5` `57c25b3a6` Docs: the developer guide (en + zh-CN) and analysis-dev cover real logs, the log-shape matrix, the helper contract and the mutation probe; two predicate-index entries closed; PROMPT_VERSION v438–v441 history restored.
- `88a83533e` Comments that described the wrong thing are fixed; the KILL ATTEMPTS legend's wall floor is read off its constant (rendered text unchanged).
- `a47dd8b14` The daily log pull follows the upstream's 30-log quota: 20 Solo Shuffle and 10 3v3.

## v0.1.38 (2026-10-22)

The fact3 round-3 audit (GH #153) checked thirty new rounds against their raw logs with two independent auditors. Its 61 confirmed defects were fixed class by class, every reader of each fact included. Two corpus-wide fact scans followed and became the regression net (`corpusFactScan`, `corpusFactScan2`: one deterministic check per audited fact class, run on a 605-file capture before and after every batch). After this release, batch 1 reads 0 in every class, and batch 2's residue is listed on GH #153.

Highlights:
- A cooldown pressed while its holder was out of sight counts as a press, tagged `[pressed while unseen]`.
- A reflected spell's return is measured from the reflector's actual hits.
- An IMMUNE control on your team always gets a line, with the cause the log shows.
- A kill window's `defenseless` span ends under the target's own pressed absorb shield, an Intervene, Mass Invisibility or Phase Shift.
- Divine Toll counts as a heal that reaches allies.
- Blessing of the Bronze speeds the movement cooldowns it names.

Every change that adds or removes an accusation was previewed on the 605-file capture and approved by the user before landing.

Known review debt (GH #144): no cross-AI review has run since the reviewer's weekly limit ran out (2026-10-21, about 17:00) — every code commit below from `9d24d307` on, about 31 commits. The five cooldown-mastery commits listed under v0.1.37 are also still unreviewed. All of it is queued for the next review window (codex from 2026-10-27, agy from 2026-10-24); in the meantime the corpus scans above gated each batch.

### AI coaching — what the report says about you

#### Kill windows, kicks and saves

- `dfb4cca9` **User rulings 2026-10-21:**
  - The target's own Power Word: Shield / Void Shield ends `defenseless` while it is up, and so does an Intervene on it — never an accusation.
  - A mage in Ice Block is no ready kicker.
  - 605 files: kick-priority-missed +1, kick-priority-team +2 (one event), user-approved. `[KILL WINDOW]` 8,443 → 8,338, `[VULNERABLE]` 411 → 435.
- `03a355dc` **Round-3 audit, kill windows:**
  - Vanish joins the kill-window roster (user ruling; rogue `[KILL WINDOW]` 1,203 → 752).
  - Aspect of the Turtle deflects rather than being immune.
  - Mass Invisibility, Phase Shift and Intervene end `defenseless` while up.
  - kick-priority judges a heal against the lowest target of every overlapping window.
  - 605 files: kick-priority-missed +17, kick-priority-team +22, kick-eaten +1, position-mistake +1, questionable-external −6, cd-waste −6, cd-hoarded −1 / +2, external-unused −9, backlash-dispel −1, user-approved.
- `dd6fb6c6` `43be70b1` `023d857b` `45786610` **The target's own absorb shield ends `defenseless`** — any absorb it pressed (Holy Bulwark, Blazing / Prismatic Barrier, Ignore Pain, Reversion, the Holy Priest's proc Power Word: Shield). A shield counts within a minute of its press; a talent's passive absorb (Frost Shield, Fel Armor …) does not. corpusFactScan2 spans over an own pressed shield: 134 → 2. No candidate moved.
- `127021a5` **Divine Toll reaches allies** (fact3 D7): its only non-dummy effect is the caster's Holy Power, which had hidden the ally-area rows. 605 files: healer cd-hoarded 566 → 574 — 14 added, all a Holy Paladin's Divine Toll ready while a teammate was in crisis; 9 removed, where a pressed Divine Toll now answers the crisis. Hints reading "cheaper available: … Divine Toll" went from 209 to 627. User-approved.
- `5e0dd271` **cc-avoidable may name more of the player's own buttons** (user ruling 2026-10-22): Blink, Icebound Fortitude, Lichborne, Demolish, Aura Mastery, Unending Resolve, Obsidian Scales and Zen Focus Tea, each stopping only the control mechanics its DB2 rows list. No change on the 605 files.
- `c5f8d4cb` **backlash-dispel reads the target's HP at the dispel itself**, not at that second's `[STATE]` tick (user ruling 2026-10-22, fact3 D45; the fourth signed exception to the render grid). 605 files: backlash-dispel −1 (two left the HP band, one entered); 39 HP facts re-read. User-approved.
- `e46196d6` A monk's Touch of Karma window ends at that monk's own redirect removal. Controls into Aspect of the Turtle count in ABILITIES INTO IMMUNITY.
- `35eb2125` kick-eaten reads the other kicks' lockouts with the round's units: a non-holder's Counterspell is 5 s there too.

#### Cooldowns

- `7a6cae8e` **Blessing of the Bronze speeds the movement cooldown it names** (fact3 D13: a Disc Priest's Leap of Faith back after 84 and 82 s under a 90 s kit).
  - It works whoever applied it (an evoker ally), and when the round opened with it.
  - The same pass adds Sylvan Beckoning and Spirit of the Thicket on Swiftmend, Mystic Knowledge on Riptide, and Ground Skimming on Surge Forward / Skyward Ascent.
  - Evidence: DB2 aura 454 at −15 % on Leap of Faith's category. In the corpus, priests carrying it recast down to 51.3 s — Move with Grace's 60 s × 0.85.
- `9d62c243` The kit prints the range of a cooldown a buff sped up this round, as the `[RES]` rows read it: Emerald Communion `[166–180s]`.
- `03a355dc` Berserk and Celestial Alignment last DB2's 15 s.
  - Intervene lasts 3 s in arena (user ruling; Protection's 6 s is not modelled).
  - Anti-Magic Shell 444741 carries Anti-Magic Barrier (2,284 of 2,366 runs at 6.0 s).
  - Axe Toss and Shambling Rush take their control effect's mechanic.

### AI coaching — the timeline facts

- `03a355dc` **Round-3 audit, facts** (each fix has a regression test and was checked on the audited rounds re-rendered from raw):
  - **Presses made while the unit was unseen** — an aura new in the batch that re-states the unit, with no cast row — are presses for the cooldown ledger, the death analysis, `[ENEMY DEF]` / KILL ATTEMPTS and `[ENEMY CD]` / `[ENEMY HEAL CD]`, tagged `[pressed while unseen]`.
  - An IMMUNE miss names only an avoidance that can stop that control.
  - Spell Reflection explains a REFLECT, never an IMMUNE.
  - No mobility credit once a miss row proves the control reached the player.
  - A CC with no logged removal ends at its diminished length.
  - A friendly dispel-backlash silence is a `[SILENCE]` line with the presses made during it.
  - Spiritwalker's Grace is no defensive.
  - The Hunt / Stormkeeper end on arrival or spent charges.
  - An empower hold binds to its own press.
  - Guardian Spirit that was unaffordable or refused is not "free".
- `9d24d307` `168fe85a` `033c0335` **A reflected spell's return:**
  - Excluded: a dispel backlash of the same name, and a reflector's own hits after the projectile's flight.
  - Included: the copy the reflect itself put on the caster.
  - One spell's REFLECT rows under its two ids are one return.
  - A scripted damage spell (Fel Lance) keeps its return.
  - A Nether Ward row goes to the nearest reflect.
  - corpusFactScan reflect-return rows 202 → 0.
- `5a0abd22` `8619569f` `c7dfcba0` `fa8c4bde` `33a656b5` **Hidden presses:**
  - Found by the press's own effect aura (Alter Time).
  - Vetoed by a copy the batch re-states, not by a stealth opener's cast or a press's second same-named aura.
  - Herald of the Sun's proc bundle is no press.
  - corpusFactScan hidden-press rows 288 → 0.
- `a7ee20cf` A castless Blessing of Sacrifice is a press (605 files: cd-waste −1, cd-hoarded −1, user-approved).
- `c7dfcba0` An enemy break racial names the reflected control it ended. An offensive aura's run is paired per source (two mages' Touch of the Magi on one target are two).
- `8619569f` `0ed29933` A press in a removal's own millisecond does not take a control the log gives another cause for.
- `7aec3189` A press's HP is read before its own first HoT tick, even when that tick leads the cast row by up to 150 ms (Frenzied Regeneration 42 % → 34 %).
- `b9b3950f` `eebc1652` `8f155f17` **An IMMUNE control or silence on your team always gets a `[CC AVOIDED?]` line.** The line gives the cause the log shows: an avoidance aura, a Cyclone, diminishing returns at Immune, or none.
  - The avoidance table gains the DB2-explained immunities: Freezing Trap / Imprison / Time Stop (all-school), Blink, Icebound Fortitude, Lichborne, Travel Form, Demolish, and the silence-immune Aura Mastery, Spiritwalker's Aegis, Unending Resolve, Obsidian Scales, Sanctified Ground, Zen Focus Tea.
  - corpusFactScan2 IMMUNE rows with no line: 427 → 22.
- `189b6ac8` A move pressed after a ground control went off did not dodge it (12 of 30 such credits; Capacitor Totem pulses, Freezing Traps that caught a teammate).
- `f4c02f62` Mass Invisibility re-measured: nothing but area damage lands more than 2 s after it goes up. The user kept the ruling.

### Desktop

- `4d131ae3` Scene baselines follow the 2026-10-21 rulings: the real sample's enemy priest's own Power Word: Shield ends its kill window.

### Evaluation and verification tooling

- `a7e640ce` **`corpusFactScan` (batch 1):** four corpus-wide deterministic checks.
  - Hidden presses with no line.
  - Aura / cast-row gaps.
  - A control "ended early" that ran its full length.
  - Reflect returns.
- `1d968d74` **`corpusFactScan2` (batch 2):** six checks.
  - Immune causes.
  - Unclosed diminished controls.
  - Saves inside a `defenseless` span.
  - Pet kicks.
  - Duplicate lines.
  - The immunity table's forward check.
- `8619569f` `c7dfcba0` `033c0335` `0ed438a0` `4ce9f54d` The scans share the product's constants and predicates (`hiddenPressMs`, the reflect-return constants, `HERALD_PROC_BUNDLE_IDS`, the press-heal leads). Each pair is registered in the predicate index and pinned by its test.

### Other

- `9c75b19e` `cedc8c27` `82795e75` `d1593db7` `3b40263c` `5df0c066` PROMPT_VERSION 436, 437, 438, 439, 440, 441

## v0.1.37 (2026-10-21)

Two pieces of work. The fact2 round-2 audit (GH #153) checked the timeline against the raw log class by class and fixed every reader of each fact: an aura is resolved to the cast that made it, kill-window bursts count hits a shield absorbed, a reflected spell's return is the reflector's damage, ENERGIZE / DRAIN / LEECH rows are HP and position samples, and a trough reads the unit's death second up to the death. The cooldown ledger now models what the talents actually do: per-rank and per-spec talent points from DB2, tooltip spec branches, event-based cooldown reductions (power spent, interrupts, hits, resets), hotfix-dated values, and buff durations read off the talent tooltips and confirmed on the corpus (GH #154, #155). Impossible recasts in the ledger fell from 5,240 to 229 over 2,240 files. Every change that adds or removes an accusation was previewed on a 605-file capture and approved by the user before landing.

A same-round re-audit of the 30 audited rounds then found 66 of the 67 round-2 items fixed; its remaining findings were fixed before the release or are listed on GH #153.

Known review debt (GH #144): the five cooldown commits `dec9626b` `c4a5a61d` `d2f2c08f` `01643393` `5dcd31c5`, and three queued review units (the retest group 1 follow-ups, the 2026-10-20 rulings, the GH #155 durations) that hit the reviewer's usage limit, have had no cross-AI review yet; nor has the retest fix batch `c4291be6`.

### AI coaching — what the report says about you

#### Cooldowns

- `dec9626b` **Druid cooldown talents the ledger missed** (GH #154): Control of the Dream credits the time a cooldown sat ready, Cenarius' Guidance takes 5 s off Tree of Life per Grove Guardian and 60 s off Restoration Convoke, and Call of Ohn'ahra reads its value by the log's date (Nature's Swiftness impossible + floor-explained recasts 502 → 0). **Candidates added:** missed-sync-window +7 (a Balance Force of Nature back inside the window), user-approved
- `c4a5a61d` A talent several specs take carries one effect row per spec, and only the tooltip says whose is whose; the tooltip's spec branches now gate those rows (45 rows of 17 talents). A Fire Mage's Dragon's Breath is 40 s, not 28; Improved Feign Death is read per rank (25 → 20 s); Feral Convoke is 60 s. No candidate added or removed; 3 `[PEEL OPTION]` lines that offered a Dragon's Breath on cooldown are gone
- `d2f2c08f` Talent points are read per purchased rank and per spec from DB2 (nothing read either table before): Holy's Blessing of Sacrifice is 105 s, Avenging Crusader 52.5 / 45 s by rank. **Candidates removed:** cd-hoarded −14 +1, external-unused −7, slow-defensive-response −2, user-approved
- `01643393` One cooldown model for every reader outside the ledger (`unitCooldownEntry`): kit readiness, the enemy cooldown timeline, kill-window defensive state, defenseless windows, the death recap and contested trades. Power Infusion's two SUCCESS rows per press no longer read as two presses (6,678 "impossible" recasts → 0). kick-priority-missed / -team −1 each, kick-eaten −2, user-approved
- `5dcd31c5` **Event-based cooldown reductions are modelled** (user ruling 2026-10-20, superseding #124): power spent, interrupts, hits, consumed buffs, attacks taken, aura ends and resets, and charge spells on the same effects and the rate windows' warped clock; hotfix-dated values for Sacrifice of the Just, Unbreakable Spirit, Safeguard and others. Ledger impossible recasts 5,240 → 229. missed-sync-window dps 373 → 437 / healer 140 → 164, kick-eaten +7, external-unused −9 +5, cd-hoarded −4 +1, user-approved

#### Kill windows, kicks and saves

- `c4291be6` **Same-round retest fixes** (user-approved on a 605-file preview): no kick-priority finding for a heal cast inside the Spirit of Redemption form (233 such casts, none kicked; kick-priority-missed dps 35 → 29, kick-priority-team dps 27 → 23 / healer 30 → 25); a burst window counts the answers the crisis readers already count — Bear Form, Frenzied Regeneration, Roar of Sacrifice, Void Shield, Fade … (slow-defensive-response 88 → 69); death-setup +3 (a Mind-Controlled healer feared by its own warlock); burst-into-mitigation −1

- `3d369bae` `2a9264c1` User rulings on the v0.1.36 retest: Time Dilation held back is mitigation, a ready Alter Time is a defensive in hand for kill windows, and racial damage buffs (Blood Fury, Berserking, Ancestral Call) and Ultimate Penitence are offensive cooldowns (kick-eaten +6 / +5, missed-sync-window +2 / +3, position-mistake −3 +1, slow-defensive-response +2)
- `6c20acbb` `8f2e472f` `81146d03` **User rulings on the three open retest questions**: Counterspell locks 6 s only for an Improved Counterspell holder, 5 s for a kicker known not to have it (605 files: 4 non-holders back at 4.93–5.00 s, 501 holders at p50 6.01 s). Survival of the Fittest, Retribution's Divine Protection and Dark Pact join the kill-window roster, and a roster defensive the kit shows `[UNUSED]` is in hand all round — not an unpressed heal or ally-only cooldown (Desperate Prayer, Divine Hymn, Tranquility, Blessing of Sacrifice). Shield of Vengeance gets its own `[ENEMY DEF]` line. `[KILL WINDOW]` 13,116 → 8,473, `[VULNERABLE]` 569 → 410; kick-priority-missed dps 38 → 35, kick-priority-team dps 26 → 27 / healer 31 → 30, user-approved
- `81228bc8` User ruling R7, option A: hits a shield absorbed count when bursts are found and floored, the `[KILL ATTEMPTS]` measure (+412 `[KILL WINDOW]`, −217 `[VULNERABLE]` "not punished"; no candidate moved)
- Across the fact2 batch below (base `fcde27b1` → merged): cd-hoarded dps 648 → 605 / healer 601 → 576 (mostly a control the owner pressed in the response window — Freezing Trap, Intimidation, Lightning Lasso … — now recognised as an answer), missed-cleanse +29 / +21 (an enemy's DEBUFF on our side is no longer read as our burst threat), menu events 7,559 → 7,560, user-approved

### AI coaching — the timeline facts

- `4da9c85e` **Every cast-keyed reader resolves an aura to its cast** (cast id ≠ aura id): KILL ATTEMPTS self-saves (Alter Time), stacked defensives, the death-window audit, the burst ledger's walls (Rallying Cry, Spirit Link Totem), `[BUFF FADED]`, and controls made by a press (Ring of Frost, Freezing Trap, Binding Shot, Sigil of Misery …) on every cast-side reader. Kill-window team damage prints `+Nk absorbed`
- `043ae29c` Round-1 classes the round-1 fixes missed: the Flameshaper copy follows the unit carrying it, press-only offensive cooldowns are listed by the `[RES]` reading as `[press-only]`, `[CD PRIOR]` bottomed-at reads the dip, Command Demon is the pet's control, an unclosed Oppressing Roar ends at 10 s, a control that ran its full length was not broken by a press, Time Dilation's delayed damage names the shield's caster
- `827309cb` Kill attempts name who the team hit inside the bracket and anchor on the first press into them; a Spell Reflection return is the reflector's damage, with its school kept; every point HP reading is the last at or before the instant; `[RES]` opener rows list untouched cooldowns as ready; rider dispels print no `[ENEMY CLEANSE]` / `[PURGE]`; a pressed Spirit of Redemption is an immunity save
- `933c2838` Second part, each class zeroed by a deterministic check on 29 audit logs: an `[ENEMY HARD CAST]` "landed" needs a damage or absorb row, a press's HP sits under its own first tick, a reflected control is no buff of the owner's, `[HEALER EXPOSURE]` drops a control certainly on cooldown (1,149 → 0), kit cooldowns print their `[a–Ns]` range (241 → 0), "locked out" exemptions print how long (37 → 0), an untargeted AoE miss under an avoidance buff is `[CC AVOIDED?]` (48 → 0), Stampeding Roar is no control
- `7c14ff54` Round-1 retest leftovers: Greater Invisibility is over at its holder's first damage, a summon's purge names the summon, a proc's trigger may lead it by 50 ms (165 of 223 Wake of Ashes → Avenging Wrath pairs within 1 ms, 57 at 2–50 ms), a re-press refresh splits a wall, a reflected cast is not "into" an immunity, a press refused on an ally carries `[IMMUNE]`
- `81228bc8` User ruling R1: a trough reads the unit's live samples in its death second up to the death, and the gates accept it (troughFactScan on the 29 logs: killWindowTeamMin 5 → 0, consequenceLow 15 → 0)
- `ef24bfdf` 605-wide residuals, each traced to the log: a summon's avoidance buff names its owner, hard-cast results pair to the latest completion before them, a press's HP counts its own refresh or same-named heal, press evidence comes from the unit only, a control that outlasted a trinket press was not ended by it, Hex's variants are one button, a promoted heal-cooldown line carries its refused-target `[IMMUNE]` tag
- `a866f317` `2499cc5b` v0.1.36 retest, group 1: a Dragonrage running past combat end, channel / refresh press HP, ABILITIES INTO leaves out a school or control the immunity does not cover, The Beast Within by mechanic, the kill window's "your CC ready" reads the kit, the Kingsbane chain, an unreleased empower in Stasis, a reflected Cyclone on a trinket line, `[REJECTED]` runs per spell, ghoul labels by GUID owner, Touch of Karma ends at its debuff's removal; the KILL ATTEMPTS legend states the 20 % external floor, and an untargeted non-control press carries no `[IMMUNE]` tag
- `db1b3956` `88fade8d` **Buff durations read off the talent tooltips** (GH #155): 14 tooltip-stated, corpus-confirmed extensions (Apotheosis, Cloak of Shadows, Zenith, Desperate Prayer, Power Word: Shield …) and Spiritwalker's Momentum per press — the kit prints "lasts 15–19s". No candidate moved; 1,875 context files
- `c4291be6` **Same-round retest, facts**: one `[CC AVOIDED?]` per Capacitor Totem hit; a Vanish broken by its own Cheap Shot and a Frenzied Regeneration ended by a shapeshift say so; a dead healer's kill window is not "free" with CC ready; Shield of Vengeance reads `[no press logged]`; the burst ledger and KILL ATTEMPTS leave out Time Dilation's deferred absorbs; Nether Ward returns count as damage back; a warlock purges only while the Felhunter is out (the header says until when); a removed disarm is named on the cleanse lines; an owner's control applied by a talent (Terror of the Skies) is "CC cast"; the spam fold counts every cast; a control from a charmed player's own team is a CC on it, tagged `[from its own team, while charmed]`; Berserker Rage / Shout and Nullifying Shroud avoid by their DB2 mechanics; a stun chain ends at its latest-ending stun; a Roar-lengthened silence or disarm is judged on its real length. **User rulings 2026-10-21**: `[CONSEQ]` starts at the HP when the control landed (not the earlier `[STATE]` tick; a quiet line lists its readings), and Frost Nova lasts 8 s for an Improved Frost Nova mage
- `fe557151` Cross-AI review fixes (10 of 15 findings confirmed and fixed, each a regression test): a deferral shield's absorbs stay out of every burst and kill reader, a friendly debuff is no enemy threat, Grounding sees split-id controls (Lightning Lasso), the kill-window acquittal states both qualifications, a Medallion after a disarm or silence ran its full length did not end it, opener `[RES]` rows respect Forbearance, a suppressed `[RES]` row keeps the delta state, a reflection return goes to the nearest damaging chain (`[REFLECTED]` 42 → 52), effect-evidence presses are grouped by the effect's length, and out-of-round casts no longer switch inference off. No candidate moved

### Combat-log parsing

- `d8978e39` SPELL_ENERGIZE / SPELL_DRAIN / SPELL_LEECH rows and their periodic forms carry the advanced block (HP, max HP, position); the parser now takes them as samples (0.6–8.2 % of a log's advanced-bearing rows the HP and position samplers never saw)

### Cooldown, talent and spell data

- `db1b3956` `82e7337a` `genTalentDurations` reads talent duration extensions off the zhCN tooltips (169 entries: 120 fixed, 48 per-event, 1 set; 17 unparsed), registered in the datagen manifest and the season runbook

### Desktop

- `3d369bae` The death recap's mitigation audit says Time Dilation "held back" damage that lands later, not "delayed, not prevented"
- `e0a12561` `16eb842b` `5f7e2a64` Scene baselines and fixtures follow the fixes: the report-synth death recap lists the Blur its burst ledger named; the real sample's enemies hold unpressed roster defensives (Ice Block, Evasion, Aspect of the Turtle …), so their kill windows and the missed purges inside them are gone

### Performance

- `a3fcff9e` First paint back under budget (CI ratio 5.7 → 2.6): the dispel summary memoises each unit's cannot-cast intervals and the re-press split indexes REFRESH rows once. 605-file output byte-identical

### Evaluation and verification tooling

- `933c2838` `2a9264c1` `81146d03` `88fade8d` `fact2Scan` (one deterministic check per audited fact class, now including inHandRewind, stackedDeferral, racialPressedInside, kitInHand, riderShieldLine, ledgerRosterUp, kitTooltipLasts) and `talentDurationVerify` (holders vs non-holders' full-run lifetimes)

### Other

- `c4645a92` `9901ccba` `4274bbc7` `2071437a` `5d4d76bb` PROMPT_VERSION 427, 431, 433, 434, 435
- `bcd5ec8d` `7ac8ade0` Lint warning ratchet kept at 1572

## v0.1.36 (2026-10-20)

A month of fact-layer work. The coach's timeline was checked line by line against what the log actually shows and rewritten to state the real game state: a printed HP low is the true lowest point at the second it happened; a control says who or what broke it and how it ended; a PvP trinket press lists every CC it removed; a pet's dispel names the pet; an enemy wall no press put up reads `[no press logged]`; enemy Champion's Spear, Smoke Bomb and Tremor Totem presses get an `[ENEMY UTILITY]` line; a kill window closes when the target puts up its own wall, immunity or absorb; and a silence the log writes no aura for (Solar Beam) shows when a refused press proves it. A kick lockout now stops only the school it locked, kill windows end at the target's death and at the round's end, and the cooldown ledger sees the defensives players actually press. Every change that adds or removes an accusation was previewed on a 605-file capture and approved by the user before landing.

The work went through many cross-AI review rounds, each finding pinned by a failing test. The reference tables were regenerated in batches at pinned commits (GH #115), and the WoW data was refreshed to 12.1.5.70391. On the desktop, an opt-in AI self-review re-checks the findings against their own prompt (wrong statements 48 → 15 in the offline experiment), and Claude Opus 5.5 is the default model.

### AI coaching — what the report says about you

#### Kicks and interrupts

- `21070935` `1fd9fffb` `11a6872c` `796d9cb8` `d3a28634` `1cc1bb6c` `b849da7c` `25047a2a` `2dc4fa7d` `73c5dd26` `6408863a` `6b3665db` **A kick lockout stops only the school it locked.** Every reader treated any interrupt as locking every spell (1,199 presses outside the locked school happened inside a lockout on 605 files). cd-hoarded and the sync-window ready gate ask per spell and print the locked school (**candidates added**: cd-hoarded +2, missed-sync-window +9); missed purge / cleanse, kick priority, cc-avoidable, `[CD PRIOR]`, burst-window feasibility, the death block's missed options and `[DEFENSIVE AVAILABLE]` followed, each after a 605-file preview, and say which spell the number is about
- `d7d3cfff` **kick-eaten judges a kick by both sides' pressure during the lockout** (user rulings, GH #113): each line states the lowest HP, any death and both sides' cooldowns, and a kick with both sides calm and no burst of ours ready is dropped (dps 1,030 → 998, healer 506 → 475)
- `de3aeb57` `9c65b55b` `c28fab1b` **kick-eaten adds candidates**: the per-round cap orders kicks by pressure and the first two kicks at a death or crisis HP do not count toward it (1,450 → 1,850 lines, user-approved). Pressure counts only a cooldown already running at the kick, and a unit inside a full immunity is not "low" (−36 +12, then +4)
- `78b46830` `36908dcd` `1c523fc9` `4ce68664` kick-eaten reads rejected presses — no "did nothing" or "waited out the lockout" while the game refused the casts (≥ 162 → 0); a trinket or racial out of a stun is a CC break (24 → 0); the line names the locked school ("instant or channel" 804 → 0) and suggests out-ranging only when the spell reaches farther than the kick
- `ea2790f6` `508307f0` After the kick, a spell is locked only when all its schools are; the "switched" line shows rejected presses with their offsets, key repeats are not presses, and the lockout ends at the first success in a locked school (switched / acted 1,924 / 809 → 2,111 / 622)
- `9a39c98c` `b1b0cf48` A kick on a channel after the spell already went out is marked `phase=channel` (273 of 1,536 lines); a multi-school lock lists its schools, and "burst ready" no longer claims the kick slowed your tempo
- `cf27fc9c` **New: the recording player's own cast control.** kick-eaten states how many hardcasts you stopped yourself and how many enemy kicks you baited; the kick dashboard gains a strip with the same counts (corpus: 66 % of hardcasts completed, 17 % self-stopped, 6 % kicked)
- `44ab92a8` `1935dc0f` `aab9a5c2` `fb759123` `2818d271` The cancel count reads cast bars exactly as `[CAST STOPPED]` does (126 of 1,869 rows), and a bar broken by your death or the round's end is not a cancel. "JUKED by fake X" names the last bar begun before the kick, only when nothing else ended it (970 → 782); `kickDepthPct` is measured against your own completed bars and never clamped to 100 (75 → 10 rows)
- `b7e92ac3` `dd3d5541` `63fc9df6` `68a609b8` kick-eaten rows state a press refused for another reason (202 rows), a kick that also silences, no 50,000 yd placeholder range, `kickLandedFromYd` (196 rows), and an interpolated distance as approximate
- `0e71f311` `0f2d9e2b` "Our low" and "their low" are read only inside the lockout's printed seconds (166 → 0), and a hard cast that logs a companion cast first (Chrono Flames) is the switch press (`0e71f311` went out with a placeholder title; `0f2d9e2b` records it)
- `c5a20f11` `a7197940` `e8305ed2` `9eb859c9` Kick distances read the castable spell (Skull Bash 13 yd, not 100; Mind Control 34.5, not 134.5). A kick is "missed" only if the kicker could have reached the healer before the heal landed — a root cuts the run (the root list gains Ice Nova and Harpoon)
- `d0956fe0` `96c98c0a` `e5b2d663` Who could have kicked is read at cast start: free kickers, gap-closers, an immobile owner; a dead or controlled enemy's interrupt is not "UP"; `outRangeable=yes` needs a kicker too far to walk in during the cast (76 → 10 rows)
- `1d352ea8` `1293c3ed` `b73689fe` `036170bd` kick-priority states the span it judged, the kick's range and reach, how long the kick had been back, calls a root a root, and says how many casts a heal figure sums (kick range on 0 → 91). kick-eaten counts the round's kicks by the same kicker (0 → 1,225), kick-priority-missed says what the player was casting, and a kick after a just-stopped channel is juked by it
- `76db805e` `7b149088` The kick audit gives one kick one entry; a silence that landed is not "hit nothing". A reflected CC or silence locks its holder, dispel backlash locks the dispeller, and a Storm Conduit holder's kick lockout is ×0.6 (cc-avoidable −1, missed-cleanse +1, user-approved)
- `a024f160` `24ce73b7` `05e976d5` A spell a controlled pet casts (Spell Lock, Devour Magic …) is asked of the pet's own controls and lockouts, not the owner's; totems and guardians stay on the owner (0 candidates moved)

#### Cooldowns and saves

- `efc522b4` `28cbee6f` **The ledger sees the defensives players actually press.** A forward-completeness scan added Survival of the Fittest, Greater Invisibility, Alter Time, Retribution's Divine Protection, Lay on Hands, Spellwarden's Anti-Magic Shell and Transcendence: Transfer; 13 wrong spec exclusions are gone and a shared DB2 charge pool spends both spells (cd-hoarded −177 / +187, cd-waste +158). User-signed: Greater Invisibility (60 %) and Divine Protection (20 %) become priced walls, Lay on Hands a burst answer
- `cc7ab31a` `bb2b48c9` `024c9af3` `cb36a1aa` A spec's baseline defensives stay in the ledger in a round they were not pressed (cd-hoarded 1,245 → 1,266), and a talent whose entry carries another spell id proves the button it grants (Fortifying Brew, Avenging Crusader, Incarnation / Celestial Alignment, Berserk, Lay on Hands)
- `cb8b7729` `1fce5ef6` `d5f0d915` cd-hoarded counts a save pressed just before the crossing and stays silent when a major wall is already up (2,241 → 1,858); a save given to another teammate does not answer this unit's crisis; a school-limited save is named only when it covers most of the crisis damage
- `20edc688` `59fd92cf` cd-hoarded judges a school-limited save by what was aimed at the crisis unit, landed and absorbed — the `[KILL ATTEMPTS]` predicate (+1); Anti-Magic Shell counts only when at least half the crisis damage is magic (−7)
- `f81ab360` **Accusations need an owner who could act.** cd-hoarded, cc-avoidable and missed-cleanse do not fire while the player was silenced, kicked, stunned or trapped; a dead teammate is not an eligible dispeller; Solo Shuffle findings after a round's first death are dropped (123 entries removed)
- `31836ea2` `ae41cd54` `4ed039df` `bfe5eff1` `33a41478` The owner gate pairs auras in log order, counts enemy pets and totems and stops at the round end; cd-hoarded states `ownerCc` and `ownerFreeS`. The free span starts at the crisis second, and a stun counts only if it stops that cooldown (Icebound Fortitude under Shockwave: 5.0 s free, not 3.0)
- `cfce4256` `f337f942` Divine Shield, Ice Block, Icebound Fortitude and a self-cast Blessing of Protection are usable while stunned (DB2 immunity route); a CC removal pairs with its own caster's application (−3)
- `2478cb35` `985741e9` `639b6fb4` `41e9b29c` cd-hoarded states when a rejected press happened and how long you could still act (634 of 1,313 lines); a ready cooldown rejected inside the GCD counts as an attempt. cd-waste says "never successfully cast", and the kit reads `[UNUSED — pressed N×, refused: …]`
- `e0012b99` A crisis point's "damage in the prior 2 s" ends at its HP reading, so the crossing hit is counted (cd-hoarded +16 / −11)
- `02d64099` `bbbc4eee` `e105bbd3` `fc4d2f3b` One decision, one card: external-unused wins over cd-hoarded for the same victim within 5 s (−63). cd-hoarded never names a cooldown you could not pay for — the cost the unit's own cast rows state, which the parser now keeps (Innervate exempt)
- `bd321b4f` `972e47b5` `ad41d1fd` `a7fc4db5` Emerald Communion is a team save (+9 / −10). **Candidate added:** Mass Invisibility is an accusable defensive, reaching a teammate only with Improved Mass Invisibility (+31 / −13), but not in cd-waste. Feign Death is a response only, never accused (635 → 617)
- `4c501cb1` `e5f4375e` `4117f97b` `17d05417` `fe55309a` Death Pact joins the Death Knight ledger (+5 −2), Lichborne and Smoke Bomb as utility; Time Stop, Tree of Life and Havoc Metamorphosis get rows, and a Flameshaper's Obsidian Scales names the ally it landed on (user-approved)
- `5b6f4465` `c1ced674` "Never pressed" counts a press from the same charge pool (cd-waste 983 → 938), and one cd-waste row names a shared pool's buttons together (25 → 22); the low-pressure NOTE names only self-only defensives
- `17b85fa5` `87026ad2` `592e3e63` "Cheaper available" offers only team-capable tools for a team save, only stun-usable ones to a stunned owner, and never Avenging Wrath (3,143 → 2,711 over two passes); `[DEATH] … Unused` reads the same rule
- `55f81a65` `e4532584` Barkskin and Frenzied Regeneration are Restoration Druid saves for the druid's own crisis, never accused; crisis-no-response stays silent under a major wall (12 → 9)
- `471649ce` `1d1c1747` slow-defensive-response says when your ally save was rejected; crisis-no-response says what you pressed instead of "did NOTHING"
- `10272d40` `7315f4fd` cd-hoarded says when you had just pressed your own burst and which defensives you pressed that were still on cooldown; missed-sync-window says when a held cooldown went into the next healer lock
- `2547c4a5` `bd5a6e19` `af1ad016` Who broke an aura is read from the hit behind the break row; a Blessing of Sacrifice split is the paladin's own spell (cd-hoarded +14, crisis-no-response +1). A redirect save pressed for the unit in crisis answers cd-hoarded (−24)
- `a19623f7` burst-into-mitigation fires only when a wall covered more than 60 % of the burst, a door read from data (163 → 35; 2v2 left alone, user ruling)
- `9b99eb04` `1f199ca8` **A one-second reaction window for "ready and not pressed"**: a cooldown back less than a second before a death or crisis is not unused (35 `[DEATH] (Unused: …)` entries removed); `[CD PRIOR]` and burst-answer feasibility read the same rule

#### Sync windows, bursts and kill windows

- `b72807af` `d8b6240b` `d938a685` `3a426dfb` missed-sync-window: an Immune CC is not a window, one continuous healer lock is one window, a "ready" cooldown needs a free owner, a running burst counts as entered, and a healer's cooldown counts only if it is Power Infusion (dps 1,100 → 642, healer 550 → 321)
- `d75a3d95` `e8834062` `fdf3e198` `ab13c330` A lock's length uses the control lines' formatter, cut at the round's end, and only its in-round part is ranked (756 → 726). Each ready cooldown says whose it is; in Solo Shuffle a row reaches you only when a cooldown or the control is yours (42 → 25)
- `ce125136` `905d1c86` missed-sync-window states when the cooldowns were pressed and came back, why the holder could not press, the enemy at the lowest HP and what ended the lock (+12)
- `bd097f52` `2d36e612` `169491be` An offensive cooldown is "running" only while its buff is up on a player — no 10 s floor, not on a pet copy (Stormkeeper median span 15 → 5.5 s). **Adds and removes candidates** across kick-eaten, position-mistake, slow-defensive-response, burst-into-mitigation and questionable-external
- `07ab3c83` `2b7ea99a` **Empower Rune Weapon is no longer an offensive cooldown** (lines naming it 3,099 → 30; +13 −8, user-approved). Your press of a cooldown the enemy side prints counts as pressed (1,719 of 1,826 had no line; missed-sync-window 807 → 747)
- `8db675ae` `b0fb637b` `9904cb96` **Kill windows end at the target's death and at the round's end** (53 of 765 `[VULNERABLE]` lines started on a corpse; 3,926 Solo Shuffle spans ran past the round → 0). Kick-priority rows at a dead target are **removed** (−6); two new gates hold both
- `24181198` `937b9dc4` `df5744b7` `c71c308d` `a855704d` **A "defenseless" span ends at the target's own save**: an external, Blur, Greater Invisibility, Burrow, Time Stop (−119 / +10), its own 20–99 % wall, immunity, absorb or area save (kick-priority-missed 45 → 38, team 67 → 58), and a priest's Spirit of Redemption form (241 failures → 0), all user-approved
- `19538fe6` A 20–99 % wall the unit owns and has not pressed counts as in hand for the kill-opportunity tier (prime 4,712 → 3,734)
- `8ffcb686` `5930b49d` A dead player holds no cooldown — one dead-at predicate. Kill-window team burst counts owned pets (68 `[VULNERABLE]` lines become kill windows, user-approved)
- `45ae2188` `e45b3877` `e6de661c` A control answers a burst only when it lands on a unit hitting the pressured teammate (252 of 1,552 were on the healer). The pressured friendly is the one who died inside the window, ahead of any survivor; a dead friendly has no self-save after its death

#### Dispels and purges

- `4b72b713` **Candidates removed:** missed-cleanse tiers read the signed dispel-verdict matrix (16 new rows; 418 → 342 items)
- `8ca286ee` Dispel reach is swept from the rendered second, and line of sight is actually evaluated — the zone id was read from the wrong field, so the check had been range-only (missed-cleanse 438 → 422)
- `e018e7b7` `fbf1266c` **Candidates added:** Hunters and the Devourer Demon Hunter can purge (`[MISSED PURGE OPPORTUNITY]` +540 / −241); Shattering Throw answers immunity shields, Shiv and Arcane Torrent stay scoped, a purge at the buff's end counts (+19 −24, user-approved)
- `4820dfd0` `43e58265` `87bede27` `7e5a0f60` `4629caba` A missed-purge window ends at the round's end (59 → 0 past it) and a re-logged aura opens no second window; a refreshing press reads its aura's end (user-approved)
- `722c4d35` `ca8aa68e` `40924fde` missed-cleanse: no "mid hard cast" for a cancelled bar (34 lines); a form shift dropping a root is not a cleanse (`[CLEANSE]` 4,858 → 4,522); a Mind-Controlled teammate can only be purged
- `e1e2eedc` `adff9faa` `abb54e1f` A CC an enemy pet broke is broken by damage, not uncleansed (+1 / −2); every BROKEN line counts, whoever it names
- `296e4b25` `1f748efe` `40ca9059` `056fe589` `c937e58a` `9dab5701` missed-cleanse names your dispel, a backlash debuff it would remove, your rejected attempts, DR risk only for a CC with DR, proven-reachable seconds for a root, the cleanse's real recovery; occupancy counts bars, channels, drinking and empowered holds; post-CC damage leaves out Void Leech and Spirit Link

#### Deaths, positioning and controls

- `89ff539b` `4bd49a86` **Candidates removed:** death-setup's trinket-early and defensive-early shapes — a later death cannot show an earlier press was early (dps 907 → 579). healer-locked needs ≥ 3 s of CC inside the kill window and a victim who took damage (869 → 525)
- `90252b88` **Six fixes from the user's own 3v3 loss review**: 3v3 candidates stop at the first friendly death (user ruling; 126 dps death cards removed), `[IMMUNE]` only for players (2,372 → 1,679), "free Ns of Ms" never exceeds the window, and one malformed finding no longer fails the run
- `85c4f38f` `dd91ca98` `3197a11a` `e8744d52` STAYED IN / KITED and position-mistake measure to the enemy that hit you most (974 of 2,156 lines; **removed**: 294 → 176), never on your own corpse, and read HP on the printed window (532 gate failures → 0)
- `dd8249dc` `beccfcfa` A POSITIONING line names its span's burst target and the top damage dealer, how long the owner was CC'd, and skips windows the owner had no say in (+10 −16)
- `a09c498b` `ab72caed` cc-avoidable offers only a tool you could have pressed — no Divine Shield or Ice Block, a free GCD ≥ 1 s into the bar (89 → 62); an interrupted bar is not a free moment (−3)
- `4f32e742` `50f5ba8d` `408e3636` `6828e3eb` **New: PEEL OPTIONS** — before a friendly death, an instant CC ready on the main attacker for ≥ 3 s, as an option, never a verdict (28 % of friendly deaths)
- `8a6e8bfa` `43355cfd` **New: CC USE** — control counts for every CC you own and up to two `[CC BOOKMARK]` moments, never a missed cast (PEEL OPTIONS 235 → 208); both read DR through the applied aura
- `5c1ecc2f` **New: `[FORCED TRINKET]`** — your CC landing within 3 s of an enemy trinket inside your kill attempt is credited for timing (never the forcing, never a kill)
- `d06a86c5` `e927b9e3` **New: observed consequences.** `[CONSEQ]` shows a team's HP while its healer was kicked or CC'd; the coach may state what happened next, not counterfactuals (supported sentences 14 → 49 on 100 rounds)
- `9daf0a44` One round end: CC windows, uncleansed windows and healing gaps stop at a Solo Shuffle round's ending death (−12)
- `d111a142` `7b113bb4` `68dbabd9` `f040b861` `687bdc81` Death setup names the lock nearest the death with its locked and free seconds; missed options ask the cannot-cast predicate and say the caster's longest free stretch; KILL SEQUENCE names the healer's lock chain; deaths after the owner's leave the menu
- `63f3dfbd` `04a3eebc` `419882bb` `ac7478eb` User-approved fact fixes that move rows: Deep Breath and Dream Flight cannot cast, a disarm stops weapon spells, the sync window is entered by the observed end, a cast bar's start ends a kick lock, Summon Infernal lasts 30 s, Ice Nova is a root, Wake of Ashes misses are no `[CC NOT LANDED]` (slow-defensive-response 99 → 95)

#### Reliability leftovers (GH #107, #109)

- `91f065e1` `72bddd8f` Talent replacements from official data (cd-waste on Nature's Swiftness 12 → 0), Astral Shift and Psychic Scream no longer reduced twice, proc-only activations render as `[PROC]`, not presses; a druid-form buff ended by your own shapeshift says so; SPEC BASELINES show your rating and, below 2100, read as what higher-rated players do; the Chinese request asks for Chinese fact strings
- `86d71d4f` `[ENEMY HARD CAST]` only for bars that landed (13,297 → 2,302 — instant Hot Streak Pyroblasts read as hardcasts); a teammate's CC rejected as IMMUNE is tagged (0 → 1,450); Blessing of Sacrifice on its caster is not a defensive on the target; enemy window durations read talents (Demonic Tyrant 20 s with Reign of Tyranny)
- `a75d53a2` `8513a101` `b19b851f` A crisis is answered by a control peel or any team save (cd-hoarded dps 893 → 666); Cauterizing Flame leaves the save roster; missed-sync-window needs you free for half the lock; external-unused needs reach (Darkness is an 8 yd zone) and an enemy pet kicker is measured from the pet; a trinket binds to a CC only within 50 ms of its end ("out of X" 11,191 → 10,975)
- `ec984045` `c0c94505` The death line names the killing blow and the top damage in the final 5 s, including absorbed parts and deferred damage (Time Dilation); the team-save set includes Spirit Link, Barrier, Aura Mastery, Rallying Cry, Darkness and Zephyr (cd-hoarded dps 666 → 642); burst-into-mitigation accuses only a wall already up (dps 44 → 7); an enemy `[KILL]` line printed raw character names on 433 lines — now the roster label
- `fe8bf626` `f53203f1` `c5af5985` `d062116f` `[BURST ANSWERED]` credits the first response that reached the unit; "off-target" windows 3,559 → 579; a re-broadcast aura is one aura; KITED needs you to open the distance (1,965 → 1,556); HEALER TRAINED names a camper who hit the healer (2,579 → 1,399); summons are named through their owner (bare "[pet]" 4,305 → 5); not-ready presses are recognised in all five corpus locales; missed-sync-window needs the target in reach and folds repeated locks (dps 604 → 506)
- `f5f7798b` `58c87398` **New timeline facts** `[GROUNDED]`, `[REFLECTED]`, `[CC REMOVED]` and `[REJECTED]`; `[RES]` lists your own interrupt and Death Grip (0 → 4,408)
- `8cc7d09b` `27a822c9` `5f30b5c1` `2bef1356` `6b0dacfd` `b5e16700` Post-hoc codex / agy reviews of batches 7–14, each finding pinned by a test: fully absorbed hits name their attacker ("Unknown — absorbed" 1,228 → 11), group externals answer a burst, one latency clock, one `[REFLECTED]` line per channel (728 → 642), `[GROUNDED]` reads "was redirected into", KITED credits your Shapley share of the gap, "you moved N yd" shared with gate G4b, `[RES]` shows charges and talent-reduced kick cooldowns

#### Menu, prompt and wording rules

- `68c3bc36` No "the only cooldown left" or "the whole time" claims the ledger contradicts (32 → 8 on 50 responses)
- `a59903bc` The menu header states the citation rule instead of claiming every row "provably happened" (47.3 % of rows are facts about something that did not happen)
- `0de6f51b` `1f599438` The findings prompt asks for "up to N, at most one per menu event" for a small menu, and the audit drops a finding citing the same events as an earlier one (195 → 178)
- `973fbd42` cd-waste says "this round", not "the entire match" (in Solo Shuffle 64 % of rows had it pressed in another round)
- `be89bc59` `f3cb4f94` Every time fact floors onto the timeline's second — a trap at 113.957 s read "114.0s"; a syntax-tree test blocks the next one
- `2903812c` `cae10531` `15afb214` `3479acae` `a382c929` `9d6d0cd5` `dfe1dfa3` `74cffe18` `14bad33d` Legends: whole-second `[DMG SPIKE]` bounds, KILL ATTEMPTS "ran into" instead of "cause", legends for facts that had none, the `attempted` wrapper in English, kick-eaten's burst fact as "a cooldown was running", no pointer to an unprinted legend, healer-only lines hidden from DPS
- `e413993c` The `[MATCH PATTERN]` header is off until its labels come from the model's own run — 7 of 8 were wrong (2,742 → 0)

### AI coaching — the timeline facts

#### HP and damage

- `09b5b629` `dadebbc0` `9bc547e8` `49cdcf55` `d080f5bd` `46f708bf` `f1237fb7` `46603a80` `2b76a9bd` `92b1341c` `7745fa86` **A printed "low" is the real lowest point, at the second it happened** (user ruling). `[DMG SPIKE]`, `[CONSEQ]`, the burst ledger, `[BURST ANSWERED] bottomed at`, kick-eaten, STAYED IN, slow-defensive-response, `[KILL WINDOW]` team min and `[CD PRIOR]` read the true minimum (815 of 6,845 lows sat 10+ points above it; lows below the log 310 → 0). Decisions stay on the grid; kick-eaten −9
- `b0cca85f` `7141a674` `18305d6e` The `[STATE]` tick gets a legend; a `[DMG SPIKE]` closes at its victim's death or the round's end and reads 0 % at a death (165 of 16,613 buckets ran past the match)
- `0985a884` `efc05f62` The HP on a press line is the HP at the press — one signed exception to the grid; the owner's lowest HP "this match" is read inside the round
- `cc944a73` A `[STATE]` tick at every crisis second (735 / 1,322 lines without one → 0, new gate), your casts on the crisis unit unfolded, and Alter Time's return (0 → 553)
- `650fb921` `2cefc738` `d665a3a3` The `[DMG SPIKE]` legend says only the 5 largest windows are listed and counts the dropped ones; ABILITIES INTO IMMUNITY/DR keeps spells above 5 % (845 → 1,829 prompts); `Top sources` names an ability once
- `57b0e994` `779f84ae` A damage source's side is its roster's, and redistribution is not incoming pressure; mitigation-audit lines say their overlap is in the final 10 s

#### Controls, DR and breaks

- `d1137675` `31af1368` **One cast → effect-aura table** from DB2, verified on the corpus (69 pairs the hand map missed): an IMMUNE or MISS logged under the effect id tags the cast, and a CC line names who it hit
- `e8a53b47` `6d4bdcde` **New: `[SILENCE]` lines** on either side (11,276 lines) — before, the healer read as free to cast. A silence the log writes no aura for (Solar Beam), proven by a press refused as silenced, gets `[SILENCE] … no aura logged` (25 lines)
- `5d6347e3` `c72b10fa` `e9bd4209` Infernal Awakening is a CC and a stun by its official mechanic, with no DR chain (1,048 lines)
- `b75e1db0` A CC with no logged end closes at its full duration, not at match end (a pre-gate Sap read "(276s)")
- `b200ce8e` `84be4c59` `ef20116e` `1e60e698` `77ec7356` `c59b8f65` `ffa6801f` DR follows application order and credits a summon's CC to its owner (`[DR CLASH]` 7,964 → 8,261); a recast REFRESH is a new CC; a control recast inside the re-send gap is two, a re-applied open CC is one
- `11056c0c` `54526a66` `9f4d03c8` `18e53c47` **What a PvP trinket removed**: the CC with the most official time left, falling back to a silence or disarm, no credit after a logged break or dispel, and every CC it ended; our team gets a `[DISARM]` line
- `0f973729` `d2517991` `36069698` **Who broke a control**: racials and class abilities render as `used X out of <CC>`; a damage break names the `breaking hit`; an unexplained sub-second end says `cause not logged`, or `ended by their Bladestorm`
- `d3412823` `8a64a74c` `c3fac0e0` `09d48d68` Control lines say how and when the control ended, `<1s` instead of `0s`, a refresh (`refreshed at m:ss`), and a press that removed it (474 → 204 with no stated end)
- `e5c6ff88` `6aa23656` `ff86facc` `ae27703c` A REMOVED → APPLIED re-broadcast within 1 ms is one aura, and an aura ends at its REMOVED, not a BROKEN line before it (1,352 intervals cut short → 0)
- `6d70a38c` `78d8b1d3` `f94611fa` `0bc690cf` `708d3dc1` `3a66d0c4` `5956f7a6` CC lines: one duration formatter, per-target DR for an AoE CC, `[ROOT]` says what the unit cast, `[CC REMOVED]` says what was left, `[DR CLASH]` keeps your own clashes first, a merged healer lock reads `Fear ×2`
- `e2374e37` `b5327bf4` `dce81a4b` `6a1e4e26` A CC that missed is `[MISSED on X]` / `[REFLECTED by X]` with its cause; a landed CC is never `[CC AVOIDED?]` (334 → 0); `[CC AVOIDED?]` states the log's miss type (1,504 lines)
- `0099a96d` `a639a290` `f8ce87ae` **New: `[CAST STOPPED]`** (1,402 lines) and **`[CC NOT LANDED]`** (3,138 lines)
- `c575e25c` `c091d676` `505ef887` `80de07aa` A control that lands seconds after its cast (Capacitor Totem, Sigil of Misery, Ring of Frost) pairs with its landing instead of reading "did not land" (`[CC AVOIDED?]` −103) and is read at the instant it hit; a refused press goes to the control its reason names; a channelled control ended by a kick on its caster says so
- `5ce10e10` `da1eb024` `d3b58433` Area controls list who they landed on (bare `[YOU] [CC]` 1,905 → 28)
- `dc6b5898` `207753df` A control under Oppressing Roar runs 30 % longer (47 → 8 outliving their label)
- `3088ee93` `[CC ON TEAM]` / `[SILENCE]` list the cooldowns you pressed into it and the game refused (1,226 lines)
- `1f59f00a` `86b775da` CC USE says how many bars started and went off (`Cyclone … 4×, went off 0×`)
- `18a7eb50` `5ef309b7` `bf7a347b` `c91f39f6` `aebdb9e6` Castability reads a dispel backlash as control and a friendly breaker's BROKEN as the CC's end; a silence stops only what DB2 says it can prevent; DR history and uncleansed windows use the shared re-applied reading; disarms are paired; KILL ATTEMPTS ignores auras the attacking side put on the target

#### Kicks and casts

- `23e6e20d` `3b45d56d` `00e61aa8` A kick that interrupted nothing says the log's miss — IMMUNE with the immunity named (0 → 333), reflected or missed (0 → 108); your kick gets its audit result (0 → 1,580); an enemy Death Grip gets a line
- `3d7b3610` `05e8623a` `48851c12` A channel is "interrupted" only by a kick or control that ended it (67 → 31); `[channel cut by CC after N.Ns]` (0 → 107)
- `fb5bf4a0` Rejected casts near a teammate's death always show, Smoke Bomb has its own reject kind, a friendly death names an execute
- `35ee9a43` Rejected-press reasons cover zh-TW, es-MX, fr-FR and ru-RU (unmapped 583 → 0)
- `0fa2399d` `6b4eadc4` `55160c70` `fa0c21c8` Re-evaluation audit fixes, no candidate change: refused presses worded and stated (unworded 28,671 → 4,486), one HP trough per lock, cast bars cut at the next GCD press, self-removal, dispeller-CC, snare and friendly cheat-death facts, the Penitence target, and legends that cross-reference a line family only when it is present

#### Cooldowns and defensives

- `29c97c29` `c7a38dac` `ad4df655` `746db8e0` `3c220cb6` `2a1b6cbf` **An enemy defensive prints what it does**: `(absorb Nk, Ts)`, `(heal)`, `(dodge)`, `(cheat-death proc)` … instead of `(self-save)` or `immune` (13,068 lines replaced; damage landed inside 510 of 697 Feign Death "immunities"); Ultimate Penitence gets a line (0 → 372)
- `fefb6b48` `469be80d` `4d95151d` Enemy self-saves (Desperate Prayer, Touch of Karma, a self-cast Guardian Spirit …) got their own `[ENEMY DEF]` lines (4,332) and a kill attempt they survived reads "self-saved (X)"; a self wall is priced with talents (Barkskin 20 → 30 %); your own Touch of Karma is not the target's defensive
- `2a4e0fc7` `961129c6` `54e99854` **Enemy self-saves, heals and grips count**: Death Pact, Evasion, Healthstone, Ice Barrier and more, Leap of Faith as an external, Vanish and Cheat Death as immunities; Blur and Greater Invisibility found under their logged ids; areas render as "X (area)" (`[ENEMY DEF]` 16,645 → 37,714)
- `583ef4ca` `1b1a6762` `97afdcef` `4e5259a5` An aura-only enemy external gets its line (442); dispel backlash reads one table (6,397 false CC lines gone); `[ENEMY DEF] … | during it:` says what your attackers did (2,103 lines)
- `e81b5ff2` `9a9fd81d` `b2f3f642` `6d1fac16` `6d8dfe48` No logged end prints `end not logged` (1,302 lines); a school immunity names its schools; Fortifying Brew is found (0 → 275); Blessing of Sacrifice is one button
- `7793ee2f` **A wall with no press**: a copy no press put up reads `[no press logged]` and is never called early on length; a friendly `[PROC]` says what it went out with; Radiant Glory's cast-less Avenging Wrath gets a `(no press)` line
- `40563ec5` `f84e161b` `8ebec13b` `4cca243b` `25c3ad3c` **New: `[ENEMY HEAL CD]`** (5,741 presses), with Tree of Life (0 → 334); shifting back into it is not a press; Time Spiral is not one
- `c1813046` **New: `[ENEMY UTILITY]`** for an enemy Champion's Spear, Smoke Bomb or Tremor Totem press (2,604 lines)
- `a0871050` `e3bcccd5` `4c4fb104` `78e81225` `a09e94ed` `a4e91136` `cb7c5e58` `[BUFF FADED]` and `[ENEMY DEF]` state the log's end cause ("ended early" 1,871 → 969); everything is cut at the round's end, not the log's (360 of 432 → 0), and a buff still up then gets no end line
- `97a68209` `7c4898f6` `63addfac` `589e5613` A buff stripped by your death says so (230); a caster-only defensive renders "self" with your HP (474); Guardian Spirit says when it triggered (0 → 218); Power Infusion says `also on you`
- `864e9fd5` `592be42b` `c994cbd4` `b4908ad6` `859883a6` `93c02c05` `b12f6910` `1892a2f2` `82e48250` `[RES]`: an unaffordable ready cooldown is tagged; Darkness is named for another unit only inside its zone; out-of-reach positionals leave `rdy:`; every round starts on a full row (182 → 0); `-0s` 10,644 → 0; Forbearance and Hypothermia read off the log (Ice Block not ready on 94 rows); a press is spent from its rendered second (289 → 3)
- `b7c8ab0f` Your own press of a save the enemy's press already prints gets a line (1,743 → 0)
- `709aaeb9` `ab68f275` `aa374425` `317593a0` A Stasis is released when its ready aura ends (`[STASIS RELEASE]` 77 → 138); a passive proc such as Reclamation is not a button press for eight "did the player act?" readers; a talent-triggered effect is a proc on `[ENEMY CD]`; a proc's trigger is named only where it was cast, and an off-GCD press leaves a channel running
- `67a8ace6` `3c9d0c7d` `e3732171` `56cb3c91` `ec29cab1` Extra burst cooldowns name their caster (2,272 of 8,315 `[BURST ANSWERED]` lines); `[BUFF FADED]` reads the copy on the unit it was pressed on; death-setup and `[HEALER CC]` chains show their gaps and kick lockouts; a refreshed buff prints no invented "expired, estimated" end
- `bddf75c2` `4fb54724` The burst ledger sees walls logged under another aura id (Greater Invisibility, Blur, Fortifying Brew)

#### Enemy bursts, kill windows and kill attempts

- `9c2b67d8` `348f723a` `a65101ae` `4ed48d16` **Bursts the product could not see** (GH #115, #119): bursts are also read from their auras — Havoc Metamorphosis (0 → 1,447 lines; cooldown 120 s, the DB2 value), Doom Winds (37 → 132), Summon Infernal (30 s, 16 → 1,283), Radiant Glory's proc Avenging Wrath (user ruling)
- `97d06e0c` `f79f6ecd` PvP Heroism is an offensive cooldown; **candidates added**: Army of the Dead, Dark Transformation, Bloodlust and Heroism (+23 / −13, user-approved)
- `911ddbac` `a870133e` `c853e2de` `960d9656` `1023be26` A landed ground or AoE control answers a burst (unanswered windows 73,183 → 49,755); `[BURST ANSWERED]` says when the bottom came, credits nothing after the teammate died, and names who a control hit
- `47585d12` `dd7bbf98` `f6410727` `c1313fc8` Healer offense and `[BURST ANSWERED]` read the owner's CC through the cast → effect table, so a control that never landed does not answer; a burst's outcome readings share one end, presses after the round end are dropped, and a HoT tick is a fresh self-heal only when the HoT went on inside the window
- `c3543503` `0e06477e` `ae8010e3` `59548cc0` `b02d677e` `ca978ef3` The burst ledger: own spans, the grid's HP, IMMUNE only under full immunity, absorbed damage and a second target; `Aligned with:` becomes `Ally CDs overlapping:` (4,557 of 7,538 touched nobody's target)
- `11402ca6` `0763cb1f` `757c54ac` `e2f0f092` `df754ec6` `6aa3bbc2` `8e29559e` `[OFFENSIVE WINDOW]` headers end at the round's end, never `0:42–0:40`, and name only a spike that overlaps them (444 of 8,154 → 0)
- `4e8fc0a0` `7423398c` Kill-window readiness says when it was read and what changed; "unreachable" is decided second by second
- `093da6e3` `2592b371` `c988c09e` `5b68c084` `[KILL ATTEMPTS]`: a failure cause is a save inside the attempt or one already up when it began (Anti-Magic Shell now on `[ENEMY DEF]`, +1,547); a burst that alone reached the kill is kept, one death credits one row (double credits 57 → 0; KILL rows 1,578 → 1,819); brackets end at the round's end or the death (714 ran 2 s+ past it); the line prints the damage inside its bracket
- `b502d70d` `e4c597a6` `a933f6b8` Burrow, Vanish and Mass Invisibility count when the aura end was seen; both a save and an external are named; our Holy Paladin's Avenging Wrath anchors no attempt
- `c10bc1a5` `45cae8df` KILL ATTEMPTS says which wall was up at the start, and our own Cyclone on the target (373 lines → 0 silent)

#### Dispels and purges

- `61113052` `f955ee54` Your purges render as `[PURGE]` (+616) with the enemy's purgeable buff count; minor dispels fold with names
- `58728dc8` A `[MINOR DISPELS]` rider from its own press reads `(side effect of the cast)` (3,687 lines)
- `9f4d03c8` A pet's dispel names the pet, guardian or totem

#### Positioning, deaths and round end

- `7c6488e1` **"Offensive cooldown out of range" uses that spell's own reach** — one 15 yd ruler had accused a Grimoire: Imp Lord at 21 yd (516 → 2)
- `d4e352da` `3120cd2f` `c2e87b6a` STAYED IN / KITED name who distance was measured to (gate G4: 350 → 0); `[PEEL OPTION]` is stamped "at m:ss"; a Death Grip is not your own movement
- `1226d3c9` `6300ad89` `7e4ef3c4` `4164e920` `da6b30e8` `c3cd1cbd` `[HEALER EXPOSURE]` measures each CC's real reach (26,099 → 18,555 threats); a landed cast proves LoS; summon CC is the owner's; HEALER OFFENSE free time excludes silences
- `6e1c49cb` `19d63efa` `bbdcaa9b` **One PvP-trinket predicate**: the Medallion from 36 DB2 item ids (74 false "available"), Will to Survive locks 60 s, Adaptation recognised (0 → 51 / 51); "no breakable CC in the last 10 s" (547 tags)
- `80b0fe94` `e5cac2ed` Facts the coach used to guess are printed: dampening on `[DEATH]`, when an enemy kick comes back, the team's minimum HP in `[SLACK]`, a defensive's duration, the nearest enemy's range over a STAYED IN window; HEALER TRAINED prints how long the healer was really CC'd (857 of 1,331 "no CC on the healer" lines were false)
- `fd02c30c` `e582b916` `53516969` `[CONSEQ]` never says "no teammate dropped" beside a death and a healer silence gets its own line; a spell eaten by a Grounding Totem is one predicate, so traps show as `[GROUNDED]`; an enemy Touch of Karma says who fed it and where the damage went
- `22f2b151` `fdc3a84a` `cfc1958a` `468180cb` `ba951f9e` `64b002cf` **One 2v2 dampening start**, derived from the first logged stack (159 prompts disagreed); stack decreases read; dampening for the line's own team
- `73c4d952` `c2386096` `3ff85c97` `1bdfd501` `6c89928b` `[UNIT DESTROYED]` says how long a summon stood and covers killed pets (0 → 155); summons are named as the log says (totem 0 → 3,494); the roster lists every warlock pet; a pet's break is the pet's (433 → 0)
- `1d5378f1` `1cd95ae9` `ba00e2cf` `ded32c36` Context lines use roster labels (10,570 bare names → 0); MATCH FACTS prints the lobby MMR and baselines say "personal rating"
- `312518e5` `28c354df` `d3576d4b` `294b9c61` Spirit of Redemption reads `:ghost` (0 → 9,247); a summon `[ROOT]` names the right caster; `[STACKED DEFENSIVES]` labels match (4 → 0); `[RES]` rows that changed nothing are dropped (717)
- `8ed8bd30` `852b68e3` `99191d08` `[CONTESTED]` states cast risk and ready enemy interrupts only for a control with a cast to interrupt; ENEMY CC KIT lists every control that landed on its unit, `(landed N×)`; full-length auras are read in whole milliseconds and SPLIT PUSH is not claimed over unknown positions
- `9443b697` `e297224a` `f6a680cc` `67be227b` Equidistant HP samples resolve by one rule (2.46 % of readings); a druid's mana skips form samples
- `b2e7d29e` `f1ec20d1` `830d23d9` `ad5981ae` Review follow-ups: every purge reader sees the round's pets; an area save cuts every visit its aura covers; dampening is read on the reader's own team everywhere; a purge "took X instead" only for a Magic purge of a Magic buff; the stated saves include redirects; the enemy timeline keeps a cast-less aura apart from the press before it; the no-aura silence names a source only through a class-owned effect and stops at the owner's death. No candidate added or removed

### Combat-log parsing

- `2576b626` `b266718d` **Melee swings are counted correctly.** A swing logged only as SWING_DAMAGE_LANDED is a damage event (5,767 lines / 3.9 M damage missing → 0), and a swing's damage event is its victim-side line (1,501 swings misattributed → 0)
- `b999ce1c` `77060686` `bb6ca55e` A damage event's effective amount is the health it removed — amount minus overkill, without subtracting the absorbed part again (user ruling; candidates +22 −17); a hit a shield ate is damage to the unit hit, not the shield's owner (+1); damage a deferral shield only delayed counts once (30 M in 6,070 events double-counted → 0)
- `20ebf165` A guardian with no summon event in the round takes its owner from its own advanced block (3,063 ownerless guardians → 1)
- `bdb440e1` Falling damage (`ENVIRONMENTAL_DAMAGE`) is decoded at its own offsets instead of producing NaN amounts (65 → 0 violations on 57 files)

### Cooldown, talent and spell data

- `6c1ff1e0` **WoW data refreshed to 12.1.5.70391** (hotfixes through 2026-10-15): PvP taunt talents 20 → 15 s, Merithra's Blessing 60 → 30 s and now Arcane, Improved Mass Dispel 60 → 75 s, Ice Block +30 s in PvP via Winter's Protection, new DR entries. Can add or remove candidate rows
- `18b648ea` **Talents the product read wrong.** A full audit of 3,491 talents found consumers that bypassed the talent-aware ledger (enemy interrupts, vulnerability windows, death block, healer CC readiness, kill-window reach …), missing per-rank and scripted cooldown talents, and dispel / interrupt mechanics. Impossible presses across the ledger 752 → 311 (Alter Time 266 → 0)
- `357715dd` `cb328d3b` Arena cooldowns pick up PvP scaling of cooldown talents, spec passives (healer PvP trinket −30 s, Holy Divine Toll …) and per-rank talents (gaps shorter than the model by over 1 s: 6,816 → 5,762 of 32,243). The ledger counts only button presses — no procs, channel ticks or talent-replaced spells
- `a21d066c` `f2d27fd3` `3eb635fb` `a4c86367` **Cooldowns that combat shortens print a range** — `(a–Ns)` or `(≤Ns)` from a table of measured recast floors (Recklessness, Pain Suppression …; held out, "certainly on cooldown" just before a real press 11.2 % → 1.3 %). One predicate for Storm Conduit holders and others; a press is no longer stamped before its low bound (124 → 78 rows)
- `a3a23a04` `6c4ae9a4` `a7835127` `e8e41992` An unsaved Guardian Spirit comes back 60 s after the buff ends (ledger contradictions 26 → 0) and the kit says how its cooldown depends on the press; Alter Time lasts 10 s, not 20 (1,512 loadout lines); Bladestorm's two ids are one entry (1,188 duplicate lines → 0)
- `218b0739` `a5d8f1b9` `730f00e1` `4d0a6bd1` `f9435bad` `b058d094` Buff durations: 27 more talent modifiers found through SpellLabel, durations set by the producing ability (Shadow Blades 20 → 16 s, Trick Shots via Volley) or by empower level and combo points (Rip, Rupture, Envenom, Fire Breath); tiered talent nodes read their rank per entry
- `759d8e4e` `71d43abf` `da32344d` 55 control spells seen this season join the spell categories (gap 55 → 0); Cyclone and Incapacitating Roar follow their official DR categories; six control cooldowns listed by aura id enter the ledger by cast id, 14 missing ones are added, and an unknown DR family reads "DR n/a" (`[CC BOOKMARK]` 412 → 733; a disarm only against melee, user ruling)
- `35c55d4a` `b3e24b29` `30564f79` Every reach is the caster's own — base range plus held range talents and spec passives (Discipline 46 yd, Preservation +5 yd); a triggered spell's 100 yd placeholder yields to its cast's. Checked against the game's verdict on 732,037 targeted casts
- `881766ac` `a637d104` Line-of-sight geometry checked against the game's own verdicts (false "blocked" on hold-out 10.6 % → 2.8 % and 3.5 % → 0.9 %); Beast Mastery Hunter is ranged (SPLIT PUSH 56 → 32)
- `11984194` `27e5a0b5` Quell, Silence and Counterspell cool down for the official time, sooner for a Coldthirst or Light of the Sun holder (a `[KICK] … back m:ss` contradicted by the same unit's next kick: 85 → 3 of 4,471)
- `a580825a` `1c876685` `a6ea331a` `0c0aa906` `72cc5d20` Cooldown numbers held as **can add accusations** until the user adopted them: Boomstick (Lethal Calibration), Born To Be Wild (Aspect of the Turtle 120 s at rank 2, cd-hoarded +1), Ardent Defender 90 s (flagged, thin corpus); Spellwarding recovers with its shared pool, 300 s not 180
- `23c4ba38` `b27998f6` `c25f08e8` `d90baeac` `3008c60c` `5c283dd5` `ebb689de` Storm Conduit is read by the log's date around the 2026-08-18 hotfix: 4 s then 2 s per cast for a Restoration Shaman (recasts "not ready" 27 → 1 of 59), an interrupted Lightning Bolt locks ×0.35 then ×0.6; the parser can read the instant a raw line states
- `c48cbdf9` `1cbc7228` Champion's Spear gets a ledger row (**flagged: new ledger row**; [TEAM] +720, [YOU] +385 lines), and its optional re-press is not a second press
- `6ba6d2bb` `76707699` `91f40fc8` Roar of Sacrifice pressed on oneself prints its official 25 % reduction once a corpus split confirmed it; its legend says it is not a wall
- `e5a9e213` `1e2fe9a4` `73a1bfc9` Wildfire Bomb is counted once per bomb (hits within 0.3 s); a patch-dated number takes its old value only 14 h clear of the cutover
- `39007a52` `3d6e1a34` `7ea75f9a` No unproven cooldown for a unit whose talents are unknown; Quaking Palm is an incapacitate as in DB2; one "is this a kick" predicate — a silence with no school lockout is control (249 Strangulate entries leave `Kicks:`, user ruling)

### Reference tables

- `1fcec5e9` `41ef7d55` `0078f5e5` `4a46b355` `22f705ae` `ccb3db74` `8a9cfd85` `8d6d832a` The sync-window table is regenerated for the new missed-sync-window rules, finally over the full 63,303-file archive (windows 118,267 → 107,357, every cell above the 3 pp door); burst-window, cdTriggerPrior and kick-priority follow the ledger changes (nothing moved beyond sample size)
- `c330552f` `867447ba` `8b3c0076` `854cc12f` Three batched regenerations at pinned commits (GH #115): nine reference tables, the reference vectors, the cd-hoarded outcome reference and the recast floors, the last at PROMPT_VERSION 381 (Boomstick's floor gone, 39 → 38)
- `b0885605` A fourth batch on the finished fact-layer code (PROMPT_VERSION 425): eleven tables, the reference vectors and the cd-hoarded reference — one slow-defensive-response line traded for another across the 3 pp door, the rest are cited numbers; Restoration Druid's Tree of Life and Nature's Swiftness cooldowns show a range where players recast them early (GH #154)

### Desktop

- `e88e08c1` `fc1b36ec` `9c7deae9` `5dcfa1dc` **AI self-review (opt-in, off by default).** After the first analysis, one more call on the same backend and model re-checks the findings against their own prompt and keeps, corrects, weakens or deletes statements — never adds. Offline: wrong statements 48 → 15 (accuracy 90.7 % → 95.9 %). Numbers keep their sign and size, a deadline aborts the request, and coach chat follows the reviewed result
- `566c04d4` `2fe1bcab` `6c9a7c49` **Claude Opus 5.5 is the default model** for the Anthropic API and Claude CLI backends; Opus 5 stays selectable and Sonnet 5.5 joins the dropdown (a hand-set id had silently fallen back to Opus 5.5)
- `1018f1bf` API-key users no longer lose the analysis to a truncated answer: output budgets fit adaptive thinking (over budget 3/8 → 0/8)
- `48e83e07` `8762b5ab` Two match ids can no longer overwrite each other's library folder; an empty result says the analysis found nothing worth a note, not the stale-cache message
- `8521e4af` `43d980a6` `3b4dea9e` The dispel panel, the missed-purge card, the stats table, the replay's control spans and the death recap end at the round's end and build their summary as the prompt does (rows differing: 12 of 483 → 0, 17 of 1,447 → 0)
- `2094fd5e` `361a07bc` The dispel panel lists missed scoped removals (Shattering Throw); the missed-sync-window card says whose each cooldown is
- `287a6229` `3b301ae7` A long rating history no longer overflows the stats dashboard; death recaps are computed once per match
- `fdc3a84a` `468180cb` `cfc1958a` `44ab92a8` `aab9a5c2` `fb759123` The 2v2 dampening lane starts at 0:00 with the derived value; the kick dashboard's cast-control strip and missed-kick cards follow the corrected cancel and juke readings

### Performance

- `698fc588` `9d3de0dd` Aura intervals are memoised per stream: building a match's context is 33–37 % faster, output identical
- `ae52c335` `c48e7a00` Library-wide scans run asynchronously, so a large library no longer freezes the window (longest stall 176–213 ms → 14–21 ms on 500 matches)
- `32650c89` The CC break and chain dashboards derive fast again (81 → 24 ms), output byte-identical

### Evaluation and verification tooling

- `03f66f67` `57fefb23` `cafc2afb` `baacbf99` Eval builds the menu the way the app does (198 lines had differed); buildCorpus reads gzip archives (had yielded 0 matches); every prompt script waits for talent data (25 → 0 on degraded data)
- `37109f5b` `8b568c9b` `f0e22947` `8847a76c` `ea892153` `d99a57a0` Gates: "free Xs of Ys" within the window (193 → 0); CC distance over the rendered second (mutation detection 61.3 % → 95.3 %); a full line-gate run caught two own regressions (580 failures → 0); no `unpurged for Ns` past the round's end (143 → 0); the break scan credits the right breaker
- `8607b996` `8a495cf1` `bf985839` `e98b7f09` The eval responder gets causal and focus discipline (unsupported causal sentences 57 → 0 on 50); responseQuoteScan; consequenceProbe, the two-arm probe behind `[CONSEQ]`
- `b312d34f` `07e7c66f` `16177786` `80872aee` logCensus counts the archive: 63,303 files, 108,060 rounds, 0 parse failures; a field-coverage ledger from raw log to prompt and an HP-tie scan
- `664536a6` `f03f6bf8` `0c349fe2` `3266ce62` The talent impact audit as three re-runnable scans and a generated talent-coverage-gaps doc; an offensive-effect completeness scan (found Havoc Metamorphosis and Doom Winds)
- `b900dc62` `1a5c4c73` `e297224a` `b7a559b7` `77f02fb1` `5b52d41d` `1dc110b1` `ac3c8e13` Probes: healer reach and its ground-truth check, trinket discipline (closed for a context fact), ablationVocabJoin, summonExampleGen, candidateCastContext, auraCooldownModScan, an uncapped kick-eaten scan
- `3cac0b05` `0b262c7a` `4b2f87e1` `3680dbed` `a5e9d256` `936303f2` Scan scripts hardened; one shared `fmtTime` and CLI flag helpers; four unreferenced probes archived
- `8368b411` `dd817aa4` The review prescreen hands mana queries the raw streams (false mismatches 75 / 307 → 0); match-explore `mana` walks the full series
- `bce5fdf7` The first-paint gate judges the heavy scene against a same-run control (ratio 6.7)
- `2fc6b3bc` `ed715f31` `1df73618` `122d9e67` `db09291d` Tests for cast bars, displacement, fact-vs-raw scans and four unnamed gates; the parsed library is shared (22.3 s → 1.7 s) and a raw log read once per file

### Internal refactors (no output change)

- `00519c5c` `cd56547c` `f09fcf80` `3717cb46` `20b60255` `e4969f1b` `dc78c1df` `d9358e01` `527a130e` `60398f62` `b294b73e` `e021efdd` `92077542` `21b96098` The 4,125-line timeline builder is split into section emitters and is now orchestration only (`matchTimeline.ts` → 995 lines), each batch byte-identical on 605 files; side-effect-free bare imports dropped (GH #116)
- `5036227a` `410b88da` `172b4498` Raw-log reading goes through the parser's own functions, spec tables move to analysis, and the spec-to-string table is built once (5,221 → 11 ms)
- `fe5c1714` `c2de0254` Two latent predicate fixes with no rendered change: a merged press recovers from its cast's time; an immunity cast on others is not its own CC breaker
- `f2996af1` `ed0ce01e` `4bb48bde` `39bde8b9` `d0193dc0` `14c3b853` `25d21721` `186cdd52` `528c93a6` **Candidates removed:** the unwired cc-locked, wasted-trinket and death-unused-defensive emitters and other dead code (prompts byte-identical); deleted deep-dive routes, duplicate helpers, the retired archiver plist and 22 one-off probes

### Other

- `fa651376` `ce36485a` `1d532a67` Tests: a CI flake fixed with fake timers; JSON tables parsed with JSON.parse (analysis tests 389 s → 72 s); a scan no longer re-sorts a shared array
- `a701227b` Renderer and preload may import only allow-listed analysis modules; log-pipeline tests no longer pass on zero files (GH #117)
- `5f860cd9` An expired session at the log-grant step exits with the re-login prompt
- `cc8b22e8` `09415732` `daddeb01` Lint: eslint --fix and a warning ratchet (2,042 → 1,572); merge fix-ups and import order
- `74bc1345` `0de04a31` `eb3e93ec` `86c0a959` `ed626748` `9511e7d3` `9225021c` `11770d42` `4bf36b08` `7e2a3c95` `43bc6174` `506b8d28` `5f2060a0` Visual baselines refreshed after analysis changes and the new self-review setting row
- `6407b687` `97538e11` `10345334` `8c3275fa` `8596c4a8` `ae42aa6f` `344deb59` `94388b0f` `a5bd8635` `47563ecc` `5cb5bd43` `f6263447` `d511b212` `235f4d38` Prompt-version records 368–382, each with its 605-file before / after
- `0856709c` `06858c5d` `2f1ff8d3` `3f6c084c` `ff0a9fa9` `465294db` `6bb408a1` `e667437a` `032ec2f3` `f59319c2` `a30af24a` `207b6943` `b219ccef` `c44179f2` `d41cc770` `2541e184` `47d0f1b6` Predicate index rows, pins and "not yet unified" notes; CLAUDE.md records the trough exception
- `4db3c3e0` `858375f2` `cf5dac13` `155b473b` `deb58cf0` `40511920` `c8f6bc75` `4ee16e5f` `f1c03464` `58d59c61` `9b7f3e27` `d5fe89ba` `7c5ebb39` `580b2c1e` `2445a303` `4de7d683` `34e8e732` `30be3f46` `c1d5fc6e` `998c29e1` `faebc736` Docs: rulings, backlog, judge calibration, the runbook, stale rules removed from CLAUDE.md and skills
- `30b36740` `bc30ae5e` `17339051` `3ba4e656` `5d2931fe` `91b9704c` `468a108e` `6fa414ab` `84234d11` `a006cb7f` `47f4279b` `32e29ffb` `0c5af4f5` Docs: rule history out of CLAUDE.md, a docs map and language policy, package READMEs, data and script indexes, the prompt-version history in its own doc
- `59d08ceb` `1451001e` `b4ce74a9` `c19bb16f` `c0a332dd` `1d869d95` `22d4c284` `8340c1bb` Docs: predicate-index rows, knowledge notes and rulings, curated public knowledge notes, a plan for the next abstraction-layer work
- `fcde27b1` Open items moved to GitHub issues (GH #123–#152); the docs point there

## v0.1.35 (2026-09-22)

A fix release driven by two user reports and one week of prompt work. The kill-attempt facts no longer scold an opener for hitting a target whose trinket was up — at the gates everyone's trinket is up — and a coaching finding that names a class or spec nobody in the lobby plays is dropped before it reaches the report. Underneath, the enemy's defensives, trinkets and summons are described with their context (what they answered, who was in range to kill the totem, which spell the Grounding ate), pet and totem deaths are visible again on 12.x logs, and the offensive-cooldown table went through a completeness scan that found the burst the product had been blind to.

### AI coaching — what the report says about you

- `e00e31b6` **Opening on a trinket-up target is no longer framed as a mistake.** Every `[KILL ATTEMPTS]` line used to be stamped `locked (trinket up) … FAILED` and counted against you, the 0:05 opener included. Lines now read `trinket up (no softer target)` or name the softer target that existed at the time, and the summary only counts attempts where a softer target was available (locally, 1,241 rounds: lines stamped locked 6,269 → 0; the `attempt-into-trinket` card retired). The same commit binds each spec to a player name in the match facts, and a finding that names a class absent from the roster is dropped
- `3bd1e3f8` The roster check pins Chinese nicknames and full spec phrases to the spec, not the class: a Holy Priest called 奶骑 (Holy Paladin) is dropped even when a Paladin is on the roster (the user's own response: 6 kept / 0 dropped → 5 / 1, the wrong one)
- `087be204` `bde4c493` The two healer teammate-crisis cards shipped in v0.1.34 are retired behind one flag after a debate concluded the accusation could not be pinned down ("no card once anybody is dead" landed first, then both were switched off). The fact line `[STACKED DEFENSIVES]` stays
- `8f3da9ae` `[KILL WINDOW]` / `[VULNERABLE]` / `[CONTESTED]` lines were printed under a header promising "team ≥85 % HP, no enemy cooldowns" that only the slack lines actually meet (288/309 prompts contradicted it); the promise now sits on the one line it governs (GH #99)
- `536eec38` A totem or pet was credited to whichever team's same-named summon came first in the unit table — with a shaman on each side, a Capacitor Totem could stun "its own team" (48 lines across 16 of 309 prompts). Attribution goes by source GUID (GH #99)
- `9108994d` `5e95eef1` `9a2764de` `b6addf7b` `kick-eaten` says how deep into the cast the kick landed (under 30 % is a juke opportunity), how far the nearest kicker stood and how many were in range; interrupted and contaminated casts excluded, pet kits and fixtures fixed on review (GH #73, #87)
- `008bd981` `9de01dcd` An interrupted spell is classed as heal, control, damage or other — 100 % of the top 60 kicked spells resolve; Denounce and Mindgames count as damage (GH #79)
- `16338aeb` `missed-sync-window` states the DR level the CC landed at, and enemy interrupts never seen in the round are listed as `(assumed)` ready rather than silently ready (GH #72, #88)
- `b2034102` Counterspell's school lockout is 6 s (official 5, corpus mode 6.10 s, n=619 — user ruling); the mechanism for the sixth second is stated as unknown

### AI coaching — enemy context on the timeline

- `fa450f04` `4069d870` `91b8085c` `c24a1564` `82ebd83f` `a01b8049` `fbc6a890` `[ENEMY DEF]` and `[ENEMY TRINKET]` lines carry context: which CC the trinket broke out of, which of your burst it answered, the target's HP — offensive auras credited to the side that cast them and only real cooldowns counted (GH #69)
- `ac784d37` `[DR CLASH]` says when a friendly CC landed at 50 % or Immune because a teammate had just put the target on DR, naming both casts and the gap (GH #67)
- `c07bc37f` **Pet and totem deaths are back.** `[UNIT DESTROYED]` keyed on an event 12.x logs write for 5 of 13,439 summoned units; it now keys on the overkill the log still carries — 24 → 3,076 lines on the same slice, Tremor / Spirit Link / Grounding included (user ruling 2026-09-20)
- `c6fef058` `e6ee732a` When an enemy Psyfiend or Spirit Link Totem was **not** killed, `[ENEMY SUMMON]` says how many hits it took and who on your team was in range and free to act for how long — a fact, in place of an accusation the funnel showed too thin to ship (8 of 695 rounds)
- `a8d0eaf2` `f4163970` `700cc845` `fe6226b7` A friendly Tremor Totem that ended a fear is credited on the `[CC ON TEAM]` line (0 → 71 notes on the probe slice), and the enemy's Tremor ending your fear on `[CC ON ENEMY]` — never when the CC was actually broken by a trinket, a racial or a dispel
- `58d7ffb2` `addfae20` `886c2926` `96d04a4d` `da533c3d` The Grounding Totem note names the spell it ate (user request 2026-09-20); an absorb whose attacking spell is unnamed no longer silently drops every name on the note
- `130e69f4` Adaptation counts as a trinket

### Cooldown tables

- `b57d7a9b` `c573cf89` `613fef3b` `9ba54d3b` `cfe215ae` `fc6e51dc` `512470b0` **The offensive-cooldown table was missing the Windwalker's burst entirely.** Storm, Earth, and Fire had been retired as dead, and its successor Zenith never listed, so every "the enemy opened a cooldown" consumer was blind to it. A forward completeness scan (the pair of the rot scan, in-round damage lift as the yardstick) then added eleven more — Voidform, the live Bladestorm, Colossus Smash, Kingsbane, Volley, Breath of Sindragosa, Doom Winds, Touch of the Magi, Grimoire: Imp Lord, Force of Nature, Fury of Elune, Predator's Wake — 48 → 60. Review found Zenith still invisible behind an inlined "press-spacing vs recharge" cooldown read in eleven places, now one shared predicate; the sync-window reference regenerated under the wider table (its 2× contrast survives)
- `c04a3fe5` `e803463d` Convoke deliberately stays out (no spec gate); dead spell ids pruned from the curated tables

### Desktop

- `79ffed05` Visual baselines regenerated for the larger offensive-cooldown table (the fixture match gained one teammate finding)

### Corpus tools

- `ee8647cb` `36e2fbee` `62d78afc` The daily log pull archives to Drive itself (205 files / 2.53 GiB had never left the machine), our own logs get a Drive copy too, and the 3v3 step that never ran since 2026-09-16 runs (10/15 → 15/15 verified live)

### Evaluation and research (no product change)

- `eb7701e4` `b7634b57` `511980b5` `f95067b5` `4841135a` `98d044f2` `bd3d7924` `ed44bd94` `dbd783b7` `343d9d92` `466c54eb` `31250fa3` `6a49bcc1` `67efeeac` `9f78aef8` `f87ee8da` `90c8ce7f` The log-observability audit (GH #100): what the raw log can still tell us — advanced-block slots identified (remaining absorb, facing calibrated in radians), the stale Psyfiend id found, hunter / warlock pet outages measured (a warlock's pet never returns in 46 % of cases), resources and facing closed as coaching directions by user ruling
- `33896549` A probe to ablate the no-change `[RES]` rows: the model does not react to their removal (Jaccard 0.800 against a 0.802 noise floor) (GH #99)
- `35986d0c` `9cacd681` `315fd394` `981cf045` `8d1fb58b` `13cca20c` `0eefa27b` `e1c6d941` `5f5e2394` `a1a8b6f2` `783de6f5` `3d317e12` `3701bb6d` `5974f6de` `0b28e96a` `79d296cc` `2575d994` Code-review batch: position samples sorted before sampling, Tremor scanning faster, critical NPC ids in one place, interval intersection for the cannot-cast check, and the eval scan scripts hardened (file tracking, error handling, CLI validation)
- `8a5831da` `62248524` `3eb9a124` Coverage: recent burst / defensive cooldowns pinned, unit tests for resource, reach, cannot-cast, memoize, schools, offensive waste, spec baselines and DPS metrics

### Other

- `5a232e41` `a19ceb01` `5f70dce0` `77bf5910` `456ea3ac` `1193fb17` `d89d7a24` Prompt-version changelog links, comment paths updated, presubmit advice aligned with bilingual READMEs for parser and eval, the pending-rulings sheet, BACKLOG #49 (the four ceiling-raising levers, parked), and the design and plan behind the enemy-context lines

## v0.1.34 (2026-09-18)

A coaching release. The healer's crisis signal now covers the teammate who is being killed, not only the healer's own HP — two new cards, each with a full-archive reference — and the crisis machinery learned three things it had been getting wrong: a talent that fires on its own is an answer, a HoT that was already ticking is not a press, and "the enemy opened a cooldown" is one predicate everywhere. Underneath, the talent-integration project (GH #96) landed end to end: cooldown, duration and mitigation modifiers compiled from the game data, validated against the archive under rules written down before each scan ran, and switched on. Two more signals joined the menu after confirmatory A/B (kick priority, backlash dispel), the timeline lost several duplicate lines, and the reference corpus moved to the 2100+ archive.

### AI coaching — crises and teammates

- `61475d5a` **A new healer card: the teammate crossed the crisis line and you cast nothing.** `teammate-crisis-idle` fires only when the healer was free for the whole window (not CC'd, kicked, silenced or dead at any second of it), had no cast in flight, was within 40 yd with line of sight, had mana, cast nothing and started nothing, did not reposition, was not in a disconnected stretch, and no HoT of theirs was ticking on the teammate — and the teammate did not answer either. The same commit adds a `[STACKED DEFENSIVES]` fact line: two major defensives from two players on one friendly, who cast each, how long they overlapped and what the later one blocked — a fact, with no "one would have been enough" claim
- `5e55bea8` The reference behind that card, from 116,063 archive rounds: 534 such moments (one in ~220 rounds), the teammate died within 10 s in 83 % of them against 10 % when the healer answered, both populations under identical filters. Only 3v3 clears the sample floor today
- `9e0e019f` **Second card: the healer spent the crisis window healing the wrong person.** `teammate-crisis-triage` — same feasibility door, but the healer was casting on a friendly whose HP was above the crisis line while the crossing teammate got nothing. Reference: the teammate died 44 % of the time when the healer's target was not in crisis vs 21 % when they were (Solo Shuffle; 3v3 is under the floor and stays silent). The same commit: `cd-hoarded` no longer accuses a held defensive when a low-HP talent proc or a cheat-death answered the crisis and the player survived the window; and "the enemy opened a cooldown" is now one predicate for the enemy-CD windows, the crisis fact and the teammate cards — a cooldown, not a curse or a DoT
- `5a249db7` The crisis fact "enemy burst cooldown active" was reading a private 34-spell list instead of the canonical 47-spell offensive table the rest of the product had unified on; on the same archive slice, dangerous crisis moments with an enemy cooldown up went from 30 % to 45 % in 3v3. Also the scripts that print the real cards and trace one card event by event, so a new signal is read before it is trusted
- `989c7d7e` **A talent that fires on its own now answers a crisis.** Well-Honed Instincts' automatic Frenzied Regeneration is recognised from its marker aura, counts as a response, and its heal is no longer mistaken for a press or a carried HoT; the legend tells the model to say "a talent fired" rather than "you pressed". Separately, The Hunt's arena cooldown is patched to 60 s: the official 90 s (75 with Eternal Hunt) was contradicted by a hard floor at 60 s across 1,401 consecutive casts, and the ledger's "cast while still on cooldown" count on a 1/20 slice went from 1,196 to 0
- `8875557f` Every automatic protection talent in the game went through the same archive check; six have a verifiable marker — Well-Honed Instincts, Blood Draw, Nature's Guardian, Veteran Vitality, Gift of the Golden Val'kyr as procs, Cauterize and Cheat Death as a separate "cheat death" answer whose wording is "the talent converted a killing blow", never "nothing else was needed". Dream Guide turned out to be a hand-out buff, Defy Fate / Purgatory / Last Resort / Battle-Scarred Veteran too rare to verify — all left out rather than guessed
- `bf99e320` `872d682a` The crisis reference table rebuilt with those two arms: the "no response" populations shrink (2v2 3,255 → 2,883, 3v3 1,781 → 1,652), and the share previously credited to a carried HoT drops by ~0.06 in every cell — a large part of it had been Well-Honed Instincts
- `0ba3ed1e` **A HoT placed before the crisis is no longer described as a self-heal press, and an attacker walking away is no longer called kiting.** Both still count as answered — the populations are identical — but the response mix is re-attributed (2v2 self-heal 0.55 → 0.24 plus carried HoT 0.31)
- `7f5ce6d9` `23ca7de7` A healer's own Power Word: Shield / Void Shield, Fade, Spirit of Redemption, Reversion, Divine Hymn, Tree of Life, Bear Form, Ancient of Lore, Ultimate Penitence and Tranquility count as answering a crisis; a trinket or racial press counts only when a real action follows it, and a mobility press only when distance actually opens — the reference table rebuilt over the full archive to match
- `077c501e` `7351ed28` `80fc353c` `6c1e0d09` `39e7cb68` `c4dac85e` `4dcbe4e5` `c07796b5` `1b396751` The probes and three codex review rounds behind the teammate cards: the funnel and hand review that killed the first "did nothing" shape, timing shapes on burst windows, the measurement that two percentage reductions stack multiplicatively, Cloak of Shadows' physical reduction traced to Bait and Switch, and the design record with the reviewer's rulings

### AI coaching — talents (GH #96)

- `69096f6d` `6916e677` `af45c9ba` **Cooldown talent modifiers compiled from the game data instead of hand-typed**: Monk / Demon Hunter / Evoker class sets, charge-recovery percentages, temporary buffs and row identity fixed; a shared talent evidence inventory feeds a cooldown rule compiler with row-for-row parity against the old generator; reference tables regenerated
- `76c51425` `fe04a713` Every crisis / burst / mitigation decision the coaching makes can be traced — which opportunities existed, which were suppressed and why — with an immutable fact-switch configuration and a decision-level diff harness
- `c7241ff9` `2a23b9da` `94b4d2ed` `84b5d748` **Mitigation is priced through one resolver, talent-aware.** Every consumer of "how much did that wall block" reads the same components (percentage, immunity, school, carrier); talent modifiers to those percentages were promoted only where the archive split fell inside a band declared before the scan ran (7 of 11), and the switch is on. Cloak of Shadows' 20 % physical reduction promoted on the full archive; `burst-into-mitigation` now requires the wall to cover at least 30 % of the burst (provisional)
- `cae735ae` Review findings applied: unresolved choice nodes no longer count as "taken", Survival of the Fittest demoted, player-cluster sensitivity reported, the M4 recipient filter fixed
- `a76aabda` `f80dd8a3` `7304c5cb` Duration modifiers validated the same way: Trueshot +2 s, Demonic Tyrant +5 s, Boneshaker's Shockwave stun +1 s, Ironbark +4 s from Regenerative Heartwood — each passing a rule predeclared before the first run
- `5325c993` `d0b35723` `b8ec1198` `dbb680f9` `7bf52f28` The cooldown compiler was missing two encodings (by spell category and by spell label) — 274 rows recovered, burst-window and sync-window references rebuilt; Tar-Coated Bindings explains Binding Shot's 3 s; The Hunt's 60 s floor found with no data-side source; the scripted-talent review recorded with what is deliberately not modelled
- `1d71f897` `fd094a77` `68931658` `89613ac0` The catalog of all 3,491 talents with resolved descriptions and code references, a scan for every talent that adds protection, the crisis response completeness scan and sharded talent scans; BACKLOG #41(6) closed by the mitigation components
- `31d356ae` Talent-shared walls are priced on the unit carrying the aura — Flameshaper's Obsidian Scales is 30 % on the caster and 15 % on an ally

### AI coaching — new signals and the prompt

- `82bf961c` **Kick priority**: the enemy healer hardcast a heal on your low kill target, your interrupt was ready and in range, nobody kicked — built on the official per-player interrupt kit
- `2f955048` `26cec7bf` **Backlash dispel**: dispelling Unstable Affliction / Vampiric Touch off a safe target is net-negative on the archive; the card mirrors the corpus cost/benefit model and is table-guarded
- `96217226` `4959f9b7` `3fe53d32` `7a9cd396` Both went through a pre-registered A/B: the first n=78 round said iterate (review fixes applied, audited surface cut), the confirmatory n=40 round on Opus adopted them. The same round closed a defect that had been truncating any fact value containing a comma — a new hard-failure gate and one serializer
- `5622560b` `[ENEMY DEF]` lines and per-cast unfolding inside death windows (GH #97)
- `f123004b` `[DMG SPIKE]` lines annotate the trough, client-locale (CJK) names can no longer leak into the prompt, the kill-window list is chronological
- `4f9e4e61` `481fd5d6` `26eeddb9` `1f94e24b` One line owns each event — CC casts, self-buffs and missed-purge opportunities fold into the line they belong to; Lay on Hands / Holy Bulwark no longer render twice; verdict labels become the condition that was met; an offensive-window peak outside the window carries a marker (GH #99)
- `af785348` `d3b8ba97` `469514b2` The causal-language lint treats "which is why you won" exactly like a loss verdict and recognises the English verdict forms; the evaluation responder quotes window bounds, timestamps and HP as printed (GH #98)
- `51aebfb9` Six measurable correctness gaps found by reading the coaching against a season-2 strategy guide, fixed

### Candidate registry, reference corpus, experiments

- `4c5816c0` `53ca82c1` `99cad7af` `64f31820` `5ddd3d0a` **One registry decides whether a candidate type is live** — flags, bracket lists, the desktop ignore set and the coach-corpus rosters all derive from it; the negative control generates from observed corpus truth; a DPS-perspective diagnostics slice (`burst-into-mitigation` 0 → 11.4 % on the same rounds)
- `db19aded` `2c735351` `24a9a927` `baaca696` The production reference corpus is the 2100+ archive — the top of this season's ladder, not a representativeness trade — and Discipline finally splits by hero tree; the read side degrades to the groups the corpus actually holds, and the corpus build runs in archive mode
- `8b2ed2f0` `dd3dfb32` "The target's state at the moment of the press" investigated and recorded as a negative result — too situational for even a fact line
- `0890ab3b` `105bdb4c` `5f65d7f4` `451d1675` `38973f99` `ff424eba` `fd6a089b` `a46ec48f` `9ef775bc` `e9303973` `c0948192` `678d8345` The temporal-evidence experiment (GH #94): would a richer, holistic evidence list change the verdicts on 20 frozen crisis moments? Two pre-registered rounds, judged by hand — material facts gained 18/20, better interpretation 3/20 against a bar of 4. Closed as failed, with the record
- `d9731f62` `46a9d675` `dc6434f1` `20869d0f` `db3881a1` `d3231d82` `1e872be5` `4695fdf9` `c68d573e` `c338bafc` `1426b9d9` Coach-corpus probes over the archive (every player as owner, ledger rating, rating buckets off by default), the weekend batches behind GH #67/#72/#79/#80/#81/#85/#87/#88, the GH #71 admission audit, target-swap noise scans and rule-171 example generation

### Desktop

- `79e8bced` `990025ff` `eb301504` The default Anthropic model is Claude Opus 5 (the evaluation responder and judge follow); the Claude CLI model list offers Fable 5.1
- `e880089a` Claude CLI calls no longer load the user's own tools, MCP servers and skills into the analysis session

### Corpus tools

- `cb43596e` `4257ad9e` `26dd2717` `68c2d81b` wowarenalogs moved behind sign-in with 15 logs per user per day: the fetcher takes the grant path, the old archiver is retired, and a daily driver pulls 10 Solo Shuffle plus 5 3v3 logs at 2100+, remembers the day's quota, keeps a run log and notifies when the session expires

### Other

- `403c7296` `0ce5d70d` Local analysis / eval tests share a module cache for an allow-listed set (146 s → 52 s) while CI stays fully isolated and fans the unit tests across parallel runners
- `5432c28b` `7838e9f2` `4e9e635c` `9d975345` `5b16ca8f` `f14cd08b` `75c4b3eb` `8045ea6b` Documented commands and Markdown links are verified in presubmit, stale source references removed, Chinese documentation reconciled, nine backlog entries archived, the cross-AI review skill routed to codex first

## v0.1.33 (2026-09-09)

A fix release. The managed OBS recorder came back from the real machine unusable — a blocking error box on every launch, and then a "failed to start recording" dialog — and both turned out to be values in the config we generate that OBS reads differently than we wrote them. Alongside that, the batch behind buff durations landed: talents now feed the durations the coaching reasons about, and a hand-written duration table stopped shadowing official values.

### Recording (managed OBS)

- `2adfc09c` **The managed recorder popped a blocking error box on every launch, and then could not start recording at all.** Two independent defects, both in the config we generate for our own copy of OBS. The version marker was written as `32.2.1`, but OBS reads that key as a number — it saw "32", concluded the configuration predated OBS 31, and tried to migrate it on every single launch, before the recorder was even reachable. And the recording audio encoder was named by codec where that setting wants an encoder id, which OBS accepts without complaint and only fails on at the moment recording starts, as its generic "starting the output failed" message that blames video drivers. Both values now come from constants that a test re-parses exactly the way OBS itself does, so a value OBS cannot use fails the build instead of the recording
- `2adfc09c` The recorder no longer reports a recording that never started. Whether recording actually began is now confirmed against OBS's own status rather than assumed from the request having succeeded, and the fallback that locates the video file can no longer adopt a leftover file from an earlier session
- `2adfc09c` The real-machine gate check gains a row that answers "is the output actually running" directly

### AI coaching — durations and talents

- `b441214f` `ed5cd50a` `36f8241e` `ac23129e` **Buff durations now account for the caster's talents.** The stored durations were the untalented values, so anything a talent lengthened by more than two seconds had its real expiry thrown away as belonging to a different cast — measured on the archive, real removal events pair 582/620 to 618/620. The talent table grew to 21 entries, gated by specialization where two specs change the same spell differently, and the evidence bar for adding one is now three-way: the official modifier row, its class mask actually covering the spell, and an archive split that reconciles arithmetically
- `a25bacf1` **Duration changes carried by PvP talents never took effect at all.** PvP talents do not live in the talent tree the rank lookup walked, so every one of them read as "not taken"
- `ca199da1` Three duration entries shipped wrong by a factor of two: the official values are per-rank for some talents and totals-at-max-rank for others, and the rank cannot be inferred from a number that happens to fit
- `5c122ce7` Some spells simply have a different base duration per specialization, which the tables could not express before; 20 durations were corrected against the archive, and only ever upward — an aura cannot outlive its own duration, so a longer observation is evidence while a shorter one may just be an early removal
- `78974390` Ascendance was not a wrong duration but a proc: 18 casts against 1,684 applications, nearly all of them produced by a talent that carries its own duration
- `3bb67622` **Four hand-written durations were shadowing official values** — the hand table silently replaces generated entries, so nobody would ever see the disagreement. The archive settled all four, and the duration predicate now lives in one place instead of three
- `5e56f564` The duration scan's first run on unused samples reported three disagreements; two were closed with the talent behind them, the third documented as a deliberate exclusion
- `7db858eb` A duration field that was computed and stored on every missed-purge window but never read is gone

### AI coaching — signals

- `3ede44b0` **"You got kicked" findings are ranked by whether the player actually cast anything through the lockout.** The old ordering asserted that switching schools was the least teachable outcome, which is only true when a real cast went through — measured at 16 of 292 rounds. A priest who ate the interrupt and got one instant heal out in five seconds used to rank below someone who simply waited the lockout out
- `faed3c7c` The same findings no longer tell the model the player "kept playing through the lockout" when all they pressed was an off-school instant

### Other (docs / tools / eval)

- `e60a8df7` `237d8480` `9cab0bf8` `b55abed3` A pipeline for reconciling coaching-video verdicts against what gladlog computes, with its runbook and a Chinese counterpart
- `29347de7` `58db8d3d` `63c4182d` `c698121d` `232e024c` Cross-AI review corrected the headline numbers of that reconciliation — three "gladlog does not have this" claims were disproven from source, and two layers of the coverage figure were inflated; the gap itself held up
- `1046b087` `509f5263` `689a67fa` `71076c13` `e646a7e8` Signal probes: the kick-eaten severity axis was measured on the wrong quantity, the catch-all bucket held no misclassifications, a position-based feasibility check for kick-eaten is a go but blocked on official range data, the missed-sync-window claim passed while the "is it worth shipping" premises did not, and the case for retiring unsynced-burst was re-checked and stands
- `f74b244d` `427037c1` `39301b5b` Data-compliance notes updated with what the archive actually takes and what it costs, after the upstream match search shut down
- `d045b6ea` A stray `__pycache__` removed from the tree, with an ignore rule

## v0.1.32 (2026-09-05)

Managed-recording repair release, plus the season's official-data batch. Three symptoms came back from a real 4K Windows machine on the managed OBS recorder — no sound, only the top-left corner of the screen, and footage that starts outside the arena. The first two were real bugs and are fixed here. The third turned out to be what a continuous recording's raw chunk files look like (the in-app player was already correct), but the raw files are now cut closer to the match anyway. Alongside that: the managed recorder gains user settings (where recordings go, which audio devices), the healer save-cooldown roster is now generated from official data instead of a hand-written list, and the game data behind cooldowns, durations and mitigation was refreshed and audited against the official tables.

### Recording (managed OBS)

- `08dde677` **A match's video file now starts much closer to the match.** Recording is continuous while WoW is up, so the file carrying a match used to open with up to ten minutes of queue. Two changes: a fresh file is cut at the match's own start whenever the combat log was punctual enough for that instant to still be _now_, and the idle cadence that bounds the rest dropped from ten minutes to one. When the log is running late the cut is declined rather than taken — cutting then would leave the opener in the previous file, which is the one thing continuous recording exists to prevent
- `e52761d2` **Recordings were only the top-left corner of the screen on any display above 1080p.** The capture source was placed in the scene with no transform at all, so OBS drew it at its native pixel size against a fixed 1920x1080 canvas — on a 4K screen that is exactly the top-left quarter of the picture. The capture is now scaled to fit the canvas, which also covers ultrawide screens and a resolution change mid-session
- `e52761d2` **Recordings had no sound at all.** Two independent causes, both closed: the generated recording profile never named an audio encoder (one of that setting's legal values is literally "no audio"), and the desktop-audio device was only ever wired through a config file whose loading had never been verified — the recorder now asks OBS directly whether the channel came up and repairs it the same way the video source is created
- `e52761d2` The real-machine gate check gains three rows that answer these directly: how much of the source actually lands inside the canvas, whether the desktop-audio channel has a source, and which audio track it records on
- `9483dece` `0b7fd2e4` `6aa76697` New managed-recording settings: where recordings are saved, which desktop-audio device and which microphone to record (no mic by default), and a one-click import of those choices from your own OBS install. Changing any of them restarts the managed recorder so it takes effect immediately

### AI coaching — official game data

- `e1235284` `a19b637f` `83130c84` The healer save-cooldown roster is now generated from official data plus the archive instead of a hand-written catalogue, which had been missing 23 of 53 cooldowns. The full-archive impact scan (859,821 presses) decides what makes the list, and the timeline's cooldown table was rescanned against it
- `4e6fb19d` `01686a29` `e2dd1241` `2fb26c15` New timeline context line: at what health the same cooldown is normally pressed by comparable players, so a save that came too late reads as too late. Kept after a targeted ablation probe measured no cue in the model's output — the line stays as a context fact, not as a claim
- `1180346a` Kick lockout durations now read the official PvP duration, and every generated cooldown, duration and mitigation number is multiplied by the official PvP modifier — a value the generators had silently been dropping
- `a4b3b7be` `63b1b684` Game data refreshed to build 12.1.0.69587, and live Blizzard hotfixes are now applied on top of the shipped tables instead of being invisible until the next patch
- `a1926f5b` `f6109cdb` `52da8af6` Three audits against the official tables: an aura flag read as haste is actually movement speed, 12 combat racials the hand-written table never had, and the "usable while stunned" table now reads the named game flags rather than a guessed bit
- `c69a5840` `95e92807` A kill window now counts any 20–99% damage wall the target still has in hand, not just a narrow list; Aura Mastery's mitigation corrected to 24%

### Removed

- `da2bbec2` `d00b7b0a` The critical-moments block is gone from the analysis prompt — a probe showed it only restated what the timeline already said
- `612aa96f` `146669f6` Playstyle dimensions on the comparison view landed and were reverted the same day
- `c04f98cf` Mana attribution is not being built (ruling recorded, issue closed)

### Corpus archive

- `8939cd46` `e061a736` 2v2 is no longer archived — collection policy is now separate from the brackets the server understands. Measured on the 2026-09-04 round: 2v2 was 34.8% of downloads but only 13.0% of the bytes

### Desktop

- `455bb975` A stale slot's placeholder no longer tears against the header status and Export button

### Other (docs / ledger)

- `15da8345` `adee6f88` Session practices consolidated into skills; a stale backlog line struck with the production corpus numbers
- `7a481c9a` Handoff notes for the Skill Capped coaching-verdict corpus (68 VoDs / 2101 verdicts; 71% of the v2 verdicts map to no predicate the product actually computes)
- `00725d13` Release commit (version bump and this changelog)

## v0.1.31 (2026-09-03)

Coaching-signal value release. A week of work anchored on one question: is this signal worth existing, and could the player actually have acted? New: crisis-no-response for healers, backed by a corpus reference of what top-ranked players actually do in the same state; enemy-burst-window decision points; kill-window killability facts. Four signals whose skill gradient came back flat once normalised by opportunity were retired or demoted. CC durations now read official game data. Also in this release: the OBS phase-2 branch (managed portable OBS recording) merges to main for the first time, the parser labels incomplete matches instead of passing them off as whole games, and the long-standing flaky desktop test was root-caused.

### AI coaching — new signals

- **crisis-no-response (healer v1)**: `e74a37c5` shared crisis decision-point predicate; `879f4a80` `60a445ae` producer (cap 2, ordered by danger); `8f7933ba` wired into the healer menu and legend; `120a4050` desktop mistake rule, label and detail; `3a5a6c31` `a0194ff0` behavior-prior table (top-10% healer crisis responses over 18,134 matches) with lookup; `2427cf8b` `e8e26ac0` new hard-failure class — rendered reference numbers must equal the table; `22ac9a2a` `d46bb4cd` manifest registration and predicate-index rows; `6365dfa1` attacker count resolves pets and guardians to their owner
  - Reference redesigned as outcome-based with a damage floor (§1b): `60e5cd79` `24dc92d9` spec; `334640a1` `78d3384a` predicate, table, legend and gate; `86be4f59` table regenerated; `3810bf82` `a1203cc2` `a19b55fa` `ebb7f761` review-round fixes (silence coverage, shared aura pairing, gradient denominator, NaN guard) and regeneration
  - Solo Shuffle reference counts any friendly death within 15 s (§1c): `d31c6f6f` spec; `9fb21d9d` `90cf1b47` `5f4d9dac` `0662afd5` `db566d9e` outcome propagated through prompt, gate and desktop; `c7661bdb` the reference outcome renders as prose, not an enum token
  - Role dimension (§1d, GH #59): `c819faf3` spec; `4d64e556` `4856ce78` `1a4d4c16` `6b2c6529` `6b6d4ab7` role carried through predicate, table, gate and index; `5f71683e` DPS cells scanned (120,439 decision points), `2dab0084` then withheld from the published table — DPS "no response" fires in 68% of rounds with a 10.5% vs 6.5% contrast, not worth a signal; `6f1070d6` table regenerated on the render-grid-anchored population
  - The corpus scan behind it: `44f331fb` v1, `5c928285` v3 context features, `932132b9` v4 response mix, `400a6225` DPS perspective, `ee8f0850` formatting; design docs `d6479350` `6140129b` `396cb075`
- **Enemy burst window (GH #60)**: `85b7549b` decision points and corpus reference table; `1b345750` `ab6e8d18` slow-defensive-response reshaped as a decision point with two doors and an over-react probe; `9db3bbdd` [BURST ANSWERED] context lines, the positive side of the window; `860279f0` teammate reachability gate, canonical offensive-cooldown table, gradient re-measured
- **Kill window (GH #31)**: `d726b6db` killability facts and a DPS view; `a0f1eee3` the major-defensive roster single-sourced
- `7b5e8d3f` missed-sync-window resurrected in redesigned form (GH #13 reversal, user ruling)
- `365418e1` [ROOT] context facts — a root matters when its target cannot reach anyone (GH #24)
- `c1f240ea` [HEALER TRAINED] states the fact per line and the steering rule once (GH #36); `fc794ce5` `bd1b9960` the two prompt probes behind that ruling

### AI coaching — retired or demoted signals

All four on the same criterion: a flat skill gradient once the denominator is the number of opportunities, not the number of rounds.

- `e069f4cc` `1ecda5af` death-unused-defensive retired (GH #58), superseded by crisis-no-response
- `17356e93` missed-purge and unsynced-burst demoted to context facts (GH #50)
- `3f5f3b38` `7d219a66` `90747bbb` cc-held retired after its gradient came back flat with a proper opportunity denominator; visual baselines follow
- `fdc18785` cd-spent-idle retired — the outcome probe found no measurable cost

### AI coaching — accuracy fixes

- `4fb50953` healing-gap gates on the lowest teammate HP, not gap seconds; `e719f549` the legend states that t is the gap start; `b4e66e48` `086baed5` free time now subtracts kick school lockouts (GH #54)
- `de35230b` cd-hoarded becomes decision-point shaped; `8ec64f96` attempt-into-trinket cites the corpus outcome contrast (6.8% vs 3.8%)
- `af5504b5` every "cooldown available at t" predicate shares one rendered-second slack (GH #61, ledger hard failures 3 → 0) and kick lockouts come from corpus observation instead of a flat 3 s (GH #62)
- `eaa1cd0e` `f6e4f504` kick-eaten, death, missed-cleanse and crisis time facts floor to the render grid instead of rounding past it
- `8705d976` four review-bench rulings: 2v2 allow-list, kill review demoted, immunity-breaker feasibility gate, shared bracket key (GH #18)
- **CC duration reads official data (GH #44)**: `c7451a1d` full duration via ccFullDurationSeconds (the hand table disagreed on 22 entries and was wrong on 21); `553e35cb` talent-conditional duration — Resonant Voice lengthens Intimidating Shout 6 → 7.2 s; `c43fe8e2` the 8 Polymorph glyph variants registered; `5960ee7b` 70 consumer-less hand durations on non-CC spells dropped
- Registries: `e26ee81e` Landslide registered as a dispellable root; `e3322e1f` Ancient of Lore in the mitigation table at the official 30%; `10c23d82` dispel-observed table regenerated over 12.0 and 12.1 (305 → 421 ids), benchmarks rebuilt on the 12.1 archive
- **Constants audit, closing batch (GH #34)**: `75219d2f` buff-expiry pairing and four hand-typed durations — Power Infusion is no longer always "ended early"; `bf924bf0` per-spell official reach for externals replaces the false "every 40-yard targeted spell" constant; `2fe0bdb5` Rallying Cry reads its 10 s from the official aura; `c8361f07` trinket cooldown single-sourced, Forbearance reads official data, two hand assumptions falsified and annotated; `167c5d40` MIN_CD_SECONDS single-sourced; `8531db55` `d71e2530` `ef833c6b` `c9c603be` `7916b201` `ef473068` `41e423b5` `eb260831` `c581d31e` `d47946aa` measured distributions written next to each threshold (zero value changes); `49535842` datagen emit-table writes temp-then-copy
- `87efe544` "cheaper available" teammate reach uses the official can-help predicate, not a hand list; `a60a3e3c` ninth hard-failure class — a [DMG SPIKE] "healed through" must match the same-line HP delta (GH #36)
- `f2cf35a5` corpus dispel gate no longer counts rider dispels as "someone dispelled it" (GH #32); `2fa060bd` the last predicate-index divergence closed — DR categories read through the override layer (GH #33)

### Parser

- `cf27d2fa` structural completeness — partial shuffles, short rosters and no-result matches are labelled instead of passing as whole games
- `35164768` `51c1b3b7` pets and summoned units merge into their owner by SUMMON relationship and PET flag, so their damage and healing land on the right player (GH #57)

### Recording — OBS phase 2 merged to main

The managed portable-OBS recording that shipped as the v0.1.20-obs2.1 and v0.1.26-obs2.2 test builds is now on main and in a regular release for the first time; see the v0.1.26-obs2.2 section above for what it does. Branch commits carried in: `ab3ab014` `13fe39d4` `64f45a8b` `368ae5f1` `4136a3e7` `49a18636` `0a62c0c2` `8b5924d3` `167ff96e` `bf799dce` `86f1f95b` `fb9d4c72` `a322713c` `96d8660f` `aa401e7a` `81831590` `1d3cd4ee` `3026bc54` `ea558d87` `54c99380` `7841af71` `e9e15556` `c3e00e73` `db3e7214` `88fdfc1a` `d47b5d87` `92f9e24f` `1e228b1b` `ea2a63bc` `cbc46460` `f6a80b21` `7efe296b`. Merge fixups: `eade0146` settings fixture gains uiZoom, download-progress assertion anchored; `2140f3a0` settings and video visual baselines regenerated. Real-machine end-to-end of the managed recorder is still pending.

### Desktop

- `58ae7bba` atomic file writes retry once on Windows target-lock errors
- `fa2dec06` dampening-lane hover dead zone fixed, panic naming, owner resolution consolidated (GH #38)
- `bec96609` the GH #26 flaky-test root cause — passive state resets were ordered after the interaction; `5c8a38e5` `47ae43aa` `909c5280` the timeouts and diagnostics that led there
- `8005b835` `a5459678` visual baselines follow the 2v2 allow-list and the cd-hoarded decision-point form

### Eval tooling

- `9a15ee45` headlessAnalyze — run the real product analysis on library matches without the app (GH #18)
- `641f683f` `18b18c83` findings-prompt corpus rendering and response interpolation for blind candidate-menu A/Bs
- `0c7560dc` `d69238f1` review bench keeps baseline candidate types and resolves shuffle rounds by round id
- `e1818153` `9a20ee7d` session probes and capture tools booked into the repo; `f3bfd976` doc/script hygiene from the eval-repo audit

### Other (docs / ledger)

- `153aa886` `a4eeaeb0` CLAUDE.md alignment; `4d9e5d8b` `88a547bb` `5d01efd3` `b5b84ee2` backlog rulings recorded; `a69d268f` `aa7ff481` `10761813` `017b375b` `d5b483b9` `a0e59ac5` `5c25bd62` `30461249` OBS phase-2 design and plan docs, arenacoach rule survey

## v0.1.30 (2026-08-26)

Coaching-accuracy + sixth-backend release. Two main threads over three days: a batch of coaching fixes that stop accusing players of things they could not do, plus five new fact annotations in the prompt (each backed by real-model measurement); and CodeBuddy CLI joining as the 6th AI backend. Also a "gut-feel constants" audit (zero value changes, two real bugs caught) and a reusable prompt line-effect probe.

### AI analysis / coaching correctness

- `fe428a6c` Three real bugs surfaced by re-measuring from the DPS point of view: cd-waste no longer counts Control abilities as "the defensive you never pressed" (58/176 → 0), a keyless wall (Berserker Shout) is no longer demanded for a teammate, and buff-expiry lines now use log truth
- `ba31cd05` Renewing Blaze registered as a major (non-mitigation) defensive per user ruling; Combustion removed from the steal-worthy list (440 applications, 0 steals observed); unsynced-burst no longer double-counts ally-cast throughput buffs (375 → 309)
- `1273f8f3` Abilities with no button (Renewing Blaze) can no longer be cited by any "you could have pressed it" accusation (8 → 0); loadout marks them [PASSIVE]
- `10e5aee2` The low-pressure exemption note only vouches for Defensive-tagged cooldowns, no longer for unused Control abilities (12 → 0 misfires)
- `2abb8376` missed-cleanse now carries the "your hands were busy" fact — "you missed X" becomes "you chose Y"
- `9ae382e4` Critical-tier missed dispels require a measured consequence before accusing (#39 ruling A)
- `00ee7110` Pressure computation now includes absorbed damage (absorbsIn re-keyed by victim)
- `43661043` Innervate reclassified as a mana cooldown (not a healing buff), emitting a [MANA] line
- `f5ed0256`/`673c9d52` Immunity table completed in two batches; CC cast into immunity now visible in the prompt ([IMMUNE] marker)
- `861f0fae` Empowered-cast release level enters the prompt ([EMPOWER L?])
- `9e12b879` [DMG SPIKE] lines gain an enemy-CC-cover annotation — adopted after a paired retrieval test raised weak-backend accuracy 65% → 87% (p=0.0013), guarded by an 8th deterministic gate
- `3e0dc4bc` Parser now reads five previously-dropped log event kinds (resources / immunity / damage transfer / empower level / absorbed healing)
- `86258139` #40 two-line fixes + three #36 items landed + playstyle dimensions into the compare engine
- `4bf5e27e` D7 probe ground truth taken per round (fixes constant-zero truth after 5 solo-shuffle rounds)

### Data & signed registries

- `2e9298e2`/`bdb7848b`/`d75ec874` Healing verdict registry: the "big healing cooldown" category did not exist; all 12 entries user-signed (10 burst-answer / 2 needs-healer); wiring measured as a zero-change edit, deliberately not consumed yet
- `a3cb4216` Three generated artifacts realigned to build 69404 (zero data change)

### New AI backend

- `564f027b` CodeBuddy CLI (cbc) integrated as the 6th backend: 14-model enum, event-array JSON parsing, coach-session resume (external contribution, PR #35)
- `84b0abf4` cbc factory-level tests to fix CI + safety-argument single-sourcing; `58492dac` settings visual baseline updated for the backend dropdown

### Constants audit (GH #34, zero value changes)

- `89b30b2d` 73 lines of dead code deleted (old KILL_ATTEMPT path) + computePressureWindows NaN silent-drop fixed (15/5697 windows recovered) + three thresholds annotated with measured evidence
- `1be8c427`/`c4044a63` At-cap survey for the whole *_CAP family and distribution evidence for every positioning threshold, written into the code

### Tooling & corpus

- `c4646824`/`4deee7da` Prompt line-effect probe (ablation / planted-defect / cross-model, resumable with a circuit breaker)
- `3ffcbe56`/`b3f21df9`/`255603d6` Real-model smoke suite moved to local CLIs; three-marker verification completed
- `4db79018` Own match logs permanently archived to Google Drive (21.28 GiB → 1.76 GiB)
- `aa10f3e2` Corpus validator learns hero grouping + cache moved to gz (103 violations → 0)

### Other (docs / ledger)

- `75664207` line-probe results report; `994a5bf0` BACKLOG fully mirrored to GH #37–#54; `cbc991d8`/`832d1a80`/`5d959269`/`6876b72c`/`551dfa5e` ledger & ruling series; `66249909` archive-doc corrections; `371e3447` handoff doc; `e9e72bfa` numbering coordination

## v0.1.29 (2026-08-23)

The coaching-correctness release. Two GitHub issues (#28, #29) drove a month of work on one question: when the coach accuses you of something, could you actually have done it? Cooldown targeting, spell school, "does it hit enemies / is it AoE / does it deal damage" and "can this defensive reach a teammate" now all come from official game data instead of hand-typed tags; the mitigation verdict register is fully signed off (32/32, nothing left unresolved); and two accusation types gained feasibility gates. Plus a new evaluation tool that checks coaching signals against an external truth — rating bracket.

### AI coaching — ability facts from official data (GH #28 / #29)

- `8c488aae` `eec1cd09` Ability profiles are built from the official spell tables: spell school is no longer a hand-typed tag, dead tag values are gone, and the user's mitigation verdicts live in one signed register
- `4b2306ea` Three offensive facts — hits enemies / is AoE / deals damage — answered by official effect data instead of a hand list
- `357a9c27` Big-cooldown cast records name their target via official targeting data: the "who got the buff" line was missing in 59/59 prompts, now 0
- `b4ba5749` `073a5a8d` A self-only defensive can no longer be held against you as "you could have saved your teammate": official targeting says whether a spell can reach someone else. The decode table was reworked the same day after 18/87 entries turned out to be "destination" rather than "ally" (405/965 false positives), and a hole that let runtime-injected tags bypass the check was closed
- `a8ed9acb` "Slow defensive response" asks "did _you_ have a tool for the unit under pressure" instead of assuming
- `a5fa1597` `11243630` `4daf30ac` `214d4724` `c476c702` `5101fd50` Mitigation verdicts signed by the user: the 20% party-wide paladin wall and Blur → never a "damage into a wall" mistake; Shield Wall → only when a kill was live; Power Word: Barrier's entry retracted by the judge; two register entries corrected (one rule I had invented, one built on a disproved premise); "cd spent while idle" now uses the signed criteria. The register is complete — 32/32 resolved
- `3ad24bbb` `14a9712a` "Unsynced burst" only fires when your team actually had hard CC ready at that moment
- `9a2ae2d8` "Avoidable CC" only fires on CC you could have reacted to — ~75% of the old accusations were instant casts

### Report app

- `358b23f1` The pro-comparison cache stores "no cohort" results and no longer stores "no API key" failures (GH #27)
- `eaee24e2` The three new data tables are trimmed to spells actually observed in play — renderer bundle −134 kB
- `4ffdbb8d` `50b50001` Lazy-loading those tables was tried and reverted: a smaller bundle, but first paint measured worse both times. Kept from the attempt: every corpus scan script now waits for spell names to load (scan totals were being measured with names missing, 2,105 → 2,533 candidates under the correct basis)
- `5101fd50` First-paint budget re-locked from real CI minimums (39 runs): 5200 → 6400 ms

### Evaluation tooling

- `a42b8a95` `3cd34fa4` Signal skill-gradient experiment: does each coaching accusation actually get rarer as rating rises? Reports are stratified by bracket — pooling manufactured a −9.6pp "skill effect" out of a flat signal
- `4c5a66f4` Two bad denominators fixed: missed-purge uses the same purge predicate as the product, cd-waste counts per cooldown

### Other

- `9a085c70` Research note on the 12.1 PvP addon / tooling landscape; audit entries D7 (absorbsIn is keyed by attacker, five consumers read it as "absorbs taken" — unfixed) and D8 (the forum claim that Midnight logs under-report healing does not hold in arena logs — verified on 1,242 rounds); two probe scripts kept under `packages/eval/scripts`
- `23d3d77f` `ba4cc46b` A month of lessons backfilled into CLAUDE.md and skills (value-gate rule, parallel-sessions skill); backlog #34 on coaching-signal correctness

## v0.1.28 (2026-08-22)

The season-two data release: a week of real 12.1 matches (10,682 of them, pulled from the public arena-log feed) was used to audit the hand-maintained spell tables the coach reasons from. Abilities the game removed were still sitting in those tables, a dozen ids pointed at the wrong spell entirely, and a third of the spell ids actually in play were invisible to the data pipeline. All three are fixed. Plus the report UI review batch: a hero line, a readable HP curve, deliberate-vs-passive dispels, and a demo analysis you can open with no AI backend configured.

### AI coaching — spell tables audited against a season of real matches

- `2a6f7e06` 22 abilities the game no longer has (Netherwalk, Dampen Harm, Diffuse Magic, Icy Veins, Repentance, Wyvern Sting, Fel Eruption, Soul Rot, Shadowy Duel, Zen Meditation, Spiritbloom…) removed from 19 tables — zero occurrences across 10,682 matches / 3.3M log lines
- `2a6f7e06` 14 ids that pointed at the wrong spell corrected: the offensive-effect table was 9/11 dead (its "Execution Sentence" was Final Reckoning, its "Touch of Death" was Convoke the Spirits, Vendetta is Deathmark now), Grounding Totem, Bladestorm, Alter Time and the PvP trinkets all had stale ids, and the dispel-backlash check now fires on the live Unstable Affliction silence instead of a dead one
- `b127dc2c` "Is this spell CC?" had two different answers inside the app — hard-CC windows used the official table while the timeline's [CC] labels used a hand-typed list. They are one predicate now: 63 crowd-controls that were being played and not labelled (Polymorph and Hex glyph variants, Freezing Trap, Imprison, Paralysis, Maim, Holy Word: Chastise…) now appear with their DR tier and the target's trinket state
- `924fdfff` The spell universe the data pipeline mines grew 3,719 → 5,362 ids: 1,643 ids seen in real play were never being asked about. Spell effects +1,550 entries, Chinese names +1,359, talent modifiers +21; existing prompts are byte-for-byte unchanged (verified by hash)
- `022981f0` New coaching candidate: Mass Dispel on a Cyclone chain, gated on four criteria
- `fbe16737` Dispels are now classified deliberate / proc / rider from the raw cast, instead of counting every passive proc as a decision

### Report UI

- `fb99aa61` A hero line under the tabs — result, matchup, who finished it, where it turned — with copy/export/report moved into a ⋯ menu
- `eaa61b05` HP curves fade full-health plateaus and draw movement crisply; hovering a legend entry or a curve focuses it
- `f7e2f53d` Dispel KPI, tab and table count deliberate dispels; passive procs and riders are a muted suffix and their own column
- `3690e03a` The events tab opens on the key preset (damage / interrupt / dispel / death) with everything one click away
- `9e7f8e95` Meter rows carry one identity element — spec icon with a side ring — on a bar-first grid
- `3d0613d8` Shuffle round pills wrap as a strip and collapse to plain numbers in narrow containers
- `8908ca2d` Dashboard win rates lead with counts when the sample is too small to rate
- `c1d2f17f` "See a demo analysis" on the AI tab when no backend is configured — a fenced demo sharing the fixture bridge
- `a007d393` The demo analysis survives a language switch mid-render

### Corpus and tooling

- `15ecc63a` `1696f0a0` The completeness rule now has tools, not just prose: a registry of every hand-maintained spell-id table (61 of them) plus three scans — lists gone stale, official crowd-control the app can't see, and dispel ground truth against the official data
- `42f5c1e8` `fc3e9bd4` `57579e8d` Log downloads time out and retry instead of hanging forever (one archive run sat idle 30 minutes on a single stuck connection), and non-OK responses release their socket
- `331eb989` The log collector diagnoses cloud-only placeholder files instead of repeating the same warning every minute
- `26db5a23` Human blind labels can be checked against the machine criteria on the same answers file
- `dd7aba04` `7bca0366` `88de4518` One source for the cohort sample floor; the new registry covers the movement-root dispel list; visual baselines re-taken after the UI batch

### Other

- `02487b19` `37a949e8` `13677a04` UI review proposal, adoption plan and landed record

## v0.1.27 (2026-08-21)

The grounding release: **every accusation the coach makes was re-audited against real match data**. Eight coaching signals whose win/loss discrimination turned out to be zero or backwards were retired, the surviving ones had their thresholds measured and signed off, kill analysis was rebuilt around a three-tier opportunity model, and the new-season 12.1 data went live end to end. Also: the Claude CLI backend now streams its answer token by token, and ~4,200 lines serving already-rejected features were decommissioned.

### AI coaching — retired signals (opportunity-normalized discrimination audit)

Each retirement follows the same ruler: conversion = seized ÷ opportunities, winners vs losers. A signal that doesn't separate them has no business blaming you. The facts behind each retired signal stay in the timeline for the model to reason over; only the accusation is gone. Extraction functions and tests are kept in every case.

- `16f0de4e` "CC-locked" retired — after normalizing by opportunity, players who actually broke CC when they could won _less_ often (23.2% vs 27.9%); 98.5% of accusations landed in the two no-evidence buckets
- `90c26008` "Wasted trinket" retired — ~94% of accusations were healers cleansing CC off themselves, judged by a predicate structurally blind to the owner; normalized rates were backwards
- `68253b48` "DR-clipped CC" retired, plus two aura-interval phantom fixes found along the way
- `2ae31e63` "Burst into immunity" retired; "missed purge" survived its final review and stays
- `5820eed3` "Off-target in window" retired along with the CAPITALISED vulnerability verdicts
- `0e4c8357` "Unconverted burst" retired — replaced by per-attempt outcomes in the new [KILL ATTEMPTS] block
- `22779c10` "Missed sync window" and "juked kick" retired (win/loss conversion flat once the opportunity denominator was cleaned)
- `0a37d5ee` `14b8a124` The reverse side of the same audit: "slow defensive response" and "unsynced burst" were _cleared_ — their negative discrimination was a denominator artifact; slow-defensive-response is in fact the strongest positive signal in the library (+15.3pp)
- `67a6d3be` `f06ed5c8` The discrimination scanner and a per-type candidate health check are now permanent eval tools, so the next signal gets this audit before it ships

### AI coaching — thresholds grounded and rulings signed

- `20153fd0` The "stayed in danger" exemption line is now a measured hpMin<35 gate instead of the invented 85/15 pair
- `baae59ea` CC-avoidable minimum raised 3s→4s; kick-eaten and external-response thresholds registered with their measured bases; two severity corrections
- `082a7498` `8c73eb2e` death-setup's 12/3/90 lookbacks and the 30k burst-damage floor were tested against the corpus and kept — now documented as measured, not guessed
- `551438fb` The per-round topic cap (2) is now permanent: uncapped reruns showed a 64.6% flood; its TEMPORARY label is gone
- `4ee44c3b` The full §C occurrence × win/loss table was formally rerun on 459 matches / 2,114 rounds of live 12.1 data
- `d6ef1513` `8f273d50` Mistake cards re-sorted: two severity inversions fixed, and within a severity tier the order now follows measured discrimination
- `1856f9aa` `d4db0378` Cooldown-ledger guard note stops "Blessing of Sacrifice" reading as self-rescue; finding titles run through placeholder resolution (a real-model smoke caught `{{target1}}` rendering raw)
- `dfa6f772` `806697dd` CC-type-aware trinket exemptions (a stun table no longer speaks for fears), and healer-spec escape kits now distinguish "has none" from "unknown"
- `27866802` "Bursting into a mitigation — waste or not" is now driven by a signed per-spell ruling register instead of a hardcoded set
- `52778e29` Issue #29 closed: the intent guard now filters GCD-spam artifacts, so "not ready yet" no longer impersonates "on cooldown"

### Kill analysis rebuilt

- `9a4ae61a` `7603e107` `740181f7` Kill-window target selection moved to a three-tier opportunity model (user-defined criteria, validated on 8,791 stuns); the softness score and its certificates are retired; a per-attempt [KILL ATTEMPTS] block and an attempt-into-trinket candidate landed
- `b68b1d80` Kill attempts v2: burst-anchored attempts (team offensive casts pooled into reach-clustered windows) join stun-anchored ones — coverage of real kills went 20.1% → 80.5%; the old vulnerability-window prompt blocks are gone, and a sparse-path wiring bug that had kept [KILL ATTEMPTS] out of every production prompt since v25 is fixed (0/146 → 146/146)
- `694755e5` `d5a66dce` Enemy healers are no longer scored by DPS-trinket cooldowns, and enemy mitigation checks share the charge predicate and see talent modifiers
- `63d86357` Cooldown availability is charge-aware: multi-charge spells use a real charge ledger instead of "cast = gone"
- `3027d0a0` Test fixture cleanup for the kill-attempt flag negative controls

### Dispels and purges

- `1e2c7019` `459ea245` A signed dispel-priority ruling register (per-matchup value tiers) now drives missed-cleanse through three gates — accusations dropped 705 → 194 across the library
- `ab48861b` `309cb659` Timing gates for dispel urgency: the "situational" tier now consults a calm-window predicate, extended to the worth/must tiers per the signed archive ("whole-window pressure exemption")
- `e027c06c` `84e9cd94` The dispellability candidate list is closed against official data: 145 spells / 76.5% of observed dispels had no entry at all (Shadow Word: Pain, Moonfire, Corruption…) — now covered
- `56736355` A two-layer table merge was silently swallowing official dispelType on 12.1 ids; restored field-level (v30)
- `9b6aa54a` Three purge-blocklist entries added with mechanically-correct rationales: Blessing of Sacrifice and Time Stop are fundamentally un-purgeable, shaman Nature's Swiftness is consumed too fast to matter (corpus: 0 real purges across 1,444 windows)
- `0a29c6d1` `59128b7c` The Unstable Affliction backlash exemption had rotted whole: 100% of its ids extinct, 100% of live exposure (1,153 applications) unlisted — refreshed, and the curated-list completeness rule gained its reverse check
- `e9e6e4da` `3d5cd816` Void Nova reclassified stun (a healer cannot self-dispel it), Diamond Ice/Imprison confirmed covered by their official standalone ids
- `d62fcfc4` "What counts as an immunity" had three disagreeing hand tables; the official mitigation table (pct=100) is now the single authority with a bidirectional cross-table test, Dispersion (75%) evicted, Spellwarding registered

### New coaching candidates (P1/P2 distillation) and the raw-log layer

- `591be70f` `d9f18bbe` `1895a494` `c861ece3` `5c4ff884` `1640e980` `4ec58994` Four new candidate types built behind flags: missed-sync-window and unsynced-burst (sync with a healer lock is the trigger — no HP gate), cd-hoarded and cd-spent-idle (threat-tier gated)
- `a64b44e5` `b2ace67a` `69a37039` `07bdccd4` `6fd4de62` `bac89057` `df1db220` Thresholds calibrated on 1,028 matches / 3,441 rounds, then each type A/B'd independently (n=30 per type) with a shared production-predicate harness
- `d08992ea` `39e88b34` `0b0db430` `8c4ea6f9` All four launched by ruling; the selection-layer topic gate widened ≤2→≤3 (+55 clean findings, 0 mechanism errors, n=48); a dual-healer mislabel was fixed before launch
- `f1a9acb9` `ab4581e4` `1df54bb2` A raw-log stream layer now reads mana values and SPELL_CAST_FAILED directly from raw.txt — powering the intent guard: a cooldown you _pressed_ but the game rejected no longer counts as hoarding (968/2,720 accusations were this)
- `85f9d0e1` `6e89a975` Mid-match log rotation no longer drops a finished Solo Shuffle round's callback (parser EOF flush, #21.8)
- `a2a6421c` `11a13af0` `1baf83ce` `cf66034d` `33c66839` `80869dd0` `06110543` `e3e210e2` `7e188495` `02323b75` `9afc6ef7` `34a9ad3c` `3ec0f68e` `e11025ab` `dd8de24c` Two mana candidates (OOM-window pressure, whole-match mana efficiency) were built, calibrated, and A/B'd — then ruled _not_ to ship: mana advice without forced-vs-unforced attribution is meaningless. The successor (#33, a deterministic attribution engine) is specced; a Solo Shuffle cross-round contamination bug found on the way (87% of windows) was fixed for good measure

### Skill-facts foundation (what the coach may assert about abilities)

- `9e7bfa30` `24fa7423` `22e276c9` `4d316e97` `430e3b75` Non-official skill facts now live in a signed register enforced by CI; the usable-while-stunned table is derived from official flag bits (feared/disoriented proven non-derivable and kept as signed gap entries, Barkskin signed true)
- `54e3d6a1` `51640d0f` `fd7a01ed` `e2c29643` `ccde762b` `3e672fb7` `bb0d3ea0` The register's anchor list was user-signed entry by entry, with a corpus observation line (casts observed during stuns) validating both directions
- `415353e8` `24bb5d7f` First consumers wired: the cost-normalization guard note, and the Markdown export's healing column now includes absorbs
- `94eed173` `547ec6f1` `2d5993c8` `4bb23b99` `07222bcb` Cooldown judgments are talent-adaptive per player (proc chains, serial charges, per-unit percentage modifiers, TrinityCore stacking semantics); a negative-cooldown class (265,187 rows) went to zero
- `c6bcd082` `9b80bf9e` `8ad2d7eb` `425a9e86` Talent mitigation now mined from tooltips: the input universe grew from a 46-entry whitelist to 3,491 talent spells, nine ≥20% self-mitigations previously invisible; beneficiary classification fixed (Vengeful Retreat's DR belongs to the ally, not the pet)
- `f8aca39f` `2715d852` `d734f8a5` `20ff3d5e` `f26f5023` `4b6bb048` `0cd447cb` `041e6d1e` `af96533d` Aura bookkeeping hardened: name-table break fixed (Renewing Blaze read as permanently ready), aura-only fallback scoped, hard CC can no longer be pushed out of instant-state queries by cosmetic auras (#27), a double-close race fabricating phantom intervals fixed (63,590 → 0, #28), and the two aura-interval builders were unified onto one authority implementation with the anti-fabrication rules moved up (predicate-index "not yet unified" section empty again)

### 12.1 season data

- `17733808` `377f405c` `135ce694` Full data refresh to the season build (12.1.0.69382); the official patch notes were audited line by line for the first time — Stellar Protection's backlash gate, Ancient of Lore, Scatter Shot 3s all corrected against live-corpus evidence
- `e45aa03d` The candidate pool ingested live 12.1 logs: observed spell ids 3,417 → 3,719, dispel coverage gap 0.62% → 0.37%
- `8654de68` `2a73d1cf` `a9bc6bf6` Power Word: Barrier's status corrected per ruling with a global corpus-era guard; Ring of Fire closed as an old-id family fallback, not a new id

### App

- `11406f10` The Claude CLI backend now truly streams: the analysis preview fills token by token instead of sitting empty for minutes and appearing all at once (37 deltas over 3.4s in the live smoke vs a single end-of-run blob before); older CLI versions fall back to the previous whole-text mode automatically
- `ab833e7a` `2a859963` `dc0fa404` Mistake cards merge before truncating (teammate folding, moment grouping, top-3 default), and a match where only teammates erred no longer renders a row of zeros
- `080b4675` `ab6c38f9` Replay: CC state on the map (ring + duration arc) and cast targets in the GCD lane
- `870776aa` `573348da` `f01f916e` `f0702cc3` `528f6d73` `98929368` `b516db56` Big-screen pass: page cap 1920→2560 with proportional width distribution, three panels fill tall screens, the match list is drag-resizable, the HP curve gained a "friendly only" toggle, a UI-zoom setting fixes 12.5px body text on 4K, and the damage meter strips server suffixes
- `24bb5d7f` Markdown export counts absorbs in the healing column (also removed a dead field)

### Under the hood

- `cd3d23b9` `97165bf2` `62b1e78a` `add139b5` `986c8571` `032019be` Pipeline-audit engineering batch: the render grid moved out of cooldowns.ts, four dead switches deleted (−362 lines), candidateFindings.ts split by theme (3,776 → 2,094 lines), the four coexisting HP sampling radii unified into one constant, the predicate index now asserts feature-flag runtime values from a structured table, and two stray copies of resolveOwner moved onto the shared export
- `7c91140a` `ca339a29` `db1e46a1` Decommission to primitives (−4,237 lines): the dead legacy prompt branch (criticalMoments), the declined mana candidates' three wiring points, and the rejected moment-snapshot deep-dive (including its settings toggle) are all unwired — pure extraction functions and their tests remain
- `e65c19d7` `b83ee0ea` scripts/ folded into typecheck coverage; the flaky firstPaint budget now takes the minimum of its samples
- `9af03b83` The parser differential-oracle baseline was re-ruled: 13 differences documented with evidence, gate green again (#23)

### Other

- Handoffs, audit ledgers, issue filings and design docs: `eea82b28` `113cea55` `d777b660` `75ad3bf9` `3e113506` `1cb0094f` `959e0c11` `8b453a7c` `2845bacd` `12b46474` `c5456378` `4211c13a` `2ddff0f0` `75c51981` `d471d5cd` `e347cca2` `bdb82bc1` `eb000406` `a17d9e45` `e2de2fcd` `8c25079d` `6e361936` `2b3c3e35` `ccb4d1ac` `40e67946` `566f5d98` `45b08375` `3b6109f7` `611dc54d` `a4358d38` `f24f9e9a` `64f6891e` `0fe31552` `a6a68274`
- English translation of the internal docs corpus (14 batches) and the corpus-tools README, plus a stale-base restore: `27b665b3` `be9b9eb4` `b3ab4bf9` `48ea4004` `48b531fb` `d2c3fa97` `a144ce1e` `9fcab15a` `cff326d2` `bab5439a` `211ce215` `8b2a2e48` `c545b68b` `dab2bba8` `f0749fae` `b4e3517c` `379be45d` `0e91fd0b` `7906b175`
- Visual baselines (CI-generated, human-reviewed) and repo hygiene: `11a5859f` `e3659f6e` `02a4720d` `089f13da` `7cfc3fee` `8ebfa516` `e52761ab` `aee39e0c`

## v0.1.26-obs2.2 (2026-08-15, test build)

**Functional test pre-release of OBS recording phase 2**, from the `worktree-obs-phase2` branch and not merged to main. It carries everything on main through v0.1.26, plus the managed-OBS recording work (stages 0 and 1). The point is automatic arena recording with no OBS install or setup by the user; the connection path has been root-caused and fixed on a real Windows machine (`npm run recorder:gatecheck` passes), and the full product end-to-end (auto-record a real match, retention, click-to-seek) is what this build is for testing.

### Recording (managed OBS)

- `1d3cd4e` `aa401e7` `96d8660` `fb9d4c7` gladlog now manages its own portable OBS: on first use it downloads a pinned, SHA-verified OBS build from the official release, extracts only what it needs, generates a portable config, and drives it over obs-websocket — the user never installs or configures OBS. Windows only; on other platforms the "point at your own OBS" path from phase 1 is unchanged.
- `bf799dc` `0a62c0c` `4136a3e` While WoW runs it records continuously and splits per match, keeping the chunks that carry a match and reclaiming idle ones under a dual quota (count + 80 GB). Because a chunk always starts before the next match opens, the opening seconds are never missing.
- `13fe39d` The managed OBS is launched with `--disable-shutdown-check`. Without it, an OBS that was hard-killed on the previous quit pops a "start in safe mode?" dialog on the next launch that silently blocks the websocket from ever coming up — recording would fail every run after the first. Root-caused on the real machine via netstat + log A/B; the earlier `--websocket_ipv4_only` flag was a misdiagnosis of this same symptom and has been removed (OBS binds dual-stack, `127.0.0.1` connects).

### Recording playback

- `f6a80b2` `7efe296` Clicking a death, a finding or a burst window jumps to the event itself instead of landing several seconds late — the offset that expresses "the recording starts after the match opens" was being clamped to zero and no longer is.
- `ea2a63b` `1e228b1` One recording can be linked to several matches, so back-to-back matches that share one recording no longer lose the second.

## v0.1.26 (2026-08-13)

This release is about **the coach no longer blaming you for things the game did**: racial abilities are now counted, the shared trinket/racial lockout is respected, Blessing of Sacrifice stops being read as your own damage reduction, absorb shields finally count as effective HP, and enemy shields become purge targets the analysis can actually see.

### AI analysis

- `b951837` Racial abilities are counted for the first time. The combat log has no race field, so ownership is established purely by observing a cast — an observed cast proves possession, its absence proves nothing. Breaking out with Will to Survive / Will of the Forsaken / Escape Artist / Fireblood no longer reads as "your trinket was in hand and you sat in it" (35 such false accusations across 120 local matches → 0), and offensive racials (Blood Fury, Berserking, Fireblood, Ancestral Call) now enter the cooldown ledger on cast evidence (0 → 405 entries)
- `a32c503` The 30-second lockout a breaking racial imposes on the PvP trinket is respected: for 30 seconds after Will of the Forsaken and friends, the trinket is no longer reported as "available and unused" (92 such windows across 200 matches → 0). The lockout length is not in the game data — the racials and the trinket sit in different cooldown categories — so it was measured from 307 consecutive presses in real logs (minimum gap 30.1s, none below 30s). Escape Artist shares nothing and is correctly exempt
- `03b1d08` Blessing of Sacrifice is no longer listed among the defensives you failed to press at your own death: casting it on yourself is a mechanical no-op, since it transfers 30% of the damage to the caster. Both the prompt's death line and the coaching finding are fixed (6 of 18 death lines across 300 matches → 0), leaving the rest of the "unused" list untouched
- `4f3e118` `9e99b48` Absorb shields count as effective HP. The death audit could previously only see percentage mitigation, so a match you shielded through still read as "you pressed nothing"; each shield now reports what the log says it actually ate, which by construction credits only what was absorbed before the buff expired. The same audit also gained four damage reductions the table could never mine (Fade, Survival of the Fittest, Avatar, Defensive Stance); Feint, Evasion, Ice Barrier and Earth Shield were checked against the official data and genuinely carry no percentage mitigation
- `10d5600` `157e6c9` `ec29168` Enemy shields are purge targets again. Ice Barrier had no category entry and Power Word: Shield was absent from the spell table entirely, so neither could ever produce a "you missed a purge" finding; both are now registered at a moderate priority, deliberately below the tier immunities and hard CC occupy. Ten more high-value buffs join them (Alter Time, Prayer of Mending, Archangel, Bloodlust, Void Shield, Wind Barrier, Chi Cocoon), four permanent party buffs are blocklisted (Fortitude, Arcane Intellect, Mark of the Wild, Skyfury), and Blessing of Freedom's priority now depends on the matchup — with no snare-dependent spec on your side it is not flagged at all

### Other

- Visual baselines, review-workbench tooling, eval scaffolding and docs: `698a573` `cd2b84b` `5a0363f` `ba534b3` `4014c7d` `e7274e0` `142dc4a` `e9b8366` `9c91e2f` `187c14d` `0b3b649` `73fced3` `d97b394` `f8c0def` `bfde7e3` `0adb57a` `9754352` `533f85e` `9383dd2` `d957654` `9bc4410` `3ce350b`

## v0.1.25 (2026-08-12)

This release = **matches open several times faster** (per-round lazy loading for Solo Shuffle archives) and **the cohort-comparison AI commentary actually shows up** (three narrations out of four were being silently discarded).

### Performance

- `e4122c2` Opening a match no longer parses the whole archive on the UI thread: Solo Shuffle archives get a per-round byte index, only the active round is parsed on open, and the other rounds load when you switch to them. Measured open cost 186ms → 20ms on a median 49MB archive and 1079ms → 184ms on the largest 277MB one; the index is built in the background for the existing library, and hovering a match in the list (or starting the app) pre-warms the likeliest next open

### AI analysis

- `b1a384c` The "vs your cohort" AI commentary now survives its own fact-checker: 27 of 36 real narrations were being silently discarded as "AI commentary not generated" because the prompt's crisis exemplars carried the very timestamps and HP percentages the checker forbids, and models also invented illustrative numbers of their own. Exemplars are now scrubbed with the checker's own predicate, the per-dimension verdicts are given to the model directly (it used to be asked to discuss the weak dimensions while unable to see which ones were weak), and a single violation-guided retry backstops the rest — surviving narrations 9/36 → 35/36 on the same matches and backends, with the checker itself unchanged
- `97aad76` Shadow Dance is no longer treated as a usable damage reduction in mitigation analysis (disproved both ways against the 12.0 corpus), along with three redundant coverage cleanups

### Other

- Eval tooling, verification scripts and design docs: `acd53a0` `18a8712` `89ae95e` `4d76970` `edc1e54`

## v0.1.24 (2026-08-12)

This release = **talent-aware coaching** (no more advice built on spells the player never talented), the Mind Control friend/enemy fix in replay, a decluttered death recap, and two new coaching topics.

### AI analysis

- `cf539cf` Talent-aware capability gates: "a teammate could have used X" and the death recap's available-immunity suggestions now check the player's actual talent build — class/spec/hero trees including choice nodes, plus PvP talent slots against the official pool. Ghost external suggestions drop 517/918 → 0 across the library; Solo Shuffle reads talents per round (players re-talented mid-match in 171/186 shuffle matches)
- `cd1b22f` `eac8853` Topic diversity at the model's picking step: the four legacy topics (missed cleanse/purge, cc-locked, wasted trinket) are capped at 2 per report via prompt instruction plus a deterministic audit backstop; legacy-topic share drops 61–65% → 43–49% across all four backends
- `c277ca8` New coaching topic: bursting into a major mitigation while a softer target existed
- `0da7653` New coaching topic: slow defensive response after an enemy offensive cooldown lands under real pressure (the 8s bar comes from the observed reaction-latency distribution, so median-speed reactions are not flagged)

### Report

- `6265556` Death recap decluttered: DoT and melee ticks merge into per-spell subtotal rows, direct hits and heals below 2% of max HP fold into an expandable row, dispels now appear as rows of their own, and a "show all" toggle restores the raw view. Median rows per recap 114 → 24, with totals conserved
- `5753c14` Death recap rows now carry inline spell icons

### Replay

- `48f3e2a` Mind Control no longer flips friend/enemy in the replay view (map health-bar columns, dot outlines, swimlane grouping, team chips): sides anchor on the arena roster instead of combat-log flags, so the reported 2v4-instead-of-3v3 round now renders correctly — including for already-imported matches
- `22b9d00` Fixed a side-voting regression (introduced 2026-08-07) where one charm could flip a unit's side for the whole match: 1459 flipped units across 230 archived matches → 1

### Data

- `526a3fb` Full data refresh from the 12.1.0.69273 build: 12.1 talent trees land, officially removed talents disappear, Ring of Fire kept for historical logs
- `5856ee0` The diminishing-returns reset window is era-aware: 16s before 12.1, 20s from the S2 cutover
- `2309964` Observed-spell universe refreshed from August matches: 3346 → 3353 ids (icons +5, off-GCD +1)

### Other

- Visual baselines, backlog records, dev tooling: `5a907df` `1534706` `bb814f4` `1ba1613` `b77d460` `4e0beae` `fdc6dfe` `56e631d` `493e02d` `09ae85b`

## v0.1.21 (2026-08-06)

This release = **the Claude 5 model family for the claude CLI backend** + a Windows CLI-detection fix (the "spawn …\npm\claude ENOENT" failure) + the moment-level deep-dive batch (replay "dive into this moment" entry, multi-finding window deep-dives, a hindsight-bias gate). It is also the first release that existing 0.1.20 Windows installs receive through auto-update.

### AI analysis

- `968ab59` The claude CLI backend's model dropdown moves to the Claude 5 family: Claude Fable 5 and Claude Opus 5 join, with Opus 5 replacing Opus 4.8. The default stays Claude Sonnet 5; a previously saved Opus 4.8 selection falls back to the default automatically
- `8415b7e` Windows: claude/agy/codex auto-detection no longer picks the non-executable Git-Bash shim in the npm directory — the cause of "spawn …\npm\claude ENOENT(version detection failed)" — and the version probe now works for .cmd installs too
- `f8e0139` `e65a9ce` A window deep-dive can now return 1–4 independent findings per anchor instead of one merged blob; each finding is audited separately, and results are cached per entry
- `72e33ec` Deep-dive audit fix: multi-finding packs no longer lose every finding to index remapping (on the agy backend this was dropping 27 of 27)
- `1df954b` `06ad08e` New hindsight gate: findings that judge a decision using knowledge the player could not have had at that moment are dropped before display
- `cbec10f` The deep-dive audit records a per-finding drop reason, so a disappearing finding is now diagnosable
- `66d1b29` The AI panel shows an in-flight status row: elapsed time, backend and model, a note that CLI backends don't stream, and retry/backfill markers

### Replay and moment deep-dive

- `bc8387e` The replay control bar gains a "Deep Dive This Moment" button that opens a deep-dive on the moment under the cursor; manually drag-selected windows always use dense snapshots
- `29fec9e` `f1642b1` `554f832` `923420d` `7d4b67f` `39bf02b` `1ed42d7` Dense moment snapshots (HP, auras, cooldowns, cast flow around the anchor) can be packed into deep-dive prompts, behind a settings toggle
- `45f292a` `361bdc1` After a 20-match blind pairing the dense-snapshot prompt did not beat the default, so the toggle now defaults off — and it only takes effect on CLI backends (subscription-billed); API backends always use the default prompt
- `d1e3652` `267a405` Visual baselines for the new toggle and the replay button

### Eval infrastructure (developer-facing)

- `9fb2428` `f6dad02` `12a7e2a` `117f66c` `d499503` `e5c4d71` Judge-noise-floor work: the accuracy dimension is now computed deterministically from the fact audit instead of being judged; optional K-replicate aggregation; planted-error tooling; explicit failure accounting and incremental resume for the A/B runner
- `a6ec075` `1e7084c` `4f1f408` `ed7df7f` `bcee64f` Outcome-halo experiment: outcome-label redaction, seeded arm builder, sign-flipped alignment stats, a shared bootstrap seed, and a sixth facts-consistency hard failure
- `ece1011` `0b51b62` `2a1306b` Cross-AI moment-dive A/B: --gen/--judge switches, agy backend, dual-judge agreement rate
- `0263d65` `63e9446` `5881a84` DeepSeek driver for eval batches: message construction, tolerant JSON parsing, timeout and retryability classification
- `9b7ebb3` `0f42562` `9d26676` Family-bias 2×2 double difference and sycophancy challenge tooling
- `f0e5255` Hindsight corpus tool: planted/legitimate synthesis plus a predicate-review mode

### Other

- Specs, plans, and measured-result write-backs: `256a9c9` `fde0e43` `e000449` `d976582` `f332b6c` `0b05e44` `7e92056` `e150564` `19f89bd` `6839986` `ab15a62` `3b546d7` `6fd7738` `8d99348` `e2879f4` `ba5b876` `a38a79d` `9da1e1d` `2e2b695` `9834b79` `67d1991` `01f5f57` `b78c85d` `69e11bc` `63c499d` `33a68fe` `242ed43` `17b0cf6`

## v0.1.20-ui.1 (2026-08-04, test build)

A test build of today's report/events/batch-analysis batch, cut from main — it contains everything in the v0.1.20 section below (Windows auto-update etc., not yet released as stable) plus the replay-alignment fix. It does **not** contain the OBS phase-2 stage-0 work from the v0.1.20-obs2.1 side branch (that line lands after its Windows gate tests) — do not install this over an OBS test machine.

### Report

- `618b8f2` Curve metric dropdown: HP / damage / healing / damage taken / healing received. The four flow metrics render as per-second stacked bars; healing counts absorbs, same basis as the leaderboard; switching the curve also switches the matching leaderboard mode
- `c97d491` Team markers on every tab: a team-color dot before each name (green = your side, red = theirs), the leaderboard splits into two team blocks, enemy HP curves draw dashed; pets inherit their owner's side
- `6803890` The right column gains a Ask the Coach tab — chat with the coach while looking at the curves, same conversation as the AI view; opening a death recap switches back automatically

### Events

- `e86783b` Per-column filter row (time window / kind multi-select / source / target / spell / amount floor) with source and target as independent dropdowns that include pets and totems; click a column header to sort, click again to flip

### AI analysis and batch

- `d252d4f` Cohort comparison backfills automatically: a match that has an analysis but no comparison gets one on opening the AI panel (never-analyzed matches still run nothing)
- `fc87ad9` Batch analysis: "skip analyzed" is now a toggle (uncheck = re-analyze and overwrite), and match-list rows have checkboxes for selective analysis — checking a shuffle row takes the whole 6-round lobby

### Replay

- `c54dc0f` Video/replay time conversion unified in one place (offsets may be negative, with pre-roll) — recording-tab seeks no longer drift by the log lag

### Other

- `61861b5` The settings page's update row shows the full error message on hover
- `ce32577` Release-pipeline fixes: latest.yml is now actually produced on tag builds (--publish never), upload globs narrowed, install-button latch
- `1dee8f4` First-paint budget re-locked 3300 → 5200 ms (the old line was locked from a sample population that no longer exists; six-run evidence in the commit)
- Docs and baselines: `fe0d1d5` predicate index gains a Report UI section, `d384fee` auto-update field-test notes, `2db86fd` predicate-index count correction, `613cd95` development-process archive; visual baselines `93ae553` `68e83af` `8b3ec6a` `6b42b37` `b02eb83`

## v0.1.20 (2026-08-05)

This release = **automatic updates for the Windows installer build** + the developer page redesigned into a workbench, **plus the whole report/events/batch-analysis batch from the v0.1.20-ui.1 test build graduating** (curve metric dropdown, team markers on every tab, per-column event filters and sorting, cohort-comparison backfill, batch selection — itemized with hashes in the ui.1 section below, not repeated here) and two follow-ups on top of it.

### After the ui.1 test build

- `6d1e82f` Unit filtering now solos: from the all-visible default, clicking one player shows only that player; from any other state a click flips just that one. Clicking the last visible player restores everyone (a blank chart tells you nothing). Same semantics on the legend, the curves and the leaderboard names.
- `6d1e82f` The replay tab's player chips are grouped into two labeled clusters — ● Friendly and ● Enemy — mirroring the lane split below, instead of one flat row.

### Updates

- `6673a25` `6f6de3a` `23c7d3f` `59a1881` `faacad4` `05fce43` `b727f5a` `4d16124` `a922e6d` `6afa619` `648d290` `56578d0` `91b6c64` `f13180c` `13d8434` `dec7bc2` `5e0dd47` `67f810c` The Windows installer build now updates itself: shortly after launch it checks GitHub for a new release, and periodically again while the app stays open; if one exists it downloads the new build in the background and shows a "new version ready — restart now / later" banner in the top bar. The install happens on exit, so it can never interrupt a match that is being recorded; if you never click restart, the next ordinary exit installs it anyway. While a recording or a batch analysis is running, "restart now" is disabled. Settings → About gained the current version number, a manual "Check for updates" button, and an "Automatically check for updates" switch (on by default). A failed check is silent by design — pulling 110 MB from GitHub fails often enough that a popup would be noise, and nothing else in the app depends on it.
- `7739c13` `de28390` After an update the top bar shows "Updated to 0.1.20 · What's new" once, linking to that release's notes. Automatic updates are otherwise invisible, and "which version am I on" is the first thing anyone needs when reporting a problem.

Not covered: macOS is unaffected (the build is ad-hoc signed, which Squirrel.Mac refuses, so the updater does not initialise there), and so is the Windows portable zip (there is no installer to hand the download to). **0.1.20 itself still has to be installed by hand** — 0.1.19 does not know how to update itself; the benefit starts with 0.1.21.

### Developer page

- `b4c0345` `5fdfff7` The Developer tab is now a proper workbench: a left nav rail, a full-height layout, and a persistent status bar, split into four areas — monitoring, match inspector, AI calls, diagnostics. The match inspector's JSON tree now lazily expands nodes on click instead of dumping the whole document as text, so opening a large match (library matches average ~62 MB) no longer freezes the app; arrays page 500 rows at a time. The fact card also gained an event count.

### Recording tab

- `2a1222d` `15b8ed1` The "all moments" list fills the side card's height (653 wasted px → 11 at 2560×1440), with the tab's viewport budget converged into one place.

### AI analysis

- `959c1f6` Root fix for "the cohort panel sometimes doesn't show up": the comparison keeps a pullable terminal state in the main process, generations are bucketed per match, and the cache key no longer couples to the analysis prompt version — switching tabs and coming back can no longer lose a finished comparison.

### Other

- `3d2b353` `56ef723` `5a9982f` `63df5de` `834d80b` `e5e6a60` `c684160` Auto-update design spec and implementation plan, written and revised across four review rounds (docs only, no app behaviour).
- `79990b3` `b0f0efb` `42bcce1` `b08b6a9` Code-comment translation to English finished repo-wide (499 files / 6,790 lines; ~134 lines deliberately kept, e.g. generated-file headers and template strings) — the second and final batch after v0.1.19's first one.
- `105f0ec` `0d49b4c` `57720ac` Visual-baseline maintenance for the developer-page redesign above (three rounds of regenerate-and-review, scoped so it would not drift the shared fixture other views also use).
- `476eb4c` `59ea7ad` Visual-baseline maintenance for the chat card, the recording-list height fix and the replay chip clusters; `0018b7f` this changelog's first draft; `3b75494` the v0.1.20-ui.1 test-build release commit.

## v0.1.19 (2026-08-02)

This release = **Ask the coach** (in-match AI chat) + the coach no longer blames you unfairly (four feasibility gates on dispel criticism) + a new CC-break statistic + the "recording never stops after the match" fix + in-app problem reporting.

### AI analysis (Ask the coach)

- `d7d19bb` `409ac96` `a709d7c` `925c032` `5e0b549` `5df2807` `1a02cd0` `6b2875e` `ebb4699` `7398453` `6b14ecd` New **Ask the coach**: once the AI analysis is done you can keep asking follow-up questions about that match, reusing the same session context from the analysis (all three local CLI backends — Claude / agy / Codex), so you never have to re-explain the match. Multi-turn, stop at any time (the background process is genuinely killed), drafts preserved.
- `49d2599` `6404573` `5305b25` `8d6f190` Three review rounds: switching matches no longer leaks chat state across them, stopping or retrying mid-send no longer wipes an unrelated draft, and the optimistic echo no longer duplicates bubbles.

### AI analysis (the coach stops blaming you unfairly)

- `1c8f966` "Why didn't you dispel that" now has to clear four gates first: ① **positioning** — a teammate behind a pillar or beyond the 40 yd dispel range is not your fault; ② **you were locked down** — no reaction window during hard CC or a silence means it wasn't missable; ③ **you were school-locked by a kick**; ④ **DR context** — when the target's diminishing returns are still fresh and dispelling would likely trade straight into a full-duration re-CC, the coach advises cautiously instead of calling it a mistake. Measured on 150 local matches: this class of criticism drops from 710 to 505 (-28.9%); Binding Shot, the single biggest false-positive source you called out, drops 42% and Dragon's Breath 40%. Old analysis caches invalidate automatically — re-run one match to see the new behaviour.

### Report (new CC-break statistic)

- `fe1db04` The engagement panel gained a **CC breaks** tab: ① **squandered** — your own damage broke a crowd control your team had on an enemy (with the breaker, the breaking spell, and how much time was left), which is the teachable half; ② **enemy mistakes** — their own DoT broke the CC they had on you, a positive signal. Broken roots are listed separately and not taught (breaking a root to reposition is often deliberate). Measured locally: ~6.1 per match, split almost evenly between the two.
- `2d393bd` CC duration pairing consolidated into one predicate (and an honest note: the duration inflation we suspected does not actually occur in this corpus).

### Match recording

- `85d4642` The **"recording never stops after the match"** fix: ① after an OBS disconnect mid-match, if there is no next match nobody was left to stop the recording — it now reconnects to close it out; ② when the combat log stops being written (no new events after the match ends), the segment closes itself after 3 minutes instead of waiting out the 40-minute safety valve; ③ every OBS request gained a 15 s timeout, so one stuck request no longer deadlocks all later starts and stops.

### Replay

- `3754c31` The embedded video thumbnail is gone from the replay view (the recording tab shows it far larger, with a click-and-drag battle timeline).

### Global

- `8dedeac` New **Report a problem**: one click in the report toolbar packages this match's raw log, the recent AI calls (prompt and response) and your description into a folder under the gladlog-sync drive (auto-uploaded) or locally, then opens it. API keys are deliberately excluded.

### Other

- `1993adf` First batch of code-comment translation (8 files / 350 lines; the rest to follow); `a4648f1` dead imports removed to fix CI lint

## v0.1.18 (2026-08-01)

This release = batch analysis goes concurrent (3-way) + a low-pressure guard note so the coach stops scolding unused defensives in rounds where you took no damage + three adjudicated wording/layout tweaks across the report, recording, and stats views.

### AI analysis

- `0c568a0` Batch analysis switched from serial to a **3-way concurrent pool**: matches and shuffle rounds share one queue, so rounds of the same shuffle analyze in parallel too; progress still counts per match, and cancel now pinpoint-cancels every in-flight unit
- `37f5df2` In rounds that never put you under real pressure (lowest HP ≥ 60%), the prompt now states explicitly that holding your unused defensives was the right call — the coach no longer riffs "you never used your wall" off the loadout's [UNUSED] tags in rounds where you took almost no damage (local-library measurement: 72/92 low-pressure rounds carried ungated tags → 0/92 unguarded). The prompt version bumped, so old cached analyses — including these false calls — re-analyze

### Report / recording / stats polish

- `c3dbb69` The report header result area is now localized ("Defeat" etc., larger weight; meta reordered to bracket · round · map · duration · rating); the recording tab's marker strip moved into the same track column as the progress bar, so you can drag against the gold bands and glyphs; the stats per-map card switched to a row style (name + win-rate bar + n% · x games) and clicking a row returns to the match list with that map filtered

### Other

- `c287115` 14 visual baselines refreshed for the three adjudicated changes (CI-generated, human-reviewed)

## v0.1.17 (2026-08-01)

This release = two rounds of UI redesign landing across all three views (report dual-column workbench / stats KPI tower + coach cards / recording three-tab workspace, including 4K empty-state and real-match acceptance fixes) + eight structured-analysis signals surfaced + multi-model analysis comparison and auto-analysis + three data-compliance items.

### Report (dual-column workbench / round-two polish / eight signals surfaced)

- `9672da3` The report is now a **dual-column workbench** (≥1440px): HP curve, meters + engagement panel, and burst ledger on the left; death recap + mistakes list on the right; the header gained a result area and KPI chips (finishing kill / mistakes / burst windows / interrupts / dispels); the standalone interrupt / dispel / aura cards merged into engagement-panel tabs; narrow windows fall back to a single column; `ff8c649` four review fixes alongside
- `4bc1954` Burst / pressure windows on the HP curve switched to a faint fill with boundary strokes — overlapping windows no longer smear into a dark blob; when no friendly death exists, the enemy last-death fallback is now titled "termination recap" (their death is your result)
- `ff66f10` Two real-match overflow fixes on the death recap card: the event timeline collapsed to 5 rows with internal scrolling (the 10s before death in a long round can hold dozens of small hits, previously stretching the right column to two screens), and the source column drops the realm suffix (cross-realm full names used to push the page into horizontal scrolling); `8a7ea5d` the scroll region gained keyboard focus (caught by the accessibility gate)
- Structured signals surfaced: `2532caa` single-source structured foundation and dead-code cleanup; `f23569e` a dampening lane under the curve and DR-tier annotations on CC moments (`1a13c29` review fixes); `3c2825c` target-selection verdicts (who to hit) and healing-gap surfacing in the burst ledger; `6a215c8` a **match-arc line** in the header (clickable turning points) and positioning events on the moment axis; `5fd2e4c` review fixes (English prose removed / positioning mistakes single-sourced); `16f9900` panic-defensive and cheaper-alternative annotations on the recap plus a new **enemy CC-chain panel**; `97dd5c6` cheaper alternatives exclude self-cast-ineffective externals

### Stats page (KPI tower + coach cards + empty-state fill)

- `9672da3` The stats page is now a left **KPI tower** (games / win rate with W-L / current rating with a sparkline that opens the full curve / median duration) and a right coach-card column; the full-width rating-curve card is gone; the mistake notebook and long-term patterns merged into "what to practice this week"
- `4bc1954` Three fixes for the largely blank right column at 4K: a new **recent matches** card (last 8 rich rows, click straight into the report, rating deltas sharing the match-list algorithm); the "vs enemy comps" empty state offers a **rebuild index** button in place (no more pointing at the developer view; the main process gained single-flight protection against concurrent rebuilds); first/last value labels on the rating sparkline; the page width cap unified with the report at 1920

### Recording tab (three-tab workspace + playback linking)

- `1235c6f` The player switched to a custom control bar with the progress range clamped per shuffle round (native controls exposed the whole recording); `e045e3d` the event feed sizes its capacity by measured height instead of wall-clock fade-outs; `0fdfd69` AI results reliably reach the feed and marker strip; `2e0c5f5` three review fixes (including the CPU-spin guard when the recording is shorter than the round)
- `9672da3` Recording tab redesign: player plus a **battle timeline card** on the left (HP curves / gold bands / death ✕ from the same derives as the report; click or drag to seek), and a single right-hand card with three tabs (playback feed / all moments / AI findings)
- `4bc1954` Before playback the default tab is now "all moments" (the feed is inherently empty then); starting playback auto-switches to the feed; a manual choice always wins; enemy curves on the battle timeline are dimmed to foreground your team's health; the video area fills the remaining viewport with the timeline card anchored at the bottom

### Replay

- `b96dfda` Zoom semantics: the map scales while markers keep a constant screen size; `a51e1c2` the bundled arena background images removed (those PNGs contained no map, only the obstacles we already draw)

### AI analysis (multi-model comparison / auto-analysis / uncovered highlights)

- Multi-model comparison: `6cdcc80` slot-based analysis cache envelope v2 (slot predicate single-sourced); `44cde5f` per backend×model slot persistence; `5f273c5` a split arrow on the analyze button, "analyze with another model" (a temporary switch that doesn't touch the global default); `d8abf5e` slot tabs on the analysis panel; `e35870d` deep-dive follow-ups use the target slot's backend/model; `05a1e01` `6f01226` `6fa1dd9` three review rounds (end-to-end cache wiring / stale-slot placeholder / renderer production build fix)
- Auto-analysis: `616cf7e` a settings toggle "auto-analyze new matches"; `4002f51` live flag on real-time ingestion; `0b897fa` new matches queue for analysis automatically
- `5a3cc88` `4721f36` Uncovered-highlights card: a whole-match sliding window automatically finds high-density segments the AI never discussed, one click into window deep-dive; `f1041e9` three review fixes
- `acfa1a9` CC distance and "point-blank" definitions single-sourced between analysis and the verification gates — no more two sets of criteria

### Data and compliance

- `3b6aff1` Runtime dependency on the wowarenalogs CDN severed (icons via local cache) plus the data-compliance doc; `c840a19` game enums now generated from Blizzard's official DB2, resolving the license conflict; `0cb05ae` corpus collection gained an identifiable UA and download-side throttling

### Corpus tooling (not shipped in the product)

- Long-term PvP log archive pipeline: `92b26a5` the orchestration shell (scan feed / store compressed bytes / upload to Drive / dedup ledger); `134da14` pure-predicate archive planning; `1861bce` day-sharded ledger; `7b6813b` rclone parameters and success criteria; `0921704` run lock; `05da63b` `f8b3625` two review-fix waves; `b50af8c` layered download integrity checks

### Other

- Docs: architecture / predicate index / package READMEs / bilingual user docs `022d686` `54393d8` `c46fa3c` `9a0f321` `8baa85e` `0a6a1c7` `ace6334` `e44f959`; designs and plans `2f62ac2` `df9553d` `2342ef9` `84f8c08` `38fd5b6` `09ea325` `6d7bc7f` `26ff4e9` `5796b07` `54dfb64` `a165a63` `3c85408` `a87e5cf` `b156296` `393932a` `375725b`
- Visual baselines updated (CI-generated, human-reviewed): `a1f0f8a` `886ac7a` `b505e48` `04c1756` `ff37adf` `6ff6fce`
- Engineering: `84541b9` package-lock version sync; `b6663cd` `1e77b18` workspace dependency declarations and externalize fixes; `4e5171d` `2bf7a94` eval-side declaration consolidation and predicate-index anti-rot tests

## v0.1.16 (2026-07-31)

This release = the 17a+17b mitigation counterfactual suite (mitigation accounting and counterfactual reasoning added to the death recap card) + the full-week adversarial audit fixes (OBS recording / window analysis / key security and more) + the DeepSeek backend graduating.

### AI analysis (DeepSeek backend graduates / spell names and causal wording / local CLI stability)

- `eeb291e` New AI backend: **DeepSeek API** (official api.deepseek.com, models V3 and R1), now graduated (the content of the former v0.1.16-ds.1 test build); `04006af` a streaming reply that ends early is no longer silently truncated into a "normal" result; `c2f14e3` a decoder flush at the end of the stream, so trailing multi-byte Chinese characters aren't swallowed; `b824e72` the rule that spell names must keep their original English strengthened, suppressing DeepSeek's habit of translating them into Chinese; `c792076` timeout and stall watchdogs plus error-message redaction on the client, so a stuck request no longer waits forever
- `d9bfbfa` New detection for Chinese-ized spell names (spellNameZhLint): when the AI coach's text translates a spell name into Chinese it is caught automatically and restored to the original English; `1b48d39` `91f7d0e` `331895b` `8aa766b` four review rounds closing false-positive gaps (negation guards, hedge exemptions, gloss guards)
- `d249c3a` Causal-certainty wording detection (causalLint) gained Chinese patterns — production defaults to Chinese, so this had been a zero-coverage blind spot; `aed104d` `22eb6f2` two review rounds fixing missed negation guards (the single characters Un/No, false exemptions across clause boundaries, and other bypasses)
- `1ccfcab` `9d50192` Stop-word list for inline spell icons completed (common words like Heal / Push / Pull previously collided with spell names and had their icons stripped)
- `6213503` `22e3ac5` The cooldown-availability algorithm behind "defensive available at death and never pressed" extracted into a single predicate, with boundary fixes (a cast that only happens in the future is no longer judged "available at the time")
- `d4910f5` `1936e70` `e6d1b50` Three stability fixes for the local CLI backends (Claude / agy / Codex): multi-byte UTF-8 output no longer garbles across chunks, a failed version probe now says "the version may be incompatible", and in-flight analysis processes and requests are genuinely reaped when the app exits

### Report (death recap card: mitigation accounting / counterfactuals / icons)

- `2e00956` New spell mitigation reference table (two-layer generation + 35 whitelist entries curated by hand, with ambiguous spells annotated honestly rather than guessed); `c8ce5b0` the generation layer grounded in official SpellEffect data, so uncertain spells are marked pending rather than guessed; `8572bde` `322ffc2` `f7b0f38` three rounds correcting individual spells' mitigation judgments (Darkness, for instance, reclassified as conditional mitigation rather than none)
- `ac7a81d` The death recap card gained **mitigation accounting + counterfactual reasoning**: how much damage each mitigation you used actually absorbed, how much damage you took during immunity, and what would have happened had you pressed a defensive. The same arithmetic is written into the [DEATH] line of the AI analysis, so the card and the text agree by construction; `f97f06e` counterfactuals graded into three tiers (clearly survivable / marginal / still dies) with the judgment predicate single-sourced; `d335aee` `9f30824` a sixth tier for "avoidable death" + candidate judgments for questionable externals; `00950fc` counterfactual linking switched to matching on spell name + exact instant, so identically named spells no longer get attributed to the wrong occurrence; `4e5aad3` faction filter fixed + window constants single-sourced; `93627b0` `be34e8a` the death-settlement external table expanded 7→14 entries + two zoneId read fixes (including a line-of-sight regression test); `9b7410b` the six-tier annotation properly wired into the timeline branch (it was dead code in production and had no effect); `ddea0e5` the immunity accounting row reworded to prevent misreading
- `6d36798` Spell names on the death recap card switched to inline icons (previously only the AI analysis text had icons)

### Match recording (OBS reconciliation / exit safety net / retention policy)

- `8495025` After an OBS disconnect, the actual recording state is reconciled, eliminating the cascade of orphaned-recording failures; `0b8b98c` reconciliation now requires positive evidence, so it no longer stops a recording the user started manually in OBS; `05c5f82` the app waits for the recording to actually stop before exiting, otherwise OBS records forever; `199adec` "does it need a password" modeled honestly as three states, so a missing field is no longer read as "password required"; `811abc9` four recording-index fixes: match linking misjudgments, orphaned recordings crowding out retention slots, a disk usage leak, and some recordings never entering the index's visibility

### Window analysis (#16: cross-talk fixes / caching / retry)

- `2278430` `016c9ce` Two fixes for switching rounds in Solo Shuffle: the previous round's leftover window AI analysis is no longer rendered, and round-change state cleanup is now precise instead of remounting the whole component; `324f616` `db49a99` the window analysis cache honestly records the final state "the analysis genuinely found nothing", so reopening the same time window no longer pays for another model call (with three corrections: version stamp, backend-model criterion, and time-key precision); `22ed56d` clicking **Retry** manually now forces a fresh request instead of being blocked by that honest empty final state

### Settings and security (safeStorage / keys)

- `1748ee5` API keys on disk are now encrypted with Electron's safeStorage (they were previously plaintext in the config file); `afa63d3` saving settings only encrypts/decrypts the key fields this change actually touched, so saving an unrelated setting can't wipe an already-saved key; `bbf4a04` the agy local backend on Windows goes through the safe `.cmd` path, eliminating a local command injection risk from splicing prompt content into command-line arguments; `cf27f44` agy's on-disk directory narrowed to a dedicated subdirectory + cleanup of files left behind by a crash

### Data and tooling (corpus-tools; not shipped in the product, but it affects data quality)

- `187e4f3` fetch-pvp-logs corpus downloads gained bracket (BRACKET) validation + rate limiting on paged requests, to be a more polite client of the external API; `c9c463e` truncated downloads are now caught instead of contaminating the corpus via the manifest and dedup set; `7e8b8b3` out-of-repo backups gained a gitignore, and missing GCS metadata fields are modeled honestly; `f2d68c9` a warning is logged when the local corpus override file is corrupt — the silent fallback previously gave the user no clue why

### Other

- Mitigation table and 17a+17b design / plan / accounting docs: `514a3c5` `189367e` `7756c13` `288bfc7` `1b894f2` `baaf252` `6c1f8d1`; `01034bd` the #17b feasibility quantification report; `d111b87` the causalLint Chinese blind spot recorded; `c55c583` 10 P2 items from the full-week adversarial audit logged
- Visual baselines updated: `7c07e88` `c8b58a3` `901ee50`
- `04a82f6` release: v0.1.16-ds.1 (the DeepSeek test build, whose content graduates in this section)

## v0.1.16-ds.1 (2026-07-30, test build)

DeepSeek backend test pre-release, based on v0.1.15. It graduates once the real-model smoke test (enter a key, analyze one match) passes.

- `eeb291e` New AI backend: **DeepSeek API** (official api.deepseek.com, OpenAI-compatible streaming), models V3 (chat) and R1 (reasoner). Select it on the settings page, enter a DeepSeek key, and it works; with no key it falls back to the deterministic path. R1's chain of thought never reaches the output. Note: unlike the local CLI, this sends data to DeepSeek's servers.

## v0.1.15 (2026-07-30)

Phase 1 of information linking on the recording tab (i.e. the obs.6 test build graduating), plus corpus tooling and docs.

### Recording tab (graduated; details in the obs.6 section)

- `5969efa` Alignment marker bar (gold band = burst window, ✕ = death, ⚠ = mistake, click to seek) plus a playback event feed on the right (kill-feed style slide-in / fade-out / push-up; scrubbing does not replay skipped history; can be toggled off)

### Corpus tooling (not shipped in the product)

- `102eb1c` Archive fetch-pvp-logs output to Google Drive (incremental rclone sync + DRY_RUN + readable guidance when rclone is missing or unconfigured)

### Other

- `859c954` backlog #20, AI analysis chat box recorded; the merge and release engineering commits from `24f69f6` onward; the developer guide gained a "development dependencies" section (rclone as an optional dependency)

## v0.1.15-obs.6 (2026-07-29, test build)

Phase 1 of information linking on the recording tab (brainstorm options A+C, finalized), based on v0.1.14.

- `5969efa` New on the recording tab: an **alignment marker bar** below the video (gold band = burst window, ✕ = death, ⚠ = mistake, click to seek) plus a **playback event feed** on the right (kill-feed style: slides in from the bottom as playback crosses each moment, fades out after 5 seconds while the ones below push up; deaths / mistakes / bursts / crowd control / dispels / defensives, plus 🤖 deep-dive moments on matches that have been through AI analysis; scrubbing does not fire every skipped event at once; toggleable and remembered)

## v0.1.14 (2026-07-29)

Two lines converge: phase 1 of OBS match recording (five test builds obs.1–obs.5 converged, verified across five rounds on a real Windows machine) and three backlog features landed on main in parallel. The recording work is itemized in the obs.1–obs.5 sections below and is not repeated here; the main-side changes follow.

### Match recording (OBS, officially merged)

- Summary: automatic start/stop of recording, time-window linking, a dedicated recording tab, a synced picture-in-picture on the replay page, OBS auto-detection, sharing one recording across all six Solo Shuffle rounds with a clock reset on round change — see the obs.1–obs.5 sections for details

### Inline spell icons in AI text (#15)

- `edd2413` `4d59b5f` `cb91248` `58ccfef` Spell and spec names in AI analysis, comparison commentary, and finding cards render as icon + text
- `a6cfffa` `e06b632` `7e9cbcd` zhCN spell-name dictionary and an inverted index of English names (data layer)
- `4455689` `f79e90c` `0d36c01` Three fixes: possessive text missing a match, ultra-short placeholder names, first-paint rich-text self-healing
- `15795c1` `def748f` Visual baselines updated; `39fb7bd` datagen build number pinned

### AI analysis of a selected window in the report (#16)

- `c46c82d` `ee54ba4` New **Analyze this window** button on the time-window toolbar: drag-select any span and deep-dive it in one shot, with the final card attached under the toolbar
- `50c80c6` `8fb8375` `606117e` The deep-dive path parameterized with windowOverride, plus a window-mode prompt (neutral framing + an empty-output contract)
- `63d3c68` `c19cc42` `d1f743e` Review fixes for cross-window lost updates, stale responses, and the busy final state; `46d5977` `a051abe` test bed and baselines

### Pressure swimlanes on the timeline (#4)

- `1ea4397` `c10c38f` `0ea46f1` New thin pressure/exposure swimlanes on the Timeline: clicking a DMG SPIKE sets the window and feeds straight into window analysis; healer exposure markers enter the axis
- `f48d4e6` Three fixes from an all-branch review of the healer exposure orchestration; `0ad6134` visual baseline; `2767b3a` the TimelineStrip sync item investigated and written off

### Zero-config local CLI backends (separate)

- `eab287d` `5af87e5` Automatic path detection for the claude / agy / codex commands (Windows and macOS), with the detection result shown on the settings page
- `8686bd7` When agy exceeds the Windows command-line limit, the prompt is relayed via a file on disk automatically

### Analysis and infrastructure (separate)

- `c62f905` `562c988` The three divergent implementations of "available at death and never pressed" converged onto the single `cdAvailableAt` source (BACKLOG #18)
- `e32f095` F170 `[ENEMY HARD CAST]` wired up to castStartEvents (0/208 → 28/208 matches)
- `c837f73` `ce267ac` SP-B2.1: `reference_vectors.json` supports hot-override from userData, plus two review fixes
- `6eb3715` fetch-pvp-logs corpus tooling (corpus-tools, not shipped in the product); `bb545a3` compliance correction and backlog #19

### Other

- Spec / plan / accounting docs per feature and backlog status updates (`c6a173e` `9d8f432` `bbc8887` `e70779f` `6007500` `a6e38c2` `253fb55` `732f43b` `e626be5` and others); merge commit `24f69f6`

## v0.1.14-obs.5 (2026-07-29, test build)

Fourth round of real-machine feedback; otherwise identical to obs.4.

- `d1d6227` New **Auto-detect OBS** on the settings page — it reads the local OBS WebSocket configuration directly, fills in the address and password, and tests the connection, so you no longer have to copy the password out of OBS by hand. If the server isn't enabled, it tells you which box to tick in OBS
- `0a5b98a` When switching rounds in Solo Shuffle, the replay clock (and the video) stayed at the previous round's moment — changing rounds now resets to the start of the new round

## v0.1.14-obs.4 (2026-07-29, test build)

Third round of real-machine feedback; otherwise identical to obs.3.

- `a2c9bfe` New standalone **Recording** tab — a full-width native player (draggable, volume, fullscreen) that seeks to the start of this match (or this round, in Solo Shuffle) on open. Shown only for matches that have a recording. The synced picture-in-picture on the replay page stays, for second-by-second comparison against the combat timeline

## v0.1.14-obs.3 (2026-07-29, test build)

Fixes from the second round of real-machine feedback; otherwise identical to obs.2.

- `1cbcaf4` In Solo Shuffle only the first round could see the recording — the whole recording is now shared across all 6 rounds, and opening any round seeks to that round's moment

## v0.1.14-obs.2 (2026-07-29, test build)

Quick fixes from the first round of real-machine testing; otherwise identical to obs.1.

- `5be0fdf` **Test connection** on the settings page now uses the current contents of the input fields (it previously used only the saved values: typing a password and clicking test without saving first connected with an empty password and reported an auth error; the address field had the same problem)

## v0.1.14-obs.1 (2026-07-28, test build)

**Functional test pre-release** of phase 1 of OBS recording (driving OBS externally via obs-websocket), from the `feature/obs-recording` branch and not merged to main; it merges and ships as an official release once verified on a real Windows machine. It also carries the first batch of arenacoach analysis enhancements that landed on main after v0.1.13.

### Match recording (OBS, phase 1 test)

- `d40d873` `df70b55` Live awareness of match start and end: the recorder is notified automatically when a match begins (a stop signal is also re-sent on abnormal paths such as switching log files or directories)
- `435c7a1` `06a19c8` Connects to your own OBS install (28+, with the WebSocket server enabled) to start and stop recording automatically; the address and password are configurable on the settings page (the password is masked when read back). If OBS isn't running you just get a notice — match ingestion is unaffected
- `cb553b2` Recordings are linked to matches automatically by time, with a configurable "keep the last N matches" policy that cleans up old video
- `9fd72dc` `a0350e1` Play the local recording directly inside the report (scrubbing supported); recording stops automatically when the app exits
- `1675f68` New recording picture-in-picture on the replay page: synced to the replay clock, so the video follows when you jump to a death, a mistake, or an event
- `3c15987` `084106d` New **Match recording (OBS)** group on the settings page: enable/disable, address, password, test connection, retention policy
- `35829c2` Six fixes from cross-AI review: replay scrubbing past the end of the video pegged the CPU, a single corrupt line in the recording index lost the whole library, stopping the recording manually in OBS made it refuse to record subsequent matches, closing settings mid-match missed the stop, switching directories missed the stop, and the retention count was written to disk on every keystroke

### AI analysis (arenacoach batch 1, from main)

- `ea25e77` `99b67d8` New mistake detection: a defensive was available when you died and you never pressed it (with a separate judgment for abilities usable while under crowd control)
- `ce92a37` New mistake detection: your external mitigation was available when a teammate died and you didn't give it
- `40a1011` `127b711` New mistake detection: wasting the PvP trinket in a neutral situation (pressing the trinket when there is no crowd control to break)
- `4c45b29` Ability-availability judgment unified into a single predicate; defensive CD analysis refactored onto the same source
- `89dc8e8` The three detections above wired into the AI coach prompt and the mistake list
- `a95991e` `dca4b52` Five gaps fixed in dispel/death analysis (investigated from a viewer report on Bilibili) plus two review findings adopted (ownerId fallback, trinket event deduplication)

### Other

- `b7a15d1` `843e7bb` Type and static-check patches; `9337cef` corpus scan; `a3dbcac` settings page visual baseline update; `9e170bc` `5d74c52` `906a1cf` `72d2832` `644fd5f` `48c36b8` docs (evaluation / plans / backlog)

## v0.1.13 (2026-07-27)

Origin: user feedback that "clicking AI analysis one match at a time is too slow" — batch analysis added.

### AI analysis

- `b807b1f` Batch AI analysis: a new entry point at the top of the match list. Pick "the last N unanalyzed matches" and it runs the full analysis (including the deep-dive round), identical to the manual one, match by match — already-analyzed matches are skipped, progress is live, and you can cancel at any time. Navigating away to another report doesn't interrupt it.
- `b807b1f` Solo Shuffle is analyzed round by round, matching what you'd get clicking through the rounds manually; a round that was already analyzed on its own no longer causes the rest of the match to be skipped.
- `b807b1f` Cancelling the batch stops only the batch, and no longer affects a manual analysis that is running.

### Other

- `6ac67d7` New FAQ (aimed at new users), linked from the README.
- `02075bc` Match-list visual baseline updated (batch analysis entry point).

## v0.1.12 (2026-07-26)

Origin: a performance push (opening a match, the replay, and first paint all made faster) plus cross-match self-learning (new feature)

- Codex local backend plus three pieces of UI feedback.

### Performance (faster to open, lighter on memory)

- `ea8ef76` Opening a match: 1244ms → 37ms. The main process passes bytes straight through instead of materializing the whole object graph; main-process heap growth 207MB → 0.
- `b425718` Whole-library slimming migration: total match file size 75.2GB → 49.0GB (−35%), with old archives self-healing on read; the slimming predicate has one source.
- `bc6c8d7` Three main-process stalls eliminated: fetching raw log lines, importing history, and rebuilding the index are now streaming or pushed into a worker, so the UI no longer freezes.
- `eee7006` Steady-state replay rendering cost cut roughly a hundredfold: GCD swimlanes windowed, event table virtually scrolled (scrolling to the bottom no longer piles up a hundred thousand DOM nodes).
- `2d7ecc7` Replay sample lookup switched to binary search, and two memory accumulations that grew with playback duration plugged.
- `d8c1b97` Minification enabled for production builds (the 3.6MB bundle had never been compressed).
- `ee7ff92` `7b69443` `67ddc95` `331b1f1` Lazy loading and size reduction for the big data tables (spell names / talents / icons / effects): the main process and first paint no longer pay startup cost for tables they don't use.
- `bba4ed9` Report HP curves downsampled; hovering no longer rebuilds the curve paths every frame.

### AI analysis / cross-match self-learning (new)

- `cef6a85` `ef7da45` Findings from every AI analysis are recorded automatically in a local learning ledger, with historical analyses backfilled in one pass; the ledger is not invalidated by prompt version bumps, so memory accumulates purely forward.
- `a78ce4a` Deterministic pattern mining: a problem is only judged a "stable pattern" when it appears 5+ times in the last 20 matches with a stable distribution; conditional slices by enemy class and by map are supported.
- `78ae67e` `25c740e` The AI is only responsible for turning a statistical pattern into plain language, and the text goes through a placeholder-discipline audit (no bare numbers, no causal assertions); violations discard the whole entry.
- `5642ef4` `f2176f0` Consolidation service: it consolidates automatically once 10 matches have accumulated. The statistical part is always persisted, so a failed AI summarization only leaves the description text missing, and the next round fills it in.
- `0abbcfe` `23fea3c` A "recurring problem · N times in the last M matches" badge appears on report findings — matched deterministically by the rule engine, with no AI call.
- `88403a8` `6a2b6a5` `a4e571b` New **Long-term patterns** card on the statistics page: the rule list, active/improved status, frequency trend every 5 matches, evidence-chain jump into the report, and manual re-consolidation; it subscribes to backfill progress and surfaces consolidation errors.
- `9829abe` `97fd96a` Acceptance tool `learning:scan`: three-level numeric review across ledger, patterns, and rules, able to prove it isn't missing anything.
- `1efd7f4` Exceptions in the ledger write hook are isolated, so they can never affect the main analysis flow.

### Settings / AI backend

- `7d2792d` `a71a6c9` New local AI backend: Codex CLI (OpenAI gpt-5.5). No API key needed; it shells out to the local `codex` command. The clean reply is taken from the output file, and the empty-reply and concurrent-invocation edge cases are handled.

### Event table / statistics / report (three pieces of UI feedback)

- `82c39df` The statistics page widened to 1280px and centered (it was 900px pinned left, leaving half a widescreen empty).
- `82c39df` The spell column in the event table gained spell icons (including tick-aggregated rows), with no impact on row height or virtual scrolling.
- `82c39df` The death recap now lives only in its permanent slot in the report's right column: clicking a death marker in the replay or the events view switches to the report to show it, and the floating overlay is gone — no more duplication in two places.

### Other

- `3bfd9bc` `abc0e11` Design doc and implementation plan for the self-learning feature (including the cross-match key correction).
- `79a2e0c` `bb1a33b` `126df6d` Test/CI repairs: unused imports flagged by lint, pre-warming the deepDive module on slow CI machines, removing temporary artifacts committed by mistake.
- `a3d72b3` `9d3da81` Visual baselines re-recorded for the event table windowing, statistics centering, event icons, and the Codex copy on the settings page (generated from a single CI source, reviewed image by image).

## v0.1.11 (2026-07-26)

Origin: empirical user feedback — a Holy Priest was told off every match for "not using Desperate Prayer", but matches where they were never attacked should never have raised it.

### AI analysis / mistake list

- `af248a1` "Defensive CD unused all match" gained a pressure gate: it only fires when the lowest HP of the entire match was <60% (empirically, across 12 Holy Priest rounds: the 8 falsely flagged rounds all bottomed out at 70–94%, while the rounds where a defensive was genuinely pressed bottomed out at 9–52%; under the same criterion, false positives went 8/12 → 0/12). The mistake list and the AI prompt share one source, so clean matches where you were never attacked no longer show this entry and the AI no longer lectures about it. Matches with real pressure are unaffected.

### Other

- `055414d` `d97a657` Supporting fixes: in-source tests adapted to the new signature; battle/synth visual baselines re-recorded to follow the gate (human-reviewed to confirm it works both ways: the low-pressure row disappears, the high-pressure row stays).

## v0.1.10 (2026-07-26, re-published same day)

Origin: the death recap visualization upgrade (v2, finalized) + a developer-page scale fix + interaction repairs + a test coverage push (six tasks). The first publish carried the v1 two-column curve; based on feedback it was reworked to per-row health bars and re-published the same day, so assets share a name but differ in content.

### Replay / report

- `3d52ce2` `60a541a` `c4f5d98` Death recap upgraded: every row is now "ability + number + health bar", where the bar draws the health interval before → after that ability took effect — red = health lost, green = health gained, hovering shows "82% → 61%". Damage numbers are red, healing green. The before/after health is exact to the event (the same-timestamp sample from the advanced log); the column is left blank on old logs that have no advanced data. (The interim v1 two-column curve was superseded by v2.)
- `85ce27c` AI analysis key-moment axis: "+N minor moments" can now be collapsed again after expanding (previously there was no way back).

### Developer page

- `4d3d96a` The detail preview is capped at 256KB: it previously rendered the entire match JSON with no limit, and a real 25MB match in the library froze on click (>30s unresponsive → 501ms). Over the cap it shows the full size and the file location.

### Other

- `477f473` `64011c6` `460c3ee` `f5d3055` `3df3e1e` `b359bf9` Test coverage push: tests added for four analysis context files and the eval auditor (criticalMoments 7.61%→83%, timelineSections 53%→98%, resourceSnapshot 58%→92%, judgeSpotAudit 0→100%), plus coverage measurement infrastructure (`npm run coverage`).
- `fec622d` `7b003b9` `2dee06f` Visual baselines re-recorded across two rounds of the death recap rework (both human-reviewed); E2E navigation switched to exact matching, fixing a race where it collided with a substring of the recap card's button.
- `8fb4869` `eb7c43c` `c19bf25` `ab2f1d7` `f56e6b6` Docs: the coverage-improvement plan backfilled at close-out, the death recap v1/v2 designs and implementation plans, and CHANGELOG infrastructure plus the retroactive entries for v0.0.1–v0.1.8.

## v0.1.9 (2026-07-25)

Origin: full implementation of the external review "adjustment-plan.md" (adopted after an agy debate, with five corrections) plus the category enumeration as a separate task.

### Event table

- `4d4f9ab` Death-cleanup folding (≥5 consecutive "− lost" rows on the same target fold into one aggregate row, with a "death cleanup" chip if a death occurred within ±1.5s), periodic tick aggregation (≥3 consecutive from the same source and spell → ×N summed); sticky header and self-contained table scrolling; the "show 300 more" button replaced by near-bottom scroll loading with automatic page filling; kind filters replaced by pills (color dot + count); p95 micro-bars on damage/healing amounts, color-coded; death rows highlighted with a "▶ death recap" shortcut.

### AI analysis

- `f22776e` The key-moment axis became two-tier: deaths and bursts keep full pills, while defensives, dispels, and crowd control drop to small text rows; same-kind same-side bursts within ≤5s fold into "{kind} ×N"; past 40 entries a "+N minor moments" valve appears; icons unified to text glyphs (no emoji); severity mapped to Chinese (high/medium/low); evidence chips gained short event-name labels.
- `877c77d` `category` narrowed from a free-form model string to an eight-slug English enum (prompt constraint + normalization in the audit layer + aggregation on the normalized key), with a Chinese vocabulary on the render side (survival / cooldown usage / positioning / target selection / crowd control / interrupts / dispels / offense). Real-model smoke test: enum compliance 9% → 100% (6 matches, sonnet, Chinese replies). Cross-match aggregation of the mistake notebook is stable from here on.
- `168af31` (part of P3-1) Cohort card: a single dimension no longer renders "strongest/weakest"; percentile wording unified to "Nth percentile · above/below the median of this bracket"; specs in Chinese (a 42-spec vocabulary), and "sample: N matches".

### Report

- `c5e3f33` The interrupt / dispel / burst ledger / mistake list cards keep their frame on empty data plus a one-line empty-state message (0 mistakes shows "clean match"); aura uptime grouped by unit (group header in class color + indentation + expand past the top 6) plus 0:00/mid/end ticks and a category legend; severity filter chips on the mistake list (minor hidden by default past 12 rows); opening the death recap in the report auto-expands the most recent friendly death (dismissing with ✕ stops it reappearing for that match); an HP curve legend row (click = hide curve), ⚠ markers closer than 8px clustered into ⚠N, and death labels anchored left to avoid adjacent ⚠ markers; the W/L pills in the Shuffle report header double as round switching (R{i}·W/L, keyboard accessible), replacing the separate Round tabs row.
- `168af31` (part of P2-2/P3-2) Graded abbreviation of meter values (1.54M / 568k, with the exact full value kept in the title, same spec in the treemap details); duration chip and kill-result chip at the end of window list rows.

### Replay

- `00a2efd` Name labels on the map shown on demand (rendered only on hover / HP<50% / during a burst) with a black-outlined backing plate and automatic lift to avoid neighbors within 70px; a "standard/compact" setting for the GCD swimlanes (compact = 88px column width, chips reduced to icons only, remembered in localStorage) plus gold kill-window jump chips below the swimlanes (clicking seeks both columns on the shared clock); the two-line shortcut/legend text at the bottom moved into a ? button at the right end of the control bar.

### Global

- `fddbf13` Spell names unified across the app: five `getEnglishSpellName` call sites in the render layer replaced by the single `displaySpellName` source (the log's own name passes through, and only an empty one falls back to the dictionary). English dictionary names in CN matches: 1299 occurrences → 9 (all remaining ones are verbatim from the log).

### Other

- `51e875f` `4f32916` CI fixes (empty-state assertions inverted to follow the new behavior, chip fallback, a file that wasn't committed).
- `5e5a2ca` + `51e875f` include: seven of nine visual baselines re-recorded (reviewed image by image).
- `d888619` Session write-up docs (the prod-triage skill and others).
- `049d6c4` Release bump.

---

Everything below is **retroactive** (generated from git history on 2026-07-25: each version = `git log v<prev>..v<new> --oneline --no-merges`; versions with more than 40 commits list only feat/fix/perf, omitting chore/docs/test/refactor and so on — see git log for the full set).

## v0.1.8 (2026-07-25)

- `f5e63fd` release: v0.1.8 — GCD swimlane folding (one row per instant + small off-GCD icons, user's design)
- `b302351` chore(qa): visual baselines — regenerated for the folded swimlanes (human-reviewed: same-instant folding into one row, small off-GCD icons, gold trim on majors)
- `0751bf4` feat(desktop,analysis): GCD swimlane folding — multiple abilities at the same instant collapse into one row, off-GCD actives fold into small icons (user's design)

## v0.1.7 (2026-07-25)

- `70585a9` release: v0.1.7 — GCD swimlane re-axed: exact alignment to the instant (mean drift 15.8s→0), overlaps stepped horizontally
- `a89c46f` chore(qa): visual baselines — regenerated after the swimlane re-axing (human-reviewed: exact alignment, readable stepping)
- `7d75573` feat(desktop): GCD swimlanes re-axed — vertically pinned to the real instant, overlaps stepped horizontally, drift 92%>0.5s (mean 15.8s) → 0

## v0.1.6 (2026-07-25)

- `6783147` release: v0.1.6 — aura dashed-inference correction (phantom full-match dashes eliminated) + a latent CC duration data bug fixed
- `39bad78` chore(qa): visual baselines — uptime cards regenerated after the aura dash fix (battle/window, human-reviewed: the phantom full-match dashes are gone)
- `1af0d55` fix(analysis,desktop): aura dashed-inference correction — dual sources keyed separately / DOSE opens a segment / capped at the official duration, plus a latent overrides empty-shell bar-squash bug

## v0.1.5 (2026-07-25)

- `747ff60` release: v0.1.5 — Bloom false-positive fix / icons missing 89%→0.05% / DR table taken from official data / dispel fallback dual-evidence cleared
- `183fc23` chore(qa): visual baselines — Bloom-class genuine presses regression + full icon-name resolution, report-replay regenerated (human-reviewed)
- `92a91cd` fix(analysis,eval): icon universe finalized — union of three sources at 1.5MB, no coverage loss (0.05% missing), within the first-paint budget
- `028e625` feat(analysis,desktop): three items closed out — Bloom false-positive fix / icons made exhaustive, 89%→0.05% missing / DR table taken from official data (which caught 2 misjudgments + 1 silent failure)

## v0.1.4 (2026-07-25)

- `210a884` release: v0.1.4 — swimlane endgame gate (Devour/Phantom cleared, 5.3% folded, 0 false positives) + the official 17-pair PvP replacement table
- `2267f7e` fix(desktop): swimlane gate endgame — keep by default + layered veto, false positives eliminated, 5.3% folded, Devour/Phantom cleared
- `cef7d32` feat(analysis,desktop): homemade data replaced by official data — PvP talent replacement table (17 official pairs) + a player keypress table (swimlane junk eliminated, folding 44.5%→1.9%)

## v0.1.3 (2026-07-25)

- `d883607` release: v0.1.3 — doc slimming (−39%) + self-healing migration on read, fixing the 2GB+ memory climb (and clearing out temporary scripts committed by mistake)
- `0f7196b` fix(parser,desktop): doc slimming — a 442MB single match / 2GB+ memory incident, params sparsified for −39% + self-healing migration on read

## v0.1.2 (2026-07-25)

- `beb926a` release: v0.1.2 — GCD swimlane noise filtering (folding 44.5%→10.5%) / cast queue tolerance / Scorching Gaze replacement / illegal placeholder hole plugged
- `927c4eb` chore(qa): visual baselines — report-replay regenerated after swimlane noise filtering (the other 8 byte-identical, human-reviewed)
- `43d22c6` fix(desktop,analysis): GCD swimlane junk casts folding real abilities / cast queueing falsely counted as kicked / PvP talent replacement not modeled
- `070c923` fix(analysis,desktop): three agy flash review findings adopted — illegal placeholder hole plugged / silent retries / facts key namespace contract

## v0.1.1 (2026-07-25)

- `1cbbe1c` release: v0.1.1 — fixes for "only 2 entries / malformed output": index placeholders + a larger max_tokens + bad-json retry; includes the production verification driver
- `9ca89e8` fix(analysis,desktop): two symptoms from 0.1.0 production feedback — "only 2 entries" and "malformed output"

## v0.1.0 (2026-07-24)

- `4b744c1` feat(analysis,eval): solvability confidence gate — corpus-verified rate for missed-cleanse/purge claims 92%/79% → 100%/100%
- `f5a7f54` feat(analysis,desktop,eval): evidence menu widened — healer perspective 3.4→8.6 entries per match, three-phase coverage 0/17→11/17
- `2fff58a` fix(qa,desktop): path-4 assertion basis corrected — the off-screen window starts at 500 tall, so only >600 actually proves full-page capture
- `e05c1e5` chore(qa): visual baselines — a new "export image" button on the report toolbar, 3 report-* regenerated
- `a9569dc` feat(parser,desktop,eval,docs): the remaining four verifiability roadmap items closed out — B2 raw line-number deep links / trust chain e2e / B3 coverage wiring / C3 image export
- `af5cd37` chore(qa): visual baselines — UI changes from df2789c (time-window bar / mistake card / uptime / events view), 4 report-* regenerated
- `473101d` feat(eval,docs): B1/SP-A.1 causal judge calibration closed — causal-hardening detection 50%→80%, five verifiability roadmap items closed out
- `df2789c` feat(parser,eval,desktop): verifiability roadmap A2/A3/C3/B2 landed
- `95b8581` docs(backlog): #8 deterministic mistake detection v1 closed (release/0.1)
- `6af9185` chore(qa): visual baselines — phase 4 items ④②③ (mistake list / ⚠ markers / aura uptime / events view)
- `c59ba8c` feat(desktop,analysis): aura uptime + events view + deterministic mistake engine — phase 4 items ④②③ landed
- `ccd9e72` chore(qa): visual baselines — time-window toolbar (battle/synth) + a new report-window selected state
- `04cdabe` fix(desktop): TimeRangeBar echo tolerance raised to 1s — the band's true value 36.734 vs. the rounded label 36
- `b9a3142` fix(desktop): the TimeRangeBar phase dropdown echoes by tolerance matching — band bounds carry fractional seconds
- `5c29c2b` test(desktop): report-window visual scenario — the time-window selected state enters the baseline
- `e1be96d` feat(desktop): time-window linking — phase 4 item ① WCL timeframe/phase interaction landed
- `14e414a` chore(release/0.1): open the major version branch — version bumped to 0.1.0 + phase 4 design finalized

## v0.0.18 (2026-07-23)

- `2cd5595` release: v0.0.18 — interrupt/dispel dashboards, comp and date filters on the list, enemy trinket inference + 7 discrete CDs for missed dispels
- `dc06585` chore(qa): report-synth baseline updated — the fully-populated panel enters the baseline (the other six byte-identical)
- `78b9ac5` test(desktop): synth fixture injects an interrupt hit + a missed purge — visual baseline covers the fully-populated panel
- `bb85992` docs(backlog): #2/#3/#9 closed + zh/EN switching verified as already done
- `0ba6cca` chore(qa): visual baselines regenerated — interrupt/dispel panels + the comp and date dimensions on the filter bar
- `793e127` fix(desktop): the date group in the filter bar packed as an unbreakable unit — the separator no longer orphans when a narrow sidebar wraps
- `fc2c73b` feat(desktop): list filters gain comp (multiple specs on one team) and a date range — backlog #9 wrapped up
- `f145aaf` feat(desktop): interrupt/dispel dashboards — backlog #2/#3 landed together
- `3746c55` feat(eval): §7ter enabled + templateDuplicateRatio given its own tier — two eval decisions landed
- `6949e20` feat(analysis): an enemy trinket never observed being used is inferred available + 7 discrete active CDs added for missed dispels — two product decisions landed
- `08dcf63` docs(backlog): Layer B three-fix re-review closed — before/after numbers complete + the noise re-anchoring side effect logged pending a decision
- `65c791d` feat(eval): the sufficiency coverage gate adjudication landed + a blindPool matchId placeholder convention — 14.2/14.4 closed

## v0.0.17 (2026-07-22)

- `580b4e4` release: v0.0.17 — DMG SPIKE start/end timestamps, monk interrupt spec routing, eval rubric basis fixed
- `d243f4b` fix(analysis,eval): three real bugs dug out by the 300-match Layer B evaluation — DMG SPIKE start/end ambiguity / monk interrupt misjudgment / a gap in the noise basis
- `6a5a905` docs(backlog): 14.2/14.5 closed — stale status and one overturned old conclusion fixed
- `cd21b15` docs(handoff): §1 wrapped up — 6/7, Layer B can start
- `22af6fd` docs(report): all 80 items re-scored after the cap was fixed — 4/7 → 5/7 → 6/7, more headroom
- `d39b34b` fix(eval): the 12-entry cap on the audit set was eating trailing fabrications — raised to 20 and, past the limit, takes both ends
- `c0bd0d2` feat(desktop): CLI for bulk backfill of historical logs — with a disk guardrail
- `b269b90` docs(handoff): §1 completed with the full 7-dimension results — 5/7 met but fix the 12-entry cap first
- `eaa2af1` docs(report): §0 scope corrected — scores-det2 is already all 80 items, not 30
- `9f583be` docs(report): full 7-dimension verdict — 4/7 → 5/7 met, but fragile and with one rule artifact
- `0df6532` docs(handoff): §1's hard todo closed — points at the 2026-07-21 verification report
- `277e80d` docs(report): third round of rubric validation — anchor noise eliminated, fact-checking misses unchanged
- `4ded221` feat(eval): the judge variance criterion hardened into a script — the primary criterion is now "the set of errors found"
- `30bd91b` docs(handoff): full takeover instructions — judge variance is the only hard todo, and the two product decisions must not be made on the user's behalf
- `a80f3f6` docs(report): stale status removed from the survey doc — the §1 table and §3 both still said "not checked"
- `aa1d5e4` docs(report): full numbers for the missed-dispel fix — 822 → 2251 rows, all gates green with no losses
- `0294de7` docs(report): root cause of missed and folded dispels — 73% of the "77% empty" is correct silence
- `2f1954c` fix(analysis): 7 of the 9 entries in the missed-dispel whitelist were dead — the three paladin blessings added + a consistency assertion
- `737e39c` docs(report): item-by-item conclusions from the four-item survey — P1 fixed, P2/POSITIONING need no action, P3 left for a human
- `bf17ccf` feat(analysis): enemy ability groups share a source with friendly ones — closing the evidence gap in 65% of matches
- `329589d` docs(report): evidence gap survey — enemy cooldowns entirely untracked in 65% of matches
- `9e257f1` docs(handoff): judge variance and the Layer B blocker — there is a real todo
- `3d92ba3` docs(eval-baseline): accuracy anchors switched to a lookup table + numeric claims must be written side by side with the value
- `5e9415e` fix(eval): factAudit length convention relaxed to [3,12] + 14.5's unproven result recorded honestly
- `cca541c` docs(eval-baseline): the factAudit audit set is now rule-determined, and accuracy is scored only against that set
- `f8a74cd` docs(backlog): n=10 calibration finalized — 14.2 weighted up, 14.5 added (accuracy judge variance)
- `6f267ec` docs(backlog): 14.2 corrected — the 20% had suite defects mixed in; the real blind spot is 2/5
- `8713a6d` docs(eval-baseline): three operational criteria for accuracy — treating the leak, not just restating the principle
- `751f6bc` fix(eval): calibration specificity check exempts dimensions coupled by construction + the report names the drifting dimension
- `92f96d2` fix(analysis): the [RES] snapshot under a death anchors to the moment of death, no longer taking T-3s
- `4997308` fix(eval): the cooldown ledger gate now decides with attribution — eliminating 67% false positives
- `2967959` fix(analysis): the [HEALER CC] caster label switched to the shared `actorLabel` predicate

## v0.0.16 (2026-07-20)

- `29d1d57` release: v0.0.16 — prompt self-contradictions eliminated + a model dropdown + assorted replay/map fixes
- `00234cc` docs(backlog): 14.1 marked fixed, and its incorrect root-cause guess corrected
- `11a677e` chore(qa): report-replay baseline regenerated — the map background switched to a fixed stub
- `68635d3` test(visual): the stub background switched to asymmetric corner marks, with the center left empty
- `f6dce47` docs: two handoff docs archived as one retrospective on completion, moved into docs/reports/
- `a4d2e87` docs(handoff): stale and redundant content removed
- `65f795c` docs(claude): added the "a fix must come with before/after numbers" verification rule
- `50deb8f` docs(backlog): the four 2026-07-20 eval/QA leftovers recorded
- `13d656e` docs(handoff): two leftover todos marked done
- `258dcdc` docs(eval-ab): compute the MDE before starting — to avoid another A/B that can't measure anything
- `0eeabb2` feat(eval): class-D cooldown ledger contradictions added to the standing gates
- `637ebd8` docs(handoff): blind A/B wrapped up — all seven dimensions inconclusive, ADOPT on deterministic grounds
- `665346a` docs(handoff): blind A/B continuation handoff — stuck on the subagent quota, 6/100
- `710ed5f` docs(handoff): class-D conclusion corrected — the first judgment was wrong
- `c820ad4` fix(analysis): the real class-D root cause — one ability with two cooldown values (correcting the earlier wrong conclusion)
- `8f48174` fix(analysis): missed-dispel rows switched to fmtTime for the timestamp — the last bare-seconds timestamp
- `0a193b0` docs(handoff): all 8 classes handled — with the rationale for deleting the two-tier radius and the class-D conclusion
- `dbe61bd` revert(analysis): the two-tier HP sampling radius removed — it was built on a disproven root cause, and it was harmful
- `7c7e9f6` docs(handoff): thousand-match re-verification results + the confirmed and unproven parts of class D written separately
- `1f33b04` docs(handoff): updated to 7 of 8 classes fixed — including the main lesson, "ask whether it's the same instant first"
- `23de9f5` fix(analysis): class I — the damage figures in OFFENSIVE WINDOW didn't match the displayed interval
- `be36279` feat(analysis): class F — DR annotations added for CC the player cast themselves
- `cd60380` fix(analysis): class H duration self-contradiction + E/G notation legend made consistent with the window basis
- `f42fca1` fix(analysis): class C same-second HP contradiction — the third HP sampling path eliminated
- `0e13264` fix(analysis): the real class-A root cause is the render grid, not the sampling radius + class-B percentile inversion
- `a8afe37` docs(handoff): class-C root cause and the list of call sites still to change
- `3cd5342` fix(analysis): HP sampling radius converged to a single-source predicate — fixing same-second HP self-contradictions
- `9b8e40d` chore(qa): report-replay / settings visual baselines regenerated
- `18d5fad` chore(qa): one-command presubmit gate + a model output shape audit tool
- `43c6e2e` feat(report): map-only layout height adjustable + spell icons on finding chips
- `132b3da` feat(ai): model dropdown + `--model` passed through to local backends; fixed fenced output being misjudged as bad-json
- `2159889` fix(replay): the opening position blind window is labeled "position unknown" instead of being drawn as a known position

## v0.0.15 (2026-07-20)

64 commits in total; only feat/fix/perf listed below (32):

- `e44814d` fix(qa): the webServer criterion extracted into a tested pure function; report-ai anchors tightened
- `9e952bd` fix(test): the split-pane cases clear localStorage explicitly — fixing state leakage on CI
- `ac5a2d1` perf: big JSON goes through JSON.parse — cold start 25s→2s, first paint 24s→0.8s
- `7c14f5a` fix(qa): the two "the gate looks like it's guarding but can't actually stop anything" cases from the final review closed
- `3ba8014` fix(replay): the hint bar gained Ctrl+wheel / draggable splitter + two degenerate CSS rules cleaned up
- `66acec0` fix(visual): threshold 0.2→0.05 — the default tolerance was letting through color changes at the same brightness
- `75b27f1` fix(visual): tolerance switched to an absolute pixel count — the 1% ratio was letting a genuine color regression through
- `de40f09` fix(replay): the splitter gained pointercancel / exact pixel conversion / keyboard accessibility
- `76778b5` fix(e2e): unit tests added for resolveJumpTarget + openAiView promoted to a shared helper
- `5ac8c92` feat(main): GLADLOG_E2E userData redirection — E2E runs on temporary state
- `4ac00ae` feat(replay): a draggable splitter between the map and the GCD swimlanes
- `884f28e` fix(parser): the unimplemented `rounds` parameter removed from synthArenaLog
- `f483483` fix(fixture): `analysis.getState` added — the AI view really does render findings under the fixture
- `165a178` feat(replay): three layout modes (GCD-only added), lifting the 560px hard cap on the map
- `e3aa811` fix(replay-zoom): orphan CSS cleaned up + test coverage added
- `6698482` fix(visual): per-test timeout raised to 120s + the port genuinely single-sourced
- `004118b` feat(replay): zoom buttons float over the bottom right of the map
- `4b56c7c` fix(replay): once in the zoomed state, a bare wheel also takes over map zooming
- `0c67fa0` feat(replay): split-ratio state and clampSplitRatio
- `f07d7d9` feat(dev-ui): dashboard / settings / list scenarios — the app shell enters visual regression too
- `c7c07ba` feat(dev-ui): `?scene=` scenario routing — a deterministic entry point for visual regression
- `c72563c` feat(report): MatchReport supports initialView — views are reachable directly by URL
- `43f4b65` fix(deepdive): STAYED_IN must cost something real before it opens the deep-dive gate — criterion and formatter share a source
- `90a1e36` fix(desktop): getFlags gained a cancelled guard — old match markers no longer bleed across when switching matches
- `624952c` fix(analysis): target-death truncation takes the earliest one, without relying on deathRecords being ordered
- `8a37def` fix(desktop): generation entries reclaimed — but only once that match is completely quiet
- `1da25f9` perf(report): GcdSwimlane layout memoization actually takes effect — the dependency array switched to stable identities
- `5845f95` fix(deepdive): the placeholder regex comes single-sourced from claimChecker — no more each-writes-their-own
- `d4bf4b4` fix(desktop): panel remount switched to a single atomic getState — eliminating the "the result fell through the crack" race
- `ce33ef9` fix(desktop): deepen idempotency guard — navigating away and back no longer burns another deep-dive round of tokens
- `536295c` fix(deepdive): focusT anchors to the last anchor, rather than being derived backwards from a clamped anchorTo
- `b7a7746` fix(desktop): running-tracking leak prevention (found in a concurrency re-review) — the stored generation is cleared by owner identity, and abort clears it too

## v0.0.14 (2026-07-19)

- `1985247` release: v0.0.14 — AI analysis no longer lost when navigating away + a prominent button when unanalyzed
- `047b5c0` fix(desktop): AI analysis no longer lost when navigating away + a prominent button when unanalyzed

## v0.0.13 (2026-07-19)

- `0b918a8` release: v0.0.13 — the deep-dive round (automatic follow-up questioning) covers death / positioning / offensive mistakes + the mistake notebook
- `a81fc4c` docs(eval): stale comment corrected, five classes → four (juked-kick removed)
- `6fbb4f9` test(eval): large-scale cross-AI A/B on offensive deep dives + the weak juked-kick type removed
- `bdaf493` test(eval): deterministic scan of offensive deep dives + a scan-driven immunity gate correction
- `1c85e9b` feat(deepdive): the renderer guarantees an offensive deep-dive slot (survival≤2 + offensive≤1)
- `ad3aaac` test(deepdive): assert a survival-only pack doesn't print the offensive legend (locking the gate condition)
- `a477911` feat(deepdive): classifyFindingKind dispatch + an offensive legend in the prompt + PROMPT_VERSION 12
- `0b6d8df` fix(deepdive): offensivePackItems compares roles by full name + an inWin guard added to burst-start entries
- `76eed3c` feat(deepdive): buildOffensiveDeepDivePack + the pure mapping core offensivePackItems
- `c2ebd37` feat(deepdive): the offensive signal gate hasOffensiveCoachableSignal + PackItem kind extension
- `b073b94` docs(plans): implementation plan for offensive deep dives (deep-diving non-death findings)
- `b1035bf` docs(specs): design for offensive deep dives (deep-diving non-death findings) + backlog #13
- `c55929d` test(eval): eval harmonics for the value of positioning signals — blind generation + reconstruction audit
- `11b5b51` feat(deepdive): a fourth signal class, positioning mistakes — closing the "died to positioning" gap that resource signals can't see
- `10c5112` test(eval): per-spec signal decomposition — diagnosing the root cause of gate-pass rate differences (structural vs. coverage gap)
- `e66fe81` test(eval): large-sample robustness scan of deep dives + a prompt A/B tool
- `f379503` feat(analysis): deep dive fixes 1+2 — a coachable-signal gate (defensive early/late / ≥3s hard CC that should have been traded and wasn't / a dispel colliding with an enemy CD, with the gate moved to the caller) + owner anchoring and role labels + clean windows left blank; PROMPT_VERSION 10
- `cf1ccfd` fix(analysis): deep-dive prompt discipline corrections (eval-driven) — the phantom `units` field removed + HP split into per-checkpoint placeholders + realm digits stripped from short names in facts; PROMPT_VERSION 9
- `59a75be` test(eval): deep-dive quantification script — evidence yield (model-independent) + a discipline smoke test (generation and audit, two stages)
- `858c46f` feat(analysis+desktop): the deep-dive round (automatic follow-up questioning) — deterministic evidence packs expanded for high-severity findings ([anchor−30,+10] crowd control / defensives / enemy CDs / HP trajectory / dispels) + the second-round narrative audited by claimChecker + causalLint + evidence chips that jump into the replay; PROMPT_VERSION 7
- `cdb28cb` feat(analysis): death-setup cause-chain candidates — events preceding a death, traced backwards (healer-locked / trinket-early / defensive-early, with predicates mirroring death-trace) + a chain legend in the prompt and a cap on death anchors + max_tokens 4096 + PROMPT_VERSION 6
- `f1fcc04` feat(desktop): the mistake notebook — cross-match findings grouped by type (a main-process notebook service + an embedded expandable card on the statistics page: meta / marks / open that match)
- `60392b1` docs(skills): the agy-review skill (output truncation traps + adoption criteria) + desktop-dev gate switched to whole-repo lint + the cd trap
- `7608d72` docs(skills): the release skill — tag-driven build/overwrite procedure + asset verification + the list of traps

## v0.0.12 (2026-07-18)

- `4f57f87` feat(desktop): replay map-only / GCD layout switching (remembered in localStorage) + AI call debugging on the developer page (the last 10 prompts and responses, in memory only, never written to disk)
- `1690a2e` feat(desktop): cohort score bars visually enhanced + AI analysis and comparison merged into one button (linked via runSignal)
- `2cdf2d6` feat(desktop): 0-finding explained by cause — fallbackReason (no candidates / AI not configured / bad JSON) + a Chinese message replacing the English placeholder when everything was discarded by the audit
- `7616a5c` release: v0.0.12 — first load made faster (WeakMap memo / worker parse + LRU / bundle split 19MB→2.1MB) + tabs moved left
- `f35ee7a` chore: the two actionable items from the external review landed — a timeline spec tag unit test + a comment on the iconCache caching strategy
- `7fa954d` feat(desktop): tab positions adjusted — the view tabs in the App top bar and the report page header moved left (user feedback), pushing win/loss + meta to the right
- `783657b` fix(desktop): matchStore probe test console.log→warn (whole-repo lint on CI)
- `d4c6342` perf(desktop): bundle optimization using top-level await dynamic imports for spellNames and talentIdMap
- `52e965f` perf(desktop): parse match file in worker thread and implement LRU cache
- `85474e6` perf(desktop): memoize toLegacySafe with WeakMap to speed up first load
- `c918779` docs(plans): first-load speedup brief — a measured end-to-end baseline + three approaches (memo / worker parse / bundle split)

## v0.0.11 (2026-07-18)

- `7cda727` release: v0.0.11 — whole-app UI redesign (accent night-blue language / report timeline spine / framed panels on both sides of the replay / score bands) + spec icons on the minimap + cohort turned into scores
- `f8b6301` fix(desktop): redesign review corrections — rating sources compared like for like (CR and MMR not mixed) / current-rating baseline guard / follow-up marks require evidence / replay cursor projection (reported on unmount) / death recap card 1c styling / role chips as accent pills / CSS deduplication (7 agy flash review findings)
- `930ca53` feat(desktop): UI redesign P7, report 1c — single-line header with tabs on the same row / 240-tall curve card with death circles / clickable window list rows / meters | death recap as two permanent columns / class glyph squares in the meters
- `d618d9f` feat(desktop): UI redesign P6, replay 1f — frames flush against both sides of the arena / control bar rearranged with shortcut hints / 5s separator bands in the swimlanes + a cursor badge + accent chips on majors
- `0ffef99` feat(desktop): UI redesign P5, AI analysis 1g — action area pinned to the top with a status line (MatchHero removed) / the moment axis on a single left rail / findings turned into labels / cohort distribution bar with a cursor (verdict text keeps its faithfulness anchoring)
- `813b8ea` feat(desktop): UI redesign P4, statistics 1h — an overview number band (current rating / derived change) / axis ticks, endpoint annotations, and a legend on the curve / composition win-rate bars / problems as rows
- `c6c4792` feat(desktop): UI redesign P3, match list 1e — win/loss line on the left edge / rating change / date group headers with a daily summary / HH:MM / the filter bar unified
- `08a65a2` feat(desktop): UI redesign P2, settings 1i — three-column grid / unified inputs / "configured" pills / in-place save feedback / backend description lines
- `003a1e9` feat(desktop): UI redesign P1 — accent tokens / Inter / two tiers of tab shape / interaction gold → accent (data gold kept: kill bands / never-pressed / CC text / kill chips / recent GCD)
- `d2070f2` docs(specs): UI redesign handoff archived (all of 1c / 1e–1i + accent tokens)
- `0fd5605` feat(desktop): cohort panel turned into scores — a single source for direction-corrected scoring (METRIC_LOWER_IS_BETTER) + score bars + a deterministic summary line (overall / strongest / weakest)
- `1d9f1af` feat(desktop): spec icons overlaid on units in the replay (CDN, following the list's precedent, falling back to the class glyph on failure)

## v0.0.10 (2026-07-18)

- `85ecb67` fix(desktop): replay UI review corrections — smoothPath endpoints / x clamping, frame death judgment switched to the deathT predicate (agy flash review)
- `d10a575` feat(desktop): GCD swimlanes grouped by team — friendly columns on the left, enemy on the right, with a vertical divider at the boundary
- `449cd19` feat(desktop): report health curves smoothed — Catmull-Rom bezier + control point clamping to prevent overshoot + non-scaling-stroke
- `47c6c05` feat(desktop): framed sidebars on the replay arena — friendly and enemy health bars permanently readable, with hover-linked highlighting and raising, replacing the old legend
- `1370f41` release: v0.0.10 — key-moment axis + background list loading / live statistics updates + report detail breakdown
- `1481898` docs: backlog #11 marked done + the breakdown implementation plan committed
- `1750f55` fix(desktop): breakdown review corrections — the click area made a real flex box + expanded data useMemo'd + pet names not split / same name on a different realm falls back to the full name (agy flash review)
- `293536f` feat(desktop): report detail breakdown — meter rows expand inline, broken down by ability and source (backlog #11)
- `a4f33ba` feat(desktop): deriveDetailBreakdown — aggregated by ability and source, with the total reconciled against meterValue
- `0a1bc18` feat(parser): decodeHpTail / hpTailSlice exported — HP tail-parameter decoding single-sourced, with parseLine switched to the same slice
- `24b1799` docs(specs): report detail breakdown design (inline expansion + core columns + crit rate, decisions recorded)
- `cf802d7` docs(backlog): #12 marked done
- `f284d18` feat(desktop): background list loading + statistics updating live as matches are ingested (backlog #12)
- `751030b` fix(desktop): axis review corrections — CC nodes carry the caster + useMemo merging/splitting + pure-render gaps + stable keys (agy flash review)
- `cbbe235` feat(desktop): key-moment axis layout on the AI analysis page — the axis replaces the horizontal strip, cohort drops to full width, whole-match observations in their own section
- `da62316` feat(desktop): KeyMomentAxis component — staggered spine / ellipsis markers / click to seek
- `ea8bf25` feat(desktop): deriveKeyMoments — five classes of event derived for the key-moment axis (predicates entirely reused from analysis)
- `62523ae` docs(backlog): #12 background loading after lazy load + live statistics updates (user feedback)
- `c12f586` docs(backlog): #11 report detail breakdown (broken down by ability and source, at the original detail level)
- `714157b` docs(specs): key-moment axis design for the AI analysis page (four user-approved decisions recorded)

## v0.0.9 (2026-07-18)

- `b9fb721` release: v0.0.9 — evidence time chips + the unconverted-burst evidence type + findings raised to 3–5
- `ff2302b` feat(analysis): unconverted-burst candidate type + findings raised to 3–5 (evidence diversity)
- `cec89c5` feat(desktop): time chips on finding evidence — each piece of evidence shows when it happened and is individually clickable to seek the replay

## v0.0.8 (2026-07-18)

- `0274b64` release: v0.0.8 — comparison translated to Chinese / commentary thickened / swimlane truncation
- `70606a4` feat(desktop): the comparison panel fully translated to Chinese + commentary thickened; replay swimlanes truncated at the end line

## v0.0.7 (2026-07-18)

- `6181db4` release: v0.0.7 — manual command path for backends
- `9aa71af` feat(desktop): a "command path" input added to the settings page — the Claude CLI and agy backends can be pointed at manually
- `25cdb67` docs: Windows + Claude CLI setup guide (for sending to colleagues)

## v0.0.6 (2026-07-17)

- `85c99a9` release: v0.0.6 — replay arena boundaries / starting-room outlines + ⌘/Ctrl wheel zoom
- `e0d06b3` feat(desktop): replay arena boundaries and starting-room outlines (measured from the corpus) + zoom interaction switched to ⌘/Ctrl+wheel

## v0.0.5 (2026-07-17)

- `64881e3` release: v0.0.5 — coverage tail eliminated + seven blinding CCs + SPEC BASELINES revived + an enemy trinket row
- `b1ac13c` docs(plans): design for loading very long matches faster — a trace of the three costs of synchronous parsing in the main process + approach A
- `c9d6f0f` fix(analysis): benchmarks recomputed over a thousand matches + the live-dead-key SPEC BASELINES fixed (the 15th case of a split predicate)
- `77c1b57` fix(analysis): [OFFENSIVE WINDOW] CDs carry the cast instant + a 7th blinding CC (agy cross-review)
- `5f16de9` fix(eval): unused variable in rotScan — CI lint includes scripts, and the local `--quiet` output was truncated so it was missed
- `cd0dc4b` feat(desktop): UI stress-test sample pool — wild-boundary fixture generation / on-demand loading / headless smoke test
- `41baa6c` fix(analysis): CC whitelist aura ID rot — 6 blinding CCs completed from thousand-match corpus evidence
- `601c959` fix(analysis): coverage tail eliminated — CC with no owner CD enters the timeline + pet dispels on both sides + an enemy trinket row
- `d6f7cf2` fix(analysis): CC row attribution for pet casters + a thousand-match wild fuzz tool
- `49046ba` fix(corpus-tools): comp tier tests switched to static imports — dynamically importing analysis on a cold CI exceeded the 5s timeout
- `ada128a` feat(compare): P2 opposing-comp dimension — an expert cell for the same composition + duration / first kill + a comp tier fallback chain
- `104dbd5` docs(plans): pro-comparison P1 checked off (387 cells, 262 DPS)
- `6ea230f` fix(corpus-tools): converting union metrics to a Record has to go through unknown (workspace tsc includes src tests)
- `f4e9845` feat(compare): expert-comparison DPS metric group (P1) — 7 dimensions enter the reference corpus, 262 DPS cells
- `779a53b` docs(plans): design for in-depth comparison against expert matches — contextualized metrics / comp dimension / exemplar import
- `edd394f` fix(desktop): zoom test className typing (CI workspace tsc includes test files)
- `6217aa5` fix(desktop): zoom handler prefer-const (lint)
- `dd431a5` feat(desktop): replay zoom + character distinction on the statistics page + a Windows local CLI backend
- `110bfff` refactor(logs): log collection tooling consolidated — a shared wowarenalogs client + a unified `logs:*` entry point
- `753b674` ci: an electron-vite build step added to the test workflow — a renderer value imported into main can only be caught by a production build

## v0.0.4 (2026-07-16)

126 commits in total; only feat/fix/perf listed below (89):

- `3a9ccc8` fix(desktop): API_KEY_REDACTED moved into shared/protocol — a renderer value imported into a main module blew up the production build
- `6b697e7` fix(analysis): DPS baseline Top-3 fix — interrupt field semantics unified + two bugs in the kick judgment + window truncation + subject wording
- `9836b74` feat(eval): public match fetcher — a real DPS-perspective corpus pipeline (D2 wrap-up)
- `1ac01b8` feat(desktop): this-match goals card (D3 coaching loop) — the "still doing it" category opens the AI view
- `d0c7089` fix(analysis): the mitigation row in the burst ledger states its subject — the smoke test showed the responder reading it as a friendly external
- `e3ee234` fix(eval): DPS corpus support — `--owner dps` + three fixes to subject parsing in the gates
- `0545421` feat(analysis+desktop): D2 — the AI review's owner perspective generalized, so a DPS recorder gets `<burst_ledger>` and four new event classes
- `c83ba7a` feat(desktop): red burst pulse in the replay + same-second focus-fire highlighting (DPS D1 wrapped up)
- `b9910a6` feat(desktop): DPS burst ledger card (D1) — burst alignment / target discipline within the window / interrupt audit
- `558359e` fix(analysis,eval): DR legend disambiguated + a responder focus sentence (baseline Top-2/3 issue)
- `602ed11` fix(analysis): three coverage-gate fixes — enemy pet CC / enemy in-team breaks / our CC on an enemy being invisible
- `b555dd9` fix(analysis): benchmarks regenerated — the real DPS baseline after the metric sign fix
- `05bb089` fix(desktop): unused findingKey import removed (CI lint blocked two commits)
- `59a586b` feat(desktop): three replay pieces — keyboard controls + obstacle outlines + AI streaming preview (phase3 #4)
- `fd134a3` feat(desktop): most-frequent-problems aggregate card — the coach goes from commentary to follow-up (phase3 #3b)
- `d0369e8` feat(desktop): finding follow-up marks — fixed / still doing it (phase3 #3a)
- `7641d7b` feat(desktop): historical log import — file dialog → parse into the library + progress (phase3 #2c)
- `bb44c13` feat(desktop): first-run wizard empty state (phase3 #2b)
- `eaf37db` feat(desktop): settings page — a proper home for user-facing options (phase3 #2a)
- `5726e52` feat(desktop): statistics dashboard — cross-match stats land for the first time (phase3 #1)
- `6925b41` feat(desktop): KILL WINDOW / VULNERABLE bands drawn on the report HP timeline (clickable to seek the replay)
- `d553b57` feat(desktop): swimlane death dividers clickable → death recap — all three death marker entry points complete
- `bea7cd0` feat(desktop): match list filter bar — win/loss / bracket / spec (matching the old repo's MatchSearch)
- `454bdc1` feat(parser,desktop): true cast bars — SPELL_CAST_START landed + cast progress in the replay (#11b, full version)
- `45d0f0d` feat(desktop): window bands clickable — clicking a burst/vulnerable band jumps to that moment
- `4f322c4` feat(desktop): replay death ✕ clickable → death recap (#6 v2)
- `f83228e` feat(desktop): swimlane chips click to seek — clicking any cast seeks the shared clock to that moment
- `2c666ce` feat(desktop): stats table rows expand — interrupt / CC instance details + replay jumps (#10 v2)
- `8fca726` feat(desktop): AI analysis language switching, Chinese/EN (backlog #1)
- `c03731f` feat(desktop): three small replay pieces — HP numbers + dampening indicator + cast flash (backlog #11)
- `f32a4d2` feat(desktop): stats table — hard per-player numbers for interrupts / CC / dispels (backlog #10)
- `b2fc00f` feat(analysis,desktop): swimlane spell icons — a mined spellId→icon-name table + chip rendering (backlog #9)
- `3501c76` feat(desktop): death recap drawer card — click a death marker for the 10s before it + defensives available and never pressed (backlog #6)
- `b825184` feat(desktop): #8 wrap-up — "replay this moment" on the TimelineStrip + KILL WINDOW / VULNERABLE bands
- `8772f4f` feat(desktop): rich match list rows — win/loss / map / duration / rating + spec icons for both teams (backlog #7)
- `60d9707` feat(desktop): evidence-chain navigation — a finding's "replay this moment" goes straight to the event's instant (the core of backlog #8)
- `852a136` feat(analysis): KILL WINDOW redesigned — vulnerable state separated from kill attempt (burst sub-windows)
- `e3c1708` fix(analysis): spec-level coverage survey — 12.x burst CDs completed + Shadowfury DR + 7 missing interrupts
- `4cce06d` fix(analysis): OPPORTUNITY rows rendered in time order (pick by leverage, order by time) — 136/1245 were out of order
- `5aa94e1` fix(analysis): damage sign convention bug — 'your damage' was counting only absorbed damage across the board
- `f7a6251` fix(analysis): two more invariant-scan fixes — kill-window CC membership judgment aligned to render seconds + a self-contradictory channeled-cast comment
- `1aacaa5` fix(parser,analysis): two invariant-scan fixes — shuffle round tails swallowing the between-round gap + CD variant IDs mislabeled UNUSED
- `8181ef7` fix(analysis): Stasis stored-spell whitelist gained 4 12.x IDs — 24/51 releases were listing too few spells
- `6215390` fix(analysis): the [MATCH TYPE] header's predictive framing → a hedged [MATCH PATTERN]; an A/B evidence comment added to the production prompt
- `ced551a` feat(eval): an ACCURACY DISCIPLINE self-check section added to the responder template (A/B: accuracy +0.71, CI win)
- `57d27f8` fix(analysis): two labelBias convergence signals — DMG SPIKE healed-through annotation + neutral exposure verdict wording
- `ec9a7c6` fix(analysis): RES lag + STAYED_IN window semantics + the Sigil of Misery DR label (three fixes from the Gemini review)
- `f58ebc4` feat(analysis): high-frequency filler cast windows folded + channeled ticks suppressed (noise-reduction A/B treatment)
- `aceafb5` fix(analysis): the G5 scan anchored to render seconds (floor) — the root cause of the 1114/1021 residual
- `3cb15ea` fix(analysis): the last two CJK leaks in [CD] target labels — the pid fallback path
- `315b224` fix(analysis): G5 take 2 — LoS judgment switched to a ±2s scan exactly matching the gate
- `83d4600` fix(analysis): last two locale-leak sites — [UNIT DESTROYED] + [CD] target labels
- `84bae32` fix(analysis): track Devourer Demon Hunter kit + Sigil of Misery CC
- `c0711f7` fix(analysis): evaluate LoS at raw sampled positions, not interpolated (G5 residual)
- `a3a75fb` fix(analysis): make INACTIVITY 'free' wording explicit (un-CC'd, could have cast)
- `0e360fe` fix(analysis): shared bounded HP sampler — death traces provably match STATE (B4 residual)
- `57a20fd` fix(analysis): resolve pet/NPC names in [KICK] lines (last locale leak)
- `8f5b255` fix(analysis): explicit "DAMPENING: n/a" line for short matches
- `7295177` fix(analysis): track missing enemy burst CDs (21% of corpus had zero [ENEMY CD])
- `69be1f3` fix(analysis): detect Grounding Totem absorbs by npcId, not English name
- `09cb414` fix(eval): SPECIFICITY_TOL default 0 -> 1 for the integer judge rubric
- `1e3bc3d` fix(analysis): bound position interpolation in healer-exposure LoS checks (G5)
- `4d65dbb` fix(eval): extend dispel-oracle rider exclusions found at 1245-match scale (B3)
- `c1f3fff` fix(analysis): unify burst-target attribution + tighten burst HP sampling (B4)
- `5f70143` fix(analysis): suppress localized totem/pet target names in timeline (locale leak)
- `c52ea5b` fix(analysis): render English spell names in offense/CC prompt sections (locale leak)
- `8c355a2` fix(eval): judge rubric dimension-independence anti-halo rule (discriminant validity)
- `2188ec0` fix(eval): judge-calibration discriminant validity — specificity / minimum sample / drop threshold
- `bda41bf` fix(desktop): in-app fixture preview fixed (VITE_FIXTURE_MODE=1 npm run dev)
- `283fe30` fix(desktop): GCD chips show only the ability name, with the target moved to hover
- `1bbbae7` feat(desktop): the replay arena carries the real map (aligned to the minimap by zoneId)
- `3fb8c5f` fix(desktop): GCD abilities are not dimmed while paused (future actions dim only during playback)
- `bc13036` fix(desktop): GCD ability chips made taller (more vertical room, easier to read)
- `381f534` fix(desktop): replay layout changed to 1:2 (arena : GCD swimlanes), with the middle gap tightened
- `56ed402` fix(desktop): GCD swimlanes widened and enlarged (pulled left, larger and clearer text)
- `5413d7c` feat(desktop): GCD swimlane density reduced + clicking a name in the report filters the health curves
- `0df1479` feat(desktop): local UI test bed (npm run dev:ui) — renders the report in a plain browser
- `e639493` feat(desktop): redesign AI view — two-column findings cards + sticky cohort
- `844caa9` feat(desktop): View C GCD-mode swimlanes (sharing a clock with the arena)
- `3d29414` feat(desktop): redesign View C replay — WoW arena style
- `821b741` feat(desktop): redesign View A — segmented-control view tabs + inline mode switching in the meters + the unit sidebar removed
- `b5906c0` fix(vision): address agy cross-family review (C1)
- `abc6724` feat(vision): headless verify:vision script (C1)
- `7cd0c77` feat(vision): cohort selector + faithfulness checker (C1)
- `a69e662` feat(vision): timeline selector + faithfulness checker (C1)
- `cef0c97` feat(vision): meters selector + faithfulness checker (C1)
- `67d7d87` feat(desktop): replay tab — 2D positioning simulation (trails / deaths / legend)
- `afd0dc8` feat(desktop): unit details merge the cast and important-aura streams & a player filter dropdown
- `3807cce` feat(desktop): AI analysis split into its own full-width tab (out of the narrow right column)

## v0.0.3 (2026-07-12)

- `04b0f4c` build(lint): allow require() in .cjs files (electron-builder hooks)
- `fc55952` chore(desktop): bump version to 0.0.3
- `8710d4b` docs: /release-gladlog command — versioned desktop release workflow
- `5757fe4` feat(desktop): debug local-AI backend (claude/agy CLI)
- `136cb0c` docs(specs): debug local-AI backend (claude/agy CLI) design
- `b46fa73` build(desktop): afterSign hook — clean ad-hoc macOS signature (no more 'damaged')

## v0.0.2 (2026-07-12)

- `bc45ba5` chore(desktop): bump version to 0.0.2
- `03641f6` perf(desktop): append-only NDJSON match index — one-read startup + O(1) store
- `ee3b37f` feat(desktop): infinite-scroll match sidebar (initial 100, older on scroll)
- `5874f51` feat(desktop): matches:page IPC + preload bridge
- `170def9` feat(desktop): MatchStore.page() paginated slice
- `3cc963c` docs(plans): match-list pagination + NDJSON index implementation plan
- `dc7e6fe` docs(specs): match-list pagination + fast-startup NDJSON index design
- `315814a` ci: let macOS build ad-hoc sign (drop CSC_IDENTITY_AUTO_DISCOVERY=false)

## v0.0.1 (2026-07-12)

226 commits in total; only feat/fix/perf listed below (157):

- `1d220ff` fix(log-pipeline): append-only reconstruction + review nits
- `50d1f94` feat(log-pipeline): collect CLI + cleanup tests
- `1eaa7d3` feat(log-pipeline): port cleanupAppliedSegments (node:fs + gzip-length cross-check)
- `ff940db` feat(log-pipeline): overlap-aware gunzip-validated collection
- `757ee57` feat(log-pipeline): length-encoded segment keys + flusher wiring
- `5475586` feat(log-pipeline): stage ported streamer + storage/protocol infra (raw port, pre-hardening)
- `c226d4b` feat(analysis): expand findings menu — side-tagged deaths + cd-waste events
- `cdebdf1` fix(analysis): honesty-pipeline bugs from agy cross-family bug-hunt
- `70da433` fix(analysis): three verifiedComparison bugs surfaced by the smoke test
- `4905b59` feat(analysis): harden findings prompt against raw digits (SP-A.1 digit refinement)
- `bf907fd` fix(analysis): R3 — render offensive-waste block in the timeline branch
- `ab05545` fix(SP-A): narrow causalLint patterns to cut false-drops (agy re-verify)
- `2ff8aec` fix(SP-A): close two honesty holes from Opus whole-branch review
- `a4afff4` feat(desktop): ExportButtons + StructuredAnalysisPanel replacing the <pre> analysis (SP-A T7)
- `308aa4d` feat(desktop): FindingsList + MatchHero + TimelineStrip (SP-A T6)
- `6bdca5e` feat(desktop): main-process analysis service + IPC/preload (SP-A T5)
- `43d6965` feat(analysis): findings prompt + analysis exports (SP-A T4)
- `a85a084` feat(analysis): auditFindings three-layer gate (SP-A T3)
- `1046bf9` feat(analysis): causal-language lint (SP-A T2)
- `e867e50` feat(analysis): candidate-event types + extraction (SP-A T1)
- `e6c07f1` fix(SP-B2): reset compare panel state + guard async race on matchId change
- `1407a00` fix(SP-B2): address Opus whole-branch review findings
- `9613971` feat(desktop): ProComparisonVerified panel (SP-B2 T7)
- `39ac7a8` feat(desktop): corpus loader + compare IPC/preload wiring + bundling (SP-B2 T6)
- `0899967` feat(desktop): main-process compare service with fail-open + claimChecker (SP-B2 T5)
- `63249ba` feat(analysis): exemplar-led prompt + compare exports (SP-B2 T4)
- `f3e7dcc` feat(analysis): template interpolation + claimChecker gate (SP-B2 T3)
- `4b12832` feat(analysis): verifiedComparison + facts dictionary (SP-B2 T2)
- `b7c7764` feat(analysis): compare corpus read-types + cell lookup fallback (SP-B2 T1)
- `f9f1673` fix(SP-B1.5): address agy whole-branch review findings
- `a05f9d3` fix(corpus-tools): aggregateCells self-guarantees the buildGroups invariant
- `6b30dd3` feat(corpus-tools): maintainer keystone-discovery tool (SP-B1.5 T7)
- `1e02d29` feat(corpus-tools): thread keystone gates through buildCorpus (SP-B1.5 T6)
- `3892072` feat(corpus-tools): validate build-group schema integrity (SP-B1.5 T5)
- `c3ff208` feat(corpus-tools): build-split cells + N_floor guard + buildGroups (SP-B1.5 T4)
- `9d39e0b` feat(corpus-tools): winsorize offensiveIndex to pool p99 (SP-B1.5 T3)
- `1ebeefb` feat(corpus-tools): assign buildGroup per record via keystone gate (SP-B1.5 T2)
- `2f342f8` feat(corpus-tools): keystone gate module + curated table (SP-B1.5 T1)
- `b0090a1` feat(corpus-tools): retry-with-backoff on feed calls for production-scale runs
- `2bcb0cc` fix(SP-B1): address final-review Important findings (latent safety-net gaps)
- `c6b0cc6` feat(corpus-tools): T8 real corpus build + 2 metric fixes found by acceptance gates
- `0c6b7e8` feat(corpus-tools): per-match record + buildCorpus orchestration (SP-B1 T7)
- `35f37a8` fix(corpus-tools): feed query needs inline fragments on ArenaMatchDataStub/ShuffleRoundStub (go/no-go smoke diagnosis; direct field selection on CombatDataStub interface → HTTP 400)
- `2727cce` feat(corpus-tools): feed client + go/no-go smoke (SP-B1 T6)
- `481bb57` feat(corpus-tools): corpus validator hard gate (1.5 sentinel/ASCII/N_floor) (SP-B1 T5)
- `9392e73` feat(corpus-tools): scaffold package + cell aggregator with archetype celling + N_floor (SP-B1 T4)
- `3817d11` feat(analysis): enemy-comp archetype classifier for cohort celling (SP-B1 T3)
- `4a4a02f` feat(analysis): port extractRotations/crisisEvents from old fork (SP-B1 T2)
- `ecdb8cf` feat(analysis): port computeHealerMetrics from old fork (SP-B1 T1)
- `2ee7ee2` fix(analysis): restore death-outcome block + never-used flag in timeline prompt (E2E regressions R1+R2)
- `154d38c` feat(analysis,eval): dispel visibility — named dispel spells on [CLEANSE], team [PURGE] + [ENEMY PURGE] lines, folded [MINOR DISPELS]; manifest excludes movement root-breaks from dispel denominator (backlog #5)
- `f004d74` feat(eval,analysis): geometry grounding scanner + pipeline guards — 176-match corpus at 0 violations (backlog #3 hard gate)
- `22f7565` feat(eval): CONTESTED safety-contract assertion script (F193 replication) — 176-match corpus clean; F193 rubric clause added to eval-baseline accuracy dim. Backlog #4 closed
- `ed29c81` feat(desktop,eval): adopt timeline prompt variant as production default
- `ac35614` fix(parser): strip trailing \r from CRLF logs — feign deaths were recorded as real deaths; timeline: STATE min-gap 3s + delta [RES] on CD casts (A/B cycle-3 density compression)
- `0e6d5c4` feat(analysis): timeline unit references carry compact spec tags (A/B cycle-1 accuracy-regression fix)
- `3e4adf4` fix(analysis): owner-perspective Result line + neutral section headers (baseline eval findings)
- `d68f8d1` fix(review): sub-project 5 findings — unsigned mask decode, build-string validation, icon fetch budget, test-hack removal
- `c3c6e64` feat(report): talent icons with local disk cache (zamimg, offline-degrading) + update-wow-data workflow + datagen manifest
- `7dd1f93` feat(report): named talents in unit panel (getTalentNames via raidbots node maps)
- `f77afd5` feat(datagen): spell-class map + catalog validation (known-removed allowlist: Mind Bomb kept for historical logs)
- `a08df98` feat(datagen): own generators ported (trinkets, talent modifiers) + regenerated artifacts (build 12.1.0, 129 tracked spells)
- `9b1134c` feat(analysis): two-layer spell effect data (generated base, curated overrides win)
- `e2bd7b9` feat(datagen): spell effects miner (PvP-duration-aware, GCD-artifact filter) + generated base layer (3560 spells)
- `a611d42` feat(datagen): spell names regenerated from wago (enUS, minified, 413k entries, 13MB→12MB)
- `d6e8ba0` feat(datagen): raidbots talent fetch + real talentIdMap (40 specs, activates named-talent decoding)
- `1354e16` feat(datagen): wago csv + emit foundations
- `5b62fb0` fix(eval): final-review findings — blinding protocol, strict score schema, auditor robustness, CLI parity
- `6927ece` fix(eval): review findings — LCG strict [0,1) bound, dimensionScore numeric-string coercion parity
- `b01edc2` fix(eval): checkProvenance CLI accepts BASE_DIR without --run; e2e smoke pass
- `b71163f` feat(eval): score provenance validation (strict, no legacy leniency) + spot-audit/auditor-calibration ports
- `cba3178` feat(eval): judge calibration suite port
- `a09b091` fix(eval): corpus result is owner-relative Win/Loss/Unknown (ledger + calibration contract)
- `4d7446c` feat(eval): blind AB pool + paired stats port
- `0dfa847` feat(eval): deterministic prompt quality checks port
- `05536e9` feat(eval): corpus builder (gladlog parse chain, healer-owner prompts)
- `ec0439a` feat(eval): coverage manifest port
- `34315ae` feat(eval): eval-home resolver and private-repo init CLI
- `42c6ed1` feat(eval): package scaffold
- `6d2ce88` fix(review): final-review findings — AI stream race, key redaction, stream abort, pass2 id parity
- `1d586c4` fix(review): T2-6 review findings — params hardening, DR entries, API exports
- `d9a7024` fix(analysis): benchmark CLI parse-chain (correct GladLogParser API, glad-id keying, two-pass) + streaming aggregation; real-corpus benchmark_data (200 logs, 346 combats, 27 specs)
- `d6010e3` feat(analysis): local-corpus benchmark rebuild — stratified sampling, metrics core, CLI (haiku subagent)
- `d0e271d` feat(desktop): AI analysis panel wired to report page (unit/AI side tabs)
- `32df349` feat(desktop): main-process Anthropic streaming ai service (haiku subagent impl per degradation chain)
- `c54d051` feat(analysis): batch C + buildMatchContext port — full prompt pipeline green (459 tests)
- `e06f4d6` feat(analysis): core batch B port (dr/ccTrinket/dispel) + owned DR table; compat extra-spell fields
- `a7cbf6b` feat(analysis): core batch A port (cooldowns/enemyCDs/offensiveWindows) + catalog calibration via own tests
- `880fa92` feat(analysis): base utils port + owned classSpells/spellIdLists catalogs
- `ef34cf1` feat(analysis): data layer port — curated spell categories/effects, local SpellTag, talentIdMap placeholder
- `f47badd` feat(analysis): data layer port with curated spell-effect overrides
- `8f42be0` feat(analysis): package scaffold
- `7bf8c4d` fix(desktop): remount reports on doc switch (key); merge pet absorbs into owner; show build summary in unit panel
- `1fbd4b5` fix(desktop): bridge indirection — fixture override slot, contextBridge prop is read-only
- `7354548` feat(desktop): match/shuffle report assembly, fixture bridge, app shell restructure
- `70a3471` feat(desktop): SVG timeline (d3-scale) + unit detail panel
- `ffb3e46` feat(desktop): report header + meters components with jsdom test setup
- `f46c97e` feat(desktop): class colors/names + spec names incl. runtime-observed 1480 Devourer DH
- `3b14598` fix(desktop): death marks include players without combatant info
- `5c9271d` feat(desktop): cast and aura sequence derivation
- `f331308` feat(desktop): timeline derivation — hp series + death marks
- `9c47022` feat(desktop): unit summary derivation with pet merge
- `9c58353` feat(desktop): report derive types + roster derivation
- `8fc5268` feat(desktop): sanitized report fixture (self-collected 2v2) + generator script
- `9a0026e` fix(desktop): fatal parse errors crash worker for quarantine attribution; persist quarantine across reconfigure
- `68a68df` fix(desktop): process rename events in watcher — macOS reports new files as rename; tail reader tolerates races
- `a2a0f84` feat(desktop): log replay script for e2e acceptance
- `1eaa0ee` fix(desktop): build preload as CJS — sandboxed preload cannot load ESM, window.gladlog was never injected
- `4ccc4c7` feat(desktop): debug-grade live UI — status, match list, detail, diagnostics
- `dd858fd` fix(desktop): self-heal match dirs with corrupt meta (rm before rename); pin app name for stable userData
- `59b00da` feat(desktop): main-process assembly, typed IPC bridge, preload api
- `509f5a6` feat(desktop): match store — atomic meta/match/raw persistence with idempotent dedupe
- `cf6ea25` feat(desktop): worker host with crash attribution and per-file quarantine
- `5bc4330` fix(desktop): advance tail state only after batch fully fed to parser (no silent drops on push throw)
- `c724089` fix(desktop): guard tail reader against TOCTOU file deletion between stat and open
- `1452b34` feat(desktop): worker runtime — configure/scan/watch loop with checkpoint persistence
- `6daa66f` feat(desktop): file pipeline with safe-boundary checkpoints and rotation reset
- `15027d3` feat(desktop): byte-accurate tail reader with rotation/truncation detection
- `eb35f6d` feat(desktop): event-driven log watcher (ported own windows-agent watcher)
- `27dd8d7` feat(desktop): atomic checkpoint registry (ported own state.ts pattern)
- `3f8de42` feat(desktop): WoW dir detection + logs dir resolution (ported own detect.ts semantics)
- `72b2773` feat(desktop): worker protocol types + atomic SettingsStore
- `13d1e79` feat(desktop): electron-vite scaffold with main/preload/renderer/worker entries
- `2899449` feat(parser): read-only hasOpenSegment() for shell safe-boundary checkpoints
- `861b3c1` perf(parser): cache Intl.DateTimeFormat per timezone — 23k→105k lines/sec
- `449bfad` fix(compat): exclude CI-less player units (outsider filter, adjudication #27)
- `c7f0ebb` fix(compat): drop absorb interleave from damageIn; spellSchoolId hex string (adjudications #24/#25)
- `008c95f` fix(compat): spellId/extraSpellId as strings (adjudication #23)
- `3f014fe` fix: legacy CombatantInfo shapes — talents objects, string pvpTalents, structured equipment, aurasJSON (adjudication #22)
- `b978f5e` feat: raw params passthrough on events; legacy logLine.parameters with numeric coercion (adjudication #21)
- `9d6fe40` fix(compat): advancedActions entries carry advancedActorId + logLine (adjudication #20)
- `fd29dc8` fix(compat): teamId family as strings (legacy fidelity; downstream typeof check)
- `d836ce9` feat(parser): SPELL_SUMMON owner linkage for totems/guardians (adjudication #18)
- `a53b519` feat(compat): zero effectiveAmount for pet/guardian-targeted rows (adjudication #17)
- `b578f2e` feat(compat): merge pet/guardian dmg+heal into owner arrays (adjudication #16)
- `f6f9863` fix(parser): tolerate empty elements in COMBATANT_INFO nested arrays (Blizzard quirk)
- `a90b067` fix: absorb attacker-attribution + swing-form decode + legacy effective subtracts absorbed (adjudication #13)
- `b9f6f89` fix: preserve real event names in legacy shape; SWING_DAMAGE_LANDED dedup
- `e2b7012` fix: export type for type-only re-exports (tsx ESM runtime)
- `5adf9f3` fix(parser): type-only imports for ESM strictness (tsx runtime)
- `9514711` feat(compat): legacy damage sign convention + absorb interleaving (adjudication #6)
- `f5c7940` fix(parser): segment-anchored COMBATANT_INFO decoding (2024-vintage format from diff harness)
- `1828a0c` feat(compat): WoWCombatLogParser shim covering the 7 legacy call sites
- `0381920` feat(compat): legacy types + toLegacyMatch/toLegacyShuffle converters
- `0bfc6b2` feat(compat): package skeleton + legacy enums pinned to runtime manifest
- `5372410` feat(parser): GladLogParser emits GladMatch/GladShuffle; golden fixture assertions
- `276aad7` feat(parser): l3 outcome rules + match/shuffle composer
- `2624b14` feat(parser): l3 event-collection reducers (per-unit timelines, pet attribution)
- `422390c` feat(parser): l3 flags decoder + roster builder (owner via MINE bit)
- `c0cfd03` feat(parser): l3 data model + specToClass table
- `d6b7bc0` feat(parser): GladLogParser public shell (L1+L2 wiring, stats, diagnostics)
- `eda1550` feat(parser): l2 segmenter state machine (match/shuffle/diagnostics)
- `d7e9dcc` feat(parser): snr sweep script; timestamp variants from real-log sweep (UTC-offset suffix, variable fraction width)
- `cbda5ec` feat(parser): parseLine dispatcher + public L1 surface
- `b24fce2` feat(parser): combatant_info decoder
- `b3368f5` feat(parser): l1 event-family decoders
- `86bb502` feat(parser): l1 timestamp + top-level CSV tokenizer
