/**
 * FT-T14: the word a summon gets beside its owner's label is read off the
 * log (`summonKindWord`), one predicate for every `X's <kind>` label; the
 * gate re-parses the word through `SUMMON_KIND_RE_SRC`.
 */
import { CombatUnitType, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { summonKindOf } from "../src/context/timelineHelpers";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  SUMMON_KIND_RE_SRC,
  SUMMON_KIND_WORDS,
  summonKindWord,
} from "../src/utils/summonKind";

const summoned = (spellId: string, spellName = ""): never =>
  ({
    actionIn: [
      { spellId, spellName, logLine: { event: LogEvent.SPELL_SUMMON } },
    ],
  }) as never;
const creature = (npc: string) =>
  `Creature-0-3878-2509-35306-${npc}-000007C5CB`;

describe("summonKindWord (FT-T14)", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("Pet- GUID 是常驻宠物,不管别的证据", () => {
    const pet = "Pet-0-3878-2509-35306-26125-020560C99D";
    expect(summonKindWord(pet)).toBe("pet");
    expect(summonKindWord(pet, { unit: summoned("192058") })).toBe("pet");
  });

  it("被图腾法术召唤出来的单位是 totem(读它自己的 SPELL_SUMMON 行)", () => {
    // npc 256196 Stormstream Totem is in no hand table: the summon line decides
    expect(
      summonKindWord(creature("256196"), { unit: summoned("1267068") }),
    ).toBe("totem");
    expect(
      summonKindWord(creature("61245"), { unit: summoned("192058") }),
    ).toBe("totem");
  });

  it("Totem of Wrath 也是图腾(词在名字开头);Totemic Projection 不是", () => {
    expect(
      summonKindWord(creature("105427"), { unit: summoned("204330") }),
    ).toBe("totem");
    expect(summonKindOf(creature("105427"))).toBe("totem");
    expect(
      summonKindWord(creature("47319"), { unit: summoned("108287") }),
    ).toBe("guardian");
  });

  it("没有召唤行时看登记的 npc 名字(Static Field Totem 日志里没有自己的 SPELL_SUMMON)", () => {
    expect(summonKindWord(creature("179867"))).toBe("guardian");
    expect(summonKindOf(creature("179867"))).toBe("totem");
    expect(summonKindOf(creature("61245"))).toBe("totem");
  });

  it("其它被召唤的生物是 guardian:Psyfiend、Lesser Ghoul、Totemic Projection 都不是图腾", () => {
    expect(summonKindOf(creature("101398"), summoned("211522"))).toBe(
      "guardian",
    );
    expect(summonKindOf(creature("237409"), summoned("275430"))).toBe(
      "guardian",
    );
    expect(summonKindOf(creature("47319"), summoned("108287"))).toBe(
      "guardian",
    );
  });

  it("没有 GUID(只带名字的旧文档)时沿用事件的单位类型", () => {
    expect(summonKindWord(undefined)).toBe("pet");
    expect(
      summonKindWord(undefined, { srcType: CombatUnitType.Guardian }),
    ).toBe("guardian");
    expect(summonKindWord(undefined, { srcType: CombatUnitType.Pet })).toBe(
      "pet",
    );
  });

  it("门规的正则认得每一个词,不认别的", () => {
    const re = new RegExp(`^${SUMMON_KIND_RE_SRC}$`);
    for (const w of SUMMON_KIND_WORDS) expect(re.test(w)).toBe(true);
    expect(re.test("summon")).toBe(false);
  });
});
