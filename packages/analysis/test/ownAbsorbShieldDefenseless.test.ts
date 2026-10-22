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
import {
  isOwnPressedShieldRun,
  ownPressedShieldSpansMs,
} from "../src/utils/enemyDefensives";

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
  it("a shield re-applied by its own buff long after the press still counts (Holy Bulwark 432607, 12 s after it)", () => {
    const HB = "432607";
    expect(
      isOwnPressedShieldRun(unit([absorb(HB)], [cast(HB, T - 12_000)]), HB, T),
    ).toBe(true);
    // past the 60 s lookback it is no longer that press's
    expect(
      isOwnPressedShieldRun(unit([absorb(HB)], [cast(HB, T - 61_000)]), HB, T),
    ).toBe(false);
  });
  it("a run kept up by REFRESH counts only within a minute of a press (b42: Holy Bulwark 6:33–6:43)", () => {
    const HB = "432607";
    const spans = ownPressedShieldSpansMs(
      unit([absorb(HB)], [cast(HB, T)]),
      HB,
      T - 5_000,
      T + 90_000,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]!.toMs).toBe(T + 60_000);
    // the ruling's shields: the whole run
    expect(ownPressedShieldSpansMs(unit([]), "17", T, T + 90_000)).toEqual([
      { fromMs: T, toMs: T + 90_000 },
    ]);
  });
  it("a passive talent absorb (Frost Shield 207203) never counts — no press", () => {
    expect(isOwnPressedShieldRun(unit([absorb("207203")]), "207203", T)).toBe(
      false,
    );
  });
});
