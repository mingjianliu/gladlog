/**
 * scan5/t289 (T289): "is a reset real" — a kick on a later row of the Zenith
 * press's own millisecond answers it (codex 85-tk-L8-T289-1d: Zenith and the
 * next kick both 25.690 s, four rows apart, read as a miss).
 */
import { describe, expect, it } from "vitest";

import type { IRoundCtx } from "../scripts/scan5/ctx";
import { load, run, state } from "../scripts/scan5/t289";

const T0 = 1_760_000_000_000;
const RSK = "107428";
const ZENITH = "1249625";

const cast = (id: string, sec: number, lineIndex: number) => ({
  spellId: id,
  spellName: id,
  srcUnitId: "w",
  destUnitId: "",
  timestamp: T0 + sec * 1000,
  logLine: {
    event: "SPELL_CAST_SUCCESS",
    timestamp: T0 + sec * 1000,
    parameters: [],
    lineIndex,
  },
});

function zenithTally(rows: ReturnType<typeof cast>[]) {
  load({ rows: new Map(), pools: new Map(), follow: new Map(), palmLag: {} });
  const u = {
    id: "w",
    name: "W",
    spec: "269",
    info: { talents: [{ id1: 101053, id2: 124826, count: 1 }], pvpTalents: [] },
    spellCastEvents: rows,
    auraEvents: [],
    actionOut: [],
  };
  const legacy = { startTime: T0, endTime: T0 + 120_000, units: { w: u } };
  run({
    firstOwnerOfRound: true,
    start: T0,
    roundEndAt: T0 + 120_000,
    roundKey: "a|1",
    legacy,
    players: [u],
    units: [u],
    bump: () => undefined,
    violate: () => undefined,
  } as unknown as IRoundCtx);
  return state().follow.get("Zenith press");
}

describe("scan5/t289 is a reset real", () => {
  it("禅意和下一次踢同一毫秒、踢在后面的行:算作对禅意的响应", () => {
    expect(
      zenithTally([
        cast(RSK, 22.438, 10),
        cast(ZENITH, 25.69, 20),
        cast(RSK, 25.69, 24),
      ]),
    ).toEqual({ n: 1, hit: 1 });
  });
  it("同一毫秒但踢在禅意之前的行:不算", () => {
    expect(
      zenithTally([
        cast(RSK, 22.438, 10),
        cast(RSK, 25.69, 18),
        cast(ZENITH, 25.69, 20),
      ])?.hit ?? 0,
    ).toBe(0);
  });
});
