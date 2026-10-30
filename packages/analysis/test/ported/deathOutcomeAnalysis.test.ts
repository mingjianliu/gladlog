/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import { canonicalSpellId } from "../../src/utils/cooldowns";
import {
  buildDeathOutcomeSummary,
  EXTERNAL_DEFENSIVE_SPELLS,
  formatDeathOutcomeForContext,
  wasLockedOutByStunOnly,
  wasLockedOutThroughWindow,
} from "../../src/utils/deathOutcomeAnalysis";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;
const MATCH_END = 1_300_000;

function makeCombat() {
  return {
    startTime: MATCH_START,
    endTime: MATCH_END,
    startInfo: { zoneId: "1505" },
  };
}

function makeDeadUnit(
  id: string,
  deathTimestampMs: number,
  overrides: any = {},
) {
  const u = makeUnit(id, overrides) as any;
  u.deathRecords = [
    { timestamp: deathTimestampMs, event: LogEvent.UNIT_DIED, parameters: [] },
  ];
  return u;
}

function makeCCSummary(playerName: string, instances: any[] = []): any {
  return { playerName, ccInstances: instances };
}

describe("buildDeathOutcomeSummary — immunity checks", () => {
  it("returns empty events when no friendly deaths occurred", () => {
    const result = buildDeathOutcomeSummary(makeCombat() as any, [], []);
    expect(result.events).toHaveLength(0);
  });

  it("flags Divine Shield available at death when never used", () => {
    const dead = makeDeadUnit("p1", MATCH_START + 10_000, {
      spec: CombatUnitSpec.Paladin_Retribution,
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [dead],
      [makeCCSummary("p1")],
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].availableImmunities).toHaveLength(1);
    expect(result.events[0].availableImmunities[0].spellName).toBe(
      "Divine Shield",
    );
  });

  it("does NOT flag Divine Shield when it was used recently (still on CD)", () => {
    const dead = makeDeadUnit("p1", MATCH_START + 40_000, {
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [makeSpellCastEvent("642", MATCH_START + 10_000, "p1")],
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [dead],
      [makeCCSummary("p1")],
    );
    expect(result.events[0]?.availableImmunities ?? []).toHaveLength(0);
  });

  it("flags Ice Block available when Cold Snap reset the cooldown (B30)", () => {
    const dead = makeDeadUnit("p1", MATCH_START + 40_000, {
      spec: CombatUnitSpec.Mage_Frost,
      spellCastEvents: [
        // Ice Block cast at t=10s (CD=240s)
        makeSpellCastEvent(
          "45438",
          MATCH_START + 10_000,
          "p1",
          "Self",
          "p1",
          "Mage",
        ),
        // Cold Snap cast at t=20s (Resets Ice Block)
        makeSpellCastEvent(
          "235219",
          MATCH_START + 20_000,
          "p1",
          "Self",
          "p1",
          "Mage",
        ),
      ],
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [dead],
      [makeCCSummary("p1")],
    );
    expect(result.events[0].availableImmunities).toHaveLength(1);
    expect(result.events[0].availableImmunities[0].spellName).toBe("Ice Block");
  });

  it("correctly handles multiple lockout intervals via binary search (B29)", () => {
    const dead = makeUnit("p1", {
      spec: CombatUnitSpec.Mage_Frost,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "41425",
          MATCH_START + 10_000,
          "p1",
          "p1",
          "DEBUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "41425",
          MATCH_START + 20_000,
          "p1",
          "p1",
          "DEBUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "41425",
          MATCH_START + 40_000,
          "p1",
          "p1",
          "DEBUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "41425",
          MATCH_START + 50_000,
          "p1",
          "p1",
          "DEBUFF",
        ),
      ],
    }) as any;
    // Three deaths: 15s (locked), 30s (free), 45s (locked)
    dead.deathRecords = [
      {
        timestamp: MATCH_START + 15_000,
        event: LogEvent.UNIT_DIED,
        parameters: [],
      },
      {
        timestamp: MATCH_START + 30_000,
        event: LogEvent.UNIT_DIED,
        parameters: [],
      },
      {
        timestamp: MATCH_START + 45_000,
        event: LogEvent.UNIT_DIED,
        parameters: [],
      },
    ];

    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [dead],
      [makeCCSummary("p1")],
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].atSeconds).toBe(30);
  });

  it('C3: annotates "was in CC" when CC-locked through the window even if free at the death tick', () => {
    // Ret Paladin dies at 10s with Divine Shield available; CC covers [5,9.9] (window [5,10]),
    // but has ended by the exact death tick (10) — the old death-instant check said "not CC'd".
    const dead = makeDeadUnit("p1", MATCH_START + 10_000, {
      spec: CombatUnitSpec.Paladin_Retribution,
    });
    const ccSummary = makeCCSummary("p1", [
      { atSeconds: 5, durationSeconds: 4.9, trinketState: "available_unused" },
    ]);
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [dead],
      [ccSummary],
    );
    const out = formatDeathOutcomeForContext(result);
    expect(out).toContain("Divine Shield available, was in CC");
  });
});

describe("buildDeathOutcomeSummary — external defensive checks", () => {
  it("flags missed Ironbark when Druid was free and had it available", () => {
    const warrior = makeDeadUnit("w1", MATCH_START + 90_000, {
      spec: CombatUnitSpec.Warrior_Arms,
      name: "Warrior",
    });
    const druid = makeUnit("d1", {
      spec: CombatUnitSpec.Druid_Restoration,
      name: "Druid",
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [warrior, druid],
      [makeCCSummary("Warrior"), makeCCSummary("Druid")],
    );
    expect(result.events[0].missedExternals).toHaveLength(1);
    expect(result.events[0].missedExternals[0].spellName).toBe("Ironbark");
  });

  it("skips Ironbark when Druid was too far away (>40 yards) at death time (B27)", () => {
    const warrior = makeDeadUnit("w1", MATCH_START + 90_000, {
      spec: CombatUnitSpec.Warrior_Arms,
      name: "Warrior",
      advancedActions: [makeAdvancedAction(MATCH_START + 90_000, 0, 0)],
    });
    const druid = makeUnit("d1", {
      spec: CombatUnitSpec.Druid_Restoration,
      name: "Druid",
      advancedActions: [makeAdvancedAction(MATCH_START + 90_000, 50, 0)],
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [warrior, druid],
      [makeCCSummary("Warrior"), makeCCSummary("Druid")],
    );
    expect(result.events[0]?.missedExternals ?? []).toHaveLength(0);
  });

  it("flags missed Blessing of Sacrifice when a Paladin teammate had it available", () => {
    const warrior = makeDeadUnit("w1", MATCH_START + 90_000, {
      spec: CombatUnitSpec.Warrior_Arms,
      name: "Warrior",
    });
    const paladin = makeUnit("p1", {
      spec: CombatUnitSpec.Paladin_Holy,
      name: "Paladin",
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [warrior, paladin],
      [makeCCSummary("Warrior"), makeCCSummary("Paladin")],
    );
    const names = result.events[0].missedExternals.map((e) => e.spellName);
    expect(names).toContain("Blessing of Sacrifice");
  });

  // Triage crisis-external F-A9 (user ruling P-A9 = A, 2026-10-01): 199448 is
  // the id the Ultimate Sacrifice PvP talent swaps in for 6940 — one button.
  // A press of it is a press of the one roster row; there is no second row.
  it("a Blessing of Sacrifice pressed as 199448 puts the one 6940 row on cooldown, and never lists twice", () => {
    expect(canonicalSpellId("199448")).toBe("6940");
    expect(EXTERNAL_DEFENSIVE_SPELLS["199448"]).toBeUndefined();
    const warrior = makeDeadUnit("w1", MATCH_START + 90_000, {
      spec: CombatUnitSpec.Warrior_Arms,
      name: "Warrior",
    });
    const pressedAt = (ms: number) =>
      makeUnit("p1", {
        spec: CombatUnitSpec.Paladin_Holy,
        name: "Paladin",
        spellCastEvents: [
          makeSpellCastEvent("199448", ms, "w1", "Warrior", "p1", "Paladin"),
        ],
      });
    const namesWith = (paladin: unknown) =>
      buildDeathOutcomeSummary(
        makeCombat() as any,
        [warrior, paladin as any],
        [makeCCSummary("Warrior"), makeCCSummary("Paladin")],
      ).events[0].missedExternals.map((e) => e.spellName);
    // pressed 30 s before the death: on cooldown, not "available"
    expect(namesWith(pressedAt(MATCH_START + 60_000))).not.toContain(
      "Blessing of Sacrifice",
    );
    // pressed long ago: available again — once
    expect(
      namesWith(pressedAt(MATCH_START - 500_000)).filter(
        (n) => n === "Blessing of Sacrifice",
      ),
    ).toHaveLength(1);
  });

  it("flags missed external when teammate cast the spell this match (B113)", () => {
    // Cast at MATCH_START - 500s (so it's available at t=90s)
    const warrior = makeDeadUnit("w1", MATCH_START + 90_000, {
      spec: CombatUnitSpec.Warrior_Arms,
      name: "Warrior",
    });
    const spriest = makeUnit("p1", {
      spec: CombatUnitSpec.Priest_Shadow,
      name: "Priest",
      spellCastEvents: [
        makeSpellCastEvent(
          "47788",
          MATCH_START - 500_000,
          "w1",
          "Warrior",
          "p1",
          "Priest",
        ),
      ], // GS
    });
    const result = buildDeathOutcomeSummary(
      makeCombat() as any,
      [warrior, spriest],
      [makeCCSummary("Warrior"), makeCCSummary("Priest")],
    );
    expect(result.events[0].missedExternals).toHaveLength(1);
    expect(result.events[0].missedExternals[0].spellName).toBe(
      "Guardian Spirit",
    );
  });
});

describe("formatDeathOutcomeForContext", () => {
  it("formats multiple events correctly", () => {
    const summary: any = {
      events: [
        {
          deadPlayer: "P1",
          deadPlayerSpec: "Arms Warrior",
          atSeconds: 100,
          availableImmunities: [{ spellName: "Shield", wasInCC: true }],
          missedExternals: [
            { casterName: "C1", spellName: "Bark", casterWasInCC: false },
          ],
        },
      ],
    };
    const res = formatDeathOutcomeForContext(summary);
    expect(res).toContain("1:40");
    expect(res).toContain("had Shield available, was in CC");
    expect(res).toContain("C1 had Bark available, caster was free");
  });

  it("returns empty for no events", () => {
    expect(formatDeathOutcomeForContext({ events: [] })).toBe("");
  });
});

describe("wasLockedOutThroughWindow", () => {
  const cc = (
    atSeconds: number,
    durationSeconds: number,
    trinketState = "available_unused",
    category?: string,
  ): any => ({
    atSeconds,
    durationSeconds,
    trinketState,
    ...(category ? { drInfo: { category } } : {}),
  });

  it("locks out when CC covers the window but the player is free at the death tick", () => {
    // death at 10; window [5,10]; CC [5,9.9] leaves only a 0.1s free tail
    const summary = { playerName: "p", ccInstances: [cc(5, 4.9)] };
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(true);
  });

  it("does NOT lock out when there is a >= 1s free gap mid-window", () => {
    // death at 10; window [5,10]; stuns [5,6] and [9,9.5] leave a 3s gap
    const summary = { playerName: "p", ccInstances: [cc(5, 1), cc(9, 0.5)] };
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(false);
  });

  it("locks out when CC fully spans the window", () => {
    const summary = { playerName: "p", ccInstances: [cc(4, 7)] }; // [4,11] covers [5,10]
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(true);
  });

  it("does NOT lock out when there is no CC", () => {
    expect(
      wasLockedOutThroughWindow({ playerName: "p", ccInstances: [] }, 10),
    ).toBe(false);
  });

  it("counts CC the player trinketed out of until the press (ruling A′8, 2026-09-30)", () => {
    // CC 5–9.9, trinketed at its removal: window [5, 10] has a 0.1 s gap
    const summary = { playerName: "p", ccInstances: [cc(5, 4.9, "used")] };
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(true);
    // the press ends it: trinketed at 6, the rest of the window is free
    const early = { playerName: "p", ccInstances: [cc(5, 1, "used")] };
    expect(wasLockedOutThroughWindow(early, 10)).toBe(false);
  });

  it("clamps the window to match start for an early death", () => {
    // death at 3; window clamps to [0,3]; CC [0,3] fully covers it
    const summary = { playerName: "p", ccInstances: [cc(0, 3)] };
    expect(wasLockedOutThroughWindow(summary, 3)).toBe(true);
  });
});

/**
 * Finding #1 (2026-08-14 final review): USABLE_WHILE_CC_SPELL_IDS is a
 * stunned-only table (DB2's "usable while stunned" bits) — checking it
 * against a lockout window that contains non-stun hard CC (fear/disorient/
 * incap) over-accuses. wasLockedOutByStunOnly is the CC-type-aware sibling
 * of wasLockedOutThroughWindow that consumers must AND together with a
 * USABLE_WHILE_CC_SPELL_IDS hit before treating a locked-out wall as
 * "usable, still blame".
 */
describe("wasLockedOutByStunOnly", () => {
  const cc = (
    atSeconds: number,
    durationSeconds: number,
    category: string | undefined,
    trinketState = "available_unused",
  ): any => ({
    atSeconds,
    durationSeconds,
    trinketState,
    ...(category ? { drInfo: { category } } : {}),
  });

  it("true when the whole lockout window is Stun-category", () => {
    const summary = { playerName: "p", ccInstances: [cc(4, 7, "Stun")] }; // [4,11] covers [5,10]
    expect(wasLockedOutByStunOnly(summary, 10)).toBe(true);
  });

  it("false when the lockout window contains a non-stun hard CC (fear), even though fully locked out", () => {
    const summary = { playerName: "p", ccInstances: [cc(4, 7, "Disorient")] };
    expect(wasLockedOutThroughWindow(summary, 10)).toBe(true); // still locked out
    expect(wasLockedOutByStunOnly(summary, 10)).toBe(false); // but not stun-only
  });

  it("false when stun and a non-stun CC both overlap the window (mixed)", () => {
    const summary = {
      playerName: "p",
      ccInstances: [cc(4, 7, "Stun"), cc(6, 2, "Incapacitate")],
    };
    expect(wasLockedOutByStunOnly(summary, 10)).toBe(false);
  });

  it("false when the CC's DR category is unknown (drInfo absent) — conservative default", () => {
    const summary = { playerName: "p", ccInstances: [cc(4, 7, undefined)] };
    expect(wasLockedOutByStunOnly(summary, 10)).toBe(false);
  });

  it("false when not locked out at all, even if the (partial) CC is stun", () => {
    // gap of 3s mid-window
    const summary = {
      playerName: "p",
      ccInstances: [cc(5, 1, "Stun"), cc(9, 0.5, "Stun")],
    };
    expect(wasLockedOutByStunOnly(summary, 10)).toBe(false);
  });

  it("false when there is no CC", () => {
    expect(
      wasLockedOutByStunOnly({ playerName: "p", ccInstances: [] }, 10),
    ).toBe(false);
  });

  it("a trinketed Disorient locks (A′8) but is not a stun-only lockout", () => {
    const summary = {
      playerName: "p",
      ccInstances: [cc(5, 4.9, "Disorient", "used")],
    };
    expect(wasLockedOutByStunOnly(summary, 10)).toBe(false);
  });
});
