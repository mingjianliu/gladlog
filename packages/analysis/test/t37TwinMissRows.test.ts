/**
 * T37 (GH #205): two effects of one press can each be refused its own way —
 * Holy Word: Chastise's stun 200200 IMMUNE and its damage 88625 MISS, 1 ms
 * apart. Rows of one name in one instant are one press, whatever each row's
 * miss type; the ENEMY CC KIT's `aimed … N×` counts presses.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  CAST_MISS_LEAD_MS,
  isTwinMissRow,
  missPressCount,
} from "../src/utils/castMissRows";
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

  // codex 85-tk-H-T37-1: the log keeps its own order under timestamp jitter,
  // and the count used to depend on it — [B, A, C] read 2×, [A, B, C] 1×
  it("the count does not depend on the order the rows are stored in", () => {
    const a = row(STUN, "IMMUNE", 29_000);
    const b = row(DAMAGE, "MISS", 29_001);
    const c = row(STUN, "IMMUNE", 29_150);
    const enemy = { id: "e1", name: "Priest-R-US", spec: "257" };
    const orders = [
      [a, b, c],
      [b, a, c],
      [c, b, a],
      [c, a, b],
    ];
    for (const rows of orders) {
      expect(missPressCount(rows, T0)).toBe(1);
      const [entry] = aimedControlsForKit(
        { missesIn: rows } as never,
        [enemy] as never,
        T0,
        T0 + 60_000,
      );
      expect(entry?.count).toBe(1);
    }
  });

  it("a later press of the same control is a second press", () => {
    expect(
      missPressCount(
        [
          row(STUN, "IMMUNE", 29_000),
          row(DAMAGE, "MISS", 29_001),
          row(STUN, "IMMUNE", 61_000),
        ],
        T0,
      ),
    ).toBe(2);
  });

  // codex 85-tk-H-T37-1b: each press logs its refusal under two ids 1 ms
  // apart; the second press's rows share a rendered second with the first
  // press's LATER row only
  it("two presses a second apart are never chained through a row that joined the first", () => {
    const rows = [
      row(STUN, "REFLECT", 29_999),
      row(DAMAGE, "REFLECT", 30_000),
      row(STUN, "REFLECT", 30_999),
      row(DAMAGE, "REFLECT", 31_000),
    ];
    expect(missPressCount(rows, T0)).toBe(2);
    expect(missPressCount([...rows].reverse(), T0)).toBe(2);
    expect(missPressCount([rows[1]!, rows[3]!, rows[0]!, rows[2]!], T0)).toBe(
      2,
    );
  });
});
