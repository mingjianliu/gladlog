// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  buildMatchSpellIndex,
  makeRichText,
  type RichDeps,
} from "./inlineRich";
import type { ReportSource } from "./types";

const deps: RichDeps = {
  nameIndex: new Map<string, readonly string[]>([
    ["Tranquility", ["740"]],
    ["Ice Block", ["45438"]],
    ["Block", ["107"]],
    ["Power Word: Shield", ["17"]],
    ["Chaos Bolt", ["116858", "999116"]],
  ]),
  zhNames: { "740": "宁静", "45438": "寒冰屏障", "17": "真言术:盾" },
  observed: new Set(["116858"]),
  specByName: { "Restoration Druid": 105 },
  specZh: { "Restoration Druid": "恢复德鲁伊" },
};
const emptySource = { units: {} } as unknown as ReportSource;
const rich = makeRichText(emptySource, "zh", deps);

const textOf = (node: React.ReactNode): string =>
  render(<span>{node}</span>).container.textContent ?? "";

describe("renderRichText(经 makeRichText)", () => {
  test("CJK 邻接命中:英文名换成中文名", () => {
    expect(textOf(rich("你的Tranquility没用"))).toBe("你的宁静没用");
  });

  test("最长匹配:Ice Block 不被 Block 截胡", () => {
    const { container } = render(<span>{rich("Cast Ice Block now")}</span>);
    expect(container.textContent).toContain("寒冰屏障");
    // no leftover English anywhere in the rendered text
    expect(container.textContent).not.toContain("Block");
  });

  test("多词带冒号名整体命中", () => {
    expect(textOf(rich("Power Word: Shield absorbed"))).toContain("真言术:盾");
  });

  test("词内不命中(boundary):Blockade 不触发 Block", () => {
    expect(textOf(rich("The Blockade held"))).toBe("The Blockade held");
  });

  test("歧义消解:本场 id 优先于 observed", () => {
    const src = {
      units: {
        a: { casts: [{ spellId: 999116, spellName: "混沌之箭" }] },
      },
    } as unknown as ReportSource;
    const r = makeRichText(src, "zh", deps);
    // 999116 is present in this match and its logged name is Chinese → display
    // uses this match's logged name
    expect(textOf(r("Chaos Bolt hit"))).toContain("混沌之箭");
  });

  test("歧义消解:本场没有 → observed(116858),再没有 → 最小 id", () => {
    // This match is empty and observed holds only 116858 → pick 116858; the zh
    // dictionary has no entry for that id → fall back to the English name
    expect(textOf(rich("Chaos Bolt hit"))).toContain("Chaos Bolt");
  });

  test("en 模式:不换名(图标由组件负责,文本原样)", () => {
    const r = makeRichText(emptySource, "en", deps);
    expect(textOf(r("Tranquility was available"))).toBe(
      "Tranquility was available",
    );
  });

  test("专精短语:zh 换名", () => {
    expect(textOf(rich("Restoration Druid died"))).toContain("恢复德鲁伊");
  });

  test("无命中原样返回同一字符串(=== 短路,不拆节点)", () => {
    const t = "没有任何英文技能名";
    expect(rich(t)).toBe(t);
  });

  test("nameIndex 未就绪(null)→ 全文原样", () => {
    const r = makeRichText(emptySource, "zh", { ...deps, nameIndex: null });
    expect(r("Tranquility")).toBe("Tranquility");
  });

  test("空/undefined 输入透传", () => {
    expect(rich(undefined)).toBeNull();
    expect(rich("")).toBe("");
  });
});

describe("撇号边界(firstToken 不吞 ' ,桶键与查找 key 对称)", () => {
  const apostropheDeps: RichDeps = {
    ...deps,
    nameIndex: new Map<string, readonly string[]>([
      ["Tranquility", ["740"]],
      ["Ice Block", ["45438"]],
      ["Block", ["107"]],
      ["Power Word: Shield", ["17"]],
      ["Chaos Bolt", ["116858", "999116"]],
      ["Renew", ["774"]],
      ["Death's Advance", ["199719"]],
    ]),
  };
  const r = makeRichText(emptySource, "zh", apostropheDeps);

  test("单词名 + 所有格:Renew's 仍命中 Renew(回归 firstToken 贪婪吞撇号导致的桶键错配)", () => {
    const { container } = render(<span>{r("Renew's tick was weak")}</span>);
    const icon = container.querySelector(".rpt-inline-spell");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("title")).toBe("Renew");
    // The zh dictionary lacks 774 → display falls back to the original, and the
    // concatenated content is unchanged
    expect(container.textContent).toBe("Renew's tick was weak");
  });

  test("多词带撇号名对称命中:Death's Advance 整体命中", () => {
    const { container } = render(<span>{r("Death's Advance is up")}</span>);
    const icon = container.querySelector(".rpt-inline-spell");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("title")).toBe("Death's Advance");
  });

  test("防误配:Deaths Advance(无撇号)不命中 Death's Advance", () => {
    const { container } = render(<span>{r("Deaths Advance is up")}</span>);
    expect(container.querySelector(".rpt-inline-spell")).toBeNull();
    expect(container.textContent).toBe("Deaths Advance is up");
  });
});

describe("buildMatchSpellIndex", () => {
  test("五类事件数组全防御缺失(fixture 剥数组不抛)", () => {
    const src = {
      units: {
        a: { casts: [{ spellId: 740, spellName: "宁静" }] },
        b: {}, // no event arrays at all
      },
    } as unknown as ReportSource;
    const idx = buildMatchSpellIndex(src);
    expect(idx.ids.has("740")).toBe(true);
    expect(idx.logNames.get("740")).toBe("宁静");
  });

  test("仅有 castStarts(读条被打断,如宁静被踢)也进本场索引", () => {
    const src = {
      units: {
        a: { castStarts: [{ spellId: 740, spellName: "宁静" }] },
      },
    } as unknown as ReportSource;
    const idx = buildMatchSpellIndex(src);
    expect(idx.ids.has("740")).toBe(true);
    expect(idx.logNames.get("740")).toBe("宁静");
  });
});
