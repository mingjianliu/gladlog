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
 *  v166 (2026-09-26, reliability round 3 wave 2, audit 0e06): every time fact
 *  `t` floors onto the timeline's second (fmtFactTime) — death-setup,
 *  burst-into-mitigation, questionable-external, crisis-no-response, and the deep
 *  dive's item times and window bounds. 605 files: 27 menu `t` values stop
 *  pointing one second past their timeline row, 302 change only their tenths;
 *  nothing else moves.
 *  v167 (2026-09-26, range audit): kick-eaten's kickRangeYd reads the kick's
 *  cast id (kickCastSpellId) — Skull Bash 100 → 13 yd, Solar Beam 105 → 45 yd
 *  (the effect ids carry DB2's 100 yd placeholder). 605 files: 33 kick-eaten
 *  lines change, nothing else.
 *  v168 (2026-09-26, user-signed verdicts): Greater Invisibility (60 %) and
 *  Retribution Divine Protection (20 %) join the big-defensive list and the
 *  mitigation table (kill-live-gated); Lay on Hands is signed burst-answer (data
 *  only). 605 files: cd-hoarded 1707 → 1700, slow-defensive-response 126 → 118,
 *  [ENEMY DEF] +996 Divine Protection lines, kill-attempt rows name it; the two
 *  new walls make no unused-self counterfactual claim (coverage unmodelled).
 *  v168 (2026-09-26, reliability leftovers batch 1): (1) talent replacements — a
 *  class / hero talent that replaces a button removes it from the ledger
 *  (hand TALENT_REPLACES: Ancestral Swiftness → Nature's Swiftness; generated
 *  TALENT_REPLACES_GENERATED from TraitDefinition.OverridesSpellID, 18 pairs);
 *  605 files: cd-waste "never pressed Nature's Swiftness" 12 → 0, NS [UNUSED]
 *  in Farseer loadouts 319 → 168, Doom Winds [UNUSED] 6 → 0,
 *  missed-sync-window −93 / +15 (phantom "ready" Doom Winds / Avenging Wrath /
 *  Berserk under Ascendance / Sentinel / Incarnation), cd-hoarded −9 / +3.
 *  (2) two hand cooldowns that already held a talent's reduction (Astral Shift
 *  90, Psychic Scream 30) go back to DB2 so CD_TALENT_MODIFIERS applies once:
 *  loadout Astral Shift [60s] → [90s] ×1,159 and [90s] → [120s] ×229, Psychic
 *  Scream [20s] → [30s] ×3,152 and [30s] → [40s] ×510; burst-into-mitigation
 *  ±1, cc-avoidable −2 / +1, kick-priority −4 / +6. (3) proc-only activations
 *  render as [YOU]/[TEAM] [PROC] with a conditional legend line, no
 *  cheaper-available / [UNNECESSARY] / while-CC tag / [HEALING] block, no
 *  defensive-timing label, no SPEC BASELINES row: Renewing Blaze 191 owner +
 *  160 teammate lines, Radiant Glory Avenging Wrath 757 owner + 1,484 teammate
 *  lines, SPEC BASELINES rows Renewing Blaze 114 → 0 / Avenging Wrath 162 → 0;
 *  candidates unchanged by (3). Perspective line now reads "actions and effects
 *  on you".
 *  v169 (2026-09-26, reliability leftovers batch 2): (1) [BUFF FADED] says
 *  "(ended by your own shapeshift)" when a form-bound buff (Frenzied
 *  Regeneration, Ironfur, Tiger's Fury) on the owner is removed within 250 ms of
 *  the owner's form removal — 17 lines on 605 files, all Frenzied Regeneration;
 *  (2) SPEC BASELINES names the owner's rating next to the ≥2100 bracket and,
 *  below it, says the rates are what higher-rated players do, not a norm —
 *  2,966 contexts below, 237 at or above, 308 without a rating; (3)
 *  hardCastOccupancyWithin pairs each bar with its own success (event identity,
 *  consumed only when the success ends the bar), treats a same-ms success as an
 *  instant and drops any bar whose earliest end is > 12 s away — missed-cleanse
 *  casting facts change on 80 windows (ownerCastingPreCommitted yes → no on 62,
 *  no → yes on 58; ids unchanged), no other candidate moves.
 *  v170 (2026-09-26, reliability leftovers batch 3): (1) [ENEMY HARD CAST]
 *  renders only a bar that LANDED — the same spell's first SUCCESS ≥ 0.3 s and
 *  ≤ 12 s after the START, before any later START by that enemy, successes
 *  consumed per bar in event order — and appends "(2.5s cast, landed)";
 *  Hot Streak instants and aborted bars no longer render: 13,297 → 2,550 lines
 *  on 605 files (Pyroblast 9,683 → 0-ish, Chaos Bolt kept). (2) [TEAM] [CC]
 *  lines carry the owner's IMMUNE tag, per caster's own SPELL_MISSED stream and
 *  cast history: 0 → 1,450 tagged casts. (3) the burst ledger skips the
 *  caster-side copy of a redirect external (Blessing of Sacrifice on the paladin
 *  who gave it): "active ON THE TARGET" 546 → 436. (4) [BURST ANSWERED] states
 *  when a friendly other than the pressured unit died inside the window
 *  ("— X died inside it"): 1,303 lines. (5) enemy burst windows read the
 *  caster-aware duration (buffFullDurationForCaster) instead of the DB2 base:
 *  enemy-window consumers move — slow-defensive-response +16 / −9, kick-eaten
 *  window facts on 35 ids (ids ±2/4 cap), position-mistake −19 / +17,
 *  questionable-external −6 / +3, burst-into-mitigation −2; Demonic Tyrant's
 *  20 s (Reign of Tyranny) now reaches those windows.
 *  v171 (2026-09-26, range audit, GH #120): the reach table's spec passives
 *  carry `specIds` and are owned by spec (Preservation aura +5 yd, Holy
 *  Paladin aura +10 yd on Divine Toll — dead on arrival before), a SpellMod
 *  on a spell only a trigger reaches is an aura's and stays out (Sniper's
 *  Advantage), and a triggered id's placeholder range (100 / 50000) yields to
 *  its cast's. 605 files (base 28cbee6f): missed-cleanse dps 199 → 200 /
 *  healer 260 → 262 (Preservation cleanse reach 30 → 35), kick-eaten
 *  yourReachYd 25 → 30 on 13 Preservation lines; nothing else, the match
 *  context is byte-identical.
 *  v172 (2026-09-26, reliability leftovers batch 4): (1) Cauterizing Flame out
 *  of the healer save roster (user ruling): cd-hoarded ready sets naming it
 *  54 → 0, cd-waste −10; the roster re-emit also admits Discipline Fade and Holy
 *  Paladin Divine Protection (verdicts landed since the 09-25 table; user chose
 *  to keep both): cd-waste +2 Fade, cd-hoarded ready sets +2 Fade / +7 Divine
 *  Protection, [TEAM] [CD] Fade +530 / Divine Protection +195 lines, [BUFF
 *  FADED] +504; (2) cd-hoarded counts the owner's control cast (a peel) or any
 *  friendly's team save inside the response window as an answer (user ruling):
 *  dps 893 → 666, healer 801 → 702 (−433 / +107 refills, (1)+(2) together);
 *  (3) missed-sync-window needs the owner free for at least half of the lock,
 *  not 1 s of it (user ruling): dps 634 → 604, healer 317 → 302 (−69 / +24).
 *  Measured on a tree whose reach change was equivalent to b3e24b29's (12
 *  kick-eaten yourReachYd 25 → 30 belong to that commit). Tables: sync-window
 *  (evaluateSyncWindow shared), cdTriggerPrior (roster) on GH #115.
 *  v173 (2026-09-26, reliability leftovers batch 5): (1) external-unused needs the
 *  external to reach the victim at some 0.5 s sample of the free window — a
 *  caster-centred zone (Darkness, 8 yd around the owner) by its radius, a
 *  targeted external by its cast reach; no reach / no positions = unchanged:
 *  dps 87 → 82, healer 110 → 109 (Darkness −4, Ironbark −1, Blessing of
 *  Protection −1); (2) kick-eaten measures a pet kicker (Felhunter Spell Lock,
 *  Axe Toss) from the pet's own position: nearestKickerDistYd / kickersInRange
 *  change on 128 kick-eaten facts, ids unchanged. Context byte-identical.
 *  v174 (2026-09-26, reliability leftovers batch 6): (1) a trinket or break racial
 *  binds to a CC only when cast ≤ 50 ms after the CC's removal (was 250;
 *  trinketBreakOrderScan: the trinket's own removals land within ±25 ms of the
 *  cast, removals earlier than that ended another way, every damage break falls
 *  before the cast): [ENEMY TRINKET] "out of X" 11,191 → 10,975 lines,
 *  cc-avoidable 43 → 42; (2) kick-eaten's "pressed N× but rejected" counts every
 *  rejected press (was the intent-filtered set — HoJ pressed 4× read "1x"); the
 *  ranking keeps the filtered set: facts change on 83 kick-eaten lines, ids
 *  unchanged.
 *  v175 (2026-09-26, reliability leftovers batch 7): death block (round 3 N13)
 *  — the [KILL] line names the killing blow (the overkill hit) and the largest
 *  5 s source separately, both through the roster id maps: 675 lines; top damage
 *  sources include the unit's own damage — "deferred X (own)" for Time Dilation
 *  / Stretch Time, "X (own)" otherwise (reflected own spells, Refraction,
 *  Tempered in Battle …): 466 deferred + 1,093 own mentions; a school-limited
 *  immunity's mitigation audit reports all damage taken and the part outside
 *  its school: 66 lines. Codex review of batches 4–5: cd-hoarded's team-save
 *  answers use a real TEAM_SAVE_CD_IDS (team heals + Spirit Link, Barrier, Aura
 *  Mastery, AMZ, Rallying Cry, Darkness, Zephyr): dps 666 → 642, healer
 *  702 → 679 (−53 / +6); external-unused samples reach only while the owner is
 *  free; a pet kicker must have its interrupt ready at cast start.
 *  v176 (2026-09-26, reliability leftovers batch 8): (1) [BURST ANSWERED] credits
 *  the first response that reached the pressured unit and was still up at its
 *  trough (an external on another unit or one that expired before the trough no
 *  longer counts), and its latency is measured from the raw lead cast, not the
 *  floored window second: 4,572 → 4,299 lines, "before it opened" 716 → 802;
 *  (2) the burst ledger's "Off-target" lines skip windows where the player's
 *  damage followed the team's focus (the enemy taking the most friendly damage)
 *  rather than the defenseless window target: 3,559 → 579 lines, the report
 *  card's chip reads the same flag and the shared ON_TARGET_GOOD_PCT; (3) the
 *  KILL ATTEMPTS summary says "kills inside an attempt" and states enemy deaths
 *  outside every attempt window: 735 contexts. Candidate menu unchanged.
 *  v177 (2026-09-26, reliability leftovers batch 9): an aura re-broadcast is one
 *  aura — a same-ms REMOVED → APPLIED pair of the same spell, source and target
 *  is dropped (`dropAuraRebroadcasts`, shared by the aura interval builder, the
 *  CC / trinket builder and the buff-fade pairing), and a second APPLIED inside
 *  the first application's official duration with no cast of the spell by its
 *  source (leaving stealth) keeps the interval open: [ENEMY DEF] 21,171 →
 *  20,162 lines, "ended early" 2,103 → 1,836, "removed early" 7,083 → 5,735,
 *  [CC ON TEAM] 69,956 → 69,538; candidates +9 (death-setup +6,
 *  burst-into-mitigation +2, cc-avoidable +1 — merged CCs / walls reach their
 *  thresholds).
 *  v178 (2026-09-26, reliability leftovers batch 10): position judgements know
 *  who moved, and nine wording / fact fixes. KITED needs the owner's own
 *  displacement to cover half the distance opened (1,965 → 1,556 lines);
 *  STAYED IN states "you moved N yd yourself" (2,084 lines; gate G4b) and the
 *  header says it is about the enemy staying close; HEALER TRAINED skips campers
 *  under our CC and needs the healer to be the camper's top damage target
 *  (2,579 → 1,399). Burst-ledger walls say "already up" (588) or "pressed Ns
 *  after the burst opened" (2,922); burst-into-mitigation carries wallUp
 *  (7 before-open / 37 after). The not-ready rejection matches five client
 *  locales and CRLF logs; kick-eaten names own-cooldown / GCD presses outside
 *  the locked school (266). [UNCLEANSED DEBUFF] "taken in the 5s after it
 *  landed"; pillar hints "that enemy only"; damage sources name a summon by
 *  its owner ("5's guardian"; bare [pet] 4,305 → 5).
 *  v179 (2026-09-26, reliability leftovers batch 11): missed-sync-window
 *  (round 3 W1a legs). A CD that hits an enemy is ready only if its owner came
 *  within its own reach (cdOutOfRangeReachYards) of a non-healer enemy during
 *  the free part of the lock (82a2, fd45); a hard-cast CD whose bar STARTS
 *  inside the lock entered it (f4eb Demonic Tyrant); one held CD across several
 *  locks is one accusation, the later locks listed as facts.alsoHeldAt (24b6).
 *  Per-owner menu rows: dps 604 → 506, healer 302 → 253 (unique: 47 same-hold
 *  locks folded, 11 unreachable / bar-started, 9 cap refills).
 *  v180 (2026-09-26, reliability leftovers batch 12): (1) death-block top damage
 *  sources count the absorbed part of each hit — "5 — Starsurge (151k; 108k of
 *  it absorbed)" (round 3 N13, b12b; 33,462 mentions on the 605-file slice);
 *  (2) burst-into-mitigation accuses only a wall already up when the burst
 *  opened — user ruling, a wall the target pressed in response is not "opened
 *  into" (dps 44 → 7); (3) an enemy's [KILL] line names it through the enemy
 *  roster (433 lines printed the bare, often CJK / Cyrillic, character name).
 *  v181 (2026-09-26, GH #119): enemy bursts see effects whose only evidence is
 *  an aura — Havoc Metamorphosis (the 191427 button never logs; a press shows as
 *  its 200166 landing), the Eye Beam Demonic form as a MINOR burst (user ruling
 *  「算小爆发」: Eye Beam's 30 s weight 0 — joins aligned windows, opens none
 *  alone), a Doom Winds with no logged press; an Ascendance-granted Doom Winds
 *  stays Ascendance's. 605 files: [ENEMY CD] Metamorphosis lines 0 → 1,447,
 *  Doom Winds 37 → 132, aligned burst windows 11,472 → 11,659; candidates
 *  position-mistake dps 290 → 292, missed-cleanse dps 200 → 198 / healer
 *  262 → 258, slow-defensive-response 125 → 128, kick-eaten dps 1001 → 1003 /
 *  healer 483 → 487; kick-eaten burst facts name a Metamorphosis on 161 rows.
 *  v182 (2026-09-26, reliability leftovers batch 13): four outcome fact lines
 *  (user ruling): [GROUNDED] a control eaten by a Grounding Totem (504);
 *  [REFLECTED] a reflected control, or a reflected damage spell that came back
 *  for >= 5 % of the caster's max HP (672); [CC REMOVED] a control removed by
 *  Blessing of Sanctuary (786); [REJECTED] the owner's runs of >= 3 presses
 *  refused for range / movement / line of sight.
 *  v183 (2026-09-26, reliability leftovers batch 14): [RES] lists the owner's
 *  own interrupt (own or pet, official kit ownership) and a Death Knight's Death
 *  Grip — user ruling; they sit under the major-CD floor and were invisible
 *  (f4eb Spell Lock, f4da Counterspell). [RES]-only: no other consumer sees them.
 *  v184 (2026-09-26, codex counterexamples to batch 10): HEALER TRAINED names
 *  the in-radius camper with the most seconds whose main target was the healer
 *  (a nearer off-target melee no longer hides it; 1,399 → 1,423 lines); a
 *  summon's owner is never matched by a short name both rosters share.
 *  v185 (2026-09-27, talent impact fixes): consumers read each unit's
 *  talent-resolved cooldown / charges / buff length / reach (interrupts, enemy
 *  vulnerability windows, walls in hand, md-cyclone immunities, death block,
 *  healer CC and avoidance tools, kill-window reach); Master of Time per rank,
 *  Static Charge 10 s per rank (user ruling), Escape from Reality free recast,
 *  Storm Conduit per-cast reductions, buff-conditional cooldowns; dispel types
 *  gated by talents, interrupt-immunity auras in kick-priority, CC cast ids as
 *  crisis answers, Avenger's Shield out of the kit, Bladestorm casting locks
 *  (Unrelenting Onslaught), Light's Revocation, Oakskin → Survival
 *  Instincts. 605-file capture: kick-priority dps 106/86 → 93/63, healer
 *  12/82 → 2/75, missed-cleanse dps 200 → 196 / healer 262 → 261,
 *  burst-into-mitigation 42 → 43, cd-hoarded 666 → 667.
 *  v186 (2026-09-27, GH #119 follow-up, user 「都做了吧」): the aura twins of
 *  three canonical casts are read — Summon Infernal 1122 → 111685, Arcane Surge
 *  365350 → 365362, Elemental Ascendance 114050 → 1219480. A pressed twin
 *  keeps its cast and takes the aura's end (Summon Infernal was 0.25 s — DB2's
 *  cast row — now its 30 s), and the aura path sees all three; an aura with no
 *  press is a minor burst "(no press)" (weight 0, availability ?). 605 files:
 *  enemy Summon Infernal "(Ns left)" entries 16 → 1,283, "[friendly offensive
 *  CD active]" 22,672 → 23,107, windows unchanged 11,659; missed-cleanse dps
 *  194 → 190 / healer 257 → 255, kick-eaten dps 1003 → 1004 / healer 487 → 488,
 *  position-mistake dps 292 → 293.
 *  v187 (2026-09-27, agy review of batches 11–14): absorbed-hit attackers named
 *  by GUID (1,228 "Unknown" → 11) and swing absorbs merged into the Melee line;
 *  missed-sync-window folds a later lock only with the same ready set and needs
 *  a living non-healer enemy; reflect damage counts only what the reflect sent
 *  back ([REFLECTED] 773 → 728); Sanctuary CC caster by GUID.
 *  v188 (2026-09-27, codex review of batches 8–9): group externals (Spirit Link,
 *  Barrier) answer a burst; one latency clock for landed controls; "outside every
 *  attempt window" is a time test; a cast whose aura has another id (Fear) is a
 *  real recast; APPLIED-then-REMOVED at one ms is a real end.
 *  v189 (2026-09-27, codex post-hoc review of batches 11–13 + agy re-review of
 *  batch 14): missed-sync-window reach counts only while the owner can act and
 *  abstains for a burst target never positioned then; folded locks obey the
 *  Solo Shuffle round end; the wall-up-at-opening test reads the raw offset;
 *  a spell-less absorb is a swing only on documents that record attack spells;
 *  a mind-controlled attacker keeps its roster number; [GROUNDED] says
 *  "redirected into"; a channel's reflects are one [REFLECTED] line; Sanctuary
 *  credit needs the removal at/after its landing and no self trinket/racial;
 *  a same-spell refusal for another reason splits a [REJECTED] run; [RES]
 *  kicks / Death Grip use the owner's talent-resolved cooldown and charges.
 *  605 files: candidates byte-identical; [REFLECTED] 728 → 642 (merged
 *  duplicates only), [CC REMOVED] 786 → 768, [REJECTED] 2,181 → 2,071.
 *  v190 (2026-09-27, codex post-hoc review of batches 10 and 14): KITED needs
 *  the distance the owner opened from the enemy's starting spot (a chase no
 *  longer reads as a kite); HEALER TRAINED names a camper only for its own
 *  span and seconds; "you moved N yd" is one shared predicate
 *  (ownerDisplacementYards) re-derived by gate G4b at the rendered endpoints;
 *  a press inside the kick lockout is never "waited out"; [RES] kicks / Death
 *  Grip carry their charge cap and the ledger's event reductions (Storm
 *  Conduit). 605 files: candidates identical but one kick-eaten fact; KITED
 *  1,229 → 1,056, camped-by 1,423 → 1,387; Death Grip charges shown 0 → 355;
 *  positioning gate 0 / 6,109 geo claims, a +0.4 yd mutation caught.
 *  v191 (2026-09-28, codex re-check of the PV189/190 judgment calls): KITED
 *  credits the owner's Shapley share of the gap change to the start enemy
 *  (start and peak spots averaged — neither one-ended difference nor a
 *  projection); a reflected hit belongs to one chain (its named reflector's,
 *  else the latest); missed-sync reach abstains for a target alive while the
 *  owner was free but never seen together with the owner. 605 files:
 *  candidates identical; KITED 1,056 → 916 (a projection tried first gave
 *  512 — lateral kites lost, pulled); [REFLECTED] 642 → 642.
 *  v192 (2026-09-30, triage 2026-09-29 cd-hoarded-waste H23 + H4): the
 *  cannot-cast intervals pair an aura in log order (a same-millisecond
 *  re-application no longer lasts 0 ms) and count enemy pets / totems as
 *  sources (`enemySourceIds`); the cd-hoarded owner gate stops at the match
 *  end / Solo Shuffle round-ending death. 605 files: cd-hoarded 679 → 665,
 *  missed-cleanse 445 → 438, healing-gap 48 → 46, kick-priority −4 / +1.
 *  v193 (2026-09-30, triage cd-hoarded-waste F-H1): cd-hoarded carries what
 *  the owner gate saw — facts.ownerCc (the blocking CC / kick lockouts,
 *  offsets from t) and facts.ownerFreeS (free seconds after t, cut at death
 *  and the round end) — from the gate's own inputs (`actWindowFor`); the
 *  legend says to coach only the free part. 605 files: ids and contexts
 *  identical; 640 of 1,308 cd-hoarded lines gain ownerCc.
 *  v194 (2026-09-30, triage cd-hoarded-waste F-W2 + F-W4): "never pressed"
 *  (cd-waste, loadout [UNUSED], the low-pressure NOTE) counts a press of the
 *  same DB2 charge pool (`cdNeverSpent`); the NOTE names only never-spent,
 *  pressable, self-only defensives and no longer says "do NOT coach pressing
 *  defensives". 605 files: cd-waste 983 → 938, [UNUSED] 27,145 → 26,642,
 *  NOTE 1,033 → 938.
 *  v195 (2026-09-30, triage cd-hoarded-waste F-H3): a crisis point's
 *  dmg2s / attackers / school split sum the 2 s up to the HP reading
 *  `gridHpPct` used (`gridHpSample`), never past the anchor second, instead
 *  of the 2 s up to the whole second; legends say so. 605 files: cd-hoarded
 *  +16 / −11 (10 up / 5 down across the dangerous floor, 6 swaps).
 *  v196 (2026-09-30, triage cd-hoarded-waste F-S1): slow-defensive-response
 *  carries facts.attempted — the owner's rejected presses of their
 *  ally-reaching saves inside the judged window — with its own legend note
 *  (the line's spell is the enemy opener). 605 files: ids identical, 4 of 131
 *  lines gain attempted.
 *  v197 (2026-09-30, triage cd-hoarded-waste F-H18 + F-H19 + F-H17): a
 *  [STATE] tick at every friendly crisis anchor second (gate
 *  checkCrisisStateTickPresent); the owner's casts on the crisis unit stay
 *  unfolded inside a cd-hoarded window; Alter Time's return is rendered
 *  (`| returned +Ns`, a [TEAM] return line). 605 files: menus identical;
 *  crisis lines without a tick 735 → 0; [STATE] +2.1 %, [YOU] [CAST] +5.8 %;
 *  returns rendered 0 → 553.
 *  v198 (2026-09-30, triage cd-hoarded-waste F-H2 + F-H5 + F-H7 + F-H9,
 *  user rulings of the same day): cd-hoarded states when a rejected press
 *  happened and the free time after it (facts.attemptedAt,
 *  facts.freeAfterAttemptS — the legend forbids "held" only below
 *  REACTION_WINDOW_S), the window really left (facts.windowS), and saves
 *  the crisis unit or another teammate pressed (facts.crisisUnitSaved,
 *  facts.teamAnswered — stated, not credited). 605 files: ids identical,
 *  634 of 1,313 lines gain facts.
 *  v199 (2026-09-30, triage cd-hoarded-waste F-W1, ruling R7 = A): cd-waste
 *  says "never successfully cast" and carries facts.attempted (rejected
 *  presses up to the owner's playable end); audit downgrade. 605 files: ids
 *  identical, 15 of 938 lines gain attempted.
 *  v200 (2026-09-30, triage cd-hoarded-waste F-H21, ruling R11 = B): one
 *  decision, one card — a cd-hoarded card for an external-unused card's
 *  victim within 5 s of that death (on the render grid) is dropped; the
 *  external-unused card stays. 605 files: cd-hoarded −63, nothing added.
 *  v201 (2026-09-30, triage cd-hoarded-waste F-H6, ruling A8): a cooldown
 *  the owner could not pay for at any mana sample in [t, t+5]
 *  (`affordableWithin`, shared with [RES] F-C3) is not named ready by
 *  cd-hoarded. 605 files: cd-hoarded −1, nothing added.
 *  v202 (2026-09-30, triage cd-hoarded-waste F-H10, ruling A9-1): Emerald
 *  Communion is a team heal / save (TEAM_HEAL_CD_IDS): its press answers a
 *  teammate crisis and it can be named ready for one. 605 files:
 *  cd-hoarded +9 / −10, slow-defensive-response −1.
 *  v203 (2026-09-30, triage cd-hoarded-waste F-H16, ruling A9-2): Mass
 *  Invisibility is a Defensive in the Mage ledger and can be accused; for a
 *  teammate it counts only with PvP talent 415945 (`cdCanHelpAnotherUnit`).
 *  605 files: cd-hoarded +31 / −13, cd-waste +51.
 *  v204 (2026-09-30, triage cd-hoarded-waste H15, ruling A9-3): Feign Death
 *  is in the Hunter ledger; its Survival Tactics aura is activation AND
 *  ownership evidence (`AURA_ACTIVATION_PROVES_BUTTON_IDS`); it is a
 *  response only (`RESPONSE_ONLY_DEFENSIVE_IDS`) — a press answers the
 *  owner's own crisis, no accusation or `cheaper available:` names it.
 *  v205 (2026-09-30, triage cd-hoarded-waste F-H16 follow-up, user ruling):
 *  cd-waste never names Mass Invisibility (`CD_WASTE_EXCLUDED_IDS`) — it is
 *  accusable in cd-hoarded only. 605 files: cd-waste −51.
 *  v206 (2026-09-30, triage cd-hoarded-waste F-H20, user ruling): the
 *  crisis school gate reads `saveSchoolMask` — the signed MITIGATION_TABLE
 *  mask, else the DB2 absorb mask — so Anti-Magic Shell (0x7e) is a ready
 *  save only for a crisis at least half magic. 605 files: cd-hoarded −7 / +3
 *  (cap substitutions), 1 line loses AMS.
 *  v207 (2026-09-30, triage G7-P1: enemy-def F-E10b + missed-cleanse F-P4):
 *  Heroism 204362 (the Alliance PvP-talent twin of Bloodlust 204361) is an
 *  offensive buff in SPELL_CATEGORIES — enemy Heroism renders as [ENEMY CD]
 *  and feeds the offensive windows; a purge of it is High ([ENEMY PURGE]).
 *  v208 (2026-10-01, the user's own 3v3 loss review, rulings 2026-09-30):
 *  3v3 menu stops at the first friendly death (playableEndMs, healing gaps
 *  clipped there too); [IMMUNE] only for a player / the cast's own target;
 *  a Spirit of Redemption carrying Divine Hymn gets no `cheaper available:`;
 *  KILL WINDOW free ≤ window; aura cap ranks offensive CDs; audit drops a
 *  finding with no string title/explanation. Numbers in the commit.
 *  v209 (2026-09-30, triage enemy-def F-E27): a control that reaches a
 *  Grounding Totem as an IMMUNE miss with no cast aimed at the totem (a
 *  trap) is a redirect too (`groundingRedirects`, shared by [GROUNDED] and
 *  the shaman's [CC AVOIDED?] credit).
 *  v210 (2026-09-30, triage enemy-def F-E14, ruling A30): a friendly whose
 *  only hits on the target in the 3 s before an ally-applied external were
 *  periodic now qualifies for `[ENEMY DEF] … | during it:` (and the owner's
 *  burst-into-mitigation `facts.duringExternal`).
 *  v211 (2026-09-30, triage enemy-def F-E28, ruling A28): a friendly
 *  [DEATH] line's trinket tag reads `(PvP Trinket available; no breakable
 *  CC in the last 10 s)` unless a [CC ON TEAM] instance on them rendered
 *  ≥ 2 s overlaps the 10 s before (`breakableCcBeforeDeath`, gate
 *  `checkDeathTrinketCcConsistency`).
 *  v212 (2026-09-30, triage sync-burst F-B3 / F-B7 / F-B4): [BURST ANSWERED]
 *  prints its bottom's second (`bottomed at P% at M:SS`, gate
 *  `checkBurstAnsweredBottomConsistency`); another friendly's self-only heal
 *  CD is not credited; a pre-opener aimed control whose aura was gone at the
 *  lead cast is not credited (`aimedControlUpAt`). `responded` unchanged.
 *  v213 (2026-10-01, triage cd-hoarded-waste F-H12, ruling C1): a GCD reject
 *  of a cooldown ready at that press and never cast later in the window is
 *  an attempt in cd-hoarded's `facts.attempted` (accusation not waived).
 *  605 files: 4 cd-hoarded lines gain it, no id changes.
 *  v214 (2026-09-30, triage res-readiness F-C16 / F-C17): a legend line for
 *  `next spike in Ns on X` (hindsight) whenever one is rendered; the
 *  per-cast [YOU] [CAST] legend only for healer owners (its emitter's gate).
 *  v215 (2026-09-30, triage G7-P3: res-readiness F-C2 + enemy-def F-E8 /
 *  F-E10, rulings A26 = A, A27 = B): the [ENEMY CD] cast ordinal reads
 *  `(cast k of N)` (`[k/N]` is the charges notation), with a legend line; an
 *  enemy healer's throughput majors (ENEMY_HEAL_CD_IDS: the team heals,
 *  Apotheosis, Serenity, Spirit of the Redeemer, Time Spiral, Stasis) and
 *  Avenging Crusader render as `[ENEMY HEAL CD]`, outside every burst window.
 *  v216 (2026-10-01, triage hp-state F-S1): a defensive whose official
 *  targeting cannot reach an ally renders its HP part on the caster
 *  (`rendersOnCaster`) — Survival of the Fittest's [YOU] [CD] line reads
 *  `(self: N% HP, …)` instead of its cast target's HP. 605 files: 474 lines,
 *  no id changes.
 *  v217 (2026-10-01, triage hp-state F-L1 + other F-O3): the HP trail under a
 *  death line reads `HP (T = m:ss, the death line's second): …` and samples
 *  with HP_SAMPLE_RADIUS_MS; the missed-sync-window legend calls
 *  facts.cellKey a game mode, not a rating tier. 605 files: 4,266 trail lines
 *  reworded, 0 values, no id changes.
 *  v218 (2026-10-01, triage position F-J1): [REJECTED] runs recognise the
 *  zh-TW, es-MX, fr-FR and ru-RU client strings for out of range / moving /
 *  line of sight (official GlobalStrings). 605 files: +69 lines in 31 owner
 *  files, no id changes.
 *  v219 (2026-10-01, triage other F-O8): Alter Time's loadout label reads
 *  `lasts 10s` (the official duration of the aura 342246 the press 342245
 *  applies; the press row's 20 s was printed). 605 files: 1,512 loadout
 *  lines, no id changes.
 *  v220 (2026-10-01, triage other F-O1, ruling A59 = C then A): no `[MATCH
 *  PATTERN]` header — its labels came from a different clustering run than
 *  the model (`ARCHETYPE_LABELS_MATCH_MODEL` false;
 *  test/archetypeLabelAlignment.test.ts requires the flag to equal the
 *  computed alignment).
 *  v221 (2026-10-01, triage other F-O13 + F-O14): a Blessing of Freedom /
 *  Tiger's Lust cast on a teammate is not the caster's own `[CC AVOIDED?]`
 *  tool; a channel whose own aura ends within 250 ms after a CC lands on the
 *  owner reads `[channel cut by CC after N.Ns]` on its [YOU] [CAST] line
 *  instead of `[cast succeeded before CC landed]`.
 *  v222 (2026-10-01, triage pets-summons F-PS1): the roster `[pet: …]` tag
 *  lists every permanent pet a warlock ran, in order (`Sayaad — …; Felhunter
 *  from 0:36 — …`), from Pet- GUIDs only — a temporary Creature- summon no
 *  longer names the pet.
 *  v223 (2026-10-01, triage crisis-external F-C1, ruling A48 = C):
 *  crisis-no-response says "did not answer it by this measure", not "did
 *  NOTHING", and its facts carry what the owner pressed — selfHealPct (fresh
 *  self-heal landed, % of max HP), selfHealCasts and dampeningPct. Predicate,
 *  ids and the reference table unchanged.
 *  v224 (2026-10-01): triage kick-eaten F-K14a. An enemy interrupt the game
 *  rejected as IMMUNE on a friendly player is a timeline line:
 *  `[KICK] <kicker>'s <Kick> on <victim> missed — IMMUNE (<aura>)`. The
 *  aura is named only when DB2 marks it interrupt-immune and it covered the
 *  miss (shared pairing `buildAuraIntervals`); two at once are both named
 *  ("A + B"); none known = bare IMMUNE.
 *  v225 (2026-09-30, triage death-kill F-B1): a [BUFF FADED] buff removed
 *  from the owner ≤ DEATH_CASCADE_MS (100 ms, editorial) before the owner's
 *  death reads `(removed at your death)`, not "ended early" / "own
 *  shapeshift"; a removal from a teammate keeps its cause (codex c2).
 *  v226 (2026-09-30, triage sync-burst F-B6 / F-B8): a death in a burst
 *  window's last rendered second counts (`died`, hence `deathsInWindow` /
 *  `anyFriendlyDeath` / the death suffix); a landed control is timed from a
 *  cast aimed at its target (or of its own spell) before any untargeted cast.
 *  v227 (2026-09-30, triage sync-burst F-S2 / F-S6 / F-S7): the
 *  missed-sync-window line gains facts pressedAfter (a ready CD pressed ≤ 2 s
 *  after the lock, A36 = A), readyFrom (a CD back within the 2 s lead or
 *  mid-lock, raw return), holderCc (the holder's own cannot-cast intervals
 *  in the lock) and enemyMinHpUnit, with legend sentences. Ids unchanged.
 *  v228 (2026-09-30, triage sync-burst F-L4 / F-L7): a multi-CD burst
 *  ledger header gives each CD its own span (`Name m:ss–m:ss`); the KILL
 *  SEQUENCE `[ENEMY CD]` line gives each CD cast after the window's first
 *  second its own `@m:ss`.
 *  v229 (2026-09-30, triage missed-cleanse F-P3 / F-P2 / F-P1, ruling A18):
 *  [MINOR DISPELS] parts list their casts (`Spell ×N (m:ss removed names; …,
 *  +N)`, ×N = casts); a healer owner's cast line annotates every removal it
 *  matched; the owner's Critical/High purges render as [PURGE] unless that
 *  same match put them on a healer cast line (`purgeMatchesCast`).
 *  v230 (2026-09-30, triage res-readiness F-C10, ruling A47): the kill /
 *  vulnerable window's team damage (bursts, `team damage Nk`) counts owned
 *  pets and guardians, attributed by source GUID (`summonOwnerById`).
 *  v231 (2026-09-30, triage res-readiness F-C1, ruling A45 = A): a press
 *  is spent from the second it is rendered at (`pressSpentBy`: floor(press)
 *  ≤ t, besides the 0.5 s slack) in every availability predicate — the
 *  cdAvailableAt family, the [RES] ledger, lastCastBefore, isAvailableAt —
 *  so the [RES] row under a cast line no longer lists that cast ready.
 *  v232 (2026-09-30, triage G7-P9: res-readiness F-C20 + sync-burst F-S4,
 *  ruling A′1 = A): Army of the Dead, Dark Transformation, Bloodlust 204361
 *  and Heroism 204362 join the class rosters (loadout, [RES], kill-window
 *  "ready", msw entered / ready); talentModifiers.json drops Shamanism's row
 *  301624 (replace_spell → 8, no such spell), so the lusts are pressed
 *  buttons, not procs; datagen rejects such rows.
 *  v233 (2026-09-30, triage missed-cleanse F-C5, rulings A40 = B / U7): a
 *  root missed-cleanse item carries rootReachProvenS=N/M when the [ROOT]
 *  predicate's own sweep proved the rooted player could reach their targets
 *  on every non-hard-CC second (hard-CC seconds leave N), with a legend
 *  sentence; the [ROOT] line and menu membership are unchanged.
 *  v234 (2026-09-30, triage missed-cleanse F-C11 + F-C17, ruling A43 = B):
 *  one occupancy predicate (`occupancyWithin`: hard casts ∪ Ultimate
 *  Penitence's self-aura ∪ drinking) for ownerCasting* and the new
 *  dispellerCasting* (ownerCanDispel=no: the least-occupied eligible
 *  dispeller), with a legend sentence; occupancy spell names are English.
 *  v235 (2026-09-30, triage missed-cleanse F-C13 / F-C12 / F-C14 / F-C16):
 *  missed-cleanse facts gain coRemovesBacklash (same-type backlash debuffs on
 *  the target, `getDispelPenalty`, ruling A44), ownerDispelSpell (the
 *  owner's button, talent-gated), attempted (rejected cleanse presses, the
 *  intent-guard filter), with legend sentences; drChainRisk is no for ids
 *  no DR family claims (curses), roots keep their self-DR.
 *  v236 (2026-09-30, triage missed-cleanse F-C6 / F-C4 / F-C7 / F-C15;
 *  rulings A41-签, A39 = B, U4 = B-all, U6): 16 signed dispel-verdict rows
 *  (Polymorph / Hex variants, Void Tendrils, Deathmark exit); a signed id's
 *  missed-cleanse item is admitted by and renders its 08-19 cell (worth=,
 *  a zero-damage must shows worth), unsigned ids keep priority= plus
 *  verdict=unsigned; the legend names worth / verdict, calls the debuff a
 *  "CC, root or curse" and says the owner "has no dispel spell" for it.
 *  v237 (2026-09-30, triage missed-cleanse F-B1 / F-B2): backlash-dispel's
 *  "every cleanse still on cooldown" reads `cleanseRecoveryOf` per dispeller
 *  (PvP +4 s Cleanse, Purify's 2nd charge), and the point gains
 *  cdCcBlockedS (how long the CC ran with every cleanse down), in the legend.
 *  v238 (2026-09-30, triage missed-cleanse F-P5 + F-P7, ruling A19 = C):
 *  the Devourer DH and every Hunter spec are offensive purgers (talent-gated
 *  like DH); the "Critical only" gate reads each purger's purge spell DB2
 *  cooldown (`isCdGatedPurger`, replaces the CD_GATED_PURGERS spec list:
 *  Greater Purge 12 s and Tranquilizing Shot 10 s now gate); a missed purge
 *  says when the purge came back, from cooldown-consuming casts
 *  (`purgeReadyAtSeconds`: "purge on cooldown for the whole buff" /
 *  "… at application — ready at m:ss (Ns of the buff left)").
 *  v239 (2026-09-30, triage G7-P2: enemy-def F-E19 + res-readiness F-C15):
 *  one "used the PvP trinket" predicate (`pvpTrinketUses`: Medallion 336126
 *  cast ∪ Adaptation's 283167 trigger aura — the 195756 cast id is dead) for
 *  [TRINKET] / [ENEMY TRINKET], every trinket-readiness reader, KA and
 *  Sanctuary; Adaptation's return is its 336139 lockout interval.
 *  v240 (2026-09-30, triage missed-cleanse F-C8 / F-C9, ruling A42): the
 *  dispel reach sweep samples round-relative whole seconds from
 *  ceil(applyRel) (`dispelReachSweepStartMs`), and reads the zone from
 *  `startInfo.zoneId` so line of sight is actually evaluated (also
 *  momentSnapshot's facts.los).
 *  v241 (2026-10-01, triage enemy-def F-E7 / F-E4 / F-E9, rulings A11 / A20 /
 *  U3): an enemy's absorb / heal / avoidance self-saves (Dark Pact, Evasion,
 *  Healthstone, Ice Barrier, Death Pact …), Lay on Hands and the grips /
 *  redirects (Leap of Faith, Intervene, Roar of Sacrifice, Master's Call)
 *  render as [ENEMY DEF] lines and are KILL ATTEMPTS failure causes, from
 *  enemy-only id sets no friendly roster reads. Anti-Magic Shell follows with
 *  its school gate. Menu ids unchanged.
 *  v242 (2026-10-01, triage enemy-def F-E5 / F-E6 / F-E12, ruling A25):
 *  [ENEMY DEF] prints Burrow, Time Stop, Mass Invisibility, Vanish, Feign
 *  Death, Cheat Death, Cauterize, Nature's Guardian and Guardian of the
 *  Forgotten Queen as `immune`, and KILL ATTEMPTS reads each as a forced
 *  immunity; an aura re-announced with no REMOVED between is one press
 *  (`joinReappliedIntervals`), not two lines. Menu ids unchanged.
 *  v243 (2026-10-01, triage enemy-def F-E1a / F-E1b, crisis-external F-A1b,
 *  ruling A15): an enemy Blur / Greater Invisibility renders and counts as a
 *  popped wall (the logged aura is resolved to its cast-keyed table row);
 *  Anti-Magic Zone, Darkness, Rallying Cry, Spirit Link Totem and Power
 *  Word: Barrier render `X (area)` at the cast (rulings A15, P-E1b2).
 *  Menu ids unchanged.
 *  v244 (2026-10-02, triage missed-cleanse F-P5 forward check, rulings
 *  P-P5b = C / P-P5b-land): removals that are not a spec's Magic purge count
 *  inside their own scope (`scopedPurgeToolsOf`). A Warrior holding
 *  Shattering Throw gets `[MISSED PURGE OPPORTUNITY]` lines for immunity
 *  shields that lasted the 3 s reaction bar plus its 1.5 s cast, read off
 *  the throw's own cooldown and reach ("your removal for it: Shattering
 *  Throw (immunity shields only, 1.5s cast)"); the PURGE RESPONSIBILITY
 *  header states the scope ("CANNOT offensive purge, except Shattering
 *  Throw: …" / "except Arcane Torrent: …" for a player observed casting it).
 *  Arcane Torrent and Shiv never produce a line. A purge landing at the
 *  buff's end now counts (float boundary), so those buffs no longer read
 *  "unpurged". General purgers' lines are otherwise unchanged.
 *  v245 (2026-10-01, triage hp-state F-T1 + enemy-def F-E20): `cheaper
 *  available:` offers a nil-destination team save (Spirit Link Totem, Aura
 *  Mastery …) only tools that can help another unit, and a press made while
 *  stunned — or the press that ended the stun — only cooldowns usable while
 *  stunned; a [CC ON TEAM] instance ended by the unit's own immunity press
 *  reads `| <spell> broke this CC after Ns`.
 *  v246 (2026-10-01, triage kick-priority F-P1 / F-P2 / F-P3 / F-P5, rulings
 *  A57 = A, A'3 = A): kick-priority facts state the defenseless span the
 *  detector used (`windowFrom` / `windowTo`), the kick's range and the melee
 *  reach tested (`kickRangeYd`, `reachYd`), how long the kick had been back
 *  (`kickReadyForS`), and `rooted through the cast` instead of `out of range`
 *  for a rooted owner; legends reworded. Detector unchanged.
 *  v247 (2026-10-01, triage hp-state F-M1): the NOTE's "lowest HP this match"
 *  and the cd-waste pressure gate read the round only (`matchMinHpPct(unit,
 *  combat)`), not samples logged after its end.
 *  v248 (2026-10-01, triage G7-P4: res-readiness F-C3 + menu-coverage F-MC1,
 *  rulings A8 / A58 / U8 / P-G7P4): [RES] `rdy:` tags a ready cooldown the
 *  owner cannot pay for, `X(no mana a/b)`, with a legend when one is
 *  rendered; Darkness is a Defensive (cd-waste may name it), and a positional
 *  wall is named for another unit — cd-hoarded, [DEFENSIVE AVAILABLE] — only
 *  when its holder stood inside the zone; a burst window is not answerable on
 *  seconds after the pressured friendly died.
 *  v249 (2026-10-01): triage kick-eaten F-K7d / F-K7b / F-K7c / F-K7a
 *  (rulings C5, A32, A23, A′18). `postKick`: a spell is locked only when
 *  every school it belongs to is locked (Starsurge under a Nature lock is a
 *  switch, and its not-ready presses are its own cooldown); the switched
 *  line also prints the presses rejected inside the lock; a not-ready reject
 *  ≤ 0.3 s after the same spell succeeded is a key repeat and is not
 *  counted; "inside the lockout" ends at the first successful cast of the
 *  locked school (not on a cast that goes out inside a holding lock: Demonic
 *  Circle: Teleport, Holy Fire, passive rows). "Not ready" is recognised in
 *  fr / es / ru / zh-TW logs too. Legend updated to match.
 *  v250 (2026-10-01): triage kick-eaten F-K3 / F-K9b (rulings A31 = A,
 *  A33 = A). `enemyBurst` / `ourBurst` name only cooldowns already running
 *  when the kick landed (one pressed inside the lockout afterwards is not
 *  listed, so a kick can become harmless and leave the menu), and a unit's
 *  ticks inside an immunity are not its low HP. Legend updated.
 *  v251 (2026-10-01): triage kick-eaten F-K5a / F-K5b / F-K5d / F-K6a /
 *  F-K6b / F-K6c / F-K6d (ruling A12 = B with U2). New kick-eaten facts at
 *  cast start: `sourceDistYd`, `nearestKicker`, `maxKickRangeYd`,
 *  `sourceKickReadyAtCastStart`, `youImmobileAtCastStart`, and the single
 *  out-range verdict `outRangeable=yes|no (reason)` the legend now gates the
 *  "cast from outside kick range" advice on (closed, among others, by a
 *  gap-closer used or back up at any point of the cast, a kick during the
 *  channel, a cast range that does not exceed the kick, and another kicker
 *  in range whose kick came back during the cast); a kicker in
 *  hard CC or a silence is no longer counted; no `yourReachYd` for a
 *  caster-centred spell.
 *  v252 (2026-10-01): triage kick-eaten F-K7f / F-K13 / F-K14b / F-K4
 *  (rulings A′2 = B, U1). `postKick` presses carry their offset after the
 *  kick ("Riptide×3 +0.2/+0.9/+1.4s"); an empowered switching cast reads
 *  "empowered cast"; new fact `kickImmunityEnded`; the legend says which
 *  side was under pressure, never whom the kick helped.
 *  v253 (2026-10-01): triage G11 kick audit — other F-O4, sync-burst F-L6,
 *  kick-priority F-B1, kick-eaten F-K10a / F-K10b (rulings A35, A′17).
 *  `Kicks:` — one entry per kick (Skull Bash's two ids), a landed silence
 *  reads "silenced <target> (no cast interrupted)" — or "(their <spell> cast
 *  did not finish)" when the target was mid-cast — and a kick into a stopped
 *  cast that was then recast is "JUKED", not "hit nothing". kick-eaten: new
 *  fact `stoppedJustBefore`; a cast broken by an enemy displacement is not
 *  one of `yourCancels`; `baitedKicks` follows the juke rule.
 *  v254 (2026-10-01): triage G16, ruling A14 = B — `burstCastSpan` loses its
 *  10 s floor for every reader: burst ledger groups / spans / `Aligned with`,
 *  KILL ATTEMPTS burst clusters, kick-eaten `enemyBurst` / `ourBurst`. An
 *  instant cooldown is no longer "running" for 10 s, and a zero-length burst
 *  (Soul Fire) prints no "No damage dealt" line. The observed-aura half of
 *  the ruling waits for the cast→effect table (G3).
 *  v255 (2026-10-01): triage kick-eaten F-K2 (ruling C7). Empower Rune
 *  Weapon 47568 is no longer an offensive cooldown: the 120 s / 20 s hand
 *  override and the Offensive tag are gone (12.x: 2 charges / 30 s, a damage
 *  button with no aura), so it opens no `[ENEMY CD]` / `[OFFENSIVE WINDOW]`
 *  / `enemyBurst` any more and leaves the Frost Death Knight ledger.
 *  v256 (2026-10-01): triage kick-eaten F-K12a (ruling A34, and the user's
 *  2026-10-01 ruling on the exempt pool). Inside a coachability tier the cap
 *  orders kicks by pressure (death, crisis HP, burst running, burst ready),
 *  then time; kicks with a death or a crisis-HP fact do not count toward
 *  KICK_EATEN_CAP and have a cap of their own (2), so a round lists at most
 *  2 + 2 kick-eaten lines.
 *  v257 (2026-10-01, triage enemy-def F-E15): a trinket / racial break is
 *  credited to the active CC with the most official time left
 *  (`bindBreakToWindow`), not the longest-running one — [CC ON TEAM] `trinket
 *  broke this CC` and [ENEMY TRINKET] `out of X` name that CC.
 *  v258 (2026-10-01, triage G6: other F-O6 + missed-cleanse F-C10 + pets
 *  F-PS2): (1) an owner empower that ended in SPELL_EMPOWER_INTERRUPT renders
 *  `[EMPOWER not released — cut short after Ns]` on its press line (it
 *  released nothing; the parser now keeps SPELL_EMPOWER_START / _INTERRUPT, so
 *  fresh parses only; no cause is asserted — CC, kick, movement and an early
 *  let-go all log the same event); (2) missed-cleanse `ownerCastingS` /
 *  `ownerCastingSpells` / `ownerCastingPreCommitted` (and a teammate's
 *  dispellerCasting*, through `occupancyWithin`) count empowered holds
 *  (fresh parses) and channels (every document) — `castCommitSpans.ts` —
 *  which have no SPELL_CAST_START bar; (3) a guardian with no SPELL_SUMMON in
 *  the round takes its owner from its advanced block (fresh parses only), so
 *  a totem's CC gets its [CC ON TEAM] line. 605 files: ids unchanged; 77
 *  not-released tags, 4 [EMPOWER L?] tags move to the press that released, 38
 *  missed-cleanse items change casting facts (25 owner, 13 teammate), +3
 *  [CC ON TEAM] lines.
 *  v259 (2026-10-01, triage death-kill F-K3, user-approved): a hit a shield
 *  ate is damage to the unit that was HIT — the attacker's absorb rows named
 *  the shield's owner, so a healer shielding a teammate became the "target".
 *  605 files: +1 burst-into-mitigation (the burst's real target sat in an
 *  external); KILL ATTEMPTS rows 29,055 -> 28,115 with the target changed in
 *  117 rounds, burst-ledger `Target:` changed on 314 owner files; Off-target,
 *  [KILL WINDOW] and [VULNERABLE] damage follow.
 *  v260 (2026-10-01, triage missed-cleanse F-C2, ruling A38 = A — reverses
 *  adjudication #13): a damage event's effectiveAmount is the health it
 *  removed, `amount − overkill`. The log's `amount` is already net of the
 *  absorb; subtracting `absorbed` again under-read every partly absorbed hit
 *  (25.9 % of player hits; +6.96 % overall, up to +19 % for specs with their
 *  own shields) and gave hits with absorbed > amount the wrong sign. Every
 *  damage reading moves. 605 files: menu +22 / -17 (cd-hoarded +19 -5,
 *  slow-defensive-response +1, position-mistake +2, missed-cleanse -6,
 *  questionable-external -6), 683 fact-only changes, KILL ATTEMPTS outcome
 *  flips in 219 rounds (healed through 4,479 -> 3,954).
 *  v261 (2026-10-02, triage G4 dead-at: sync-burst F-S1 + F-KW2,
 *  res-readiness F-C4, kick-eaten F-K7e): one dead-at predicate
 *  (`utils/unitDeath.ts`). (1) A cooldown whose holder is dead at the instant
 *  is not "ready" for a missed-sync-window lock nor on a [KILL WINDOW] /
 *  [VULNERABLE] line — a span whose only ready cooldown was a dead player's
 *  stops being accountable. (2) [RES] `rdy:` / `cd:` drop a holder's entries
 *  from the second after its death, with no `-X` for them. (3) kick-eaten
 *  `postKick` ends at the player's death: `no cast before dying Ns after the
 *  kick`, and a button pressed after the death is not a rejected press.
 *  v262 (2026-10-02, triage G4 kickers: kick-eaten F-K5c, res-readiness
 *  F-C5 + F-C5b, ruling A′16): (1) kick-eaten's cast-start kicker facts
 *  (`kickersInRange`, `nearestKicker*`, `maxKickRangeYd`) read a kicker's
 *  cooldown from its kicks strictly BEFORE the cast start — a kick thrown in
 *  the cast-start millisecond was ready when the cast began. (2) `enemy
 *  interrupts UP` on a channeled [YOU] [CD] line and [CONTESTED] `enemy
 *  interrupts ready: N` mean usable at that instant: a dead enemy is not
 *  listed, and a kicker inside a cast-blocking CC (a silence only for a
 *  silenceable kick; a pet kick is asked of the pet) is not UP — when every
 *  off-cooldown kicker is held the note reads `no enemy interrupt usable
 *  (CC'd: X)`. A legend line is printed with the note.
 *  v263 (2026-10-02, triage G4 kill-window readiness: sync-burst F-KW1,
 *  res-readiness F-C8 + F-C9 + F-C12, ruling A46): one grammar for the
 *  readiness clause of [KILL WINDOW] / [VULNERABLE] lines — `team offensive
 *  CDs ready at M:SS: <list | none>` followed, when there is anything to
 *  say, by one parenthesis: `may already be back: X ≤Ns` (GH #106 step 3),
 *  `pressed at start: X M:SS`, `back inside: X M:SS`, `pressed inside: X
 *  M:SS`. Readiness is sampled on the span start's rendered second (A46),
 *  not the fractional start; a proc-only entry is never "pressed"; a
 *  [VULNERABLE] acquittal with a maybe-ready cooldown reads `no offensive CD
 *  certainly ready (may already be back: …)`. The accusation gate still reads
 *  the certain list only.
 *  v264 (2026-10-02, triage position F-K1, ruling A61 = A): the kill-window
 *  `target unreachable (positions recorded)` part and the [VULNERABLE]
 *  acquittal `target unreachable` are decided over the whole span, one
 *  rendered second at a time — reachable as soon as any living friendly could
 *  reach the target on any second — instead of at the span's first instant.
 *  v265 (2026-10-03, triage G7-P6: death-kill F-T1 + hp-state F-D1): the side
 *  of a damage source is its roster's (a charm flips the per-event flags),
 *  and a row that flags its source or victim as a charmed player is never
 *  same-side; Top sources / the final-5 s block / [KILL] keep enemy damage
 *  and a Mind-Controlled teammate's hits (named as that player,
 *  mind-controlled); a team's own redistribution (Spirit Link, Void Leech) is
 *  not incoming pressure for [DMG SPIKE], [OFFENSIVE WINDOW], the [YOU] DPS
 *  part or [RES] focus.
 *  v266 (2026-10-03, triage kick-priority F-P3 / F-P5 follow-ups):
 *  kick-priority's facts.reachYd appears only when the kicker stood outside
 *  the kick's range and had to run; legend: kickReadyForS is absent when the
 *  kick was never used or never ran out of charges.
 *  v267 (2026-10-03, triage G7-P4 follow-up): the [RES] legend says a delta
 *  row carries the (no mana a/b) tag only where the cooldown is listed.
 *  v268 (2026-10-02): triage kick-eaten F-K9b, user ruling F-K9b-B. Only a
 *  FULL immunity (Ice Block, Divine Shield, Aspect of the Turtle) keeps a
 *  unit from being read as low in kick-eaten's `ourLow*` / `theirLow*`; under
 *  Blessing of Protection, Blessing of Spellwarding or Cloak of Shadows it is
 *  read as low again, and the legend says so. Interim until enemy-def F-E24.
 *  v269 (2026-10-03, triage G14: sync-burst F-L2 / F-L2b, position F-S1–F-S5,
 *  rulings A'12 / A'13 = C / A60 = B / P-G14 / F-K9b-B): a POSITIONING line's
 *  burst target is the one of its own span (the header spike only when it
 *  covers half the span, else the most-pressured friendly); STAYED IN states
 *  `CC'd Ns of Ns`, `rooted Ns` (with `(Ns in all)` when both), `(you could
 *  not cast for Ns of it)` and `(HP stayed at or above 35%)` in place of `(no
 *  real cost)`; windows mostly spent CC'd, rooted or inside the owner's own
 *  FULL immunity are skipped; stayed-in menu facts gain endDist / minDist /
 *  maxDist / endEnemy / ccS / rootS.
 *  v270 (2026-10-02, triage G3 table, ruling A10 = both): the one cast →
 *  effect-aura table (`data/castEffectAuras.ts`, DB2-nominated by name /
 *  trigger chain, corpus-verified — 148 casts / 189 pairs) replaces the hand
 *  list `CC_CAST_EFFECT_AURA`. Its readers — a cast's DR category, the
 *  control-cast sets of the crisis and burst-window decision points, the
 *  aura-interval rebroadcast test — now also know Storm Bolt → 132169,
 *  Freezing Trap → 203337 (Diamond Ice) and the other verified pairs.
 *  v271 (2026-10-02, triage G3 timeline tags: enemy-def F-E25b / F-E25a /
 *  F-E26, cc-dr F-TM1 (A53) / F-NE1 (A55), crisis-external F-T1): an IMMUNE
 *  / MISS logged under a cast's effect id tags the cast; a line that names
 *  its targets says `[IMMUNE: <pid>]` for an immune player it does not name
 *  and nothing for an unnamed non-player; a non-CC hostile press into an
 *  immunity is tagged; a teammate's CC that missed says `[MISSED on …]`; a
 *  teammate's ally-reaching press on another friendly names it (` →
 *  <pid>`); an aimed owner CC with no aura and no miss says `[no CC aura
 *  logged]`.
 *  v272 (2026-10-02, triage G3 table consumers: res-readiness F-C23,
 *  sync-burst F-B1): healer offense counts an owner CC cast through the cast
 *  → effect table (Song of Chi-Ji, Lightning Lasso, Blinding Light …: "your
 *  CC ready", "you cast CC", the CC counts), and `[BURST ANSWERED]` credits
 *  an aimed control only when it landed (its own aura, an effect aura, or
 *  for an interrupt the SPELL_INTERRUPT).
 *  v273 (2026-10-02, triage G12 cannot-cast inputs: cc-dr F-SR1 (A52) +
 *  F-BK1, kick-eaten F-K8 (A23)): a CC / silence a unit's reflect sent back
 *  onto it locks it — `[CC ON TEAM] … (reflected back)` / `[SILENCE] …
 *  (reflected back)` — and counts in its DR; the dispel-backlash silence /
 *  horror (196364, 87204) locks the dispeller; a Storm Conduit holder's
 *  interrupted Lightning Bolt / Chain Lightning locks for ×0.6 (kick-eaten
 *  `lockout=`, [CONSEQ], [RES] `cc:[kick]`, cannot-cast feasibility).
 *  v274 (2026-10-02, user ruling F-BI-full): the burst ledger's "⚠ Target
 *  was IMMUNE" (and the desktop 打进免疫 chip) counts only a FULL immunity —
 *  Ice Block, Divine Shield, Aspect of the Turtle (`FULL_IMMUNITY_IDS`, the
 *  F-K9b-B split). Cloak of Shadows, Blessing of Protection and Blessing of
 *  Spellwarding show as the target's defensive ("Target had a major
 *  defensive up"); burst-into-mitigation still ignores them.
 *  v275 (2026-10-02, triage G9 round end: cc-dr F-CI1 / F-HG1,
 *  missed-cleanse F-C3): one round end (`roundEndMs`: a Solo Shuffle round's
 *  first player death, else the combat end) for `[CC ON TEAM]` / `[CC ON
 *  ENEMY]` windows, uncleansed windows and healing gaps — a CC applied at or
 *  after it is dropped, a removal or activity after it no longer lengthens a
 *  window or closes a gap.
 *  v276 (2026-10-02, triage cc-dr F-RF1, ruling A51 = A): a REFRESH of a CC
 *  whose source cast it (its own id or through the cast → effect table) in
 *  the 3 s before is a new CC on both sides — `[CC ON TEAM]` / `[CC ON
 *  ENEMY]` print the second cast with its own DR, and every reader of the
 *  instances ([CONSEQ], [RES] `cc:`, death-setup, HEALER EXPOSURE, kill-window
 *  enemy healer DR) sees two CCs.
 *  v277 (2026-10-02, triage enemy-def F-E17 / F-E18, cc-dr F-DA1 (A54 =
 *  A)): a silence a trinket broke is tagged when the press is logged up to
 *  `TRINKET_BREAK_AFTER_REMOVAL_MS` after the removal; `[TRINKET] … used PvP
 *  trinket out of <disarm> (by X)` when the press broke a disarm; a new
 *  `[DISARM]` line (and legend) for a disarm on any player of our team, with
 *  the same trinket-break tail.
 *  v278 (2026-10-02, triage position F-L1 / F-D1): `[CC ON TEAM]` drops
 *  "LoS blocked" when the CC's targeted cast succeeded on that unit just
 *  before (GH #83: a landed cast proves LoS), and drops the caster distance
 *  right after a Shadowstep when it is beyond the spell's reach (the log's
 *  stale pre-teleport position).
 *  v279 (2026-10-02, triage cc-dr F-DU1): one CC duration formatter
 *  (`renderedCcSeconds`, whole seconds) — the `[DMG SPIKE]` "enemy CC in
 *  window" list prints `(2s)`, not `(1.5s)`, matching `[CC ON TEAM]`;
 *  `[CC ON ENEMY]`, `[CONSEQ]`, `[DISARM]` and FORCED TRINKET read it too.
 *  v280 (2026-10-02, triage G5 death setup: death-kill F-S1 / F-L2 (A16),
 *  crisis-external F-AS1 / F-D2 (A′5) / F-D3 (A49 = B)): healer-locked names
 *  the qualifying CC that ends latest and carries `chain` / `chainFrom` /
 *  `lockedS` / `freeBeforeDeathS` / `landedWhileLocked`; the legend says what
 *  the lock was (the CROSS-THEME G5 sentence); a death or death-setup after
 *  the log owner's own death leaves the menu.
 *  v281 (2026-10-02, triage death-kill F-D1): the "death" legend prints
 *  only when the menu has a death and no longer defines a side=enemy death
 *  (kill review is retired).
 *  v282 (2026-10-02, triage death-kill F-M1, ruling A′8): the
 *  missed-options "caster in CC / was in CC" tags ask the cannot-cast
 *  predicate (silences and kick lockouts lock a caster), and a CC the unit
 *  trinketed out of counts until the press in the lockout window.
 */
export const PROMPT_VERSION = 282;
