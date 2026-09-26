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
 */
export const PROMPT_VERSION = 168;
