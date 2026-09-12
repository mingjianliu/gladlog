/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatExtraSpellAction,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  annotateMissedPurgesWithKillWindows,
  canDefensiveCleanse,
  canOffensivePurge,
  formatDispelContextForAI,
  formatMissedCleanseExemption,
  IMissedPurgeWindow,
  reconstructDispelSummary,
  wasRemovedByAllyDispel,
} from "../../src/utils/dispelAnalysis";
import { DISPEL_FEATURE_FLAGS } from "../../src/data/dispelFeatureFlags";
import { makeAuraEvent, makeDispelAction, makeUnit } from "./testHelpers";

beforeAll(() => {
  DISPEL_FEATURE_FLAGS.F18_FATAL_DISPEL = true;
  DISPEL_FEATURE_FLAGS.F124_ENHANCED_CC_ANNOTATIONS = true;
  DISPEL_FEATURE_FLAGS.F131_F132_CLEANSE_COOLDOWNS = true;
  DISPEL_FEATURE_FLAGS.F152_MISSED_PURGES_TIMELINE = true;
});

// Mock talents module to bypass complex lookups
vi.mock("../../src/utils/talents", () => ({
  getPlayerTalentedSpellIds: (_spec: any, talents: any) => {
    if (talents === "HAS_DISEASE") return new Set(["213634"]);
    if (talents === "HAS_FELHUNTER") return new Set(["30146"]);
    if (talents === "EMPTY") return new Set();
    return null;
  },
  getSpecTalentTreeSpellIds: () => new Set(["213634", "278326", "30146"]),
}));

const MATCH_START = 1_000_000;

function makeExtraAction(
  timestamp: number,
  event: LogEvent,
  overrides: any,
): CombatExtraSpellAction {
  // In compat, CombatExtraSpellAction is an interface: build a literal directly
  const action: any = {};
  Object.assign(action, {
    timestamp,
    logLine: { event, timestamp, parameters: [] },
    spellId: "123",
    spellName: "Test",
    extraSpellId: "456",
    extraSpellName: "Extra",
    srcUnitId: "s1",
    destUnitId: "d1",
    destUnitName: "Dest",
    ...overrides,
  });
  return action;
}

describe("dispelAnalysis — cleanse/purge capability", () => {
  it("handles talent-gated Shadow Priest Purify Disease (B54)", () => {
    const spriest = makeUnit("p1", { spec: CombatUnitSpec.Priest_Shadow });
    expect(canDefensiveCleanse(spriest as any, "Disease")).toBe(false);

    (spriest as any).info = { talents: "HAS_DISEASE" };
    expect(canDefensiveCleanse(spriest as any, "Disease")).toBe(true);
  });

  it("handles DH Consume Magic talent gating (B55)", () => {
    const dh = makeUnit("dh", { spec: CombatUnitSpec.DemonHunter_Havoc });
    (dh as any).info = undefined;
    expect(canOffensivePurge(dh as any)).toBe(true);

    (dh as any).info = { talents: "EMPTY" };
    expect(canOffensivePurge(dh as any)).toBe(false);
  });

  it("handles Warlock Felhunter talent gating (B56)", () => {
    const lock = makeUnit("lock", { spec: CombatUnitSpec.Warlock_Affliction });
    (lock as any).info = { talents: "EMPTY" };
    expect(canOffensivePurge(lock as any)).toBe(false);

    (lock as any).info = { talents: "HAS_FELHUNTER" };
    expect(canOffensivePurge(lock as any)).toBe(true);
  });
});

describe("dispelAnalysis — summary reconstruction", () => {
  function makeCombat() {
    return { startTime: MATCH_START, endTime: MATCH_START + 120_000 };
  }

  it("attributes pet dispels to the owner (B45)", () => {
    const owner = makeUnit("owner1", {
      name: "Player1",
      spec: CombatUnitSpec.Priest_Discipline,
    });
    const pet = makeUnit("pet1", { ownerId: "owner1", name: "Imp" } as any);

    const action = makeExtraAction(
      MATCH_START + 10_000,
      LogEvent.SPELL_DISPEL,
      {
        extraSpellId: "118",
        destUnitId: "owner1",
        destUnitName: "Player1",
        srcUnitId: "pet1",
      },
    );
    (pet as any).actionOut = [action];

    const res = reconstructDispelSummary([owner] as any, [], makeCombat(), [
      pet,
    ] as any);
    expect(res.allyCleanse).toHaveLength(1);
    expect(res.allyCleanse[0].sourceName).toBe("Player1");
    expect(res.allyCleanse[0].isPetDispel).toBe(true);
  });

  it("handles hostile purges (B96)", () => {
    const friend = makeUnit("f1", {
      name: "Friend",
      spec: CombatUnitSpec.Warrior_Arms,
    });
    const enemy = makeUnit("e1", {
      name: "Enemy",
      spec: CombatUnitSpec.Mage_Frost,
    });
    (enemy as any).id = "e1";

    const action = makeExtraAction(
      MATCH_START + 10_000,
      LogEvent.SPELL_DISPEL,
      {
        extraSpellId: "123",
        destUnitId: "f1",
        srcUnitId: "e1",
      },
    );
    (enemy as any).actionOut = [action];

    const res = reconstructDispelSummary(
      [friend] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res.hostilePurges).toHaveLength(1);
  });

  it("detects missed cleanse windows and identifies CD usage (B58)", () => {
    const healer = makeUnit("h", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
    });
    (healer as any).id = "h";
    const target = makeUnit("t", {
      name: "Target",
      spec: CombatUnitSpec.Warrior_Arms,
    });
    (target as any).id = "t";

    const firstCleanse = makeExtraAction(
      MATCH_START + 10_000,
      LogEvent.SPELL_DISPEL,
      {
        extraSpellId: "118",
        destUnitId: "t",
        destUnitName: "Target",
        srcUnitId: "h",
      },
    );
    (healer as any).actionOut = [firstCleanse];
    // A real cleanse is a PRESS: production logs SPELL_CAST_SUCCESS alongside
    // the SPELL_DISPEL (dispelKind.ts measured every cleanse/purge spell at
    // 99–100% cast-matched). Without it `classifyDispel` calls this a proc, and
    // procs no longer burn the cleanse cooldown — the fixture used to pin a
    // shape production cannot produce.
    (healer as any).spellCastEvents = [
      {
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS },
        srcUnitId: "h",
        spellId: "123",
        spellName: "Test",
        timestamp: MATCH_START + 10_000,
      },
    ];

    const ccApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "118",
      MATCH_START + 15_000,
      "e1",
      "t",
    );
    const ccRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      "118",
      MATCH_START + 25_000,
      "e1",
      "t",
    );
    (target as any).auraEvents = [ccApply, ccRemove];

    const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary(
      [healer, target] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res.missedCleanseWindows).toHaveLength(1);
    expect(res.missedCleanseWindows[0].cleanseWasOnCD).toBe(true);
  });

  it("a rider/proc dispel does not burn the cleanse cooldown (2026-09-11)", () => {
    // Cleanse the Weak's second-ally strip logs a SPELL_DISPEL (199427) with no
    // press behind it — 484 such events per 250 S2 logs. Counting it as a burned
    // 8s cleanse cooldown told the gate "their cleanse was down" and suppressed
    // real missed-cleanse findings. `dispelKind` (proc) is the shared predicate.
    const healer = makeUnit("h", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
    });
    (healer as any).id = "h";
    const target = makeUnit("t", {
      name: "Target",
      spec: CombatUnitSpec.Warrior_Arms,
    });
    (target as any).id = "t";
    (healer as any).actionOut = [
      makeExtraAction(MATCH_START + 10_000, LogEvent.SPELL_DISPEL, {
        spellId: "199427",
        spellName: "Cleanse the Weak",
        extraSpellId: "118",
        destUnitId: "t",
        destUnitName: "Target",
        srcUnitId: "h",
      }),
    ];
    // deliberately NO matching SPELL_CAST_SUCCESS — that is what makes it a proc
    (target as any).auraEvents = [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "118",
        MATCH_START + 15_000,
        "e1",
        "t",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "118",
        MATCH_START + 25_000,
        "e1",
        "t",
      ),
    ];
    const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary(
      [healer, target] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res.missedCleanseWindows).toHaveLength(1);
    expect(res.missedCleanseWindows[0].cleanseWasOnCD).toBe(false);
  });

  it("Purification's second charge keeps the cleanse available (2026-09-11)", () => {
    // 19% of consecutive Purify pairs in the corpus are closer than the
    // single-charge 8s — that is the PvP talent's second charge. The modifier
    // comes from the generated DB2 table (527 <- 196439 extra_charge 1), not
    // from a hand list here.
    const mk = (pvpTalents: string[], cleanseTimes: number[]) => {
      const healer = makeUnit("h", {
        name: "Healer",
        spec: CombatUnitSpec.Priest_Holy,
      });
      (healer as any).id = "h";
      (healer as any).info = { pvpTalents };
      (healer as any).actionOut = cleanseTimes.map((t) =>
        makeExtraAction(MATCH_START + t, LogEvent.SPELL_DISPEL, {
          spellId: "527",
          spellName: "Purify",
          extraSpellId: "118",
          destUnitId: "t",
          destUnitName: "Target",
          srcUnitId: "h",
        }),
      );
      (healer as any).spellCastEvents = cleanseTimes.map((t) => ({
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS },
        srcUnitId: "h",
        spellId: "527",
        spellName: "Purify",
        timestamp: MATCH_START + t,
      }));
      const target = makeUnit("t", {
        name: "Target",
        spec: CombatUnitSpec.Warrior_Arms,
      });
      (target as any).id = "t";
      (target as any).auraEvents = [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "118",
          MATCH_START + 15_000,
          "e1",
          "t",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "118",
          MATCH_START + 25_000,
          "e1",
          "t",
        ),
      ];
      const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });
      return reconstructDispelSummary(
        [healer, target] as any,
        [enemy] as any,
        makeCombat(),
      );
    };

    // One Purify 5s before the CC: without the talent that is a lockout…
    expect(mk([], [10_000]).missedCleanseWindows[0].cleanseWasOnCD).toBe(true);
    // …with Purification a charge is still in hand.
    expect(
      mk(["196439"], [10_000]).missedCleanseWindows[0].cleanseWasOnCD,
    ).toBe(false);
    // Both charges spent inside the window locks it out again.
    expect(
      mk(["196439"], [10_000, 12_000]).missedCleanseWindows[0].cleanseWasOnCD,
    ).toBe(true);
  });

  describe("DISPEL-002: 落地→驱散延迟(2026-08-06,信号扩容批 1)", () => {
    it("驱散确实发生但延迟 >=MISSED_CLEANSE_THRESHOLD_S(3s) → 进 lateCleanseWindows,不进 missedCleanseWindows", () => {
      const healer = makeUnit("h", {
        name: "Healer",
        spec: CombatUnitSpec.Priest_Holy,
      });
      (healer as any).id = "h";
      const target = makeUnit("t", {
        name: "Target",
        spec: CombatUnitSpec.Warrior_Arms,
      });
      (target as any).id = "t";

      const ccApply = makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "118",
        MATCH_START + 10_000,
        "e1",
        "t",
      );
      // Removed (dispelled) 5s after it landed — a real, but slow, reaction.
      const ccRemove = makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "118",
        MATCH_START + 15_000,
        "e1",
        "t",
      );
      (target as any).auraEvents = [ccApply, ccRemove];

      const dispel = makeDispelAction(
        MATCH_START + 15_000,
        "h",
        "t",
        "115450",
        "118",
        "Polymorph",
        "Target",
        "Healer",
      );
      (healer as any).actionOut = [dispel];

      const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

      const res = reconstructDispelSummary(
        [healer, target] as any,
        [enemy] as any,
        makeCombat(),
      );
      // Zero behavior change on the existing "never cleansed" array (this IS
      // a cleanse, just a late one).
      expect(res.missedCleanseWindows).toHaveLength(0);
      expect(res.lateCleanseWindows).toHaveLength(1);
      expect(res.lateCleanseWindows[0].lateDispelSeconds).toBeCloseTo(5, 5);
      expect(res.lateCleanseWindows[0].targetName).toBe("Target");
      expect(res.lateCleanseWindows[0].spellId).toBe("118");
      // Ground-truth gates: a dispel demonstrably connected, so these three
      // must not carry the "nobody could act" verdict the never-cleansed
      // branch would otherwise compute geometrically.
      expect(res.lateCleanseWindows[0].cleanseWasOnCD).toBe(false);
      expect(res.lateCleanseWindows[0].dispellersLockedOut).toBe(false);
      expect(res.lateCleanseWindows[0].losReachable).toBe(true);
    });

    it("驱散延迟 <3s(及时驱散)→ 两个数组都不进,不是教练信号", () => {
      const healer = makeUnit("h", {
        name: "Healer",
        spec: CombatUnitSpec.Priest_Holy,
      });
      (healer as any).id = "h";
      const target = makeUnit("t", {
        name: "Target",
        spec: CombatUnitSpec.Warrior_Arms,
      });
      (target as any).id = "t";

      const ccApply = makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "118",
        MATCH_START + 10_000,
        "e1",
        "t",
      );
      // Removed 1.5s after landing — prompt reaction, below the threshold.
      const ccRemove = makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "118",
        MATCH_START + 11_500,
        "e1",
        "t",
      );
      (target as any).auraEvents = [ccApply, ccRemove];

      const dispel = makeDispelAction(
        MATCH_START + 11_500,
        "h",
        "t",
        "115450",
        "118",
        "Polymorph",
        "Target",
        "Healer",
      );
      (healer as any).actionOut = [dispel];

      const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

      const res = reconstructDispelSummary(
        [healer, target] as any,
        [enemy] as any,
        makeCombat(),
      );
      expect(res.missedCleanseWindows).toHaveLength(0);
      expect(res.lateCleanseWindows).toHaveLength(0);
    });
  });

  it("F131/F132: respects dynamic cleanse cooldowns based on spell ID", () => {
    const healer = makeUnit("h", {
      name: "Healer",
      spec: CombatUnitSpec.Evoker_Preservation,
    });
    (healer as any).id = "h";
    const target = makeUnit("t", {
      name: "Target",
      spec: CombatUnitSpec.Warrior_Arms,
    });
    (target as any).id = "t";

    // Evoker uses Cauterizing Flame (374251, 60s CD) at MATCH_START + 5s
    const firstCleanse = makeExtraAction(
      MATCH_START + 5_000,
      LogEvent.SPELL_DISPEL,
      {
        spellId: "374251",
        extraSpellId: "118",
        destUnitId: "t",
        destUnitName: "Target",
        srcUnitId: "h",
      },
    );
    (healer as any).actionOut = [firstCleanse];
    // The matching press — see the note in B58 above.
    (healer as any).spellCastEvents = [
      {
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS },
        srcUnitId: "h",
        spellId: "374251",
        spellName: "Cauterizing Flame",
        timestamp: MATCH_START + 5_000,
      },
    ];

    // CC applied at 10s (within 60s window)
    const ccApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "118",
      MATCH_START + 10_000,
      "e1",
      "t",
    );
    const ccRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      "118",
      MATCH_START + 20_000,
      "e1",
      "t",
    );
    (target as any).auraEvents = [ccApply, ccRemove];

    const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary(
      [healer, target] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res.missedCleanseWindows).toHaveLength(1);
    // Should be on cooldown because 60s window covers 10s
    expect(res.missedCleanseWindows[0].cleanseWasOnCD).toBe(true);

    // CC applied at 70s (outside 60s window)
    const ccApplyLate = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "118",
      MATCH_START + 70_000,
      "e1",
      "t",
    );
    const ccRemoveLate = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      "118",
      MATCH_START + 80_000,
      "e1",
      "t",
    );
    (target as any).auraEvents = [ccApplyLate, ccRemoveLate];

    const resLate = reconstructDispelSummary(
      [healer, target] as any,
      [enemy] as any,
      makeCombat(),
    );
    // Should NOT be on cooldown because 60s window has expired
    expect(resLate.missedCleanseWindows[0].cleanseWasOnCD).toBe(false);
  });

  it("skips missed cleanse if all dispellers were blocked (B97)", () => {
    const healer = makeUnit("h", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
    });
    const target = makeUnit("t", {
      name: "Target",
      spec: CombatUnitSpec.Warrior_Arms,
    });
    const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

    const ccApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "118",
      MATCH_START + 10_000,
      "e1",
      "t",
    );
    const ccRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      "118",
      MATCH_START + 20_000,
      "e1",
      "t",
    );
    (target as any).auraEvents = [ccApply, ccRemove];

    // Healer is also CC'd for the same duration
    (healer as any).auraEvents = [
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
        MATCH_START + 20_000,
        "e1",
        "h",
      ),
    ];

    const res = reconstructDispelSummary(
      [healer, target] as any,
      [enemy] as any,
      makeCombat(),
    );
    // 按名字取而不是按下标:2026-08-19 裁定册接线后,治疗自己身上的变形
    // (硬控 × 治疗 = self-impossible)不再进收集层,她的效率条目因
    // totalCCWindows=0 被滤掉,数组短了一位 —— 旧的 [1] 会 undefined。
    const t = res.ccEfficiency.find((e) => e.targetName === "Target")!;
    expect(t.missedCount).toBe(0);
    expect(res.ccEfficiency.some((e) => e.targetName === "Healer")).toBe(false);
  });

  it("skips missed cleanse if the only dispeller was silenced for the whole window", () => {
    const healer = makeUnit("h", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
    });
    const target = makeUnit("t", {
      name: "Target",
      spec: CombatUnitSpec.Warrior_Arms,
    });
    const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

    const ccApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "118",
      MATCH_START + 10_000,
      "e1",
      "t",
    );
    const ccRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      "118",
      MATCH_START + 20_000,
      "e1",
      "t",
    );
    (target as any).auraEvents = [ccApply, ccRemove];

    // Healer is silenced (15487, type "interrupts" — not "cc") for the same duration:
    // a silenced healer cannot cast a dispel any more than a hard-CC'd one.
    (healer as any).auraEvents = [
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
        MATCH_START + 20_000,
        "e1",
        "h",
      ),
    ];

    const res = reconstructDispelSummary(
      [healer, target] as any,
      [enemy] as any,
      makeCombat(),
    );
    const targetEff = res.ccEfficiency.find((e) => e.targetName === "Target");
    expect(targetEff?.missedCount).toBe(0);
    expect(res.missedCleanseWindows).toHaveLength(0);
  });

  it("detects a fatal dispel when the dispeller dies within 4s of dispel", () => {
    const healer = makeUnit("h", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
    });
    (healer as any).id = "h";
    const target = makeUnit("t", {
      name: "Target",
      spec: CombatUnitSpec.Warrior_Arms,
    });
    (target as any).id = "t";

    const action = makeExtraAction(
      MATCH_START + 10_000,
      LogEvent.SPELL_DISPEL,
      {
        extraSpellId: "1259790", // UA (live 12.1 id) - has dispel penalty
        destUnitId: "t",
        destUnitName: "Target",
        srcUnitId: "h",
      },
    );
    (healer as any).actionOut = [action];

    // Mock death of the healer at MATCH_START + 12_000 (2s after dispel)
    (healer as any).deathRecords = [{ timestamp: MATCH_START + 12_000 }];

    const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary(
      [healer, target] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res.allyCleanse).toHaveLength(1);
    expect(res.allyCleanse[0].wasFatal).toBe(true);
    expect(res.allyCleanse[0].fatalUnitName).toBe("Healer");
    expect(res.allyCleanse[0].fatalUnitSpec).toBe("Holy Priest");
  });

  it("F124: detects backlash CC on the dispeller within 100ms", () => {
    const healer = makeUnit("h", {
      name: "Healer",
      spec: CombatUnitSpec.Priest_Holy,
    });
    (healer as any).id = "h";
    const target = makeUnit("t", {
      name: "Target",
      spec: CombatUnitSpec.Warrior_Arms,
    });
    (target as any).id = "t";

    const action = makeExtraAction(
      MATCH_START + 10_000,
      LogEvent.SPELL_DISPEL,
      {
        extraSpellId: "1259790", // UA (live 12.1 id) - has dispel penalty
        destUnitId: "t",
        destUnitName: "Target",
        srcUnitId: "h",
      },
    );
    (healer as any).actionOut = [action];

    // Mock UA backlash Silence (196364) applied to the healer within 100ms (at MATCH_START + 10_050)
    (healer as any).auraEvents = [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "196364",
        MATCH_START + 10_050,
        "enemy",
        "h",
      ),
    ];

    const enemy = makeUnit("e1", { reaction: CombatUnitReaction.Hostile });

    const res = reconstructDispelSummary(
      [healer, target] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res.allyCleanse).toHaveLength(1);
    expect(res.allyCleanse[0].backlashCcSpellId).toBe("196364");
  });

  it("detects missed purge and identifies if all eligible purgers were on CD (B108)", () => {
    const purger = makeUnit("dh1", {
      name: "DH",
      spec: CombatUnitSpec.DemonHunter_Havoc,
    });
    (purger as any).id = "dh1";
    const enemy = makeUnit("e1", {
      name: "Enemy",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Hostile,
    });
    (enemy as any).id = "e1";

    // DH uses purge at 5s
    const firstPurge = makeExtraAction(
      MATCH_START + 5_000,
      LogEvent.SPELL_DISPEL,
      {
        srcUnitId: "dh1",
        destUnitId: "e1",
        extraSpellId: "1022", // BOP - Critical priority
        extraSpellName: "Blessing of Protection",
      },
    );
    (purger as any).actionOut = [firstPurge];

    // BOP applied at 10s (DH purge on CD for 8s until 13s)
    const buffApply = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      "1022",
      MATCH_START + 10_000,
      "e1",
      "e1",
      "BUFF",
    );
    const buffRemove = makeAuraEvent(
      LogEvent.SPELL_AURA_REMOVED,
      "1022",
      MATCH_START + 20_000,
      "e1",
      "e1",
      "BUFF",
    );
    (enemy as any).auraEvents = [buffApply, buffRemove];

    const res = reconstructDispelSummary(
      [purger] as any,
      [enemy] as any,
      makeCombat(),
    );
    expect(res.missedPurgeWindows).toHaveLength(1);
    expect(res.missedPurgeWindows[0].purgeWasOnCD).toBe(true);
    expect(res.missedPurgeWindows[0].cdBurnedOn?.spellName).toBe(
      "Blessing of Protection",
    );
  });
});

describe("dispelAnalysis — formatting", () => {
  it("formatDispelContextForAI produces detailed text", () => {
    const summary: any = {
      missedCleanseWindows: [
        {
          priority: "Critical",
          spellName: "Fear",
          targetSpec: "Arms Warrior",
          timeSeconds: 10,
          durationSeconds: 6,
          postCcDamage: 150_000,
        },
      ],
      ccEfficiency: [
        {
          targetName: "T1",
          targetSpec: "Arms Warrior",
          totalCCWindows: 1,
          missedCount: 1,
          cleanseCount: 0,
          brokenCount: 0,
        },
      ],
      missedPurgeWindows: [
        {
          priority: "High",
          spellName: "Combustion",
          enemySpec: "Fire Mage",
          durationSeconds: 10,
          teamUnderPressure: true,
        },
      ],
    };

    const lines = formatDispelContextForAI(summary);
    expect(lines.join("\n")).toContain("DISPEL SUMMARY:");
    expect(lines.join("\n")).toContain(
      "CC windows on your team: 1 total — 1 missed",
    );
    expect(lines.join("\n")).toContain(
      "Worst missed cleanse: Fear [Critical] on Arms Warrior",
    );
  });

  it("formatDispelContextForAI handles no CC state", () => {
    const summary: any = {
      missedCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [],
    };
    const lines = formatDispelContextForAI(summary);
    expect(lines).toContain("  No significant CC applied to your team.");
    expect(lines).toContain("  Missed purge windows: None (Critical/High)");
  });
});

describe("formatMissedCleanseExemption", () => {
  // [UNCLEANSED DEBUFF] lines used to carry no exculpating context:
  // cleanseWasOnCD was computed but rendered only into the single worst entry of
  // the DISPEL SUMMARY, so a model reading the timeline saw a context-free
  // missed cleanse and would still blame the player out loud.
  it("cleanse 在 CD 时输出语境后缀(含烧在哪个目标上)", () => {
    expect(
      formatMissedCleanseExemption({
        cleanseWasOnCD: true,
        cdBurnedOn: {
          spellName: "Frost Nova",
          priority: "High",
          secondsBefore: 3.2,
        },
      } as any),
    ).toBe(" | cleanse was ON CD (used on Frost Nova 3.2s before)");
    expect(formatMissedCleanseExemption({ cleanseWasOnCD: true } as any)).toBe(
      " | cleanse was ON CD",
    );
  });
  it("不在 CD → 空后缀", () => {
    expect(formatMissedCleanseExemption({ cleanseWasOnCD: false } as any)).toBe(
      "",
    );
  });
});

describe("wasRemovedByAllyDispel", () => {
  it("matches the dispel/removal pair within a 50ms tolerance, tolerating 1ms log skew (B11)", () => {
    const allyCleanse = [
      {
        timeSeconds: 10.2,
        removedSpellId: "118",
        targetName: "Player1",
      } as any,
    ];
    expect(wasRemovedByAllyDispel(allyCleanse, "118", "Player1", 10.2)).toBe(
      true,
    ); // exact
    expect(wasRemovedByAllyDispel(allyCleanse, "118", "Player1", 10.201)).toBe(
      true,
    ); // 1ms log skew — real ~5% of pairs
    expect(wasRemovedByAllyDispel(allyCleanse, "118", "Player1", 10.24)).toBe(
      true,
    ); // 40ms — within tolerance
    expect(wasRemovedByAllyDispel(allyCleanse, "118", "Player1", 10.27)).toBe(
      false,
    ); // 70ms — distinct event
    expect(wasRemovedByAllyDispel(allyCleanse, "118", "Player1", 10.7)).toBe(
      false,
    ); // 500ms — distinct event
    expect(wasRemovedByAllyDispel(allyCleanse, "999", "Player1", 10.2)).toBe(
      false,
    ); // wrong spell
  });
});

function makeMissedPurge(
  timeSeconds: number,
  priority: "Critical" | "High" | "Medium" | "Low",
): IMissedPurgeWindow {
  return {
    timeSeconds,
    durationSeconds: 8,
    enemyName: "Rsham",
    enemySpec: "Restoration Shaman",
    spellName: "Earth Shield",
    spellId: "974",
    priority,
    purgeWasOnCD: false,
    purgersLockedOut: false,
    losReachable: null,
    teamUnderPressure: false,
  };
}

describe("annotateMissedPurgesWithKillWindows", () => {
  it("flags misses inside a kill window and leaves others untouched", () => {
    const misses = [
      makeMissedPurge(45, "Medium"),
      makeMissedPurge(80, "Medium"),
    ];
    annotateMissedPurgesWithKillWindows(misses, [
      { fromSeconds: 40, toSeconds: 50 },
    ]);
    expect(misses[0].duringKillWindow).toBe(true);
    expect(misses[1].duringKillWindow).toBe(false);
  });

  it("escalates in-window misses in the formatter even at Medium priority", () => {
    const misses = [makeMissedPurge(45, "Medium")];
    annotateMissedPurgesWithKillWindows(misses, [
      { fromSeconds: 40, toSeconds: 50 },
    ]);
    const summary = {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: misses,
    };
    const text = formatDispelContextForAI(summary as never).join("\n");
    expect(text).toContain("MISSED PURGE DURING FRIENDLY KILL WINDOW");
    expect(text).toContain("Earth Shield");
  });

  it("surfaces an in-window Medium miss via a dedicated line without displacing a longer Critical worst pick", () => {
    const criticalMiss: IMissedPurgeWindow = {
      ...makeMissedPurge(10, "Critical"),
      durationSeconds: 20,
      spellName: "Ice Block",
      enemySpec: "Frost Mage",
      enemyName: "Fmage",
      duringKillWindow: false,
    };
    const mediumInWindowMiss: IMissedPurgeWindow = {
      ...makeMissedPurge(45, "Medium"),
      durationSeconds: 5,
      spellName: "Earth Shield",
    };
    annotateMissedPurgesWithKillWindows(
      [mediumInWindowMiss],
      [{ fromSeconds: 40, toSeconds: 50 }],
    );
    expect(mediumInWindowMiss.duringKillWindow).toBe(true);

    const summary = {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: [criticalMiss, mediumInWindowMiss],
    };
    const text = formatDispelContextForAI(summary as never).join("\n");

    // Worst line stays on the Critical (longer, non-window) miss — unchanged from pre-existing behavior.
    expect(text).toContain(
      "Missed purge windows: 1 — worst: Ice Block on Frost Mage",
    );
    expect(text).not.toContain("worst: Earth Shield");

    // The in-window Medium miss is still always surfaced via its own dedicated line.
    expect(text).toContain(
      "MISSED PURGE DURING FRIENDLY KILL WINDOW: Earth Shield on Restoration Shaman (Rsham)",
    );
  });

  it("renders no kill-window line when no missed purge carries the duringKillWindow annotation", () => {
    const misses = [
      makeMissedPurge(10, "Critical"),
      makeMissedPurge(20, "High"),
    ];
    // duringKillWindow deliberately left undefined (annotateMissedPurgesWithKillWindows never ran).
    const summary = {
      allyCleanse: [],
      ourPurges: [],
      hostilePurges: [],
      missedCleanseWindows: [],
      ccEfficiency: [],
      missedPurgeWindows: misses,
    };
    const text = formatDispelContextForAI(summary as never).join("\n");
    expect(text).not.toContain("MISSED PURGE DURING FRIENDLY KILL WINDOW");
  });
});
