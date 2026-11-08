import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  auraConsumedTriggers,
  buffedUseTargetTriggers,
  EVENT_COOLDOWN_REDUCTIONS,
  EVENT_HIT_SAME_USE_MS,
  eventReducedCooldownSeconds,
  eventReductionSecondsAt,
  eventReductionsFor,
  eventTriggersFor,
  eventTriggerTimesMs,
  FREE_RECAST_WINDOWS,
  IDLE_COOLDOWN_CREDITS,
  idleCreditCapFor,
  ON_INTERRUPT_COOLDOWN_REDUCTIONS,
  ownAuraEndTimesMs,
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
  freeRecastWindowEndSeconds,
  warpClock,
} from "../src/utils/cooldowns";
import {
  CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS,
  CD_TALENT_MODIFIERS,
  DATED_COOLDOWN_VALUES,
  HOTFIX_2026_10_06_EPOCH_MS,
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

describe("Wingleader — a Mass Disintegrate's targets take Deep Breath's cooldown down (fact8 class 1)", () => {
  const T = 1_000_000;
  const cast = (id: string, s: number) => ({
    spellId: id,
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: T + s * 1000,
    },
  });
  const aura = (event: LogEvent, s: number) => ({
    spellId: "436336",
    logLine: { event, timestamp: T + s * 1000 },
  });
  const dmg = (dest: string, s: number) => ({
    spellId: "356995",
    destUnitId: dest,
    logLine: {
      event: LogEvent.SPELL_PERIODIC_DAMAGE,
      timestamp: T + s * 1000,
    },
  });
  const wingleader = EVENT_COOLDOWN_REDUCTIONS["441206"]!;
  const unit = (over: object = {}) =>
    ({
      spellCastEvents: [cast("356995", 10), cast("356995", 20)],
      auraEvents: [aura(LogEvent.SPELL_AURA_REMOVED, 10.01)],
      damageOut: [
        dmg("a", 10.5),
        dmg("a", 11),
        dmg("b", 11),
        dmg("pet", 11.5),
        dmg("a", 20.5), // the next, plain Disintegrate
      ],
      missesOut: [],
      ...over,
    }) as never;

  it("one trigger per distinct unit of the buffed use, none for a plain one", () => {
    expect(
      buffedUseTargetTriggers(unit(), wingleader).map((g) => g.atMs),
    ).toEqual([T + 10_500, T + 11_000, T + 11_500]);
  });
  it("a miss on another unit is a target struck, a row with no destination is not", () => {
    expect(
      buffedUseTargetTriggers(
        unit({
          damageOut: [dmg("a", 10.5), dmg("", 10.6)],
          missesOut: [dmg("b", 11)],
        }),
        wingleader,
      ).map((g) => g.atMs),
    ).toEqual([T + 10_500, T + 11_000]);
  });
  it("an expired buff is no use: nothing was consumed beside the cast", () => {
    expect(
      buffedUseTargetTriggers(
        unit({ auraEvents: [aura(LogEvent.SPELL_AURA_REMOVED, 15)] }),
        wingleader,
      ),
    ).toEqual([]);
  });
  it("the use ends at the next cast of the channel", () => {
    expect(
      buffedUseTargetTriggers(
        unit({
          spellCastEvents: [cast("356995", 10), cast("356995", 11)],
          damageOut: [dmg("a", 10.5), dmg("b", 11.4)],
        }),
        wingleader,
      ).map((g) => g.atMs),
    ).toEqual([T + 10_500]);
  });
});

describe("Wingleader — a Mass Eruption's targets take Breath of Eons's cooldown down (fact10 D1 / D16)", () => {
  const T = 1_000_000;
  const row = EVENT_COOLDOWN_REDUCTIONS["441206:eons"]!;
  const ev = (event: LogEvent, spellId: string, s: number, dest?: string) => ({
    spellId,
    destUnitId: dest,
    logLine: { event, timestamp: T + s * 1000 },
  });
  const unit = (over: object = {}) =>
    ({
      spellCastEvents: [
        ev(LogEvent.SPELL_CAST_SUCCESS, "395160", 10),
        ev(LogEvent.SPELL_CAST_SUCCESS, "395160", 20),
      ],
      auraEvents: [ev(LogEvent.SPELL_AURA_REMOVED_DOSE, "438588", 10.01)],
      damageOut: [
        ev(LogEvent.SPELL_DAMAGE, "395160", 10.1, "a"),
        ev(LogEvent.SPELL_DAMAGE, "438653", 10.1, "b"),
        ev(LogEvent.SPELL_DAMAGE, "395160", 10.3, "a"), // a later wave: same unit
        ev(LogEvent.SPELL_DAMAGE, "438653", 10.3, "pet"),
        ev(LogEvent.SPELL_DAMAGE, "395160", 20.1, "c"), // the next, plain Eruption
      ],
      missesOut: [],
      ...over,
    }) as never;

  it("the row is Breath of Eons's, 1.5 s per target, keyed on Wingleader", () => {
    expect(row.talentSpellId).toBe("441206");
    expect(row.targets).toEqual(["403631"]);
    expect(row.seconds).toBe(1.5);
  });
  it("one trigger per distinct unit Eruption or its extra-target row reached, none for a plain Eruption", () => {
    expect(buffedUseTargetTriggers(unit(), row).map((g) => g.atMs)).toEqual([
      T + 10_100,
      T + 10_100,
      T + 10_300,
    ]);
  });
  it("an Eruption that consumed no Mass Eruption is no use", () => {
    expect(
      buffedUseTargetTriggers(
        unit({ auraEvents: [ev(LogEvent.SPELL_AURA_REMOVED, "438588", 15)] }),
        row,
      ),
    ).toEqual([]);
  });
});

describe("freeRecastWindowEndSeconds — Death's Arrival's window is its aura's life (GH #179 batch 3c)", () => {
  const START = 1_000_000;
  const row = (
    event: LogEvent,
    s: number,
    spellId = "457343",
    dest = "me",
  ) => ({
    spellId,
    destUnitId: dest,
    timestamp: START + s * 1000,
    logLine: { event },
  });
  const unit = (auraEvents: unknown[]) =>
    ({ id: "me", auraEvents }) as unknown as Parameters<
      typeof freeRecastWindowEndSeconds
    >[0];
  const w = FREE_RECAST_WINDOWS["454433"]!;

  it("the table names the aura", () => {
    expect(w).toMatchObject({
      spellId: "195457",
      windowS: 3,
      windowAuraId: "457343",
    });
  });
  it("consumed by the free press 2.43 s into the aura, 3.09 s after the press (8c70dc85)", () => {
    const u = unit([
      row(LogEvent.SPELL_AURA_APPLIED, 100.658),
      row(LogEvent.SPELL_AURA_REMOVED, 103.085),
    ]);
    expect(freeRecastWindowEndSeconds(u, w, 100, START)).toBeCloseTo(
      103.085,
      6,
    );
  });
  it("an unused aura expiring 3 s after its APPLIED ends the window there", () => {
    const u = unit([
      row(LogEvent.SPELL_AURA_APPLIED, 100.6),
      row(LogEvent.SPELL_AURA_REMOVED, 103.61),
    ]);
    expect(freeRecastWindowEndSeconds(u, w, 100, START)).toBeCloseTo(103.61, 6);
  });
  it("no REMOVED logged: windowS after the APPLIED", () => {
    const u = unit([row(LogEvent.SPELL_AURA_APPLIED, 100.7)]);
    expect(freeRecastWindowEndSeconds(u, w, 100, START)).toBeCloseTo(103.7, 6);
  });
  it("a later instance's REMOVED in the same ms, logged after its APPLIED, is not this one's end (codex 3c round 2 #3)", () => {
    const u = unit([
      row(LogEvent.SPELL_AURA_APPLIED, 100.6),
      row(LogEvent.SPELL_AURA_APPLIED, 104.4),
      row(LogEvent.SPELL_AURA_REMOVED, 104.4),
    ]);
    expect(freeRecastWindowEndSeconds(u, w, 100, START)).toBeCloseTo(103.6, 6);
  });
  it("a later instance's REMOVED is not this one's end (codex 3c #2)", () => {
    const u = unit([
      row(LogEvent.SPELL_AURA_APPLIED, 100.6),
      row(LogEvent.SPELL_AURA_APPLIED, 104.4),
      row(LogEvent.SPELL_AURA_REMOVED, 104.5),
    ]);
    expect(freeRecastWindowEndSeconds(u, w, 100, START)).toBeCloseTo(103.6, 6);
  });
  it("a REMOVED long past the aura's duration is not its end", () => {
    const u = unit([
      row(LogEvent.SPELL_AURA_APPLIED, 100.7),
      row(LogEvent.SPELL_AURA_REMOVED, 110),
    ]);
    expect(freeRecastWindowEndSeconds(u, w, 100, START)).toBeCloseTo(103.7, 6);
  });
  it("never shorter than windowS from the press", () => {
    const u = unit([
      row(LogEvent.SPELL_AURA_APPLIED, 100.5),
      row(LogEvent.SPELL_AURA_REMOVED, 101),
    ]);
    expect(freeRecastWindowEndSeconds(u, w, 100, START)).toBe(103);
  });
  it("no aura, an aura before the press, an APPLIED later than windowS, another unit's or another id: windowS from the press", () => {
    for (const ev of [
      [],
      [
        row(LogEvent.SPELL_AURA_APPLIED, 99.9),
        row(LogEvent.SPELL_AURA_REMOVED, 103.5),
      ],
      [
        row(LogEvent.SPELL_AURA_APPLIED, 103.2),
        row(LogEvent.SPELL_AURA_REMOVED, 106),
      ],
      [
        row(LogEvent.SPELL_AURA_APPLIED, 100.6, "457343", "ally"),
        row(LogEvent.SPELL_AURA_REMOVED, 103.6, "457343", "ally"),
      ],
      [
        row(LogEvent.SPELL_AURA_APPLIED, 100.6, "457333"),
        row(LogEvent.SPELL_AURA_REMOVED, 103.6, "457333"),
      ],
    ])
      expect(freeRecastWindowEndSeconds(unit(ev), w, 100, START)).toBe(103);
  });
  it("a window with no aura stays windowS from the press", () => {
    const u = unit([
      row(LogEvent.SPELL_AURA_APPLIED, 100.6),
      row(LogEvent.SPELL_AURA_REMOVED, 103.6),
    ]);
    expect(
      freeRecastWindowEndSeconds(u, FREE_RECAST_WINDOWS["394110"]!, 100, START),
    ).toBe(110);
  });
});

describe("a free press with event reductions stands on the opener's clock", () => {
  it("the static reading counts from the opener, its triggers included (Deep Breath)", () => {
    const reductions = [{ atSeconds: 105, seconds: 5 }];
    const cd = {
      casts: [
        { timeSeconds: 100, freeRecastUntil: 118, reductions },
        {
          timeSeconds: 108,
          freeRecast: true,
          freeRecastOf: 100,
          cooldownSecondsOverride: 47,
          reductions,
        },
      ],
      cooldownSeconds: 60,
      neverUsed: false,
    };
    // back at 160 − 5 = 155: 47 s from the free press, not 60 − 5
    expect(cdSecondsUntilReady(cd, 108)).toBe(47);
    expect(cdAvailableAt(cd, 154)).toBe(false);
    expect(cdAvailableAt(cd, 156)).toBe(true);
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

describe("ownAuraEndTimesMs — an own aura's end the log left out (GH #179 batch 3c)", () => {
  const T0 = 1_000_000;
  const row = (event: LogEvent, spellId: string, s: number, dest = "me") => ({
    spellId,
    srcUnitId: "me",
    destUnitId: dest,
    logLine: { event, timestamp: T0 + s * 1000 },
  });
  const ends = (
    actionOut: unknown[],
    auraEvents?: unknown[],
    roundEndS: number | null = 1000,
  ) =>
    ownAuraEndTimesMs(
      { id: "me", actionOut, auraEvents } as unknown as Parameters<
        typeof ownAuraEndTimesMs
      >[0],
      ["11426", "342246"],
      roundEndS === null ? undefined : T0 + roundEndS * 1000,
    ).map((t) => (t - T0) / 1000);
  const A = LogEvent.SPELL_AURA_APPLIED;
  const R = LogEvent.SPELL_AURA_REMOVED;
  const F = LogEvent.SPELL_AURA_REFRESH;

  it("logged ends are read as before, the stolen copy's too", () => {
    expect(
      ends([
        row(A, "11426", 10),
        row(R, "11426", 20),
        row(F, "11426", 40, "thief"),
      ]),
    ).toEqual([20, 40]);
  });
  it("re-applied with no end row: the earlier one ended at the APPLIED", () => {
    expect(
      ends([row(A, "11426", 10), row(A, "11426", 35), row(R, "11426", 50)]),
    ).toEqual([35, 50]);
  });
  it("…no later than its duration after its own APPLIED", () => {
    expect(
      ends([row(A, "342246", 10), row(A, "342246", 70), row(R, "342246", 75)]),
    ).toEqual([20, 75]);
  });
  it("the last one with no end row: its duration after the APPLIED, inside the round (codex 3c #3)", () => {
    // d510865c r5 shape: a stolen Alter Time never REMOVED, the round going on
    expect(ends([row(A, "342246", 10)], undefined, 100)).toEqual([20]);
    // the round over first, the unit's rows going on after it: no end
    expect(
      ends(
        [row(A, "342246", 10.4), row(A, "212653", 20.6, "enemy")],
        undefined,
        20.1,
      ),
    ).toEqual([]);
  });
  it("no round end given: the logged end rows only", () => {
    expect(
      ends(
        [row(A, "11426", 10), row(A, "11426", 35), row(R, "11426", 50)],
        undefined,
        null,
      ),
    ).toEqual([50]);
  });
  it("an end inferred at the next APPLIED stays inside the round", () => {
    expect(
      ends([row(A, "11426", 10), row(A, "11426", 35)], undefined, 30),
    ).toEqual([]);
  });
  it("a REFRESH ends one and opens the next", () => {
    expect(
      ends([
        row(A, "11426", 10),
        row(F, "11426", 20),
        row(A, "11426", 50),
        row(A, "212653", 200, "enemy"),
      ]),
    ).toEqual([20, 50, 110]);
  });
  it("a REMOVED right after its own APPLIED in the same ms is that aura's, not the one before (codex 3c #1)", () => {
    expect(
      ends([
        row(A, "11426", 0),
        row(R, "11426", 5),
        row(A, "11426", 10),
        row(R, "11426", 10),
        row(A, "11426", 20),
        row(R, "11426", 21),
      ]),
    ).toEqual([5, 10, 21]);
  });
  it("a recast logged APPLIED first: the same-ms REMOVED / REFRESH is the old one's end, read once (codex 3c round 2 #2)", () => {
    expect(
      ends([
        row(A, "11426", 10),
        row(A, "11426", 30),
        row(R, "11426", 30),
        row(R, "11426", 45),
      ]),
    ).toEqual([30, 45]);
    expect(
      ends([
        row(A, "11426", 0),
        row(A, "11426", 10),
        row(F, "11426", 10),
        row(R, "11426", 15),
      ]),
    ).toEqual([10, 15]);
  });
  it("an open one already past its duration ended then; the same-ms REMOVED is the new one's (codex 3c round 3)", () => {
    expect(
      ends(
        [row(A, "342246", 0), row(A, "342246", 70), row(R, "342246", 70)],
        undefined,
        200,
      ),
    ).toEqual([10, 70]);
  });
  it("an APPLIED in a re-state batch is the same aura still up", () => {
    const batch = Array.from({ length: 6 }, (_, i) => ({
      spellId: String(900000 + i),
      destUnitId: "me",
      timestamp: T0 + 30_000,
      logLine: { event: A, timestamp: T0 + 30_000 },
    }));
    expect(
      ends(
        [row(A, "11426", 10), row(A, "11426", 30), row(R, "11426", 45)],
        batch,
      ),
    ).toEqual([45]);
    // without the batch the same rows end it at 30
    expect(
      ends([row(A, "11426", 10), row(A, "11426", 30), row(R, "11426", 45)], []),
    ).toEqual([30, 45]);
  });
  it("another unit's copy and other ids synthesize nothing", () => {
    expect(
      ends([
        row(A, "11426", 10, "ally"),
        row(A, "11426", 30, "ally"),
        row(A, "1953", 10),
      ]),
    ).toEqual([]);
  });
  it("a unit with no id reads the logged rows only", () => {
    expect(
      ownAuraEndTimesMs(
        { actionOut: [row(A, "11426", 10), row(A, "11426", 30)] } as never,
        ["11426"],
      ),
    ).toEqual([]);
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
  // the PvP talent that replaces Tree of Life; both scripts follow the slot
  const ANCIENT_OF_LORE = "473909";
  const holder = (t: string) => t === CONTROL_OF_THE_DREAM;

  it("Control of the Dream: ≤ 15 s on its targets, only for a holder", () => {
    expect(IDLE_COOLDOWN_CREDITS[CONTROL_OF_THE_DREAM]).toMatchObject({
      capSeconds: 15,
    });
    expect(idleCreditCapFor(NATURES_SWIFTNESS, holder)).toBe(15);
    expect(idleCreditCapFor(TREE_OF_LIFE, holder)).toBe(15);
    expect(idleCreditCapFor(ANCIENT_OF_LORE, holder)).toBe(15);
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
      targets: [TREE_OF_LIFE, ANCIENT_OF_LORE],
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

  it("GH #157: Improved Mass Dispel and Call of Al'Akir read their old, longer cooldown before the 2026-10-06 hotfix and in an undated log", () => {
    const DAY = 86_400_000;
    const cases: Array<[string, string, number, number, number]> = [
      // talent, spell, base, before → cooldown, since → cooldown
      ["426438", "32375", 120, 60, 45],
      ["1246131", "378081", 60, 90, 80],
    ];
    for (const [talent, spell, base, before, since] of cases) {
      const mods = CD_TALENT_MODIFIERS[spell]!;
      const row = mods.find((m) => m.talentSpellId === talent)!;
      // today's number is the generated DB2 row's
      expect(DATED_COOLDOWN_VALUES[talent]!.value!.since, talent).toBe(
        row.value,
      );
      const at = (logEpochMs?: number) =>
        applyCdModifiers(
          mods,
          base,
          1,
          new Set(),
          new Set([talent]),
          logEpochMs === undefined ? {} : { logEpochMs },
        ).cooldownSeconds;
      expect(at(HOTFIX_2026_10_06_EPOCH_MS - 7 * DAY), talent).toBe(before);
      expect(at(HOTFIX_2026_10_06_EPOCH_MS + 2 * DAY), talent).toBe(since);
      expect(at(undefined), talent).toBe(before);
      expect(at(Number.NaN), talent).toBe(before);
    }
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

  it("White Out (fact12 D17): 0.5 s each Ice Lance hit, 0.1 s each Freezing stack its or Shatter's hit took off", () => {
    const aura = (event: string, atMs: number, dest: string, n?: number) =>
      row(event, "1221389", atMs, {
        destUnitId: dest,
        logLine: {
          event,
          timestamp: T0 + atMs,
          parameters: n === undefined ? ["DEBUFF"] : ["DEBUFF", n],
        },
      });
    const u = {
      spellCastEvents: [row("SPELL_CAST_SUCCESS", "30455", 1000)],
      damageOut: [
        // Splitting Ice: one cast, two hits
        row("SPELL_DAMAGE", "228598", 1500, { destUnitId: "e1" }),
        row("SPELL_DAMAGE", "228598", 1510, { destUnitId: "e2" }),
        row("SPELL_DAMAGE", "1246949", 1500, { destUnitId: "e1" }),
      ],
      missesOut: [],
      actionOut: [
        aura("SPELL_AURA_APPLIED", 200, "e1"),
        aura("SPELL_AURA_APPLIED_DOSE", 300, "e1", 6),
        aura("SPELL_AURA_REMOVED_DOSE", 1500, "e1", 2), // shattered 4
        aura("SPELL_AURA_APPLIED", 400, "e2"),
        aura("SPELL_AURA_APPLIED_DOSE", 450, "e2", 3),
        aura("SPELL_AURA_REMOVED", 1510, "e2"), // shattered 3
        aura("SPELL_AURA_APPLIED", 2000, "e3"),
        aura("SPELL_AURA_APPLIED_DOSE", 2100, "e3", 5),
        aura("SPELL_AURA_REMOVED", 9000, "e3"), // ran out: no hit, nothing
      ],
    } as never;
    const trig = eventTriggersFor(u, [
      EVENT_COOLDOWN_REDUCTIONS["1281638"]!,
      EVENT_COOLDOWN_REDUCTIONS["1281638:shatter"]!,
    ]);
    const total = trig.reduce((s, g) => s + g.seconds, 0);
    expect(
      trig.filter((g) => g.seconds === 0.5).map((g) => g.atMs - T0),
    ).toEqual([1500, 1510]);
    expect(trig.filter((g) => g.seconds === 0.1)).toHaveLength(7);
    expect(total).toBeCloseTo(1.7, 6);
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

  it("Restless Blades is an Outlaw baseline: 1.0 s per combo point (the dummy's base; the PvP multiplier does not reach the script)", () => {
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
    ).toBeCloseTo(6, 6);
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

  it("a give-back past the charge recharging carries into the next one (GH #176)", () => {
    // 2 charges / 30 s, both spent at 0 and 1: the first recharges until 30.
    // At 25, a 10 s give-back: 5 s finishes the first charge, the other 5 s
    // come off the second, which runs 25 → 55 − 5 = 50.
    const s = chargeStateAt([0, 1], 30, 2, 25, {
      reductions: [{ atSeconds: 25, seconds: 10 }],
    });
    expect(s.charges).toBe(1);
    expect(s.nextRecharge).toBe(50);
    // a give-back that fills both: the rest is lost, full at 25
    expect(
      chargeStateAt([0, 1], 30, 2, 25, {
        reductions: [{ atSeconds: 25, seconds: 60 }],
      }),
    ).toEqual({ charges: 2, nextRecharge: Number.POSITIVE_INFINITY });
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

// GH #176 (2026-11-02): Holy Word: Serenity / Sanctify get the give-backs
// their tooltips state — an off-list press line needs their cooldown
describe("Holy Word: Serenity / Sanctify give-backs (GH #176)", () => {
  const T0 = 1_000_000;
  const ev = (event: string, spellId: string, atMs: number) => ({
    spellId,
    logLine: { event, timestamp: T0 + atMs },
  });
  const holding =
    (...talents: string[]) =>
    (t: string) =>
      talents.includes(t);
  const owners = (spellId: string, holds: (t: string) => boolean) =>
    eventReductionsFor(spellId, holds, "257").map((r) => r.note);

  it("Serendipity is a Holy passive: Flash Heal → Serenity, Prayer of Healing → Sanctify", () => {
    expect(owners("2050", holding())).toEqual([
      expect.stringContaining("Flash Heal / Benediction"),
    ]);
    expect(owners("34861", holding())).toEqual([
      expect.stringContaining("Prayer of Healing"),
    ]);
    expect(eventReductionsFor("2050", holding(), "256")).toEqual([]);
  });

  it("Ultimate Serenity moves Prayer of Healing, Halo and Energy Cycle to Serenity", () => {
    const all = holding("390994", "453828", "1246517");
    expect(owners("34861", all)).toEqual([]);
    expect(owners("2050", all)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Prayer of Healing: Holy Word: Serenity"),
        expect.stringContaining("Halo: Holy Word: Serenity"),
        expect.stringContaining("Surge of Light spent: Holy Word: Serenity"),
        expect.stringContaining("Prayer of Mending"),
      ]),
    );
    const none = holding("390994", "453828");
    expect(owners("34861", none)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Halo: Holy Word: Sanctify"),
        expect.stringContaining("Surge of Light spent: Holy Word: Sanctify"),
      ]),
    );
  });

  it("a Flash Heal gives Serenity 6 s, 18 s under Apotheosis", () => {
    const u = {
      spec: "257",
      spellCastEvents: [
        ev("SPELL_CAST_SUCCESS", "2061", 1000),
        ev("SPELL_CAST_SUCCESS", "1262763", 6000),
      ],
      damageOut: [],
      auraEvents: [
        ev("SPELL_AURA_APPLIED", "200183", 5000),
        ev("SPELL_AURA_REMOVED", "200183", 25_000),
      ],
    } as never;
    const r = eventReductionsFor("2050", holding(), "257");
    expect(eventTriggersFor(u, r).map((g) => g.seconds)).toEqual([6, 18]);
  });

  it("Apotheosis gives one charge back, the recharge under way kept", () => {
    const apo = EVENT_COOLDOWN_REDUCTIONS["200183"]!;
    expect(apo.targets).toEqual(["88625", "2050", "34861"]);
    expect(apo.oneCharge).toBe(true);
    // two charges, 60 s recharge: both spent at 0 and 1 s → the first
    // recharges at 60; one charge back at 10 s keeps that timer
    const one = chargeStateAt([0, 1], 60, 2, 10, {
      reductions: [
        { atSeconds: 10, seconds: Number.POSITIVE_INFINITY, oneCharge: true },
      ],
    });
    expect(one).toEqual({ charges: 1, nextRecharge: 60 });
    // a reset gives both back
    const all = chargeStateAt([0, 1], 60, 2, 10, {
      reductions: [{ atSeconds: 10, seconds: Number.POSITIVE_INFINITY }],
    });
    expect(all.charges).toBe(2);
  });
});

describe("tooltip resets and give-backs found by the #176 catalog", () => {
  it("Preparation resets the five spells its tooltip names", () => {
    expect(EVENT_COOLDOWN_REDUCTIONS["1277933"]!.targets).toEqual([
      "13750",
      "315341",
      "13877",
      "271877",
      "51690",
    ]);
  });
  it("Summon Doomguard: −3 s a Demonic Core spent by a Demonbolt", () => {
    const T0 = 1_000_000;
    const ev = (event: string, spellId: string, atMs: number) => ({
      spellId,
      logLine: { event, timestamp: T0 + atMs },
    });
    const u = {
      id: "w",
      spec: "266",
      spellCastEvents: [ev("SPELL_CAST_SUCCESS", "264178", 1000)],
      damageOut: [],
      auraEvents: [
        {
          ...ev("SPELL_AURA_REMOVED", "264173", 1100),
          srcUnitId: "w",
          destUnitId: "w",
        },
      ],
    } as never;
    const r = [EVENT_COOLDOWN_REDUCTIONS["1276672"]!];
    expect(eventTriggersFor(u, r).map((g) => g.seconds)).toEqual([3]);
  });
  it("Ace Up Your Sleeve / Gravedigger: the unit's own energize row resets Between the Eyes", () => {
    const T0 = 1_000_000;
    const row = (event: string, spellId: string, atMs: number) => ({
      spellId,
      srcUnitId: "r",
      destUnitId: "r",
      logLine: { event, timestamp: T0 + atMs },
    });
    const u = {
      id: "r",
      spec: "260",
      spellCastEvents: [row("SPELL_CAST_SUCCESS", "315341", 1000)],
      damageOut: [],
      missesOut: [],
      actionOut: [
        row("SPELL_ENERGIZE", "394120", 1000),
        row("SPELL_ENERGIZE", "1279356", 5000),
        // a periodic energize of the id is no proc of it
        row("SPELL_PERIODIC_ENERGIZE", "394120", 7000),
      ],
    } as never;
    for (const [key, at] of [
      ["381828", 1],
      ["1265863", 5],
    ] as const) {
      const r = EVENT_COOLDOWN_REDUCTIONS[key]!;
      expect(r.targets).toEqual(["315341"]);
      expect(r.seconds).toBe(Number.POSITIVE_INFINITY);
      expect(eventTriggerTimesMs(u, r).map((t) => (t - T0) / 1000)).toEqual([
        at,
      ]);
    }
  });
});

describe("Violent Transformation — entering Void Metamorphosis resets Voidblade (GH #179)", () => {
  // the tooltip names Voidblade on both eras (12.1.0.69587 "… Voidblade and
  // The Hunt", 12.1.5 "… Voidblade and Soul Immolation"); Pierce the Veil
  // 1245483 is the same button (aura-332 variant), so one target covers it
  const r = EVENT_COOLDOWN_REDUCTIONS["452409"]!;
  it("targets Voidblade, as a full reset on both eras (Soul Immolation is its own dated row, GH #193)", () => {
    expect(r.targets).toEqual(["1245412"]);
    expect(r.seconds).toBe(Number.POSITIVE_INFINITY);
    expect(eventReductionsFor("1245412", (t) => t === "452409")).toContain(r);
    expect(eventReductionsFor("1245412", () => false)).not.toContain(r);
  });
  it("an entry 17 s after a 30 s Voidblade makes it ready there (90c57b63 r4 0:02 → 0:19)", () => {
    // Voidblade at 0:02.548, Void Metamorphosis 1217607 applied at 0:19.589,
    // Pierce the Veil pressed at 0:23.869 — `back 0:32` on the line before
    const T0 = Date.UTC(2026, 7, 14, 8, 51, 20, 967);
    const u = {
      id: "dh",
      spec: "1480",
      spellCastEvents: [],
      damageOut: [],
      missesOut: [],
      actionOut: [
        {
          spellId: "1217607",
          srcUnitId: "dh",
          destUnitId: "dh",
          logLine: {
            event: LogEvent.SPELL_AURA_APPLIED,
            timestamp: T0 + 19_589,
          },
        },
      ],
    } as never;
    expect(eventTriggerTimesMs(u, r).map((t) => t - T0)).toEqual([19_589]);
    const at = eventTriggersFor(u, [r]).map((g) => ({
      atSeconds: (g.atMs - T0) / 1000,
      seconds: g.seconds,
    }));
    expect(2.548 + eventReducedCooldownSeconds(2.548, 30, at)).toBeCloseTo(
      19.589,
      6,
    );
  });
});
