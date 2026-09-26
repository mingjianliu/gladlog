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
 */
export const PROMPT_VERSION = 168;
