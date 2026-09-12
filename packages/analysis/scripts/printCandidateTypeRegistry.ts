/**
 * Print the candidate type registry as JSON — the bridge for non-TS consumers
 * (GH #76): `tools/coach-corpus/common.py` derives its rosters from this output
 * instead of hand-copying the desktop's lists (which is how the 2026-09-06
 * ACTIVE/RETIRED misreading and the GH #74 negative-control hole happened).
 *
 * Usage:
 *   npx tsx packages/analysis/scripts/printCandidateTypeRegistry.ts
 *
 * Output shape: { registry: {type: entry}, cardTypes: [...], menuOnlyTypes: [...],
 * retiredTypes: [...] } — the derived sets are included so a consumer cannot
 * re-derive them differently.
 */
import {
  CANDIDATE_TYPE_REGISTRY,
  CARD_TYPES,
  MENU_ONLY_TYPES,
  RETIRED_TYPES,
} from "../src/data/candidateTypeRegistry";

console.log(
  JSON.stringify({
    registry: CANDIDATE_TYPE_REGISTRY,
    cardTypes: [...CARD_TYPES].sort(),
    menuOnlyTypes: [...MENU_ONLY_TYPES].sort(),
    retiredTypes: [...RETIRED_TYPES].sort(),
  }),
);
