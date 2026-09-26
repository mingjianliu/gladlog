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
 *  v145 (2026-09-25, GH #111 + GH #114): the shared CC evaluator reads a
 *  cast's DR through the aura it applies (Shockwave / Capacitor Totem /
 *  Fear no longer Full DR forever) — 605 files: 30 Shockwave bookmark /
 *  peel lines dropped, 14 re-rendered (5 at "DR 50%"); [ENEMY DEF] prices a
 *  self wall through wallDoorPct, the burst-into-mitigation door value —
 *  1,544 of 20,175 lines changed % (Barkskin 20 → 30, Unending Resolve
 *  25 → 40, Obsidian Scales 30 → 40, Astral Shift 40 → 60, self Pain
 *  Suppression 40 → 50); the [ENEMY DEF] legend says the % may include the
 *  caster's talents. Candidate menu byte-identical.
 *  v146 (2026-09-25, reliability round 2 W1h i): the burst ledger skips
 *  defensive auras our side put on the target — the owner's own Touch of
 *  Karma tether read as "Target had a major defensive up". 605 files: 49
 *  lines removed in 40 contexts, menu unchanged.
 *  v147 (2026-09-25, reliability audit C4): Guardian Spirit's expired
 *  press (Guardian Angel) comes back 60 s after the BUFF ended (less a
 *  measured 1 s logging lag), not 60 s after the press; the death block
 *  reads the same per-cast cooldown as the [RES] ledger. 605 files:
 *  cooldown-ledger-consistency gate 26 → 0 (all 26 Guardian Spirit);
 *  cd-hoarded −29, external-unused −19; 4,335 context hunks all on
 *  Guardian Spirit, plus 17 [BURST ANSWERED] / [CD PRIOR] lines whose
 *  feasibility now sees it on cooldown.
 */
export const PROMPT_VERSION = 147;
