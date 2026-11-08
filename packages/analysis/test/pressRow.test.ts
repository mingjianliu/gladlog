import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { isAutomaticCastRow, isNoPlayerPressRow } from "../src/utils/pressRow";

const row = (spellId: string, ms: number, destUnitId = "t") => ({
  spellId,
  destUnitId,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: ms },
});

describe("isNoPlayerPressRow (pipeline T12)", () => {
  it("refuses an auto-attack swing, a passive proc and a copy row; keeps a button", () => {
    // Crusading Strikes swing, Reclamation proc
    expect(isAutomaticCastRow({ spellId: "408385" })).toBe(true);
    expect(isAutomaticCastRow({ spellId: "415388" })).toBe(true);
    expect(isAutomaticCastRow({ spellId: "96231" })).toBe(false);
    const lavaLash = row("60103", 1000);
    const sundering = row("467283", 1000, "0000000000000000");
    const twinFlame = row("1265980", 2000);
    const disintegrate = row("356995", 2000);
    const rows = [sundering, lavaLash, twinFlame, disintegrate];
    expect(isNoPlayerPressRow(sundering, rows)).toBe(true);
    expect(isNoPlayerPressRow(twinFlame, rows)).toBe(true);
    expect(isNoPlayerPressRow(lavaLash, rows)).toBe(false);
    expect(isNoPlayerPressRow(disintegrate, rows)).toBe(false);
    expect(isNoPlayerPressRow(row("408385", 3000), rows)).toBe(true);
  });

  it("refuses a companion row beside its press (Germination's 774 beside 155777)", () => {
    const germ = row("155777", 1000);
    const rejuv = row("774", 1001);
    expect(isNoPlayerPressRow(rejuv, [germ, rejuv])).toBe(true);
    expect(isNoPlayerPressRow(rejuv, [rejuv])).toBe(false);
  });
});
