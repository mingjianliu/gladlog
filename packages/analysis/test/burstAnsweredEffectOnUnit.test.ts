import { describe, expect, it } from "vitest";

import {
  ANSWER_EFFECT_LEAD_MS,
  pressEffectSpread,
} from "../src/analysis/burstWindowDecisionPoints";
import { creditedAnswer } from "../src/context/burstAnswered";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const aura = (spellId: string, src: string, dest: string, s: number) => ({
  timestamp: at(s),
  spellId,
  srcUnitId: src,
  destUnitId: dest,
  logLine: { event: "SPELL_AURA_APPLIED" },
});
const heal = (spellId: string, src: string, dest: string, s: number) => ({
  timestamp: at(s),
  spellId,
  srcUnitId: src,
  destUnitId: dest,
});

describe("pipeline T123: an answer counts for a unit only when its effect is on that unit", () => {
  it("an untargeted Rallying Cry's aura (97463) went on two of three teammates", () => {
    const players = [
      { id: "W", auraEvents: [aura("97463", "W", "W", 10)] },
      { id: "H", auraEvents: [aura("97463", "W", "H", 10)] },
      // the third gets it only from the next press, after the span
      { id: "M", auraEvents: [aura("97463", "W", "M", 30)] },
    ];
    expect(
      pressEffectSpread(
        players,
        "W",
        new Set(["W"]),
        "97462",
        at(10) - ANSWER_EFFECT_LEAD_MS,
        at(18),
      ).auraHolderIds,
    ).toEqual(["W", "H"]);
  });

  it("a Frenzied Regeneration on the druid alone has no row under its name on another player", () => {
    const players = [
      {
        id: "D",
        auraEvents: [aura("22842", "D", "D", 84.6)],
        healIn: [heal("22842", "D", "D", 84.6)],
      },
      { id: "P", auraEvents: [], healIn: [heal("19750", "P", "P", 85)] },
    ];
    expect(
      pressEffectSpread(
        players,
        "D",
        new Set(["D"]),
        "22842",
        at(84.1),
        at(92.6),
      ),
    ).toEqual({ auraHolderIds: ["D"], namedOnOther: false });
  });

  it("Emerald Communion's overflow heal (370984, same name) on an ally is a row under its name", () => {
    const players = [
      { id: "E", auraEvents: [aura("370960", "E", "E", 10)] },
      { id: "Z", healIn: [heal("370984", "E", "Z", 11)] },
    ];
    expect(
      pressEffectSpread(players, "E", new Set(["E"]), "370960", at(9.5), at(18))
        .namedOnOther,
    ).toBe(true);
  });

  it("another caster's rows and rows before the span are not the press's", () => {
    const players = [
      { id: "A", auraEvents: [aura("97463", "X", "A", 10)] },
      { id: "B", auraEvents: [aura("97463", "W", "B", 9)] },
    ];
    expect(
      pressEffectSpread(players, "W", new Set(["W"]), "97462", at(9.5), at(18))
        .auraHolderIds,
    ).toEqual([]);
  });

  const point = (r: Record<string, unknown>) =>
    ({
      pressured: { unitId: "M", minHpSec: 15, minHpPct: 2 },
      responseCasts: [{ casterId: "W", destId: "0000000000000000", ...r }],
    }) as unknown as Parameters<typeof creditedAnswer>[0];

  it("creditedAnswer rejects a per-recipient aura that missed the pressured unit, and another unit's self-only heal", () => {
    expect(
      creditedAnswer(
        point({ category: "external", effectOnUnitIds: ["W", "H"] }),
      ),
    ).toBeUndefined();
    expect(
      creditedAnswer(point({ category: "healCd", selfOnlyEffect: true })),
    ).toBeUndefined();
  });

  it("creditedAnswer keeps an aura that reached it, its own self-only heal, and a press with neither reading", () => {
    expect(
      creditedAnswer(
        point({ category: "external", effectOnUnitIds: ["W", "M"] }),
      ),
    ).toBeDefined();
    expect(
      creditedAnswer(
        point({ category: "healCd", selfOnlyEffect: true, casterId: "M" }),
      ),
    ).toBeDefined();
    expect(creditedAnswer(point({ category: "healCd" }))).toBeDefined();
  });
});
