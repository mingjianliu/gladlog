import { nodeMaps, talentDataReady } from "../data/talentStrings";
import { logDatedNumberAt } from "./logEra";
import { memoizeWhenReady } from "./memoize";

/**
 * 12.1.5 go-live: NA maintenance 2026-10-13 (≈ 15:00–23:00 UTC), EU 10-14
 * (cooldown mastery round, eval-private research/builds.md: no file before
 * 10-13 23:17 UTC carries a 12.1.5-only spell id; 20 after).
 */
export const PATCH_1215_GOLIVE_EPOCH_MS = Date.UTC(2026, 9, 13, 15, 0, 0);

/**
 * Talent definitions whose spell traded places at 12.1.5 (TraitDefinition
 * SpellID 12.1.0.69587 → 12.1.5.70391): on a 12.1.0 log the (node, entry)
 * on the left is the talent the map (12.1.5) files under the right, and the
 * reverse. Holy Priest, research/holyword.md: definition 108738 (node 103900
 * entry 103733) was Ultimate Serenity and is Holy Celerity, 108750 (node
 * 82612 entry 103745) the other way round. Corpus: Ultimate Serenity
 * replaces Holy Word: Sanctify, yet 262 of 340 August units the 12.1.5 map
 * calls "Ultimate Serenity only" press Sanctify, 0 of 19 "Holy Celerity
 * only" do; in October files after the patch the map is right (8 of 9).
 */
const PRE_1215_ENTRY_SWAPS: ReadonlyArray<
  readonly [readonly [number, number], readonly [number, number]]
> = [
  [
    [103900, 103733],
    [82612, 103745],
  ],
];

/** The unit's first logged event — "when was this match" for a unit (NaN
 * when it logged nothing). */
export function unitLogEpochMs(unit: {
  spellCastEvents?: ReadonlyArray<{ logLine: { timestamp: number } }>;
  auraEvents?: ReadonlyArray<{ logLine: { timestamp: number } }>;
}): number {
  let first = Number.POSITIVE_INFINITY;
  for (const e of unit.spellCastEvents ?? [])
    first = Math.min(first, e.logLine.timestamp);
  for (const e of unit.auraEvents ?? [])
    first = Math.min(first, e.logLine.timestamp);
  return Number.isFinite(first) ? first : Number.NaN;
}

type TalentTuple = { id1: number; id2: number; count: number } | null;
const talentsOfCache = new WeakMap<object, TalentTuple[] | undefined>();

/**
 * The unit's COMBATANT_INFO talents as the talent map (12.1.5) reads them:
 * on a log from before 12.1.5 went live, the entries whose definition
 * traded spells are swapped (`PRE_1215_ENTRY_SWAPS`). A log of unknown date,
 * or within the zone uncertainty of the cutover, is read as 12.1.5
 * (`logDatedNumberAt`). Every talent reader asks this, never
 * `unit.info.talents` directly.
 */
export function talentsOf(unit: {
  info?: { talents?: TalentTuple[] };
  spellCastEvents?: ReadonlyArray<{ logLine: { timestamp: number } }>;
  auraEvents?: ReadonlyArray<{ logLine: { timestamp: number } }>;
}): TalentTuple[] | undefined {
  if (talentsOfCache.has(unit)) return talentsOfCache.get(unit);
  const talents = unit.info?.talents;
  let out = talents;
  if (
    talents &&
    logDatedNumberAt(
      { cutoverEpochMs: PATCH_1215_GOLIVE_EPOCH_MS, before: 1, since: 0 },
      unitLogEpochMs(unit),
    ) === 1
  )
    out = talents.map((t) => {
      if (!t) return t;
      for (const [a, b] of PRE_1215_ENTRY_SWAPS) {
        if (t.id1 === a[0] && t.id2 === a[1])
          return { ...t, id1: b[0], id2: b[1] };
        if (t.id1 === b[0] && t.id2 === b[1])
          return { ...t, id1: a[0], id2: a[1] };
      }
      return t;
    });
  talentsOfCache.set(unit, out);
  return out;
}

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
      specData.heroNodeMap[talent.id1] ??
      // 2026-09-07: 与 isLoadoutFullyResolved 对齐,它一直查四张表。今天
      // subTreeNodes 的条目不带 spellId 所以无差别,但两边查得不一样,就意味着
      // 一旦某个 build 给 subtree 条目加了 spellId,loadout 仍算「解析全」而这里
      // 解析不出来 —— 那会对一个玩家真有的天赋断言 "no"。
      specData.subtreeNodeMap[talent.id1];

    if (!node) continue;

    if (
      (node.type === "choice" ||
        node.type === "subtree" ||
        node.type === "tiered") &&
      talent.id2 > 0
    ) {
      // Choice / subtree / tiered node — only the chosen / purchased entry is active
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
 * Is the player's selection on the choice / subtree node that grants
 * `spellId` actually readable? `getPlayerTalentedSpellInfo` treats a choice
 * node listed with `id2: 0` as "all entries active", and an `id2` matching no
 * entry as "none" — both are fine for a kit list and both overclaim for a
 * modifier that strengthens a fact (GH #96 review, codex astra: an Arms loadout
 * `{id1: 94789, id2: 0}` read as holding Boneshaker AND Earthquaker).
 *
 * Returns false only when the spell sits on a choice / subtree node that the
 * loadout lists with an entry id that selects no single entry. A spell on a
 * single node, or a node the loadout does not list at all, returns true (the
 * ordinary tree verdict applies).
 */
export function choiceSelectionResolved(
  specId: number,
  talents: ({ id1: number; id2: number; count: number } | null)[],
  spellId: string,
): boolean {
  const specData = nodeMaps[specId];
  if (!specData) return true;
  for (const talent of talents) {
    if (!talent || talent.count === 0) continue;
    const node =
      specData.classNodeMap[talent.id1] ??
      specData.specNodeMap[talent.id1] ??
      specData.heroNodeMap[talent.id1] ??
      specData.subtreeNodeMap[talent.id1];
    if (!node || (node.type !== "choice" && node.type !== "subtree")) continue;
    const grants = node.entries.some(
      (e) => "spellId" in e && String(e.spellId) === spellId,
    );
    if (!grants) continue;
    if (!node.entries.some((e) => e.id === talent.id2)) return false;
  }
  return true;
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
      specData.heroNodeMap[talent.id1] ??
      // 2026-09-07: 与 isLoadoutFullyResolved 对齐,它一直查四张表。今天
      // subTreeNodes 的条目不带 spellId 所以无差别,但两边查得不一样,就意味着
      // 一旦某个 build 给 subtree 条目加了 spellId,loadout 仍算「解析全」而这里
      // 解析不出来 —— 那会对一个玩家真有的天赋断言 "no"。
      specData.subtreeNodeMap[talent.id1];

    if (!node) continue;

    const entries =
      (node.type === "choice" ||
        node.type === "subtree" ||
        node.type === "tiered") &&
      talent.id2 > 0
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

/**
 * Buttons this spec's tree grants through an entry that carries ANOTHER
 * spell id: button id → the talent entry spell ids that grant it.
 *
 * Official: the entry's `visibleSpellId` — DB2 TraitDefinition.VisibleSpellID,
 * as raidbots' talents.json (`talentIdMap.json`) carries it. Such an entry's
 * own `spellId` is a passive that teaches the button (Balance's Incarnation:
 * Chosen of Elune is entry 394013, the button and its cast 102560; Fortifying
 * Brew 388917 → 115203), so the two id sets every reader built from the tree
 * (`getSpecTalentTreeSpellInfo`, `getPlayerTalentedSpellInfo`) hold the
 * passive and never the button: asked about the button, the tree answered
 * "not mine", and a holder's unpressed button stood in no ledger.
 *
 * A separate map and not more keys in those two sets: they are also read as
 * TALENT ids (modifier and replacement tables are keyed by the talent's own
 * spell), and a button id can be another definition's talent spell (Holy
 * Bulwark 432459 is the visible id of Holy's Holy Armaments entry and a
 * TraitDefinition.SpellID of its own, with an override that entry does not
 * carry).
 *
 * Readers: `getPlayerTalentGrantedButtonIds` (the cooldown ledger's ownership
 * rule, through `playerTalentIdSets`) and `talentOwnershipFromTables`.
 */
export const getSpecTalentButtonGrants = memoizeWhenReady(
  talentDataReady,
  (specId: number): ReadonlyMap<string, readonly string[]> => {
    const specData = nodeMaps[specId];
    const result = new Map<string, string[]>();
    if (!specData) return result;
    const allNodes = [
      ...specData.classNodes,
      ...specData.specNodes,
      ...(specData.heroNodes ?? []),
    ];
    for (const node of allNodes) {
      for (const entry of node.entries) {
        if (!entry.spellId || !entry.visibleSpellId) continue;
        if (entry.visibleSpellId === entry.spellId) continue;
        const button = entry.visibleSpellId.toString();
        const talentId = entry.spellId.toString();
        const granting = result.get(button) ?? [];
        if (!granting.includes(talentId)) granting.push(talentId);
        result.set(button, granting);
      }
    }
    return result;
  },
);

/**
 * The buttons of `getSpecTalentButtonGrants` THIS loadout holds: the same
 * node walk as `getPlayerTalentedSpellInfo`, keeping the purchased entry's
 * button. Stricter than that walk on one point, because it adds a claim
 * about a button nobody pressed: a choice / subtree / tiered node counts
 * only when the loadout says WHICH entry was taken (a row whose entry id
 * selects none grants nothing here; `getPlayerTalentedSpellInfo` lists every
 * entry of such a node). Returns null if talent data is unavailable.
 */
export function getPlayerTalentGrantedButtonIds(
  specId: number,
  talents: ({ id1: number; id2: number; count: number } | null)[],
): Set<string> | null {
  const specData = nodeMaps[specId];
  if (!specData) return null;

  const result = new Set<string>();
  for (const talent of talents) {
    if (!talent || talent.count === 0) continue;
    const node =
      specData.classNodeMap[talent.id1] ??
      specData.specNodeMap[talent.id1] ??
      specData.heroNodeMap[talent.id1];
    if (!node) continue;
    const entries =
      node.type === "choice" ||
      node.type === "subtree" ||
      node.type === "tiered"
        ? node.entries.filter((e) => e.id === talent.id2)
        : node.entries;
    for (const entry of entries) {
      if (!entry.spellId || !entry.visibleSpellId) continue;
      if (entry.visibleSpellId === entry.spellId) continue;
      result.add(entry.visibleSpellId.toString());
    }
  }
  return result;
}
