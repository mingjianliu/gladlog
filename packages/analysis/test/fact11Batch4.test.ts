import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReductionSecondsAt,
  powerSpendTriggers,
} from "../src/data/talentScriptedCooldowns";
import {
  channelAuraTail,
  channelRefusedAtCast,
} from "../src/utils/castCommitSpans";
import { pressLandedOn } from "../src/utils/castMissRows";
import { unitCooldownEntry } from "../src/utils/cooldowns";
import { stealthImmunityHitMs } from "../src/utils/enemyDefensives";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "../src/utils/talents";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("GH #192: an old DoT's tick is not the new press landing", () => {
  const tick = {
    spellId: "188389",
    spellName: "Flame Shock",
    destUnitId: "W",
    timestamp: 20_001,
    logLine: { event: LogEvent.SPELL_PERIODIC_DAMAGE, timestamp: 20_001 },
  };
  const hit = {
    ...tick,
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: 20_001 },
  };
  it("a periodic row in the refusal's instant does not count", () => {
    expect(
      pressLandedOn(
        [tick] as never,
        "188389",
        "Flame Shock",
        [10_000, 20_000],
        20_000,
        "W",
        20_001,
      ),
    ).toBe(false);
  });
  it("a direct hit in that instant still does", () => {
    expect(
      pressLandedOn(
        [hit] as never,
        "188389",
        "Flame Shock",
        [10_000, 20_000],
        20_000,
        "W",
        20_001,
      ),
    ).toBe(true);
  });
});

describe("GH #192: the next channel's refusal is not this channel's effect", () => {
  // Ray of Frost pressed at 10 s and 12 s; IMMUNE rows at 10.001 and
  // exactly 12.000; no aura, no damage
  const miss = (t: number) => ({
    srcUnitId: "M",
    spellId: "205021",
    spellName: "Ray of Frost",
    timestamp: t,
    logLine: { event: LogEvent.SPELL_MISSED, timestamp: t },
  });
  const unit = {
    id: "M",
    missesOut: [miss(10_001), miss(12_000)],
    damageOut: [],
    healOut: [],
    auraEvents: [],
  } as never;
  it("bounded by the next press: refused", () => {
    expect(
      channelRefusedAtCast(
        unit,
        "205021",
        10_000,
        12_000,
        "Ray of Frost",
        true,
      ),
    ).toBe(true);
  });
  it("an inclusive bound (not a next press) keeps the old reading", () => {
    expect(
      channelRefusedAtCast(unit, "205021", 10_000, 12_000, "Ray of Frost"),
    ).toBe(false);
  });
});

describe("GH #194: a channel's aura that runs on past it", () => {
  it("Ultimate Penitence: bolts end at 1:04, the aura at 1:06", () => {
    expect(channelAuraTail("421453", 64.6, 66.5)).toBe("; its aura until 1:06");
  });
  it("nothing when the aura ends in the channel's second", () => {
    expect(channelAuraTail("421453", 64.2, 64.9)).toBe("");
  });
  it("nothing when the aura is the channel", () => {
    // Divine Hymn 64843 is a channel DB2 names
    expect(channelAuraTail("64843", 63.0, 66.0)).toBe("");
  });
});

describe("GH #195: an aimed hit past a stealth immunity's first second", () => {
  const row = (event: string, t: number, extra: object = {}) => ({
    srcUnitId: "B",
    destUnitId: "R",
    timestamp: t,
    logLine: { event, timestamp: t },
    ...extra,
  });
  const caster = (casts: object[]) =>
    ({ id: "M", spellCastEvents: casts }) as never;
  it("a swing a shield ate whole 1.28 s in ends it (D31)", () => {
    const rogue = {
      id: "R",
      damageIn: [],
      missesIn: [row(LogEvent.SWING_MISSED, 18_139, { missType: "ABSORB" })],
    } as never;
    expect(stealthImmunityHitMs(rogue, 16_857, 18_352, [])).toBe(18_139);
  });
  it("not inside the first second", () => {
    const rogue = {
      id: "R",
      damageIn: [row(LogEvent.SWING_DAMAGE_LANDED, 17_500)],
    } as never;
    expect(stealthImmunityHitMs(rogue, 16_857, 18_352, [])).toBeUndefined();
  });
  it("a tick, or a spell nobody pressed at the unit, is no evidence", () => {
    const rogue = {
      id: "R",
      damageIn: [
        row(LogEvent.SPELL_PERIODIC_DAMAGE, 18_000, {
          srcUnitId: "M",
          spellId: "703",
        }),
        row(LogEvent.SPELL_DAMAGE, 18_100, {
          srcUnitId: "M",
          spellId: "190356",
        }),
      ],
    } as never;
    expect(
      stealthImmunityHitMs(rogue, 16_857, 20_000, [caster([])]),
    ).toBeUndefined();
  });
  it("a spell pressed at the unit after it vanished does", () => {
    const rogue = {
      id: "R",
      damageIn: [
        row(LogEvent.SPELL_DAMAGE, 18_400, {
          srcUnitId: "M",
          spellId: "30455",
          spellName: "Ice Lance",
        }),
      ],
    } as never;
    const mage = caster([
      {
        spellId: "30455",
        spellName: "Ice Lance",
        destUnitId: "R",
        timestamp: 18_100,
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: 18_100 },
      },
    ]);
    expect(stealthImmunityHitMs(rogue, 16_857, 20_000, [mage])).toBe(18_400);
  });
  it("an IMMUNE miss is the immunity holding", () => {
    const rogue = {
      id: "R",
      damageIn: [],
      missesIn: [row(LogEvent.SWING_MISSED, 18_139, { missType: "IMMUNE" })],
    } as never;
    expect(stealthImmunityHitMs(rogue, 16_857, 18_352, [])).toBeUndefined();
  });
});

describe("GH #195: a hit in the closing row's own millisecond (codex 20-F26-07 #4)", () => {
  const swing = (lineIndex: number) => ({
    srcUnitId: "B",
    destUnitId: "R",
    timestamp: 13_200,
    logLine: {
      event: LogEvent.SWING_DAMAGE_LANDED,
      timestamp: 13_200,
      lineIndex,
    },
  });
  const removal = { ms: 13_200, lineIndex: 50 };
  it("logged before the REMOVED: it ended the immunity", () => {
    const rogue = { id: "R", damageIn: [swing(49)] } as never;
    expect(stealthImmunityHitMs(rogue, 12_000, 13_200, [], removal)).toBe(
      13_200,
    );
  });
  it("logged after it: the aura was already gone", () => {
    const rogue = { id: "R", damageIn: [swing(51)] } as never;
    expect(
      stealthImmunityHitMs(rogue, 12_000, 13_200, [], removal),
    ).toBeUndefined();
  });
});

describe("Violent Transformation by era (GH #193; codex 20-F26-07 #1, #6)", () => {
  const DEV = String(CombatUnitSpec.DemonHunter_Devourer);
  const AUG = Date.UTC(2026, 7, 15, 18);
  const NOV = PATCH_1215_GOLIVE_EPOCH_MS + 7 * 86_400_000;
  it("Soul Immolation: no reset before 12.1.5, a full one from it", () => {
    const r = EVENT_COOLDOWN_REDUCTIONS["452409:si-1215"]!;
    expect(eventReductionSecondsAt(r, DEV, AUG)).toBe(0);
    expect(eventReductionSecondsAt(r, DEV, NOV)).toBe(Number.POSITIVE_INFINITY);
  });
  it("The Hunt: a full reset before 12.1.5, none from it", () => {
    const r = EVENT_COOLDOWN_REDUCTIONS["452409:hunt-1210"]!;
    expect(eventReductionSecondsAt(r, DEV, AUG)).toBe(Number.POSITIVE_INFINITY);
    expect(eventReductionSecondsAt(r, DEV, NOV)).toBe(0);
  });
  it("a Hunt pressed again after the dated reset is a press of its own", () => {
    const PID = "player-1";
    const entered = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "1217607",
      AUG + 11_000,
      PID,
      PID,
      "BUFF",
    );
    const u = makeUnit(PID, {
      class: CombatUnitClass.DemonHunter,
      spec: CombatUnitSpec.DemonHunter_Devourer,
      // Violent Transformation: Devourer hero node 110115
      info: { talents: [{ id1: 110115, id2: 0, count: 1 }], pvpTalents: [] },
      spellCastEvents: [
        makeSpellCastEvent("1246167", AUG + 10_000, "e"),
        makeSpellCastEvent("1246167", AUG + 11_800, "e"),
      ],
      auraEvents: [entered],
      actionOut: [entered],
    });
    const combat = {
      startTime: AUG,
      endTime: AUG + 120_000,
      units: { [PID]: u },
    } as unknown as AtomicArenaCombat;
    const entry = unitCooldownEntry(u, combat, "1246167")!;
    expect(entry.casts.map((c) => c.timeSeconds)).toEqual([10, 11.8]);
  });
});

describe("GH #198: a Fang Strike Dispatch spends the maximum combo points", () => {
  const rb = EVENT_COOLDOWN_REDUCTIONS["79096"]!.triggerPowerSpend!;
  const dispatch = (t: number, cp?: number) => ({
    spellId: "2098",
    timestamp: t,
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: t },
    powerCosts:
      cp === undefined ? [{ type: 3, cost: 0 }] : [{ type: 4, cost: cp }],
  });
  const rogue = (removedAt?: number) =>
    ({
      id: "R",
      spellCastEvents: [dispatch(10_000, 6), dispatch(20_000)],
      auraEvents:
        removedAt === undefined
          ? []
          : [
              {
                spellId: "1301405",
                destUnitId: "R",
                logLine: {
                  event: LogEvent.SPELL_AURA_REMOVED,
                  timestamp: removedAt,
                },
              },
            ],
      advancedActions: [
        {
          advancedActorId: "R",
          timestamp: 19_990,
          advancedActorPowers: [{ type: 4, current: 2, max: 7 }],
        },
      ],
    }) as never;
  it("with its buff consumed: 7 s back", () => {
    expect(
      powerSpendTriggers(rogue(20_010), rb, "260").map((t) => t.seconds),
    ).toEqual([6, 7]);
  });
  it("no buff consumed: a zero-cost row gives nothing", () => {
    expect(
      powerSpendTriggers(rogue(), rb, "260").map((t) => t.seconds),
    ).toEqual([6]);
  });
});
