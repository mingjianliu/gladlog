import { describe, expect, it } from "vitest";

import {
  auraConsumedTriggers,
  EVENT_COOLDOWN_REDUCTIONS,
  EVENT_HIT_SAME_USE_MS,
  eventReducedCooldownSeconds,
  eventReductionSecondsAt,
  eventTriggersFor,
  eventTriggerTimesMs,
  IDLE_COOLDOWN_CREDITS,
  idleCreditCapFor,
  ON_INTERRUPT_COOLDOWN_REDUCTIONS,
  powerSpendTriggers,
} from "../src/data/talentScriptedCooldowns";
import {
  applyCdModifiers,
  applyEventReductions,
  cdAvailableAt,
  cdRealisedSecondsUntilReady,
  cdSecondsUntilReady,
  chargesAvailableAt,
  chargeStateAt,
  entryAvailabilityTransitions,
  warpClock,
} from "../src/utils/cooldowns";
import {
  CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS,
  CD_TALENT_MODIFIERS,
  DATED_COOLDOWN_VALUES,
  PER_RANK_COOLDOWN_TALENTS,
} from "../src/utils/talentModifiers";
import { talentsOf } from "../src/utils/talents";

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
  it("与按下同一时刻的触发算(Rumbling Earth:Shockwave 自己那 ms 的命中)", () => {
    // 5b724629 r2: 40 s Shockwave, its hits in the press's own ms, 5 s each
    // (≤ 3 counted) → 25 s
    expect(
      eventReducedCooldownSeconds(
        21.844,
        40,
        giveBacks([21.844, 21.844, 21.844], 5),
      ),
    ).toBeCloseTo(25, 6);
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
  it("两层:可用翻转点与可用判定走同一加速时钟(时间膨胀 2026-10-21)", () => {
    // 0 / 1 两次按光两层,20–30 s ×11:第一层 r + 10(r−20) = 90 → 290/11 ≈ 26.36 s 回来
    const cd = {
      spellId: "357170",
      casts: [{ timeSeconds: 0 }, { timeSeconds: 1 }],
      cooldownSeconds: 90,
      charges: 2,
      neverUsed: false,
      rateWindows: [{ fromSeconds: 20, toSeconds: 30, mult: 11 }],
    } as unknown as Parameters<typeof entryAvailabilityTransitions>[0];
    const flips = entryAvailabilityTransitions(cd, 60);
    expect(flips[0]).toEqual({ atSeconds: 1, available: false });
    expect(flips[1]!.available).toBe(true);
    expect(flips[1]!.atSeconds).toBeCloseTo(290 / 11, 6);
    expect(cdAvailableAt(cd, 25.5)).toBe(false);
    expect(cdAvailableAt(cd, 27)).toBe(true);
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
    expect(DATED_COOLDOWN_VALUES["1246126"]!.value!.since).toBe(row.value);
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

describe("event-reduction triggers: interrupts, school casts, per-row hits, minimum hits (cooldown mastery 2026-10-20)", () => {
  const T0 = 1_000_000;
  const row = (
    event: string,
    spellId: string,
    atMs: number,
    extra: Record<string, unknown> = {},
  ) => ({ spellId, logLine: { event, timestamp: T0 + atMs }, ...extra });
  const seconds = (u: never, id: string) =>
    eventTriggerTimesMs(u, EVENT_COOLDOWN_REDUCTIONS[id]!).map(
      (t) => (t - T0) / 1000,
    );

  it("Savage Momentum: the unit's own SPELL_INTERRUPT of Skull Bash's interrupt id", () => {
    const u = {
      spellCastEvents: [row("SPELL_CAST_SUCCESS", "106839", 1000)],
      damageOut: [],
      actionOut: [
        row("SPELL_CAST_SUCCESS", "106839", 1000),
        row("SPELL_INTERRUPT", "93985", 1000),
        row("SPELL_INTERRUPT", "116705", 5000),
      ],
    } as never;
    expect(seconds(u, "205673")).toEqual([1]);
  });

  it("Lunation: every own successful cast of an Arcane-school spell", () => {
    const u = {
      spellCastEvents: [
        row("SPELL_CAST_SUCCESS", "78674", 1000), // Starsurge, Astral
        row("SPELL_CAST_SUCCESS", "190984", 2000), // Wrath, Nature
        row("SPELL_CAST_START", "194153", 2500),
      ],
      damageOut: [],
    } as never;
    expect(seconds(u, "429539")).toEqual([1]);
  });

  it("Spellfrost Teachings: every Frost Splinter row, the same enemy twice included", () => {
    const u = {
      spellCastEvents: [],
      damageOut: [
        row("SPELL_DAMAGE", "443722", 1000, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "443722", 1050, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "444487", 1060, { destUnitId: "e2" }),
      ],
      missesOut: [
        row("SPELL_MISSED", "443722", 1100, {
          destUnitId: "e2",
          missType: "ABSORB",
        }),
        row("SPELL_MISSED", "443722", 1150, {
          destUnitId: "e2",
          missType: "IMMUNE",
        }),
      ],
    } as never;
    expect(seconds(u, "444986")).toEqual([1, 1.05, 1.1]);
  });

  it("Rumbling Earth: one trigger for a Shockwave that struck 3+ units, none for 2", () => {
    const hit = (at: number, dest: string) =>
      row("SPELL_DAMAGE", "46968", at, { destUnitId: dest });
    const u = {
      spellCastEvents: [],
      damageOut: [
        hit(1000, "a"),
        hit(1010, "b"),
        hit(1020, "c"),
        hit(41000, "a"),
        hit(41010, "b"),
      ],
    } as never;
    expect(seconds(u, "275339")).toEqual([1]);
  });
});

describe("power-spend give-backs (Anger Management, Red Thirst, Restless Blades)", () => {
  const T0 = 1_000_000;
  const cast = (
    spellId: string,
    atMs: number,
    costs?: Array<[number, number]>,
  ) => ({
    spellId,
    logLine: { event: "SPELL_CAST_SUCCESS", timestamp: T0 + atMs },
    ...(costs
      ? { powerCosts: costs.map(([type, cost]) => ({ type, cost })) }
      : {}),
  });
  const aura = (spellId: string, event: string, atMs: number) => ({
    spellId,
    logLine: { event, timestamp: T0 + atMs },
  });
  const am = EVENT_COOLDOWN_REDUCTIONS["152278"]!.triggerPowerSpend!;

  it("Arms: spent Rage ÷ 20, Ignore Pain is no attack, a row without a cost gives nothing", () => {
    const u = {
      spellCastEvents: [
        cast("12294", 1000, [[1, 300]]), // Mortal Strike, 30 Rage
        cast("190456", 2000, [[1, 400]]), // Ignore Pain
        cast("1464", 3000), // Slam, no cost stated
      ],
    } as never;
    expect(
      powerSpendTriggers(u, am, "71", () => false).map((g) => g.seconds),
    ).toEqual([1.5]);
  });

  it("Fury gives back 1 s per 10 Rage; Rampaging Berserker's −15 Rage only during Recklessness, only for a holder", () => {
    const u = {
      spellCastEvents: [
        cast("184367", 1000, [[1, 800]]),
        cast("184367", 5000, [[1, 800]]),
      ],
      auraEvents: [
        aura("1719", "SPELL_AURA_APPLIED", 4000),
        aura("1719", "SPELL_AURA_REMOVED", 9000),
      ],
    } as never;
    const holder = (t: string) => t === "1269309";
    expect(
      powerSpendTriggers(u, am, "72", holder).map((g) => g.seconds),
    ).toEqual([8, 6.5]);
    expect(
      powerSpendTriggers(u, am, "72", () => false).map((g) => g.seconds),
    ).toEqual([8, 8]);
  });

  it("Battlelord: the Mortal Strike that consumes the buff (removed at the cast) costs a third less", () => {
    const u = {
      spellCastEvents: [cast("12294", 2000, [[1, 300]])],
      auraEvents: [
        aura("386631", "SPELL_AURA_APPLIED", 1000),
        aura("386631", "SPELL_AURA_REMOVED", 2000),
      ],
    } as never;
    expect(
      powerSpendTriggers(u, am, "71", () => false)[0]!.seconds,
    ).toBeCloseTo((300 * 0.67) / 200, 6);
  });

  it("Restless Blades is an Outlaw baseline: 0.8 s per combo point", () => {
    const r = EVENT_COOLDOWN_REDUCTIONS["79096"]!;
    expect(r.ownedBySpecIds).toEqual(["260"]);
    const u = {
      spellCastEvents: [
        cast("315341", 1000, [
          [3, 25],
          [4, 6],
        ]),
      ],
    } as never;
    expect(
      powerSpendTriggers(u, r.triggerPowerSpend!, "260")[0]!.seconds,
    ).toBeCloseTo(4.8, 6);
  });
});

describe("Unrelenting Onslaught: Sudden Death used × Executioner stacks", () => {
  const T0 = 1_000_000;
  const ev = (
    event: string,
    spellId: string,
    atMs: number,
    amount?: number,
  ) => ({
    spellId,
    logLine: { event, timestamp: T0 + atMs },
    ...(amount !== undefined ? { amount } : {}),
  });
  const r = EVENT_COOLDOWN_REDUCTIONS["444780"]!;
  it("a use with 2 stacks gives 10 s; an expiry gives nothing; a stack gained at the use itself is not counted", () => {
    const u = {
      spellCastEvents: [
        ev("SPELL_CAST_SUCCESS", "163201", 10_000),
        ev("SPELL_CAST_SUCCESS", "163201", 30_000),
      ],
      auraEvents: [
        ev("SPELL_AURA_APPLIED", "445584", 1000),
        ev("SPELL_AURA_APPLIED_DOSE", "445584", 2000, 2),
        ev("SPELL_AURA_APPLIED", "52437", 9000),
        ev("SPELL_AURA_REMOVED", "52437", 10_050), // used by the 10 s Execute
        ev("SPELL_AURA_APPLIED", "52437", 15_000),
        ev("SPELL_AURA_REMOVED", "52437", 25_000), // expired: no Execute near
        ev("SPELL_AURA_REMOVED", "445584", 26_000),
        ev("SPELL_AURA_APPLIED", "52437", 29_000),
        ev("SPELL_AURA_APPLIED", "445584", 30_000), // same instant: not before
        ev("SPELL_AURA_REMOVED", "52437", 30_000), // used, 0 stacks before
      ],
    } as never;
    expect(
      auraConsumedTriggers(u, r).map((g) => [(g.atMs - T0) / 1000, g.seconds]),
    ).toEqual([[10.05, 10]]);
  });
});

describe("charge simulation with per-press effects (IChargeEffects)", () => {
  it("a give-back pulls in the charge recharging; at full charges it does nothing", () => {
    // 2 charges / 30 s: presses at 0 and 1 → both spent, first back at 30
    const casts = [0, 1];
    expect(chargesAvailableAt(casts, 30, 2, 25)).toBe(0);
    // a 2.5 s give-back at 10 and at 20 → first charge back at 25
    const effects = {
      reductions: [
        { atSeconds: 10, seconds: 2.5 },
        { atSeconds: 20, seconds: 2.5 },
      ],
    };
    expect(chargesAvailableAt(casts, 30, 2, 24.9, effects)).toBe(0);
    expect(chargesAvailableAt(casts, 30, 2, 25, effects)).toBe(1);
    // a give-back while full is lost
    expect(
      chargeStateAt([50], 30, 2, 50, {
        reductions: [{ atSeconds: 40, seconds: 10 }],
      }).nextRecharge,
    ).toBe(80);
  });

  it("idle credit: the time at full charges (from the round's start) comes off the recharge a press starts, ≤ cap", () => {
    // full since the start: a press at 40 gets the whole 15
    expect(
      chargeStateAt([40], 120, 2, 40, { idleCapSeconds: 15 }).nextRecharge,
    ).toBe(145);
    // second charge spent while the first recharges: no new timer, no credit
    expect(
      chargeStateAt([40, 41], 120, 2, 41, { idleCapSeconds: 15 }).nextRecharge,
    ).toBe(145);
  });
});

describe("hotfix-dated talent numbers (cooldown mastery 2026-10-20)", () => {
  const DAY = 86_400_000;
  const AUG17 = Date.UTC(2026, 7, 17, 12);
  const OCT10 = Date.UTC(2026, 9, 10, 12);
  const cd = (
    target: string,
    base: number,
    talents: string[],
    specId: string,
    logEpochMs: number,
    ranks: Array<[string, number]> = [],
  ) =>
    applyCdModifiers(
      CD_TALENT_MODIFIERS[target],
      base,
      1,
      new Set(talents),
      new Set(),
      { specId, logEpochMs, talentRanks: new Map(ranks) },
    ).cooldownSeconds;

  it("where DB2 has the change, today's dated number is the generated one", () => {
    const row = (target: string, talent: string) =>
      CD_TALENT_MODIFIERS[target]!.find(
        (m) => m.talentSpellId === talent && m.effect === "reduce_cd",
      )!;
    expect(DATED_COOLDOWN_VALUES["424654"]!.bySpec!["71"]!.since).toBe(
      row("3411", "424654").valueBySpec!["71"]![0],
    );
    expect(DATED_COOLDOWN_VALUES["382424"]!.value!.since).toBe(
      row("45438", "382424").valueByRank![0],
    );
    expect(DATED_COOLDOWN_VALUES["1244025"]!.value!.since).toBe(
      row("55342", "1244025").valueByRank![0],
    );
  });

  it("Retribution's Blessing of Sacrifice: 60 s before the 2026-08-18 hotfix, 90 s after; Holy 105 either side", () => {
    expect(cd("6940", 120, ["384820"], "70", AUG17)).toBe(60);
    expect(cd("6940", 120, ["384820"], "70", OCT10)).toBe(90);
    expect(cd("6940", 120, ["384820"], "70", Number.NaN)).toBe(90);
    expect(cd("6940", 120, ["384820"], "65", AUG17)).toBe(105);
    expect(cd("6940", 120, ["384820"], "65", OCT10)).toBe(105);
    // Protection's hotfix came a week later
    expect(cd("6940", 120, ["384820"], "66", AUG17 + 5 * DAY)).toBe(60);
    expect(cd("6940", 120, ["384820"], "66", OCT10)).toBe(90);
  });

  it("Retribution's Divine Protection with Unbreakable Spirit: 63 s before the hotfix, 72 s after", () => {
    // base 60 + Retribution's spec passive +30 = 90, × 0.7 / × 0.8
    expect(cd("403876", 60, ["114154"], "70", AUG17)).toBe(63);
    expect(cd("403876", 60, ["114154"], "70", OCT10)).toBe(72);
  });

  it("Winter's Protection rank 2: −60 s before the 2026-09-01 hotfix, −30 after", () => {
    const ranks: Array<[string, number]> = [["382424", 2]];
    expect(cd("45438", 240, ["382424"], "62", AUG17, ranks)).toBe(180);
    expect(cd("45438", 240, ["382424"], "62", OCT10, ranks)).toBe(210);
  });
});

describe("12.1.0 talent map: entries whose definition traded spells at 12.1.5", () => {
  const ev = (ms: number) => ({ logLine: { timestamp: ms } });
  const talents = [
    { id1: 103900, id2: 103733, count: 1 }, // 12.1.0: Ultimate Serenity
    { id1: 82612, id2: 103745, count: 1 }, // 12.1.0: Holy Celerity
    { id1: 1, id2: 2, count: 1 },
  ];
  it("an August log has the two Holy Priest entries swapped; a log after 12.1.5, or undated, reads them as they are", () => {
    const aug = {
      info: { talents },
      spellCastEvents: [ev(Date.UTC(2026, 7, 15))],
    };
    expect(talentsOf(aug)).toEqual([
      { id1: 82612, id2: 103745, count: 1 },
      { id1: 103900, id2: 103733, count: 1 },
      { id1: 1, id2: 2, count: 1 },
    ]);
    const oct = {
      info: { talents },
      spellCastEvents: [ev(Date.UTC(2026, 9, 16))],
    };
    expect(talentsOf(oct)).toBe(talents);
    expect(talentsOf({ info: { talents } })).toBe(talents);
  });
});

describe("credit bonuses: Apotheosis ×3, Light of the Naaru +10 % a rank", () => {
  const T0 = 1_000_000;
  const ev = (event: string, spellId: string, atMs: number) => ({
    spellId,
    logLine: { event, timestamp: T0 + atMs },
  });
  it("a Smite gives 4 s, 12 s under Apotheosis, + 20 % at Light of the Naaru rank 2", () => {
    const u = {
      spec: "257",
      spellCastEvents: [
        ev("SPELL_CAST_SUCCESS", "585", 1000),
        ev("SPELL_CAST_SUCCESS", "585", 6000),
      ],
      damageOut: [],
      auraEvents: [
        ev("SPELL_AURA_APPLIED", "200183", 5000),
        ev("SPELL_AURA_REMOVED", "200183", 25_000),
      ],
    } as never;
    const r = [EVENT_COOLDOWN_REDUCTIONS["63733"]!];
    expect(eventTriggersFor(u, r).map((g) => g.seconds)).toEqual([4, 12]);
    expect(
      eventTriggersFor(u, r, undefined, (t) => (t === "196985" ? 2 : 0)).map(
        (g) => Math.round(g.seconds * 100) / 100,
      ),
    ).toEqual([4.8, 12.8]);
  });
});
