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
 *  v150 (2026-09-25, reliability round 3 W1j): one PvP-trinket readiness
 *  predicate (pvpTrinketRemainingSecondsAt) for the [CC ON TEAM] note, the
 *  [DEATH] line, [HEALER EXPOSURE] and the peel / bookmark target state; a
 *  Medallion means a DB2 Medallion item equipped or a Medallion cast (else
 *  "no PvP trinket"); Will to Survive locks the trinket 60 s (corpus), the
 *  other racials 30 s. 605 files: 401 contexts, [DEATH] "(PvP Trinket
 *  available)" −74; menu byte-identical; gates 0 → 0.
 *  v151 (2026-09-25, GH #113): kick-eaten reads both sides' pressure during
 *  the lockout (kickPressure.ts) — lowest unit at or below the crisis line,
 *  first death up to 5 s after, the other side's offensive cooldowns running —
 *  and, when neither side was pressed, which of our offensive cooldowns were
 *  ready; a kick with both sides calm and no burst ready is not listed. 605
 *  files: kick-eaten dps 1030 → 998, healer 506 → 475 (other types and the
 *  match context byte-identical); 560 new HP facts, 241 with a same-second
 *  [STATE] tick, 0 mismatches.
 *  v152 (2026-09-25, reliability round 3 W1k): a kick after an officially
 *  channelled spell (DB2 SpellMisc "Is Channelled") had gone out is a channel
 *  kick — kick-eaten carries phase=channel + channelS instead of a clamped
 *  kickDepthPct, and the legend / consequence rule no longer say it "never
 *  landed" or invite fake-casting. 605 files: 273 of 1,536 kick-eaten lines
 *  are channel kicks, 33 lose kickDepthPct; nothing else moves.
 */
export const PROMPT_VERSION = 152;
