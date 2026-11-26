/**
 * Pipeline T278 (12.1.5 audit 15-fc0bed09 r0 D1 / D2): Adaptation's lockout
 * 336139 REMOVED by its holder's death is the wipe, not the trinket coming
 * back. 336139 up 3:00.37, REMOVED 3:24.843, UNIT_DIED 3:24.845: the
 * product printed "23s left" at 3:02 (really ~58 s) and "PvP Trinket
 * available" on the [DEATH] line.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import {
  pvpTrinketUsesUncached,
  trinketUseRemainingSeconds,
} from "../src/utils/pvpTrinketUses";

const T0 = 1_000_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const aura = (spellId: string, event: string, s: number) => ({
  spellId,
  spellName: spellId,
  srcUnitId: "P",
  destUnitId: "P",
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
});
const unit = (removedS: number, deathS?: number): any => ({
  id: "P",
  spellCastEvents: [],
  deathRecords: deathS === undefined ? [] : [{ timestamp: at(deathS) }],
  damageIn: [],
  auraEvents: [
    aura("283167", LogEvent.SPELL_AURA_APPLIED, 180.27),
    aura("336139", LogEvent.SPELL_AURA_APPLIED, 180.37),
    aura("283167", LogEvent.SPELL_AURA_REMOVED, 180.37),
    aura("336139", LogEvent.SPELL_AURA_REMOVED, removedS),
  ],
});
const remainingAt = (u: any, s: number) =>
  trinketUseRemainingSeconds(
    pvpTrinketUsesUncached(u).map((x) => ({
      atSeconds: (x.atMs - T0) / 1000,
      readyAtSeconds:
        x.readyAtMs === undefined ? undefined : (x.readyAtMs - T0) / 1000,
    })),
    120,
    s,
    false,
  );

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("Adaptation lockout removed at its holder's death (T278)", () => {
  it("reads to the lockout's DB2 length (60 s), not the wipe", () => {
    const u = unit(204.843, 204.845);
    expect(pvpTrinketUsesUncached(u)[0]!.readyAtMs).toBe(at(240.37));
    // the [CC ON TEAM] note at 3:02 and the [DEATH] line
    expect(remainingAt(u, 182)).toBeCloseTo(58.37, 2);
    expect(remainingAt(u, 204.845)).toBeGreaterThan(35);
  });

  it("the same early removal with no death beside it stays the log's", () => {
    expect(pvpTrinketUsesUncached(unit(204.843))[0]!.readyAtMs).toBe(
      at(204.843),
    );
  });

  it("a lockout that ran its length before the death keeps its REMOVED", () => {
    expect(pvpTrinketUsesUncached(unit(240.371, 240.372))[0]!.readyAtMs).toBe(
      at(240.371),
    );
  });
});
