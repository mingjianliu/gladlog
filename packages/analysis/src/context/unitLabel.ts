import { specToString } from "../utils/cooldowns";

/**
 * "Arms Warrior" → "AWarrior": the compact spec tag every timeline reference
 * carries after the numeric id ("1(AWarrior)"). A/B cycle-1 accuracy fix:
 * bare ids forced the responder to map identities itself across thousands of
 * tokens. Shared by `matchTimeline.ts` and `observedConsequences.ts` so a unit
 * reads the same in every section.
 */
export function abbrevSpec(spec: string): string {
  const words = spec.split(" ").filter(Boolean);
  if (words.length <= 1) return spec;
  return (
    words
      .slice(0, -1)
      .map((w) => w[0])
      .join("") + words[words.length - 1]
  );
}

/**
 * `N(Spec)` for a name one side's id map answers to, or undefined for a name
 * it does not hold. The tag is keyed on the ID the map resolves, not on the
 * name's spelling: the maps answer to a character name with and without its
 * realm, and a tag looked up by the full name alone left the short spelling
 * as a bare `5` (FT leftovers 2026-10-11: 430 `[CC BROKEN] 2's …` lines and
 * 3 `broken by 5's …` on the 605-file capture). `units` may hold both sides —
 * a unit counts for this map when the map holds its full name.
 */
export function rosterLabelByName(
  units: readonly { name: string; spec: unknown }[],
  idMap: Map<string, number> | undefined,
): (name: string) => string | undefined {
  const tagById = new Map<number, string>();
  for (const u of units) {
    const id = idMap?.get(u.name);
    const tag = abbrevSpec(specToString(u.spec as never));
    if (id !== undefined && tag && !tagById.has(id)) tagById.set(id, tag);
  }
  if (idMap) {
    const known = tagsByIdMap.get(idMap) ?? new Map<number, string>();
    for (const [id, tag] of tagById) if (!known.has(id)) known.set(id, tag);
    tagsByIdMap.set(idMap, known);
  }
  return (name) => {
    const id = idMap?.get(name) ?? idMap?.get(name.split("-")[0]!);
    if (id === undefined) return undefined;
    const tag = tagById.get(id);
    return `${id}${tag ? `(${tag})` : ""}`;
  };
}

/** The spec tags `rosterLabelByName` built for an id map, by id — what
 * `rosterLabelOfId` reads where only the map and a resolved id travel. */
const tagsByIdMap = new WeakMap<Map<string, number>, Map<number, string>>();

/**
 * D3 (user 2026-10-24): the roster label of an id a map resolved — `N(Spec)`
 * once `rosterLabelByName` has read that map's roster (the timeline's setup
 * does, before any line is built), else the bare id. The damage rows (`Top
 * sources`, `killing blow`, `killed by`) carry the maps, not the units; they
 * printed a bare `N — Spell` beside every other line's `N(Spec)`.
 */
export function rosterLabelOfId(
  idMap: Map<string, number> | undefined,
  id: number,
): string {
  const tag = idMap ? tagsByIdMap.get(idMap)?.get(id) : undefined;
  return `${id}${tag ? `(${tag})` : ""}`;
}

/**
 * Player label as the timeline prints it: `${id}(${tag})` from the loadout's
 * id maps (friendly and enemy maps are separate — a friendly and an enemy may
 * share a display name), falling back to the bare name before the realm.
 */
export function unitLabeler(
  units: readonly { name: string; spec: unknown }[],
  playerIdMap: Map<string, number> | undefined,
  enemyIdMap: Map<string, number> | undefined,
): { friendly: (name: string) => string; enemy: (name: string) => string } {
  const make = (map: Map<string, number> | undefined) => {
    const label = rosterLabelByName(units, map);
    return (name: string): string => label(name) ?? name.split("-")[0]!;
  };
  return { friendly: make(playerIdMap), enemy: make(enemyIdMap) };
}
