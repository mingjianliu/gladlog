import { mkdtempSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  validateTalentData,
  writeTalentIdMap,
} from "../../scripts/datagen/fetchTalents";

const miniPath = new URL("./fixtures/mini-talents.json", import.meta.url)
  .pathname;
const mini = () => JSON.parse(readFileSync(miniPath, "utf-8"));

describe("fetchTalents", () => {
  it("合法 mini 数据 → validate 通过并落盘", () => {
    const data = mini();
    expect(() =>
      validateTalentData(data, { minSpecs: 2, minSpellEntries: 3 }),
    ).not.toThrow();
    const out = join(
      mkdtempSync(join(tmpdir(), "gl-tal-")),
      "talentIdMap.json",
    );
    writeTalentIdMap(out, data);
    expect(existsSync(out)).toBe(true);
    const round = JSON.parse(readFileSync(out, "utf-8"));
    expect(round).toHaveLength(2);
    expect(round[0].classNodes[0].entries[0].spellId).toBe(139);
  });

  it("缺 heroNodes → throw(四个节点数组均必需)", () => {
    const data = mini();
    delete data[0].heroNodes;
    expect(() =>
      validateTalentData(data, { minSpecs: 2, minSpellEntries: 3 }),
    ).toThrow(/heroNodes/);
  });

  it("非数组 / spec 数不足 → throw", () => {
    expect(() => validateTalentData({}, { minSpecs: 2 })).toThrow();
    expect(() =>
      validateTalentData(mini(), { minSpecs: 30, minSpellEntries: 3 }),
    ).toThrow(/30/);
  });

  it("聚合质量:合格 entry(spellId+name+icon)不足下限 → throw", () => {
    const data = mini();
    delete data[1].classNodes[0].entries[0].icon; // 3 → 2 个合格 entry
    expect(() =>
      validateTalentData(data, { minSpecs: 2, minSpellEntries: 3 }),
    ).toThrow(/qualifying|3/);
  });

  it("subTreeNodes entries 无 spellId/icon 不影响校验(不计入合格数)", () => {
    const data = mini();
    data[0].subTreeNodes = [
      {
        id: 99999,
        name: "Hero Choice",
        entries: [{ id: 1, name: "Oracle", type: "subtree" }],
      },
    ];
    expect(() =>
      validateTalentData(data, { minSpecs: 2, minSpellEntries: 3 }),
    ).not.toThrow();
  });
});
