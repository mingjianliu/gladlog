// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";

import { COUNTERFACTUAL_WINDOW_S } from "@gladlog/analysis";

import { DeathRecapCard } from "../src/renderer/src/report/components/DeathRecapCard";
import { MatchReport } from "../src/renderer/src/report/components/MatchReport";
import {
  DEATH_RECAP_WINDOW_S,
  DeathRecap,
  deriveDeathRecaps,
} from "../src/renderer/src/report/derive/deathRecap";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// M-1 (hardening), upgraded by issue #11: DEATH_RECAP_WINDOW_S is now a
// structural alias of COUNTERFACTUAL_WINDOW_S (deathRecap.ts imports it), so
// this assertion is a tripwire against someone re-detaching the alias back
// into a literal — the stronger coupling lives in the import itself.
describe("M-1:死亡窗口常量锚定(DEATH_RECAP_WINDOW_S === COUNTERFACTUAL_WINDOW_S)", () => {
  it("desktop 的回看窗口与 analysis 的反事实窗口必须同值,否则死亡回顾卡展示的事件流窗口与卡片内反事实/减伤核算的取数窗口会各说各话", () => {
    expect(DEATH_RECAP_WINDOW_S).toBe(COUNTERFACTUAL_WINDOW_S);
  });
});

const base = loadRealMatchFixture();

// The fixture is trimmed to the first 90s with no player deaths (the only
// death is an NPC) — clone it and inject one death for the player with the
// most incoming damage (timestamped at their last damage taken), going through
// the real conversion/decision pipeline.
function withInjectedDeath() {
  const m = JSON.parse(JSON.stringify(base)) as typeof base;
  const players = Object.values(m.units).filter(
    (u) =>
      u.kind === "Player" && (u as { damageIn?: unknown[] }).damageIn?.length,
  ) as unknown as Array<{
    id: string;
    name: string;
    damageIn: Array<{ timestamp: number }>;
    deaths: Array<Record<string, unknown>>;
  }>;
  players.sort((a, b) => b.damageIn.length - a.damageIn.length);
  const victim = players[0]!;
  const t = Math.max(...victim.damageIn.map((d) => d.timestamp));
  victim.deaths.push({
    timestamp: t,
    eventName: "UNIT_DIED",
    spellId: 0,
    spellName: "",
    srcId: "",
    srcName: "",
    destId: victim.id,
    destName: victim.name,
    unconscious: false,
  });
  return { m, victim, deathTMs: t };
}

const { m, victim } = withInjectedDeath();

describe("死亡回顾(backlog #6)", () => {
  it("deriveDeathRecaps:真实 fixture 出 1 条回顾,事件升序且含承伤", () => {
    const recaps = deriveDeathRecaps(m);
    expect(recaps.length).toBeGreaterThanOrEqual(1);
    const r = recaps[0]!;
    expect(r.deathS).toBeGreaterThan(0);
    for (let i = 1; i < r.events.length; i++) {
      expect(r.events[i]!.tS).toBeGreaterThanOrEqual(r.events[i - 1]!.tS);
    }
    // The pre-death window must contain damage events (a death needs a cause)
    expect(r.events.some((e) => e.kind === "dmg")).toBe(true);
    // All events fall inside the window
    for (const e of r.events) {
      expect(e.tS).toBeLessThanOrEqual(r.deathS + 0.001);
      expect(e.tS).toBeGreaterThanOrEqual(r.deathS - 10.001);
    }
    // #21 item1: the derive layer must no longer drop spellId (prerequisite
    // for wiring icons) — damage events must carry a non-empty spellId equal
    // to the d.spellId used during internal construction (the display name
    // alone is not enough).
    const dmgEvents = r.events.filter((e) => e.kind === "dmg");
    expect(dmgEvents.length).toBeGreaterThan(0);
    for (const e of dmgEvents) {
      expect(typeof e.spellId).toBe("string");
      expect(e.spellId!.length).toBeGreaterThan(0);
    }
  });

  it("DeathRecapCard:渲染标题/事件行;回放此刻回调带死者名", () => {
    const recaps = deriveDeathRecaps(m);
    const jumped: Array<[number, string[]]> = [];
    render(
      <DeathRecapCard
        recap={recaps[0]!}
        onClose={() => {}}
        onJump={(t, names) => jumped.push([t, names])}
      />,
    );
    expect(screen.getByText(/死亡回顾 —/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /回放此刻/ }));
    expect(jumped.length).toBe(1);
    expect(jumped[0]![1]).toEqual([victim.name]);
    expect(jumped[0]![0]).toBeCloseTo(Math.max(0, recaps[0]!.deathS - 8), 3);
  });

  it("P1-3:进战报默认展开最近一次死亡回顾;✕ 关闭后本场不再自动打开", () => {
    render(<MatchReport source={m} matchId="t" />);
    // The mount effect expands it automatically (no click needed); the content
    // belongs to the injected victim
    const card = screen.getByTestId("death-recap");
    expect(card.textContent).toContain(victim.name.split("-")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByTestId("death-recap")).toBeNull();
  });

  it("战报视图:点死亡标记打开回顾卡,✕ 关闭", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const marker = container.querySelector(".rpt-tl-death-click");
    expect(marker).toBeTruthy();
    fireEvent.click(marker!);
    expect(screen.getByTestId("death-recap")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByTestId("death-recap")).toBeNull();
  });

  it("hero line 终结 = the injected death, seekable (UI review #1)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    const fin = screen.getByTestId("hero-finisher");
    expect(fin.textContent).toContain("终结");
    expect(fin.textContent).toContain(victim.name.split("-")[0]);
    fireEvent.click(fin);
    // Seek switches to the replay view
    expect(container.querySelector(".rpt-replay-scrub")).toBeTruthy();
  });
});

describe("回放视图死亡回顾入口(#6 v2)", () => {
  it("scrub 到死亡后点 ✕ → 切回战报视图并在常驻栏展示(回顾只有一个家,2026-07-26)", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    fireEvent.click(screen.getByRole("button", { name: "回放" }));
    // Scrub to the end so the death ghost appears
    const scrub = container.querySelector(
      ".rpt-replay-scrub",
    ) as HTMLInputElement;
    fireEvent.change(scrub, { target: { value: scrub.max } });
    const ghost = container.querySelector(".rpt-replay-ghost-click");
    expect(ghost).toBeTruthy();
    fireEvent.click(ghost!);
    // The overlay is gone: clicking a death switches to the report view and the
    // recap shows up in its permanent slot in the right column
    expect(screen.getByTestId("death-recap")).toBeTruthy();
    expect(container.querySelector(".rpt-recap-col")).toBeTruthy();
    expect(container.querySelector(".rpt-replay-scrub")).toBeNull();
    // After closing we stay in the report view and the permanent slot falls
    // back to its placeholder state
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByTestId("death-recap")).toBeNull();
    expect(container.querySelector(".rpt-recap-placeholder")).toBeTruthy();
  });

  it("泳道阵亡 divider 也可开回顾", () => {
    const { container } = render(<MatchReport source={m} matchId="t" />);
    fireEvent.click(screen.getByRole("button", { name: "回放" }));
    const divider = container.querySelector(".rpt-gcd-death-click");
    expect(divider).toBeTruthy();
    fireEvent.click(divider!);
    expect(screen.getByTestId("death-recap")).toBeTruthy();
  });
});

describe("死亡回顾血条 v2 (derive)", () => {
  it("deriveDeathRecaps: 能够匹配 advancedActions 计算出 hpBeforePct 和 hpAfterPct", () => {
    const { m, victim, deathTMs } = withInjectedDeath();
    const legacy = toLegacySafe(m);
    const legacyVictim = legacy.units[victim.id];

    const tDmg = deathTMs - 5000;
    const tHeal = deathTMs - 3000;
    const tNoSample = deathTMs - 1000;

    legacyVictim.damageIn = [
      {
        srcUnitFlags: 0,
        destUnitFlags: 0,
        timestamp: tDmg,
        srcUnitName: "Attacker",
        destUnitName: victim.name,
        logLine: { event: "SPELL_DAMAGE", timestamp: tDmg, parameters: [] },
        spellId: "12222",
        spellName: "Test Dmg",
        srcUnitId: "enemy-1",
        destUnitId: victim.id,
        amount: 20000,
        effectiveAmount: -20000,
      },
      {
        srcUnitFlags: 0,
        destUnitFlags: 0,
        timestamp: tNoSample,
        srcUnitName: "Attacker",
        destUnitName: victim.name,
        logLine: {
          event: "SPELL_DAMAGE",
          timestamp: tNoSample,
          parameters: [],
        },
        spellId: "12222",
        spellName: "No Sample Dmg",
        srcUnitId: "enemy-1",
        destUnitId: victim.id,
        amount: 10000,
        effectiveAmount: -10000,
      },
    ];

    legacyVictim.healIn = [
      {
        srcUnitFlags: 0,
        destUnitFlags: 0,
        timestamp: tHeal,
        srcUnitName: "Healer",
        destUnitName: victim.name,
        logLine: { event: "SPELL_HEAL", timestamp: tHeal, parameters: [] },
        spellId: "33333",
        spellName: "Test Heal",
        srcUnitId: "healer-1",
        destUnitId: victim.id,
        amount: 10000,
        effectiveAmount: 10000,
      },
    ];

    legacyVictim.advancedActions = [
      {
        logLine: { event: "ADVANCED_SAMPLE", timestamp: tDmg },
        advancedActorId: victim.id,
        advancedActorCurrentHp: 50000,
        advancedActorMaxHp: 100000,
        advancedActorPositionX: 0,
        advancedActorPositionY: 0,
        advanced: true,
        timestamp: tDmg,
        advancedActorPowers: [],
      },
      {
        logLine: { event: "ADVANCED_SAMPLE", timestamp: tHeal },
        advancedActorId: victim.id,
        advancedActorCurrentHp: 80000,
        advancedActorMaxHp: 100000,
        advancedActorPositionX: 0,
        advancedActorPositionY: 0,
        advanced: true,
        timestamp: tHeal,
        advancedActorPowers: [],
      },
    ];

    const recaps = deriveDeathRecaps(m);
    const r = recaps.find((x) => x.unitId === victim.id);
    expect(r).toBeDefined();
    if (!r) return;

    const dmgEvent = r.events.find((e) => e.spell === "Test Dmg");
    expect(dmgEvent).toBeDefined();
    expect(dmgEvent!.hpBeforePct).toBeCloseTo(70, 3);
    expect(dmgEvent!.hpAfterPct).toBeCloseTo(50, 3);

    const healEvent = r.events.find((e) => e.spell === "Test Heal");
    expect(healEvent).toBeDefined();
    expect(healEvent!.hpBeforePct).toBeCloseTo(70, 3);
    expect(healEvent!.hpAfterPct).toBeCloseTo(80, 3);

    const noSampleEvent = r.events.find((e) => e.spell === "No Sample Dmg");
    expect(noSampleEvent).toBeDefined();
    expect(noSampleEvent!.hpBeforePct).toBeUndefined();
    expect(noSampleEvent!.hpAfterPct).toBeUndefined();
  });
});

describe("死亡回顾血条 v2 (DeathRecapCard)", () => {
  it("DeathRecapCard: 渲染血条列并断言 delta 样式、class、title, 且 cc 行无 track, 且不存在 sparkline/grid", () => {
    const events: DeathRecap["events"] = [
      {
        tS: 92,
        kind: "dmg",
        spell: "Mortal Strike",
        amount: 20000,
        srcName: "Attacker",
        hpBeforePct: 82.1,
        hpAfterPct: 61.4,
      },
      {
        tS: 94,
        kind: "heal",
        spell: "Flash Heal",
        amount: 10000,
        srcName: "Healer",
        hpBeforePct: 60.8,
        hpAfterPct: 70.9,
      },
      {
        tS: 95,
        kind: "cc",
        spell: "Kidney Shot",
        srcName: "Attacker",
      },
    ];
    const recap: DeathRecap = {
      unitId: "victim-1",
      unitName: "Victim",
      deathS: 100,
      events,
      // #11: the card's default view renders `rows`; mirror the raw events so
      // this test keeps exercising the per-event renderer.
      rows: events.map((e) => ({ type: "event", event: e })),
      availableImmunities: [],
      missedExternals: [],
      mitigationAudit: [],
      counterfactuals: [],
    };

    const { container } = render(
      <DeathRecapCard recap={recap} onClose={() => {}} />,
    );

    expect(container.querySelector(".rpt-hpspark")).toBeNull();
    expect(container.querySelector(".rpt-recap-grid")).toBeNull();

    const dmgRow = container.querySelector(".rpt-recap-dmg");
    expect(dmgRow).toBeTruthy();
    const dmgHpBarTd = dmgRow!.querySelector(".rpt-recap-hpbar");
    expect(dmgHpBarTd).toBeTruthy();
    expect(dmgHpBarTd!.getAttribute("title")).toBe("82% → 61%");

    const dmgBase = dmgHpBarTd!.querySelector(
      ".rpt-recap-hpbar-base",
    ) as HTMLElement;
    const dmgDelta = dmgHpBarTd!.querySelector(
      ".rpt-recap-hpbar-delta",
    ) as HTMLElement;
    expect(dmgBase).toBeTruthy();
    expect(dmgDelta).toBeTruthy();
    expect(dmgBase.style.width).toBe("61.4%");
    expect(dmgDelta.style.left).toBe("61.4%");
    // 82.1 - 61.4 = 20.7
    expect(dmgDelta.style.width).toBe("20.7%");
    expect(dmgDelta.className).toContain("rpt-recap-hpbar-delta-dmg");

    const healRow = container.querySelector(".rpt-recap-heal");
    expect(healRow).toBeTruthy();
    const healHpBarTd = healRow!.querySelector(".rpt-recap-hpbar");
    expect(healHpBarTd).toBeTruthy();
    expect(healHpBarTd!.getAttribute("title")).toBe("61% → 71%");

    const healBase = healHpBarTd!.querySelector(
      ".rpt-recap-hpbar-base",
    ) as HTMLElement;
    const healDelta = healHpBarTd!.querySelector(
      ".rpt-recap-hpbar-delta",
    ) as HTMLElement;
    expect(healBase).toBeTruthy();
    expect(healDelta).toBeTruthy();
    expect(healBase.style.width).toBe("60.8%");
    expect(healDelta.style.left).toBe("60.8%");
    // 70.9 - 60.8 = 10.1
    expect(healDelta.style.width).toBe("10.1%");
    expect(healDelta.className).toContain("rpt-recap-hpbar-delta-heal");

    const ccRow = container.querySelector(".rpt-recap-cc");
    expect(ccRow).toBeTruthy();
    const ccHpBarTd = ccRow!.querySelector(".rpt-recap-hpbar");
    expect(ccHpBarTd).toBeTruthy();
    expect(ccHpBarTd!.querySelector(".rpt-recap-hpbar-track")).toBeNull();
  });
});

describe("死亡回顾 —— zoneId 双点修复的行为回归(reviewer finding #2)", () => {
  // Same north-pillar geometry as packages/analysis/test/ported/losAnalysis.test.ts
  // (Nagrand '1505' circular pillar cx=-2043.6 cy=6621.5 r=2.5): the two points
  // are 15 yards apart (< the 40-yard external range, > the 8-yard close-range
  // exemption) and are exactly blocked by the pillar. These coordinates were
  // chosen deliberately so the case only excludes the candidate when the LoS
  // gate is genuinely triggered by combat.zoneId, never via the distance check
  // (which the B27 tests already cover).
  const CASTER_POS = { x: -2050, y: 6621.5 };
  const DYING_POS = { x: -2035, y: 6621.5 };
  const DEATH_T = 5_000_000;

  function combatantInfo(specId: number) {
    return {
      teamId: 0,
      specId,
      personalRating: 1500,
      talents: [],
      pvpTalents: [],
      equipment: [],
      interestingAuras: [],
    };
  }

  /** Minimal synthetic ReportSource with a controllable zoneId: one dead unit
   * and one alive unit, the living one holding Ironbark (102342, Restoration
   * Druid) and never having used it — an "available but never given" candidate
   * on the production path. */
  function buildBlockedLosSource(zoneId: string): ReportSource {
    return {
      kind: "match",
      id: "test-los-regression",
      bracket: "2v2",
      zoneId,
      startTime: DEATH_T - 30_000,
      endTime: DEATH_T + 1_000,
      playerId: "dead1",
      playerTeamId: 0,
      winningTeamId: null,
      result: "Lose",
      linesTotal: 0,
      linesDropped: 0,
      hasAdvancedLogging: true,
      timezone: "UTC",
      units: {
        dead1: {
          id: "dead1",
          name: "Warrior",
          kind: "Player",
          reaction: "Friendly",
          classId: 1,
          specId: 71, // Warrior_Arms
          info: combatantInfo(71),
          deaths: [
            {
              timestamp: DEATH_T,
              eventName: "UNIT_DIED",
              spellId: 0,
              spellName: "",
              srcId: "",
              srcName: "",
              destId: "dead1",
              destName: "Warrior",
              params: [],
              unconscious: false,
            },
          ],
          advancedSamples: [
            {
              timestamp: DEATH_T,
              hp: 0,
              maxHp: 100_000,
              x: DYING_POS.x,
              y: DYING_POS.y,
            },
          ],
        },
        heal1: {
          id: "heal1",
          name: "Druid",
          kind: "Player",
          reaction: "Friendly",
          classId: 11,
          specId: 105, // Druid_Restoration
          info: combatantInfo(105),
          advancedSamples: [
            {
              timestamp: DEATH_T,
              hp: 100_000,
              maxHp: 100_000,
              x: CASTER_POS.x,
              y: CASTER_POS.y,
            },
          ],
        },
      },
    } as unknown as ReportSource;
  }

  it("zoneId 正确贯通(真实映射区域)时,LoS 门生效,被柱子挡住的 Ironbark 不进 missedExternals", () => {
    const recaps = deriveDeathRecaps(buildBlockedLosSource("1505"));
    expect(recaps).toHaveLength(1);
    const names = recaps[0]!.missedExternals.map((m) => m.spellName);
    expect(names).not.toContain("Ironbark");
  });

  it("对照组:zoneId 为空串(等同 deathRecap.ts 两处读点回归到 undefined/顶层不存在字段的旧 bug)时,同一几何 LoS 门不生效,Ironbark 误判为可用未给", () => {
    const recaps = deriveDeathRecaps(buildBlockedLosSource(""));
    expect(recaps).toHaveLength(1);
    const names = recaps[0]!.missedExternals.map((m) => m.spellName);
    expect(names).toContain("Ironbark");
    // #21 item1: missedExternals must carry a spellId (the prerequisite for
    // wiring icons), not just a spellName — Ironbark's real spellId is 102342
    // (see the IMMUNITY_SPELLS / externalDefensiveSpellIds tables in
    // deathOutcomeAnalysis.ts).
    const ironbark = recaps[0]!.missedExternals.find(
      (m) => m.spellName === "Ironbark",
    );
    expect(ironbark?.spellId).toBe("102342");
  });
});

describe("死亡回顾 —— I-1 阵营过滤回归(reviewer finding:敌方被误当队友)", () => {
  // deriveDeathRecaps passes the whole pool of players from BOTH sides as
  // buildDeathOutcomeSummary's `friends` pool (it has to review deaths on both
  // sides), and that function's teammate loop does no faction filtering — so a
  // still-alive ENEMY healer within 40yd/LoS who never pressed an external gets
  // treated as "the teammate who should have saved the victim" and lands in
  // missedExternals / counterfactuals, putting an enemy's name into claims like
  // "he clearly could have lived". zoneId is left empty to skip the LoS gate
  // (the geometry has its own dedicated LoS regression; this case only tests
  // faction filtering). Both potential casters share the victim's coordinates
  // (0 yards apart, definitely in range), one hostile and one friendly, so that
  // "the enemy does not show up" cannot be an accident of some other gate
  // (distance / cooldown / spec) filtering them out.
  const DEATH_T = 5_000_000;

  function combatantInfo(specId: number) {
    return {
      teamId: 0,
      specId,
      personalRating: 1500,
      talents: [],
      pvpTalents: [],
      equipment: [],
      interestingAuras: [],
    };
  }

  function buildCrossFactionSource(): ReportSource {
    return {
      kind: "match",
      id: "test-i1-faction-regression",
      bracket: "2v2",
      zoneId: "",
      startTime: DEATH_T - 30_000,
      endTime: DEATH_T + 1_000,
      playerId: "dead1",
      playerTeamId: 0,
      winningTeamId: null,
      result: "Lose",
      linesTotal: 0,
      linesDropped: 0,
      hasAdvancedLogging: true,
      timezone: "UTC",
      units: {
        dead1: {
          id: "dead1",
          name: "VictimWarrior",
          kind: "Player",
          reaction: "Friendly",
          classId: 1,
          specId: 71, // Warrior_Arms
          info: combatantInfo(71),
          deaths: [
            {
              timestamp: DEATH_T,
              eventName: "UNIT_DIED",
              spellId: 0,
              spellName: "",
              srcId: "",
              srcName: "",
              destId: "dead1",
              destName: "VictimWarrior",
              params: [],
              unconscious: false,
            },
          ],
          advancedSamples: [
            { timestamp: DEATH_T, hp: 0, maxHp: 100_000, x: 0, y: 0 },
          ],
        },
        // Control group: a same-faction teammate with the same Ironbark (never
        // cast) — this one MUST show up, otherwise "the enemy didn't show up"
        // could just mean the filter killed everybody (and the real bug would
        // go undetected).
        ally1: {
          id: "ally1",
          name: "AllyDruid",
          kind: "Player",
          reaction: "Friendly",
          classId: 11,
          specId: 105, // Druid_Restoration
          info: combatantInfo(105),
          advancedSamples: [
            { timestamp: DEATH_T, hp: 100_000, maxHp: 100_000, x: 0, y: 0 },
          ],
        },
        // What this case is really hunting: a living ENEMY healer holding the
        // same external (never cast), at the victim's coordinates, under no CC
        // — before the fix they were treated as "the teammate who failed to
        // save him" and pushed into missedExternals / counterfactuals.
        enemy1: {
          id: "enemy1",
          name: "EnemyDruid",
          kind: "Player",
          reaction: "Hostile",
          classId: 11,
          specId: 105, // Druid_Restoration
          info: combatantInfo(105),
          advancedSamples: [
            { timestamp: DEATH_T, hp: 100_000, maxHp: 100_000, x: 0, y: 0 },
          ],
        },
      },
    } as unknown as ReportSource;
  }

  it("敌方治疗(活着、同坐标、外置未按)不得出现在 missedExternals 里;同阵营对照组必须出现", () => {
    const recaps = deriveDeathRecaps(buildCrossFactionSource());
    expect(recaps).toHaveLength(1);
    const casters = recaps[0]!.missedExternals.map((m) => m.casterName);
    expect(casters).not.toContain("EnemyDruid");
    expect(casters).toContain("AllyDruid");
  });

  it("反事实(counterfactuals)同理:不得以敌方名字作为 decisive 候选的施法者", () => {
    const recaps = deriveDeathRecaps(buildCrossFactionSource());
    const enemyNamedHits = recaps[0]!.counterfactuals.filter(
      (c) => "casterName" in c && c.casterName === "EnemyDruid",
    );
    expect(enemyNamedHits).toHaveLength(0);
  });
});

describe("减伤核算/反事实(#17b Task4 输出面)", () => {
  const DEATH_T = 20_000; // ms; time of death (relative to startTime=0, i.e. 20s)

  function combatantInfo(specId: number) {
    return {
      teamId: 0,
      specId,
      personalRating: 1500,
      talents: [],
      pvpTalents: [],
      equipment: [],
      interestingAuras: [],
    };
  }

  /** Synthetic death window with Barkskin (22812, 20% pct, schoolMask = all
   * schools): 6s of coverage + 300k of damage landing inside the window → the
   * blocked amount must back-solve to exactly 75000 (≈8% of the 937500 maxHp).
   * We also add a SPELL_CAST_SUCCESS (same instant as the aura) so Barkskin is
   * on cooldown and computeUnusedSelfCounterfactuals does not misjudge it as
   * "available but never pressed". */
  function buildBarkskinSource(): ReportSource {
    return {
      kind: "match",
      id: "test-counterfactual-audit",
      bracket: "2v2",
      zoneId: "0",
      startTime: 0,
      endTime: DEATH_T + 1_000,
      playerId: "dead1",
      playerTeamId: 0,
      winningTeamId: null,
      result: "Lose",
      linesTotal: 0,
      linesDropped: 0,
      hasAdvancedLogging: true,
      timezone: "UTC",
      units: {
        dead1: {
          id: "dead1",
          name: "Druid1",
          kind: "Player",
          reaction: "Friendly",
          classId: 11, // Druid
          specId: 103, // Feral
          info: combatantInfo(103),
          deaths: [
            {
              timestamp: DEATH_T,
              eventName: "UNIT_DIED",
              spellId: 0,
              spellName: "",
              srcId: "",
              srcName: "",
              destId: "dead1",
              destName: "Druid1",
              params: [],
              unconscious: false,
            },
          ],
          advancedSamples: [
            // Start of the window (T-10s): the netDamage/HP sample. Its value
            // does not affect this test's assertions; it only has to exist.
            {
              timestamp: DEATH_T - 10_000,
              hp: 900_000,
              maxHp: 937_500,
              x: 0,
              y: 0,
            },
            { timestamp: DEATH_T, hp: 0, maxHp: 937_500, x: 0, y: 0 },
          ],
          casts: [
            {
              timestamp: DEATH_T - 6_000,
              eventName: "SPELL_CAST_SUCCESS",
              spellId: 22812,
              spellName: "Barkskin",
              srcId: "dead1",
              srcName: "Druid1",
              destId: "dead1",
              destName: "Druid1",
              params: [],
            },
          ],
          auraEvents: [
            {
              timestamp: DEATH_T - 6_000,
              eventName: "SPELL_AURA_APPLIED",
              spellId: 22812,
              spellName: "Barkskin",
              srcId: "dead1",
              srcName: "Druid1",
              destId: "dead1",
              destName: "Druid1",
              params: [],
              auraType: "BUFF",
            },
            {
              timestamp: DEATH_T,
              eventName: "SPELL_AURA_REMOVED",
              spellId: 22812,
              spellName: "Barkskin",
              srcId: "dead1",
              srcName: "Druid1",
              destId: "dead1",
              destName: "Druid1",
              params: [],
              auraType: "BUFF",
            },
          ],
          damageIn: [
            {
              timestamp: DEATH_T - 3_000,
              eventName: "SPELL_DAMAGE",
              spellId: 12222,
              spellName: "Test Dmg",
              srcId: "enemy1",
              srcName: "Enemy1",
              destId: "dead1",
              destName: "Druid1",
              amount: 300_000,
              effectiveAmount: 300_000,
              params: ["", "", "0x0", "", "", "0x0", "", "", "", "", "0x1"],
            },
          ],
        },
      },
    } as unknown as ReportSource;
  }

  it("Barkskin 激活死亡窗 → mitigationAudit 含 arith 行,具体数吻合(blockedAmount 75000/≈8%/覆盖 6.0s)", () => {
    const recaps = deriveDeathRecaps(buildBarkskinSource());
    expect(recaps).toHaveLength(1);
    const r = recaps[0]!;
    expect(r.mitigationAudit).toHaveLength(1);
    const row = r.mitigationAudit[0]!;
    expect(row.kind).toBe("arith");
    expect(row.spellName).toBe("Barkskin");
    expect(row.blockedAmount).toBe(75000);
    expect(row.blockedPctMaxHp).toBe(8);
    expect(row.activeOverlapS).toBe(6);
    // Single-player scenario, no teammate external and no held-back self
    // candidate (Barkskin is used and on cooldown) → decisive stays silent
    expect(r.counterfactuals).toEqual([]);
  });

  it("DeathRecapCard: mitigationAudit 非空 → 渲染减伤核算段(recap-mitigation);counterfactuals 空 → 不渲染 decisive 段", () => {
    const recaps = deriveDeathRecaps(buildBarkskinSource());
    render(<DeathRecapCard recap={recaps[0]!} onClose={() => {}} />);
    const el = screen.getByTestId("recap-mitigation");
    expect(el.textContent).toContain("Barkskin");
    expect(el.textContent).toContain("75");
    expect(screen.queryByTestId("recap-counterfactual")).toBeNull();
  });

  it("DeathRecapCard: counterfactuals 非空(decisive)→ 渲染反事实段(recap-counterfactual),含假设式措辞", () => {
    const recap: DeathRecap = {
      unitId: "v1",
      unitName: "Victim",
      deathS: 20,
      events: [],
      rows: [],
      availableImmunities: [],
      missedExternals: [],
      mitigationAudit: [],
      counterfactuals: [
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          source: "missed-external",
          casterName: "Priest1",
          savedAmount: 200000,
          savedPctMaxHp: 21.3,
          tier: "decisive",
        },
      ],
    };
    render(<DeathRecapCard recap={recap} onClose={() => {}} />);
    const el = screen.getByTestId("recap-counterfactual");
    expect(el.textContent).toContain("Priest1");
    expect(el.textContent).toContain("Pain Suppression");
    expect(el.textContent).toContain("算术口径");
    expect(screen.queryByTestId("recap-mitigation")).toBeNull();
  });

  it("DeathRecapCard: mitigationAudit 与 counterfactuals 都空 → 两段都不渲染(诚实伦理:宁缺,不出占位)", () => {
    const recap: DeathRecap = {
      unitId: "v1",
      unitName: "Victim",
      deathS: 20,
      events: [],
      rows: [],
      availableImmunities: [],
      missedExternals: [],
      mitigationAudit: [],
      counterfactuals: [],
    };
    render(<DeathRecapCard recap={recap} onClose={() => {}} />);
    expect(screen.queryByTestId("recap-mitigation")).toBeNull();
    expect(screen.queryByTestId("recap-counterfactual")).toBeNull();
  });
});

// #21 item1: DeathRecapCard was the one surface #15's inline icons never
// reached — every row that shows a spell name (event table rows / available-
// immunity pills / missed-external pills / mitigation-audit rows /
// counterfactual rows) now goes through ChipIcon (directly id-based, not the
// inlineRich free-text scanner; the rationale is in the #21 item1
// implementation note in CLAUDE.md). 740 (Tranquility) is the "id known to the
// table" sample already verified in SpellInline.test.tsx, and 999999999 is the
// verified "no such id in the table" sample — on a miss ChipIcon silently
// returns null: it must not throw and must not leave an icon placeholder node.
describe("#21 item1: DeathRecapCard 内联图标(事件行/pill/减伤/反事实)", () => {
  const KNOWN_ID = "740"; // Tranquility, already in SPELL_ICONS_GENERATED
  const UNKNOWN_ID = "999999999"; // confirmed absent from the table

  it("事件表格行:已知 spellId → 渲染图标占位节点;缺失/未知 spellId → 不渲染图标节点,只出文字", () => {
    const events: DeathRecap["events"] = [
      {
        tS: 5,
        kind: "dmg",
        spell: "Tranquility",
        spellId: KNOWN_ID,
        amount: 1000,
        srcName: "Attacker",
      },
      {
        tS: 6,
        kind: "heal",
        spell: "Unknown Spell",
        spellId: UNKNOWN_ID,
        amount: 500,
        srcName: "Healer",
      },
      {
        tS: 7,
        kind: "cc",
        spell: "No Id Spell",
        // spellId missing (the fallback path for old data / synthetic events
        // that don't provide one)
        srcName: "Attacker",
      },
    ];
    const recap: DeathRecap = {
      unitId: "v1",
      unitName: "Victim",
      deathS: 10,
      events,
      rows: events.map((e) => ({ type: "event", event: e })),
      availableImmunities: [],
      missedExternals: [],
      mitigationAudit: [],
      counterfactuals: [],
    };
    const { container } = render(
      <DeathRecapCard recap={recap} onClose={() => {}} />,
    );
    const dmgSpellTd = container.querySelector(
      ".rpt-recap-dmg .rpt-recap-spell",
    )!;
    expect(dmgSpellTd.querySelector(".rpt-spellicon-fallback")).not.toBeNull();
    expect(dmgSpellTd.textContent).toContain("Tranquility");

    const healSpellTd = container.querySelector(
      ".rpt-recap-heal .rpt-recap-spell",
    )!;
    expect(healSpellTd.querySelector(".rpt-spellicon-fallback")).toBeNull();
    expect(healSpellTd.textContent).toBe("Unknown Spell");

    const ccSpellTd = container.querySelector(
      ".rpt-recap-cc .rpt-recap-spell",
    )!;
    expect(ccSpellTd.querySelector(".rpt-spellicon-fallback")).toBeNull();
    expect(ccSpellTd.textContent).toBe("No Id Spell");
  });

  it("免疫可用 pill / 队友漏给 pill:已知 spellId 渲染图标占位节点", () => {
    const recap: DeathRecap = {
      unitId: "v1",
      unitName: "Victim",
      deathS: 10,
      events: [],
      rows: [],
      availableImmunities: [
        {
          spellId: KNOWN_ID,
          spellName: "Tranquility",
          wasInCC: false,
          cheaperAlternatives: [],
        },
      ],
      missedExternals: [
        {
          casterName: "Healer1",
          spellId: KNOWN_ID,
          spellName: "Tranquility",
          casterWasInCC: false,
        },
      ],
      mitigationAudit: [],
      counterfactuals: [],
    };
    const { container } = render(
      <DeathRecapCard recap={recap} onClose={() => {}} />,
    );
    const pills = container.querySelectorAll(".rpt-recap-pill");
    expect(pills.length).toBe(2);
    for (const pill of Array.from(pills)) {
      expect(pill.querySelector(".rpt-spellicon-fallback")).not.toBeNull();
    }
  });

  it("减伤核算行 / 反事实行:已知 spellId 渲染图标占位节点", () => {
    const recap: DeathRecap = {
      unitId: "v1",
      unitName: "Victim",
      deathS: 10,
      events: [],
      rows: [],
      availableImmunities: [],
      missedExternals: [],
      mitigationAudit: [
        {
          spellId: KNOWN_ID,
          spellName: "Tranquility",
          kind: "arith",
          activeOverlapS: 3,
          blockedAmount: 5000,
          blockedPctMaxHp: 5,
        },
      ],
      counterfactuals: [
        {
          spellId: KNOWN_ID,
          spellName: "Tranquility",
          source: "missed-external",
          casterName: "Healer1",
          savedAmount: 100000,
          savedPctMaxHp: 15,
          tier: "decisive",
        },
      ],
    };
    const { container } = render(
      <DeathRecapCard recap={recap} onClose={() => {}} />,
    );
    const mitigationRow = container.querySelector(".rpt-recap-mitigation-row")!;
    expect(
      mitigationRow.querySelector(".rpt-spellicon-fallback"),
    ).not.toBeNull();
    const counterfactualLine = container.querySelector(
      ".rpt-recap-counterfactual-line",
    )!;
    expect(
      counterfactualLine.querySelector(".rpt-spellicon-fallback"),
    ).not.toBeNull();
  });
});

// #10 T5: panic-use annotation (def_used rows) + cheaper-alternative annotation
// (availableImmunities rows). Both consume the existing analysis predicates
// directly (detectPanicDefensives / findCheaperDefensiveAlternatives) instead of
// rebuilding the judgement in the render layer — the gate predicate IS the spec.
describe("#10 T5: 恐慌性使用 + 更省替代", () => {
  function combatantInfo(specId: number) {
    return {
      teamId: 0,
      specId,
      personalRating: 1500,
      talents: [],
      pvpTalents: [],
      equipment: [],
      interestingAuras: [],
    };
  }

  describe("def_used 行 join 恐慌性使用(detectPanicDefensives)", () => {
    const DEATH_T = 20_000; // ms

    /** Retribution Paladin casts Divine Shield (642, categorized as immunities
     * and also in MAJOR_DEFENSIVE_IDS) twice before dying: at t=11s in
     * isolation with no incoming damage (panic), and at t=18s after taking 80k
     * in the preceding 1.5s (> the 60k DPS pressure threshold, so it counts as
     * a legitimately held cooldown, not panic). */
    function buildSource(): ReportSource {
      return {
        kind: "match",
        id: "test-panic-def-used",
        bracket: "2v2",
        zoneId: "0",
        startTime: 0,
        endTime: DEATH_T + 1_000,
        playerId: "pal1",
        playerTeamId: 0,
        winningTeamId: null,
        result: "Lose",
        linesTotal: 0,
        linesDropped: 0,
        hasAdvancedLogging: true,
        timezone: "UTC",
        units: {
          pal1: {
            id: "pal1",
            name: "Pally1",
            kind: "Player",
            reaction: "Friendly",
            classId: 2, // Paladin
            specId: 70, // Retribution
            info: combatantInfo(70),
            deaths: [
              {
                timestamp: DEATH_T,
                eventName: "UNIT_DIED",
                spellId: 0,
                spellName: "",
                srcId: "",
                srcName: "",
                destId: "pal1",
                destName: "Pally1",
                unconscious: false,
              },
            ],
            casts: [
              {
                eventName: "SPELL_CAST_SUCCESS",
                spellId: 642,
                spellName: "Divine Shield",
                timestamp: 11_000,
                srcId: "pal1",
                srcName: "Pally1",
                destId: "pal1",
                destName: "Pally1",
              },
              {
                eventName: "SPELL_CAST_SUCCESS",
                spellId: 642,
                spellName: "Divine Shield",
                timestamp: 18_000,
                srcId: "pal1",
                srcName: "Pally1",
                destId: "pal1",
                destName: "Pally1",
              },
            ],
            damageIn: [
              {
                eventName: "SPELL_DAMAGE",
                timestamp: 16_500,
                spellId: 1,
                spellName: "Test",
                srcId: "enemy1",
                srcName: "Enemy1",
                destId: "pal1",
                destName: "Pally1",
                amount: 80_000,
                effectiveAmount: 80_000,
              },
            ],
          },
          enemy1: {
            id: "enemy1",
            name: "Enemy1",
            kind: "Player",
            reaction: "Hostile",
            classId: 1,
            specId: 71,
            info: combatantInfo(71),
          },
        },
      } as unknown as ReportSource;
    }

    it("同秒(孤立无伤害的那次施放)→ panic:true;异秒(有真实压力的那次施放)→ 不带 panic", () => {
      const recaps = deriveDeathRecaps(buildSource());
      expect(recaps).toHaveLength(1);
      const defUsed = recaps[0]!.events.filter((e) => e.kind === "def_used");
      expect(defUsed).toHaveLength(2);
      const isolated = defUsed.find((e) => Math.round(e.tS) === 11);
      const pressured = defUsed.find((e) => Math.round(e.tS) === 18);
      expect(isolated).toBeTruthy();
      expect(pressured).toBeTruthy();
      expect(isolated!.panic).toBe(true);
      expect(pressured!.panic).not.toBe(true);
    });

    it("DeathRecapCard: panic:true 的事件行渲染恐慌徽标;非 panic 行不渲染", () => {
      const recaps = deriveDeathRecaps(buildSource());
      const { container } = render(
        <DeathRecapCard recap={recaps[0]!} onClose={() => {}} />,
      );
      const rows = container.querySelectorAll(".rpt-recap-def_used");
      expect(rows.length).toBe(2);
      const badges = container.querySelectorAll(".rpt-recap-panic-badge");
      expect(badges.length).toBe(1);
    });
  });

  describe("availableImmunities 行追加更省替代(findCheaperDefensiveAlternatives)", () => {
    // Marksmanship Hunter: both casts happen at t=10s (long before the death,
    // so both cooldowns are back up), and the death is at t=10000s — Aspect of
    // the Turtle (186265, 180s CD) was available at death and never pressed,
    // and Exhilaration (109304, 120s CD, strictly shorter) was available too,
    // so it must be attached as a cheaper alternative on the Aspect of the
    // Turtle pill.
    const DEATH_T = 10_000_000; // ms (10000s)

    function buildSource(): ReportSource {
      return {
        kind: "match",
        id: "test-cheaper-alt",
        bracket: "2v2",
        zoneId: "0",
        startTime: 0,
        endTime: DEATH_T + 1_000,
        playerId: "hunter1",
        playerTeamId: 0,
        winningTeamId: null,
        result: "Lose",
        linesTotal: 0,
        linesDropped: 0,
        hasAdvancedLogging: true,
        timezone: "UTC",
        units: {
          hunter1: {
            id: "hunter1",
            name: "Hunter1",
            kind: "Player",
            reaction: "Friendly",
            classId: 3, // Hunter
            specId: 254, // Marksmanship
            info: combatantInfo(254),
            deaths: [
              {
                timestamp: DEATH_T,
                eventName: "UNIT_DIED",
                spellId: 0,
                spellName: "",
                srcId: "",
                srcName: "",
                destId: "hunter1",
                destName: "Hunter1",
                unconscious: false,
              },
            ],
            casts: [
              {
                eventName: "SPELL_CAST_SUCCESS",
                spellId: 186265,
                spellName: "Aspect of the Turtle",
                timestamp: 10_000,
                srcId: "hunter1",
                srcName: "Hunter1",
                destId: "hunter1",
                destName: "Hunter1",
              },
              {
                eventName: "SPELL_CAST_SUCCESS",
                spellId: 109304,
                spellName: "Exhilaration",
                timestamp: 10_000,
                srcId: "hunter1",
                srcName: "Hunter1",
                destId: "hunter1",
                destName: "Hunter1",
              },
            ],
          },
          enemy1: {
            id: "enemy1",
            name: "Enemy1",
            kind: "Player",
            reaction: "Hostile",
            classId: 1,
            specId: 71,
            info: combatantInfo(71),
          },
        },
      } as unknown as ReportSource;
    }

    it("Aspect of the Turtle 死亡时可用未按 → cheaperAlternatives 含 Exhilaration(严格更短 CD)", () => {
      const recaps = deriveDeathRecaps(buildSource());
      expect(recaps).toHaveLength(1);
      const turtle = recaps[0]!.availableImmunities.find(
        (i) => i.spellId === "186265",
      );
      expect(turtle).toBeTruthy();
      expect(turtle!.cheaperAlternatives).toContain("Exhilaration");
    });

    it("DeathRecapCard: absorb 行渲染实测吸收量,不再套用「转移/反弹」机制文案", () => {
      const recap: DeathRecap = {
        unitId: "victim-1",
        unitName: "Victim",
        deathS: 100,
        events: [],
        rows: [],
        availableImmunities: [],
        missedExternals: [],
        mitigationAudit: [
          {
            spellId: "17",
            spellName: "Power Word: Shield",
            kind: "absorb",
            activeOverlapS: 5.8,
            absorbedAmount: 42_000,
            absorbedPctMaxHp: 8.4,
          },
        ],
        counterfactuals: [],
      };
      const { container } = render(
        <DeathRecapCard recap={recap} onClose={() => {}} />,
      );
      const text = container.textContent ?? "";
      expect(text).toContain("Power Word: Shield 吸收 ~42k");
      expect(text).toContain("8.4% maxHp");
      expect(text).toContain("覆盖 5.8s");
      // 判据:吸收盾不得被描述成转移/反弹机制(那是牺牲祝福那类的语义)
      expect(text).not.toContain("转移/反弹");
    });

    it("DeathRecapCard: deferred 行(Time Dilation / Stretch Time)写「推迟」和日志里的量,不写「挡了」或「吸收」(FT-T02b)", () => {
      const recap: DeathRecap = {
        unitId: "victim-1",
        unitName: "Victim",
        deathS: 100,
        events: [],
        rows: [],
        availableImmunities: [],
        missedExternals: [],
        mitigationAudit: [
          {
            spellId: "357170",
            spellName: "Time Dilation",
            kind: "deferred",
            activeOverlapS: 5.4,
            deferredAmount: 171_114,
            deferredPctMaxHp: 18.8,
          },
        ],
        counterfactuals: [],
      };
      const { container } = render(
        <DeathRecapCard recap={recap} onClose={() => {}} />,
      );
      const text = container.textContent ?? "";
      expect(text).toContain("Time Dilation 推迟了 ~171k");
      expect(text).toContain("18.8% maxHp");
      expect(text).toContain("覆盖 5.4s");
      expect(text).not.toContain("挡了");
      expect(text).not.toContain("吸收");
    });

    it("DeathRecapCard: cheaperAlternatives 非空 → pill 内追加「更省替代」文案", () => {
      const recaps = deriveDeathRecaps(buildSource());
      render(<DeathRecapCard recap={recaps[0]!} onClose={() => {}} />);
      expect(screen.getByText(/更省替代/)).toBeTruthy();
      expect(screen.getByText(/更省替代/).textContent).toContain(
        "Exhilaration",
      );
    });
  });
});
