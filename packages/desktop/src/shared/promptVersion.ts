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
 *  v148 (2026-09-25, reliability round 2 W1a follow-up): a landed ground /
 *  AoE control on a burst caster answers the burst, feasibility also reads
 *  silences and kick lockouts, extras say "Ns later"; burst-window reference
 *  regenerated (C2 included; C4 regen follows). 605 files:
 *  slow-defensive-response −51 / +34, [BURST ANSWERED] reworded in 2,392
 *  contexts.
 *  v149 (2026-09-26, cdTriggerPrior regenerated at a3a23a04): the [CD
 *  PRIOR] reference catches up with the round-end ledger cut (3eb635fb) and
 *  the passive-proc press filter (ab68f275); C4 moved no cell (Holy Priest
 *  Guardian Spirit cells identical). 27 of the table's n values change by
 *  1–16 (Preservation Stasis −16, Holy Paladin −1..−4), no median moves;
 *  the rendered `(n=…)` on [CD PRIOR] lines is the only prompt text that
 *  can change.
 *  v150 (2026-09-25, reliability round 3 W1j): one PvP-trinket readiness
 *  predicate (pvpTrinketRemainingSecondsAt) for the [CC ON TEAM] note, the
 *  [DEATH] line, [HEALER EXPOSURE] and the peel / bookmark target state; a
 *  Medallion means a DB2 Medallion item equipped or a Medallion cast (else
 *  "no PvP trinket"); Will to Survive locks the trinket 60 s (corpus), the
 *  other racials 30 s. 605 files: 401 contexts, [DEATH] "(PvP Trinket
 *  available)" −74; menu byte-identical; gates 0 → 0.
 */
export const PROMPT_VERSION = 150;
