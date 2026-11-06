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
} from "../src/utils/enemyDefensives";

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
  const row = (event: LogEvent, s: number, spellId = "465", src = "pal") => ({
    spellId,
    srcUnitId: src,
    destUnitId: "druid",
    logLine: { event, timestamp: T0 + s * 1000 },
  });
  const am = { spellId: "31821", casterId: "pal" };
  const wall = { from: 42.594, to: 50.598 };
  it("26b28640: Devotion Aura from 0:04 to 2:18, Aura Mastery 0:42.6–0:50.6", () => {
    const druid = {
      id: "druid",
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, 4.3),
        row(LogEvent.SPELL_AURA_REMOVED, 138),
      ],
    };
    expect(empoweredAuraSpansOnS(am, wall, druid as never, T0)).toEqual([
      wall,
    ]);
  });
  it("no Devotion Aura from that paladin, the paladin itself, or another wall: nothing", () => {
    const other = {
      id: "druid",
      auraEvents: [row(LogEvent.SPELL_AURA_APPLIED, 4.3, "465", "pal2")],
    };
    expect(empoweredAuraSpansOnS(am, wall, other as never, T0)).toEqual([]);
    expect(
      empoweredAuraSpansOnS(am, wall, { id: "pal", auraEvents: [] }, T0),
    ).toEqual([]);
    expect(
      empoweredAuraSpansOnS(
        { spellId: "498", casterId: "pal" },
        wall,
        { id: "druid", auraEvents: [row(LogEvent.SPELL_AURA_APPLIED, 4)] } as never,
        T0,
      ),
    ).toEqual([]);
  });
  it("a Devotion Aura removed mid-wall stops the reach there", () => {
    const druid = {
      id: "druid",
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, 4.3),
        row(LogEvent.SPELL_AURA_REMOVED, 45),
      ],
    };
    expect(empoweredAuraSpansOnS(am, wall, druid as never, T0)).toEqual([
      { from: 42.594, to: 45 },
    ]);
  });
});
