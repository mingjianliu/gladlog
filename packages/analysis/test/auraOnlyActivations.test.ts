import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  auraOnlyActivations,
  castlessHealCdAuras,
} from "../src/utils/auraOnlyActivations";

const START = 1_000_000;
const row = (
  event: string,
  spellId: string,
  ms: number,
  unit = "Player-1",
): never =>
  ({
    logLine: { event, timestamp: ms },
    timestamp: ms,
    spellId,
    spellName: "x",
    srcUnitId: unit,
    srcUnitName: "a",
    destUnitId: unit,
    destUnitName: "a",
    auraType: "BUFF",
  }) as never;

const shaman = (auras: never[], casts: never[]) =>
  ({
    id: "Player-1",
    name: "a",
    spec: 264,
    auraEvents: auras,
    spellCastEvents: casts,
  }) as never;

describe("castlessHealCdAuras (fact8 D26)", () => {
  beforeAll(() => ensureAnalysisData());

  it("a healing major's aura with no press near it is an activation", () => {
    const u = shaman(
      [row(LogEvent.SPELL_AURA_APPLIED, "114052", START + 30_000)],
      [],
    );
    const out = castlessHealCdAuras(u, START, START + 60_000);
    expect(out.map((a) => [a.atSeconds, a.spellId])).toEqual([[30, "114052"]]);
  });

  it("a press beside the aura is that press", () => {
    const u = shaman(
      [row(LogEvent.SPELL_AURA_APPLIED, "114052", START + 30_000)],
      [row(LogEvent.SPELL_CAST_SUCCESS, "114052", START + 30_001)],
    );
    expect(castlessHealCdAuras(u, START, START + 60_000)).toEqual([]);
  });

  it("another spec's aura of that id is none (spec gate)", () => {
    const u = {
      ...(shaman(
        [row(LogEvent.SPELL_AURA_APPLIED, "391528", START + 30_000)],
        [],
      ) as object),
      spec: 103,
    } as never;
    expect(castlessHealCdAuras(u, START, START + 60_000)).toEqual([]);
  });
});

describe("auraOnlyActivations — the round's end (T287)", () => {
  beforeAll(() => ensureAnalysisData());

  // audit-1215 06 D1 (2c832cac r0): the hunter died 89.090 s in, the druid
  // pressed Barkskin 89.583 — cast row and aura in one ms. The press lane
  // stops at the round's end; the aura lane must too, or the press reads as
  // `[PROC] Barkskin (no press)`
  const druid = (ms: number) =>
    ({
      id: "Player-1",
      name: "a",
      spec: 102,
      auraEvents: [row(LogEvent.SPELL_AURA_APPLIED, "22812", ms)],
      spellCastEvents: [row(LogEvent.SPELL_CAST_SUCCESS, "22812", ms)],
      damageIn: [],
      healIn: [],
      absorbsIn: [],
    }) as never;

  it("an aura that went up after the round's end is no activation of it", () => {
    const u = druid(START + 89_583);
    expect(
      auraOnlyActivations(u, [u], START, START + 89_090, START + 91_000),
    ).toEqual([]);
  });

  it("…with no press of it either (the clamp to the round's end, T287)", () => {
    const u = {
      ...(druid(START + 89_583) as object),
      spellCastEvents: [],
    } as never;
    expect(
      auraOnlyActivations(u, [u], START, START + 89_090, START + 91_000),
    ).toEqual([]);
  });

  it("inside the round the press stands for its aura (no activation either)", () => {
    const u = druid(START + 88_583);
    expect(
      auraOnlyActivations(u, [u], START, START + 89_090, START + 91_000),
    ).toEqual([]);
  });

  it("inside the round an aura with no press is still its line", () => {
    const u = {
      ...(druid(START + 88_583) as object),
      spellCastEvents: [],
    } as never;
    expect(
      auraOnlyActivations(u, [u], START, START + 89_090, START + 91_000).map(
        (a) => [a.atSeconds, a.spellId, a.family],
      ),
    ).toEqual([[88.583, "22812", "save"]]);
  });
});
