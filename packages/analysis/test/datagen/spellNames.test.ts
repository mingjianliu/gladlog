import { readFileSync } from "fs";
import { transformSpellNames } from "../../scripts/datagen/genSpellNames";

const csv = readFileSync(
  new URL("./fixtures/SpellName.mini.csv", import.meta.url).pathname,
  "utf-8",
);

describe("transformSpellNames", () => {
  it("ID→Name_lang 全量映射,引号/逗号名正确", () => {
    const map = transformSpellNames(csv);
    expect(Object.keys(map)).toHaveLength(10);
    expect(map["118"]).toBe("Polymorph");
    expect(map["17"]).toBe("Power Word: Shield");
    expect(map["383121"]).toBe("Mass Polymorph, Test");
  });
});
