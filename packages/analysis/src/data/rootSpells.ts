/**
 * The official MOVEMENT-root spell set — "could this unit move". Read through
 * `utils/rootReachability.ts` (which re-exports it and owns the interval
 * predicate `rootIntervalsOf`) by [ROOT] lines, the kick run budget and the
 * crisis DPS "rooted" gate.
 *
 * It is NOT the "counts as a control response" set: spellTags' `rootSpellIds`
 * (SPELL_CATEGORIES type "roots", 18 ids, a strict subset of this one) stays
 * separate for CONTROL_IDS / burst-window landed control / ccTrinketAnalysis.
 * Aliasing the two was tried on 2026-09-26 and pulled — a gap-closer's
 * incidental ~1 s root (Charge) then displaced real control answers
 * (predicate index, "Not yet unified").
 *
 * The DB2 root DR class (DiminishType 1) UNION the observed auras whose own
 * SpellEffect roots the carrier (`ROOT_AURA_SPELL_IDS`, aura 26 / 455, not
 * caster-targeted) MINUS ids in another CC DR class (a fear carries aura 455
 * too). The DR class alone missed roots with no DR — Ice Nova 157997
 * (reliability round 3 W1a, 6954). Lives in data/ to stay free of utils
 * imports.
 */
import { DR_CATEGORIES_GENERATED } from "./drCategoriesGenerated";
import { ROOT_AURA_SPELL_IDS } from "./rootAuraGenerated";

/** The root DR class itself — hostile by definition, whoever the source. */
export const ROOT_DR_IDS: ReadonlySet<string> = new Set(
  DR_CATEGORIES_GENERATED["root"] ?? [],
);

const OTHER_CC_DR_IDS = new Set<string>(
  (["stun", "incapacitate", "disorient", "silence"] as const).flatMap(
    (c) => DR_CATEGORIES_GENERATED[c] ?? [],
  ),
);

export const ROOT_SPELL_IDS: ReadonlySet<string> = new Set([
  ...ROOT_DR_IDS,
  // A fear also carries the root aura (Psychic Scream, Intimidating Shout,
  // Sigil of Misery: 828 [ROOT] lines on 605 files when admitted) — an aura
  // in another CC DR class is that CC, not a root.
  ...[...ROOT_AURA_SPELL_IDS].filter((id) => !OTHER_CC_DR_IDS.has(id)),
]);
