/** GH #155 (2026-10-21): reading duration extensions off talent tooltips —
 * every case is a real zhCN tooltip (build 12.1.5.69594). */
import { describe, expect, it } from "vitest";

import {
  evalAmount,
  expandForSpec,
  type IAmountContext,
  parseDurationClauses,
} from "../../scripts/datagen/lib/tooltipDurations";

const ctx = (
  spellId: string,
  points: Record<string, number>,
  durations: Record<string, number> = {},
): IAmountContext => ({
  spellId,
  points: (id, n) => points[`${id}:${n}`],
  durationS: (id) => durations[id],
});
const noSpecs = () => undefined;

describe("evalAmount", () => {
  it("resolves the placeholders a tooltip uses, and nothing it cannot", () => {
    const c = ctx("443425", {
      "443425:0": 1000,
      "443425:1": 4000,
      "56641:2": 15,
    });
    expect(evalAmount("${$s1/1000}", c)).toBe(1);
    expect(evalAmount("${$s2/1000}", c)).toBe(4);
    expect(evalAmount("${$56641m3/10}.1", c)).toBe(1.5);
    expect(evalAmount("$s1", ctx("x", { "x:0": 20 }))).toBe(20);
    expect(evalAmount("${$s9/1000}", c)).toBeUndefined();
    expect(evalAmount("${2*$<cap>}", c)).toBeUndefined();
  });
});

describe("parseDurationClauses — the shapes the 157 tooltips use", () => {
  it("Spiritwalker's Momentum: per cast-time spell +1 s, up to 4 s, on both spells", () => {
    const { clauses, unparsed } = parseDurationClauses(
      "使用带有施法时间的法术会使灵魂行者的恩赐和灵魂行者的神盾的持续时间延长${$s1/1000}秒，最多可延长${$s2/1000}秒。",
      ctx("443425", { "443425:0": 1000, "443425:1": 4000 }),
    );
    expect(unparsed).toEqual([]);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({
      targets: ["灵魂行者的恩赐", "灵魂行者的神盾"],
      kind: "per-event",
      unit: "s",
      amount: 1,
      cap: 4,
      capUnit: "s",
    });
    expect(clauses[0]!.trigger).toContain("使用带有施法时间的法术");
  });

  it("a fixed extension in seconds and in percent (Barkskin, Recklessness)", () => {
    expect(
      parseDurationClauses(
        "树皮术的持续时间延长${$s1/1000}秒。",
        ctx("327993", { "327993:0": 4000 }),
      ).clauses,
    ).toEqual([
      expect.objectContaining({
        targets: ["树皮术"],
        kind: "fixed",
        unit: "s",
        amount: 4,
      }),
    ]);
    expect(
      parseDurationClauses(
        "鲁莽会提供$s2层狂暴，并使鲁莽的持续时间延长$s1%。",
        ctx("1269310", { "1269310:0": 100, "1269310:1": 2 }),
      ).clauses,
    ).toEqual([
      expect.objectContaining({
        targets: ["鲁莽"],
        kind: "fixed",
        unit: "pct",
        amount: 100,
      }),
    ]);
  });

  it("a cap as a share of the base duration (Rising Mist)", () => {
    const [c] = parseDurationClauses(
      "施放旭日东升踢会使你的复苏之雾和氤氲之雾效果的持续时间延长$s1秒，最多可达基础持续时间的$s2%。",
      ctx("274909", { "274909:0": 4, "274909:1": 100 }),
    ).clauses;
    expect(c).toMatchObject({
      kind: "per-event",
      amount: 4,
      cap: 100,
      capUnit: "pct-of-base",
    });
  });

  it("a target the sentence leaves implied is handed back as the text to find it in", () => {
    const { clauses } = parseDurationClauses(
      "真言术：盾吸收的伤害提高$s1%，持续时间延长${$s2/1000}秒。",
      ctx("238135", { "238135:0": 10, "238135:1": 5000 }),
    );
    expect(clauses).toEqual([
      expect.objectContaining({ targets: [], kind: "fixed", amount: 5 }),
    ]);
    expect(clauses[0]!.subjectText).toContain("真言术：盾");
    const [frost] = parseDurationClauses(
      "当冰霜之柱激活时，你的自动攻击爆击会使其持续时间延长$s1秒，最多可达$s2秒。",
      ctx("456240", { "456240:0": 1, "456240:1": 6 }),
    ).clauses;
    expect(frost).toMatchObject({
      targets: [],
      kind: "per-event",
      amount: 1,
      cap: 6,
    });
    expect(frost!.subjectText).toContain("冰霜之柱");
  });
});

describe("expandForSpec", () => {
  it("takes the first true branch for the spec, else the else-branch", () => {
    // Avenging Wrath (53376): c1 (Holy) reads the c1 branch
    const text =
      "$?c1[复仇之怒和复仇十字军的持续时间延长$s1%。]?c2[戒卫。][其他。]";
    expect(expandForSpec(text, 0, "65", noSpecs)).toEqual({
      text: "复仇之怒和复仇十字军的持续时间延长$s1%。",
      unknown: false,
    });
    expect(expandForSpec(text, 2, "70", noSpecs).text).toBe("其他。");
  });

  it("an undecidable aura condition marks the rendering unknown", () => {
    expect(expandForSpec("$?a999[A][B]", 0, "1", noSpecs).unknown).toBe(true);
  });
});

describe("parseDurationClauses — codex 20-F16-13 #2–#5", () => {
  it("#3: 「X使Y的持续时间延长」 is an event-triggered extension (472361)", () => {
    const { clauses } = parseDurationClauses(
      "惩击使一个激活的救赎的持续时间延长${$s1/1000}.1秒。",
      ctx("472361", { "472361:0": 1000 }),
    );
    expect(clauses[0]).toMatchObject({
      kind: "per-event",
      amount: 1,
      targets: ["救赎"],
    });
  });
  it("#2: 「X施加的Y效果」 extends Y, not X (373049)", () => {
    const { clauses } = parseDurationClauses(
      "真言术：盾施加的救赎效果持续时间延长$s1秒。",
      ctx("373049", { "373049:0": 4 }),
    );
    expect(clauses[0]?.targets).toEqual(["救赎"]);
  });
  it("#4: an hour / minute unit is no second — unparsed (441403)", () => {
    const { clauses, unparsed } = parseDurationClauses(
      "持续时间延长至$m1$L小时:分钟;。",
      ctx("441403", { "441403:0": 1 }),
    );
    expect(clauses).toEqual([]);
    expect(unparsed).toHaveLength(1);
  });
  it("#5: 「至多」 is a cap (441829)", () => {
    const { clauses } = parseDurationClauses(
      "每次施放治疗法术会使其持续时间延长${$s1/1000}.1秒，至多$s3秒。",
      ctx("441829", { "441829:0": 600, "441829:2": 8 }),
    );
    expect(clauses[0]).toMatchObject({ cap: 8 });
  });
});
