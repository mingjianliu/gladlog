/**
 * scan5/t40 (pipeline T40): which auras the check follows after a press's
 * first one.
 */
import { describe, expect, it } from "vitest";

import { APPLIED, REFRESH, REMOVED, SUCCESS } from "../scripts/scan5/ctx";
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
    expect(listedChainFrom(plain, caster(), "356723", 0)).toEqual({
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
    expect(listedChainFrom(withProc, caster(), "356723", 0)).toEqual({
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
    expect(listedChainFrom(ally, caster(), "356781", 0)).toEqual({
      endMs: 12030,
      hops: ["186258"],
    });
  });

  it("下一段没接上就停在上一段的结束;第一段没结束就没有链", () => {
    const cut = { id: "E1", auraEvents: venoms.slice(0, 2) };
    expect(listedChainFrom(cut, caster(), "356723", 0)).toEqual({
      endMs: 3900,
      hops: [],
    });
    const open = { id: "E1", auraEvents: venoms.slice(0, 1) };
    expect(listedChainFrom(open, caster(), "356723", 0)).toBeUndefined();
  });
});

describe("scan5/t40 listedChainFrom — one aura instance at a time (codex 85-tk-G-T40-1b #4)", () => {
  const LISTED = ["356727", "356730"];

  it("第一段没记录结束、后面又按了一次:后一次的结束不算到前一次头上", () => {
    const unit = {
      id: "E1",
      auraEvents: [
        aura(0, APPLIED, "356723"),
        // no REMOVED for the first; a whole second series from 60 s
        aura(60000, APPLIED, "356723"),
        aura(63000, REMOVED, "356723"),
        aura(63000, APPLIED, "356727"),
        aura(66000, REMOVED, "356727"),
        aura(66000, APPLIED, "356730"),
        aura(69000, REMOVED, "356730"),
      ],
    };
    expect(listedChainFrom(unit, caster(), "356723", 0)).toBeUndefined();
    // …nor with the re-application's row lost: the next press bounds it
    const lost = {
      id: "E1",
      auraEvents: unit.auraEvents.filter((_, i) => i !== 1),
    };
    // (the stray REMOVED is read as the head's end; no follow-up is taken
    // past the bound, and a chain with no hop reports nothing)
    expect(listedChainFrom(lost, caster(), "356723", 0, 60000)).toEqual({
      endMs: 63000,
      hops: [],
    });
    // the second press reads its own series
    expect(listedChainFrom(unit, caster(), "356723", 60000)).toEqual({
      endMs: 69000,
      hops: LISTED,
    });
  });

  it("同一毫秒里先写旧的一段结束、再写新的一段开始:结束读新的那段自己的", () => {
    const unit = {
      id: "E1",
      auraEvents: [
        aura(0, APPLIED, "356723"),
        aura(3000, REMOVED, "356723"),
        // an earlier press's Spider Venom leaves in this millisecond
        aura(3000, REMOVED, "356727"),
        aura(3000, APPLIED, "356727"),
        aura(6000, REMOVED, "356727"),
        aura(6000, APPLIED, "356730"),
        aura(9000, REMOVED, "356730"),
      ],
    };
    expect(listedChainFrom(unit, caster(), "356723", 0)).toEqual({
      endMs: 9000,
      hops: LISTED,
    });
  });

  describe("the producer's traversal and bound (codex 85-tk-G-T40-1c)", () => {
    const series = (extra: ReturnType<typeof aura>[] = []) => ({
      id: "E1",
      auraEvents: [
        aura(0, APPLIED, "356723"),
        ...extra,
        aura(3000, REMOVED, "356723"),
        aura(3000, APPLIED, "356727"),
        aura(6900, REMOVED, "356727"),
        aura(6900, APPLIED, "356730"),
        aura(9900, REMOVED, "356730"),
      ].sort((a, b) => a.logLine.timestamp - b.logLine.timestamp),
    });

    it("#3 rows after the round's end are not followed", () => {
      // the round ended at 2 s: the producer prints the plain 9 s and reads
      // no follow-up row; the scan must not find a 9.9 s series in them
      expect(listedChainFrom(series(), caster(), "356723", 0, 2001)).toEqual({
        endMs: 3000,
        hops: [],
      });
      expect(listedChainFrom(series(), caster(), "356723", 0)?.hops).toEqual(
        LISTED,
      );
    });

    it("(e) a REFRESH of the head keeps the instance, as the producer reads it", () => {
      const r = listedChainFrom(
        series([aura(2000, REFRESH, "356723")]),
        caster(),
        "356723",
        0,
      );
      expect(r).toEqual({ endMs: 9900, hops: LISTED });
    });

    it("#2 a follow-up applied past the hand-over is not followed, and is counted", () => {
      const lagged = {
        id: "E1",
        auraEvents: [
          aura(0, APPLIED, "356723"),
          aura(3000, REMOVED, "356723"),
          aura(3151, APPLIED, "356727"),
          aura(7051, REMOVED, "356727"),
        ],
      };
      expect(listedChainFrom(lagged, caster(), "356723", 0)).toEqual({
        endMs: 3000,
        hops: [],
        late: { spellId: "356727", gapMs: 151 },
      });
    });
  });
});
