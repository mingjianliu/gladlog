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
 *  v165 (2026-09-26, reliability round 3 wave 2, audit 1bad): Mind Control's
 *  possession radius (100 yd on its single-target MOD_POSSESS row) no longer adds
 *  to its reach — kick-eaten yourReachYd 135 → 35 (130 → 30 without Phantom
 *  Reach). 605 files: 49 kick-eaten lines change, nothing else.
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
 */
export const PROMPT_VERSION = 167;
