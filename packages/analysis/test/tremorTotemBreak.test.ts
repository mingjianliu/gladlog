import { CombatUnitClass, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  extractTremorAvoidedInstances,
  ICCInstance,
  TREMOR_BREAK_MAX_LAG_MS,
  TREMOR_TOTEM_CAST_SPELL_ID,
  tremorTotemBreak,
} from "../src/utils/ccTrinketAnalysis";

type Mate = Parameters<typeof tremorTotemBreak>[2][number];
const START = 1_000_000;
const shaman = (castAtS: number[], cls = CombatUnitClass.Shaman): Mate =>
  ({
    name: "Totemguy-Realm",
    class: cls,
    spellCastEvents: castAtS.map((s) => ({
      spellId: TREMOR_TOTEM_CAST_SPELL_ID,
      logLine: {
        event: LogEvent.SPELL_CAST_SUCCESS,
        timestamp: START + s * 1000,
      },
    })),
  }) as unknown as Mate;
// Psychic Scream applied at 10 s, ended at 13 s
const fear = { spellId: "8122", atSeconds: 10, durationSeconds: 3 };

describe("tremorTotemBreak (GH #100: the one tremor fact the log supports)", () => {
  it("credits a totem dropped mid-fear when the fear ends the same instant", () => {
    expect(tremorTotemBreak(fear, START, [shaman([13])])).toEqual({
      shamanName: "Totemguy-Realm",
      castMs: START + 13_000,
    });
    expect(
      tremorTotemBreak(fear, START, [
        shaman([13 - TREMOR_BREAK_MAX_LAG_MS / 1000]),
      ]),
    ).not.toBeNull();
  });

  it("handles exact 500ms lag boundary and rejects beyond it", () => {
    const at500ms = tremorTotemBreak(fear, START, [shaman([12.5])]);
    expect(at500ms).toEqual({
      shamanName: "Totemguy-Realm",
      castMs: START + 12_500,
    });
    const at501ms = tremorTotemBreak(fear, START, [shaman([12.499])]);
    expect(at501ms).toBeNull();
  });

  it("does NOT credit a totem that was already up when the fear landed", () => {
    // fear also breaks on damage — a short fear under a standing totem is not attributable
    expect(tremorTotemBreak(fear, START, [shaman([8])])).toBeNull();
    expect(tremorTotemBreak(fear, START, [shaman([10])])).toBeNull();
  });

  it("does not credit a totem dropped well before the fear ended, or after it", () => {
    expect(tremorTotemBreak(fear, START, [shaman([11])])).toBeNull();
    expect(tremorTotemBreak(fear, START, [shaman([13.2])])).toBeNull();
  });

  it("handles out-of-order timestamps and finds matching cast", () => {
    expect(tremorTotemBreak(fear, START, [shaman([13.2, 13.0])])).toEqual({
      shamanName: "Totemguy-Realm",
      castMs: START + 13_000,
    });
  });

  it("finds valid cast on a later teammate if earlier teammate has no match", () => {
    const nonMatchingShaman = shaman([5]);
    nonMatchingShaman.name = "FirstShaman";
    const matchingShaman = shaman([13]);
    matchingShaman.name = "SecondShaman";
    expect(
      tremorTotemBreak(fear, START, [nonMatchingShaman, matchingShaman]),
    ).toEqual({
      shamanName: "SecondShaman",
      castMs: START + 13_000,
    });
  });

  it("only for tremor-breakable CC, only from a shaman", () => {
    expect(
      tremorTotemBreak({ ...fear, spellId: "853" }, START, [shaman([13])]),
    ).toBeNull();
    expect(
      tremorTotemBreak(fear, START, [shaman([13], CombatUnitClass.Priest)]),
    ).toBeNull();
  });
});

describe("extractTremorAvoidedInstances (W2 / N3: pre-placed Tremor avoidance helper)", () => {
  const makeCc = (overrides: Partial<ICCInstance> = {}): ICCInstance => ({
    atSeconds: 20,
    durationSeconds: 1.5,
    spellId: "8122", // Psychic Scream
    spellName: "Psychic Scream",
    sourceName: "EnemyPriest",
    sourceId: "Player-2",
    sourceSpec: "Discipline Priest",
    damageTakenDuring: 0,
    trinketState: "available_unused",
    drInfo: null,
    distanceYards: null,
    losBlocked: null,
    ...overrides,
  });

  it("credits avoidance when Tremor was cast within 10s lookback and CC duration <= 2s", () => {
    const player = {
      class: CombatUnitClass.Shaman,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: START + 15_000,
          },
        },
      ],
    };
    const cc = makeCc({ atSeconds: 20, durationSeconds: 1.8 });
    const avoided = extractTremorAvoidedInstances(player as any, [cc], START);
    expect(avoided).toHaveLength(1);
    expect(avoided[0]).toEqual({
      atSeconds: 20,
      spellId: "8122",
      spellName: "Psychic Scream",
      avoidanceSpellName: "Tremor Totem",
      avoidanceSpellId: TREMOR_TOTEM_CAST_SPELL_ID,
      sourceName: "EnemyPriest",
      sourceId: "Player-2",
      sourceSpec: "Discipline Priest",
    });
  });

  it("handles exact 10s boundary (qualifies at 10,000ms, rejects at 10,001ms)", () => {
    const playerAt10s = {
      class: CombatUnitClass.Shaman,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: START + 10_000,
          },
        },
      ],
    };
    const cc = makeCc({ atSeconds: 20, durationSeconds: 1.5 });
    expect(
      extractTremorAvoidedInstances(playerAt10s as any, [cc], START),
    ).toHaveLength(1);

    const playerAt10001ms = {
      class: CombatUnitClass.Shaman,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: START + 9_999,
          },
        },
      ],
    };
    expect(
      extractTremorAvoidedInstances(playerAt10001ms as any, [cc], START),
    ).toHaveLength(0);
  });

  it("qualifies when cast timestamp is exactly 0", () => {
    const playerAt0 = {
      class: CombatUnitClass.Shaman,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: 0,
          },
        },
      ],
    };
    const cc = makeCc({ atSeconds: 5, durationSeconds: 1.0 });
    expect(
      extractTremorAvoidedInstances(playerAt0 as any, [cc], 0),
    ).toHaveLength(1);
  });

  it("handles exact 2.0s duration boundary (qualifies at 2.0s, rejects at 2.1s)", () => {
    const player = {
      class: CombatUnitClass.Shaman,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: {
            event: LogEvent.SPELL_CAST_SUCCESS,
            timestamp: START + 15_000,
          },
        },
      ],
    };
    const cc2s = makeCc({ durationSeconds: 2.0 });
    expect(
      extractTremorAvoidedInstances(player as any, [cc2s], START),
    ).toHaveLength(1);

    const cc21s = makeCc({ durationSeconds: 2.1 });
    expect(
      extractTremorAvoidedInstances(player as any, [cc21s], START),
    ).toHaveLength(0);
  });

  it("rejects non-shaman, non-breakable CC, and non-success cast events", () => {
    const cc = makeCc({ durationSeconds: 1.5 });

    const paladin = {
      class: CombatUnitClass.Paladin,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: START + 15_000 },
        },
      ],
    };
    expect(extractTremorAvoidedInstances(paladin as any, [cc], START)).toHaveLength(0);

    const player = {
      class: CombatUnitClass.Shaman,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: START + 15_000 },
        },
      ],
    };
    const kidney = makeCc({ spellId: "408", spellName: "Kidney Shot" });
    expect(extractTremorAvoidedInstances(player as any, [kidney], START)).toHaveLength(0);

    const failedCastPlayer = {
      class: CombatUnitClass.Shaman,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: { event: LogEvent.SPELL_CAST_START, timestamp: START + 15_000 },
        },
      ],
    };
    expect(extractTremorAvoidedInstances(failedCastPlayer as any, [cc], START)).toHaveLength(0);
  });

  it("emits exactly one result per qualifying CC even with multiple matching casts", () => {
    const player = {
      class: CombatUnitClass.Shaman,
      spellCastEvents: [
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: START + 15_000 },
        },
        {
          spellId: TREMOR_TOTEM_CAST_SPELL_ID,
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: START + 18_000 },
        },
      ],
    };
    const cc = makeCc({ atSeconds: 20, durationSeconds: 1.5 });
    const avoided = extractTremorAvoidedInstances(player as any, [cc], START);
    expect(avoided).toHaveLength(1);
  });
});
