/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import {
  formatEnemyCDTimelineForContext,
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

  describe("FT-T13 D11: a 2v2 window that opens before the first logged dampening stack", () => {
    const combat2v2 = () =>
      ({
        startTime: MATCH_START,
        endTime: MATCH_START + 120_000,
        startInfo: { bracket: "2v2" },
      }) as any;
    /** Avenging Wrath + Combustion from `atS`; the first stack (42) at 0:11 */
    const enemies = (atS: number, withStack: boolean) => {
      const dose = makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED_DOSE,
        "110310",
        MATCH_START + 11_000,
        "e1",
        "e1",
      );
      (dose.logLine as any).parameters[12] = 42;
      return [
        makeUnit("e1", {
          name: "Paladin",
          spec: CombatUnitSpec.Paladin_Retribution,
          auraEvents: withStack ? [dose] : [],
          spellCastEvents: [
            makeSpellCastEvent(
              "31884",
              MATCH_START + atS * 1000,
              "e1",
              "Self",
              "e1",
              "Paladin",
              0,
              "Avenging Wrath",
            ),
          ],
        }),
        makeUnit("e2", {
          name: "Mage",
          spec: CombatUnitSpec.Mage_Fire,
          spellCastEvents: [
            makeSpellCastEvent(
              "190319",
              MATCH_START + (atS + 1) * 1000,
              "e2",
              "Self",
              "e2",
              "Mage",
              0,
              "Combustion",
            ),
          ],
        }),
      ] as any;
    };
    const windowOf = (atS: number, withStack = true) =>
      reconstructEnemyCDTimeline(enemies(atS, withStack), combat2v2())
        .alignedBurstWindows[0];

    it("states no dampening for the window (dampeningPct null), and prints none", () => {
      const early = windowOf(4);
      expect(early.fromSeconds).toBe(4);
      expect(early.dampeningPct).toBeNull();
      expect(windowOf(12).dampeningPct).toBe(0.42);
      const text = formatEnemyCDTimelineForContext(
        { players: [], alignedBurstWindows: [early] } as any,
        120,
      ).join("\n");
      expect(text).toContain("| Threat: ");
      expect(text).not.toContain("Dampening:");
    });

    it("weights the threat with the first logged stack — the same score as the same burst just after it, not a step from ×1.0", () => {
      const early = windowOf(4);
      const late = windowOf(12);
      expect(early.threatScore).toBeCloseTo(late.threatScore, 10);
      expect(early.threatLabel).toBe(late.threatLabel);
      // a round whose log printed no stack at all carries no dampening weight
      const unweighted = windowOf(4, false);
      expect(unweighted.dampeningPct).toBeNull();
      expect(early.threatScore / unweighted.threatScore).toBeCloseTo(
        1 + 0.42 * 1.5,
        10,
      );
    });
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
});
