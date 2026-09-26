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
 *  v158 (2026-09-26, reliability round 2 W1f): OFFENSIVE CD OUT OF RANGE measures
 *  each cooldown against its own caster-aware reach plus hitbox slack, abstains
 *  on summons (DB2 SpellEffect 28) and self / pet buffs, needs every enemy
 *  positioned and beyond reach for the whole 5 s (exact closest approach between
 *  position events); the line states "its reach N yd". 605 files at efc522b4:
 *  rendered lines 516 → 2, menu cd-out-of-range −343 / +1; gates 0 → 0.
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
 */
export const PROMPT_VERSION = 160;
