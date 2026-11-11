/**
 * T37 (GH #205): two effects of one press can each be refused its own way —
 * Holy Word: Chastise's stun 200200 IMMUNE and its damage 88625 MISS, 1 ms
 * apart. Rows of one name in one instant are one press, whatever each row's
 * miss type; the ENEMY CC KIT's `aimed … N×` counts presses.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { CAST_MISS_LEAD_MS, isTwinMissRow } from "../src/utils/castMissRows";
import { aimedControlsForKit } from "../src/utils/healerExposureAnalysis";

const T0 = 1_000_000;
const row = (spellId: string, missType: string, ms: number) => ({
  timestamp: T0 + ms,
  spellId,
  spellName: "Holy Word: Chastise",
  missType,
  srcUnitId: "e1",
});
const STUN = "200200";
const DAMAGE = "88625";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T37 — one press, two rows, two miss types", () => {
  it("the same name within the lead is one press whatever the miss types", () => {
    expect(
      isTwinMissRow(
        row(STUN, "IMMUNE", 29_115),
        row(DAMAGE, "MISS", 29_116),
        T0,
      ),
    ).toBe(true);
  });

  it("past the lead, different miss types stay two rows — even in one rendered second", () => {
    expect(
      isTwinMissRow(
        row(STUN, "IMMUNE", 29_100),
        row(DAMAGE, "MISS", 29_100 + CAST_MISS_LEAD_MS + 1),
        T0,
      ),
    ).toBe(false);
  });

  it("another name in the same instant still needs the same miss type", () => {
    const other = { ...row("408", "MISS", 29_116), spellName: "Kidney Shot" };
    expect(isTwinMissRow(row(STUN, "IMMUNE", 29_115), other, T0)).toBe(false);
    expect(
      isTwinMissRow(
        row(STUN, "IMMUNE", 29_115),
        { ...other, missType: "IMMUNE" },
        T0,
      ),
    ).toBe(true);
  });

  it("the kit counts the press once", () => {
    const enemy = { id: "e1", name: "Priest-R-US", spec: "257" };
    const [entry] = aimedControlsForKit(
      {
        missesIn: [row(STUN, "IMMUNE", 29_115), row(DAMAGE, "MISS", 29_116)],
      } as never,
      [enemy] as never,
      T0,
      T0 + 60_000,
    );
    expect(entry).toMatchObject({
      spellName: "Holy Word: Chastise",
      count: 1,
    });
  });
});
