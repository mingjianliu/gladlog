/**
 * fact11 (F26) class 5 — saves the kill window's `defenseless` reading did
 * not see. D15: an area save whose aura the log writes with no source (Anti-
 * Magic Zone 145629). D17: Aura Mastery reaching the carriers of its
 * caster's Devotion Aura. The corpus checks are
 * `packages/eval/scripts/scan5/fact11.ts` areaCarryInDefenseless and
 * `scan5/allyShield.ts` (D19).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  areaSaveSpansOnS,
  empoweredAuraSpansOnS,
  NO_TARGET_GUID,
  saveAuraIntervals,
} from "../src/utils/enemyDefensives";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;

describe("fact11 D15 — Anti-Magic Zone's nil-source aura is carried", () => {
  // 211fe2a6 r0: pressed 1:48.26, 145629 on the priest 108.294–108.639
  const amz = {
    kind: "area" as const,
    spellId: "51052",
    atSeconds: 108.26,
    casterId: "dk",
  };
  const iv = (spellId: string, srcUnitId: string) =>
    ({ spellId, srcUnitId, fromS: 108.294, toS: 108.639 }) as never;
  it("a nil-source aura of the cast's name cuts the holder's span", () => {
    expect(
      areaSaveSpansOnS(amz, [iv("145629", NO_TARGET_GUID)], () => false, 8),
    ).toEqual([{ from: 108.294, to: 108.639 }]);
  });
  it("an aura of another name, or another unit's, does not", () => {
    expect(
      areaSaveSpansOnS(amz, [iv("97463", NO_TARGET_GUID)], () => false, 8),
    ).toEqual([]);
    expect(
      areaSaveSpansOnS(amz, [iv("145629", "someone")], () => false, 8),
    ).toEqual([]);
  });
});

describe("fact11 D17 — Aura Mastery reaches Devotion Aura's carriers", () => {
  // the holder's intervals as every reader builds them (`saveAuraIntervals`)
  const pal = makeUnit("pal", { name: "Pal" });
  const ivsOf = (rows: Array<[LogEvent, number, string?, string?]>) => {
    const druid = makeUnit("druid", {
      name: "Druid",
      auraEvents: rows.map(([ev, s, spellId = "465", src = "pal"]) => ({
        ...makeAuraEvent(ev, spellId, T0 + s * 1000, src, "druid", "BUFF"),
        srcUnitName: src === NO_TARGET_GUID ? "nil" : src,
      })),
    } as never);
    return saveAuraIntervals(druid, [pal], {
      startTime: T0,
      endTime: T0 + 300_000,
    });
  };
  const am = { spellId: "31821", casterId: "pal" };
  const wall = { from: 42.594, to: 50.598 };
  it("26b28640: Devotion Aura from 0:04 to 2:18, Aura Mastery 0:42.6–0:50.6", () => {
    const ivs = ivsOf([
      [LogEvent.SPELL_AURA_APPLIED, 4.3],
      [LogEvent.SPELL_AURA_REMOVED, 138],
    ]);
    expect(empoweredAuraSpansOnS(am, wall, "druid", ivs)).toEqual([wall]);
  });
  it("no Devotion Aura from that paladin, the paladin itself, or another wall: nothing", () => {
    const other = ivsOf([[LogEvent.SPELL_AURA_APPLIED, 4.3, "465", "pal2"]]);
    expect(empoweredAuraSpansOnS(am, wall, "druid", other)).toEqual([]);
    const own = ivsOf([[LogEvent.SPELL_AURA_APPLIED, 4.3]]);
    expect(empoweredAuraSpansOnS(am, wall, "pal", own)).toEqual([]);
    expect(
      empoweredAuraSpansOnS(
        { spellId: "498", casterId: "pal" },
        wall,
        "druid",
        own,
      ),
    ).toEqual([]);
  });
  it("a Devotion Aura removed mid-wall stops the reach there", () => {
    const ivs = ivsOf([
      [LogEvent.SPELL_AURA_APPLIED, 4.3],
      [LogEvent.SPELL_AURA_REMOVED, 45],
    ]);
    expect(empoweredAuraSpansOnS(am, wall, "druid", ivs)).toEqual([
      { from: 42.594, to: 45 },
    ]);
  });
  it("a REMOVED the log wrote with no source still ends the run (codex 20-F26-03 #2)", () => {
    const ivs = ivsOf([
      [LogEvent.SPELL_AURA_APPLIED, 4.3],
      [LogEvent.SPELL_AURA_REMOVED, 45, "465", NO_TARGET_GUID],
    ]);
    expect(empoweredAuraSpansOnS(am, wall, "druid", ivs)).toEqual([
      { from: 42.594, to: 45 },
    ]);
  });
});
