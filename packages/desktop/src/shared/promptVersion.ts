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
 */
export const PROMPT_VERSION = 174;
