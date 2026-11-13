/**
 * scan5/t40 (pipeline T40): which auras the check follows after a press's
 * first one.
 */
import { describe, expect, it } from "vitest";

import { APPLIED, REMOVED, SUCCESS } from "../scripts/scan5/ctx";
import { chainFrom, listedChainFrom } from "../scripts/scan5/t40";

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

describe("scan5/t40 listedChainFrom (codex 85-tk-G-T40-1 #4)", () => {
  const venoms = [
    aura(0, APPLIED, "356723"),
    aura(3900, REMOVED, "356723"),
    aura(3900, APPLIED, "356727"),
    aura(7800, REMOVED, "356727"),
    aura(7800, APPLIED, "356730"),
    aura(10800, REMOVED, "356730"),
  ];
  const LISTED = ["356727", "356730"];

  it("表里的这一串按自己的行跟到底;末尾恰好接上一个无关光环也不改变结果", () => {
    const plain = { id: "E1", auraEvents: venoms };
    expect(listedChainFrom(plain, caster(), "356723", 0, LISTED)).toEqual({
      endMs: 10800,
      hops: LISTED,
    });
    const withProc = {
      id: "E1",
      auraEvents: [
        ...venoms,
        aura(10810, APPLIED, "999"),
        aura(15000, REMOVED, "999"),
      ],
    };
    // the generic walk goes on into the proc …
    expect(chainFrom(withProc, caster(), "356723", 0)?.hops).toEqual([
      ...LISTED,
      "999",
    ]);
    // … the listed one ends where the series does
    expect(listedChainFrom(withProc, caster(), "356723", 0, LISTED)).toEqual({
      endMs: 10800,
      hops: LISTED,
    });
  });

  it("由佩戴者自己接上的下一段也算(队友身上的猎豹守护)", () => {
    const ally = {
      id: "E1",
      auraEvents: [
        aura(0, APPLIED, "356781"),
        aura(3000, REMOVED, "356781"),
        aura(3000, APPLIED, "186258", "E1"),
        aura(12030, REMOVED, "186258", "E1"),
      ],
    };
    expect(listedChainFrom(ally, caster(), "356781", 0, ["186258"])).toEqual({
      endMs: 12030,
      hops: ["186258"],
    });
  });

  it("下一段没接上就停在上一段的结束;第一段没结束就没有链", () => {
    const cut = { id: "E1", auraEvents: venoms.slice(0, 2) };
    expect(listedChainFrom(cut, caster(), "356723", 0, LISTED)).toEqual({
      endMs: 3900,
      hops: [],
    });
    const open = { id: "E1", auraEvents: venoms.slice(0, 1) };
    expect(
      listedChainFrom(open, caster(), "356723", 0, LISTED),
    ).toBeUndefined();
  });
});
