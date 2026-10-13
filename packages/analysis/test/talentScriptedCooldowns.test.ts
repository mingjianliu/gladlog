import { describe, expect, it } from "vitest";

import {
  EVENT_COOLDOWN_REDUCTIONS,
  EVENT_HIT_SAME_USE_MS,
  eventReducedCooldownSeconds,
  eventReductionSecondsAt,
  eventTriggersFor,
  eventTriggerTimesMs,
} from "../src/data/talentScriptedCooldowns";
import {
  applyCdModifiers,
  cdAvailableAt,
  cdSecondsUntilReady,
  warpClock,
} from "../src/utils/cooldowns";
import {
  CD_TALENT_MODIFIERS,
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
