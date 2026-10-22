/**
 * The target's own absorb shields that end `defenseless` while up
 * (corpusFactScan2 defenselessSaveUp ownAbsorb, 2026-10-22): ruling (1)'s
 * Power Word: Shield / Void Shield ids pressed or not; any other aura DB2
 * calls an absorb only when the log shows it absorbing as the unit's own
 * shield AND the unit pressed it at the run's start (E6: a talent's passive
 * absorb — Frost Shield, Will of the Necropolis — is no shield it applied).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { isOwnPressedShieldRun } from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T = 1_000_000;
const absorb = (spellId: string, owner = "u") => ({
  spellId,
  srcUnitId: owner,
  absorbedAmount: 10_000,
  timestamp: T + 500,
  logLine: { timestamp: T + 500 },
});
const cast = (spellId: string, ms: number) => ({
  spellId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
});
const unit = (absorbsIn: unknown[], casts: unknown[] = []) =>
  ({ id: "u", absorbsIn, spellCastEvents: casts }) as never;

describe("isOwnPressedShieldRun", () => {
  it("the ruling's shields count pressed or not (Holy's proc PW:S 1246768 has no cast row)", () => {
    for (const id of ["17", "1246768", "1253593"])
      expect(isOwnPressedShieldRun(unit([]), id, T), id).toBe(true);
  });
  it("a pressed Blazing Barrier that absorbed counts; unpressed, or with no absorb row, it does not", () => {
    const BB = "235313";
    expect(
      isOwnPressedShieldRun(unit([absorb(BB)], [cast(BB, T)]), BB, T),
    ).toBe(true);
    expect(isOwnPressedShieldRun(unit([absorb(BB)]), BB, T)).toBe(false);
    expect(isOwnPressedShieldRun(unit([], [cast(BB, T)]), BB, T)).toBe(false);
    // a shield an ally owns is not the unit's own
    expect(
      isOwnPressedShieldRun(unit([absorb(BB, "ally")], [cast(BB, T)]), BB, T),
    ).toBe(false);
  });
  it("a passive talent absorb (Frost Shield 207203) never counts — no press", () => {
    expect(isOwnPressedShieldRun(unit([absorb("207203")]), "207203", T)).toBe(
      false,
    );
  });
});
