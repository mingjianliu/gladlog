/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import {
  analyzeBurstLedger,
  auditWindowTargeting,
} from "../../src/utils/burstLedger";
import type { IOffensiveWindow } from "../../src/utils/offensiveWindows";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;

function makeCombat() {
  return { startTime: MATCH_START, endTime: MATCH_START + 120_000 } as any;
}

/** damageOut event from player-1 to the given enemy. */
function dmgOut(timestamp: number, amount: number, destUnitId: string): any {
  return {
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp, parameters: [] },
    timestamp,
    effectiveAmount: amount,
    amount,
    srcUnitId: "p1",
    srcUnitName: "Player",
    destUnitId,
    destUnitName: destUnitId,
    spellId: "1",
    spellName: "TestSpell",
  };
}

const info = { teamId: "0", specId: "x" } as any;

describe("burstLedger — burst grouping and audit", () => {
  it("groups close casts into one burst, far casts into two (D1-B1)", () => {
    // 31884 Avenging Wrath (offensive, 20s buff): casts at 10s and 15s overlap
    // (buff reach), the 80s cast is separate.
    const player = makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
        makeSpellCastEvent(
          "190319",
          MATCH_START + 15_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Combustion",
        ),
        makeSpellCastEvent(
          "31884",
          MATCH_START + 80_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
      ],
    } as any);
    const enemy = makeUnit("e1", { name: "Enemy", info } as any);

    const entries = analyzeBurstLedger(player, [], [enemy], makeCombat());
    expect(entries).toHaveLength(2);
    expect(entries[0].spells).toHaveLength(2);
    expect(entries[0].fromSeconds).toBe(10);
    expect(entries[1].spells).toHaveLength(1);
    expect(entries[1].fromSeconds).toBe(80);
  });

  it("attributes damage per enemy target and picks the dominant one (D1-B2)", () => {
    const player = makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut: [
        dmgOut(MATCH_START + 12_000, -80_000, "e1"),
        dmgOut(MATCH_START + 14_000, -20_000, "e2"),
        dmgOut(MATCH_START + 90_000, -999_000, "e1"), // outside the burst
      ],
    } as any);
    const e1 = makeUnit("e1", { name: "Healer", info } as any);
    const e2 = makeUnit("e2", { name: "Tank", info } as any);

    const entries = analyzeBurstLedger(player, [], [e1, e2], makeCombat());
    expect(entries).toHaveLength(1);
    expect(entries[0].totalDamage).toBe(100_000);
    expect(entries[0].dominantTarget?.unitName).toBe("Healer");
    expect(entries[0].dominantTarget?.damage).toBe(80_000);
    expect(entries[0].damageByTarget).toHaveLength(2);
  });

  it("flags immunity/defensive auras active on the dominant target (D1-B3)", () => {
    const player = makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut: [dmgOut(MATCH_START + 12_000, -50_000, "e1")],
    } as any);
    // 642 Divine Shield active 11s–17s — 6s inside the burst span
    const e1 = makeUnit("e1", {
      name: "Pally",
      info,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "642",
          MATCH_START + 11_000,
          "e1",
          "e1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "642",
          MATCH_START + 17_000,
          "e1",
          "e1",
          "BUFF",
        ),
      ],
    } as any);

    const entries = analyzeBurstLedger(player, [], [e1], makeCombat());
    const hits = entries[0].dominantTarget?.defensivesHit ?? [];
    expect(hits).toHaveLength(1);
    expect(hits[0].isImmunity).toBe(true);
    expect(hits[0].overlapSeconds).toBeCloseTo(6, 0);
  });

  it("appliedByOther:别人给目标上的墙(塑焰者黑曜鳞片给队友)和目标自己开的墙分开标记", () => {
    const mkPlayer = () =>
      makeUnit("p1", {
        name: "Ret",
        spec: CombatUnitSpec.Paladin_Retribution,
        info,
        spellCastEvents: [
          makeSpellCastEvent(
            "31884",
            MATCH_START + 10_000,
            "p1",
            "Self",
            "p1",
            "Ret",
            0,
            "Avenging Wrath",
          ),
        ],
        damageOut: [dmgOut(MATCH_START + 12_000, -50_000, "e1")],
      } as any);
    // makeAuraEvent stamps srcUnitName "Source" — not the target's name "Pally"
    // — so this is the ally-applied shape (the Evoker cast it ON the Pally).
    const byAlly = makeUnit("e1", {
      name: "Pally",
      info,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "363916", MATCH_START + 11_000, "evoker", "e1", "BUFF"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "363916", MATCH_START + 17_000, "evoker", "e1", "BUFF"),
      ],
    } as any);
    const hitsAlly = analyzeBurstLedger(mkPlayer(), [], [byAlly], makeCombat())[0]
      .dominantTarget?.defensivesHit ?? [];
    expect(hitsAlly).toHaveLength(1);
    expect(hitsAlly[0].appliedByOther).toBe(true);

    const bySelf = makeUnit("e1", {
      name: "Pally",
      info,
      auraEvents: [
        { ...makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "363916", MATCH_START + 11_000, "e1", "e1", "BUFF"), srcUnitName: "Pally" },
        { ...makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "363916", MATCH_START + 17_000, "e1", "e1", "BUFF"), srcUnitName: "Pally" },
      ],
    } as any);
    const hitsSelf = analyzeBurstLedger(mkPlayer(), [], [bySelf], makeCombat())[0]
      .dominantTarget?.defensivesHit ?? [];
    expect(hitsSelf).toHaveLength(1);
    expect(hitsSelf[0].appliedByOther).toBe(false);
  });

  it("reports ally CD overlap and target death credit (D1-B4)", () => {
    const player = makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut: [dmgOut(MATCH_START + 12_000, -50_000, "e1")],
    } as any);
    const ally = makeUnit("f2", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Fire,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "190319",
          MATCH_START + 13_000,
          "f2",
          "Self",
          "f2",
          "Mage",
          0,
          "Combustion",
        ),
      ],
    } as any);
    const e1 = makeUnit("e1", {
      name: "Victim",
      info,
      deathRecords: [{ timestamp: MATCH_START + 32_000 } as any],
    } as any);

    const entries = analyzeBurstLedger(player, [ally], [e1], makeCombat());
    expect(entries[0].allyCDsOverlapping).toEqual([
      { playerName: "Mage", spellName: "Combustion" },
    ]);
    // AW buff 20s → span ends at 30s; death at 32s is inside the 5s credit slack
    expect(entries[0].dominantTarget?.died).toBe(true);
  });

  it("samples dominant-target HP at burst edges when advanced data exists (D1-B5)", () => {
    const player = makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut: [dmgOut(MATCH_START + 12_000, -50_000, "e1")],
    } as any);
    const e1 = makeUnit("e1", {
      name: "Victim",
      info,
      advancedActions: [
        makeAdvancedAction(MATCH_START + 10_000, 0, 0, 100, 90),
        makeAdvancedAction(MATCH_START + 30_000, 0, 0, 100, 35),
      ],
    } as any);

    const entries = analyzeBurstLedger(player, [], [e1], makeCombat());
    expect(entries[0].dominantTarget?.hpStartPct).toBe(90);
    expect(entries[0].dominantTarget?.hpEndPct).toBe(35);
  });
});

describe("burstLedger — window targeting audit", () => {
  const window: IOffensiveWindow = {
    targetUnitId: "e1",
    targetName: "Healer",
    targetSpec: "Holy Paladin",
    fromSeconds: 20,
    toSeconds: 30,
    durationSeconds: 10,
    friendlyDamageInWindow: 0,
    friendlyOffensives: [],
    bursts: [],
  };

  it("computes on-target share and the top off-target (D1-T1)", () => {
    const player = makeUnit("p1", {
      name: "Ret",
      info,
      damageOut: [
        dmgOut(MATCH_START + 22_000, -30_000, "e1"),
        dmgOut(MATCH_START + 24_000, -70_000, "e2"),
      ],
    } as any);
    const e1 = makeUnit("e1", { name: "Healer", info } as any);
    const e2 = makeUnit("e2", { name: "Tank", info } as any);

    const audits = auditWindowTargeting(
      player,
      [window],
      [e1, e2],
      makeCombat(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].onTargetPct).toBe(30);
    expect(audits[0].topOffTarget?.unitName).toBe("Tank");
  });

  it("skips windows where the player dealt no damage (D1-T2)", () => {
    const player = makeUnit("p1", { name: "Ret", info } as any);
    const e1 = makeUnit("e1", { name: "Healer", info } as any);
    expect(
      auditWindowTargeting(player, [window], [e1], makeCombat()),
    ).toHaveLength(0);
  });

  it("skips windows shorter than the shared minimum (D1-T3)", () => {
    const player = makeUnit("p1", {
      name: "Ret",
      info,
      damageOut: [dmgOut(MATCH_START + 21_000, -30_000, "e1")],
    } as any);
    const e1 = makeUnit("e1", { name: "Healer", info } as any);
    const short = { ...window, toSeconds: 23, durationSeconds: 3 };
    expect(
      auditWindowTargeting(player, [short], [e1], makeCombat()),
    ).toHaveLength(0);
  });
});

describe("auditWindowTargeting — 目标死亡截断(2026-07-16 baseline 修复)", () => {
  it("窗口目标死后的伤害不计入占比,windowToSeconds 截断在死亡时刻", () => {
    const w: IOffensiveWindow = {
      targetUnitId: "e1",
      targetName: "Healer",
      targetSpec: "Holy Paladin",
      fromSeconds: 20,
      toSeconds: 60,
      durationSeconds: 40,
      friendlyDamageInWindow: 0,
      friendlyOffensives: [],
      bursts: [],
    };
    const player = makeUnit("p1", {
      name: "Ret",
      info,
      damageOut: [
        dmgOut(MATCH_START + 22_000, -80_000, "e1"), // before the target died: on the target
        dmgOut(MATCH_START + 40_000, -500_000, "e2"), // after the target died: switched to someone else (must not be penalised)
      ],
    } as any);
    const e1 = makeUnit("e1", {
      name: "Healer",
      info,
      deathRecords: [{ timestamp: MATCH_START + 30_000 } as any],
    } as any);
    const e2 = makeUnit("e2", { name: "Tank", info } as any);

    const audits = auditWindowTargeting(player, [w], [e1, e2], makeCombat());
    expect(audits).toHaveLength(1);
    expect(audits[0].windowToSeconds).toBe(30);
    expect(audits[0].onTargetPct).toBe(100); // the post-death 0.5M no longer dilutes the share
  });

  it("deathRecords 乱序时仍截在最早那次死亡(周度复核 P3#10)", () => {
    // The old implementation used .find() to take "the first in array order
    // > fromMs", which assumes deathRecords is sorted ascending by time — an
    // upstream implementation detail, not a contract. Out of order it truncates
    // at a later death, stretching the window so post-death target-switch damage
    // re-enters the denominator and dilutes the on-target share.
    const w: IOffensiveWindow = {
      targetUnitId: "e1",
      targetName: "Healer",
      targetSpec: "Holy Paladin",
      fromSeconds: 20,
      toSeconds: 60,
      durationSeconds: 40,
      friendlyDamageInWindow: 0,
      friendlyOffensives: [],
      bursts: [],
    };
    const player = makeUnit("p1", {
      name: "Ret",
      info,
      damageOut: [
        dmgOut(MATCH_START + 22_000, -80_000, "e1"),
        dmgOut(MATCH_START + 40_000, -500_000, "e2"), // after the 30s death, must not count
      ],
    } as any);
    const e1 = makeUnit("e1", {
      name: "Healer",
      info,
      // The later death listed first (a genuinely possible order in arena, with
      // resurrections or multiple death records)
      deathRecords: [
        { timestamp: MATCH_START + 50_000 } as any,
        { timestamp: MATCH_START + 30_000 } as any,
      ],
    } as any);
    const e2 = makeUnit("e2", { name: "Tank", info } as any);

    const audits = auditWindowTargeting(player, [w], [e1, e2], makeCombat());
    expect(audits).toHaveLength(1);
    expect(audits[0].windowToSeconds).toBe(30); // the earliest one, not the first in array order
    expect(audits[0].onTargetPct).toBe(100);
  });

  it("目标死得太快(截断后 < 最小窗口)则整条跳过", () => {
    const w: IOffensiveWindow = {
      targetUnitId: "e1",
      targetName: "Healer",
      targetSpec: "Holy Paladin",
      fromSeconds: 20,
      toSeconds: 60,
      durationSeconds: 40,
      friendlyDamageInWindow: 0,
      friendlyOffensives: [],
      bursts: [],
    };
    const player = makeUnit("p1", {
      name: "Ret",
      info,
      damageOut: [dmgOut(MATCH_START + 21_000, -80_000, "e1")],
    } as any);
    const e1 = makeUnit("e1", {
      name: "Healer",
      info,
      deathRecords: [{ timestamp: MATCH_START + 22_000 } as any],
    } as any);
    expect(auditWindowTargeting(player, [w], [e1], makeCombat())).toHaveLength(
      0,
    );
  });
});
