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
 * Player label as the timeline prints it: `${id}(${tag})` from the loadout's
 * id maps (friendly and enemy maps are separate — a friendly and an enemy may
 * share a display name), falling back to the bare name before the realm.
 */
export function unitLabeler(
  units: { name: string; spec: unknown }[],
  playerIdMap: Map<string, number> | undefined,
  enemyIdMap: Map<string, number> | undefined,
): { friendly: (name: string) => string; enemy: (name: string) => string } {
  const tag = new Map(
    units.map((u) => [u.name, abbrevSpec(specToString(u.spec as never))]),
  );
  const make =
    (map: Map<string, number> | undefined) =>
    (name: string): string => {
      const short = name.split("-")[0]!;
      if (!map) return short;
      const id = map.get(name) ?? map.get(short);
      const t = tag.get(name);
      return id !== undefined ? `${id}${t ? `(${t})` : ""}` : short;
    };
  return { friendly: make(playerIdMap), enemy: make(enemyIdMap) };
}
