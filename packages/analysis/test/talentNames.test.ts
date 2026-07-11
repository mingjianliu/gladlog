import { nodeMaps } from "../src/data/talentStrings";
import { getTalentNames } from "../src/data/talentNames";

describe("getTalentNames", () => {
  it("真实 talentIdMap 自洽:任一 spec 的首个 classNode entry 可命名", () => {
    const specIds = Object.keys(nodeMaps).map(Number);
    expect(specIds.length).toBeGreaterThanOrEqual(30);
    const specId = specIds.find(
      (id) => nodeMaps[id].classNodes.length > 0,
    ) as number;
    const node = nodeMaps[specId].classNodes[0];
    const entry = node.entries[0];
    const r = getTalentNames(specId, [
      { id1: node.id, id2: entry.id, count: 1 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe(entry.name);
    expect(r[0].icon).toBe(entry.icon);
    expect(r[0].rank).toBe(1);
  });

  it("未知 specId / 未知节点 → 空数组或跳过,不抛", () => {
    expect(getTalentNames(999999, [{ id1: 1, id2: 2, count: 1 }])).toEqual([]);
    const specId = Number(Object.keys(nodeMaps)[0]);
    expect(
      getTalentNames(specId, [{ id1: 424242, id2: 424243, count: 1 }]),
    ).toEqual([]);
  });
});
