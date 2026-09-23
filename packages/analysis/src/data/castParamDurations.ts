/**
 * Auras whose length is set by a parameter OF THE CAST that produced them —
 * empower level (Evoker breaths) or combo points spent (finishers). GH #65
 * item 1; user ruling 2026-09-22: the two are one shape, done together.
 *
 * No single number describes these: `spellEffectData[id].durationSeconds` is
 * DB2's 0-point / placeholder value (Rip 4, Dream Breath 2) and the corpus mode
 * only ever held 13–57 % of lifetimes. The formula below is the base the
 * talent layer (`BUFF_DURATION_TALENT_MODIFIERS`) then stacks on, exactly like
 * `untalentedBaseSeconds`.
 *
 *   duration = baseSeconds + perUnitSeconds × parameter
 *
 * Every row is a corpus fit that is EXACT on every parameter value the corpus
 * shows (castParamDurationScan.ts, every 60th archive file = 1,056 files /
 * 1,946 rounds, 2026-09-23); the counts are in each note. The parameter is
 * read by `utils/castParam.ts` → `castParamAt`, never inferred.
 */
export interface ICastParamDuration {
  param: "empower" | "combo";
  /** Spell ids whose cast carries the parameter (the empower press, or the
   * finisher itself). */
  castIds: readonly string[];
  baseSeconds: number;
  perUnitSeconds: number;
  note: string;
}

export const CAST_PARAM_DURATIONS: Record<string, ICastParamDuration> = {
  "1079": {
    param: "combo",
    castIds: ["1079"],
    baseSeconds: 4,
    perUnitSeconds: 4,
    note: "Rip — 4 × (CP + 1): CP1 8 s ×8/10, CP2 12 ×15/21, CP3 16 ×23/32, CP4 20 ×45/70, CP5 24 ×417/690; the CP5 second tier 19 s ×105 is Circle of Life and Death ×0.8 (24 × 0.8 = 19.2), Veinripper holders sit at 24 = 24 × 0.8 × 1.25 (talent layer, multiplicative). DB2's 4 s is the 0-point base.",
  },
  "1943": {
    param: "combo",
    castIds: ["1943"],
    baseSeconds: 4,
    perUnitSeconds: 4,
    note: "Rupture — 4 × (CP + 1): CP1 8 s ×14/15, CP2 12 ×21/32, CP3 16 ×41/53, CP4 20 ×61/92, CP5 24 ×97/184, CP6 28 ×170/328, CP7 32 ×361/865. No duration talent reaches it.",
  },
  "32645": {
    param: "combo",
    castIds: ["32645"],
    baseSeconds: 0,
    perUnitSeconds: 1,
    note: "Envenom — 1 s per CP: CP1 1 s ×12/12, CP2 2 ×23/25, CP3 3 ×15/18, CP4 4 ×34/38, CP5 5 ×85/107, CP6 6 ×176/224, CP7 7 ×473/605; the CP7 second tier 5 s ×111 is Unstable Toxin −2 s (talent layer). DB2 carries no duration for it.",
  },
  "355941": {
    param: "empower",
    castIds: ["355936", "382614"],
    baseSeconds: 20,
    perUnitSeconds: -4,
    note: "Dream Breath HoT — 20 − 4 × level: L1 16 s ×467/1,118, L2 12 ×69/101, L3 8 ×49/103, L4 4 ×4/8 (a HIGHER empower heals more up front and leaves a SHORTER HoT); the L1 second tier 22 s ×257 is Deep Exhalation +6 s (talent layer). DB2's 2 s is not the HoT length.",
  },
  "376788": {
    param: "empower",
    castIds: ["355936", "382614"],
    baseSeconds: 20,
    perUnitSeconds: -4,
    note: "Dream Breath (the echo copy) — same ladder as 355941: L1 16 s ×190/692, L2 12 ×26/46, L3 8 ×7/14, L4 4 ×2/4; Deep Exhalation +6 on top.",
  },
  "357209": {
    param: "empower",
    castIds: ["357208", "382266"],
    baseSeconds: 30,
    perUnitSeconds: -6,
    note: "Fire Breath DoT — 30 − 6 × level: L1 24 s ×503/1,182, L2 18 ×41/81, L3 12 ×79/172, L4 6 ×7/7. Open: an L1 second tier at 28 s ×81 (+4) that no duration modifier in either SpellMod encoding reaches — left on the base, the scan keeps showing it.",
  },
};
