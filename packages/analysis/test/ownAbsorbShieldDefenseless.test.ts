/**
 * The target's own absorb shields that end `defenseless` while up
 * (corpusFactScan2 defenselessSaveUp ownAbsorb, 2026-10-22): an aura DB2
 * calls an absorb that the log shows absorbing as the unit's own shield this
 * round — beside ruling (1)'s Power Word: Shield / Void Shield, always.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { ownAbsorbShieldAuraIdsOf } from "../src/utils/enemyDefensives";

beforeAll(async () => {
  await ensureAnalysisData();
});

const absorb = (spellId: string, owner: string) => ({
  spellId,
  srcUnitId: owner,
  absorbedAmount: 10_000,
  timestamp: 1,
  logLine: { timestamp: 1 },
});
const ids = (absorbsIn: unknown[]) =>
  [...ownAbsorbShieldAuraIdsOf({ id: "u", absorbsIn } as never)].sort();

describe("ownAbsorbShieldAuraIdsOf", () => {
  it("ruling (1)'s two always; an own Blazing Barrier / PW:S 1246768 that absorbed", () => {
    expect(ids([])).toEqual(["1253593", "17"]);
    expect(ids([absorb("235313", "u"), absorb("1246768", "u")])).toEqual([
      "1246768",
      "1253593",
      "17",
      "235313",
    ]);
  });
  it("a shield an ally owns, or an aura DB2 calls no absorb, is not the unit's own shield", () => {
    expect(ids([absorb("235313", "ally")])).toEqual(["1253593", "17"]);
    expect(ids([absorb("1459", "u")])).toEqual(["1253593", "17"]);
  });
  it("Reversion counts only with an absorb row (its absorb effect is a talent's)", () => {
    expect(ids([])).not.toContain("366155");
    expect(ids([absorb("366155", "u")])).toContain("366155");
  });
});
