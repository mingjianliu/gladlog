/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import {
  formatEnemyCDTimelineForContext,
  formatKillAttemptWindowsForContext,
  reconstructEnemyCDTimeline,
} from "../../src/utils/enemyCDs";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;

describe("enemyCDs — timeline reconstruction", () => {
  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_START + 120_000 } as any;
  }

  it("filters and deduplicates enemy offensive casts (B60)", () => {
    // 31884 is Avenging Wrath (offensive)
    const enemy = makeUnit("e1", {
      name: "Enemy1",
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "e1",
          "Self",
          "e1",
          "Paladin",
          0,
          "Avenging Wrath",
        ),
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_500,
          "e1",
          "Self",
          "e1",
          "Paladin",
          0,
          "Avenging Wrath",
        ), // Duplicate within 1s
        makeSpellCastEvent(
          "31884",
          MATCH_START + 30_000,
          "e1",
          "Self",
          "e1",
          "Paladin",
          0,
          "Avenging Wrath",
        ), // Real 2nd cast
      ],
    });

    const res = reconstructEnemyCDTimeline([enemy] as any, makeCombat());
    expect(res.players).toHaveLength(1);
    expect(res.players[0].offensiveCDs).toHaveLength(2);
    expect(res.players[0].offensiveCDs[0].castTimeSeconds).toBe(10);
    expect(res.players[0].offensiveCDs[1].castTimeSeconds).toBe(30);
  });

  it("identifies aligned burst windows with healers and pressure (B61)", () => {
    const e1 = makeUnit("e1", {
      name: "Paladin",
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "e1",
          "Self",
          "e1",
          "Paladin",
          0,
          "Avenging Wrath",
        ),
      ],
    });
    const e2 = makeUnit("e2", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Fire,
      spellCastEvents: [
        makeSpellCastEvent(
          "190319",
          MATCH_START + 12_000,
          "e2",
          "Self",
          "e2",
          "Mage",
          0,
          "Combustion",
        ),
      ],
    });

    const owner = makeUnit("h1", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
    });
    (owner as any).id = "h1";
    (owner as any).auraEvents = [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "118",
        MATCH_START + 11_000,
        "e2",
        "h1",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "118",
        MATCH_START + 15_000,
        "e2",
        "h1",
      ),
    ];

    const friend = makeUnit("f1", {
      name: "Target",
      damageIn: [
        {
          logLine: { timestamp: MATCH_START + 11_000 },
          effectiveAmount: -100_000,
        },
      ] as any,
      advancedActions: [
        makeAdvancedAction(MATCH_START + 10_000, 0, 0, 100, 100),
        makeAdvancedAction(MATCH_START + 20_000, 0, 0, 100, 50),
      ],
    });
    (friend as any).id = "f1";
    (friend.advancedActions[0] as any).advancedActorId = "f1";
    (friend.advancedActions[1] as any).advancedActorId = "f1";

    const res = reconstructEnemyCDTimeline(
      [e1, e2] as any,
      makeCombat(),
      owner as any,
      [friend] as any,
    );

    expect(res.alignedBurstWindows).toHaveLength(1);
    expect(res.alignedBurstWindows[0].activeCDs).toHaveLength(2);
    expect(res.alignedBurstWindows[0].healerCCed).toBe(true);
    expect(res.alignedBurstWindows[0].mostPressuredTarget?.unitName).toBe(
      "Target",
    );
  });

  it("handles pseudo-CC fallback for healers (B62)", () => {
    const owner = makeUnit("h1", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
      spellCastEvents: [],
    });
    (owner as any).id = "h1";
    const e1 = makeUnit("e1", {
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "e1",
          "Self",
          "e1",
          "Paladin",
          0,
          "Avenging Wrath",
        ),
      ],
    });
    const e2 = makeUnit("e2", {
      spellCastEvents: [
        makeSpellCastEvent(
          "190319",
          MATCH_START + 12_000,
          "e2",
          "Self",
          "e2",
          "Mage",
          0,
          "Combustion",
        ),
      ],
    });

    const res = reconstructEnemyCDTimeline(
      [e1, e2] as any,
      makeCombat(),
      owner as any,
    );
    expect(res.alignedBurstWindows[0].healerCCed).toBe(true);
  });

  it("grades healerCCed danger multiplier by the fraction of the window covered (B149)", () => {
    const e1 = makeUnit("e1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Fire,
      spellCastEvents: [
        makeSpellCastEvent(
          "190319",
          MATCH_START + 10_000,
          "e1",
          "Self",
          "e1",
          "Mage",
          0,
          "Combustion",
        ),
      ],
    });
    const owner = makeUnit("h1", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
    });
    (owner as any).id = "h1";
    (owner as any).auraEvents = [
      // 4 seconds of CC (from 11s to 15s) in a 10s burst window (10s to 20s)
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "118",
        MATCH_START + 11_000,
        "e1",
        "h1",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "118",
        MATCH_START + 15_000,
        "e1",
        "h1",
      ),
    ];

    const res = reconstructEnemyCDTimeline(
      [e1] as any,
      makeCombat(),
      owner as any,
    );

    expect(res.alignedBurstWindows).toHaveLength(1);
    const window = res.alignedBurstWindows[0];
    expect(window.healerCCed).toBe(true);

    // threatScore is ex-ante (unmodified by CC duration)
    // dangerScore = threatScore * damageRatio * (1.0 + ccFraction * 0.8)
    // Here: ccFraction = 4s / 10s = 0.4.
    // healerMult = 1.0 + 0.4 * 0.8 = 1.32.
    // So dangerScore should equal threatScore * damageRatio * 1.32.
    expect(window.dangerScore).toBeCloseTo(
      window.threatScore * window.damageRatio * 1.32,
      5,
    );
  });
});

describe("enemyCDs — formatting", () => {
  it("formatEnemyCDTimelineForContext handles various empty states", () => {
    const res1 = formatEnemyCDTimelineForContext(
      { players: [], alignedBurstWindows: [] },
      60,
    );
    expect(res1.join("\n")).toContain(
      "No enemy offensive cooldown data found.",
    );

    const res2 = formatEnemyCDTimelineForContext(
      {
        players: [{ playerName: "P", specName: "S", offensiveCDs: [] }],
        alignedBurstWindows: [],
      },
      60,
    );
    expect(res2.join("\n")).toContain(
      "No coordinated enemy burst windows detected",
    );
  });

  it("formatEnemyCDTimelineForContext lists unrecovered CDs (B63)", () => {
    const timeline: any = {
      players: [
        {
          playerName: "Mage",
          specName: "Fire Mage",
          offensiveCDs: [
            {
              spellName: "Combust",
              castTimeSeconds: 100,
              availableAgainAtSeconds: 220,
            },
          ],
        },
      ],
      alignedBurstWindows: [
        {
          fromSeconds: 10,
          toSeconds: 20,
          activeCDs: [],
          threatScore: 10,
          threatLabel: "Critical",
          dangerScore: 10,
          dangerLabel: "Low",
          dampeningPct: 0,
          damageInWindow: 0,
          damageRatio: 1,
          healerCCed: false,
        },
      ],
    };
    // Match duration 120s < 220s recovery
    const res = formatEnemyCDTimelineForContext(timeline, 120);
    expect(res.join("\n")).toContain("Not cast again before the match ended");
    expect(res.join("\n")).toContain(
      "Fire Mage: Combust — not used again after 1:40",
    );
  });

  it("formatKillAttemptWindowsForContext identifies confirmed kills (B64)", () => {
    // fixture 补全到与 IDamageBucket / activeCDs 的必填字段一致 —— 此前缺
    // toSeconds 与 castSeconds,渲染出 'Wings@NaN:NaN' 却因断言只做子串匹配
    // 而没被发现(NaN 落在断言片段之外)。
    const bursts: any = [
      {
        fromSeconds: 10,
        toSeconds: 20,
        dangerLabel: "High",
        activeCDs: [{ spellName: "Wings", castSeconds: 11 }],
      },
    ];
    const pressure: any = [
      {
        fromSeconds: 12,
        toSeconds: 18,
        totalDamage: 500_000,
        targetSpec: "Mage",
      },
    ];

    const res = formatKillAttemptWindowsForContext(bursts, pressure);
    // 伤害数字归属于 spike 自己的窗口(0:12–0:18),与 burst 窗口(0:10–0:20)不同 —— 必须分开印
    expect(res.join("\n")).toContain(
      "0:10–0:20  peak spike 0.50M on Mage over 0:12–0:18 | CDs: Wings@0:11",
    );
    expect(res.join("\n")).not.toContain("NaN");

    // Unconfirmed case
    const res2 = formatKillAttemptWindowsForContext(bursts, []);
    expect(res2.join("\n")).toContain(
      "1 burst window(s) had no confirmed spike",
    );
  });
});
