import { classMetadata } from "../../../src/data/classSpells";
import { spellClassMap } from "../../../src/data/drCategories";
import observedSpellIds from "../../../src/data/observedSpellIdsGenerated.json";
import { RACIAL_ABILITIES } from "../../../src/data/racialAbilities";
import { SPELL_CATEGORIES } from "../../../src/data/spellCategories";
import { SPELL_EFFECT_OVERRIDES } from "../../../src/data/spellEffectOverrides";
import spellIdLists from "../../../src/data/spellIdLists";
import talentIdMap from "../../../src/data/talentIdMap.json";

export function collectCandidateIds(
  pvpTalentRows: Record<string, string>[],
): Set<string> {
  const candidates = new Set<string>();

  // 1. Object.keys(SPELL_CATEGORIES)
  for (const id of Object.keys(SPELL_CATEGORIES)) {
    candidates.add(id);
  }

  // 2. every abilities[].spellId from classMetadata
  for (const metadata of classMetadata) {
    if (metadata.abilities) {
      for (const ability of metadata.abilities) {
        if (ability.spellId) {
          candidates.add(ability.spellId);
        }
      }
    }
  }

  // 3. all three arrays of the default export of '../../../src/data/spellIdLists'
  for (const list of Object.values(spellIdLists)) {
    if (Array.isArray(list)) {
      for (const id of list) {
        if (typeof id === "string") {
          candidates.add(id);
        } else if (typeof id === "number") {
          candidates.add(String(id));
        }
      }
    }
  }

  // 4. every {spellId} of every category in spellClassMap.diminishingReturns
  if (spellClassMap.diminishingReturns) {
    for (const catList of Object.values(spellClassMap.diminishingReturns)) {
      if (Array.isArray(catList)) {
        for (const item of catList) {
          if (item && item.spellId) {
            candidates.add(item.spellId);
          }
        }
      }
    }
  }

  // 5. Object.keys(SPELL_EFFECT_OVERRIDES)
  for (const id of Object.keys(SPELL_EFFECT_OVERRIDES)) {
    candidates.add(id);
  }

  // 6. every entries[].spellId (numbers -> String) found in ALL node arrays (classNodes, specNodes, heroNodes, subTreeNodes) of every spec in talentIdMap.json
  const nodeKeys = [
    "classNodes",
    "specNodes",
    "heroNodes",
    "subTreeNodes",
  ] as const;
  for (const spec of talentIdMap as any[]) {
    for (const key of nodeKeys) {
      const nodes = spec[key];
      if (Array.isArray(nodes)) {
        for (const node of nodes) {
          if (node && Array.isArray(node.entries)) {
            for (const entry of node.entries) {
              if (entry && typeof entry.spellId === "number") {
                candidates.add(String(entry.spellId));
              }
            }
          }
        }
      }
    }
  }

  // 7. racial abilities (2026-08-12): the log has no race field, so these are
  // credited purely from observed casts — but their official cooldowns and DR
  // categories still have to come from DB2 like everything else, which means
  // they must be in the candidate universe.
  for (const id of Object.keys(RACIAL_ABILITIES)) {
    candidates.add(id);
  }

  // 8. each row's SpellID from the pvpTalentRows parameter (skip '0'/empty)
  for (const row of pvpTalentRows) {
    const spellId = row["SpellID"];
    if (spellId && spellId !== "0" && spellId.trim() !== "") {
      candidates.add(spellId);
    }
  }

  // 9. every spell id the corpus has actually observed (2026-08-17).
  // Sources 1-8 are ALL hand-maintained lists, which made the candidate
  // universe a closed loop: a debuff nobody had hand-listed could never
  // acquire an official `dispelType`, so `getDispelType` returned null and
  // the product concluded "not dispellable" — for spells the game
  // demonstrably dispels. Measured on the full local corpus (1028 matches,
  // 71,645 cross-unit DEBUFF dispels cast by real dispel abilities: Purify /
  // Cleanse / Detox / Purify Spirit / Cleanse Toxins): 145 distinct spells,
  // accounting for **76.5% of all observed dispels**, had no entry in
  // spellEffectGenerated at all — Shadow Word: Pain (5268 dispels), Moonfire
  // (3284), Flame Shock (2717), Corruption (1974), Vampiric Touch (1745)…
  // All 145 are present in observedSpellIdsGenerated, so this single source
  // closes the entire gap. Same corpus scoping `genSpellIcons.ts` and
  // `genSpellManaCost.ts` already use.
  for (const id of observedSpellIds as number[]) {
    candidates.add(String(id));
  }

  return candidates;
}
