import { SPELL_CATEGORIES } from "../../../src/data/spellCategories";
import { classMetadata } from "../../../src/data/classSpells";
import spellIdLists from "../../../src/data/spellIdLists";
import { spellClassMap } from "../../../src/data/drCategories";
import { SPELL_EFFECT_OVERRIDES } from "../../../src/data/spellEffectOverrides";
import talentIdMap from "../../../src/data/talentIdMap.json";

export function collectCandidateIds(pvpTalentRows: Record<string, string>[]): Set<string> {
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
  const nodeKeys = ["classNodes", "specNodes", "heroNodes", "subTreeNodes"] as const;
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

  // 7. each row's SpellID from the pvpTalentRows parameter (skip '0'/empty)
  for (const row of pvpTalentRows) {
    const spellId = row["SpellID"];
    if (spellId && spellId !== "0" && spellId.trim() !== "") {
      candidates.add(spellId);
    }
  }

  return candidates;
}
