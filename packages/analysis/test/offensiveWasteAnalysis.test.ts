import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { KILL_LIVE_HP_PCT } from "../src/data/mitigationVerdicts";
import { parryStopsAttack } from "../src/data/spellParry";
import {
  PARRYABLE_SPELL_IDS,
  UNPARRYABLE_SPELL_IDS,
} from "../src/data/spellParryGenerated";
import {
  buildOffensiveWasteSummary,
  formatOffensiveWasteForContext,
  getHighValueSpellIds,
  pressLandingCaster,
  pressLandingRows,
  pressLandingsMs,
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
    expect([...ids].sort()).toEqual(["Mortal Strike", "Overpower"]);
  });

  it("按技能(英文名)计占比:施法 id 与伤害 id 不同的技能照样算(fact5 D7:Execute 281000 → 260798)", () => {
    const ids = getHighValueSpellIds({
      damageOut: [
        hit("12294", -600_000), // Mortal Strike
        hit("260798", -300_000), // Execute's damage row
      ],
    });
    expect(ids.has("Execute")).toBe(true);
  });

  it("正数金额(旧文档 / 手工夹具)结果相同", () => {
    const ids = getHighValueSpellIds({
      damageOut: [hit("12294", 600_000), hit("1715", 20_000)],
    });
    expect([...ids]).toEqual(["Mortal Strike"]);
  });

  it("自伤和打在队友身上的行不进分母(fact7 D53:自伤行把 Fire Blast 压到 5% 以下)", () => {
    const row = (spellId: string, amount: number, destUnitId: string) =>
      ({ ...(hit(spellId, -amount) as object), destUnitId }) as never;
    const damageOut = [
      row("11366", 900_000, "enemy"), // Pyroblast
      row("108853", 50_000, "enemy"), // Fire Blast — 5.0 % on enemies
      row("87023", 100_000, "me"), // the mage's own burn
    ];
    expect(getHighValueSpellIds({ damageOut }).has("Fire Blast")).toBe(false);
    expect(
      getHighValueSpellIds({ damageOut }, new Set(["me"])).has("Fire Blast"),
    ).toBe(true);
  });

  it("被吸收的命中按它自己的攻击技能计(attackSpellId);延迟盾的行不算(fact7 D53)", () => {
    const row = (attackSpellId: string, amount: number, shield = "17") =>
      ({
        spellId: shield,
        attackSpellId,
        attackSpellName: "",
        effectiveAmount: amount,
        logLine: { event: "SPELL_ABSORBED" },
      }) as never;
    const ids = getHighValueSpellIds({
      damageOut: [
        hit("11366", -900_000), // Pyroblast
        row("108853", 60_000), // Fire Blast, 6.2 %, all of it absorbed
        row("133", 900_000, "386124"), // a Fel Armor row: no damage yet
      ],
    });
    expect(ids.has("Fire Blast")).toBe(true);
    expect(ids.has("Fireball")).toBe(false);
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
    expect([...ids].sort()).toEqual(["Mortal Strike", "Overpower"]);
  });

  it("没有任何伤害时不过滤:返回全部技能", () => {
    expect([...getHighValueSpellIds({ damageOut: [hit("12294", 0)] })]).toEqual([
      "Mortal Strike",
    ]);
  });
});

describe("offensiveWasteAnalysis — buildOffensiveWasteSummary", () => {
  const matchStart = 1_000_000;
  const combat = makeCombat(matchStart, matchStart + 60_000);

  it("returns empty events when there are no defense windows or casts", () => {
    const friend = makeUnit("friend-1", {
      reaction: CombatUnitReaction.Friendly,
    });
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
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "62618",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "62618",
          matchStart + 22_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "99999999",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "99999999",
          matchStart + 22_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
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
      damageOut: [makeDamageEvent(matchStart + 5_000, 100_000, "enemy-1")],
      spellCastEvents: [
        makeSpellCastEvent(
          "12294",
          matchStart + 11_000,
          "enemy-1",
          "EnemyPaladin",
          "warrior-1",
          "Ares",
          0,
          "Mortal Strike",
        ),
        makeSpellCastEvent(
          "12294",
          matchStart + 13_000,
          "enemy-1",
          "EnemyPaladin",
          "warrior-1",
          "Ares",
          0,
          "Mortal Strike",
        ),
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
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "642",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "642",
          matchStart + 18_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
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

  it("fact5 D7: Execute's cast 281000 lands as 260798 — the casts are matched to the damage share by the spell, so they count", () => {
    const friend = makeUnit("warrior-1", {
      name: "Ares",
      spec: CombatUnitSpec.Warrior_Arms,
      class: CombatUnitClass.Warrior,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [11_000, 13_000].map((dt) =>
        makeSpellCastEvent(
          "281000",
          matchStart + dt,
          "enemy-1",
          "EnemyPaladin",
          "warrior-1",
          "Ares",
          0,
          "Execute",
        ),
      ),
    });
    friend.damageOut = [
      {
        ...makeDamageEvent(matchStart + 5_000, 100_000, "enemy-1"),
        spellId: "260798",
        spellName: "Execute",
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
    expect(summary.events[0]!.wasteCasts.map((c) => c.spellId)).toEqual([
      "281000",
      "281000",
    ]);
  });

  it("round-1 retest idx 43: a spell of a school the immunity does not cover is no waste (Chaos Bolt into Blessing of Protection)", () => {
    const friend = makeUnit("lock-1", {
      name: "Lock",
      spec: CombatUnitSpec.Warlock_Destruction,
      class: CombatUnitClass.Warlock,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        makeSpellCastEvent(
          "116858",
          matchStart + 11_000,
          "enemy-1",
          "EnemyDK",
          "lock-1",
          "Lock",
          0,
          "Chaos Bolt",
        ),
        makeSpellCastEvent(
          "116858",
          matchStart + 13_000,
          "enemy-1",
          "EnemyDK",
          "lock-1",
          "Lock",
          0,
          "Chaos Bolt",
        ),
      ],
    });
    friend.damageOut = [
      {
        ...makeDamageEvent(matchStart + 5_000, 100_000, "enemy-1"),
        spellId: "116858",
      },
    ] as never;
    const enemy = makeUnit("enemy-1", {
      name: "EnemyDK",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "1022",
          matchStart + 10_000,
          "enemy-2",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "1022",
          matchStart + 18_000,
          "enemy-2",
          "enemy-1",
          "BUFF",
        ),
      ],
    });
    expect(
      buildOffensiveWasteSummary(combat, [friend], [enemy]).events,
    ).toHaveLength(0);
  });

  it("round-1 retest idx 107: a cast the target REFLECTED did not land inside the window", () => {
    const friend = makeUnit("warrior-1", {
      name: "Ares",
      spec: CombatUnitSpec.Warrior_Arms,
      class: CombatUnitClass.Warrior,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        makeSpellCastEvent(
          "12294",
          matchStart + 11_000,
          "enemy-1",
          "EnemyPaladin",
          "warrior-1",
          "Ares",
          0,
          "Mortal Strike",
        ),
        makeSpellCastEvent(
          "12294",
          matchStart + 13_000,
          "enemy-1",
          "EnemyPaladin",
          "warrior-1",
          "Ares",
          0,
          "Mortal Strike",
        ),
      ],
    });
    friend.damageOut = [
      {
        ...makeDamageEvent(matchStart + 5_000, 100_000, "enemy-1"),
        spellId: "12294",
      },
    ] as never;
    (friend as { missesOut?: unknown[] }).missesOut = [
      {
        spellId: "12294",
        destUnitId: "enemy-1",
        missType: "REFLECT",
        timestamp: matchStart + 13_050,
      },
    ];
    const enemy = makeUnit("enemy-1", {
      name: "EnemyPaladin",
      spec: CombatUnitSpec.Paladin_Holy,
      class: CombatUnitClass.Paladin,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "642",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "642",
          matchStart + 18_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
      ],
    });
    // one of the two presses bounced: below the 2-cast threshold
    expect(
      buildOffensiveWasteSummary(combat, [friend], [enemy]).events,
    ).toHaveLength(0);
  });

  it("does NOT flag unconditional immunity if only 1 cast was pressed (threshold is 2)", () => {
    const friend = makeUnit("warrior-1", {
      name: "Ares",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [
        makeSpellCastEvent(
          "12294",
          matchStart + 11_000,
          "enemy-1",
          "EnemyPaladin",
        ),
      ],
    });

    const enemy = makeUnit("enemy-1", {
      name: "EnemyPaladin",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "642",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "642",
          matchStart + 18_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
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
        makeSpellCastEvent(
          "408",
          matchStart + 11_000,
          "enemy-1",
          "EnemyPaladin",
          "rogue-1",
          "Sneaky",
          0,
          "Kidney Shot",
        ),
        makeSpellCastEvent(
          "408",
          matchStart + 12_000,
          "enemy-1",
          "EnemyPaladin",
          "rogue-1",
          "Sneaky",
          0,
          "Kidney Shot",
        ),
      ],
    });

    const enemy = makeUnit("enemy-1", {
      name: "EnemyPaladin",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "642",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "642",
          matchStart + 18_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
      ],
    });

    const summary = buildOffensiveWasteSummary(combat, [friend], [enemy]);
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]!.wasteCasts).toHaveLength(2);
  });

  it("codex 20-F16-09 #4: Polymorphs into Aspect of the Turtle (no school mask) still count — the avoidance table says it stops them", () => {
    const friend = makeUnit("mage-1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Frost,
      reaction: CombatUnitReaction.Friendly,
      damageOut: [
        {
          ...makeDamageEvent(matchStart + 5_000, 200_000, "enemy-1"),
          spellId: "116",
        },
      ],
      spellCastEvents: [
        makeSpellCastEvent(
          "118",
          matchStart + 11_000,
          "enemy-1",
          "EnemyHunter",
          "mage-1",
          "Mage",
          0,
          "Polymorph",
        ),
        makeSpellCastEvent(
          "118",
          matchStart + 13_000,
          "enemy-1",
          "EnemyHunter",
          "mage-1",
          "Mage",
          0,
          "Polymorph",
        ),
      ],
    });
    const enemy = makeUnit("enemy-1", {
      name: "EnemyHunter",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "186265",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "186265",
          matchStart + 18_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
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
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "61336",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "61336",
          matchStart + 16_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
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
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "61336",
          matchStart + 10_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "61336",
          matchStart + 16_000,
          "enemy-1",
          "enemy-1",
          "BUFF",
        ),
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
    expect(formatted).toContain(
      "[1:05] Arms Warrior (Ares): Mortal Strike ×2 + Bloodthirst into EnemyPaladin's Divine Shield",
    );
    // FT-T15 M5: the section defines itself — its "DR" is damage reduction
    // (the timeline legend's `[DR: …]` is diminishing returns), and the
    // listing rule is stated with the predicate's own numbers.
    const lines = formatted.split("\n");
    expect(lines[0]).toBe("ABILITIES INTO IMMUNITY/DR");
    const isEventLine = (l: string) => /^\s*\[\d+:\d\d\]/.test(l);
    const definition = lines
      .slice(1)
      .filter((l) => !isEventLine(l))
      .join(" ");
    expect(definition).toContain(
      "DR here = damage reduction, not the timeline's `[DR: …]` diminishing returns",
    );
    expect(definition).toContain("from 2 casts");
    expect(definition).toContain("from 3 casts");
    expect(definition).toContain(
      `${KILL_LIVE_HP_PCT}% HP or lower while it was up`,
    );
    expect(definition).toContain("at least 5% of their damage this");
    // one event → one event line, whatever the definition's length
    expect(lines.filter(isEventLine)).toHaveLength(1);
  });
});

describe("offensiveWasteAnalysis — an empowered cast goes off at its release (codex 20-F18-01 #2)", () => {
  const matchStart = 1_000_000;
  const combat = makeCombat(matchStart, matchStart + 60_000);
  const hold = (event: string, t: number) =>
    ({
      spellId: "359073",
      spellName: "Eternity Surge",
      timestamp: matchStart + t,
      logLine: { event, timestamp: matchStart + t, parameters: [] },
    }) as never;
  it("a hold begun inside the wall and released after it is no cast into it", () => {
    const evoker = makeUnit("ev-1", {
      name: "Ev",
      spec: CombatUnitSpec.Evoker_Devastation,
      class: CombatUnitClass.Evoker,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [11_000, 12_000].map((dt) =>
        makeSpellCastEvent("359073", matchStart + dt, "enemy-1", "EnemyPaladin", "ev-1", "Ev", 0, "Eternity Surge"),
      ),
    });
    Object.assign(evoker, {
      empowerStarts: [hold("SPELL_EMPOWER_START", 11_000), hold("SPELL_EMPOWER_START", 12_000)],
      // released at 19 s and 19.5 s — after the wall's 18 s end
      empowerEnds: [hold("SPELL_EMPOWER_END", 19_000), hold("SPELL_EMPOWER_END", 19_500)],
      empowerInterrupts: [],
    });
    evoker.damageOut = [
      { ...makeDamageEvent(matchStart + 19_100, 100_000, "enemy-1"), spellId: "359077", spellName: "Eternity Surge" },
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
    expect(buildOffensiveWasteSummary(combat, [evoker], [enemy]).events).toEqual([]);
  });
});

describe("offensiveWasteAnalysis — a hold never released is no cast (codex 20-F18-03 #1)", () => {
  const matchStart = 1_000_000;
  const combat = makeCombat(matchStart, matchStart + 60_000);
  it("an EMPOWER_START with no END / INTERRUPT before the log ends counts nowhere", () => {
    const evoker = makeUnit("ev-1", {
      name: "Ev",
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [11_000, 17_800].map((dt) =>
        makeSpellCastEvent("359073", matchStart + dt, "enemy-1", "EnemyPaladin", "ev-1", "Ev", 0, "Eternity Surge"),
      ),
    });
    Object.assign(evoker, {
      empowerStarts: [11_000, 17_800].map((t) => ({
        spellId: "359073",
        spellName: "Eternity Surge",
        timestamp: matchStart + t,
        logLine: { event: "SPELL_EMPOWER_START", timestamp: matchStart + t, parameters: [] },
      })),
      empowerEnds: [],
      empowerInterrupts: [],
    });
    evoker.damageOut = [
      { ...makeDamageEvent(matchStart + 5_000, 100_000, "enemy-1"), spellId: "359077", spellName: "Eternity Surge" },
    ] as never;
    const enemy = makeUnit("enemy-1", {
      name: "EnemyPaladin",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "642", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "642", matchStart + 18_000, "enemy-1", "enemy-1", "BUFF"),
      ],
    });
    expect(buildOffensiveWasteSummary(combat, [evoker], [enemy]).events).toEqual([]);
  });
});

describe("offensiveWasteAnalysis — a travelling spell counts where it landed (fact7 D52)", () => {
  const matchStart = 1_000_000;
  const combat = makeCombat(matchStart, matchStart + 60_000);
  const PYROBLAST = "11366";
  const press = (dt: number) =>
    makeSpellCastEvent(PYROBLAST, matchStart + dt, "enemy-1", "EnemyPriest", "mage-1", "Mage", 0, "Pyroblast");
  const hit = (dt: number, event = LogEvent.SPELL_DAMAGE) => {
    const row = makeDamageEvent(matchStart + dt, 100_000, "enemy-1");
    return {
      ...row,
      spellId: PYROBLAST,
      spellName: "Pyroblast",
      logLine: { ...(row.logLine as object), event },
    };
  };
  const mage = (presses: number[], hits: unknown[], misses: unknown[] = []) =>
    Object.assign(
      makeUnit("mage-1", {
        name: "Mage",
        spec: CombatUnitSpec.Mage_Fire,
        class: CombatUnitClass.Mage,
        reaction: CombatUnitReaction.Friendly,
        spellCastEvents: presses.map(press),
        damageOut: hits as never,
      }),
      { missesOut: misses as never },
    );
  // Pain Suppression, 10 s .. 18 s
  const priest = makeUnit("enemy-1", {
    name: "EnemyPriest",
    spec: CombatUnitSpec.Priest_Discipline,
    class: CombatUnitClass.Priest,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "33206", matchStart + 10_000, "enemy-1", "enemy-1", "BUFF"),
      makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "33206", matchStart + 18_000, "enemy-1", "enemy-1", "BUFF"),
    ],
  });
  const countOf = (unit: ReturnType<typeof mage>) =>
    buildOffensiveWasteSummary(combat, [unit], [priest]).events[0]?.wasteCasts.length ?? 0;

  it("7e7b1e51 0:41:按下在减伤前、落地在减伤内的一发算进去", () => {
    expect(
      countOf(mage([9_700, 11_000, 12_000], [hit(10_100), hit(11_400), hit(12_400)])),
    ).toBe(3);
  });

  it("按下在减伤内、落地在减伤结束后的一发不算", () => {
    expect(
      countOf(mage([11_000, 12_000, 13_000, 17_800], [hit(11_400), hit(12_400), hit(13_400), hit(18_200)])),
    ).toBe(3);
  });

  it("同一毫秒两次按下是两发,各吃一行命中(7e7b1e51 0:44)", () => {
    expect(
      countOf(mage([11_000, 11_000, 12_000], [hit(11_500), hit(11_500), hit(12_400)])),
    ).toBe(3);
  });

  it("整发被吸收:落地行是 SPELL_MISSED,同刻的 SPELL_ABSORBED 不再占一行", () => {
    const miss = {
      spellId: PYROBLAST,
      spellName: "Pyroblast",
      destUnitId: "enemy-1",
      missType: "ABSORB",
      timestamp: matchStart + 10_100,
    };
    expect(
      countOf(mage([9_700, 11_000, 12_000], [hit(10_100, LogEvent.SPELL_ABSORBED), hit(11_400), hit(12_400)], [miss])),
    ).toBe(3);
  });

  it("日志里没有落地行的按下,仍取按下时刻", () => {
    expect(
      countOf(mage([9_700, 11_000, 12_000, 13_000], [hit(11_400), hit(12_400), hit(13_400)])),
    ).toBe(3);
  });

  it("频道后面的跳不算下一发的落地:一行只属一发,且从下一发自己的时刻往后找", () => {
    const presses = [1_000, 4_000].map((atMs) => ({
      spellId: PYROBLAST,
      spellName: "Pyroblast",
      destUnitId: "enemy-1",
      atMs,
    }));
    const damageOut = [100, 1_200, 2_000, 4_300].map((t) => ({
      ...hit(0),
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: t },
    }));
    const landed = pressLandingsMs(presses, (p) => p.atMs, { id: "mage-1", damageOut } as never, []);
    expect(presses.map((p) => landed.get(p))).toEqual([1_200, 4_300]);
  });

  it("被吸收干净的一跳(SPELL_PERIODIC_MISSED)也是跳,不是这一发的落地行", () => {
    const presses = [
      { spellId: PYROBLAST, spellName: "Pyroblast", destUnitId: "enemy-1", atMs: 1_000 },
    ];
    const tick = {
      spellId: PYROBLAST,
      spellName: "Pyroblast",
      destUnitId: "enemy-1",
      missType: "ABSORB",
      timestamp: 1_600,
      logLine: { event: LogEvent.SPELL_PERIODIC_MISSED, timestamp: 1_600 },
    };
    const landed = pressLandingsMs(
      presses,
      (p) => p.atMs,
      { id: "mage-1", damageOut: [], missesOut: [tick] } as never,
      [],
    );
    expect(landed.get(presses[0]!)).toBe(1_000);
  });
});

describe("parryStopsAttack — what a parry can stop (fact7 r5)", () => {
  it("Final Verdict (12 yd) reads parried-class, reach does not decide it", () => {
    expect(parryStopsAttack("383328")).toBe(true);
  });

  it("Kill Command reads by the row it landed as: the press 34026 is type 0, the pet's 83381 is melee", () => {
    expect(parryStopsAttack("34026", "83381")).toBe(true);
    expect(parryStopsAttack("34026", "1232922")).toBe(true);
  });

  it("Hammer of Wrath (a missile) and Garrote (No Active Defense) do not", () => {
    expect(parryStopsAttack("24275")).toBe(false);
    expect(parryStopsAttack("703")).toBe(false);
  });

  it("a type-0 press reads its landing row: Penance 47540 lands as magic 47666", () => {
    expect(parryStopsAttack("47540", "47666")).toBe(false);
  });

  it("an id in neither table falls to reach; an unknown reach reads as melee", () => {
    for (const id of ["34026", "264735", "47540"]) {
      expect(PARRYABLE_SPELL_IDS.has(id)).toBe(false);
      expect(UNPARRYABLE_SPELL_IDS.has(id)).toBe(false);
    }
    expect(parryStopsAttack("264735")).toBe(false); // Survival of the Fittest
    expect(parryStopsAttack("no-such-spell")).toBe(true);
  });
});

describe("Die by the Sword's two readings (fact7 r5)", () => {
  const start = 1_000_000;
  const run = (spellId: string, spellName: string) => {
    const friend = makeUnit("friend-1", {
      name: "Friend",
      reaction: CombatUnitReaction.Friendly,
      damageOut: [
        {
          ...makeDamageEvent(start + 5_000, 100_000, "warrior-1"),
          spellId,
          spellName,
        },
      ],
      spellCastEvents: [11_000, 13_000].map((t) =>
        makeSpellCastEvent(
          spellId,
          start + t,
          "warrior-1",
          "Warrior",
          "friend-1",
          "Friend",
          0,
          spellName,
        ),
      ),
    });
    const enemy = makeUnit("warrior-1", {
      name: "Warrior",
      reaction: CombatUnitReaction.Hostile,
      auraEvents: (
        [
          [LogEvent.SPELL_AURA_APPLIED, 10_000],
          [LogEvent.SPELL_AURA_REMOVED, 18_000],
        ] as const
      ).map(([event, t]) =>
        makeAuraEvent(
          event,
          "118038",
          start + t,
          "warrior-1",
          "warrior-1",
          "BUFF",
        ),
      ),
    });
    return buildOffensiveWasteSummary(
      makeCombat(start, start + 60_000),
      [friend],
      [enemy],
    ).events;
  };

  it("two Final Verdicts are the parry line, not the spell line's three-cast gate", () => {
    const events = run("383328", "Final Verdict");
    expect(events).toHaveLength(1);
    expect(events[0]!.verdict).toBe("unconditional");
  });

  it("two Hammers of Wrath stay on the gated line, under its three casts", () => {
    expect(run("24275", "Hammer of Wrath")).toEqual([]);
  });
});

describe("pressLandingRows — the attack a press landed as (fact7 r5)", () => {
  const press = {
    spellId: "34026",
    spellName: "Kill Command",
    destUnitId: "enemy-1",
    atMs: 1_000,
  };
  const miss = {
    spellId: "83381",
    spellName: "Kill Command",
    destUnitId: "enemy-1",
    missType: "PARRY",
    timestamp: 1_100,
    logLine: { event: LogEvent.SPELL_MISSED, timestamp: 1_100 },
  };
  const hunter = { id: "hunter-1", damageOut: [] } as never;

  it("reads a pet's parried row through the owner", () => {
    const caster = pressLandingCaster(hunter, [
      { ownerId: "hunter-1", missesOut: [miss] },
      { ownerId: "other", missesOut: [{ ...miss, destUnitId: "x" }] },
    ] as never);
    const rows = pressLandingRows([press], (p) => p.atMs, caster, []);
    expect(rows.get(press)).toEqual({ atMs: 1_100, spellId: "83381" });
  });

  it("a press that landed as an aura has no attack row", () => {
    const aura = {
      srcUnitId: "hunter-1",
      spellId: "34026",
      spellName: "Kill Command",
      logLine: { event: LogEvent.SPELL_AURA_APPLIED, timestamp: 1_050 },
    };
    const rows = pressLandingRows(
      [press],
      (p) => p.atMs,
      hunter,
      [{ id: "enemy-1", auraEvents: [aura] }] as never,
    );
    expect(rows.get(press)).toEqual({ atMs: 1_050, spellId: null });
  });
});
