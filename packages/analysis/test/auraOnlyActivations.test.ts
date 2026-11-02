import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { castlessHealCdAuras } from "../src/utils/auraOnlyActivations";

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
