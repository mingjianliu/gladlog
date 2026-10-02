/**
 * castCommitSpans — empowered holds and channels, the two commitments with
 * no SPELL_CAST_START bar (triage missed-cleanse F-C10 / other F-O6).
 * Repro numbers are 539fef93's 47.052–63.050 Deathmark window: the owner's
 * Dream Breath 49.839 → 50.386, Fire Breath 54.310 → 54.858, Disintegrate
 * 61.971 with its self-aura to 63.797, and two Chrono Flames bars.
 */
import {
  CombatUnitClass,
  CombatUnitSpec,
  type ICombatUnit,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { CHANNELED_SPELL_IDS } from "../src/data/channeledGenerated";
import { ensureAnalysisData } from "../src/data/ensure";
import { channelSpans, empowerSpans } from "../src/utils/castCommitSpans";
import { occupancyWithin } from "../src/utils/dispelAnalysis";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const T0 = 1_700_000_000_000;
const DREAM_BREATH = "355936";
const FIRE_BREATH = "357208";
const DISINTEGRATE = "356995";
const CHRONO_FLAMES = "431443";

const ETERNITY_SURGE = "359073";
const HAMMER_OF_JUSTICE = "853";

beforeAll(async () => {
  await ensureAnalysisData();
});

const emp = (spellId: string, ms: number, level?: number) => ({
  spellId,
  spellName: spellId,
  timestamp: T0 + ms,
  ...(level === undefined ? {} : { level }),
});

function evoker(
  o: {
    starts?: ReturnType<typeof emp>[];
    ends?: ReturnType<typeof emp>[];
    interrupts?: ReturnType<typeof emp>[];
    casts?: { spellId: string; ms: number }[];
    bars?: { spellId: string; ms: number }[];
    auras?: ReturnType<typeof makeAuraEvent>[];
  } = {},
): ICombatUnit {
  const u = makeUnit("player-1", {
    class: CombatUnitClass.Evoker,
    spec: CombatUnitSpec.Evoker_Preservation,
    spellCastEvents: (o.casts ?? []).map((c) =>
      makeSpellCastEvent(c.spellId, T0 + c.ms, "player-1"),
    ),
    auraEvents: o.auras ?? [],
  }) as ICombatUnit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any = u as any;
  any.castStartEvents = (o.bars ?? []).map((b) => ({
    spellId: b.spellId,
    spellName: b.spellId,
    timestamp: T0 + b.ms,
  }));
  if (o.starts) any.empowerStarts = o.starts;
  any.empowerEnds = o.ends ?? [];
  if (o.interrupts) any.empowerInterrupts = o.interrupts;
  return u;
}

describe("empowerSpans", () => {
  it("pairs each START with its own END / INTERRUPT, in order", () => {
    const spans = empowerSpans(
      evoker({
        starts: [
          emp(DREAM_BREATH, 1_000),
          emp(DREAM_BREATH, 3_000),
          emp(FIRE_BREATH, 3_600),
        ],
        interrupts: [emp(DREAM_BREATH, 1_400, 0)],
        ends: [emp(DREAM_BREATH, 5_800, 3), emp(FIRE_BREATH, 4_100, 1)],
      }),
    )!;
    expect(
      spans.map((s) => [s.spellId, s.startMs - T0, s.endMs - T0, s.level]),
    ).toEqual([
      [DREAM_BREATH, 1_000, 1_400, 0],
      [DREAM_BREATH, 3_000, 5_800, 3],
      [FIRE_BREATH, 3_600, 4_100, 1],
    ]);
    expect(spans.map((s) => s.interrupted)).toEqual([true, false, false]);
  });

  it("a hold cut and re-pressed on the same millisecond: the INTERRUPT closes the first hold only, the re-press keeps its END", () => {
    const at = (spellId: string, ms: number, lineIndex: number, level?: number) => ({
      ...emp(spellId, ms, level),
      logLine: { lineIndex },
    });
    const spans = empowerSpans(
      evoker({
        starts: [at(DREAM_BREATH, 30_000, 10), at(DREAM_BREATH, 32_000, 21)],
        // written BEFORE the second START (line 20 < 21), same millisecond
        interrupts: [at(DREAM_BREATH, 32_000, 20, 0)],
        ends: [at(DREAM_BREATH, 33_000, 30, 1)],
      }),
    )!;
    expect(
      spans.map((s) => [s.startMs - T0, s.endMs - T0, s.interrupted]),
    ).toEqual([
      [30_000, 32_000, true],
      [32_000, 33_000, false],
    ]);
  });

  it("without line indexes one closing event still closes one hold only", () => {
    const spans = empowerSpans(
      evoker({
        starts: [emp(DREAM_BREATH, 30_000), emp(DREAM_BREATH, 32_000)],
        interrupts: [emp(DREAM_BREATH, 32_000, 0)],
        ends: [emp(DREAM_BREATH, 33_000, 1)],
      }),
    )!;
    expect(
      spans.map((s) => [s.startMs - T0, s.endMs - T0, s.interrupted]),
    ).toEqual([
      [30_000, 32_000, true],
      [32_000, 33_000, false],
    ]);
  });

  it("a START with no closing event before the next START of that spell is dropped, not stretched", () => {
    const spans = empowerSpans(
      evoker({
        starts: [emp(DREAM_BREATH, 1_000), emp(DREAM_BREATH, 40_000)],
        ends: [emp(DREAM_BREATH, 40_500, 1)],
      }),
    )!;
    expect(spans.map((s) => s.startMs - T0)).toEqual([40_000]);
  });

  it("no empowerStarts on the document → null (unknown), not []", () => {
    expect(empowerSpans(evoker({ ends: [emp(DREAM_BREATH, 500, 1)] }))).toBe(
      null,
    );
  });
});

describe("channelSpans", () => {
  const selfAura = (ev: LogEvent, spellId: string, ms: number) =>
    makeAuraEvent(ev, spellId, T0 + ms, "player-1", "player-1", "BUFF");

  it("Disintegrate is an officially channelled spell (the fixture's premise)", () => {
    expect(CHANNELED_SPELL_IDS.has(DISINTEGRATE)).toBe(true);
    expect(CHANNELED_SPELL_IDS.has(CHRONO_FLAMES)).toBe(false);
  });

  it("a channel runs from its success to the removal of the caster's own same-id aura", () => {
    const spans = channelSpans(
      evoker({
        casts: [{ spellId: DISINTEGRATE, ms: 61_971 }],
        auras: [
          selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 61_971),
          selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 63_797),
        ],
      }),
    );
    expect(spans.map((s) => [s.startMs - T0, s.endMs - T0])).toEqual([
      [61_971, 63_797],
    ]);
  });

  it("a same-id self-aura that no success started within 0.1 s is not a channel", () => {
    const spans = channelSpans(
      evoker({
        casts: [{ spellId: DISINTEGRATE, ms: 61_000 }],
        auras: [
          selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 61_971),
          selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 63_797),
        ],
      }),
    );
    expect(spans).toEqual([]);
  });

  it("the aura line may be written 1 ms before the success; the span starts at the aura", () => {
    const spans = channelSpans(
      evoker({
        casts: [{ spellId: DISINTEGRATE, ms: 61_971 }],
        auras: [
          selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 61_970),
          selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 63_797),
        ],
      }),
    );
    expect(spans.map((s) => [s.startMs - T0, s.endMs - T0])).toEqual([
      [61_970, 63_797],
    ]);
  });

  it("a re-broadcast REMOVED / APPLIED pair mid-channel (visage swap) does not end the span", () => {
    const spans = channelSpans(
      evoker({
        casts: [{ spellId: DISINTEGRATE, ms: 61_971 }],
        auras: [
          selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 61_971),
          selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 62_500),
          selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 62_500),
          selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 63_797),
        ],
      }),
    );
    expect(spans.map((s) => [s.startMs - T0, s.endMs - T0])).toEqual([
      [61_971, 63_797],
    ]);
  });

  it("an instant self-buff outside the channelled list is ignored", () => {
    const spans = channelSpans(
      evoker({
        casts: [{ spellId: CHRONO_FLAMES, ms: 10_000 }],
        auras: [
          selfAura(LogEvent.SPELL_AURA_APPLIED, CHRONO_FLAMES, 10_000),
          selfAura(LogEvent.SPELL_AURA_REMOVED, CHRONO_FLAMES, 18_000),
        ],
      }),
    );
    expect(spans).toEqual([]);
  });
});

describe("occupancyWithin counts empowered holds and channels", () => {
  const selfAura = (ev: LogEvent, spellId: string, ms: number) =>
    makeAuraEvent(ev, spellId, T0 + ms, "player-1", "player-1", "BUFF");
  const owner = () =>
    evoker({
      bars: [
        { spellId: CHRONO_FLAMES, ms: 53_404 },
        { spellId: CHRONO_FLAMES, ms: 59_556 },
      ],
      casts: [
        { spellId: DREAM_BREATH, ms: 49_840 },
        { spellId: CHRONO_FLAMES, ms: 54_140 },
        { spellId: FIRE_BREATH, ms: 54_311 },
        { spellId: CHRONO_FLAMES, ms: 60_297 },
        { spellId: DISINTEGRATE, ms: 61_971 },
      ],
      starts: [emp(DREAM_BREATH, 49_839), emp(FIRE_BREATH, 54_310)],
      ends: [emp(DREAM_BREATH, 50_386, 1), emp(FIRE_BREATH, 54_858, 1)],
      auras: [
        selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 61_971),
        selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 63_797),
      ],
    });

  it("539fef93's window: 1.477 s of bars + 0.547 + 0.548 of breaths + 1.079 of Disintegrate (clipped) = 3.651 s", () => {
    const occ = occupancyWithin(
      owner(),
      new Set(),
      T0 + 47_052,
      T0 + 63_050,
    )!;
    expect(occ.occupiedMs).toBe(736 + 741 + 547 + 548 + 1_079);
    // English names (F-C17), whatever the log's locale wrote.
    expect(occ.spellNames).toEqual([
      "Dream Breath",
      "Chrono Flames",
      "Fire Breath",
      "Chrono Flames",
      "Disintegrate",
    ]);
    expect(occ.kinds.sort()).toEqual(["channel", "empower", "hardcast"]);
    expect(occ.startedBeforeWindow).toBe(false);
  });

  it("a hold already running when the window opens is a pre-commitment", () => {
    const occ = occupancyWithin(
      owner(),
      new Set(),
      T0 + 50_000,
      T0 + 51_000,
    )!;
    expect(occ.occupiedMs).toBe(386);
    expect(occ.startedBeforeWindow).toBe(true);
  });

  it("an interrupted hold counts up to the interrupt", () => {
    const u = evoker({
      starts: [emp(DREAM_BREATH, 34_102)],
      interrupts: [emp(DREAM_BREATH, 34_519, 1)],
      casts: [{ spellId: DREAM_BREATH, ms: 34_103 }],
    });
    expect(
      occupancyWithin(u, new Set(), T0 + 30_000, T0 + 40_000)!
        .occupiedMs,
    ).toBe(417);
  });

  it("a unit with no bars at all is still read for holds and channels", () => {
    const u = evoker({
      starts: [emp(FIRE_BREATH, 1_000)],
      ends: [emp(FIRE_BREATH, 1_500, 1)],
    });
    expect(
      occupancyWithin(u, new Set(), T0, T0 + 10_000)!.occupiedMs,
    ).toBe(500);
  });

  it("an enemy CC ends the commitment: a hold is cut where the cannot-cast interval starts", () => {
    // Fire Breath held 1.000 → 3.000; Hammer of Justice lands at 1.800.
    const u = evoker({
      starts: [emp(FIRE_BREATH, 1_000)],
      ends: [emp(FIRE_BREATH, 3_000, 3)],
      auras: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          HAMMER_OF_JUSTICE,
          T0 + 1_800,
          "enemy-1",
          "player-1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          HAMMER_OF_JUSTICE,
          T0 + 4_800,
          "enemy-1",
          "player-1",
        ),
      ],
    });
    expect(
      occupancyWithin(u, new Set(), T0, T0 + 10_000)!.occupiedMs,
    ).toBe(2_000);
    expect(
      occupancyWithin(u, new Set(["enemy-1"]), T0, T0 + 10_000)!
        .occupiedMs,
    ).toBe(800);
  });

  it("overlapping commitments are unioned, never summed", () => {
    // A bar 1.000 → 3.000 and a channel 2.000 → 4.000: 3 s, not 4.
    const u = evoker({
      bars: [{ spellId: CHRONO_FLAMES, ms: 1_000 }],
      casts: [
        { spellId: DISINTEGRATE, ms: 2_000 },
        { spellId: CHRONO_FLAMES, ms: 3_000 },
      ],
      auras: [
        selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 2_000),
        selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 4_000),
      ],
    });
    const occ = occupancyWithin(u, new Set(), T0, T0 + 10_000)!;
    expect(occ.occupiedMs).toBe(3_000);
    expect(occ.spellNames).toEqual(["Chrono Flames", "Disintegrate"]);
  });

  it("an empower that is also in the channelled table is one entry, not a hold plus a channel", () => {
    expect(CHANNELED_SPELL_IDS.has(ETERNITY_SURGE)).toBe(true);
    const u = evoker({
      starts: [emp(ETERNITY_SURGE, 1_000)],
      ends: [emp(ETERNITY_SURGE, 2_500, 2)],
      casts: [{ spellId: ETERNITY_SURGE, ms: 1_001 }],
      auras: [
        selfAura(LogEvent.SPELL_AURA_APPLIED, ETERNITY_SURGE, 1_000),
        selfAura(LogEvent.SPELL_AURA_REMOVED, ETERNITY_SURGE, 2_500),
      ],
    });
    const occ = occupancyWithin(u, new Set(), T0, T0 + 10_000)!;
    expect(occ.occupiedMs).toBe(1_500);
    expect(occ.spellNames).toEqual(["Eternity Surge"]);
    expect(occ.kinds).toEqual(["empower"]);
  });

  it("a channel that follows its own cast bar extends the bar instead of listing the spell twice", () => {
    // Bar 1.000 → success 2.500, then the channel's aura to 6.000.
    const u = evoker({
      bars: [{ spellId: DISINTEGRATE, ms: 1_000 }],
      casts: [{ spellId: DISINTEGRATE, ms: 2_500 }],
      auras: [
        selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 2_500),
        selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 6_000),
      ],
    });
    const occ = occupancyWithin(u, new Set(), T0, T0 + 10_000)!;
    expect(occ.occupiedMs).toBe(5_000);
    expect(occ.spellNames).toEqual(["Disintegrate"]);
    expect(occ.kinds).toEqual(["hardcast"]);
  });

  it("a bar takes one channel: a second same-spell channel right after it is its own press", () => {
    // Bar 1.000 → success 2.500, channel to 5.500, then a second channel
    // 5.550 → 8.500 (within CHANNEL_AURA_LAG_MS of the first one's end).
    const u = evoker({
      bars: [{ spellId: DISINTEGRATE, ms: 1_000 }],
      casts: [
        { spellId: DISINTEGRATE, ms: 2_500 },
        { spellId: DISINTEGRATE, ms: 5_550 },
      ],
      auras: [
        selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 2_500),
        selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 5_500),
        selfAura(LogEvent.SPELL_AURA_APPLIED, DISINTEGRATE, 5_550),
        selfAura(LogEvent.SPELL_AURA_REMOVED, DISINTEGRATE, 8_500),
      ],
    });
    const occ = occupancyWithin(u, new Set(), T0, T0 + 10_000)!;
    expect(occ.occupiedMs).toBe(7_450);
    expect(occ.spellNames).toEqual(["Disintegrate", "Disintegrate"]);
    expect(occ.kinds).toEqual(["hardcast", "channel"]);
  });

  it("without empowerStarts no hold is counted — bars and channels still are", () => {
    const u = evoker({
      bars: [{ spellId: CHRONO_FLAMES, ms: 53_404 }],
      casts: [{ spellId: CHRONO_FLAMES, ms: 54_140 }],
      ends: [emp(DREAM_BREATH, 50_386, 1)],
    });
    expect(
      occupancyWithin(u, new Set(), T0 + 47_052, T0 + 63_050)!
        .occupiedMs,
    ).toBe(736);
  });
});
