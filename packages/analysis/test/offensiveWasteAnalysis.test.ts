import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  buildOffensiveWasteSummary,
  formatOffensiveWasteForContext,
  getHighValueSpellIds,
} from "../src/utils/offensiveWasteAnalysis";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeCombat,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("offensiveWasteAnalysis — getHighValueSpellIds (FT-T02a)", () => {
  const hit = (spellId: string, effectiveAmount: number) =>
    ({ spellId, effectiveAmount }) as never;

  it("兼容层的 damageOut 是负数:占比 ≥ 5% 的技能留下,不到 5% 的丢掉(82a2d681 的形状)", () => {
    const ids = getHighValueSpellIds({
      damageOut: [
        hit("12294", -600_000), // Mortal Strike
        hit("7384", -300_000), // Overpower
        hit("100", -30_000), // Charge — 3.2 %
        hit("1715", -20_000), // Hamstring — 2.1 %
      ],
    });
    expect([...ids].sort()).toEqual(["12294", "7384"]);
  });

  it("正数金额(旧文档 / 手工夹具)结果相同", () => {
    const ids = getHighValueSpellIds({
      damageOut: [hit("12294", 600_000), hit("1715", 20_000)],
    });
    expect([...ids]).toEqual(["12294"]);
  });

  it("被吸收的部分在 damageOut 里是按盾的法术 id 记的正数行:不进占比,也不抬高门槛", () => {
    const absorbed = (shieldId: string, amount: number) =>
      ({
        spellId: shieldId,
        effectiveAmount: amount,
        logLine: { event: "SPELL_ABSORBED" },
      }) as never;
    const ids = getHighValueSpellIds({
      damageOut: [
        hit("12294", -100_000),
        hit("7384", -6_000), // 5.7 % of the 106k that landed
        absorbed("17", 900_000), // Power Word: Shield ate 900k
      ],
    });
    expect([...ids].sort()).toEqual(["12294", "7384"]);
  });

  it("没有任何伤害时不过滤:返回全部 id", () => {
    expect([...getHighValueSpellIds({ damageOut: [hit("1", 0)] })]).toEqual([
      "1",
    ]);
  });
});

describe("offensiveWasteAnalysis — buildOffensiveWasteSummary", () => {
  const matchStart = 1_000_000;
  const combat = makeCombat(matchStart, matchStart + 60_000);

  it("returns empty events when there are no defense windows or casts", () => {
    const friend = makeUnit("friend-1", { reaction: CombatUnitReaction.Friendly });
    const enemy = makeUnit("enemy-1", { reaction: CombatUnitReaction.Hostile });

    const summary = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    expect(summary.events).toEqual([]);
    expect(formatOffensiveWasteForContext(summary)).toBe("");
  });

  it("ignores defense auras whose verdict is 'never' or 'unresolved'", () => {
    const friend = makeUnit("friend-1", {
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        makeSpellCastEvent("12294", matchStart + 11_000, "enemy-1"),
        makeSpellCastEvent("12294", matchStart + 12_000, "enemy-1"),
        makeSpellCastEvent("12294", matchStart + 13_000, "enemy-1"),
      ],
    });
    // Power Word: Barrier (62618) has verdict: "never", 99999999 is unresolved
    const enemy = makeUnit("enemy-1", {
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "62618", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "62618", matchStart + 22_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "99999999", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "99999999", matchStart + 22_000, "enemy-1", "enemy-1", "BUFF"),
      ],
    });

    const summary = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    expect(summary.events).toHaveLength(0);
  });

  it("flags casts into unconditional immunity (Divine Shield 642) when >= 2 casts occur", () => {
    const friend = makeUnit("warrior-1", {
      name: "Ares",
      spec: CombatUnitSpec.Warrior_Arms,
      class: CombatUnitClass.Warrior,
      reaction: CombatUnitReaction.Friendly,
      damageOut: [
        makeDamageEvent(matchStart + 5_000, 100_000, "enemy-1"),
      ],
      spellCastEvents: [
        makeSpellCastEvent("12294", matchStart + 11_000, "enemy-1", "EnemyPaladin", "warrior-1", "Ares", 0, "Mortal Strike"),
        makeSpellCastEvent("12294", matchStart + 13_000, "enemy-1", "EnemyPaladin", "warrior-1", "Ares", 0, "Mortal Strike"),
      ],
    });
    // 12294 was not in damageOut, but damageOut has spellId: "1" (TestSpell).
    // Let's ensure 12294 is in damageOut so it clears high-value threshold (or damageOut is empty).
    // In this test, warrior-1's damageOut has 100_000 from spellId "1".
    // Let's add 12294 to damageOut:
    friend.damageOut = [
      {
        ...makeDamageEvent(matchStart + 5_000, 100_000, "enemy-1"),
        spellId: "12294",
      },
    ] as never;

    const enemy = makeUnit("enemy-1", {
      name: "EnemyPaladin",
      spec: CombatUnitSpec.Paladin_Holy,
      class: CombatUnitClass.Paladin,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "642", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "642", matchStart + 18_000, "enemy-1", "enemy-1", "BUFF"),
      ],
    });

    const summary = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    expect(summary.events).toHaveLength(1);
    const ev = summary.events[0]!;
    expect(ev.casterName).toBe("Ares");
    expect(ev.targetName).toBe("EnemyPaladin");
    expect(ev.verdict).toBe("unconditional");
    expect(ev.defenseName).toBe("Divine Shield");
    expect(ev.wasteCasts).toHaveLength(2);
    expect(ev.wasteCasts[0]!.spellId).toBe("12294");
  });

  it("does NOT flag unconditional immunity if only 1 cast was pressed (threshold is 2)", () => {
    const friend = makeUnit("warrior-1", {
      name: "Ares",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        makeSpellCastEvent("12294", matchStart + 11_000, "enemy-1", "EnemyPaladin"),
      ],
    });

    const enemy = makeUnit("enemy-1", {
      name: "EnemyPaladin",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "642", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "642", matchStart + 18_000, "enemy-1", "enemy-1", "BUFF"),
      ],
    });

    const summary = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    expect(summary.events).toHaveLength(0);
  });

  it("counts high-value CC abilities into immunity even when they deal no damage", () => {
    const friend = makeUnit("rogue-1", {
      name: "Sneaky",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Friendly,
      damageOut: [
        {
          ...makeDamageEvent(matchStart + 5_000, 200_000, "enemy-1"),
          spellId: "53", // Backstab
        },
      ],
      spellCastEvents: [
        // 408 is Kidney Shot (stun CC) — deals no or little damage, but is in ccSpellIds
        makeSpellCastEvent("408", matchStart + 11_000, "enemy-1", "EnemyPaladin", "rogue-1", "Sneaky", 0, "Kidney Shot"),
        makeSpellCastEvent("408", matchStart + 12_000, "enemy-1", "EnemyPaladin", "rogue-1", "Sneaky", 0, "Kidney Shot"),
      ],
    });

    const enemy = makeUnit("enemy-1", {
      name: "EnemyPaladin",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "642", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "642", matchStart + 18_000, "enemy-1", "enemy-1", "BUFF"),
      ],
    });

    const summary = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]!.wasteCasts).toHaveLength(2);
  });

  it("requires >= 3 casts for kill-live-gated defense (Survival Instincts 61336)", () => {
    const friend = makeUnit("warrior-1", {
      name: "Ares",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        makeSpellCastEvent("12294", matchStart + 11_000, "enemy-1"),
        makeSpellCastEvent("12294", matchStart + 12_000, "enemy-1"),
      ],
    });

    const enemy = makeUnit("enemy-1", {
      name: "Druid",
      spec: CombatUnitSpec.Druid_Feral,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "61336", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "61336", matchStart + 16_000, "enemy-1", "enemy-1", "BUFF"),
      ],
    });

    // 2 casts < threshold 3
    const summary2 = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    expect(summary2.events).toHaveLength(0);

    // 3 casts meets threshold 3
    friend.spellCastEvents.push(
      makeSpellCastEvent("12294", matchStart + 13_000, "enemy-1") as never,
    );
    const summary3 = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    expect(summary3.events).toHaveLength(1);
    expect(summary3.events[0]!.verdict).toBe("kill-live-gated");
  });

  it("suppresses kill-live-gated waste if target was in kill territory (HP <= 20%) during window", () => {
    const friend = makeUnit("warrior-1", {
      name: "Ares",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        makeSpellCastEvent("12294", matchStart + 11_000, "enemy-1"),
        makeSpellCastEvent("12294", matchStart + 12_000, "enemy-1"),
        makeSpellCastEvent("12294", matchStart + 13_000, "enemy-1"),
      ],
    });

    // Enemy druid whose HP dropped to 15% (15_000 / 100_000) at 12s
    const enemy = makeUnit("enemy-1", {
      name: "Druid",
      spec: CombatUnitSpec.Druid_Feral,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "61336", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "61336", matchStart + 16_000, "enemy-1", "enemy-1", "BUFF"),
      ],
      advancedActions: [
        makeAdvancedAction(matchStart + 12_000, 0, 0, 100_000, 15_000),
      ],
    });

    const summary = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    // Suppressed because pressing damage into DR when target is critically low (<=20%) is valid kill pressure
    expect(summary.events).toHaveLength(0);
  });
});

describe("offensiveWasteAnalysis — formatOffensiveWasteForContext", () => {
  it("formats context string with ability run-length collapse", () => {
    const summary = {
      events: [
        {
          casterName: "Ares",
          casterSpec: "Arms Warrior",
          targetName: "EnemyPaladin",
          targetSpec: "Holy Paladin",
          verdict: "unconditional" as const,
          defenseName: "Divine Shield",
          defenseWindowSeconds: [65, 73] as [number, number],
          wasteCasts: [
            { spellId: "12294", spellName: "Mortal Strike", atSeconds: 66 },
            { spellId: "12294", spellName: "Mortal Strike", atSeconds: 68 },
            { spellId: "23881", spellName: "Bloodthirst", atSeconds: 70 },
          ],
        },
      ],
    };

    const formatted = formatOffensiveWasteForContext(summary);
    expect(formatted).toContain("ABILITIES INTO IMMUNITY/DR");
    expect(formatted).toContain("[1:05] Arms Warrior (Ares): Mortal Strike ×2 + Bloodthirst into EnemyPaladin's Divine Shield");
  });
});
