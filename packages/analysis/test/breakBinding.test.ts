import { describe, expect, it } from "vitest";

import { dispelActorLabel } from "../src/context/timelineHelpers";
import {
  bindBreakToWindow,
  ccsRemovedByPress,
  type ICCInstance,
  pressEndedSilence,
} from "../src/utils/ccTrinketAnalysis";

/**
 * F15 / fact1215 R2 + R3 (2026-10-16): what a PvP trinket press removed, and
 * who a dispel line names.
 */

const T0 = Date.UTC(2026, 9, 16);
const cc = (
  atS: number,
  durS: number,
  over: Partial<ICCInstance> = {},
): ICCInstance =>
  ({
    atSeconds: atS,
    durationSeconds: durS,
    spellId: "1",
    spellName: "CC",
    sourceName: "x",
    sourceId: "x",
    sourceSpec: "",
    damageTakenDuring: 0,
    trinketState: "used",
    drInfo: null,
    distanceYards: null,
    losBlocked: null,
    ...over,
  }) as ICCInstance;

describe("break binding (F15 R3)", () => {
  it("a press logged after a removal the log gives another cause for does not take it (62fdbf2e: Detox 33 ms before the Medallion)", () => {
    const w = { applyMs: 1000, removeMs: 2000 };
    expect(bindBreakToWindow([w], 2033)).toBe(w);
    expect(bindBreakToWindow([{ ...w, endedByLoggedCause: true }], 2033)).toBe(
      undefined,
    );
    // at or before the removal it still can
    const caused = { ...w, endedByLoggedCause: true };
    expect(bindBreakToWindow([caused], 2000)).toBe(caused);
  });

  it("every CC that ended at the press, not only the bound one (6bf253f2 2:16: Hammer of Justice + Polymorph)", () => {
    const hoj = cc(10, 2.566, { spellName: "Hammer of Justice" });
    const poly = cc(11, 1.567, {
      spellName: "Polymorph",
      expectedDurationSeconds: 8,
    });
    const press = T0 + 12_567;
    const names = ccsRemovedByPress([hoj, poly], T0, press).map(
      (c) => c.spellName,
    );
    expect(names.sort()).toEqual(["Hammer of Justice", "Polymorph"]);
    // a CC the log gives another cause for, removed before the press, is out
    const broken = cc(10, 2.5, { spellName: "Fear", endedByLoggedCause: true });
    expect(
      ccsRemovedByPress([broken], T0, T0 + 12_530).map((c) => c.spellName),
    ).toEqual([]);
    // a secondary CC that ran its full official length ended on its own
    // (the binder's own pick is not re-judged here — see predicate-index NYU)
    const ranOut = cc(10, 4, { spellName: "Stun", expectedDurationSeconds: 4 });
    const kidney = cc(13, 1.005, {
      spellName: "Kidney Shot",
      expectedDurationSeconds: 5,
    });
    expect(
      ccsRemovedByPress([kidney, ranOut], T0, T0 + 14_005).map(
        (c) => c.spellName,
      ),
    ).toEqual(["Kidney Shot"]);
  });

  it("pressEndedSilence: within 300 ms before the removal or 100 ms after it (the shared cast-row lag)", () => {
    expect(pressEndedSilence(1000, 2000, 2000)).toBe(true);
    expect(pressEndedSilence(1000, 2000, 2100)).toBe(true);
    expect(pressEndedSilence(1000, 2000, 2101)).toBe(false);
    expect(pressEndedSilence(1000, 2000, 1700)).toBe(true);
    expect(pressEndedSilence(1000, 2000, 1699)).toBe(false);
    expect(pressEndedSilence(1000, 2000, 999)).toBe(false);
  });
});

describe("dispel actor label (F15 R2)", () => {
  it("a summon's dispel names it through its owner, with the [KICK] lines' word", () => {
    const label = (n: string) => `5(${n})`;
    const pet = { id: "Pet-0-1-2-3-417-0001", actionIn: [] } as never;
    expect(
      dispelActorLabel(
        {
          sourceName: "AWarlock",
          isPetDispel: true,
          summonUnitId: "Pet-0-1-2-3-417-0001",
        },
        label,
        [pet],
      ),
    ).toBe("5(AWarlock)'s pet");
    expect(
      dispelActorLabel({ sourceName: "AWarlock", isPetDispel: false }, label, []),
    ).toBe("5(AWarlock)");
  });
});
