import { describe, expect, it } from "vitest";
import { meterRows, meterValue } from "./meterRows";
import type { UnitTotals } from "./summary";

function u(partial: Partial<UnitTotals>): UnitTotals {
  return {
    unitId: "id",
    name: "X",
    classId: 1,
    specId: 0,
    teamId: 0,
    damageDone: 0,
    healingDone: 0,
    absorbsDone: 0,
    damageTaken: 0,
    deaths: 0,
    dps: 0,
    hps: 0,
    ...partial,
  };
}

describe("meterValue", () => {
  it("selects the field for the mode; healing sums heal + absorbs", () => {
    const row = u({
      damageDone: 100,
      healingDone: 30,
      absorbsDone: 20,
      damageTaken: 7,
    });
    expect(meterValue(row, "damage")).toBe(100);
    expect(meterValue(row, "healing")).toBe(50);
    expect(meterValue(row, "taken")).toBe(7);
  });
});

describe("meterRows", () => {
  it("sorts desc, scales width to the max, formats the label with thousands separators", () => {
    const rows = [
      u({ unitId: "a", name: "A", classId: 2, damageDone: 500 }),
      u({ unitId: "b", name: "B", classId: 3, damageDone: 2000 }),
    ];
    const out = meterRows(rows, "damage");
    expect(out.map((r) => r.unitId)).toEqual(["b", "a"]);
    expect(out[0].widthPct).toBe(100);
    expect(out[1].widthPct).toBe(25);
    expect(out[0].label).toBe("2,000");
    expect(out[1].value).toBe(500);
  });

  it("all-zero meter yields widthPct 0 for every row (no divide-by-zero)", () => {
    const out = meterRows(
      [u({ unitId: "a", damageDone: 0 }), u({ unitId: "b", damageDone: 0 })],
      "damage",
    );
    expect(out.every((r) => r.widthPct === 0)).toBe(true);
  });
});
