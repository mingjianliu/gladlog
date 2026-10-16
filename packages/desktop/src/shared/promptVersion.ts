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
 *  v396 (2026-10-15, FT, agy 40-FT-96, user 「落地」): a CC an enemy pet
 *  broke is broken by damage, not an uncleansed window (a BROKEN row's
 *  source is the breaker). 605 files: missed-cleanse +1 / −2.
 *  v397 (2026-10-15, FT, work order 6 Part 1 — facts only): a burst's
 *  extra another enemy pressed names that enemy; [BUFF FADED] reads the
 *  copy on the unit the press was on and states a logged break; the
 *  death-setup chain prints each entry's span and [HEALER CC] the free time
 *  between runs; legends: [STATE] `dead` in the death second, [RES] as of
 *  m:ss.0 and `cc:`, msw alsoHeldAt, "defenseless" is the target's own;
 *  [BURST ANSWERED] names a second friendly death; a Stasis release after
 *  a kick is the player's press, not a replay. 605 files: no candidate
 *  added or removed.
 *  v398 (2026-10-15, FT, agy 40-FT-98 — facts only): each press of a
 *  buff reads its own target's copy (a removal one press stepped over
 *  stays for the next); the death-setup chain lists kick lockouts and
 *  [HEALER CC] counts a lockout between two CCs as locked, not free. 605
 *  files: no candidate added or removed.
 *  v399 (2026-10-15, FT, agy 40-FT-99 — facts only): a buff pressed again
 *  on the same unit while up was refreshed — no [BUFF FADED] line of its
 *  own, and the copy that ends is the refreshing press's. 605 files: no
 *  candidate added or removed.
 *  v400 (2026-10-15, FT, work order 6 Part 2 n37, user 「按你的建议走」): a
 *  burst's pressured friendly is the one the burst hit who died inside the
 *  window (the first to die), else the lowest HP. 605 files:
 *  slow-defensive-response −1.
 *  v401 (2026-10-15, FT, agy 40-FT-101 — facts only): a dead pressured
 *  friendly has no self-save after its death and is not read kiting off
 *  its corpse; the [BURST ANSWERED] legend states the pressured pick and
 *  the control rule exactly. 605 files: no candidate added or removed.
 *  v402 (2026-10-16, data refresh 12.1.0.69587 → 12.1.5.70391, user
 *  「可以先把数据刷新做一下」): every DB2 generator re-run at the new build
 *  (hotfixes through 2026-10-15). Printed numbers move where the game moved:
 *  Nature's Swiftness with Call of Ohn'ahra +30 s (DB2 −60; the hand −30
 *  that duplicated DB2 is removed), Ice Block +30 s (Winter's Protection
 *  PvpMultiplier 0.5), Merithra's Blessing is Arcane (castable in a Nature
 *  lockout), PvP taunt / Ox Kick / Dark Simulacrum cooldowns, several
 *  defensive durations; Ice Cold's node spell is 414658 and its presses stay
 *  Ice Block's. Data stands for the current build on logs of any date (user
 *  ruling). 605 files: cd-hoarded −1, kick-priority-team +2,
 *  kick-priority-missed +1 (one new kill window: Ice Block on cooldown).
 */
export const PROMPT_VERSION = 402;
