/**
 * Dispel-backlash CCs — the ONE table for "which aura lands on a dispeller as a
 * backlash, and what CC it is". Consumed by dispelAnalysis (the dispel verdict),
 * ccTrinketAnalysis (which auras become a CC instance) and the timeline's
 * `[CC ON TEAM] … [DISPEL BACKLASH CC: <type>]` tag (CLAUDE.md Shared-Predicate
 * Rule). Dependency-free so every layer can import it without a cycle.
 *
 * Keys are the dispelled debuff, values the aura that lands on the dispeller.
 * Both rows are corpus-established, not assumed:
 *   - 1259790 Unstable Affliction → 196364 (Shadow, `Apply Aura: Silence`, 4 s):
 *     of 528 UA dispels, 406 (76.9 %) put 196364 on the DISPELLER within 3 s.
 *     The pre-12.1 rows (316099/342938 → 196363 "Eye Beam") were deleted
 *     2026-08-21 — 0 occurrences in 10,682 S2 matches.
 *   - 34914 Vampiric Touch → 87204 Sin and Punishment (Magic horror, 3.0 s
 *     observed ×151): archive 1/3 subset, 7,971 VT dispels — 87204 within 3 s
 *     88.3 %, 34914 on the dispeller 0.4 % (GH #80 model run, 2026-09-12).
 *
 * GH #103 (2026-09-23): ccTrinketAnalysis and matchTimeline used to hardcode
 * `"196364" || "34914"` for "a backlash CC is possible" — 34914 is the Vampiric
 * Touch DoT itself, so every VT application/refresh on a teammate became a
 * `[CC ON TEAM] ← Vampiric Touch | 0s [DISPEL BACKLASH CC]` line (2,769 lines
 * in 3,520 archive owner contexts) while the real backlash, 87204, was never
 * tagged. Both sites now read BACKLASH_AURA_CC_TYPE.
 */
export type BacklashCcType = "silence" | "horror";

/** @internal exported for data/curatedIdRegistry (corpus rot scan) */
export const BACKLASH_CC_SPELL_IDS = new Map<
  string,
  { backlashSpellId: string; ccType: BacklashCcType }
>([
  ["34914", { backlashSpellId: "87204", ccType: "horror" }],
  ["1259790", { backlashSpellId: "196364", ccType: "silence" }],
]);

/** Backlash aura id (the one on the dispeller) → the CC it applies. */
export const BACKLASH_AURA_CC_TYPE: ReadonlyMap<string, BacklashCcType> =
  new Map(
    [...BACKLASH_CC_SPELL_IDS.values()].map((v) => [
      v.backlashSpellId,
      v.ccType,
    ]),
  );
