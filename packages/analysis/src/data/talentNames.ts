import { nodeMaps } from "./talentStrings";

export function getTalentNames(
  specId: number,
  talents: { id1: number; id2: number; count: number }[],
): { name: string; icon: string; rank: number }[] {
  const spec = nodeMaps[specId];
  if (!spec) return [];

  const result: { name: string; icon: string; rank: number }[] = [];

  for (const t of talents) {
    const node =
      spec.classNodeMap[t.id1] ??
      spec.specNodeMap[t.id1] ??
      spec.heroNodeMap[t.id1] ??
      spec.subtreeNodeMap[t.id1];

    const entry = node?.entries?.find((e) => e.id === t.id2);
    if (entry && entry.name) {
      result.push({
        name: entry.name,
        icon: (entry as any).icon ?? "",
        rank: t.count,
      });
    }
  }

  return result;
}
