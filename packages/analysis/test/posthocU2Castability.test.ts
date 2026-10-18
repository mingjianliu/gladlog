/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * codex post-hoc review 60-POSTHOC-02 (unit U2, castability), three facts:
 *  1. a dispel backlash (UA's silence 196364, VT's horror 87204) has no DR
 *     family, and `castBlockingAuraAt` read only the DR sets — a Shaman in
 *     the backlash silence was a ready Wind Shear kicker;
 *  2. a BROKEN row names the breaker, a friendly one too — the caster filter
 *     dropped it and the CC ran on to its official end;
 *  3. a SET of spells is stopped while every member is, per time — two
 *     overlapping single-school locks used to be dropped as "free".
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { spellSchoolMask } from "../src/data/spellSchools";
import {
  cannotCastIntervalsForSpells,
  cannotCastRuns,
  castBlockingAuraAt,
  castBlockingAuraIntervals,
  hardCcAuraAt,
  isSilenceOnlyAura,
  silenceIntervals,
} from "../src/utils/cannotCastIntervals";

const T0 = 1_000_000;
const enemyIds = new Set(["e"]);
const aura = (
  spellId: string,
  event: LogEvent,
  atS: number,
  srcUnitId = "e",
) => ({
  spellId,
  spellName: spellId,
  srcUnitId,
  timestamp: T0 + atS * 1000,
  logLine: { event, timestamp: T0 + atS * 1000 },
});
const unitWith = (auraEvents: unknown[], actionIn: unknown[] = []) =>
  ({
    id: "u",
    name: "Unit",
    auraEvents,
    actionIn,
    spellCastEvents: [],
    deathRecords: [],
  }) as any;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("1 — the dispel backlash is a control for the castability questions", () => {
  const WIND_SHEAR = "57994"; // silenceable
  const KICK = "1766"; // not silenceable
  it("UA's backlash silence stops a silenceable kick, not a physical one", () => {
    const u = unitWith([
      aura("196364", LogEvent.SPELL_AURA_APPLIED, 0),
      aura("196364", LogEvent.SPELL_AURA_REMOVED, 4),
    ]);
    expect(
      castBlockingAuraAt(u, enemyIds, T0 + 2000, WIND_SHEAR)?.spellId,
    ).toBe("196364");
    expect(castBlockingAuraAt(u, enemyIds, T0 + 2000, KICK)).toBeUndefined();
    expect(hardCcAuraAt(u, enemyIds, T0 + 2000)).toBeUndefined();
    expect(isSilenceOnlyAura("196364")).toBe(true);
    // its own [CC ON TEAM] … [DISPEL BACKLASH CC: silence] line names it —
    // no second [SILENCE] line
    expect(silenceIntervals(u, enemyIds)).toEqual([]);
  });
  it("VT's backlash horror stops every cast and holds the unit still", () => {
    const u = unitWith([
      aura("87204", LogEvent.SPELL_AURA_APPLIED, 0),
      aura("87204", LogEvent.SPELL_AURA_REMOVED, 3),
    ]);
    expect(castBlockingAuraAt(u, enemyIds, T0 + 1000, KICK)?.spellId).toBe(
      "87204",
    );
    expect(hardCcAuraAt(u, enemyIds, T0 + 1000)?.spellId).toBe("87204");
    expect(isSilenceOnlyAura("87204")).toBe(false);
  });
});

describe("2 — a friendly breaker's BROKEN row ends the CC", () => {
  const HOJ = "853";
  it("ends at the BROKEN, not the official length", () => {
    const u = unitWith([
      aura(HOJ, LogEvent.SPELL_AURA_APPLIED, 0),
      aura(HOJ, LogEvent.SPELL_AURA_BROKEN_SPELL, 2, "friend"),
    ]);
    const [iv] = castBlockingAuraIntervals(u, enemyIds);
    expect(iv).toMatchObject({ srcUnitId: "e", from: T0, to: T0 + 2000 });
  });
  it("a friendly APPLIED still opens nothing", () => {
    const u = unitWith([
      aura(HOJ, LogEvent.SPELL_AURA_APPLIED, 0, "friend"),
      aura(HOJ, LogEvent.SPELL_AURA_REMOVED, 2, "friend"),
    ]);
    expect(castBlockingAuraIntervals(u, enemyIds)).toEqual([]);
  });
});

describe("3 — a set of spells is stopped while every member is", () => {
  const FROSTBOLT = "116";
  const POLYMORPH = "118";
  const ICE_BLOCK = "45438"; // Frost
  const BLINK = "1953"; // Arcane
  const kick = (atS: number, spellId: string, interrupted: string) => ({
    logLine: { event: LogEvent.SPELL_INTERRUPT, timestamp: T0 + atS * 1000 },
    timestamp: T0 + atS * 1000,
    spellId,
    extraSpellId: interrupted,
    srcUnitId: "e",
    destUnitId: "u",
  });
  it("two overlapping single-school locks block the pair where they overlap", () => {
    expect(spellSchoolMask(ICE_BLOCK)).toBe(16);
    expect(spellSchoolMask(BLINK)).toBe(64);
    // Frost locked from 10 (Pummel), Arcane from 11 (Counterspell)
    const u = unitWith(
      [],
      [kick(10, "6552", FROSTBOLT), kick(11, "2139", POLYMORPH)],
    );
    const units = [u];
    const runsOf = (ids: string[]) =>
      cannotCastRuns(cannotCastIntervalsForSpells(u, enemyIds, ids, units));
    const frost = runsOf([ICE_BLOCK]);
    const arcane = runsOf([BLINK]);
    expect(frost).toHaveLength(1);
    expect(arcane).toHaveLength(1);
    const both = runsOf([ICE_BLOCK, BLINK]);
    // was [] — neither lock alone stops both spells
    expect(both).toEqual([
      {
        from: Math.max(frost[0]!.from, arcane[0]!.from),
        to: Math.min(frost[0]!.to, arcane[0]!.to),
      },
    ]);
    expect(both[0]!.to).toBeGreaterThan(both[0]!.from);
  });
  it("a lock that stops every spell of the set is kept whole", () => {
    const u = unitWith([], [kick(10, "2139", POLYMORPH)]);
    const ivs = cannotCastIntervalsForSpells(
      u,
      enemyIds,
      [BLINK, POLYMORPH],
      [u],
    );
    expect(ivs).toHaveLength(1);
    expect(
      cannotCastIntervalsForSpells(u, enemyIds, [BLINK], [u])[0],
    ).toMatchObject({ from: ivs[0]!.from, to: ivs[0]!.to });
  });
});
