import { describe, expect, test, vi } from "vitest";

import {
  iconCdnUrl,
  iconNameVariants,
  mineSpellIcons,
  repairUnservedIconNames,
} from "../scripts/datagen/genSpellIcons";

describe("iconNameVariants", () => {
  test("空格 → 连字符(冰霜之环的实测修正)", () => {
    expect(iconNameVariants("spell_frost_ring of frost")).toEqual([
      "spell_frost_ring-of-frost",
    ]);
  });

  test("多个空格全部替换", () => {
    expect(iconNameVariants("a b c")).toEqual(["a-b-c"]);
  });

  test("已经合法/没有空格的名字不产生候选(不做无依据的猜测)", () => {
    expect(iconNameVariants("spell_frost_frostnova")).toEqual([]);
    expect(iconNameVariants("inv_misc_fork&knife")).toEqual([]);
  });
});

describe("iconCdnUrl", () => {
  test("空格按 URL 规则编码,与运行时 iconCache 同源", () => {
    expect(iconCdnUrl("spell_frost_ring of frost")).toBe(
      "https://wow.zamimg.com/images/wow/icons/large/spell_frost_ring%20of%20frost.jpg",
    );
  });
});

describe("repairUnservedIconNames", () => {
  test("CDN 只认连字符版时,把空格名改写掉(Ring of Frost 回归)", async () => {
    const icons: Record<string, string> = {
      "82691": "spell_frost_ring of frost",
      "113724": "spell_frost_ring of frost",
      "122": "spell_frost_frostnova",
    };
    // Only the hyphenated variant resolves.
    const probe = vi.fn(
      async (url: string) => url === iconCdnUrl("spell_frost_ring-of-frost"),
    );

    const res = await repairUnservedIconNames(icons, probe, () => {});

    expect(res.repaired).toBe(1);
    expect(icons["82691"]).toBe("spell_frost_ring-of-frost");
    expect(icons["113724"]).toBe("spell_frost_ring-of-frost");
    // Untouched: already a plain identifier, never probed.
    expect(icons["122"]).toBe("spell_frost_frostnova");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  test("候选也不存在时保留原名(不猜一个同样 404 的名字)", async () => {
    const icons: Record<string, string> = {
      "1": "warlock_ healthstone",
    };
    const probe = vi.fn(async () => false);

    const res = await repairUnservedIconNames(icons, probe, () => {});

    expect(res.repaired).toBe(0);
    expect(res.stillUnserved).toBe(1);
    expect(icons["1"]).toBe("warlock_ healthstone");
  });

  test("每个不同的名字只探测一次(表里 ~7.7k 名,只有非标识符的需要探测)", async () => {
    const icons: Record<string, string> = {};
    for (let i = 0; i < 50; i++) icons[String(i)] = "spell_frost_ring of frost";
    icons["999"] = "spell_frost_frostnova";
    const probe = vi.fn(async () => false);

    await repairUnservedIconNames(icons, probe, () => {});

    expect(probe).toHaveBeenCalledTimes(1);
  });

  test("没有可疑名时不发起任何请求", async () => {
    const icons = { "1": "spell_frost_frostnova", "2": "ability_ambush" };
    const probe = vi.fn(async () => true);

    const res = await repairUnservedIconNames(icons, probe, () => {});

    expect(res).toEqual({ repaired: 0, stillUnserved: 0 });
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("mineSpellIcons 仍是 DB2 原样提取(规范化在上层单独进行)", () => {
  test("id → FileName 去掉 .blp 与大小写", () => {
    const icons = mineSpellIcons(
      {
        spellMisc: [{ SpellID: "82691", DifficultyID: "0", SpellIconFileDataID: "1" }],
        manifestInterfaceData: [
          { ID: "1", FilePath: "Interface\\ICONS\\", FileName: "spell_frost_ring of frost.blp" },
        ],
      },
      null,
    );
    expect(icons["82691"]).toBe("spell_frost_ring of frost");
  });
});
