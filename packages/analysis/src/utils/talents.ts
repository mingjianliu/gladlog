import { nodeMaps, talentDataReady } from "../data/talentStrings";
import { memoizeWhenReady } from "./memoize";

type HeroTalent = {
  id: number;
  type: string;
  name: string;
  traitSubTreeId: number;
  traitTreeId: number;
  atlasMemberName: string;
  nodes: number[];
};

// Loaded in the background rather than via top-level await (design note in
// data/spellEffectData.ts): it is the same talentIdMap.json, and the module
// cache guarantees it is read only once, shared with talentStrings.
let heroTalentMap: Record<number, HeroTalent> = {};
let heroReady = false;
const heroLoad = import("../data/talentIdMap.json").then((mod) => {
  heroTalentMap = ((mod.default ?? mod) as any[])
    .flatMap((a) => a.subTreeNodes)
    .flatMap((n) => n.entries)
    .reduce(
      (prev, cur) => {
        prev[cur.id] = cur;
        return prev;
      },
      {} as Record<number, HeroTalent>,
    );
  heroReady = true;
});
export const ensureHeroTalents = (): Promise<void> => heroLoad;

export const findHeroTalent = memoizeWhenReady(
  () => heroReady,
  (talents: ({ id2: number } | null)[]): HeroTalent | null => {
    const heroTalentId = talents.find(
      (e) => e && Object.keys(heroTalentMap).includes(`${e.id2}`),
    );
    return heroTalentId ? heroTalentMap[heroTalentId.id2] : null;
  },
);

/**
 * The complete universe of hero-tree names (e.g. "Flameshaper") from the SAME
 * talentIdMap that `heroBuildGroupOf` resolves through — one fact, one
 * predicate: corpus-tools' `validateCorpus` checks undeclared-spec buildGroup
 * cells against exactly this set (2026-08-25: the validator's old "non-* ⇒
 * gate-declared" invariant predated hero grouping and failed the first
 * production regen with 103 false violations). Empty until `ensureHeroTalents`
 * resolves — callers that need it await that first, and an empty set fails
 * loud (every hero cell flagged), never silently passes.
 */
export const heroTreeNames = (): Set<string> =>
  new Set(Object.values(heroTalentMap).map((h) => h.name));

/**
 * BACKLOG #37 缺口二: the hero tree as the DEFAULT build grouping (user ruling
 * 2026-08-23: 「每个英雄天赋的玩法都是截然不同的」, explicitly for all
 * healers — pooling both trees yields an average nobody actually plays).
 * One predicate for BOTH sides of the comparison: the corpus builder
 * (perMatchRecord.combatToRecords) and the user side (renderer →
 * CompareInput.heroGroup). Gate-declared groups (keystoneGates.json) still
 * take precedence where a spec declares one.
 *
 * "*" = build-agnostic: no hero entry found, or the talent map not loaded yet
 * (memoizeWhenReady) — never a guess.
 */
export function heroBuildGroupOf(
  talents: ({ id1: number; id2: number; count: number } | null)[] | undefined,
): string {
  if (!talents || talents.length === 0) return "*";
  const hero = findHeroTalent(talents);
  return hero?.name ?? "*";
}

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
      specData.classNodeMap[talent.id1] ??
      specData.specNodeMap[talent.id1] ??
      specData.heroNodeMap[talent.id1];

    if (!node) continue;

    if ((node.type === "choice" || node.type === "subtree") && talent.id2 > 0) {
      // Choice node — only the chosen entry is active
      const entry = node.entries.find((e) => e.id === talent.id2);
      if (entry && "spellId" in entry && entry.spellId) {
        result.set(entry.spellId.toString(), {
          type: entry.type,
          name: entry.name,
        });
      }
    } else {
      // Single (or ranked) node — all entries are active
      for (const entry of node.entries) {
        if ("spellId" in entry && entry.spellId) {
          result.set(entry.spellId.toString(), {
            type: entry.type,
            name: entry.name,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Purchased rank (`count` in COMBATANT_INFO), per talented spell id — the same
 * node walk as `getPlayerTalentedSpellInfo`, keeping the rank instead of
 * discarding it. Needed by modifiers whose value is stated PER RANK: the DB2
 * SpellEffect row carries one rank's worth, so a maxRanks=2 node applies it
 * twice. Worked example (`BUFF_DURATION_TALENT_MODIFIERS`): Timeless Magic is
 * +15 % duration per rank on a maxRanks=2 node, and the corpus shows all three
 * tiers of Time Dilation cleanly separated — 8.0 s / 9.2 s / 10.4 s at 0 / 1 /
 * 2 ranks.
 * Returns null if talent data is unavailable (no judgement should be made).
 */
export function getPlayerTalentRanks(
  specId: number,
  talents: ({ id1: number; id2: number; count: number } | null)[],
): Map<string, number> | null {
  const specData = nodeMaps[specId];
  if (!specData) return null;

  const result = new Map<string, number>();

  for (const talent of talents) {
    if (!talent || talent.count === 0) continue;

    const node =
      specData.classNodeMap[talent.id1] ??
      specData.specNodeMap[talent.id1] ??
      specData.heroNodeMap[talent.id1];

    if (!node) continue;

    const entries =
      (node.type === "choice" || node.type === "subtree") && talent.id2 > 0
        ? node.entries.filter((e) => e.id === talent.id2)
        : node.entries;

    for (const entry of entries) {
      if ("spellId" in entry && entry.spellId) {
        const key = entry.spellId.toString();
        result.set(key, Math.max(result.get(key) ?? 0, talent.count));
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
 * True when every purchased row (count > 0) of the player's COMBATANT_INFO
 * talents resolves to a node of the CURRENT build's tree data (class/spec/
 * hero/subtree maps). A loadout recorded on an older game build uses node ids
 * the current map no longer has, so tree-membership verdicts about it are
 * unreliable — measured on the live library (2026-08-11, 5195-unit sample):
 * current-build loadouts sit at exactly 1.00 resolvability, older-build ones
 * at 0.90–0.99, nothing below 0.90.
 */
export function isLoadoutFullyResolved(
  specId: number,
  talents: ({ id1: number; id2: number; count: number } | null)[],
): boolean {
  const specData = nodeMaps[specId];
  if (!specData) return false;
  for (const t of talents) {
    if (!t || t.count === 0) continue;
    if (!(
      specData.classNodeMap[t.id1] ??
      specData.specNodeMap[t.id1] ??
      specData.heroNodeMap[t.id1] ??
      specData.subtreeNodeMap[t.id1]
    ))
      return false;
  }
  return true;
}

/**
 * Spell IDs granted by tree nodes flagged `freeNode` or `entryNode` for this
 * spec. Auto-granted nodes are NOT reported in COMBATANT_INFO (measured
 * 2026-08-11: Enhancement's Chain Lightning entry node 103583 was absent from
 * every one of 214 loadouts whose owner cast the spell), so "node not in the
 * player's talents" must not be read as "player doesn't have it" for these.
 */
export const getSpecFreeOrEntrySpellIds = memoizeWhenReady(
  talentDataReady,
  (specId: number): Set<string> => {
    const specData = nodeMaps[specId];
    const result = new Set<string>();
    if (!specData) return result;
    const allNodes = [
      ...specData.classNodes,
      ...specData.specNodes,
      ...(specData.heroNodes ?? []),
    ];
    for (const node of allNodes) {
      const flags = node as { freeNode?: boolean; entryNode?: boolean };
      if (!flags.freeNode && !flags.entryNode) continue;
      for (const entry of node.entries) {
        if ("spellId" in entry && entry.spellId)
          result.add(entry.spellId.toString());
      }
    }
    return result;
  },
);

/**
 * Returns a mapping of all spell IDs that exist anywhere in the given spec's talent tree
 * to their entry type.
 * Used to distinguish talent-gated spells from baseline spells.
 */
export const getSpecTalentTreeSpellInfo = memoizeWhenReady(
  talentDataReady,
  (specId: number): Map<string, { type: string; name: string }> => {
    const specData = nodeMaps[specId];
    if (!specData) return new Map();

    const result = new Map<string, { type: string; name: string }>();
    const allNodes = [
      ...specData.classNodes,
      ...specData.specNodes,
      ...(specData.heroNodes ?? []),
    ];

    for (const node of allNodes) {
      for (const entry of node.entries) {
        if ("spellId" in entry && entry.spellId) {
          result.set(entry.spellId.toString(), {
            type: entry.type,
            name: entry.name,
          });
        }
      }
    }

    return result;
  },
);

/**
 * Returns the set of all spell IDs that exist anywhere in the given spec's talent tree.
 * @deprecated Use getSpecTalentTreeSpellInfo for richer metadata.
 */
export const getSpecTalentTreeSpellIds = memoizeWhenReady(
  talentDataReady,
  (specId: number): Set<string> => {
    const info = getSpecTalentTreeSpellInfo(specId);
    return new Set(info.keys());
  },
);
