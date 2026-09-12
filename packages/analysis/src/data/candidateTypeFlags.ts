/**
 * Candidate type flags — DERIVED from `candidateTypeRegistry.ts`, never edited
 * here (GH #76, user ruling 2026-09-12). To retire or resurrect a type, change
 * its `status` in the registry; this object follows. The per-type rulings and
 * their numbers live in the registry entries' `reason` fields.
 *
 * Why this module still exists: the flag object is the A/B harness's knob.
 * It is a plain mutable object on purpose (the dispelFeatureFlags.ts
 * precedent) — tests and `packages/eval` probes flip fields directly
 * (`CANDIDATE_TYPE_FLAGS.x = false`) and restore them; there is no separate
 * override/reset mechanism. The derivation runs once at module load, so a
 * flipped field stays flipped for the process — exactly the old behaviour.
 *
 * The expected value of every field is pinned by docs/predicate-index.md's
 * `Feature flag state` table, asserted against runtime by
 * predicateIndex.test.ts. `candidateTypeRegistry.test.ts` additionally pins the
 * derived object against the literal it replaced on 2026-09-12 (byte-for-byte
 * no-op refactor evidence).
 *
 * `BRACKET_TYPE_ALLOWLIST` is re-exported from the registry for the existing
 * import sites; the registry file is its authoritative home.
 */
import {
  type CandidateTypeFlagKey,
  deriveCandidateTypeFlags,
} from "./candidateTypeRegistry";

export { BRACKET_TYPE_ALLOWLIST } from "./candidateTypeRegistry";

export const CANDIDATE_TYPE_FLAGS: Record<CandidateTypeFlagKey, boolean> =
  deriveCandidateTypeFlags();
