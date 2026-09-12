import { ICombatUnit } from "@gladlog/parser-compat";
import { describe, expect, test } from "vitest";

import { IPlayerCCTrinketSummary } from "../src/utils/ccTrinketAnalysis";
import { IMajorCooldownInfo } from "../src/utils/cooldowns";
import {
  computeMissedExternalCounterfactuals,
  computeMitigationAudit,
  computeUnusedSelfCounterfactuals,
  COUNTERFACTUAL_WINDOW_S,
  counterfactualTier,
  DECISIVE_MARGIN_PCT,
} from "../src/utils/counterfactual";
import { IMissedExternal } from "../src/utils/deathOutcomeAnalysis";

// ---------------------------------------------------------------------------
// Fixture helpers (copied from deepDive.test.ts's mkUnit style: damageIn with
// {logLine:{timestamp}, effectiveAmount, spellSchoolId}; auraEvents with a
// top-level timestamp plus logLine.event — buildAuraIntervals uses the
// TOP-LEVEL timestamp; and advancedActions).
// ---------------------------------------------------------------------------

interface DamageSpec {
  atS: number;
  amount: number;
  school: string;
}
interface AuraSpec {
  spellId: string;
  spellName: string;
  fromS: number;
  toS: number;
}
interface HpSpec {
  atS: number;
  hp: number;
  maxHp: number;
}

function mkVictim(
  id: string,
  damage: DamageSpec[] = [],
  auras: AuraSpec[] = [],
  hpSamples: HpSpec[] = [],
): ICombatUnit {
  const damageIn = damage.map((d) => ({
    logLine: { timestamp: d.atS * 1000 },
    effectiveAmount: d.amount,
    spellSchoolId: d.school,
  }));

  const auraEvents = auras.flatMap((a) => [
    {
      spellId: a.spellId,
      spellName: a.spellName,
      destUnitId: id,
      srcUnitId: "caster",
      srcUnitName: "Caster",
      timestamp: a.fromS * 1000,
      logLine: { event: "SPELL_AURA_APPLIED", timestamp: a.fromS * 1000 },
    },
    {
      spellId: a.spellId,
      spellName: a.spellName,
      destUnitId: id,
      srcUnitId: "caster",
      srcUnitName: "Caster",
      timestamp: a.toS * 1000,
      logLine: { event: "SPELL_AURA_REMOVED", timestamp: a.toS * 1000 },
    },
  ]);

  const advancedActions = hpSamples.map((h) => ({
    logLine: { timestamp: h.atS * 1000 },
    advancedActorId: id,
    advancedActorCurrentHp: h.hp,
    advancedActorMaxHp: h.maxHp,
  }));

  return {
    id,
    name: id,
    damageIn,
    auraEvents,
    advancedActions,
  } as unknown as ICombatUnit;
}

const combatOf = (endTime = 120_000) =>
  ({ startTime: 0, endTime, units: {} }) as {
    startTime: number;
    endTime: number;
    units: Record<string, ICombatUnit>;
  };

describe("counterfactualTier(三档谓词,量化报告同口径)", () => {
  const maxHp = 1_000_000;
  test("decisive:saved > net + 15% maxHp", () => {
    expect(counterfactualTier(700_001 - 1 + 150_001, 700_000, maxHp)).toBe(
      "decisive",
    );
    expect(counterfactualTier(850_001, 700_000, maxHp)).toBe("decisive");
  });
  test("边界:恰等于明显线 → marginal(> 是严格的)", () => {
    expect(counterfactualTier(850_000, 700_000, maxHp)).toBe("marginal");
  });
  test("marginal 下界:saved ≤ 0.5×net → fatal", () => {
    expect(counterfactualTier(350_000, 700_000, maxHp)).toBe("fatal");
    expect(counterfactualTier(350_001, 700_000, maxHp)).toBe("marginal");
  });
  test("常量值:窗口 10s / 明显线余量 15%", () => {
    expect(COUNTERFACTUAL_WINDOW_S).toBe(10);
    expect(DECISIVE_MARGIN_PCT).toBe(15);
  });
});

describe("computeMitigationAudit(A 形态)", () => {
  // Synthetic: death at t=60s, window [50,60]; Barkskin (22812, 20%, 0x7f)
  // active over [52,58]; damageIn inside the window: 52.5s 100k (0x1 physical),
  // 55s 200k (0x20 shadow), 59s 300k (0x4 fire, outside the aura interval)
  test("arith:反推只吃激活区间∩窗口∩schoolMask 命中的观测伤害", () => {
    const victim = mkVictim(
      "v1",
      [
        { atS: 52.5, amount: 100_000, school: "0x1" },
        { atS: 55, amount: 200_000, school: "0x20" },
        { atS: 59, amount: 300_000, school: "0x4" },
      ],
      [{ spellId: "22812", spellName: "Barkskin", fromS: 52, toS: 58 }],
    );
    const { rows } = computeMitigationAudit(victim, combatOf(), 60);
    const bark = rows.find((r) => r.spellId === "22812")!;
    expect(bark.kind).toBe("arith");
    // (100k+200k) × 20/(100-20) = 75k; the 59s hit is outside the interval and
    // does not count
    expect(bark.blockedAmount).toBe(75_000);
    expect(bark.activeOverlapS).toBe(6);
  });

  test("immunity(pct=100):不反推,报覆盖秒数与期内观测承伤", () => {
    // Divine Shield 642 active over [54,56], 0 damage observed during it
    const victim = mkVictim(
      "v2",
      [],
      [{ spellId: "642", spellName: "Divine Shield", fromS: 54, toS: 56 }],
    );
    const { rows } = computeMitigationAudit(victim, combatOf(), 60);
    const ds = rows.find((r) => r.spellId === "642")!;
    expect(ds.kind).toBe("immunity");
    expect(ds.blockedAmount).toBeUndefined();
    expect(ds.damageTakenDuringImmunity).toBe(0);
    expect(ds.activeOverlapS).toBe(2);
  });

  test("机制类(白名单内但表外,如 6940)→ kind=mechanic 无数字", () => {
    const victim = mkVictim(
      "v3",
      [],
      [
        {
          spellId: "6940",
          spellName: "Blessing of Sacrifice",
          fromS: 53,
          toS: 57,
        },
      ],
    );
    const { rows } = computeMitigationAudit(victim, combatOf(), 60);
    const m = rows.find((r) => r.spellId === "6940")!;
    expect(m.kind).toBe("mechanic");
    expect(m.blockedAmount).toBeUndefined();
  });

  test("positional(196718)跳过不出行", () => {
    const victim = mkVictim(
      "v4",
      [],
      [{ spellId: "196718", spellName: "Darkness", fromS: 50, toS: 60 }],
    );
    const { rows } = computeMitigationAudit(victim, combatOf(), 60);
    expect(rows.some((r) => r.spellId === "196718")).toBe(false);
  });

  test("netDamage=窗口起点绝对 HP;取不到 → null 且 rows 照出(挡掉量不依赖 netDamage)", () => {
    // No advancedActions → absHpAt is always null, but the rows' arithmetic
    // does not depend on HP sampling.
    const victim = mkVictim(
      "v5",
      [{ atS: 52.5, amount: 100_000, school: "0x1" }],
      [{ spellId: "22812", spellName: "Barkskin", fromS: 50, toS: 60 }],
      [],
    );
    const result = computeMitigationAudit(victim, combatOf(), 60);
    expect(result.netDamage).toBeNull();
    expect(result.maxHp).toBeNull();
    const bark = result.rows.find((r) => r.spellId === "22812")!;
    expect(bark.blockedAmount).toBe(25_000); // 100k × 20/80
    expect(bark.blockedPctMaxHp).toBeUndefined();
  });

  test("开局早死(deathS < 窗口):窗口起点夹到 0,不因负数时刻丢采样(agy flash 复核发现)", () => {
    // deathS=5 < COUNTERFACTUAL_WINDOW_S (10): without clamping to zero the
    // window start lands 5s BEFORE matchStartMs, which exceeds
    // HP_SAMPLE_RADIUS_MS (3s) and can never hit a sample, losing netDamage and
    // maxHp entirely. Clamped, the window starts at 0 and the sampling lands on
    // the opening sample.
    const victim = mkVictim(
      "v6b",
      [{ atS: 2, amount: 100_000, school: "0x1" }],
      [{ spellId: "22812", spellName: "Barkskin", fromS: 0, toS: 5 }],
      [
        { atS: 0, hp: 100_000, maxHp: 200_000 },
        { atS: 5, hp: 1, maxHp: 200_000 },
      ],
    );
    const result = computeMitigationAudit(victim, combatOf(), 5);
    expect(result.netDamage).toBe(100_000);
    expect(result.maxHp).toBe(200_000);
    const bark = result.rows.find((r) => r.spellId === "22812")!;
    expect(bark.activeOverlapS).toBe(5); // [0,5]∩[0,5]
  });

  test("schoolMask 过滤:0x7e 仅魔法条目不吃 0x1 物理伤害", () => {
    // Anti-Magic Zone (51052, 15%, 0x7e magic only) active over [50,60]; the
    // only damage inside the window is a 0x1 physical hit → the school does not
    // match, so the back-computed observed amount is 0.
    const victim = mkVictim(
      "v6",
      [{ atS: 55, amount: 100_000, school: "0x1" }],
      [
        {
          spellId: "51052",
          spellName: "Anti-Magic Zone",
          fromS: 50,
          toS: 60,
        },
      ],
    );
    const { rows } = computeMitigationAudit(victim, combatOf(), 60);
    const amz = rows.find((r) => r.spellId === "51052")!;
    expect(amz.kind).toBe("arith");
    expect(amz.blockedAmount).toBe(0);
  });
});

describe("computeUnusedSelfCounterfactuals(窄门)", () => {
  const neverUsedCd = (
    spellId: string,
    spellName: string,
    tag = "Defensive",
  ): IMajorCooldownInfo =>
    ({
      spellId,
      spellName,
      tag,
      cooldownSeconds: 60,
      maxChargesDetected: 1,
      casts: [],
      availableWindows: [],
      neverUsed: true,
    }) as unknown as IMajorCooldownInfo;

  const noLockoutCC = {
    playerName: "v",
    ccInstances: [],
  } as unknown as Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">;

  test("CC 死锁(wasLockedOutThroughWindow)→ 空数组", () => {
    const victim = mkVictim(
      "v7",
      [{ atS: 55, amount: 5_000_000, school: "0x1" }],
      [],
      [
        { atS: 50, hp: 100_000, maxHp: 200_000 },
        { atS: 60, hp: 100, maxHp: 200_000 },
      ],
    );
    // CC'd for the whole 5s before death (LETHAL_WINDOW_SECONDS defaults to
    // 5s; the CC covers [54,62] ∩ window = [55,60])
    const lockedOutCC = {
      playerName: "v7",
      ccInstances: [
        { atSeconds: 54, durationSeconds: 8, trinketState: "available_unused" },
      ],
    } as unknown as Pick<IPlayerCCTrinketSummary, "playerName" | "ccInstances">;
    const hits = computeUnusedSelfCounterfactuals(
      victim,
      [neverUsedCd("22812", "Barkskin")],
      lockedOutCC,
      combatOf(),
      60,
    );
    expect(hits).toEqual([]);
  });

  test("decisive 才返回;marginal/fatal 静默", () => {
    const victim = mkVictim(
      "v8",
      [
        { atS: 55, amount: 700_000, school: "0x1" },
        { atS: 56, amount: 10_000, school: "0x20" },
      ],
      [],
      [
        { atS: 50, hp: 100_000, maxHp: 200_000 },
        { atS: 60, hp: 100, maxHp: 200_000 },
      ],
    );
    const hits = computeUnusedSelfCounterfactuals(
      victim,
      [
        neverUsedCd("22812", "Barkskin"), // 20%, 0x7f → saved 142k > decisive line 130k → decisive
        neverUsedCd("51052", "Anti-Magic Zone"), // 15%, 0x7e → saved 1.5k <= marginal floor 50k → fatal, silent
      ],
      noLockoutCC,
      combatOf(),
      60,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].spellId).toBe("22812");
    expect(hits[0].tier).toBe("decisive");
    expect(hits[0].source).toBe("unused-self");
  });

  test("positional 候选跳过", () => {
    const victim = mkVictim(
      "v9",
      [{ atS: 55, amount: 5_000_000, school: "0x1" }],
      [],
      [
        { atS: 50, hp: 1_000, maxHp: 10_000 },
        { atS: 60, hp: 100, maxHp: 10_000 },
      ],
    );
    const hits = computeUnusedSelfCounterfactuals(
      victim,
      [neverUsedCd("196718", "Darkness", "Defensive")],
      noLockoutCC,
      combatOf(),
      60,
    );
    expect(hits).toEqual([]);
  });
});

describe("computeMissedExternalCounterfactuals(B)", () => {
  const victim = mkVictim(
    "v10",
    [{ atS: 55, amount: 800_000, school: "0x1" }],
    [],
    [
      { atS: 50, hp: 100_000, maxHp: 200_000 },
      { atS: 60, hp: 100, maxHp: 200_000 },
    ],
  );
  const combat = { startTime: 0 };

  test("表内外置(如 33206 40%)→ saved = 窗内命中学派伤害×40%,decisive 才返回", () => {
    const missed: IMissedExternal[] = [
      {
        casterName: "Heal-Area52",
        casterSpec: "Discipline Priest",
        spellId: "33206",
        spellName: "Pain Suppression",
        casterWasInCC: false,
      },
    ];
    const hits = computeMissedExternalCounterfactuals(
      missed,
      victim,
      combat,
      60,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].spellId).toBe("33206");
    expect(hits[0].tier).toBe("decisive");
    expect(hits[0].source).toBe("missed-external");
    expect(hits[0].casterName).toBe("Heal-Area52");
    expect(hits[0].savedAmount).toBe(320_000); // 800k × 40%
  });

  test("表外外置(如 633 圣疗)跳过", () => {
    const missed: IMissedExternal[] = [
      {
        casterName: "Pal-Area52",
        casterSpec: "Holy Paladin",
        spellId: "633",
        spellName: "Lay on Hands",
        casterWasInCC: false,
      },
    ];
    const hits = computeMissedExternalCounterfactuals(
      missed,
      victim,
      combat,
      60,
    );
    expect(hits).toEqual([]);
  });
});

describe("A 形态 × pctOnOthers:黑曜鳞片按「谁身上」定价(2026-09-12)", () => {
  // 100k physical at 55s inside the aura interval [52,58]; death at 60.
  const spec = () => [{ atS: 55, amount: 100_000, school: "0x1" }];
  const aura = () => [
    { spellId: "363916", spellName: "Obsidian Scales", fromS: 52, toS: 58 },
  ];
  test("受害者身上是别人(奶龙)给的黑曜鳞片 → 15%:100k × 15/85", () => {
    // mkVictim stamps srcUnitName "Caster" ≠ the victim's name → ally-applied
    const victim = mkVictim("v3", spec(), aura());
    const { rows } = computeMitigationAudit(victim, combatOf(), 60);
    const os = rows.find((r) => r.spellId === "363916")!;
    expect(os.kind).toBe("arith");
    expect(os.blockedAmount).toBe(Math.round((100_000 * 15) / 85));
  });
  test("受害者自己开的黑曜鳞片 → 30%:100k × 30/70", () => {
    const victim = mkVictim("v4", spec(), aura());
    for (const a of (victim as unknown as { auraEvents: Array<{ srcUnitName: string }> }).auraEvents)
      a.srcUnitName = "v4";
    const { rows } = computeMitigationAudit(victim, combatOf(), 60);
    const os = rows.find((r) => r.spellId === "363916")!;
    expect(os.blockedAmount).toBe(Math.round((100_000 * 30) / 70));
  });
});
