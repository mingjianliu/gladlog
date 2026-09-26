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
 *  v162 (2026-09-26, reliability round 3 wave 2, endpoint identity): POSITIONING
 *  STAYED IN names whoever each distance was measured to ("from X→Y (X Dyd at the
 *  end)" when another enemy is nearest at the end), KITED labels B as the peak
 *  ("(peak at m:ss[, from Z])"), and every rendered distance is sampled on the
 *  render grid. 605 files at ab72caed: STAYED/KITED lines 4,165 → 4,079,
 *  position-mistake(stayed-in) 295 → 298 (−36 / +39); positioningScan G4 end
 *  violations 350 → 0.
 *  v163 (2026-09-26, kick-priority reference table): regenerated at 9eb859c9 (the
 *  rooted-kicker fix e8305ed2 and everything since the 2026-09-12 table) over the
 *  same 21,101-file every-3rd archive subset: completed 7,060 → 7,327, kicked
 *  1,110 → 1,191; kill-target death within 10 s 11 % completed / 32 → 33 %
 *  kicked. The kick-priority facts quote the new rates.
 *  v164 (2026-09-26, reliability round 3 wave 2, audit 121c): a [PEEL OPTION]
 *  row's distance, DR and target-trinket facts are one snapshot stamped with the
 *  span's first second ("| at m:ss: D yd, DR L[, T PvP trinket …]") — DR can reset
 *  inside the span (52 of 744 rows on the 605-file capture). The legend says the
 *  snapshot can change later; every counted second still passed every check.
 *  Rows 744 → 744, nothing else moves.
 */
export const PROMPT_VERSION = 164;
