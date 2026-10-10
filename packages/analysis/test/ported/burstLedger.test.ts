/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import {
  analyzeBurstLedger,
  auditWindowTargeting,
  BURST_TARGET_DAMAGE_RE_SRC,
  burstSecondTargetClause,
  formatBurstLedgerForContext,
} from "../../src/utils/burstLedger";
import { gridHpPct } from "../../src/utils/cooldowns";
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
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "363916",
          MATCH_START + 11_000,
          "evoker",
          "e1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "363916",
          MATCH_START + 17_000,
          "evoker",
          "e1",
          "BUFF",
        ),
      ],
    } as any);
    const hitsAlly =
      analyzeBurstLedger(mkPlayer(), [], [byAlly], makeCombat())[0]
        .dominantTarget?.defensivesHit ?? [];
    expect(hitsAlly).toHaveLength(1);
    expect(hitsAlly[0].appliedByOther).toBe(true);

    const bySelf = makeUnit("e1", {
      name: "Pally",
      info,
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "363916",
            MATCH_START + 11_000,
            "e1",
            "e1",
            "BUFF",
          ),
          srcUnitName: "Pally",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "363916",
            MATCH_START + 17_000,
            "e1",
            "e1",
            "BUFF",
          ),
          srcUnitName: "Pally",
        },
      ],
    } as any);
    const hitsSelf =
      analyzeBurstLedger(mkPlayer(), [], [bySelf], makeCombat())[0]
        .dominantTarget?.defensivesHit ?? [];
    expect(hitsSelf).toHaveLength(1);
    expect(hitsSelf[0].appliedByOther).toBe(false);
  });

  it("可靠性第二轮 W1h:我方挂在敌人身上的业报之触(122470)不是敌人的减伤(d78f)", () => {
    const monk = makeUnit("p1", {
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
    const target = makeUnit("e1", {
      name: "Priest",
      info,
      auraEvents: [
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "122470",
            MATCH_START + 11_000,
            "p1",
            "e1",
            "DEBUFF",
          ),
          srcUnitName: "Ret",
        },
        {
          ...makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "122470",
            MATCH_START + 17_000,
            "p1",
            "e1",
            "DEBUFF",
          ),
          srcUnitName: "Ret",
        },
      ],
    } as any);
    const entries = analyzeBurstLedger(monk, [], [target], makeCombat());
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].dominantTarget?.defensivesHit ?? []).toEqual([]);
    // control: the same aura from someone NOT on the attacking side is counted
    const other = {
      ...target,
      auraEvents: target.auraEvents.map((a: any) => ({
        ...a,
        srcUnitName: "Other",
      })),
    } as any;
    const hits =
      analyzeBurstLedger(monk, [], [other], makeCombat())[0].dominantTarget
        ?.defensivesHit ?? [];
    expect(hits.map((h) => h.spellId)).toEqual(["122470"]);
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

// Triage 2026-09-29, group G15: hp-state F-B1 (Target HP on the render grid),
// sync-burst F-L5 + F-L5b / hp-state F-N5 (the low, by the one trough rule,
// ruling A′14) and sync-burst F-L1 (the burst's other victim).
describe("analyzeBurstLedger — Target HP on the render grid, the low, other deaths", () => {
  const ret = (castAtMs: number, damageOut: unknown[]) =>
    makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          castAtMs,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut,
    } as any);
  const hpAt = (s: number, pct: number) =>
    makeAdvancedAction(MATCH_START + s * 1000, 0, 0, 100, pct);

  it("a cast at a fractional second reads the [STATE] grid of the rendered seconds, not the raw instants", () => {
    // cast 10.8 s → span 10.8–30.8, rendered 0:10–0:30. Raw-instant samples
    // (the old read) would pick 62 % at 10.8 and 50 % at 30.8.
    const player = ret(MATCH_START + 10_800, [
      dmgOut(MATCH_START + 12_000, -50_000, "e1"),
    ]);
    const e1 = makeUnit("e1", {
      name: "Victim",
      info,
      advancedActions: [
        hpAt(10.0, 95),
        hpAt(10.8, 62),
        hpAt(30.0, 69),
        hpAt(30.8, 50),
      ],
    } as any);
    const t = analyzeBurstLedger(player, [], [e1], makeCombat())[0]
      .dominantTarget!;
    expect(t.hpStartPct).toBe(gridHpPct(e1, MATCH_START + 10_000));
    expect(t.hpStartPct).toBe(95);
    expect(t.hpEndPct).toBe(gridHpPct(e1, MATCH_START + 30_000));
    expect(t.hpEndPct).toBe(69);
  });

  it("the low prints only as a trough: ≥ 10 points under both grid endpoints", () => {
    const player = ret(MATCH_START + 10_000, [
      dmgOut(MATCH_START + 12_000, -50_000, "e1"),
    ]);
    const run = (points: Array<[number, number]>) => {
      const e1 = makeUnit("e1", {
        name: "Victim",
        info,
        advancedActions: points.map(([s, pct]) => hpAt(s, pct)),
      } as any);
      const bursts = analyzeBurstLedger(player, [], [e1], makeCombat());
      return {
        low: bursts[0].dominantTarget!.hpLow,
        line: formatBurstLedgerForContext(bursts, [], []).find((l) =>
          l.includes("Target:"),
        )!,
      };
    };
    // 100 → 98 with a 37 % dip at 0:18
    const deep = run([
      [10, 100],
      [17, 100],
      [18, 37],
      [19, 60],
      [21, 90],
      [30, 98],
    ]);
    expect(deep.low).toEqual({ pct: 37, atSeconds: 18 });
    expect(deep.line).toContain(
      "Target: Victim 100% → 98% (low 37% at 0:18) |",
    );
    // a 9-point dip under the lower endpoint is not a trough
    const shallow = run([
      [10, 100],
      [17, 100],
      [18, 61],
      [19, 80],
      [21, 90],
      [30, 70],
    ]);
    expect(shallow.low).toBeNull();
    expect(shallow.line).toContain("Target: Victim 100% → 70% |");
    // the low IS the start value: nothing hidden (f4da82c5's 35 → 70)
    const atStart = run([
      [10, 35],
      [30, 70],
    ]);
    expect(atStart.low).toBeNull();
  });

  it("a target dead inside the burst's first rendered second reads 0 at the start too", () => {
    const player = ret(MATCH_START + 10_100, [
      dmgOut(MATCH_START + 10_600, -50_000, "e1"),
    ]);
    const e1 = makeUnit("e1", {
      name: "Victim",
      info,
      advancedActions: [hpAt(10, 95)],
      deathRecords: [{ timestamp: MATCH_START + 10_800 } as any],
    } as any);
    const bursts = analyzeBurstLedger(player, [], [e1], {
      ...makeCombat(),
      endTime: MATCH_START + 10_900,
    });
    const t = bursts[0].dominantTarget!;
    expect(t.hpStartPct).toBe(0);
    expect(t.hpEndPct).toBe(0);
  });

  it("a target dead at the end second reads 0 and prints no low", () => {
    const player = ret(MATCH_START + 10_000, [
      dmgOut(MATCH_START + 12_000, -50_000, "e1"),
    ]);
    const e1 = makeUnit("e1", {
      name: "Victim",
      info,
      advancedActions: [hpAt(10, 80), hpAt(20, 12)],
      deathRecords: [{ timestamp: MATCH_START + 21_300 } as any],
    } as any);
    const bursts = analyzeBurstLedger(player, [], [e1], makeCombat());
    const t = bursts[0].dominantTarget!;
    expect(t.hpEndPct).toBe(0);
    expect(t.hpLow).toBeNull();
    expect(t.died).toBe(true);
    expect(formatBurstLedgerForContext(bursts, [], [])[3]).toContain(
      "Target: Victim 80% → 0% | your damage 0.05M | target DIED",
    );
  });

  it("another enemy the burst hit and that died inside it is named; the target is unchanged", () => {
    const player = ret(MATCH_START + 10_600, [
      dmgOut(MATCH_START + 11_000, -300_000, "e2"),
      dmgOut(MATCH_START + 15_000, -700_000, "e1"),
    ]);
    const e1 = makeUnit("e1", { name: "Kegrunner", info } as any);
    const e2 = makeUnit("e2", {
      name: "Shatters",
      info,
      deathRecords: [{ timestamp: MATCH_START + 11_945 } as any],
    } as any);
    const e3 = makeUnit("e3", {
      // died in the span, but this burst never touched it
      name: "Bystander",
      info,
      deathRecords: [{ timestamp: MATCH_START + 14_000 } as any],
    } as any);
    const e4 = makeUnit("e4", {
      // a fully absorbed tick (effective damage 0), then killed by the rest
      // of the team: not this burst's victim
      name: "Shielded",
      info,
      deathRecords: [{ timestamp: MATCH_START + 13_000 } as any],
    } as any);
    player.damageOut.push(dmgOut(MATCH_START + 12_000, 0, "e4") as never);
    const bursts = analyzeBurstLedger(
      player,
      [],
      [e1, e2, e3, e4],
      makeCombat(),
    );
    expect(bursts[0].dominantTarget?.unitName).toBe("Kegrunner");
    expect(bursts[0].dominantTarget?.died).toBe(false);
    expect(bursts[0].otherDeaths).toEqual([
      { unitName: "Shatters", atSeconds: 11.945 },
    ]);
    expect(formatBurstLedgerForContext(bursts, [], [])[3]).toMatch(
      // T12 ⑤: the second enemy the burst damaged is on the line too
      /Target: Kegrunner \| your damage 0\.70M \| second target: Shatters 0\.30M \| also hit: Shatters DIED 0:11 \(\+1\.3s\)$/,
    );
  });
});

// T12 ⑤ (user ruling 2026-10-10): the `Target:` line prints the second enemy
// the burst damaged, and the absorbed part of each figure.
describe("burstLedger — the second target and the absorbed part (T12 ⑤)", () => {
  const absorbedOut = (timestamp: number, amount: number, dest: string) => ({
    ...dmgOut(timestamp, amount, dest),
    logLine: { event: LogEvent.SPELL_ABSORBED, timestamp, parameters: [] },
  });
  const mage = (damageOut: unknown[]) =>
    makeUnit("p1", {
      name: "Mage",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 12_000,
          "p1",
          "Self",
          "p1",
          "Mage",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut,
    } as any);
  const paladin = () => makeUnit("e1", { name: "Rohbell", info } as any);
  const warrior = () => makeUnit("e2", { name: "Shalamayne", info } as any);
  const targetLine = (bursts: ReturnType<typeof analyzeBurstLedger>) =>
    formatBurstLedgerForContext(bursts, [], []).find((l) =>
      l.trimStart().startsWith("Target: "),
    );

  // dfcccbf2 Burst #1: paladin 301k landed + 403k absorbed, warrior 641k
  // landed + 27k absorbed — `Target: Rohbell … | your damage 0.70M`, nothing
  // about the 0.67M on the warrior or the 0.40M that was a shield.
  const dfcccbf2 = () =>
    analyzeBurstLedger(
      mage([
        dmgOut(MATCH_START + 13_000, -301_000, "e1"),
        absorbedOut(MATCH_START + 14_000, 403_000, "e1"),
        dmgOut(MATCH_START + 15_000, -641_000, "e2"),
        absorbedOut(MATCH_START + 16_000, 27_000, "e2"),
      ]),
      [],
      [paladin(), warrior()],
      makeCombat(),
    );

  it("the target is still the enemy with the most landed + absorbed; both parts are kept", () => {
    const [b] = dfcccbf2();
    expect(b.dominantTarget?.unitName).toBe("Rohbell");
    expect(b.dominantTarget?.damage).toBe(704_000);
    expect(b.dominantTarget?.absorbed).toBe(403_000);
    expect(b.damageByTarget).toEqual([
      { unitId: "e1", unitName: "Rohbell", damage: 704_000, absorbed: 403_000 },
      {
        unitId: "e2",
        unitName: "Shalamayne",
        damage: 668_000,
        absorbed: 27_000,
      },
    ]);
    expect(b.totalDamage).toBe(1_372_000);
  });

  it("the line prints the absorbed part and the second target", () => {
    expect(targetLine(dfcccbf2())).toBe(
      "    Target: Rohbell | your damage 0.70M (0.40M of it absorbed) | second target: Shalamayne 0.67M (0.03M of it absorbed)",
    );
  });

  it("the line reads in the pattern the gate uses", () => {
    const m = targetLine(dfcccbf2())!.match(
      new RegExp(BURST_TARGET_DAMAGE_RE_SRC),
    );
    expect(m?.slice(1)).toEqual(["0.70", "0.40", "Shalamayne", "0.67", "0.03"]);
  });

  it("one enemy damaged, nothing absorbed: the line is as it was", () => {
    const bursts = analyzeBurstLedger(
      mage([dmgOut(MATCH_START + 13_000, -520_000, "e1")]),
      [],
      [paladin(), warrior()],
      makeCombat(),
    );
    expect(targetLine(bursts)).toBe("    Target: Rohbell | your damage 0.52M");
    expect(burstSecondTargetClause(bursts[0].damageByTarget)).toBe("");
  });

  it("a second enemy is printed whatever its share — no threshold — unless its figure is 0.00M", () => {
    const run = (onWarrior: number) =>
      targetLine(
        analyzeBurstLedger(
          mage([
            dmgOut(MATCH_START + 13_000, -900_000, "e1"),
            dmgOut(MATCH_START + 15_000, -onWarrior, "e2"),
          ]),
          [],
          [paladin(), warrior()],
          makeCombat(),
        ),
      );
    expect(run(12_000)).toBe(
      "    Target: Rohbell | your damage 0.90M | second target: Shalamayne 0.01M",
    );
    expect(run(4_000)).toBe("    Target: Rohbell | your damage 0.90M");
  });

  it("the legend says what Target, your damage and the second target are", () => {
    const legend = formatBurstLedgerForContext(dfcccbf2(), [], [])[1];
    expect(legend).toContain(
      "`Target` = the enemy player your own damage in the burst was highest on, counting what its shields absorbed",
    );
    expect(legend).toContain("`(A of it absorbed)` = the absorbed part");
    expect(legend).toContain(
      "`second target: X N` = the enemy player your damage was next highest on",
    );
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
