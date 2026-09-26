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
 *  v155 (2026-09-26, fake-cast contrast): kick-eaten carries the log
 *  recorder's own cast control for the round (castCancels.ts) — hardcasts
 *  stopped by the player (estimated median depth), enemy kicks that went into
 *  one of those stops (kickAudit juked, by GUID, same cast instance) and when
 *  this line's kicker was baited; the legend says a stop alone is not a fake,
 *  the counts are round-wide, never a recommended depth or an
 *  opponent-adaptation claim. 605 files: 933 menus change (kick-eaten lines and
 *  legend only; other types and the match context byte-identical); 560 of
 *  1,482 kick-eaten lines carry the facts (124 with a baited kick, 70 with no
 *  stop). A/B v1 INCONCLUSIVE (eval-private ab/2026-09-26-fakecast-contrast),
 *  v3 targeted check 0 misuses in 14 responses; owner ruling 「比较基础 但是
 *  还是有一点价值 先做出来」.
 *  v156 (2026-09-26, kick-eaten legend fixes found in the fake-cast check):
 *  a multi-school lockedSchool lists its schools ("Chaos (Fire + Nature +
 *  Frost + Shadow + Arcane)") — the model told a Destruction Warlock Fire stays
 *  open after a Chaos Bolt kick; burstReady says only that the cooldowns were
 *  ready, never that the kick slowed the team's tempo. 605 files: 933 menus
 *  change (kick-eaten lines and legend only; other types and the match context
 *  byte-identical); 119 of 1,482 kick-eaten lines list a multi-school lock.
 *  Targeted check (same prompts, 2 responses each): "slowed your tempo" 4/4 →
 *  0/4 (074, 107); "Fire stays open" after a Chaos lock 2/2 → 0/2 (114).
 *  v157 (2026-09-26, reliability round 2 W1g defensive roster + W1e charges): the
 *  ledger admits Greater Invisibility, Alter Time, Survival of the Fittest,
 *  Retribution Divine Protection, Lay on Hands, Spellwarden AMS and
 *  Transcendence: Transfer; a cast / talent overrides a stale
 *  SPEC_EXCLUSIVE_SPELLS row (13 rows fixed); a second charge pressed inside 2 s
 *  is kept; a DB2 shared charge pool spends both spells (Spellwarding puts
 *  Blessing of Protection on cooldown). 605 files at fe5c1714: cd-hoarded
 *  −177 / +187, cd-waste +158, external-unused −13 / +9, questionable-external
 *  +6, slow-defensive-response −5 / +2; context gates 0 → 0.
 */
export const PROMPT_VERSION = 157;
