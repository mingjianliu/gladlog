import { spellClassMap } from "./drCategories";
import { SPELL_CATEGORIES as rawSpellsData } from "./spellCategories";

interface ISpellMetadata {
  type:
    | "cc"
    | "roots"
    | "immunities"
    | "buffs_offensive"
    | "buffs_defensive"
    | "buffs_other"
    | "debuffs_offensive"
    | "debuffs_defensive"
    | "debuffs_other"
    | "interrupts"
    | "disarms";
  duration?: number;
  priority?: boolean;
  nounitFrames?: boolean;
  nonameplates?: boolean;
}

export const spells = {
  ...rawSpellsData,
  "5782": { type: "cc" },
} as Record<string, ISpellMetadata>;

// Shared-predicate rule (CLAUDE.md): "is spell X a CC" had two predicates —
// hard-CC windows (momentSnapshot / healerExposure / cooldownTiming) read the
// official DR table, while [CC] labels and cc-cooldown candidates read this
// hand-typed set. 2026-08-21 S2 archive (10,682 matches): 63 official-DR ids
// were live in play and absent here (Polymorph/Hex glyph variants, Freezing
// Trap 203337, Imprison, Paralysis, Strangulate, Maim…). ccSpellIds is now the
// hand `cc` layer ∪ the official hard-CC DR categories. Silence stays out (it is
// typed `interrupts` here); roots/disarms/knockback keep their own sets.
// Sourced from data/drCategories (not utils/drAnalysis — that module imports
// this one).
const OFFICIAL_HARD_CC_DR_CATEGORIES = [
  "stun",
  "incapacitate",
  "disorient",
] as const;
const officialHardCcIds = OFFICIAL_HARD_CC_DR_CATEGORIES.flatMap(
  (cat) =>
    (spellClassMap.diminishingReturns as Record<string, { spellId: string }[]>)[
      cat
    ]?.map((e) => e.spellId) ?? [],
);
export const ccSpellIds = new Set<string>([
  ...Object.keys(spells).filter((spellId) => spells[spellId].type === "cc"),
  ...officialHardCcIds,
]);

/** The official DR `silence` category (DB2) — what counts as a SILENCE, as
 * opposed to the hand `interrupts` type, which also holds kicks that leave a
 * short lockout aura (Shambling Rush 91807: mechanic 26 "interrupt", 2 s).
 * One set for the crisis "locked out" test and the [SILENCE] line
 * (reliability round 2 W1b, 2026-09-25). */
export const officialSilenceIds: ReadonlySet<string> = new Set(
  (spellClassMap.diminishingReturns as Record<string, { spellId: string }[]>)[
    "silence"
  ]?.map((e) => e.spellId) ?? [],
);

export const rootSpellIds = new Set<string>(
  Object.keys(spells).filter((id) => spells[id].type === "roots"),
);

export const disarmSpellIds = new Set<string>(
  Object.keys(spells).filter((id) => spells[id].type === "disarms"),
);

export const trinketSpellIds = ["336126", "195756"];
