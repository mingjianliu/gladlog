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
 *  v159 (2026-09-26, reliability round 3 W1a 6954): kick-priority-missed / -team no
 *  longer credit a melee kicker with a run he could not make — roots cut the run
 *  budget, a kicker who could not move reaches only the kick's range + hitbox
 *  slack, and the chance must exist before the heal actually landed; roots are the
 *  DB2 root DR class ∪ official root auras (Ice Nova, Harpoon …). 605 files at
 *  7c6488e1: kick-priority-missed −5 / +1, kick-priority-team −4 / +3, [ROOT]
 *  +17 lines; gates 0 → 0.
 *  v160 (2026-09-26, reliability round 3 W1a b12b): cc-avoidable's GCD test anchors a
 *  hard cast at its bar START, so a bar the CC interrupted (no SPELL_CAST_SUCCESS)
 *  no longer leaves a fake "free to react" gap. 605 files at 9eb859c9:
 *  cc-avoidable −3 / +0, contexts unchanged.
 *  v161 (2026-09-26, sync-window table regenerated after C4 + GH #115 + W1g):
 *  full 63,303-file archive at 47f4279b (spot-checked equal at ab72caed on 600
 *  files / 1,658 windows). 107,357 → 107,358 windows; Solo Shuffle nEntered
 *  −1 / nUnentered +2, every rate and contrast unchanged to 0.1 pp; the only
 *  rendered change is the Solo Shuffle refN (50,483 → 50,484).
 */
export const PROMPT_VERSION = 161;
