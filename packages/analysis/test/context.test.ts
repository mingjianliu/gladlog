import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";

import { buildMatchContext } from "../src/context/buildMatchContext";
import { interruptCooldownSeconds } from "../src/utils/enemyInterrupts";
import { fmtTime } from "../src/utils/renderGrid";
import { loadLegacyMatchFixture } from "./helpers/legacyFixture";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeUnit,
} from "./ported/testHelpers";

describe("buildMatchContext on real fixture", () => {
  const match = loadLegacyMatchFixture();
  const units = Object.values(match.units).filter((u) => u.info);
  const friends = units.filter((u) => u.reaction === 1); // Friendly
  const enemies = units.filter((u) => u.reaction === 2); // Hostile
  it("产出完整 prompt 上下文:非空、含玩家名与关键段落", () => {
    const ctx = buildMatchContext(match, friends, enemies, {});
    expect(ctx.length).toBeGreaterThan(2000);
    const owner = Object.values(match.units).find(
      (u) => u.id === match.playerId,
    );
    expect(ctx).toContain(owner!.name);
    expect(/dampening/i.test(ctx)).toBe(true);
  });
  it("timeline 模式同样可产出", () => {
    const ctx = buildMatchContext(match, friends, enemies, {});
    expect(ctx.length).toBeGreaterThan(1000);
  });

  it("GH #103 A1: every [DEATH] line carries the dampening at that instant", () => {
    const ctx = buildMatchContext(match, friends, enemies, {});
    const deaths = ctx.split("\n").filter((l) => l.includes("[DEATH]"));
    expect(deaths.length).toBeGreaterThan(0);
    for (const l of deaths) expect(l).toMatch(/ \| dampening: \d+%$/);
  });

  it("GH #103 A3: [KICK] lines print a back-time only for enemy kickers", () => {
    // the fixture's only kick is friendly (2(FMage) Counterspell at 0:08)
    const before = buildMatchContext(match, friends, enemies, {});
    const friendlyKick = before.split("\n").find((l) => l.includes("[KICK]"));
    expect(friendlyKick).toContain("(Counterspell)");
    // mirror it as an ENEMY kick: an enemy Counterspells a friendly at 0:08
    const kick = [...friends, ...enemies]
      .flatMap((u) => [...(u.actionOut ?? []), ...(u.actionIn ?? [])])
      .find((a) => a.logLine.event === "SPELL_INTERRUPT")!;
    const mage = friends.find((u) => u.name === kick.srcUnitName)!;
    const enemy = enemies[0]!;
    const victim = friends.find((u) => u.id !== mage.id)!;
    const saved = enemy.actionOut;
    enemy.actionOut = [
      ...(enemy.actionOut ?? []),
      {
        ...kick,
        srcUnitName: enemy.name,
        srcUnitId: enemy.id,
        destUnitName: victim.name,
        destUnitId: victim.id,
      } as never,
    ];
    try {
      const ctx = buildMatchContext(match, friends, enemies, {});
      const cd = interruptCooldownSeconds(kick.spellId!)!;
      expect(cd).toBeGreaterThan(0);
      const t = (kick.timestamp - match.startTime) / 1000;
      const enemyKick = ctx
        .split("\n")
        .find((l) => l.includes("[KICK]") && l.includes("; back "));
      expect(enemyKick).toContain(`(Counterspell; back ${fmtTime(t + cd)})`);
      // the friendly kick still has no back-time
      expect(
        ctx
          .split("\n")
          .filter((l) => l.includes("[KICK]") && !l.includes("; back ")),
      ).toHaveLength(1);
    } finally {
      enemy.actionOut = saved;
    }
  });

  it("GH #103 A5: Defensive loadout entries state how long the effect lasts", () => {
    const ctx = buildMatchContext(match, friends, enemies, {});
    expect(ctx).toContain("Pain Suppression [180s, 2 Charges, lasts 8s]");
    // 150 s since GH #106: Winter's Protection counts per rank (rank 2 = −60)
    expect(ctx).toContain("Ice Block [150s, lasts 10s]");
    // offensive / control cooldowns keep the old shape
    expect(ctx).toContain("Combustion [60s]");
    // 2026-09-26: 30 s = DB2 40 − Psychic Voice 10, applied once (the hand override used to hold 30 and the talent took 10 again → 20).
    expect(ctx).toContain("Psychic Scream [30s]");
  });

  it("healer owner:timeline 上下文不含 <burst_ledger>(治疗 prompt 不变,D2)", () => {
    const ctx = buildMatchContext(match, friends, enemies, {});
    expect(ctx).not.toContain("<burst_ledger>");
  });

  it("DPS owner:timeline 上下文以 DPS 为视角(无 healer_offense;有账本时出 <burst_ledger>)", () => {
    const dps = friends.find((u) => u.id !== match.playerId)!;
    const ctx = buildMatchContext(match, friends, enemies, {
      owner: dps,
    });
    expect(ctx).toContain(`(You are the`);
    expect(ctx).not.toContain("<healer_offense>");
    expect(ctx).toContain("<burst_ledger>");
    expect(ctx).toContain("## BURST LEDGER");
  });
});

describe("counterfactualOf 按 (name, atSeconds) 精确匹配(#17b Task4 复核 critical 回归)", () => {
  // Found in the 2026-07-30 review: buildMatchContext's counterfactualOf
  // closure used to do friendlyDeaths.find() by victimName alone — so when the
  // same player dies twice within one combat, the second death's [DEATH] block
  // is rendered with the FIRST death's mitigation / counterfactual numbers
  // (not "missing data", but "wrong numbers"). Measured over the corpus
  // (795 matches / 2531 combats — each match and each shuffle round counts as
  // one combat), 0 combats had the same unit die twice (see the appendix of
  // task-4-report.md), but the code must not depend on that coincidence, so a
  // synthetic scenario verifies the fix directly.
  it("同一玩家在同一场 combat 内死两次:第二条 [DEATH] 不得沿用第一条的减伤核算行", () => {
    const matchStartMs = 0;
    const death1Ms = 20_000;
    const death2Ms = 40_000;

    const victim = makeUnit("victim-1", {
      name: "Victim",
      spec: CombatUnitSpec.Druid_Feral,
      class: CombatUnitClass.Druid,
      reaction: CombatUnitReaction.Friendly,
      info: {
        teamId: 0,
        specId: 103,
        personalRating: 1500,
        talents: [],
        pvpTalents: [],
        equipment: [],
        interestingAuras: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      auraEvents: [
        // Active only in death ①'s window (14–20s); already removed well
        // before death ②'s window (30–40s).
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "22812",
          death1Ms - 6_000,
          "victim-1",
          "victim-1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "22812",
          death1Ms,
          "victim-1",
          "victim-1",
          "BUFF",
        ),
      ],
      damageIn: [
        {
          logLine: {
            event: LogEvent.SPELL_DAMAGE,
            timestamp: death1Ms - 3_000,
            parameters: [],
          },
          timestamp: death1Ms - 3_000,
          effectiveAmount: -300_000,
          amount: 300_000,
          spellSchoolId: "0x1",
          srcUnitId: "enemy-1",
          srcUnitName: "Enemy1",
          destUnitId: "victim-1",
          destUnitName: "Victim",
          spellId: "12222",
          spellName: "Test Dmg 1",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {
          logLine: {
            event: LogEvent.SPELL_DAMAGE,
            timestamp: death2Ms - 3_000,
            parameters: [],
          },
          timestamp: death2Ms - 3_000,
          effectiveAmount: -120_000,
          amount: 120_000,
          spellSchoolId: "0x1",
          srcUnitId: "enemy-1",
          srcUnitName: "Enemy1",
          destUnitId: "victim-1",
          destUnitName: "Victim",
          spellId: "12222",
          spellName: "Test Dmg 2",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      advancedActions: [
        { ...makeAdvancedAction(death1Ms - 10_000, 0, 0, 937_500, 900_000) },
        { ...makeAdvancedAction(death1Ms, 0, 0, 937_500, 0) },
        { ...makeAdvancedAction(death2Ms - 10_000, 0, 0, 400_000, 380_000) },
        { ...makeAdvancedAction(death2Ms, 0, 0, 400_000, 0) },
      ],
      deathRecords: [
        {
          logLine: {
            event: LogEvent.UNIT_DIED,
            timestamp: death1Ms,
            parameters: [],
          },
          timestamp: death1Ms,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {
          logLine: {
            event: LogEvent.UNIT_DIED,
            timestamp: death2Ms,
            parameters: [],
          },
          timestamp: death2Ms,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });

    const combat = {
      startTime: matchStartMs,
      endTime: death2Ms + 5_000,
      units: { "victim-1": victim },
      playerId: "victim-1",
      playerTeamId: 0,
      winningTeamId: null,
      startInfo: { zoneId: "0", bracket: "2v2" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const ctx = buildMatchContext(combat, [victim], [], {});

    const idx1 = ctx.indexOf("[DEATH]");
    const idx2 = ctx.indexOf("[DEATH]", idx1 + 1);
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);

    const block1 = ctx.slice(idx1, idx2);
    const block2 = ctx.slice(idx2);

    // Death ①: the Barkskin arithmetic line is derived exactly from the 300k
    // damage inside death ①'s window.
    expect(block1).toContain(
      "Mitigation audit: Barkskin blocked ~75k (≈8% max HP) over 6.0s active",
    );
    // Death ②: Barkskin was removed long before, so no whitelisted mitigation
    // is active inside death ②'s window — no Mitigation audit line may appear
    // at all (if the deaths get crossed, death ①'s line would wrongly show up
    // again here).
    expect(block2).not.toContain("Mitigation audit:");
  });
});
