/**
 * GH #183: the cooldown and duration model behind the [PRESS] whitelist's
 * buttons under 45 s — an empower hold never released, Causality's
 * Disintegrate ticks, Impish Instincts' Physical hits, Cycle of Hatred's
 * stacks, Temporal Burst's per-stack rate, Burn to Ash's crit extension.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  castTargetTickTriggers,
  EVENT_COOLDOWN_REDUCTIONS,
  hostileTakenTriggers,
  ownStacksBefore,
} from "../src/data/talentScriptedCooldowns";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import {
  cdSecondsUntilReady,
  chargeSpendTimesOf,
  pressReadyAgainAtSeconds,
  unitCooldownEntry,
} from "../src/utils/cooldowns";
import { extractOffListPresses } from "../src/utils/offListPress";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const PID = "player-1";
const T0 = 1_000_000;
const combatOf = (u: any) =>
  ({
    startTime: T0,
    endTime: T0 + 300_000,
    units: { [PID]: u },
  }) as unknown as AtomicArenaCombat;
const row = (
  event: LogEvent,
  spellId: string,
  ms: number,
  extra: Record<string, unknown> = {},
): any => ({
  logLine: { event, timestamp: T0 + ms },
  timestamp: T0 + ms,
  spellId,
  srcUnitId: PID,
  destUnitId: PID,
  ...extra,
});
const empower = (spellId: string, ms: number, level = 1): any => ({
  spellId,
  timestamp: T0 + ms,
  logLine: { timestamp: T0 + ms },
  level,
});

describe("an empower hold never released starts no cooldown", () => {
  const FIRE_BREATH = "357208";
  // makeUnit takes no empower rows: set them on the unit
  const evoker = () =>
    Object.assign(
      makeUnit(PID, {
        class: CombatUnitClass.Evoker,
        spec: CombatUnitSpec.Evoker_Devastation,
        info: { talents: [], pvpTalents: [] },
        spellCastEvents: [10, 40, 43].map((s) =>
          makeSpellCastEvent(FIRE_BREATH, T0 + s * 1000, ""),
        ),
      }),
      {
        empowerStarts: [10, 40, 43].map((s) => empower(FIRE_BREATH, s * 1000)),
        empowerEnds: [
          empower(FIRE_BREATH, 11_500, 2),
          empower(FIRE_BREATH, 44_500, 3),
        ],
        empowerInterrupts: [empower(FIRE_BREATH, 40_600, 0)],
      },
    ) as any;

  it("the cut hold is a no-spend press on the earlier press's cooldown", () => {
    const u = evoker();
    const entry = unitCooldownEntry(u, combatOf(u), FIRE_BREATH)!;
    expect(entry.casts.map((c) => [c.timeSeconds, !!c.unreleased])).toEqual([
      [10, false],
      [40, true],
      [43, false],
    ]);
    expect(chargeSpendTimesOf(entry)).toEqual([10, 43]);
    expect(pressReadyAgainAtSeconds(entry, 43)).toBeCloseTo(
      43 + entry.cooldownSeconds,
      6,
    );
  });

  it("a retry right after a cut hold is a press that spends (codex review #1)", () => {
    const u = Object.assign(
      makeUnit(PID, {
        class: CombatUnitClass.Evoker,
        spec: CombatUnitSpec.Evoker_Devastation,
        info: { talents: [], pvpTalents: [] },
        spellCastEvents: [10, 11.5].map((s) =>
          makeSpellCastEvent(FIRE_BREATH, T0 + s * 1000, ""),
        ),
      }),
      {
        empowerStarts: [10_000, 11_500].map((ms) => empower(FIRE_BREATH, ms)),
        empowerEnds: [empower(FIRE_BREATH, 13_000, 2)],
        empowerInterrupts: [empower(FIRE_BREATH, 10_300, 0)],
      },
    ) as any;
    const entry = unitCooldownEntry(u, combatOf(u), FIRE_BREATH)!;
    expect(chargeSpendTimesOf(entry)).toEqual([11.5]);
    expect(pressReadyAgainAtSeconds(entry, 11.5)).toBeCloseTo(
      11.5 + entry.cooldownSeconds,
      6,
    );
  });

  it("another spell pressed on the cut hold's millisecond still spends (codex review #2)", () => {
    const SCALES = "363916";
    const u = Object.assign(
      makeUnit(PID, {
        class: CombatUnitClass.Evoker,
        spec: CombatUnitSpec.Evoker_Devastation,
        info: { talents: [], pvpTalents: [] },
        spellCastEvents: [
          makeSpellCastEvent(SCALES, T0 + 40_000, ""),
          makeSpellCastEvent(FIRE_BREATH, T0 + 40_000, ""),
        ],
      }),
      {
        empowerStarts: [empower(FIRE_BREATH, 40_000)],
        empowerInterrupts: [empower(FIRE_BREATH, 40_600, 0)],
      },
    ) as any;
    const entry = unitCooldownEntry(u, combatOf(u), SCALES)!;
    expect(entry.casts.some((c) => c.unreleased)).toBe(false);
    expect(chargeSpendTimesOf(entry)).toEqual([40]);
  });

  it("the [PRESS] line states the presses that went out, not the cut hold", () => {
    const u = evoker();
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(presses.map((p) => [p.timeSeconds, p.free ?? false])).toEqual([
      [10, false],
      [43, false],
    ]);
  });

  it("a cut row the ledger's dedup folded away still prints no line (codex review round 4)", () => {
    // SUCCESS rows 20 ms apart, the second one the cut hold: the ledger keeps
    // the first, unmarked; the row itself is what decides (`unreleasedHoldMs`)
    const u = Object.assign(
      makeUnit(PID, {
        class: CombatUnitClass.Evoker,
        spec: CombatUnitSpec.Evoker_Devastation,
        info: { talents: [], pvpTalents: [] },
        spellCastEvents: [35_000, 35_020].map((ms) =>
          makeSpellCastEvent(FIRE_BREATH, T0 + ms, ""),
        ),
      }),
      {
        empowerStarts: [empower(FIRE_BREATH, 35_020)],
        empowerInterrupts: [empower(FIRE_BREATH, 35_030, 0)],
      },
    ) as any;
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(presses.map((p) => p.timeSeconds)).toEqual([35]);
  });

  it("a retry 20 ms after a cut hold spends and prints its own cooldown (codex review round 5)", () => {
    const u = Object.assign(
      makeUnit(PID, {
        class: CombatUnitClass.Evoker,
        spec: CombatUnitSpec.Evoker_Devastation,
        info: { talents: [], pvpTalents: [] },
        spellCastEvents: [35_000, 35_020].map((ms) =>
          makeSpellCastEvent(FIRE_BREATH, T0 + ms, ""),
        ),
      }),
      {
        empowerStarts: [35_000, 35_020].map((ms) => empower(FIRE_BREATH, ms)),
        empowerInterrupts: [empower(FIRE_BREATH, 35_010, 0)],
        empowerEnds: [empower(FIRE_BREATH, 35_720, 2)],
      },
    ) as any;
    const entry = unitCooldownEntry(u, combatOf(u), FIRE_BREATH)!;
    expect(chargeSpendTimesOf(entry)).toEqual([35.02]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(
      presses.map((p) => [p.timeSeconds, p.free ?? false, p.cooldownSeconds]),
    ).toEqual([[35.02, false, entry.cooldownSeconds]]);
    expect(presses[0]!.readyAgainAtSeconds).toBeCloseTo(
      35.02 + entry.cooldownSeconds,
      6,
    );
  });
});

describe("Causality — the cast target's Disintegrate ticks", () => {
  const r = EVENT_COOLDOWN_REDUCTIONS["375777"]!;
  const tick = (ms: number, dest: string, miss = false): any => ({
    spellId: "356995",
    destUnitId: dest,
    logLine: {
      event: miss
        ? LogEvent.SPELL_PERIODIC_MISSED
        : LogEvent.SPELL_PERIODIC_DAMAGE,
      timestamp: T0 + ms,
    },
  });
  it("one per tick on the target, absorbed ones too; another unit's row and a tick past the next cast are not", () => {
    const unit: any = {
      spellCastEvents: [
        makeSpellCastEvent("356995", T0 + 1_000, "enemy-1"),
        makeSpellCastEvent("356995", T0 + 5_000, "enemy-2"),
      ],
      damageOut: [
        tick(1_800, "enemy-1"),
        tick(1_800, "enemy-3"), // Mass Disintegrate's other target
        tick(2_600, "enemy-1"),
        tick(5_500, "enemy-1"), // after the next cast, on the old target
        tick(5_800, "enemy-2"),
      ],
      missesOut: [tick(3_400, "enemy-1", true)],
    };
    const gs = castTargetTickTriggers(unit, r, "1467");
    expect(gs.map((g) => g.atMs - T0)).toEqual([1_800, 2_600, 3_400, 5_800]);
    // a tick on the cast's own millisecond is its first (codex review #4)
    unit.damageOut.push(tick(5_000, "enemy-2"), tick(1_000, "enemy-1"));
    expect(
      castTargetTickTriggers(unit, r, "1467").map((g) => g.atMs - T0),
    ).toEqual([1_000, 1_800, 2_600, 3_400, 5_000, 5_800]);
    expect(gs.every((g) => g.seconds === 0.5)).toBe(true);
  });
});

describe("Causality — a shared millisecond goes by log order (codex review round 2)", () => {
  it("the old channel's last tick logged before the new cast row is the old one's", () => {
    const r = EVENT_COOLDOWN_REDUCTIONS["375777"]!;
    const at = (ms: number, lineIndex: number) => ({
      timestamp: T0 + ms,
      lineIndex,
    });
    const cast = (ms: number, lineIndex: number, dest: string): any => ({
      spellId: "356995",
      destUnitId: dest,
      logLine: { event: LogEvent.SPELL_CAST_SUCCESS, ...at(ms, lineIndex) },
    });
    const tick = (ms: number, lineIndex: number, dest: string): any => ({
      spellId: "356995",
      destUnitId: dest,
      logLine: {
        event: LogEvent.SPELL_PERIODIC_DAMAGE,
        ...at(ms, lineIndex),
      },
    });
    const unit: any = {
      spellCastEvents: [cast(1_000, 1, "A"), cast(5_000, 11, "B")],
      damageOut: [tick(5_000, 10, "A"), tick(5_000, 12, "B")],
      missesOut: [],
    };
    expect(castTargetTickTriggers(unit, r, "1467")).toHaveLength(2);
  });
});

describe("Impish Instincts — direct Physical hits taken", () => {
  const r = EVENT_COOLDOWN_REDUCTIONS["409835"]!;
  it("swings, Physical spell rows and whole absorbs count once per 5 s; magic, periodic, dodges and debuffs do not", () => {
    const hit = (event: LogEvent, ms: number, school?: string): any => ({
      spellId: "1",
      srcUnitId: "enemy-1",
      ...(school ? { spellSchoolId: school } : {}),
      logLine: { event, timestamp: T0 + ms },
    });
    const unit: any = {
      id: PID,
      damageIn: [
        hit(LogEvent.SPELL_DAMAGE, 1_000, "0x20"), // Shadow
        hit(LogEvent.SWING_DAMAGE, 2_000),
        hit(LogEvent.SWING_DAMAGE, 4_000), // inside the 5 s lockout
        hit(LogEvent.SPELL_PERIODIC_DAMAGE, 8_000, "0x1"),
        hit(LogEvent.SPELL_DAMAGE, 12_000, "0x1"),
      ],
      missesIn: [
        { ...hit(LogEvent.SWING_MISSED, 7_500), missType: "DODGE" },
        { ...hit(LogEvent.SWING_MISSED, 18_000), missType: "ABSORB" },
      ],
      auraEvents: [
        {
          ...hit(LogEvent.SPELL_AURA_APPLIED, 24_000),
          auraType: "DEBUFF",
        },
      ],
    };
    expect(hostileTakenTriggers(unit, r).map((g) => g.atMs - T0)).toEqual([
      2_000, 12_000, 18_000,
    ]);
  });
});

describe("Cycle of Hatred — Eye Beam's own cooldown by the stacks before it", () => {
  const EYE_BEAM = "198013";
  const STACKS = "1214887";
  it("a restated APPLIED keeps the count", () => {
    const u: any = {
      id: PID,
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, STACKS, 1_000),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, STACKS, 2_000, { amount: 3 }),
        row(LogEvent.SPELL_AURA_APPLIED, STACKS, 3_000), // restated
      ],
    };
    expect(ownStacksBefore(u, STACKS, T0 + 1_000)).toBe(0);
    expect(ownStacksBefore(u, STACKS, T0 + 2_500)).toBe(3);
    expect(ownStacksBefore(u, STACKS, T0 + 3_500)).toBe(3);
    u.auraEvents.push(row(LogEvent.SPELL_AURA_REMOVED, STACKS, 4_000));
    u.auraEvents.push(row(LogEvent.SPELL_AURA_APPLIED, STACKS, 5_000));
    expect(ownStacksBefore(u, STACKS, T0 + 5_500)).toBe(1);
  });

  it("a holder's press with 2 stacks up comes back 5 s sooner", () => {
    const u = makeUnit(PID, {
      class: CombatUnitClass.DemonHunter,
      spec: CombatUnitSpec.DemonHunter_Havoc,
      info: {
        talents: [{ id1: 91032, id2: 112955, count: 1 }],
        pvpTalents: [],
      },
      spellCastEvents: [10, 60].map((s) =>
        makeSpellCastEvent(EYE_BEAM, T0 + s * 1000, ""),
      ),
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, STACKS, 5_000),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, STACKS, 10_000, { amount: 2 }),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, STACKS, 60_000, { amount: 3 }),
      ],
    } as any);
    const entry = unitCooldownEntry(u, combatOf(u), EYE_BEAM)!;
    const cd = entry.cooldownSeconds;
    // 1 stack before the first press (its own dose lands on its ms)
    expect(pressReadyAgainAtSeconds(entry, 10)).toBeCloseTo(10 + cd - 2.5, 6);
    expect(pressReadyAgainAtSeconds(entry, 60)).toBeCloseTo(60 + cd - 5, 6);
    // seconds left read the press's own base too (codex review #3)
    expect(cdSecondsUntilReady(entry, 70)).toBeCloseTo(60 + cd - 5 - 70, 6);
  });
});

describe("Havoc 4pc — Essence Break counts the press's own Cycle of Hatred dose (fact12 D4)", () => {
  const ESSENCE_BREAK = "258860";
  const STACKS = "1214887";
  const havoc = (doseAtMs: number) =>
    makeUnit(PID, {
      class: CombatUnitClass.DemonHunter,
      spec: CombatUnitSpec.DemonHunter_Havoc,
      info: {
        talents: [{ id1: 91032, id2: 112955, count: 1 }],
        pvpTalents: [],
        equipment: ["271535", "271536", "271537", "271538"].map((id) => ({
          id,
        })),
      },
      spellCastEvents: [makeSpellCastEvent(ESSENCE_BREAK, T0 + 10_000, "")],
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, STACKS, 5_000),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, STACKS, doseAtMs, { amount: 2 }),
      ],
    } as any);
  it("1d26a991 r0 0:17: 1 stack up, its own dose 9 ms later — 2 stacks, 35 s", () => {
    const entry = unitCooldownEntry(
      havoc(10_009),
      combatOf(havoc(10_009)),
      ESSENCE_BREAK,
    )!;
    expect(entry.cooldownSeconds).toBe(40);
    expect(pressReadyAgainAtSeconds(entry, 10)).toBeCloseTo(10 + 35, 6);
  });
  it("a dose a second later is no part of the press", () => {
    const u = havoc(11_000);
    const entry = unitCooldownEntry(u, combatOf(u), ESSENCE_BREAK)!;
    expect(pressReadyAgainAtSeconds(entry, 10)).toBeCloseTo(10 + 37.5, 6);
  });
});

describe("Cycle of Hatred under a Metamorphosis reset (codex review #3)", () => {
  it("seconds left before the reset read the press's own base", () => {
    const EYE_BEAM = "198013";
    const STACKS = "1214887";
    const u = makeUnit(PID, {
      class: CombatUnitClass.DemonHunter,
      spec: CombatUnitSpec.DemonHunter_Havoc,
      info: {
        talents: [
          { id1: 91032, id2: 112955, count: 1 }, // Cycle of Hatred
          { id1: 91024, id2: 112947, count: 1 }, // Chaotic Transformation
        ],
        pvpTalents: [],
      },
      spellCastEvents: [
        makeSpellCastEvent(EYE_BEAM, T0 + 60_000, ""),
        makeSpellCastEvent("200166", T0 + 75_000, ""),
      ],
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, STACKS, 5_000),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, STACKS, 10_000, { amount: 2 }),
      ],
    } as any);
    const entry = unitCooldownEntry(u, combatOf(u), EYE_BEAM)!;
    const cd = entry.cooldownSeconds;
    expect(cdSecondsUntilReady(entry, 70)).toBeCloseTo(60 + cd - 5 - 70, 6);
    expect(pressReadyAgainAtSeconds(entry, 60)).toBeCloseTo(75, 6);
  });
});

describe("Cycle of Hatred — the [PRESS] line prints the press's own cooldown (codex review round 2)", () => {
  it("4 stacks: 20 s, back 20 s later", () => {
    const EYE_BEAM = "198013";
    const STACKS = "1214887";
    const u = makeUnit(PID, {
      class: CombatUnitClass.DemonHunter,
      spec: CombatUnitSpec.DemonHunter_Havoc,
      info: {
        talents: [{ id1: 91032, id2: 112955, count: 1 }],
        pvpTalents: [],
      },
      spellCastEvents: [makeSpellCastEvent(EYE_BEAM, T0 + 60_000, "")],
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, STACKS, 5_000),
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, STACKS, 10_000, { amount: 4 }),
      ],
    } as any);
    const entry = unitCooldownEntry(u, combatOf(u), EYE_BEAM)!;
    const [p] = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(p!.cooldownSeconds).toBeCloseTo(entry.cooldownSeconds - 10, 6);
    expect(p!.readyAgainAtSeconds).toBeCloseTo(
      60 + entry.cooldownSeconds - 10,
      6,
    );
  });
});

describe("Temporal Burst — the recovery speeds up per stack", () => {
  it("cuts the buff into one rate window per stack count", () => {
    const DREAM_BREATH = "355936";
    const BURST = "431698";
    const u = makeUnit(PID, {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Preservation,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [makeSpellCastEvent(DREAM_BREATH, T0 + 10_000, "")],
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED, BURST, 20_000, { auraType: "BUFF" }),
        row(LogEvent.SPELL_AURA_REMOVED_DOSE, BURST, 21_000, {
          amount: 29,
          auraType: "BUFF",
        }),
        row(LogEvent.SPELL_AURA_REMOVED, BURST, 22_000, { auraType: "BUFF" }),
      ],
    } as any);
    const entry = unitCooldownEntry(u, combatOf(u), DREAM_BREATH)!;
    const burst = (entry.rateWindows ?? []).filter(
      (w) => w.fromSeconds >= 20 && w.toSeconds <= 22,
    );
    expect(burst.map((w) => [w.fromSeconds, w.toSeconds, w.mult])).toEqual([
      [20, 21, 1.15],
      [21, 22, 1.145],
    ]);
  });

  it("a dose that opens the interval sets its count (codex review #5)", () => {
    const DREAM_BREATH = "355936";
    const BURST = "431698";
    const u = makeUnit(PID, {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Preservation,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [makeSpellCastEvent(DREAM_BREATH, T0 + 10_000, "")],
      auraEvents: [
        row(LogEvent.SPELL_AURA_APPLIED_DOSE, BURST, 20_000, {
          amount: 10,
          auraType: "BUFF",
        }),
        row(LogEvent.SPELL_AURA_REMOVED_DOSE, BURST, 21_000, {
          amount: 9,
          auraType: "BUFF",
        }),
        row(LogEvent.SPELL_AURA_REMOVED, BURST, 22_000, { auraType: "BUFF" }),
      ],
    } as any);
    const entry = unitCooldownEntry(u, combatOf(u), DREAM_BREATH)!;
    const burst = (entry.rateWindows ?? []).filter(
      (w) => w.fromSeconds >= 20 && w.toSeconds <= 22,
    );
    expect(burst.map((w) => w.mult)).toEqual([1.05, 1.045]);
  });
});

describe("Burn to Ash — Truth's Wake grows by its own crit ticks", () => {
  const TRUTHS_WAKE = "403695";
  const ret = (damageOut: any[], missesOut: any[] = []) =>
    Object.assign(
      makeUnit(PID, {
        class: CombatUnitClass.Paladin,
        spec: CombatUnitSpec.Paladin_Retribution,
        info: {
          talents: [{ id1: 92686, id2: 114824, count: 1 }],
          pvpTalents: [],
        },
        damageOut,
      }),
      { missesOut },
    ) as any;
  const tick = (ms: number, crit: boolean, dest = "enemy-1"): any => ({
    spellId: TRUTHS_WAKE,
    destUnitId: dest,
    ...(crit ? { crit: true } : {}),
    logLine: { event: LogEvent.SPELL_PERIODIC_DAMAGE, timestamp: T0 + ms },
  });
  it("+2 s per crit tick on that unit inside the growing duration, absorbed crits too", () => {
    const u = ret(
      [
        tick(1_000, true),
        tick(2_000, false),
        tick(3_000, true, "enemy-2"), // another copy's
        tick(10_500, true), // inside 9 + 2 s only because of the first crit
        tick(20_000, true), // past the end
      ],
      [
        {
          ...tick(4_000, false),
          missType: "ABSORB",
          crit: true,
          logLine: {
            event: LogEvent.SPELL_PERIODIC_MISSED,
            timestamp: T0 + 4_000,
          },
        },
      ],
    );
    expect(
      buffFullDurationForCaster(TRUTHS_WAKE, u, T0, {
        pressed: true,
        onUnitId: "enemy-1",
      }),
    ).toBe(15);
    // no unit named: the base
    expect(buffFullDurationForCaster(TRUTHS_WAKE, u, T0)).toBe(9);
  });
});

describe("a press that did nothing spends no cooldown (GH #179 batch 3b)", () => {
  const SURGE = "359073";
  const SURGE_HIT = "359077";
  // pressed at 10 s and 20 s, released 2 s in; `hits` are the releases
  // (s) that landed a 359077 row
  const surger = (hits: number[], missed: number[] = []) =>
    Object.assign(
      makeUnit(PID, {
        class: CombatUnitClass.Evoker,
        spec: CombatUnitSpec.Evoker_Devastation,
        info: { talents: [], pvpTalents: [] },
        spellCastEvents: [10, 20].map((s) =>
          makeSpellCastEvent(SURGE, T0 + s * 1000, ""),
        ),
        damageOut: hits.map((s) =>
          row(LogEvent.SPELL_DAMAGE, SURGE_HIT, s * 1000 + 300, {
            destUnitId: "enemy",
          }),
        ),
      }),
      {
        empowerStarts: [10, 20].map((s) => empower(SURGE, s * 1000)),
        empowerEnds: [12, 22].map((s) => empower(SURGE, s * 1000, 2)),
        missesOut: missed.map((s) =>
          row(LogEvent.SPELL_MISSED, SURGE_HIT, s * 1000 + 300, {
            destUnitId: "enemy",
          }),
        ),
      },
    ) as any;

  it("an Eternity Surge released with no hit is no spend; the retry is", () => {
    const u = surger([22]);
    const entry = unitCooldownEntry(u, combatOf(u), SURGE)!;
    expect(chargeSpendTimesOf(entry)).toEqual([20]);
    const presses = extractOffListPresses([u], combatOf(u), T0 + 300_000);
    expect(presses.map((p) => p.timeSeconds)).toEqual([20]);
  });

  it("a release whose hit was immune or absorbed (SPELL_MISSED) did spend", () => {
    const u = surger([22], [12]);
    expect(
      chargeSpendTimesOf(unitCooldownEntry(u, combatOf(u), SURGE)!),
    ).toEqual([10, 20]);
  });

  it("a hit a shield ate whole (SPELL_ABSORBED, keyed by the shield) did spend", () => {
    const u = surger([22]);
    u.damageOut.push(
      row(LogEvent.SPELL_ABSORBED, "17", 12_300, {
        destUnitId: "enemy",
        attackSpellId: SURGE_HIT,
      }),
    );
    expect(
      chargeSpendTimesOf(unitCooldownEntry(u, combatOf(u), SURGE)!),
    ).toEqual([10, 20]);
  });

  it("a hit logged after the window does not count", () => {
    // hit at 12 + 1.6 s
    const u = surger([22]);
    u.damageOut.push(
      row(LogEvent.SPELL_DAMAGE, SURGE_HIT, 13_600, { destUnitId: "enemy" }),
    );
    expect(
      chargeSpendTimesOf(unitCooldownEntry(u, combatOf(u), SURGE)!),
    ).toEqual([20]);
  });

  const CAUTERIZE = "374251";
  const preserver = (dispelAt: number[]) =>
    makeUnit(PID, {
      class: CombatUnitClass.Evoker,
      spec: CombatUnitSpec.Evoker_Preservation,
      info: { talents: [], pvpTalents: [] },
      spellCastEvents: [10, 15].map((s) =>
        makeSpellCastEvent(CAUTERIZE, T0 + s * 1000, "ally"),
      ),
      actionOut: dispelAt.map((s) =>
        row(LogEvent.SPELL_DISPEL, CAUTERIZE, s * 1000, {
          destUnitId: "ally",
          extraSpellId: "703",
        }),
      ),
    }) as any;

  it("a Cauterizing Flame that removed nothing is no spend", () => {
    const u = preserver([15]);
    const entry = unitCooldownEntry(u, combatOf(u), CAUTERIZE)!;
    expect(chargeSpendTimesOf(entry)).toEqual([15]);
  });

  it("one that dispelled spends its cooldown", () => {
    const u = preserver([10, 15]);
    const entry = unitCooldownEntry(u, combatOf(u), CAUTERIZE)!;
    expect(chargeSpendTimesOf(entry)).toEqual([10, 15]);
  });
});
