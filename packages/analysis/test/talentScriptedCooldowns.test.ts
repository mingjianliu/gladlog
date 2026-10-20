import { describe, expect, it } from "vitest";

import {
  EVENT_COOLDOWN_REDUCTIONS,
  EVENT_HIT_SAME_USE_MS,
  eventReducedCooldownSeconds,
  eventReductionSecondsAt,
  eventTriggersFor,
  eventTriggerTimesMs,
  IDLE_COOLDOWN_CREDITS,
  idleCreditCapFor,
  ON_INTERRUPT_COOLDOWN_REDUCTIONS,
} from "../src/data/talentScriptedCooldowns";
import {
  applyCdModifiers,
  applyEventReductions,
  cdAvailableAt,
  cdRealisedSecondsUntilReady,
  cdSecondsUntilReady,
  warpClock,
} from "../src/utils/cooldowns";
import {
  CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS,
  CD_TALENT_MODIFIERS,
  DATED_COOLDOWN_VALUES,
  PER_RANK_COOLDOWN_TALENTS,
} from "../src/utils/talentModifiers";

describe("RULED_COOLDOWN_VALUES — 静电充能每级 10 秒(用户裁 2026-09-26)", () => {
  const mods = [
    { talentSpellId: "265046", effect: "reduce_cd" as const, value: 15 },
  ];
  const at = (rank: number) =>
    applyCdModifiers(mods, 60, 1, new Set(["265046"]), new Set(), {
      talentRanks: new Map([["265046", rank]]),
    }).cooldownSeconds;
  it("1 级 −10,2 级 −20(DB2 行的 −15 被裁决值取代)", () => {
    expect(at(1)).toBe(50);
    expect(at(2)).toBe(40);
  });
});

describe("PER_RANK_COOLDOWN_TALENTS — Savagery (Takedown −15 s per rank, FT board item 1b)", () => {
  const SAVAGERY = "1251790";
  const TAKEDOWN = "1250646";
  const at = (rank: number | undefined) =>
    applyCdModifiers(
      CD_TALENT_MODIFIERS[TAKEDOWN],
      90,
      1,
      new Set(rank === undefined ? [] : [SAVAGERY]),
      new Set(),
      rank === undefined
        ? undefined
        : { talentRanks: new Map([[SAVAGERY, rank]]) },
    ).cooldownSeconds;
  it("the generated row is the DB2 −15 s on Takedown, and the talent is rank-scaled", () => {
    expect(CD_TALENT_MODIFIERS[TAKEDOWN]).toContainEqual(
      expect.objectContaining({
        talentSpellId: SAVAGERY,
        effect: "reduce_cd",
        value: 15,
      }),
    );
    expect(PER_RANK_COOLDOWN_TALENTS.has(SAVAGERY)).toBe(true);
  });
  it("90 s without it, 75 s at rank 1, 60 s at rank 2 (the corpus floor: 60.0 s)", () => {
    expect(at(undefined)).toBe(90);
    expect(at(1)).toBe(75);
    expect(at(2)).toBe(60);
  });
});

describe("PER_RANK_COOLDOWN_TALENTS — Born To Be Wild (Aspect of the Turtle −15 s per rank, FT F20)", () => {
  const BORN_TO_BE_WILD = "266921";
  const IMPROVED_TURTLE = "1258485";
  const TURTLE = "186265";
  const at = (rank: number | undefined) =>
    applyCdModifiers(
      CD_TALENT_MODIFIERS[TURTLE],
      180,
      1,
      new Set(
        rank === undefined
          ? [IMPROVED_TURTLE]
          : [IMPROVED_TURTLE, BORN_TO_BE_WILD],
      ),
      new Set(),
      rank === undefined
        ? undefined
        : { talentRanks: new Map([[BORN_TO_BE_WILD, rank]]) },
    ).cooldownSeconds;
  it("the generated row is the DB2 −15 s on the Turtle, and the talent is rank-scaled", () => {
    expect(CD_TALENT_MODIFIERS[TURTLE]).toContainEqual(
      expect.objectContaining({
        talentSpellId: BORN_TO_BE_WILD,
        effect: "reduce_cd",
        value: 15,
      }),
    );
    expect(PER_RANK_COOLDOWN_TALENTS.has(BORN_TO_BE_WILD)).toBe(true);
  });
  it("with Improved Aspect of the Turtle: 150 s without it, 135 s at rank 1, 120 s at rank 2 (the corpus floor: 120.2 s)", () => {
    expect(at(undefined)).toBe(150);
    expect(at(1)).toBe(135);
    expect(at(2)).toBe(120);
  });
});

/**
 * Scripted cooldown effects (talent impact audit 2026-09-26). The ready
 * instant of an event-reduced press is the fixed point R = press + cd − s ×
 * #triggers in (press, R); "available at t" ⇔ R ≤ t, while "seconds until
 * ready at t" may only count the triggers that had happened by t (agy
 * review: the final override alone would count later bolts early).
 */
const conduit = EVENT_COOLDOWN_REDUCTIONS["1217092"]!;
const AUG_14 = Date.UTC(2026, 7, 14, 20, 0, 0);
const AUG_19 = Date.UTC(2026, 7, 19, 20, 0, 0);
/** triggers at these match seconds, each giving back `seconds` */
const giveBacks = (at: number[], seconds = 1) =>
  at.map((atSeconds) => ({ atSeconds, seconds }));

describe("eventReducedCooldownSeconds — 事件减 CD 的不动点", () => {
  it("没有触发 → 原冷却", () => {
    expect(eventReducedCooldownSeconds(0, 90, [])).toBe(90);
  });
  it("每次触发 −1 s,只算到(当前)就绪时刻之前的", () => {
    // 10 bolts at 10..19, ready 90 → 80
    const bolts = Array.from({ length: 10 }, (_, i) => 10 + i);
    expect(eventReducedCooldownSeconds(0, 90, giveBacks(bolts))).toBe(80);
  });
  it("就绪之后的触发不再算", () => {
    // cd 5: bolts at 1,2,3 pull ready 5 → 2 (bolt at 3 is after ready)
    expect(eventReducedCooldownSeconds(0, 5, giveBacks([1, 2, 3]))).toBe(3);
  });
  it("按下之前的触发不算", () => {
    expect(eventReducedCooldownSeconds(50, 90, giveBacks([10, 20]))).toBe(90);
  });
  it("each trigger gives back its OWN seconds (a round across a dated change)", () => {
    // 4 s at 10 and 20, 2 s at 30 and 40: 90 − 4 − 4 − 2 − 2 = 78
    expect(
      eventReducedCooldownSeconds(0, 90, [
        ...giveBacks([10, 20], 4),
        ...giveBacks([30, 40], 2),
      ]),
    ).toBe(78);
  });
});

describe("cdSecondsUntilReady — 只计 t 之前发生的减 CD", () => {
  const cast = {
    timeSeconds: 0,
    cooldownSecondsOverride: 70,
    reductions: [
      { atSeconds: 60, seconds: 10 },
      { atSeconds: 65, seconds: 10 },
    ],
  };
  const cd = { casts: [cast], cooldownSeconds: 90, neverUsed: false };
  it("t=50:之后的两次尚未发生,剩 40 s(不是 20)", () => {
    expect(cdSecondsUntilReady(cd, 50)).toBeCloseTo(40, 6);
  });
  it("t=62:第一次已发生,剩 90−10−62 = 18 s", () => {
    expect(cdSecondsUntilReady(cd, 62)).toBeCloseTo(18, 6);
  });
  it("可用判定仍按最终就绪时刻 70", () => {
    expect(cdAvailableAt(cd, 69)).toBe(false);
    expect(cdAvailableAt(cd, 70)).toBe(true);
  });
  it("实际回来的秒数(区间下限)算上之后的两次:t=50 剩 20 s", () => {
    expect(cdRealisedSecondsUntilReady(cd, 50)).toBeCloseTo(20, 6);
    expect(cdRealisedSecondsUntilReady(cd, 62)).toBeCloseTo(8, 6);
  });
});

describe("applyEventReductions — 台账与 [RES] 工具条目同一规则(验收 7e2a3c95 #1)", () => {
  it("覆盖值 = 实际就绪 − 按下,reductions = (按下, 就绪) 内的触发", () => {
    const casts: Array<{
      timeSeconds: number;
      cooldownSecondsOverride?: number;
      reductions?: ReadonlyArray<{ atSeconds: number; seconds: number }>;
    }> = [{ timeSeconds: 0 }];
    applyEventReductions(casts, 90, giveBacks([60, 65, 200], 10));
    expect(casts[0]!.cooldownSecondsOverride).toBe(70);
    expect(casts[0]!.reductions).toEqual(giveBacks([60, 65], 10));
  });
  it("已有覆盖值的按下不动", () => {
    const casts = [{ timeSeconds: 0, cooldownSecondsOverride: 50 }];
    applyEventReductions(casts, 90, giveBacks([10], 10));
    expect(casts[0]).toEqual({ timeSeconds: 0, cooldownSecondsOverride: 50 });
  });
  it("事件减 CD 的技能都不吃打断减 CD(resUtilityCds 以条目冷却为起点)", () => {
    const eventTargets = new Set(
      Object.values(EVENT_COOLDOWN_REDUCTIONS).flatMap((r) => r.targets),
    );
    const both = Object.values(ON_INTERRUPT_COOLDOWN_REDUCTIONS)
      .map((r) => r.spellId)
      .filter((id) => eventTargets.has(id));
    expect(both).toEqual([]);
  });
});

describe("cdAvailableAt — 免费再施放窗口(Escape from Reality)", () => {
  it("窗口内未用 → 可用;窗口过后按冷却", () => {
    const cd = {
      casts: [{ timeSeconds: 100, freeRecastUntil: 110 }],
      cooldownSeconds: 45,
      neverUsed: false,
    };
    expect(cdAvailableAt(cd, 105)).toBe(true);
    expect(cdAvailableAt(cd, 120)).toBe(false);
    expect(cdAvailableAt(cd, 145)).toBe(true);
  });
  it("免费那次按了之后,冷却仍锚在开窗那次", () => {
    const cd = {
      casts: [
        { timeSeconds: 100, freeRecastUntil: 110 },
        { timeSeconds: 103, freeRecast: true, cooldownSecondsOverride: 42 },
      ],
      cooldownSeconds: 45,
      neverUsed: false,
    };
    expect(cdAvailableAt(cd, 105)).toBe(false);
    expect(cdAvailableAt(cd, 145)).toBe(true);
  });
});

describe("warpClock — buff 期间冷却加速(batch C)", () => {
  it("×11 窗口 10 s:τ 多走 100 s", () => {
    const { tau, inverse } = warpClock([
      { fromSeconds: 20, toSeconds: 30, mult: 11 },
    ]);
    expect(tau(10)).toBe(10);
    expect(tau(30)).toBe(130);
    expect(tau(40)).toBe(140);
    expect(inverse(130)).toBeCloseTo(30, 5);
  });
  it("单层 90 s:0 按下,20–30 s 加速 ×11 → 实际 26.4 s 就好(r + 10(r−20) = 90)", () => {
    const cd = {
      casts: [{ timeSeconds: 0 }],
      cooldownSeconds: 90,
      neverUsed: false,
      rateWindows: [{ fromSeconds: 20, toSeconds: 30, mult: 11 }],
    };
    expect(cdAvailableAt(cd, 25.5)).toBe(false);
    expect(cdAvailableAt(cd, 29)).toBe(true);
  });
  it("可用判定与剩余秒数取同一时刻(codex 复现:81.4 刚按,81 时不能显示已好)", () => {
    const cd = {
      casts: [{ timeSeconds: 0 }, { timeSeconds: 81.4 }],
      cooldownSeconds: 90,
      neverUsed: false,
      rateWindows: [{ fromSeconds: 80, toSeconds: 81.4, mult: 11 }],
    };
    expect(cdAvailableAt(cd, 81)).toBe(false);
    expect(cdSecondsUntilReady(cd, 81)).toBeGreaterThan(80);
  });
  it("剩余秒数不预支未来的窗口", () => {
    const cd = {
      casts: [{ timeSeconds: 0 }],
      cooldownSeconds: 90,
      neverUsed: false,
      rateWindows: [{ fromSeconds: 50, toSeconds: 60, mult: 11 }],
    };
    expect(cdSecondsUntilReady(cd, 40)).toBeCloseTo(50, 6);
  });
});

describe('eventTriggerTimesMs — one reading of "a trigger happened" (FT F20)', () => {
  const lethal = EVENT_COOLDOWN_REDUCTIONS["1262409"]!;
  const T0 = 1_000_000;
  const row = (
    event: string,
    spellId: string,
    atMs: number,
    extra: Record<string, unknown> = {},
  ) => ({ spellId, logLine: { event, timestamp: T0 + atMs }, ...extra });
  const unit = (o: {
    casts?: unknown[];
    damage?: unknown[];
    misses?: unknown[];
  }) =>
    ({
      spellCastEvents: o.casts ?? [],
      damageOut: o.damage ?? [],
      ...(o.misses ? { missesOut: o.misses } : {}),
    }) as never;
  const seconds = (u: never, r = lethal) =>
    eventTriggerTimesMs(u, r).map((t) => (t - T0) / 1000);

  it("Lethal Calibration is the DB2 row: Boomstick, 2 s per Wildfire Bomb hit, 5 hits a bomb", () => {
    expect(lethal).toMatchObject({
      targets: ["1261193"],
      triggerCastIds: [],
      triggerHitIds: ["265157"],
      maxHitsPerUse: 5,
      seconds: 2,
    });
    // one number for every holder on every day
    for (const spec of ["255", "264", undefined])
      for (const at of [0, AUG_14, AUG_19, Number.NaN])
        expect(eventReductionSecondsAt(lethal, spec, at)).toBe(2);
  });
  it("a cast-triggered talent reads the unit's successful casts only", () => {
    const u = unit({
      casts: [
        row("SPELL_CAST_SUCCESS", "188196", 3000),
        row("SPELL_CAST_START", "188196", 1000),
        row("SPELL_CAST_SUCCESS", "1064", 4000),
        row("SPELL_CAST_SUCCESS", "188443", 2000),
      ],
      damage: [row("SPELL_DAMAGE", "188196", 3400)],
    });
    expect(seconds(u, conduit)).toEqual([2, 3]);
  });
  it("each enemy the explosion hits is a trigger; the bomb's cast and its DoT are not", () => {
    const u = unit({
      casts: [row("SPELL_CAST_SUCCESS", "259495", 10_000)],
      damage: [
        row("SPELL_DAMAGE", "265157", 10_300, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "265157", 10_320, { destUnitId: "e2" }),
        row("SPELL_PERIODIC_DAMAGE", "265157", 11_300),
        row("SPELL_DAMAGE", "269747", 11_300),
      ],
    });
    expect(seconds(u)).toEqual([10.3, 10.32]);
  });
  it("a hit a shield soaked whole counts, an immune target does not", () => {
    const u = unit({
      damage: [row("SPELL_DAMAGE", "265157", 10_300, { destUnitId: "e1" })],
      misses: [
        row("SPELL_MISSED", "265157", 10_310, {
          missType: "ABSORB",
          destUnitId: "e2",
        }),
        row("SPELL_MISSED", "265157", 10_320, {
          missType: "IMMUNE",
          destUnitId: "e3",
        }),
      ],
    });
    expect(seconds(u)).toEqual([10.3, 10.31]);
  });
  it("one bomb credits each unit once — a second row on the same unit is the same enemy (codex 45-FT-101)", () => {
    // Boomstick at 0, one bomb, the same enemy in two rows 10 ms apart (a
    // hit and the part of it a shield soaked): one trigger, not two
    const u = unit({
      damage: [
        row("SPELL_DAMAGE", "265157", 10_000, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "265157", 10_010, { destUnitId: "e1" }),
      ],
      misses: [
        row("SPELL_MISSED", "265157", 10_010, {
          missType: "ABSORB",
          destUnitId: "e1",
        }),
      ],
    });
    expect(seconds(u)).toEqual([10]);
    // the next bomb may credit that unit again
    const two = unit({
      damage: [
        row("SPELL_DAMAGE", "265157", 10_000, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "265157", 12_000, { destUnitId: "e1" }),
      ],
    });
    expect(seconds(two)).toEqual([10, 12]);
    // two bombs a hasted global cooldown apart, the second thrown from
    // closer: impacts 0.8 s apart on one enemy are two uses, both credited
    // (review 40-FT-70 — a 1 s window merged them and dropped the second)
    const hasted = unit({
      damage: [
        row("SPELL_DAMAGE", "265157", 10_050, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "265157", 10_850, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "265157", 11_010, { destUnitId: "e1" }),
      ],
    });
    expect(seconds(hasted)).toEqual([10.05, 10.85]);
    // a row with no destination credits nobody (codex 40-FT-72): Boomstick
    // must not read ready 2 s early on a duplicate row without a target
    const unnamed = unit({
      damage: [
        row("SPELL_DAMAGE", "265157", 10_000, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "265157", 10_010, { destUnitId: "" }),
        row("SPELL_DAMAGE", "265157", 10_020),
      ],
    });
    expect(seconds(unnamed)).toEqual([10]);
    expect(EVENT_HIT_SAME_USE_MS).toBe(300);
  });
  it("at most 5 hits of one bomb count; the next bomb starts a new count", () => {
    const u = unit({
      damage: [
        ...Array.from({ length: 7 }, (_, i) =>
          row("SPELL_DAMAGE", "265157", 10_000 + i * 10, {
            destUnitId: `e${i}`,
          }),
        ),
        row("SPELL_DAMAGE", "265157", 12_000, { destUnitId: "e0" }),
      ],
    });
    expect(seconds(u)).toEqual([10, 10.01, 10.02, 10.03, 10.04, 12]);
  });
  it("Boomstick pressed at 0 with 8 hits before it is back: 45 − 2 × 8 = 29 s", () => {
    const u = unit({
      damage: [5, 5.02, 12, 12.02, 12.04, 20, 20.02, 26].map((s, i) =>
        row("SPELL_DAMAGE", "265157", s * 1000, { destUnitId: `e${i}` }),
      ),
    });
    expect(
      eventReducedCooldownSeconds(
        0,
        45,
        eventTriggersFor(u, [lethal]).map((g) => ({
          atSeconds: (g.atMs - T0) / 1000,
          seconds: g.seconds,
        })),
      ),
    ).toBe(29);
  });
});

describe("Restoration Druid cooldown talents (GH #154)", () => {
  const CONTROL_OF_THE_DREAM = "434249";
  const NATURES_SWIFTNESS = "132158";
  const TREE_OF_LIFE = "33891";
  const holder = (t: string) => t === CONTROL_OF_THE_DREAM;

  it("Control of the Dream: ≤ 15 s on its targets, only for a holder", () => {
    expect(IDLE_COOLDOWN_CREDITS[CONTROL_OF_THE_DREAM]).toMatchObject({
      capSeconds: 15,
    });
    expect(idleCreditCapFor(NATURES_SWIFTNESS, holder)).toBe(15);
    expect(idleCreditCapFor(TREE_OF_LIFE, holder)).toBe(15);
    expect(idleCreditCapFor(NATURES_SWIFTNESS, () => false)).toBe(0);
    expect(idleCreditCapFor("102342", holder)).toBe(0); // Ironbark
  });

  it("the time the spell sat ready comes off the press's cooldown — the whole cap on a round's first press (ready through the preparation phase), then from each ready instant", () => {
    const casts: Array<{
      timeSeconds: number;
      cooldownSecondsOverride?: number;
      idleCreditSeconds?: number;
    }> = [{ timeSeconds: 10 }, { timeSeconds: 60 }, { timeSeconds: 200 }];
    applyEventReductions(casts, 60, [], 15);
    // first press → 45, ready at 55; pressed at 60 → 5 s idle → 55, ready
    // at 115; pressed at 200 → capped at 15
    expect(casts.map((c) => c.cooldownSecondsOverride)).toEqual([45, 55, 45]);
    expect(casts.map((c) => c.idleCreditSeconds)).toEqual([15, 5, 15]);
  });

  it("the credit comes first, the event reductions act on what is left", () => {
    const casts: Array<{
      timeSeconds: number;
      cooldownSecondsOverride?: number;
      reductions?: ReadonlyArray<{ atSeconds: number; seconds: number }>;
      idleCreditSeconds?: number;
    }> = [{ timeSeconds: 20 }];
    applyEventReductions(casts, 180, giveBacks([50, 60, 400], 5), 15);
    expect(casts[0]).toMatchObject({
      cooldownSecondsOverride: 155,
      idleCreditSeconds: 15,
      reductions: giveBacks([50, 60], 5),
    });
    const cd = { casts, cooldownSeconds: 180, neverUsed: false };
    // before either trigger: 20 + 165 − 30 = 155 s away
    expect(cdSecondsUntilReady(cd, 30)).toBeCloseTo(155, 6);
    // after the first: 185 − 5 − 55
    expect(cdSecondsUntilReady(cd, 55)).toBeCloseTo(125, 6);
    expect(cdAvailableAt(cd, 174)).toBe(false);
    expect(cdAvailableAt(cd, 175)).toBe(true);
  });

  it("Cenarius' Guidance: Tree of Life −5 s as each Grove Guardian fades, 8 s after its summon", () => {
    const r = EVENT_COOLDOWN_REDUCTIONS["393371"]!;
    expect(r).toMatchObject({
      targets: [TREE_OF_LIFE],
      triggerSummonIds: ["102693"],
      summonFadeMs: 8000,
      seconds: 5,
    });
    const T0 = 1_000_000;
    const row = (event: string, spellId: string, atMs: number) => ({
      spellId,
      logLine: { event, timestamp: T0 + atMs },
    });
    const u = {
      spellCastEvents: [row("SPELL_CAST_SUCCESS", "102693", 1000)],
      damageOut: [],
      actionOut: [
        row("SPELL_CAST_SUCCESS", "102693", 1000),
        row("SPELL_SUMMON", "102693", 1000),
        row("SPELL_SUMMON", "102693", 12_000),
        row("SPELL_SUMMON", "1232285", 3000), // Efflorescence
      ],
    } as never;
    expect(eventTriggerTimesMs(u, r).map((t) => (t - T0) / 1000)).toEqual([
      9, 20,
    ]);
  });

  it("Call of Ohn'ahra: Nature's Swiftness +30 s in a log before the 2026-09-22 hotfix, +60 s after or undated", () => {
    const row = CD_TALENT_MODIFIERS[NATURES_SWIFTNESS]!.find(
      (m) => m.talentSpellId === "1246126",
    )!;
    // today's number is the generated DB2 row's
    expect(DATED_COOLDOWN_VALUES["1246126"]!.value.since).toBe(row.value);
    const at = (logEpochMs?: number) =>
      applyCdModifiers(
        CD_TALENT_MODIFIERS[NATURES_SWIFTNESS],
        60,
        1,
        new Set(),
        new Set(["1246126"]),
        logEpochMs === undefined ? {} : { logEpochMs },
      ).cooldownSeconds;
    const DAY = 86_400_000;
    expect(at(CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS - 20 * DAY)).toBe(90);
    expect(at(CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS + 14 * DAY)).toBe(120);
    expect(at(undefined)).toBe(120);
    expect(at(Number.NaN)).toBe(120);
  });
});
