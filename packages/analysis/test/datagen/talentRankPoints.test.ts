import { describe, expect, it } from "vitest";

import {
  adjustPoints,
  curveValueAt,
  rankPointsResolver,
  specPointsAdjusts,
} from "../../scripts/datagen/lib/talentRankPoints";
import talentModifiers from "../../src/data/talentModifiers.json";
import { applyCdModifiers } from "../../src/utils/cooldowns";
import type { ICDModifier } from "../../src/utils/talentModifiers";

const mods = talentModifiers as Record<string, ICDModifier[]>;

describe("talent points per rank and per spec (cooldown mastery 2026-10-20)", () => {
  it("a curve is read at the rank, linearly between points, clamped at the ends", () => {
    const pts = [
      { x: 1, y: -7500 },
      { x: 2, y: -15000 },
    ];
    expect(curveValueAt(pts, 1)).toBe(-7500);
    expect(curveValueAt(pts, 2)).toBe(-15000);
    expect(curveValueAt(pts, 3)).toBe(-15000);
    expect(curveValueAt(pts, 1.5)).toBe(-11250);
  });

  it("operation 0 sets the points, operation 1 multiplies the base", () => {
    const byRank = rankPointsResolver(
      [
        {
          TraitDefinitionID: "9",
          EffectIndex: "0",
          OperationType: "0",
          CurveID: "1",
        },
        {
          TraitDefinitionID: "9",
          EffectIndex: "1",
          OperationType: "1",
          CurveID: "2",
        },
        {
          TraitDefinitionID: "9",
          EffectIndex: "2",
          OperationType: "-1",
          CurveID: "2",
        },
      ],
      [
        { CurveID: "1", Pos_0: "1", Pos_1: "-7500", OrderIndex: "0" },
        { CurveID: "1", Pos_0: "2", Pos_1: "-15000", OrderIndex: "1" },
        { CurveID: "2", Pos_0: "1", Pos_1: "1", OrderIndex: "0" },
        { CurveID: "2", Pos_0: "2", Pos_1: "2", OrderIndex: "1" },
      ],
      new Map([["100", { definitionId: "9", maxRanks: 2 }]]),
    );
    expect(byRank("100", 0, -30000)).toEqual([-7500, -15000]);
    expect(byRank("100", 1, -5000)).toEqual([-5000, -10000]);
    expect(byRank("100", 2, -5000)).toBeUndefined();
    expect(byRank("101", 0, -5000)).toBeUndefined();
  });

  it("a spec passive rewrites a talent's effect by label (PointsIndex op → effect)", () => {
    const adj = specPointsAdjusts(
      [
        {
          ID: "1",
          SpellID: "1258016",
          EffectAura: "219",
          EffectMiscValue_0: "3",
          EffectMiscValue_1: "2651",
          EffectBasePointsF: "45000",
          PvpMultiplier: "1",
        },
      ],
      [{ LabelID: "2651", SpellID: "384820" }],
      new Map([["1258016", [65]]]),
    );
    const a = adj.get("384820:0")!;
    expect(a.map((x) => x.specIds)).toEqual([["65"]]);
    expect(adjustPoints(-60000, a)).toBe(-15000);
  });

  it("generated: Holy's Blessing of Sacrifice is 105 s with Sacrifice of the Just, Retribution's 60 s", () => {
    const cd = (specId: string) =>
      applyCdModifiers(mods["6940"], 120, 1, new Set(["384820"]), new Set(), {
        specId,
      }).cooldownSeconds;
    // corpus floors (2,240 files): Holy 104.0–105.0 over 581 recasts,
    // Retribution 60.0
    expect(cd("65")).toBe(105);
    expect(cd("70")).toBe(60);
  });

  it("generated: Avenging Crusader with Call of the Righteous is 52.5 s at rank 1, 45 s at rank 2", () => {
    const cd = (rank: number) =>
      applyCdModifiers(mods["216331"], 60, 1, new Set(["1241511"]), new Set(), {
        specId: "65",
        talentRanks: new Map([["1241511", rank]]),
      }).cooldownSeconds;
    expect(cd(1)).toBe(52.5);
    expect(cd(2)).toBe(45);
    // unknown rank → rank 1, the smaller give-back
    expect(
      applyCdModifiers(mods["216331"], 60, 1, new Set(["1241511"]), new Set(), {
        specId: "65",
      }).cooldownSeconds,
    ).toBe(52.5);
  });

  it("generated: Static Charge's DB2 per-rank table is the user's 10 s a rank", () => {
    const row = mods["192058"]!.find((m) => m.talentSpellId === "265046")!;
    expect(row.valueByRank).toEqual([10, 20]);
  });
});
