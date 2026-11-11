/**
 * scan5/t40 (pipeline T40): which auras the check follows after a press's
 * first one.
 */
import { describe, expect, it } from "vitest";

import { APPLIED, REMOVED, SUCCESS } from "../scripts/scan5/ctx";
import { chainFrom } from "../scripts/scan5/t40";

const aura = (ms: number, event: string, spellId: string, src = "P1") => ({
  spellId,
  srcUnitId: src,
  destUnitId: "E1",
  logLine: { event, timestamp: ms },
});
const caster = (pressAt: number[] = []) => ({
  id: "P1",
  spellCastEvents: pressAt.map((ms) => ({
    spellId: "1",
    logLine: { event: SUCCESS, timestamp: ms },
  })),
});

describe("scan5/t40 chainFrom", () => {
  it("一段结束时同一施放者接上的另一种光环算下一段,一直跟到最后一段结束", () => {
    const unit = {
      id: "E1",
      auraEvents: [
        aura(410, APPLIED, "356723"),
        aura(3419, REMOVED, "356723"),
        aura(3419, APPLIED, "356727"),
        aura(6425, REMOVED, "356727"),
        aura(6425, APPLIED, "356730"),
        aura(9426, REMOVED, "356730"),
      ],
    };
    expect(chainFrom(unit, caster(), "356723", 410)).toEqual({
      endMs: 9426,
      hops: ["356727", "356730"],
    });
  });

  it("施放者自己按出来的、别人放的、隔得远的都不算下一段;第一段没记录结束就没有链", () => {
    const unit = {
      id: "E1",
      auraEvents: [
        aura(0, APPLIED, "356723"),
        aura(3000, REMOVED, "356723"),
        // pressed by the caster at that moment: its own button
        aura(3010, APPLIED, "999"),
      ],
    };
    expect(chainFrom(unit, caster([3000]), "356723", 0)).toEqual({
      endMs: 3000,
      hops: [],
    });
    const other = {
      id: "E1",
      auraEvents: [
        aura(0, APPLIED, "356723"),
        aura(3000, REMOVED, "356723"),
        aura(3000, APPLIED, "356727", "P2"),
        aura(3400, APPLIED, "356730"),
      ],
    };
    expect(chainFrom(other, caster(), "356723", 0)).toEqual({
      endMs: 3000,
      hops: [],
    });
    expect(
      chainFrom(
        { id: "E1", auraEvents: [aura(0, APPLIED, "356723")] },
        caster(),
        "356723",
        0,
      ),
    ).toBeUndefined();
  });
});
