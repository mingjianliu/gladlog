/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * FT-T08 step 3: `auraEndFromLog` — the end of one aura application as the
 * holder's own records state it.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { auraEndFromLog, DEATH_CASCADE_MS } from "../src/utils/auraEndCause";
import { ALLY_DISPEL_MATCH_TOLERANCE_S } from "../src/utils/dispelAnalysis";

const T0 = 1_000_000;
const aura = (
  event: LogEvent,
  spellId: string,
  ms: number,
  src: string,
  amount?: number,
) =>
  ({
    logLine: { event, timestamp: ms, parameters: [] },
    timestamp: ms,
    spellId,
    spellName: spellId,
    srcUnitId: src,
    srcUnitName: src,
    destUnitId: "holder",
    amount,
  }) as never;
const taken = (event: LogEvent, ms: number, extraSpellId: string) =>
  ({
    logLine: { event, timestamp: ms, parameters: [] },
    timestamp: ms,
    spellId: "378773",
    spellName: "Greater Purge",
    srcUnitId: "enemy-1",
    srcUnitName: "Shammy",
    destUnitId: "holder",
    extraSpellId,
  }) as never;

describe("auraEndFromLog", () => {
  it("a dispel / steal of THIS aura inside the dispel pairing tolerance names its source", () => {
    const tol = ALLY_DISPEL_MATCH_TOLERANCE_S * 1000;
    const holder = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 3_200, "mage"),
      ],
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_200 + tol, "11426")],
    } as never;
    expect(auraEndFromLog(holder, "11426", { fromMs: T0, removedMs: T0 + 3_200 })).toEqual({
      takenBy: {
        kind: "dispelled",
        unitId: "enemy-1",
        unitName: "Shammy",
        spellName: "Greater Purge",
      },
      holderDied: false,
    });
    const late = {
      auraEvents: [aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 3_200, "mage")],
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_200 + tol + 1, "11426")],
    } as never;
    expect(auraEndFromLog(late, "11426", { fromMs: T0, removedMs: T0 + 3_200 }).takenBy).toBeUndefined();
    const other = {
      auraEvents: [aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 3_200, "mage")],
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_200, "17")],
    } as never;
    expect(auraEndFromLog(other, "11426", { fromMs: T0, removedMs: T0 + 3_200 }).takenBy).toBeUndefined();
    const stolen = {
      auraEvents: [aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 3_200, "mage")],
      actionIn: [taken(LogEvent.SPELL_STOLEN, T0 + 3_200, "11426")],
    } as never;
    expect(auraEndFromLog(stolen, "11426", { fromMs: T0, removedMs: T0 + 3_200 }).takenBy?.kind).toBe(
      "stolen",
    );
  });

  it("the holder's death within the cascade window after the removal; not before it, not later", () => {
    const at = T0 + 5_000;
    const died = (ms: number) =>
      ({ auraEvents: [], deathRecords: [{ timestamp: ms }] }) as never;
    expect(
      auraEndFromLog(died(at + DEATH_CASCADE_MS), "1", { fromMs: T0, removedMs: at }).holderDied,
    ).toBe(true);
    expect(
      auraEndFromLog(died(at + DEATH_CASCADE_MS + 1), "1", { fromMs: T0, removedMs: at }).holderDied,
    ).toBe(false);
    expect(auraEndFromLog(died(at - 1), "1", { fromMs: T0, removedMs: at }).holderDied).toBe(false);
  });

  const absorbed = (ms: number, shield: string, owner: string, amount: number) =>
    ({
      logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: ms, parameters: [] },
      timestamp: ms,
      spellId: shield,
      srcUnitId: owner,
      destUnitId: "holder",
      absorbedAmount: amount,
    }) as never;

  it("what an application absorbed is the SPELL_ABSORBED lines naming it, this caster's, inside its span; `left` is its REMOVED amount", () => {
    const holder = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0, "priest-A", 300_000),
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0 + 100, "priest-B", 250_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 4_000, "priest-A", 0),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 9_000, "priest-B", 250_000),
        // priest-A again, later
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0 + 20_000, "priest-A", 300_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 35_000, "priest-A", 290_000),
      ],
      absorbsIn: [
        absorbed(T0 + 1_000, "17", "priest-A", 120_000),
        absorbed(T0 + 4_000, "17", "priest-A", 180_000),
        // another shield on the same holder, and A's next application
        absorbed(T0 + 2_000, "11426", "mage", 50_000),
        absorbed(T0 + 21_000, "17", "priest-A", 10_000),
      ],
    } as never;
    expect(auraEndFromLog(holder, "17", { fromMs: T0, removedMs: T0 + 4_000 }, "priest-A").absorb).toEqual({ absorbed: 300_000, left: 0 });
    // B's shield took nothing: nothing is claimed, whatever its lines carry
    expect(auraEndFromLog(holder, "17", { fromMs: T0, removedMs: T0 + 9_000 }, "priest-B").absorb).toBeUndefined();
    // the second application counts its own absorb lines only
    expect(auraEndFromLog(holder, "17", { fromMs: T0 + 20_000, removedMs: T0 + 35_000 }, "priest-A").absorb).toEqual({ absorbed: 10_000, left: 290_000 });
  });

  it("an amount on the aura's lines does not make it an absorb (heal-absorb debuff, HoT, Defensive Stance)", () => {
    const debuff = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "356528", T0, "dk", 90_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "356528", T0 + 4_000, "dk", 0),
      ],
      absorbsIn: [],
    } as never;
    expect(auraEndFromLog(debuff, "356528", { fromMs: T0, removedMs: T0 + 4_000 }, "dk").absorb).toBeUndefined();
  });

  it("codex 3a P2-2: a refreshed or re-broadcast shield — the absorbed total is still the absorb lines' sum", () => {
    // APPLIED 100k → REFRESH 200k → REMOVED 0; the lines say 40k + 200k were absorbed
    const refreshed = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0, "priest", 100_000),
        aura(LogEvent.SPELL_AURA_REFRESH, "17", T0 + 2_000, "priest", 200_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 5_000, "priest", 0),
      ],
      absorbsIn: [absorbed(T0 + 1_000, "17", "priest", 40_000), absorbed(T0 + 4_000, "17", "priest", 200_000)],
    } as never;
    expect(auraEndFromLog(refreshed, "17", { fromMs: T0, removedMs: T0 + 5_000 }, "priest").absorb).toEqual({ absorbed: 240_000, left: 0 });
    // APPLIED 100k → REMOVED/APPLIED 60k re-broadcast at one ms → REMOVED 0: one application, 100k
    const rebroadcast = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0, "priest", 100_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 2_000, "priest", 60_000),
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0 + 2_000, "priest", 60_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 5_000, "priest", 0),
      ],
      absorbsIn: [absorbed(T0 + 1_000, "17", "priest", 40_000), absorbed(T0 + 4_000, "17", "priest", 60_000)],
    } as never;
    expect(auraEndFromLog(rebroadcast, "17", { fromMs: T0, removedMs: T0 + 5_000 }, "priest").absorb).toEqual({ absorbed: 100_000, left: 0 });
  });

  it("codex 3a P2-4: APPLIED amount missing — what it absorbed is stated, 'nothing left' is not (Touch of Karma, Guardian Spirit carry no amount)", () => {
    const holder = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "122470", T0, "monk"),
        aura(LogEvent.SPELL_AURA_REMOVED, "122470", T0 + 3_000, "monk", 0),
      ],
      absorbsIn: [absorbed(T0 + 2_900, "122470", "monk", 77_000)],
    } as never;
    expect(auraEndFromLog(holder, "122470", { fromMs: T0, removedMs: T0 + 3_000 }, "monk").absorb).toEqual({ absorbed: 77_000 });
  });

  it("an amount that is not the remaining absorb is not read as `left`; an amount-0 aura claims nothing", () => {
    // Tranquility: absorb lines name it (its damage reduction), amount stays put
    const tranq = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "740", T0, "druid", 696_347),
        aura(LogEvent.SPELL_AURA_REMOVED, "740", T0 + 4_400, "druid", 696_347),
      ],
      absorbsIn: [absorbed(T0 + 1_000, "740", "druid", 286)],
    } as never;
    expect(auraEndFromLog(tranq, "740", { fromMs: T0, removedMs: T0 + 4_400 }, "druid").absorb).toEqual({ absorbed: 286 });
    // Time Dilation: 0 on both lines — it defers, it does not hold damage back
    const dilation = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "357170", T0, "evoker", 0),
        aura(LogEvent.SPELL_AURA_REMOVED, "357170", T0 + 8_000, "evoker", 0),
      ],
      absorbsIn: [absorbed(T0 + 1_000, "357170", "evoker", 403_000)],
    } as never;
    expect(auraEndFromLog(dilation, "357170", { fromMs: T0, removedMs: T0 + 8_000 }, "evoker").absorb).toBeUndefined();
    // a shield that grew past its APPLIED amount (Soul Leech): absorbed is stated, `left` is not
    const grew = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "108366", T0, "lock", 10_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "108366", T0 + 9_000, "lock", 25_000),
      ],
      absorbsIn: [absorbed(T0 + 1_000, "108366", "lock", 5_000)],
    } as never;
    expect(auraEndFromLog(grew, "108366", { fromMs: T0, removedMs: T0 + 9_000 }, "lock").absorb).toEqual({ absorbed: 5_000 });
  });

  it("codex 3a P2-1: a dispel line that took ANOTHER source's copy is not this application's", () => {
    // B's shield dispelled at 3,160; A's ran out at 3,200 — one dispel line, two removals around it
    const two = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0, "priest-A", 100_000),
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0, "priest-B", 100_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_160, "priest-B", 100_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_200, "priest-A", 0),
      ],
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_160, "17")],
      absorbsIn: [absorbed(T0 + 3_200, "17", "priest-A", 100_000)],
    } as never;
    expect(auraEndFromLog(two, "17", { fromMs: T0, removedMs: T0 + 3_200 }, "priest-A")).toEqual({
      holderDied: false,
      absorb: { absorbed: 100_000, left: 0 },
    });
    expect(auraEndFromLog(two, "17", { fromMs: T0, removedMs: T0 + 3_160 }, "priest-B").takenBy?.kind).toBe("dispelled");
    // both removed in the same ms by one dispel line: the log does not say which — nothing is claimed
    const tieAuras = [
      aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_200, "priest-A"),
      aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_200, "priest-B"),
    ];
    const tie = {
      auraEvents: tieAuras,
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_200, "17")],
    } as never;
    expect(auraEndFromLog(tie, "17", { fromMs: T0, removedMs: T0 + 3_200 }, "priest-A").takenBy).toBeUndefined();
    // …and a dispel line for each (Mass Dispel): both were dispelled
    const both = {
      auraEvents: tieAuras,
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_200, "17"), taken(LogEvent.SPELL_DISPEL, T0 + 3_200, "17")],
    } as never;
    expect(auraEndFromLog(both, "17", { fromMs: T0, removedMs: T0 + 3_200 }, "priest-A").takenBy?.kind).toBe("dispelled");
    expect(auraEndFromLog(both, "17", { fromMs: T0, removedMs: T0 + 3_200 }, "priest-B").takenBy?.kind).toBe("dispelled");
  });
  it("codex 3a r2 P2-1: a dispel line pairs with ONE removal — a neighbour's line is not counted for this one", () => {
    // copies C / B / A removed at 3,080 / 3,160 / 3,200; dispel lines for C and B at 3,120 / 3,160
    const holder = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_080, "C"),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_160, "B"),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_200, "A"),
      ],
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_120, "17"), taken(LogEvent.SPELL_DISPEL, T0 + 3_160, "17")],
    } as never;
    const at = (ms: number, src: string) => auraEndFromLog(holder, "17", { fromMs: T0, removedMs: T0 + ms }, src);
    expect(at(3_200, "A")).toEqual({ holderDied: false });
    expect(at(3_160, "B").takenBy?.kind).toBe("dispelled");
    expect(at(3_080, "C").takenBy?.kind).toBe("dispelled");
  });

  it("codex 3a r2 P2-2: two copies off in one ms, taken by two different units — taken, but not by whom", () => {
    const steal = { ...(taken(LogEvent.SPELL_STOLEN, T0 + 3_200, "17") as object), srcUnitId: "enemy-2", srcUnitName: "Magey", spellId: "30449", spellName: "Spellsteal" } as never;
    const holder = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_200, "priest-A"),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 3_200, "priest-B"),
      ],
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_200, "17"), steal],
    } as never;
    for (const src of ["priest-A", "priest-B"])
      expect(auraEndFromLog(holder, "17", { fromMs: T0, removedMs: T0 + 3_200 }, src)).toEqual({
        takeUnclear: true,
        holderDied: false,
      });
    // one dispel line for two copies: one was dispelled, the log does not say which
    const oneLine = { auraEvents: (holder as any).auraEvents, actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 3_200, "17")] } as never;
    expect(auraEndFromLog(oneLine, "17", { fromMs: T0, removedMs: T0 + 3_200 }, "priest-A")).toEqual({
      takeUnclear: true,
      holderDied: false,
    });
  });

  it("codex 3a r2 P2-3 / P2-4: the span is the caller's — a missing APPLIED does not pull in the previous shield's last hit, a duplicate APPLIED does not reset the shield", () => {
    // previous Ice Barrier: last 100k absorbed and removed at 1,000; the next one's APPLIED is missing
    const missingApplied = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "11426", T0, "mage", 100_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 1_000, "mage", 0),
        aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 35_000, "mage", 70_000),
      ],
      absorbsIn: [absorbed(T0 + 1_000, "11426", "mage", 100_000), absorbed(T0 + 34_000, "11426", "mage", 30_000)],
    } as never;
    expect(
      auraEndFromLog(missingApplied, "11426", { fromMs: T0 + 30_000, removedMs: T0 + 35_000 }, "mage").absorb,
    ).toEqual({ absorbed: 30_000 });
    // APPLIED 100k at 0, 60k + 40k absorbed, a duplicate APPLIED (amount 0) and the REMOVED at 4,000
    const duplicate = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "11426", T0, "mage", 100_000),
        aura(LogEvent.SPELL_AURA_APPLIED, "11426", T0 + 4_000, "mage", 0),
        aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 4_000, "mage", 0),
      ],
      absorbsIn: [absorbed(T0 + 1_000, "11426", "mage", 60_000), absorbed(T0 + 4_000, "11426", "mage", 40_000)],
    } as never;
    expect(auraEndFromLog(duplicate, "11426", { fromMs: T0, removedMs: T0 + 4_000 }, "mage").absorb).toEqual({
      absorbed: 100_000,
      left: 0,
    });
  });
  it("real logs (605-file sample): a re-press while up is a REFRESH with a new amount; the cast line trails its aura", () => {
    // sample 178, Ice Barrier: up since before the gates, pressed at 0:08 / 0:43 / 0:49 — three
    // SPELL_AURA_REFRESH lines, no APPLIED, REMOVED with 0 at 1:07. One aura, three shield amounts.
    const iceBarrier = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_REFRESH, "11426", T0 + 8_853, "mage", 133_942),
        aura(LogEvent.SPELL_AURA_REFRESH, "11426", T0 + 43_418, "mage", 125_997),
        aura(LogEvent.SPELL_AURA_REFRESH, "11426", T0 + 49_703, "mage", 124_822),
        aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 67_251, "mage", 0),
      ],
      absorbsIn: [
        absorbed(T0 + 5_000, "11426", "mage", 9_999), // before this press: not counted
        absorbed(T0 + 33_785, "11426", "mage", 68_996),
        absorbed(T0 + 45_000, "11426", "mage", 98_198),
        absorbed(T0 + 67_251, "11426", "mage", 124_822),
      ],
    } as never;
    expect(
      auraEndFromLog(iceBarrier, "11426", { fromMs: T0 + 8_854, removedMs: T0 + 67_251 }, "mage").absorb,
    ).toEqual({ absorbed: 68_996 + 98_198 + 124_822, left: 0 });
    // sample 169, Dark Pact: APPLIED 58 ms before its SPELL_CAST_SUCCESS
    const darkPact = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "108416", T0 + 33_144, "lock", 681_356),
        aura(LogEvent.SPELL_AURA_REMOVED, "108416", T0 + 43_315, "lock", 0),
      ],
      absorbsIn: [absorbed(T0 + 43_315, "108416", "lock", 681_356)],
    } as never;
    expect(
      auraEndFromLog(darkPact, "108416", { fromMs: T0 + 33_202, removedMs: T0 + 43_315 }, "lock").absorb,
    ).toEqual({ absorbed: 681_356, left: 0 });
  });
  it("agy 3a r3 P2-A: a knot is weighed assignment by assignment — three lines do not make three dispels", () => {
    // copies R1 / R2 off at 1,000 and R3 at 1,030; one dispel line at 1,000 and two at 1,060 (same shaman)
    const holder = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 1_000, "A"),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 1_000, "B"),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 1_030, "C"),
      ],
      actionIn: [
        taken(LogEvent.SPELL_DISPEL, T0 + 1_000, "17"),
        taken(LogEvent.SPELL_DISPEL, T0 + 1_060, "17"),
        taken(LogEvent.SPELL_DISPEL, T0 + 1_060, "17"),
      ],
    } as never;
    const at = (ms: number, src: string) => auraEndFromLog(holder, "17", { fromMs: T0, removedMs: T0 + ms }, src);
    // one line for the two copies that came off at 1,000: one was dispelled, not which
    expect(at(1_000, "A")).toEqual({ takeUnclear: true, holderDied: false });
    expect(at(1_000, "B")).toEqual({ takeUnclear: true, holderDied: false });
    // the copy at 1,030 has a line whichever way the others fall
    expect(at(1_030, "C").takenBy?.kind).toBe("dispelled");
  });

  it("every dispel line took something: the forced assignment wins over the nearest one", () => {
    // lines at 1,000 and 1,020; removals at 1,015 and 1,060 — the 1,000 line reaches only the first
    const holder = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 1_015, "A"),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 1_060, "B"),
      ],
      actionIn: [taken(LogEvent.SPELL_DISPEL, T0 + 1_000, "17"), taken(LogEvent.SPELL_DISPEL, T0 + 1_020, "17")],
    } as never;
    for (const [ms, src] of [[1_015, "A"], [1_060, "B"]] as const)
      expect(auraEndFromLog(holder, "17", { fromMs: T0, removedMs: T0 + ms }, src).takenBy?.kind).toBe("dispelled");
  });

  it("agy 3a r3 P2-B / P2-C: no absorb for an any-source call; the shield that broke 20 ms before the re-press is not this one's", () => {
    const twoCasters = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0 + 1_000, "A", 100_000),
        aura(LogEvent.SPELL_AURA_APPLIED, "17", T0 + 1_100, "B", 250_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 2_000, "B", 0),
        aura(LogEvent.SPELL_AURA_REMOVED, "17", T0 + 2_000, "A", 80_000),
      ],
      absorbsIn: [absorbed(T0 + 1_500, "17", "A", 20_000), absorbed(T0 + 1_900, "17", "B", 250_000)],
    } as never;
    const span = { fromMs: T0 + 1_000, removedMs: T0 + 2_000 };
    expect(auraEndFromLog(twoCasters, "17", span).absorb).toBeUndefined();
    expect(auraEndFromLog(twoCasters, "17", span, "A").absorb).toEqual({ absorbed: 20_000, left: 80_000 });
    expect(auraEndFromLog(twoCasters, "17", { fromMs: T0 + 1_100, removedMs: T0 + 2_000 }, "B").absorb).toEqual({
      absorbed: 250_000,
      left: 0,
    });
    // old shield: last 60k and REMOVED at 24,980; re-press and APPLIED (100k) at 25,000; 10k absorbed; expires with 90k
    const rePress = {
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "11426", T0, "mage", 60_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 24_980, "mage", 0),
        aura(LogEvent.SPELL_AURA_APPLIED, "11426", T0 + 25_000, "mage", 100_000),
        aura(LogEvent.SPELL_AURA_REMOVED, "11426", T0 + 50_000, "mage", 90_000),
      ],
      absorbsIn: [absorbed(T0 + 24_980, "11426", "mage", 60_000), absorbed(T0 + 28_000, "11426", "mage", 10_000)],
    } as never;
    expect(
      auraEndFromLog(rePress, "11426", { fromMs: T0 + 25_000, removedMs: T0 + 50_000 }, "mage").absorb,
    ).toEqual({ absorbed: 10_000, left: 90_000 });
  });
});
