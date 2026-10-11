import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";

import { buildMatchContext } from "../src/context/buildMatchContext";
import {
  dmgSpikeListLegend,
  parseDmgSpikesNotListed,
} from "../src/context/matchTimelineSections";
import { PRESSURE_WINDOWS_TOP_N } from "../src/utils/cooldowns";
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

  it("GH #103 A1: every [DEATH] line carries the dampening at that instant — where one is stated", () => {
    const deathLines = (ctx: string) =>
      ctx.split("\n").filter((l) => l.includes("[DEATH]"));
    // The fixture is a real 15 s 2v2 round with a healer on both teams, and
    // FT-T13 D11 derives the 2v2 start from the first logged stack (one dose
    // below it). Its doses are stored as "42\r" (a parse older than the CRLF
    // fix), which `buildDampeningEvents` reads since WP-H 3: the first stack
    // is 42 at 12.099 s. Its only death is at 12.059 s — 40 ms BEFORE that
    // stack — so the [DEATH] line carries the derived 41% (it used to carry
    // the hand value 30%).
    const ctx = buildMatchContext(match, friends, enemies, {});
    const deaths = deathLines(ctx);
    expect(deaths).toHaveLength(1);
    expect(deaths[0]).toMatch(/^0:12 {2}\[DEATH\]/);
    expect(deaths[0]).toMatch(/ \| dampening: 41%$/);
    expect(ctx).toContain(
      "DAMPENING (2v2): started at 41% (derived: one 1% step below the first logged stack, 42% at 0:12 — the log prints no value before that), ended at 42% at match end",
    );
    const lines = ctx.split("\n");
    expect(lines).toContain("0:00  [DAMPENING ALERT: 30%]");
    expect(lines.find((l) => l.includes("[MATCH END]"))).toMatch(/damp: 42%/);
    // every dampening value stamped before 0:12 is the derived one
    const before = lines.filter((l) => {
      const m = l.match(/^(\d+):(\d{2})\s/);
      return m !== null && Number(m[1]) * 60 + Number(m[2]) < 12;
    });
    expect(before.length).toBeGreaterThan(0);
    expect(
      before
        .filter((l) => /dampening: \d+%|damp: \d+%/.test(l))
        .filter((l) => !/(?:dampening|damp): 41%/.test(l)),
    ).toEqual([]);
    // The same round under a bracket that states a value from 0:00 on: every
    // [DEATH] line carries it (the assertion this test was written for).
    const as3v3 = {
      ...match,
      startInfo: { ...match.startInfo, bracket: "3v3" },
    } as typeof match;
    const deaths3v3 = deathLines(
      buildMatchContext(as3v3, friends, enemies, {}),
    );
    expect(deaths3v3).toHaveLength(deaths.length);
    for (const l of deaths3v3) expect(l).toMatch(/ \| dampening: \d+%$/);
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

  it("triage F-K14a: an enemy kick that missed IMMUNE on a friendly player is a [KICK] line; the immunity is named only when DB2 marks the aura interrupt-immune", () => {
    const victim = friends[0]!;
    const enemy = enemies[0]!;
    const at = match.startTime + 10_500; // the fixture round lasts 15.5 s
    const miss = (spellId: string, ms: number) =>
      ({
        logLine: { event: "SPELL_MISSED", timestamp: ms, parameters: [] },
        timestamp: ms,
        spellId,
        spellName: spellId,
        srcUnitId: enemy.id,
        srcUnitName: enemy.name,
        destUnitId: victim.id,
        destUnitName: victim.name,
        missType: "IMMUNE",
        amount: 0,
      }) as never;
    const saved = { missesIn: victim.missesIn, auraEvents: victim.auraEvents };
    const lines = () =>
      buildMatchContext(match, friends, enemies, {})
        .split("\n")
        .filter((l) => l.includes("missed — IMMUNE"));
    try {
      // Skull Bash logs its two ids 1 ms apart: one line. No immunity aura
      // on the victim: bare IMMUNE.
      victim.missesIn = [miss("93985", at), miss("106839", at + 1)];
      expect(lines()).toHaveLength(1);
      expect(lines()[0]).toMatch(
        /^0:10 {2}\[KICK\] {3}.+'s Skull Bash on .+ missed — IMMUNE$/,
      );
      // Spiritwalker's Aegis 378078 (DB2 aura 77, mechanic 26) up at the miss
      victim.missesIn = [miss("47528", at)]; // Mind Freeze
      victim.auraEvents = [
        ...(saved.auraEvents ?? []),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "378078",
          at - 300,
          victim.id,
          victim.id,
          "BUFF",
        ),
      ].sort((a, b) => a.timestamp - b.timestamp) as never;
      expect(lines()).toHaveLength(1);
      expect(lines()[0]).toContain("'s Mind Freeze on ");
      expect(lines()[0]).toMatch(/missed — IMMUNE \(Spiritwalker's Aegis\)$/);
      // The aura is read through the shared pairing (`buildAuraIntervals`),
      // not a private replay (agy review of the batch, 2026-10-01):
      const aura = (ev: LogEvent, id: string, ms: number) =>
        makeAuraEvent(ev, id, ms, victim.id, victim.id, "BUFF");
      // sorted in with the fixture's own events unless `unsorted` puts them
      // first, in the order given
      const withAuras = (evs: ReturnType<typeof aura>[], unsorted = false) => {
        victim.auraEvents = (
          unsorted
            ? [...evs, ...(saved.auraEvents ?? [])]
            : [...(saved.auraEvents ?? []), ...evs].sort(
                (a, b) => a.timestamp - b.timestamp,
              )
        ) as never;
        return lines();
      };
      // … a BROKEN event ends it like a REMOVED
      expect(
        withAuras([
          aura(LogEvent.SPELL_AURA_APPLIED, "378078", at - 3000),
          aura(LogEvent.SPELL_AURA_BROKEN_SPELL, "378078", at - 1000),
        ])[0],
      ).toMatch(/missed — IMMUNE$/);
      // … with no REMOVED at all it ends at its official 5 s
      expect(
        withAuras([aura(LogEvent.SPELL_AURA_APPLIED, "378078", at - 8000)])[0],
      ).toMatch(/missed — IMMUNE$/);
      // … events out of time order are sorted before pairing
      expect(
        withAuras(
          [
            aura(LogEvent.SPELL_AURA_REMOVED, "378078", at - 1000),
            aura(LogEvent.SPELL_AURA_APPLIED, "378078", at - 3000),
          ],
          true,
        )[0],
      ).toMatch(/missed — IMMUNE$/);
      // … an aura removed in the miss's own millisecond was still up
      expect(
        withAuras([
          aura(LogEvent.SPELL_AURA_APPLIED, "378078", at - 3000),
          aura(LogEvent.SPELL_AURA_REMOVED, "378078", at),
        ])[0],
      ).toMatch(/missed — IMMUNE \(Spiritwalker's Aegis\)$/);
      // … two up at once: both are named, in the order applied
      expect(
        withAuras([
          aura(LogEvent.SPELL_AURA_APPLIED, "378078", at - 3000),
          aura(LogEvent.SPELL_AURA_APPLIED, "377362", at - 2000),
          aura(LogEvent.SPELL_AURA_REFRESH, "378078", at - 500),
        ])[0],
      ).toMatch(/missed — IMMUNE \(Spiritwalker's Aegis \+ Precognition\)$/);
      // … an aura put up in the prep room (8 s before the round, official
      // 5 s, never REMOVED) is not up 2 s into the round
      victim.missesIn = [miss("47528", match.startTime + 2000)];
      expect(
        withAuras([
          aura(LogEvent.SPELL_AURA_APPLIED, "378078", match.startTime - 8000),
        ])[0],
      ).toMatch(/^0:02 .+ missed — IMMUNE$/);
      // … while one put up 3 s before the round still is
      expect(
        withAuras([
          aura(LogEvent.SPELL_AURA_APPLIED, "378078", match.startTime - 3000),
        ])[0],
      ).toMatch(/^0:02 .+ missed — IMMUNE \(Spiritwalker's Aegis\)$/);
      // not an interrupt (Polymorph 118), or not IMMUNE: no line
      victim.missesIn = [
        miss("118", at),
        { ...(miss("47528", at + 500) as object), missType: "MISS" } as never,
      ];
      expect(lines()).toHaveLength(0);
    } finally {
      victim.missesIn = saved.missesIn;
      victim.auraEvents = saved.auraEvents;
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
      "Mitigation audit: Barkskin blocked ~75k (≈8% max HP) over 6.0s active in the final 10s",
    );
    // Death ②: Barkskin was removed long before, so no whitelisted mitigation
    // is active inside death ②'s window — no Mitigation audit line may appear
    // at all (if the deaths get crossed, death ①'s line would wrongly show up
    // again here).
    expect(block2).not.toContain("Mitigation audit:");
  });
});

describe("D4 — the context states the [DMG SPIKE] cap and counts the windows it dropped (T12 ②)", () => {
  // One friendly, one hit every 20 s — each its own 10 s window.
  const contextOf = (amounts: number[]) => {
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
      damageIn: amounts.map((amount, i) => ({
        logLine: {
          event: LogEvent.SPELL_DAMAGE,
          timestamp: 10_000 + i * 20_000,
          parameters: [],
        },
        timestamp: 10_000 + i * 20_000,
        effectiveAmount: -amount,
        amount,
        spellSchoolId: "0x1",
        srcUnitId: "enemy-1",
        srcUnitName: "Enemy1",
        destUnitId: "victim-1",
        destUnitName: "Victim",
        spellId: "12222",
        spellName: "Test Dmg",
      })),
    });
    const combat = {
      startTime: 0,
      endTime: 200_000,
      units: { "victim-1": victim },
      playerId: "victim-1",
      playerTeamId: 0,
      winningTeamId: null,
      startInfo: { zoneId: "0", bracket: "2v2" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return buildMatchContext(combat, [victim], [], {}).split("\n");
  };
  const spikeLines = (lines: string[]) =>
    lines.filter((l) => /^\d+:\d{2}–\d+:\d{2}\s+\[DMG SPIKE\]/.test(l));

  it("eight windows of the threshold: five lines, the legend sentence, and one line counting the other three", () => {
    const lines = contextOf([
      900_000, 500_000, 800_000, 450_000, 700_000, 600_000, 310_000, 650_000,
    ]);
    expect(spikeLines(lines)).toHaveLength(PRESSURE_WINDOWS_TOP_N);
    const legendAt = lines.indexOf(dmgSpikeListLegend());
    expect(legendAt).toBeGreaterThan(0);
    // the count line sits directly under the sentence it qualifies
    const summary = parseDmgSpikesNotListed(lines[legendAt + 1]!);
    expect(summary).toMatchObject({
      count: 3,
      thresholdM: 0.3,
      largestM: 0.5,
      // the second hit: 0:30–0:40
      fromSec: 30,
      toSec: 40,
    });
    // …and names the unit as the listed lines do
    expect(spikeLines(lines)[0]).toContain(`[DMG SPIKE]   ${summary!.unit} (`);
    // the largest unlisted ranks below every listed line
    const listedM = spikeLines(lines).map((l) =>
      Number(l.match(/: (\d+\.\d{2})M in /)![1]),
    );
    expect(Math.min(...listedM)).toBeGreaterThanOrEqual(summary!.largestM);
    expect(listedM.sort((a, b) => a - b)).toEqual([0.6, 0.65, 0.7, 0.8, 0.9]);
  });

  it("five windows: the sentence is there, no count line", () => {
    const lines = contextOf([900_000, 500_000, 800_000, 450_000, 700_000]);
    expect(spikeLines(lines)).toHaveLength(5);
    expect(lines).toContain(dmgSpikeListLegend());
    expect(lines.some((l) => parseDmgSpikesNotListed(l) !== null)).toBe(false);
  });

  it("a sixth window under the listing threshold is not a window the list would hold", () => {
    const lines = contextOf([
      900_000, 500_000, 800_000, 450_000, 700_000, 299_000,
    ]);
    expect(spikeLines(lines)).toHaveLength(5);
    expect(lines.some((l) => parseDmgSpikesNotListed(l) !== null)).toBe(false);
  });
});
