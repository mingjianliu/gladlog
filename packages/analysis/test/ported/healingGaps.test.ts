/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import {
  detectHealingGaps,
  formatHealingGapsForContext,
} from "../../src/utils/healingGaps";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;

describe("healingGaps — main detection", () => {
  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_START + 60_000 };
  }

  it("identifies gaps with pressure and free cast time (B80)", () => {
    const healer = makeUnit("h", {
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [
        makeSpellCastEvent(
          "2061",
          MATCH_START + 10_000,
          "f1",
          "Friend",
          "h",
          "Priest",
        ),
        makeSpellCastEvent(
          "2061",
          MATCH_START + 20_000,
          "f1",
          "Friend",
          "h",
          "Priest",
        ),
      ],
    });

    const friend = makeUnit("f1", {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 15_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
    });
    const enemy = makeUnit("e1");

    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res).toHaveLength(1);
    expect(res[0].durationSeconds).toBe(10);
    expect(res[0].mostDamagedName).toBe("f1");
    expect(res[0].mostDamagedAmount).toBe(100_000);
  });

  it("skips gaps where the healer is fully CCed (B81)", () => {
    const healer = makeUnit("h", {
      spellCastEvents: [
        makeSpellCastEvent("2061", MATCH_START + 10_000, "f1"),
        makeSpellCastEvent("2061", MATCH_START + 20_000, "f1"),
      ],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "118",
          MATCH_START + 10_000,
          "e1",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "118",
          MATCH_START + 19_500,
          "e1",
          "h",
        ),
      ],
    });
    const friend = makeUnit("f1", {
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 15_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
    });
    const enemy = makeUnit("e1");
    (enemy as any).id = "e1";

    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res).toHaveLength(0);
  });

  it("踢造成的学派锁定也从自由时间里扣(BACKLOG #38 (e)):反震 6s 锁定吃掉空档 → 不报;3s 近战踢 → 自由时间只剩 7s 仍报", () => {
    // A pure interrupt logs no SPELL_AURA_APPLIED — only SPELL_INTERRUPT in the
    // victim's actionIn — so the old aura-only coverage counted the lockout as
    // "free" time. The lockout length is kickLockoutSeconds (corpus table).
    const kicked = (kickSpellId: string, atMs: number) =>
      makeUnit("h", {
        spellCastEvents: [
          makeSpellCastEvent("2061", MATCH_START + 10_000, "f1"),
          makeSpellCastEvent("2061", MATCH_START + 20_000, "f1"),
        ],
        actionIn: [
          {
            logLine: {
              event: LogEvent.SPELL_INTERRUPT,
              timestamp: atMs,
              parameters: [],
            },
            timestamp: atMs,
            spellId: kickSpellId,
            spellName: "kick",
            srcUnitId: "e1",
            srcUnitName: "e1",
            destUnitId: "h",
            destUnitName: "h",
            effectiveAmount: 0,
          },
        ] as any,
      });
    const friend = makeUnit("f1", {
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 15_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
    });
    const enemy = makeUnit("e1");
    (enemy as any).id = "e1";
    const run = (h: ReturnType<typeof makeUnit>) =>
      detectHealingGaps(
        h as any,
        [h, friend] as any,
        [enemy] as any,
        makeCombat(),
      );
    // Counterspell (2139, 6 s lockout) at 10.0 s: locked 10–16 s, then 4 s free
    // of a 10 s gap → still a gap? free 4 s ≥ MIN_FREE_CAST_MS — so use two
    // kicks to cover it: a second Counterspell at 15.5 s locks 15.5–21.5 s.
    const doubleKicked = kicked("2139", MATCH_START + 10_000);
    (doubleKicked as any).actionIn.push({
      ...(doubleKicked as any).actionIn[0],
      logLine: {
        event: LogEvent.SPELL_INTERRUPT,
        timestamp: MATCH_START + 15_500,
        parameters: [],
      },
      timestamp: MATCH_START + 15_500,
    });
    expect(run(doubleKicked)).toHaveLength(0);
    // A single 3 s melee kick (Pummel 6552) at 10.0 s leaves 7 s free → the gap
    // is still reported, with the lockout subtracted from freeCastSeconds.
    const res = run(kicked("6552", MATCH_START + 10_000));
    expect(res).toHaveLength(1);
    expect(res[0]!.freeCastSeconds).toBeCloseTo(7, 1);
  });

  it("skips gaps where the healer is fully silenced — silence prevents casting like hard CC", () => {
    const healer = makeUnit("h", {
      spellCastEvents: [
        makeSpellCastEvent("2061", MATCH_START + 10_000, "f1"),
        makeSpellCastEvent("2061", MATCH_START + 20_000, "f1"),
      ],
      auraEvents: [
        // Silence (15487) is type "interrupts", not "cc" — must still count as cast-preventing
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "15487",
          MATCH_START + 10_000,
          "e1",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "15487",
          MATCH_START + 19_500,
          "e1",
          "h",
        ),
      ],
    });
    const friend = makeUnit("f1", {
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 15_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
    });
    const enemy = makeUnit("e1");
    (enemy as any).id = "e1";

    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res).toHaveLength(0);
  });

  it("handles overlapping CC correctly using merged intervals (B82)", () => {
    const healer = makeUnit("h", {
      spellCastEvents: [
        makeSpellCastEvent("2061", MATCH_START + 10_000, "f1"),
        makeSpellCastEvent("2061", MATCH_START + 30_000, "f1"),
      ],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "853",
          MATCH_START + 10_000,
          "e1",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "853",
          MATCH_START + 16_000,
          "e1",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "118",
          MATCH_START + 14_000,
          "e1",
          "h",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "118",
          MATCH_START + 20_000,
          "e1",
          "h",
        ),
      ],
    });
    const friend = makeUnit("f1", {
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 15_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
    });
    const enemy = makeUnit("e1");
    (enemy as any).id = "e1";

    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res).toHaveLength(1);
    expect(res[0].freeCastSeconds).toBe(10);
  });

  it("suppresses gaps at match start (B19)", () => {
    const healer = makeUnit("h", {
      spellCastEvents: [makeSpellCastEvent("2061", MATCH_START + 4000, "f1")],
    });
    const friend = makeUnit("f1", {
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 2000 },
          effectiveAmount: -100_000,
        },
      ] as any,
    });
    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [makeUnit("e")],
      makeCombat(),
    );
    expect(res).toHaveLength(0);
  });

  it("clips the tail gap at the healer death — no inactivity charged after death (B137)", () => {
    // Healer's last cast is at 10s; it dies at 20s. The tail gap would otherwise run to match end
    // (60s) and charge 50s of inactivity + count post-death damage. It must clip at the 20s death.
    const healer = makeUnit("h", {
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [
        makeSpellCastEvent(
          "2061",
          MATCH_START + 10_000,
          "f1",
          "Friend",
          "h",
          "Priest",
        ),
      ],
    });
    (healer as any).deathRecords = [{ timestamp: MATCH_START + 20_000 }];

    const friend = makeUnit("f1", {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 15_000 },
          effectiveAmount: -100_000,
        }, // before death — counts
        {
          logLine: { timestamp: MATCH_START + 30_000 },
          effectiveAmount: -200_000,
        }, // after death — excluded
      ] as any,
    });
    const enemy = makeUnit("e1");

    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res).toHaveLength(1);
    expect(res[0].toSeconds).toBe(20); // clipped at the death, not match end (60s)
    expect(res[0].durationSeconds).toBe(10);
    expect(res[0].mostDamagedAmount).toBe(100_000); // the 200k post-death hit is excluded
  });

  it("clips a gap at the playable end like at the healer's own death (3v3 deciding death, 2026-09-30)", () => {
    // Healer alive all match; last cast at 10s, next at 50s. A teammate's
    // deciding death at 20s ends the playable match: the 10–50s gap is
    // charged only up to 20s.
    const healer = makeUnit("h", {
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [
        makeSpellCastEvent("2061", MATCH_START + 10_000, "f1", "Friend", "h", "Priest"),
        makeSpellCastEvent("2061", MATCH_START + 50_000, "f1", "Friend", "h", "Priest"),
      ],
    });
    const friend = makeUnit("f1", {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [
        { logLine: { timestamp: MATCH_START + 15_000 }, effectiveAmount: -100_000 },
        { logLine: { timestamp: MATCH_START + 30_000 }, effectiveAmount: -200_000 },
      ] as any,
    });
    const enemy = makeUnit("e1");
    const args = [healer as any, [healer, friend] as any, [enemy] as any, makeCombat()] as const;
    expect(detectHealingGaps(...args)[0].toSeconds).toBe(50);
    const res = detectHealingGaps(...args, { playableEndMs: MATCH_START + 20_000 });
    expect(res).toHaveLength(1);
    expect(res[0].toSeconds).toBe(20);
    expect(res[0].mostDamagedAmount).toBe(100_000);
  });

  it("drops a phantom tail gap opened by a post-death HoT tick (B137)", () => {
    // Healer's last cast is 10s; it dies at 15s; a pre-death HoT ticks at 18s (post-mortem), which
    // would otherwise start a phantom gap 18s -> match end. That gap begins after death and must be
    // dropped entirely, even though the teammate is hammered afterward.
    const healer = makeUnit("h", {
      spec: CombatUnitSpec.Monk_Mistweaver,
      spellCastEvents: [
        makeSpellCastEvent(
          "2061",
          MATCH_START + 10_000,
          "f1",
          "Friend",
          "h",
          "Monk",
        ),
      ],
    });
    (healer as any).deathRecords = [{ timestamp: MATCH_START + 15_000 }];
    (healer as any).healOut = [
      { logLine: { timestamp: MATCH_START + 18_000 } },
    ]; // Renewing Mist tick post-death

    const friend = makeUnit("f1", {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 30_000 },
          effectiveAmount: -300_000,
        },
      ] as any, // all post-death
    });

    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [makeUnit("e1")] as any,
      makeCombat(),
    );
    expect(res).toHaveLength(0); // no inactivity charged — the only pressure is after the healer died
  });

  // 2026-08-30, A/B change 1/5: gate is being moved off gap seconds onto the
  // lowest friendly HP% reached during the gap. detectHealingGaps must expose
  // that value on every gap it emits.
  it("computes lowestFriendlyHpPct as the min HP% across friendly advancedAction samples inside the gap window", () => {
    const healer = makeUnit("h", {
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [
        makeSpellCastEvent(
          "2061",
          MATCH_START + 10_000,
          "f1",
          "Friend",
          "h",
          "Priest",
        ),
        makeSpellCastEvent(
          "2061",
          MATCH_START + 20_000,
          "f1",
          "Friend",
          "h",
          "Priest",
        ),
      ],
    });
    const friend = makeUnit("f1", {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 15_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
      advancedActions: [
        // before the gap opens (10s) — must be ignored
        makeAdvancedAction(MATCH_START + 5_000, 0, 0, 100, 10),
        // inside the gap window [10s, 20s]
        makeAdvancedAction(MATCH_START + 12_000, 0, 0, 100, 70),
        makeAdvancedAction(MATCH_START + 16_000, 0, 0, 100, 35),
      ],
    });
    const enemy = makeUnit("e1");

    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res).toHaveLength(1);
    expect(res[0].lowestFriendlyHpPct).toBe(35); // min of 70/35 in-window; the pre-gap 10% sample is excluded
  });

  it("lowestFriendlyHpPct is null when no friendly advancedAction sample lands inside the gap window", () => {
    const healer = makeUnit("h", {
      spellCastEvents: [
        makeSpellCastEvent("2061", MATCH_START + 10_000, "f1"),
        makeSpellCastEvent("2061", MATCH_START + 20_000, "f1"),
      ],
    });
    const friend = makeUnit("f1", {
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 15_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
      // no advancedActions at all
    });
    const enemy = makeUnit("e1");

    const res = detectHealingGaps(
      healer as any,
      [healer, friend] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res).toHaveLength(1);
    expect(res[0].lowestFriendlyHpPct).toBeNull();
  });
});

describe("healingGaps — formatting", () => {
  it("formatHealingGapsForContext handles empty and populated states", () => {
    expect(formatHealingGapsForContext([])).toContain("  None detected.");

    const gap: any = {
      fromSeconds: 10,
      toSeconds: 20,
      durationSeconds: 10,
      freeCastSeconds: 5,
      mostDamagedName: "Player1",
      mostDamagedSpec: "Warrior",
      mostDamagedAmount: 150000,
    };
    const res = formatHealingGapsForContext([gap]);
    expect(res.join("\n")).toContain(
      "[INACTIVITY] From 0:10 to 0:20 (10.0s total, 5.0s of it un-CC'd/free to cast)",
    );
    expect(res.join("\n")).toContain("Warrior (Player1) took 150k damage");
  });
});

describe("healingGaps — round end (triage 2026-09-29 cc-dr F-HG1)", () => {
  // A Solo Shuffle round ends at its first player death; the healer's
  // activity logged after it (the next round's prep) must not close a gap.
  function shuffleRound(deathAtMs: number) {
    const dead = makeUnit("x", {
      info: {},
      deathRecords: [{ timestamp: deathAtMs }],
    });
    return {
      startTime: MATCH_START,
      endTime: MATCH_START + 60_000,
      startInfo: { bracket: "Rated Solo Shuffle" },
      units: { x: dead },
    };
  }

  it("a gap closed by post-end activity is the tail gap — none here", () => {
    const healer = makeUnit("h", {
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [
        makeSpellCastEvent("2061", MATCH_START + 10_000, "f1"),
        makeSpellCastEvent("2061", MATCH_START + 19_000, "f1"),
        // after the round-ending death at +20 s
        makeSpellCastEvent("2061", MATCH_START + 28_000, "f1"),
      ],
    });
    const friend = makeUnit("f1", {
      spec: CombatUnitSpec.Warrior_Arms,
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 22_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
    });
    const enemy = makeUnit("e1");
    const args = [healer, [healer, friend], [enemy]] as any[];

    // the match end alone (no bracket): the 19 → 28 s gap is charged
    const plain = detectHealingGaps(args[0], args[1], args[2], {
      startTime: MATCH_START,
      endTime: MATCH_START + 60_000,
    });
    expect(plain.map((g) => g.durationSeconds)).toEqual([9]);

    // Solo Shuffle, death at +20 s: the round ends there; 1 s of tail, no gap
    expect(
      detectHealingGaps(
        args[0],
        args[1],
        args[2],
        shuffleRound(MATCH_START + 20_000) as any,
      ),
    ).toEqual([]);
  });
});
