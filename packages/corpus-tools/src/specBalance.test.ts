import { CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import type { DetailedMatchStub } from "./feedClient";
import type { ManifestEntry } from "./pvpLogFetch";
import {
  orderBySpecBalance,
  recorderSpecOf,
  storedRecorderSpecCounts,
} from "./specBalance";

const DEMO = CombatUnitSpec.Warlock_Demonology;
const RDRUID = CombatUnitSpec.Druid_Restoration;
const FURY = CombatUnitSpec.Warrior_Fury;
const PROT = CombatUnitSpec.Warrior_Protection;

function stub(id: string, spec: string): DetailedMatchStub {
  return {
    id,
    playerId: `p-${id}`,
    logObjectUrl: `obj-${id}`,
    units: [
      { id: `other-${id}`, spec: RDRUID },
      { id: `p-${id}`, spec },
    ],
  } as unknown as DetailedMatchStub;
}

function entry(
  url: string,
  spec: string | null,
  startTime: number,
): ManifestEntry {
  return {
    logObjectUrl: url,
    startTime,
    recorder: spec ? { name: "x", spec, teamId: "0", personalRating: 0 } : null,
  } as unknown as ManifestEntry;
}

describe("recorderSpecOf", () => {
  it("reads the recorder's unit, not the first unit", () => {
    expect(recorderSpecOf(stub("a", DEMO))).toBe(DEMO);
  });
  it("is empty when the recorder is not among the units", () => {
    const s = { ...stub("a", DEMO), playerId: "nobody" } as DetailedMatchStub;
    expect(recorderSpecOf(s)).toBe("");
  });
});

describe("storedRecorderSpecCounts", () => {
  it("counts the patch only, one log object once, and skips a missing recorder", () => {
    const counts = storedRecorderSpecCounts(
      [
        entry("o1", RDRUID, 200),
        entry("o1", RDRUID, 200), // the same object in a second manifest
        entry("o2", RDRUID, 300),
        entry("o3", DEMO, 100), // before go-live
        entry("o4", null, 300),
      ],
      150,
    );
    expect([...counts]).toEqual([[RDRUID, 2]]);
  });
});

describe("orderBySpecBalance", () => {
  it("takes the fewest-held spec first and keeps feed order on ties", () => {
    const pool = [
      stub("1", RDRUID),
      stub("2", FURY),
      stub("3", DEMO),
      stub("4", FURY),
    ];
    const stored = new Map([
      [RDRUID, 100],
      [FURY, 9],
      [DEMO, 5],
    ]);
    expect(orderBySpecBalance(pool, stored).map((s) => s.id)).toEqual([
      "3",
      "2",
      "4",
      "1",
    ]);
  });

  it("counts each pick as it is made", () => {
    // Demonology 5 vs Fury 6: d1 brings Demonology level, the tie goes to feed
    // order (d2), then Fury is behind (f1), and so on.
    const pool = [
      stub("d1", DEMO),
      stub("d2", DEMO),
      stub("d3", DEMO),
      stub("f1", FURY),
      stub("f2", FURY),
    ];
    const stored = new Map([
      [DEMO, 5],
      [FURY, 6],
    ]);
    expect(orderBySpecBalance(pool, stored).map((s) => s.id)).toEqual([
      "d1",
      "d2",
      "f1",
      "d3",
      "f2",
    ]);
  });

  it("puts tanks after every other spec despite a zero count", () => {
    const pool = [stub("t", PROT), stub("r", RDRUID)];
    const stored = new Map([[RDRUID, 111]]);
    expect(orderBySpecBalance(pool, stored).map((s) => s.id)).toEqual([
      "r",
      "t",
    ]);
  });

  it("does not mutate the stored counts", () => {
    const stored = new Map([[DEMO, 5]]);
    orderBySpecBalance([stub("1", DEMO)], stored);
    expect(stored.get(DEMO)).toBe(5);
  });
});
