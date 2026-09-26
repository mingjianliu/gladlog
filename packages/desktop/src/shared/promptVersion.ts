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
 *  v164 (2026-09-26, reliability round 3 wave 2, audit 121c): a [PEEL OPTION]
 *  row's distance, DR and target-trinket facts are one snapshot stamped with the
 *  span's first second ("| at m:ss: D yd, DR L[, T PvP trinket …]") — DR can reset
 *  inside the span (52 of 744 rows on the 605-file capture). The legend says the
 *  snapshot can change later; every counted second still passed every check.
 *  Rows 744 → 744, nothing else moves.
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
 */
export const PROMPT_VERSION = 166;
