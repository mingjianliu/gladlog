import _ from 'lodash';

import { nodeMaps } from '../data/talentStrings';
const talentIdMapModule = await import('../data/talentIdMap.json');
const talentIdMap = talentIdMapModule.default ?? talentIdMapModule;

type HeroTalent = {
  id: number;
  type: string;
  name: string;
  traitSubTreeId: number;
  traitTreeId: number;
  atlasMemberName: string;
  nodes: number[];
};

const heroTalentMap = (talentIdMap as any[])
  .flatMap((a) => a.subTreeNodes)
  .flatMap((n) => n.entries)
  .reduce(
    (prev, cur) => {
      prev[cur.id] = cur;
      return prev;
    },
    {} as Record<number, HeroTalent>,
  );

export const findHeroTalent = _.memoize((talents: ({ id2: number } | null)[]): HeroTalent | null => {
  const heroTalentId = talents.find((e) => e && Object.keys(heroTalentMap).includes(`${e.id2}`));
  return heroTalentId ? heroTalentMap[heroTalentId.id2] : null;
});

/**
 * Returns a mapping of spell IDs the player actually has from their talent tree
 * to their entry type ('active' for buttons, 'passive' for modifications).
 * For choice nodes, only the chosen entry's spell is included.
 * Returns null if talent data is unavailable (no filtering should be applied).
 */
export function getPlayerTalentedSpellInfo(
  specId: number,
  talents: ({ id1: number; id2: number; count: number } | null)[],
): Map<string, { type: string; name: string }> | null {
  const specData = nodeMaps[specId];
  if (!specData) return null;

  const result = new Map<string, { type: string; name: string }>();

  for (const talent of talents) {
    if (!talent || talent.count === 0) continue;

    const node =
      specData.classNodeMap[talent.id1] ?? specData.specNodeMap[talent.id1] ?? specData.heroNodeMap[talent.id1];

    if (!node) continue;

    if ((node.type === 'choice' || node.type === 'subtree') && talent.id2 > 0) {
      // Choice node — only the chosen entry is active
      const entry = node.entries.find((e) => e.id === talent.id2);
      if (entry && 'spellId' in entry && entry.spellId) {
        result.set(entry.spellId.toString(), { type: entry.type, name: entry.name });
      }
    } else {
      // Single (or ranked) node — all entries are active
      for (const entry of node.entries) {
        if ('spellId' in entry && entry.spellId) {
          result.set(entry.spellId.toString(), { type: entry.type, name: entry.name });
        }
      }
    }
  }

  return result;
}

/**
 * Returns the set of spell IDs the player actually has from their talent tree.
 * @deprecated Use getPlayerTalentedSpellInfo for richer metadata.
 */
export function getPlayerTalentedSpellIds(
  specId: number,
  talents: ({ id1: number; id2: number; count: number } | null)[],
): Set<string> | null {
  const info = getPlayerTalentedSpellInfo(specId, talents);
  if (!info) return null;
  return new Set(info.keys());
}

/**
 * Returns a mapping of all spell IDs that exist anywhere in the given spec's talent tree
 * to their entry type.
 * Used to distinguish talent-gated spells from baseline spells.
 */
export const getSpecTalentTreeSpellInfo = _.memoize((specId: number): Map<string, { type: string; name: string }> => {
  const specData = nodeMaps[specId];
  if (!specData) return new Map();

  const result = new Map<string, { type: string; name: string }>();
  const allNodes = [...specData.classNodes, ...specData.specNodes, ...(specData.heroNodes ?? [])];

  for (const node of allNodes) {
    for (const entry of node.entries) {
      if ('spellId' in entry && entry.spellId) {
        result.set(entry.spellId.toString(), { type: entry.type, name: entry.name });
      }
    }
  }

  return result;
});

/**
 * Returns the set of all spell IDs that exist anywhere in the given spec's talent tree.
 * @deprecated Use getSpecTalentTreeSpellInfo for richer metadata.
 */
export const getSpecTalentTreeSpellIds = _.memoize((specId: number): Set<string> => {
  const info = getSpecTalentTreeSpellInfo(specId);
  return new Set(info.keys());
});
