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
 *  v160 (2026-09-26, reliability round 3 W1a b12b): cc-avoidable's GCD test anchors a
 *  hard cast at its bar START, so a bar the CC interrupted (no SPELL_CAST_SUCCESS)
 *  no longer leaves a fake "free to react" gap. 605 files at 9eb859c9:
 *  cc-avoidable −3 / +0, contexts unchanged.
 *  v161 (2026-09-26, sync-window table regenerated after C4 + GH #115 + W1g):
 *  full 63,303-file archive at 47f4279b (spot-checked equal at ab72caed on 600
 *  files / 1,658 windows). 107,357 → 107,358 windows; Solo Shuffle nEntered
 *  −1 / nUnentered +2, every rate and contrast unchanged to 0.1 pp; the only
 *  rendered change is the Solo Shuffle refN (50,483 → 50,484).
 *  v162 (2026-09-26, reliability round 3 wave 2, endpoint identity): POSITIONING
 *  STAYED IN names whoever each distance was measured to ("from X→Y (X Dyd at the
 *  end)" when another enemy is nearest at the end), KITED labels B as the peak
 *  ("(peak at m:ss[, from Z])"), and every rendered distance is sampled on the
 *  render grid. 605 files at ab72caed: STAYED/KITED lines 4,165 → 4,079,
 *  position-mistake(stayed-in) 295 → 298 (−36 / +39); positioningScan G4 end
 *  violations 350 → 0.
 */
export const PROMPT_VERSION = 162;
