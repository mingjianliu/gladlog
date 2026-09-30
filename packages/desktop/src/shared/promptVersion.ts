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
 */
export const PROMPT_VERSION = 225;
