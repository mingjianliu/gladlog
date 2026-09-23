/**
 * Warlock pets by what they DO (GH #86, user ruling 2026-09-22: most summons
 * fold into their owner; the warlock's pet is recorded BY ITS FUNCTION —
 * "驱散、诱惑、恐惧、晕眩" — and every functional pet is listed whether or not
 * the corpus has shown it: a warlock can run a Felhunter, a Sayaad or an Imp,
 * a Voidwalker is possible but nobody takes it, so the roster fact must not
 * depend on observation).
 *
 * Keyed by the pet's npcId (GUID segment 6). Permanent pets carry no
 * SPELL_SUMMON inside a round — they are out before the gates open — so the
 * npcId is read off the pet unit itself; `WARLOCK_PET_CAST_FUNCTION` is the
 * fallback when an npcId is not listed (a pet's signature cast names it).
 *
 * Rot check: npcIds are outside `curatedIdRegistry` (spell ids); they ride on
 * `packages/eval/scripts/npcRosterScan.ts` like CRITICAL_NON_PLAYER_NPC_NAMES.
 * 600-file 12.1 census (reports/log-observability-2026-09-19): 417 Felhunter
 * summoned 33× in 19 files, 1863 Sayaad 8, 17252 Felguard 2, 416 Imp 1 —
 * low because permanent pets are rarely re-summoned mid-round, not because
 * they are rare: 408 of 418 warlock-rounds resolve to a function.
 */
export interface IWarlockPetFunction {
  /** Canonical English pet name (never the player-given localized name). */
  pet: string;
  /** What it does, in the vocabulary the coach uses. */
  does: string;
}

export const WARLOCK_PET_FUNCTION: Record<string, IWarlockPetFunction> = {
  "417": { pet: "Felhunter", does: "Spell Lock (kick), Devour Magic (purge)" },
  "1863": { pet: "Sayaad", does: "Seduction (incapacitate)" },
  "184600": { pet: "Incubus", does: "Seduction (incapacitate)" },
  "17252": { pet: "Felguard", does: "Axe Toss (stun)" },
  "416": { pet: "Imp", does: "Singe Magic (friendly dispel)" },
  "1860": { pet: "Voidwalker", does: "no control or dispel" },
};

/** Signature cast → the pet it belongs to (fallback identification). */
export const WARLOCK_PET_CAST_FUNCTION: Record<string, string> = {
  "19647": "417", // Spell Lock
  "19505": "417", // Devour Magic
  "6358": "1863", // Seduction
  "89766": "17252", // Axe Toss
  "89808": "416", // Singe Magic
  "17767": "1860", // Shadow Bulwark
};

/** Warlock specs (CombatUnitSpec values): Affliction / Demonology / Destruction. */
export const WARLOCK_SPEC_IDS = new Set(["265", "266", "267"]);
