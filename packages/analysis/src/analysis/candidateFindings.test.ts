import { CombatUnitClass, LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it, vi } from "vitest";

import {
  BRACKET_TYPE_ALLOWLIST,
  CANDIDATE_TYPE_FLAGS,
} from "../data/candidateTypeFlags";
import {
  extractMajorCooldowns,
  FORBEARANCE_GATED_IDS,
  type IMajorCooldownInfo,
  USABLE_WHILE_CC_SPELL_IDS,
} from "../utils/cooldowns";
import type { RawStreams } from "../utils/rawStreams";
import { matchThreatLevel, threatActiveAt } from "../utils/threatAssessment";
import {
  ccAvoidableEvents,
  ccAvoidanceOptionsAt,
  ccHeldEvents,
  ccLockedEvents,
  cdHoardedEvents,
  cdSpentIdleEvents,
  cdWasteEvents,
  deathSetupEvents,
  deathUnusedDefensiveEvents,
  enemyHealerCcWindows,
  enemyMinHpPctInWindow,
  externalUnusedEvents,
  extractCandidateFindings,
  friendlyCrisisMomentInWindow,
  HARD_CC_CATEGORIES,
  healingGapEvents,
  kickEatenEvents,
  LEGACY_TOPIC_TYPES,
  MANA_EFF_FLOOR,
  MANA_EFF_MIN_CASTS,
  MANA_PRESSURE_MIN_FAILED,
  MANA_PRESSURE_MIN_WINDOW_S,
  manaEfficiencyEvents,
  manaPressureEvents,
  missedCleanseEvents,
  missedPurgeEvents,
  missedSyncWindowEvents,
  positionMistakeEvents,
  trinketTeamMinHpPctAt,
  unsyncedBurstEvents,
  wastedTrinketEvents,
} from "./candidateFindings";
import { crisisNoResponseEvents } from "./candidates/crisisNoResponse";
import { crisisDecisionPoints } from "./crisisDecisionPoints";

// Synthetic combat: one Friendly death + one Hostile death. spec "256" is
// Priest_Discipline (a healer) with reaction 1 (Friendly).
function combat(): any {
  return {
    startTime: 0,
    endTime: 60000,
    units: {
      a: {
        id: "a",
        name: "Me-R",
        type: 1,
        reaction: 1,
        spec: "256",
        deathRecords: [{ timestamp: 30000 }],
        spellCastEvents: [],
        advancedActions: [],
        info: { teamId: "0" },
      },
      b: {
        id: "b",
        name: "Enemy-R",
        type: 1,
        reaction: 2,
        spec: "577",
        deathRecords: [{ timestamp: 45000 }],
        spellCastEvents: [],
        advancedActions: [],
        info: { teamId: "1" },
      },
    },
  };
}

describe("extractCandidateFindings", () => {
  it("emits a death CandidateEvent with a stable id, time, unit, and facts", () => {
    const evts = extractCandidateFindings(combat());
    const death = evts.find((e) => e.id === "death:a:30");
    expect(death).toBeTruthy();
    expect(death!.t).toBe(30);
    expect(death!.unitNames).toContain("Me-R");
    expect(death!.type).toBe("death");
    expect(death!.facts["t"]).toBe("30");
  });
  it("friendly deaths stay in the menu; enemy deaths (kill review) are demoted by default — killReview flag, GH #18 ruling (d) 2026-08-30", () => {
    const evts = extractCandidateFindings(combat());
    const mine = evts.find((e) => e.id === "death:a:30");
    expect(mine!.facts["side"]).toBe("friendly");
    expect(evts.find((e) => e.id === "death:b:45")).toBeUndefined();
  });
  it("tags each death friendly/enemy so the LLM knows a kill from a loss (killReview flipped on)", () => {
    CANDIDATE_TYPE_FLAGS.killReview = true;
    try {
      const evts = extractCandidateFindings(combat());
      const mine = evts.find((e) => e.id === "death:a:30");
      const theirs = evts.find((e) => e.id === "death:b:45");
      expect(mine!.facts["side"]).toBe("friendly");
      expect(theirs!.facts["side"]).toBe("enemy");
    } finally {
      CANDIDATE_TYPE_FLAGS.killReview = false;
    }
  });
  it("2v2 allow-list (GH #18 ruling (a)): only cd-hoarded / missed-cleanse survive; 3v3 untouched", () => {
    const c3 = combat();
    (c3 as any).startInfo = { bracket: "3v3" };
    const all = extractCandidateFindings(c3);
    expect(all.some((e) => e.type === "death")).toBe(true);
    const c2 = combat();
    (c2 as any).startInfo = { bracket: "2v2" };
    const kept = extractCandidateFindings(c2);
    expect(kept.every((e) => BRACKET_TYPE_ALLOWLIST["2v2"]!.has(e.type))).toBe(
      true,
    );
    expect(kept.some((e) => e.type === "death")).toBe(false);
  });
  it("excludes pet/guardian deaths (no COMBATANT_INFO) — players only", () => {
    const c = combat();
    // A warlock pet dies too, but has no `info` (not a real player).
    c.units.pet = {
      id: "pet",
      name: "Gzaadym",
      type: 3,
      reaction: 1,
      spec: "0",
      deathRecords: [{ timestamp: 20000 }],
      spellCastEvents: [],
      advancedActions: [],
    };
    CANDIDATE_TYPE_FLAGS.killReview = true; // both player deaths visible for the count below
    let evts: ReturnType<typeof extractCandidateFindings>;
    try {
      evts = extractCandidateFindings(c);
    } finally {
      CANDIDATE_TYPE_FLAGS.killReview = false;
    }
    expect(evts.some((e) => e.unitNames.includes("Gzaadym"))).toBe(false);
    // The two real player deaths are still present.
    expect(evts.filter((e) => e.type === "death")).toHaveLength(2);
  });
  it("returns [] for an empty combat without throwing", () => {
    expect(
      extractCandidateFindings({ startTime: 0, endTime: 1000, units: {} }),
    ).toEqual([]);
  });

  it("death-unused-defensive 已退役(GH #58,2026-08-29):即使走缺省 owner 回退、治疗自己死亡且有可用保命技,菜单也不再产出它(纯函数 deathUnusedDefensiveEvents 另有测试)", () => {
    // Priest_Holy (a healer, the fallback target), with Ultimate Penitence
    // (421453, 240s CD, Defensive and not throughput — the second spell that
    // extractMajorCooldowns dynamically appends for Priest, not in the talent
    // tree) never pressed all match, and not under any CC at death → free=yes.
    // Hitting info.pvpTalents is what gets it into the majorSpells ledger (the
    // existing rule that "a baseline spell is filtered out unless it was picked
    // as a PvP talent or was actually cast", see cooldowns.ts lines 617-629) —
    // purely a test-fixture device to make this never-used defensive show up in
    // the stats; it does not mean the player really picked that PvP talent.
    const c: any = {
      startTime: 0,
      endTime: 60000,
      startInfo: { zoneId: "0" },
      units: {
        h: {
          id: "h",
          name: "Healer-R",
          type: 1,
          reaction: 1,
          spec: "257", // Priest_Holy
          class: CombatUnitClass.Priest,
          deathRecords: [{ timestamp: 30000 }],
          spellCastEvents: [],
          advancedActions: [],
          auraEvents: [],
          actionIn: [],
          info: { teamId: "0", pvpTalents: ["421453"] },
        },
        e: {
          id: "e",
          name: "Enemy-R",
          type: 1,
          reaction: 2,
          spec: "577",
          class: CombatUnitClass.Warrior,
          deathRecords: [],
          spellCastEvents: [],
          advancedActions: [],
          auraEvents: [],
          actionIn: [],
          info: { teamId: "1" },
        },
      },
    };
    const evts = extractCandidateFindings(c); // no ownerId passed
    const found = evts.find((ev) => ev.type === "death-unused-defensive");
    expect(found).toBeUndefined();
  });

  it("信号扩容批 1(2026-08-06)接线冒烟:无位置数据 + 无 CC 大招 kit 的普通治疗轮 → position-mistake/cc-held 零产出,不崩溃(三态兑现在整条流水线上,不只在纯函数里)", () => {
    const c: any = {
      startTime: 0,
      endTime: 60000,
      startInfo: { zoneId: "0" },
      units: {
        h: {
          id: "h",
          name: "Healer-R",
          type: 1,
          reaction: 1,
          spec: "257", // Priest_Holy
          class: CombatUnitClass.Priest,
          deathRecords: [],
          spellCastEvents: [],
          healOut: [],
          advancedActions: [], // no position data → three-state
          auraEvents: [],
          actionIn: [],
          actionOut: [],
          damageIn: [],
          info: { teamId: "0" },
        },
        e: {
          id: "e",
          name: "Enemy-R",
          type: 1,
          reaction: 2,
          spec: "577",
          class: CombatUnitClass.Warrior,
          deathRecords: [],
          spellCastEvents: [],
          advancedActions: [],
          auraEvents: [],
          actionIn: [],
          actionOut: [],
          damageIn: [],
          info: { teamId: "1" },
        },
      },
    };
    const evts = extractCandidateFindings(c, "h");
    expect(evts.some((e) => e.type === "position-mistake")).toBe(false);
    expect(evts.some((e) => e.type === "cc-held")).toBe(false);
  });

  /**
   * cc-avoidable (DEFENSIVE-001, 2026-08-07) end-to-end fixture: the owner
   * eats a real full-DR Cheap Shot (physical, targeted, DR category falls
   * back to its own spellId — first application of the match, so
   * getDRLevel resolves "Full") lasting 4s (>= CC_AVOIDABLE_MIN_S), presses
   * the PvP trinket at t=0 (puts it on_cooldown by the time the CC lands at
   * t=50, so the dedupe gate does NOT exclude this instance), and casts
   * Divine Shield (642, cd 300s) once AFTER the CC at t=60 — proving kit
   * evidence while leaving the CC-time availability check untouched (no
   * cast strictly before t=50 → treated as available then, same semantics
   * ccAvoidanceOptionsAt's own unit tests pin down).
   */
  function ccAvoidableFixture(ownerSpec: string): any {
    // 2026-08-22: the CC here must be one the healer could SEE coming — the
    // type now requires a visible cast bar (Cheap Shot, the original fixture,
    // is an instant stealth opener, i.e. exactly what the reactability gate
    // exists to stop accusing people of).
    const ccStart = {
      logLine: { event: "SPELL_CAST_START", timestamp: 48_500 },
      timestamp: 48_500,
      spellId: "118",
      spellName: "Polymorph",
      srcUnitId: "e",
      srcUnitName: "Enemy-R",
      destUnitId: "h",
      destUnitName: "Healer-R",
    };
    const cheapShotApplied = {
      logLine: { event: "SPELL_AURA_APPLIED", timestamp: 50_000 },
      timestamp: 50_000,
      spellId: "118",
      spellName: "Polymorph",
      srcUnitId: "e",
      srcUnitName: "Enemy-R",
      destUnitId: "h",
      destUnitName: "Healer-R",
    };
    const cheapShotRemoved = {
      ...cheapShotApplied,
      logLine: { event: "SPELL_AURA_REMOVED", timestamp: 54_000 },
      timestamp: 54_000,
    };
    const trinketPress = {
      logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 0 },
      timestamp: 0,
      spellId: "336126", // Gladiator's Medallion
      spellName: "Gladiator's Medallion",
      srcUnitId: "h",
      srcUnitName: "Healer-R",
      destUnitId: "h",
      destUnitName: "Healer-R",
    };
    const divineShieldCast = {
      logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 60_000 },
      timestamp: 60_000,
      spellId: "642", // Divine Shield
      spellName: "Divine Shield",
      srcUnitId: "h",
      srcUnitName: "Healer-R",
      destUnitId: "h",
      destUnitName: "Healer-R",
    };
    return {
      startTime: 0,
      endTime: 120_000,
      startInfo: { zoneId: "0" },
      units: {
        h: {
          id: "h",
          name: "Healer-R",
          type: 1,
          reaction: 1,
          spec: ownerSpec,
          class: CombatUnitClass.Priest,
          deathRecords: [],
          spellCastEvents: [trinketPress, divineShieldCast],
          healOut: [],
          advancedActions: [],
          // Aura events are recorded on the unit that RECEIVED the debuff
          // (the owner, here), not the caster — this is what
          // analyzePlayerCCAndTrinket(player, …) reads as `player.auraEvents`.
          auraEvents: [cheapShotApplied, cheapShotRemoved],
          actionIn: [],
          actionOut: [],
          damageIn: [],
          info: { teamId: "0" },
        },
        e: {
          id: "e",
          name: "Enemy-R",
          type: 1,
          reaction: 2,
          spec: "577",
          class: CombatUnitClass.Warrior,
          deathRecords: [],
          spellCastEvents: [],
          castStartEvents: [ccStart],
          advancedActions: [],
          auraEvents: [],
          actionIn: [],
          actionOut: [],
          damageIn: [],
          info: { teamId: "1" },
        },
      },
    };
  }

  it("cc-avoidable(DEFENSIVE-001,2026-08-07)端到端:治疗 owner 吃满 Full-DR 变形术(4s,看得见读条)+ Divine Shield 落地前可用未用(饰品已在冷却,不触发去重门)→ 产出一条,facts 齐全", () => {
    const evts = extractCandidateFindings(ccAvoidableFixture("256"), "h"); // Priest_Discipline (healer)
    const found = evts.find((e) => e.type === "cc-avoidable");
    expect(found).toBeTruthy();
    expect(found!.facts["spell"]).toBe("Polymorph");
    expect(found!.facts["castBarSeen"]).toBe("yes");
    expect(found!.facts["durationS"]).toBe("4");
    expect(found!.facts["avoidableWith"]).toContain("Divine Shield");
  });

  it("cc-avoidable:非治疗 owner(判据=owner(治疗))→ 零产出,即便同一场景下 CC 本身满足条件", () => {
    const evts = extractCandidateFindings(ccAvoidableFixture("577"), "h"); // Warrior_Fury (not a healer)
    expect(evts.some((e) => e.type === "cc-avoidable")).toBe(false);
  });
});

describe("cdWasteEvents", () => {
  const healer = { id: "a", name: "Me-R" };

  it("emits a cd-waste event for a never-used survival cooldown", () => {
    const evts = cdWasteEvents(
      [
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          neverUsed: true,
          isThroughput: false,
        },
      ],
      healer,
      null,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0].id).toBe("cd-waste:a:33206");
    expect(evts[0].type).toBe("cd-waste");
    expect(evts[0].spell).toBe("Pain Suppression");
    expect(evts[0].facts).toEqual({ spell: "Pain Suppression", unit: "Me-R" });
  });
  it("skips a cooldown that was used", () => {
    const evts = cdWasteEvents(
      [
        {
          spellId: "33206",
          spellName: "Pain Suppression",
          neverUsed: false,
          isThroughput: false,
        },
      ],
      healer,
      null,
    );
    expect(evts).toEqual([]);
  });
  it("skips a never-used THROUGHPUT cooldown (not a survival wall)", () => {
    const evts = cdWasteEvents(
      [
        {
          spellId: "10060",
          spellName: "Power Infusion",
          neverUsed: true,
          isThroughput: true,
        },
      ],
      healer,
      null,
    );
    expect(evts).toEqual([]);
  });

  describe("cost_norm 守护注(#25,2026-08-14):在册技能 642(圣盾术)必须附带代价注", () => {
    it("在册 cost_norm 技能(642 圣盾术)→ facts.costNorm 出现", () => {
      const evts = cdWasteEvents(
        [
          {
            spellId: "642",
            spellName: "Divine Shield",
            neverUsed: true,
            isThroughput: false,
          },
        ],
        healer,
        null,
      );
      expect(evts).toHaveLength(1);
      expect(evts[0]!.facts.costNorm).toBeTruthy();
    });

    it("不在册技能(33206 Pain Suppression)→ facts 无 costNorm 字段", () => {
      const evts = cdWasteEvents(
        [
          {
            spellId: "33206",
            spellName: "Pain Suppression",
            neverUsed: true,
            isThroughput: false,
          },
        ],
        healer,
        null,
      );
      expect(evts).toHaveLength(1);
      expect(evts[0]!.facts).not.toHaveProperty("costNorm");
    });
  });
});

describe("deathSetupEvents(死亡前因链,纯函数)", () => {
  const victim = { id: "v1", name: "Victim-R" };

  it("healer-locked:治疗 CC 覆盖死亡前窗口且 ≥3s → 前因事件在 CC 时刻", () => {
    const evts = deathSetupEvents({
      deathT: 150,
      victim,
      healerCC: {
        healerName: "Healer-R",
        ccInstances: [
          // Covers the [138,150] window: 5s of CC starting at 143
          {
            atSeconds: 143,
            durationSeconds: 5,
            spellName: "Fear",
            sourceName: "E",
          },
        ],
      },
    });
    expect(evts).toHaveLength(1);
    const e = evts[0]!;
    expect(e.type).toBe("death-setup");
    expect(e.t).toBe(143);
    expect(e.facts["kind"]).toBe("healer-locked");
    expect(e.facts["deathT"]).toBe("150");
    expect(e.facts["healer"]).toBe("Healer-R");
    expect(e.unitNames).toEqual(["Healer-R", "Victim-R"]);
  });

  it("healer CC 过短(<3s)或在窗口外 → 不出", () => {
    const short = deathSetupEvents({
      deathT: 150,
      victim,
      healerCC: {
        healerName: "H",
        ccInstances: [
          {
            atSeconds: 145,
            durationSeconds: 2,
            spellName: "Kick",
            sourceName: "E",
          },
        ],
      },
    });
    expect(short).toHaveLength(0);
    const outside = deathSetupEvents({
      deathT: 150,
      victim,
      healerCC: {
        healerName: "H",
        ccInstances: [
          // 120+8=128 < 150-12=138 → outside the window
          {
            atSeconds: 120,
            durationSeconds: 8,
            spellName: "Fear",
            sourceName: "E",
          },
        ],
      },
    });
    expect(outside).toHaveLength(0);
  });

  it("trinket-early:死亡窗口内被控且饰品 CD 中 → 前因在更早的饰品施放时刻;超 90s 回溯不出", () => {
    const base = {
      deathT: 150,
      victim,
      victimCC: {
        ccInstances: [
          {
            atSeconds: 146,
            durationSeconds: 6,
            spellName: "Stun",
            trinketState: "on_cooldown",
          },
        ],
        trinketUseTimes: [80],
      },
    };
    const evts = deathSetupEvents(base);
    expect(evts).toHaveLength(1);
    expect(evts[0]!.t).toBe(80);
    expect(evts[0]!.facts["kind"]).toBe("trinket-early");
    expect(evts[0]!.facts["ccAtDeath"]).toBe("Stun");
    expect(evts[0]!.facts["gapS"]).toBe("70");
    // Look-back beyond 90s (death 150, trinket 40 → gap 110) emits nothing
    const tooOld = deathSetupEvents({
      ...base,
      victimCC: { ...base.victimCC, trinketUseTimes: [40] },
    });
    expect(tooOld).toHaveLength(0);
  });

  it("defensive-early:死亡时 ON COOLDOWN 且上次使用被审计标 Early;Optimal/可用则不出", () => {
    const cd = (
      timingLabel: string,
      timeSeconds: number,
      cooldownSeconds = 120,
    ) => ({
      spellId: "1",
      spellName: "Wall",
      tag: "Defensive",
      cooldownSeconds,
      neverUsed: false,
      casts: [{ timeSeconds, timingLabel: timingLabel as never }],
    });
    const early = deathSetupEvents({
      deathT: 150,
      victim,
      victimCDs: [cd("Early", 100)], // ready at 220 > 150 → still on cooldown
    });
    expect(early).toHaveLength(1);
    expect(early[0]!.facts["kind"]).toBe("defensive-early");
    expect(early[0]!.t).toBe(100);
    expect(early[0]!.facts["gapS"]).toBe("50");
    // An Optimal usage emits nothing
    expect(
      deathSetupEvents({
        deathT: 150,
        victim,
        victimCDs: [cd("Optimal", 100)],
      }),
    ).toHaveLength(0);
    // Back up by the time of death (available-but-unpressed belongs to
    // death-trace, not to the used-too-early chain) emits nothing
    expect(
      deathSetupEvents({
        deathT: 150,
        victim,
        victimCDs: [cd("Early", 20, 60)],
      }),
    ).toHaveLength(0);
  });

  it("每死亡至多 2 条,优先 healer-locked > trinket-early > defensive-early", () => {
    const evts = deathSetupEvents({
      deathT: 150,
      victim,
      healerCC: {
        healerName: "H",
        ccInstances: [
          {
            atSeconds: 143,
            durationSeconds: 5,
            spellName: "Fear",
            sourceName: "E",
          },
        ],
      },
      victimCC: {
        ccInstances: [
          {
            atSeconds: 146,
            durationSeconds: 6,
            spellName: "Stun",
            trinketState: "on_cooldown",
          },
        ],
        trinketUseTimes: [80],
      },
      victimCDs: [
        {
          spellId: "1",
          spellName: "Wall",
          tag: "Defensive",
          cooldownSeconds: 120,
          neverUsed: false,
          casts: [{ timeSeconds: 100, timingLabel: "Early" as never }],
        },
      ],
    });
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["kind"])).toEqual([
      "healer-locked",
      "trinket-early",
    ]);
  });
});

describe("death-unused-defensive(死亡时保命技可用未按)", () => {
  const wall = (over: Partial<IMajorCooldownInfo> = {}) => ({
    spellId: "108271", // Astral Shift
    spellName: "Astral Shift",
    tag: "Defensive",
    cooldownSeconds: 90,
    casts: [],
    neverUsed: true,
    isThroughput: false,
    ...over,
  });
  const base = {
    deathT: 100,
    victim: { id: "p1", name: "Me-R" },
    victimCDs: [wall()],
    victimCC: { ccInstances: [], trinketUseTimes: [] },
  };

  it("可用保命技 + 死亡时不在 CC → 发一条,facts 列技能与 free=yes", () => {
    const ev = deathUnusedDefensiveEvents(base, { isOwner: true });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("death-unused-defensive");
    expect(ev[0]!.facts.walls).toContain("Astral Shift");
    expect(ev[0]!.facts.free).toBe("yes");
  });

  it("非 owner 的死亡 → 不发(指摘只对 owner)", () => {
    expect(deathUnusedDefensiveEvents(base, { isOwner: false })).toEqual([]);
  });

  it("保命技死亡时在 CD → 不发", () => {
    const p = {
      ...base,
      victimCDs: [wall({ casts: [{ timeSeconds: 50 }], neverUsed: false })],
    }; // readyAt=140 > deathT=100
    expect(deathUnusedDefensiveEvents(p, { isOwner: true })).toEqual([]);
  });

  it("死亡时在 CC 且饰品在 CD → 不自由,不发", () => {
    const p = {
      ...base,
      victimCC: {
        ccInstances: [
          {
            atSeconds: 96,
            durationSeconds: 6,
            spellName: "Polymorph",
            trinketState: "on_cooldown",
          },
        ],
        trinketUseTimes: [40],
      },
    };
    expect(deathUnusedDefensiveEvents(p, { isOwner: true })).toEqual([]);
  });

  it("死亡时在 CC 但饰品可用 → 仍发(free=trinket_in_hand)", () => {
    const p = {
      ...base,
      victimCC: {
        ccInstances: [
          {
            atSeconds: 96,
            durationSeconds: 6,
            spellName: "Polymorph",
            trinketState: "available_unused",
          },
        ],
        trinketUseTimes: [],
      },
    };
    const ev = deathUnusedDefensiveEvents(p, { isOwner: true });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.facts.free).toBe("trinket_in_hand");
  });

  it("死亡时在 CC 且饰品为被动饰品(Relentless passive_trinket)→ 不自由,不发(回归:此前 !== on_cooldown 误把被动饰品当 trinket_in_hand,假指摘玩家没解一个不存在的主动饰品)", () => {
    const p = {
      ...base,
      victimCC: {
        ccInstances: [
          {
            atSeconds: 96,
            durationSeconds: 6,
            spellName: "Polymorph",
            trinketState: "passive_trinket",
          },
        ],
        trinketUseTimes: [],
      },
    };
    expect(deathUnusedDefensiveEvents(p, { isOwner: true })).toEqual([]);
  });

  it("死亡时在 CC 且饰品已用(used)→ 不自由,不发", () => {
    const p = {
      ...base,
      victimCC: {
        ccInstances: [
          {
            atSeconds: 96,
            durationSeconds: 6,
            spellName: "Polymorph",
            trinketState: "used",
          },
        ],
        trinketUseTimes: [40],
      },
    };
    expect(deathUnusedDefensiveEvents(p, { isOwner: true })).toEqual([]);
  });

  it("victimCC 缺席(摘要不可算)→ 不发(宁缺勿假指摘,不能默认 free=yes)", () => {
    const p = { ...base, victimCC: undefined };
    expect(deathUnusedDefensiveEvents(p, { isOwner: true })).toEqual([]);
  });

  it("throughput 型不算保命技 → 不发", () => {
    const p = { ...base, victimCDs: [wall({ isThroughput: true })] };
    expect(deathUnusedDefensiveEvents(p, { isOwner: true })).toEqual([]);
  });

  // Take the id from the real whitelist (do not mock the set itself): we need an
  // id that is in USABLE_WHILE_CC_SPELL_IDS but NOT in FORBEARANCE_GATED_IDS, so
  // this case does not interfere with the Forbearance case below.
  const usableInCcOnlyId = [...USABLE_WHILE_CC_SPELL_IDS].find(
    (id) => !FORBEARANCE_GATED_IDS.has(id),
  )!;

  it("死亡时在纯晕 CC 且饰品在 CD,但技能在 CC 中可用清单里 → 仍发,free=usable_in_cc", () => {
    // The freeState=null branch (under CC with trinketState=on_cooldown) may
    // only pass on a hit in USABLE_WHILE_CC_SPELL_IDS AND the CC being Stun —
    // this is the one path in the whole package that emits the "usable_in_cc"
    // string, without which a flipped freeState===null && !has(...) condition
    // (||/&& written the wrong way round) would be caught by no test at all.
    const p = {
      ...base,
      victimCC: {
        ccInstances: [
          {
            atSeconds: 96,
            durationSeconds: 6,
            spellName: "Stun",
            trinketState: "on_cooldown",
            drInfo: { category: "Stun" },
          },
        ],
        trinketUseTimes: [],
      },
      victimCDs: [
        wall({ spellId: usableInCcOnlyId, spellName: "UsableInCC-Wall" }),
      ],
    };
    const ev = deathUnusedDefensiveEvents(p, { isOwner: true });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.facts.free).toBe("usable_in_cc");
    expect(ev[0]!.facts.walls).toContain("UsableInCC-Wall");
  });

  it("死亡时在恐惧(非晕)CC 且饰品在 CD,即使技能在 CC 中可用清单里 → 仍不发(finding #1,2026-08-14 终审:USABLE_WHILE_CC_SPELL_IDS 只是「晕中可用」表,非晕类硬控必须无条件赦免,不得按该表判定)", () => {
    const p = {
      ...base,
      victimCC: {
        ccInstances: [
          {
            atSeconds: 96,
            durationSeconds: 6,
            spellName: "Fear",
            trinketState: "on_cooldown",
            drInfo: { category: "Disorient" },
          },
        ],
        trinketUseTimes: [],
      },
      victimCDs: [
        wall({ spellId: usableInCcOnlyId, spellName: "UsableInCC-Wall" }),
      ],
    };
    expect(deathUnusedDefensiveEvents(p, { isOwner: true })).toEqual([]);
  });

  it("死亡时在 CC 但 drInfo 缺失(未知类别)→ 保守按非晕处理,不发", () => {
    const p = {
      ...base,
      victimCC: {
        ccInstances: [
          {
            atSeconds: 96,
            durationSeconds: 6,
            spellName: "Unknown-CC",
            trinketState: "on_cooldown",
          },
        ],
        trinketUseTimes: [],
      },
      victimCDs: [
        wall({ spellId: usableInCcOnlyId, spellName: "UsableInCC-Wall" }),
      ],
    };
    expect(deathUnusedDefensiveEvents(p, { isOwner: true })).toEqual([]);
  });

  it("Forbearance 期内的圣盾类:自施 30s 内即使裸 CD 显示可用也要排除,不发", () => {
    // Divine-Shield-class spells physically cannot be pressed inside the
    // Forbearance window; if this exclusion regresses, the coach would falsely
    // accuse the player of not pressing a button they could not press — exactly
    // the false accusation this predicate exists to prevent, and until now no
    // test could catch that regression.
    const forbearanceGatedId = [...FORBEARANCE_GATED_IDS][0]!;
    const forbUnit = {
      id: "p1",
      spellCastEvents: [
        {
          logLine: { event: LogEvent.SPELL_CAST_SUCCESS },
          spellId: forbearanceGatedId,
          // matchStartMs=0 → 80s; deathT=100 → 20s earlier, inside the 30s window
          timestamp: 80_000,
          destUnitId: "p1",
        },
      ],
    };
    const p = {
      ...base,
      victimCDs: [
        wall({
          spellId: forbearanceGatedId,
          spellName: "Forbearance-Gated-Wall",
        }),
      ],
    };
    const ev = deathUnusedDefensiveEvents(
      p,
      { isOwner: true, unit: forbUnit },
      { startTime: 0, units: { p1: forbUnit } },
    );
    expect(ev).toEqual([]);
  });

  describe("cost_norm 守护注(#25,2026-08-14):圣盾/冰箱类『机制可用但代价禁常规』", () => {
    it("死亡时保命技命中在册 cost_norm(642 圣盾术)→ facts.costNorm 出现", () => {
      const p = {
        ...base,
        victimCDs: [wall({ spellId: "642", spellName: "Divine Shield" })],
      };
      const ev = deathUnusedDefensiveEvents(p, { isOwner: true });
      expect(ev).toHaveLength(1);
      expect(ev[0]!.facts.costNorm).toBeTruthy();
    });

    it("死亡时保命技不在 cost_norm 册(Astral Shift)→ facts 无 costNorm 字段", () => {
      const ev = deathUnusedDefensiveEvents(base, { isOwner: true });
      expect(ev).toHaveLength(1);
      expect(ev[0]!.facts).not.toHaveProperty("costNorm");
    });
  });

  describe("意图守护(BACKLOG #26 Task 2,按了被拒不算屯——三条红线)", () => {
    // base: deathT=100, victim.id="p1", wall=Astral Shift(108271) never cast
    // (casts:[]) → the guard's "available since" window is [0, 100].
    it("① 死亡前窗内该技能 CAST_FAILED×3(两种理由)→ facts.attempted 按频次聚合(尚未恢复×2、法力值不足×1)", () => {
      const rawStreams: RawStreams = {
        available: true,
        manaSamples: [],
        castFailed: [
          {
            tSeconds: 45.3,
            unitGuid: "p1",
            spellId: 108271,
            spellName: "Astral Shift",
            reason: "尚未恢复",
          },
          {
            tSeconds: 72.8,
            unitGuid: "p1",
            spellId: 108271,
            spellName: "Astral Shift",
            reason: "尚未恢复",
          },
          {
            tSeconds: 90.1,
            unitGuid: "p1",
            spellId: 108271,
            spellName: "Astral Shift",
            reason: "法力值不足",
          },
        ],
      };
      const ev = deathUnusedDefensiveEvents(
        base,
        { isOwner: true },
        undefined,
        rawStreams,
      );
      expect(ev).toHaveLength(1);
      expect(ev[0]!.facts["attempted"]).toBe(
        "曾尝试施放被拒(尚未恢复×2、法力值不足×1)",
      );
    });

    it("② 真没按(窗内有 CAST_FAILED,但不同技能/不同单位,零命中)→ facts 逐字段与无 rawStreams 时完全相同", () => {
      const rawStreams: RawStreams = {
        available: true,
        manaSamples: [],
        castFailed: [
          // Wrong spellId.
          {
            tSeconds: 45.3,
            unitGuid: "p1",
            spellId: 99999,
            spellName: "Some Other Spell",
            reason: "尚未恢复",
          },
          // Wrong unit.
          {
            tSeconds: 72.8,
            unitGuid: "someone-else",
            spellId: 108271,
            spellName: "Astral Shift",
            reason: "法力值不足",
          },
        ],
      };
      const withGuard = deathUnusedDefensiveEvents(
        base,
        { isOwner: true },
        undefined,
        rawStreams,
      );
      const without = deathUnusedDefensiveEvents(base, { isOwner: true });
      expect(withGuard).toEqual(without);
      expect(withGuard[0]!.facts["attempted"]).toBeUndefined();
    });

    it("③ rawStreams 缺省 / available:false → 逐字段与无 rawStreams 时完全相同(优雅降级,绝不 throw)", () => {
      const without = deathUnusedDefensiveEvents(base, { isOwner: true });
      const absent = deathUnusedDefensiveEvents(
        base,
        { isOwner: true },
        undefined,
        undefined,
      );
      expect(absent).toEqual(without);
      const unavailable: RawStreams = {
        available: false,
        manaSamples: [],
        castFailed: [
          {
            tSeconds: 45.3,
            unitGuid: "p1",
            spellId: 108271,
            spellName: "Astral Shift",
            reason: "尚未恢复",
          },
        ],
      };
      const withUnavailable = deathUnusedDefensiveEvents(
        base,
        { isOwner: true },
        undefined,
        unavailable,
      );
      expect(withUnavailable).toEqual(without);
    });

    // #29 rewrite (2026-08-17): GCD-spam presses are not "pressed but
    // rejected" — same filterIntentGuardEvidence (shared.ts) as cd-hoarded;
    // the death side derives ownCastSuccessSeconds from victim.unit's own
    // spellCastEvents (already threaded for the Forbearance check).
    it("④ #29:自己刚成功施放 ≤1.5s 内的「尚未恢复」是 GCD 不算证据;其余理由保留", () => {
      const victimUnit = {
        id: "p1",
        spellCastEvents: [
          {
            logLine: { event: LogEvent.SPELL_CAST_SUCCESS },
            spellId: "8092", // any filler cast triggering the GCD
            timestamp: 44_000, // matchStartMs=0 → t=44s
            destUnitId: "e1",
          },
        ],
      };
      const rawStreams: RawStreams = {
        available: true,
        manaSamples: [],
        castFailed: [
          // 1.3s after own successful cast at 44s → GCD artifact, excluded.
          {
            tSeconds: 45.3,
            unitGuid: "p1",
            spellId: 108271,
            spellName: "Astral Shift",
            reason: "尚未恢复",
          },
          // Mid-window, no adjacent own cast → genuine, kept.
          {
            tSeconds: 90.1,
            unitGuid: "p1",
            spellId: 108271,
            spellName: "Astral Shift",
            reason: "法力值不足",
          },
        ],
      };
      const ev = deathUnusedDefensiveEvents(
        base,
        { isOwner: true, unit: victimUnit },
        { startTime: 0, units: { p1: victimUnit } },
        rawStreams,
      );
      expect(ev).toHaveLength(1);
      expect(ev[0]!.facts["attempted"]).toBe("曾尝试施放被拒(法力值不足×1)");
    });
  });
});

describe("crisis-no-response wiring(菜单接线 + death-unused-defensive precededBy,2026-08-29)", () => {
  const T0 = 5_000_000;
  // Full IAdvancedAction shape (not crisisDecisionPoints.test.ts's bare-bones
  // helper): extractCandidateFindings' cd-waste branch calls matchMinHpPct →
  // getLowestHpPercentInWindow, which reads `.logLine.timestamp`, so both the
  // flat `.timestamp` crisisDecisionPoints reads AND the nested `.logLine.
  // timestamp` the rest of the pipeline reads must be present and agree.
  const hp = (t: number, cur: number, max = 100, unitId = "H") => ({
    timestamp: T0 + t,
    advancedActorCurrentHp: cur,
    advancedActorMaxHp: max,
    advancedActorPositionX: 0,
    advancedActorPositionY: 0,
    advancedActorPowers: [],
    advancedActorId: unitId,
    advanced: true,
    logLine: { event: "ADVANCED_SAMPLE", timestamp: T0 + t },
  });
  // Healer owner "H" (Restoration Druid, spec "105") crosses 40% HP at 2s
  // (100→70→38→35 at 0/1/2/3s) from a single 30-dmg hit by "E1" at 1.5s, with
  // no casts/CC/self-heal in the response window → an unanswered feasible AND
  // dangerous (dmg2s=0.30 >= CRISIS_MIN_DMG2S) crossing. bracket "3v3" matches
  // a real cell in behaviorPriorGenerated.json (dmg2s=0.30 → ">=20%" bin) so
  // the reference lookup is non-null.
  // pvpTalents: ["22812"] (Barkskin) puts a never-cast Defensive major CD into
  // H's ledger the same way the existing "agy flash 复核采纳" fixture above
  // does for Ultimate Penitence — a baseline ability only enters
  // extractMajorCooldowns' ledger on cast evidence or a PvP-talent pick.
  function fixture(over: { hDeathT?: number } = {}): any {
    return {
      startTime: T0,
      endTime: T0 + 60_000,
      startInfo: { bracket: "3v3" },
      units: {
        H: {
          id: "H",
          name: "Heals-R",
          type: 1,
          reaction: 1,
          spec: "105", // Druid_Restoration
          class: CombatUnitClass.Druid,
          advancedActions: [
            hp(0, 100),
            hp(1000, 70),
            hp(2000, 38),
            hp(3000, 35),
          ],
          damageIn: [
            {
              timestamp: T0 + 1500,
              srcUnitId: "E1",
              amount: -30,
              effectiveAmount: -30,
            },
          ],
          healIn: [],
          spellCastEvents: [],
          auraEvents: [],
          actionIn: [],
          deathRecords:
            over.hDeathT != null
              ? [{ timestamp: T0 + over.hDeathT * 1000 }]
              : [],
          info: { teamId: "0", pvpTalents: ["22812"] },
        },
        // E1 is also given its own feasible & dangerous crisis crossing
        // (spec §1d, GH #59): HP 100→70→38→35 at 0/1/2/3s from a single
        // 30-dmg hit at 1.5s (dmg2s=0.30, same shape as H's), no
        // casts/CC/root/self-heal in the response window → unanswered. No
        // `class`/talent/pvp-talent data resolves to a real Defensive/Control
        // major CD for it, so wallReady=controlReady=false and it is never
        // rooted either — hasTool=true trivially via `!rooted`, so this
        // crossing is feasible regardless of gate 3.
        E1: {
          id: "E1",
          name: "E1",
          type: 1,
          reaction: 2,
          spec: "577", // Demon_Hunter_Havoc — non-healer
          class: CombatUnitClass.DemonHunter,
          advancedActions: [
            // 4th arg = advancedActorId: these samples belong to E1, and
            // `gridHpPct` (the [STATE] sampler the crisis anchor now shares)
            // rejects any sample whose advancedActorId is not the unit's own.
            hp(0, 100, 100, "E1"),
            hp(1000, 70, 100, "E1"),
            hp(2000, 38, 100, "E1"),
            hp(3000, 35, 100, "E1"),
          ],
          damageIn: [
            {
              timestamp: T0 + 1500,
              srcUnitId: "H",
              amount: -30,
              effectiveAmount: -30,
            },
          ],
          healIn: [],
          spellCastEvents: [],
          auraEvents: [],
          actionIn: [],
          deathRecords: [],
          info: { teamId: "1" },
        },
      },
    };
  }

  it("healer owner: an unanswered feasible crossing appears in the menu with reference facts", () => {
    const ev = extractCandidateFindings(fixture(), "H").filter(
      (c) => c.type === "crisis-no-response",
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.facts.refDeathNoResp).toMatch(/^\d+$/);
    expect(ev[0]!.facts.refDeathResp).toMatch(/^\d+$/);
    expect(ev[0]!.facts.cellKey.startsWith("3v3|healer|")).toBe(true);
  });

  it("death-unused-defensive is no longer emitted alongside it (retired GH #58, 2026-08-29) — no precededBy marking remains", () => {
    const all = extractCandidateFindings(fixture({ hDeathT: 9 }), "H");
    const dud = all.find((c) => c.type === "death-unused-defensive");
    expect(dud).toBeUndefined();
  });

  it("DPS owner: feasible & dangerous crossing exists but no dps reference cell exists yet in behaviorPriorGenerated.json, so lookupBehaviorPrior returns null and the wiring emits nothing — byte-identical DPS output until the dps scan lands (spec §1d)", () => {
    const ev = extractCandidateFindings(fixture(), "E1").filter(
      (c) => c.type === "crisis-no-response",
    );
    expect(ev).toEqual([]);
  });

  it("DPS owner: the producer fires when given a non-null reference (crisisDecisionPoints role='dps' feeding crisisNoResponseEvents directly, mirroring the candidateFindings.ts DPS branch's shape)", () => {
    const f = fixture();
    const points = crisisDecisionPoints(f.units.E1, f, "dps");
    const eligible = points.filter(
      (p: any) => p.feasible && p.dangerous && !p.responded,
    );
    expect(eligible).toHaveLength(1);
    const fakeRef = {
      cellKey: "3v3|dps|>=20%",
      fellBack: false,
      nNoResp: 40,
      deathNoRespPct: 18,
      nResp: 25,
      deathRespPct: 8,
      outcome: "ownDeath10s" as const,
      top: [["control", 30]] as [string, number][],
    };
    const ev = crisisNoResponseEvents(points, { id: "E1", name: "E1" }, "3v3", {
      lookup: () => fakeRef,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("crisis-no-response");
    expect(ev[0]!.facts.cellKey).toBe("3v3|dps|>=20%");
  });
});

describe("external-unused(队友阵亡时 owner 外减可用未给)", () => {
  const ext = (over = {}) => ({
    spellId: "102342", // Ironbark
    spellName: "Ironbark",
    tag: "Defensive",
    cooldownSeconds: 90,
    casts: [],
    neverUsed: true,
    isThroughput: false,
    ...over,
  });
  const owner = { id: "h1", name: "Healer-R" };
  const victim = { id: "p2", name: "Mate-R" };

  it("外减可用 + owner 死亡前窗口有空档 → 发一条", () => {
    const ev = externalUnusedEvents({
      deathT: 100,
      victim,
      owner,
      ownerExternals: [ext()],
      ownerCC: [], // free the whole time
      ownerAliveAt: () => true,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("external-unused");
    expect(ev[0]!.facts.external).toBe("Ironbark");
  });

  it("外减在 CD → 不发", () => {
    const ev = externalUnusedEvents({
      deathT: 100,
      victim,
      owner,
      ownerExternals: [ext({ casts: [{ timeSeconds: 60 }], neverUsed: false })], // readyAt=150
      ownerCC: [],
      ownerAliveAt: () => true,
    });
    expect(ev).toEqual([]);
  });

  it("owner 死亡前窗口 [95,100] 全被 CC 覆盖 → 不自由,不发", () => {
    const ev = externalUnusedEvents({
      deathT: 100,
      victim,
      owner,
      ownerExternals: [ext()],
      ownerCC: [{ atSeconds: 94, durationSeconds: 7 }], // covers [94,101]
      ownerAliveAt: () => true,
    });
    expect(ev).toEqual([]);
  });

  it("窗口内有 ≥1.5s 空档(CC 只盖 [95,99])→ 发", () => {
    const ev = externalUnusedEvents({
      deathT: 100,
      victim,
      owner,
      ownerExternals: [ext()],
      // gap [99,100] is only 1s… plus [0s before 95]?
      ownerCC: [{ atSeconds: 95, durationSeconds: 4 }],
      ownerAliveAt: () => true,
    });
    // Window [95,100]: CC covers [95,99] → largest gap 1.0s < 1.5 → no event
    expect(ev).toEqual([]);
    const ev2 = externalUnusedEvents({
      deathT: 100,
      victim,
      owner,
      ownerExternals: [ext()],
      ownerCC: [{ atSeconds: 95, durationSeconds: 3 }], // gap [98,100] = 2s ≥ 1.5
      ownerAliveAt: () => true,
    });
    expect(ev2).toHaveLength(1);
  });

  it("owner 在 deathT 已死亡 → 不发", () => {
    const ev = externalUnusedEvents({
      deathT: 100,
      victim,
      owner,
      ownerExternals: [ext()],
      ownerCC: [],
      ownerAliveAt: () => false,
    });
    expect(ev).toEqual([]);
  });
});

describe("团队协作候选映射(2026-07-24 覆盖面扩充)", () => {
  // Priest_Discipline (256) is a MAGIC_REMOVERS spec, so windows tagged
  // dispelType "Magic" leave this owner's capability gate untouched — this
  // fixture exercises the pre-existing priority/CD/cap behavior only.
  const dispelOwner = { id: "owner", spec: "256" };
  it("missed-cleanse:只报 Critical/High 且解控可用;按承伤排序截 2(TEMPORARY 上限,BACKLOG #22)", () => {
    const w = (p: string, dmg: number, onCD = false) => ({
      timeSeconds: 30,
      durationSeconds: 5,
      targetName: "Ally",
      spellName: "Fear",
      spellId: "5782",
      priority: p as never,
      postCcDamage: dmg,
      cleanseWasOnCD: onCD,
      // Feasibility gates default to fully open (the gates' own behavior is
      // covered separately in dispelGates.test.ts)
      dispellersLockedOut: false,
      losReachable: null,
      drChainRisk: false,
      dispelType: "Magic" as const,
    });
    const evts = missedCleanseEvents(
      [
        w("Critical", 100_000),
        w("High", 50_000),
        w("Medium", 999_999), // low priority, not reported
        w("Critical", 80_000, true), // cleanse on cooldown, not reported
        w("High", 70_000), // the 3rd-heaviest qualifying entry, truncated away
        w("High", 60_000), // the 4th entry, also truncated away
      ],
      dispelOwner,
      [dispelOwner],
      false,
    );
    expect(evts).toHaveLength(2);
    expect(evts[0]!.facts["postCcDamageK"]).toBe("100");
    expect(evts[1]!.facts["postCcDamageK"]).toBe("70");
    expect(evts.every((e) => e.type === "missed-cleanse")).toBe(true);
    expect(evts.every((e) => e.facts["ownerCanDispel"] === undefined)).toBe(
      true,
    );
  });

  it("missed-cleanse(#34(b2),2026-08-23):窗口内硬读条 → ownerCasting* 事实;窗口前起手 → preCommitted=yes;castStartEvents 缺失或未传 occupancy → 三态不知道,键不出现", () => {
    const w = () => ({
      timeSeconds: 30,
      durationSeconds: 6,
      targetName: "Ally",
      spellName: "Freezing Trap",
      spellId: "3355",
      priority: "Critical" as const,
      postCcDamage: 50_000,
      cleanseWasOnCD: false,
      dispellersLockedOut: false,
      losReachable: null,
      drChainRisk: false,
      dispelType: "Magic" as const,
    });
    const cast = (id: string, name: string, t: number) => ({
      spellId: id,
      spellName: name,
      timestamp: t,
    });
    // 窗口 [30s, 36s):31s 起手精神控制,32.8s SUCCESS(1.8s);33s 再起手,
    // 无 SUCCESS,被 34.2s 的下一条起手截断(1.2s);34.2s 那条无任何可见
    // 终点 → 丢弃不猜。合计 3.0s,全部在窗口内起手。
    const busyOwner = {
      id: "owner",
      spec: "256",
      castStartEvents: [
        cast("605", "精神控制", 31_000),
        cast("605", "精神控制", 33_000),
        cast("2060", "快速治疗", 34_200),
      ],
      spellCastEvents: [cast("605", "精神控制", 32_800)],
      auraEvents: [],
      actionIn: [],
    };
    const evts = missedCleanseEvents([w()], busyOwner, [busyOwner], false, {
      enemyIds: new Set(),
      matchStartMs: 0,
    });
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["ownerCastingS"]).toBe("3.0");
    expect(evts[0]!.facts["ownerCastingSpells"]).toBe("精神控制×2");
    expect(evts[0]!.facts["ownerCastingPreCommitted"]).toBe("no");

    // 读条从窗口前 1s 起手 → 只计窗口内重叠(1.5s),preCommitted=yes
    const preOwner = {
      ...busyOwner,
      castStartEvents: [cast("605", "精神控制", 29_000)],
      spellCastEvents: [cast("605", "精神控制", 31_500)],
    };
    const pre = missedCleanseEvents([w()], preOwner, [preOwner], false, {
      enemyIds: new Set(),
      matchStartMs: 0,
    });
    expect(pre[0]!.facts["ownerCastingS"]).toBe("1.5");
    expect(pre[0]!.facts["ownerCastingPreCommitted"]).toBe("yes");

    // castStartEvents 字段缺失(老归档)→「不知道」≠「空闲」:键不出现
    const noField = { id: "owner", spec: "256", spellCastEvents: [] };
    const nf = missedCleanseEvents([w()], noField, [noField], false, {
      enemyIds: new Set(),
      matchStartMs: 0,
    });
    expect(nf[0]!.facts["ownerCastingS"]).toBeUndefined();

    // 未传 occupancy(旧调用方)→ 同样不出现
    const legacy = missedCleanseEvents([w()], busyOwner, [busyOwner], false);
    expect(legacy[0]!.facts["ownerCastingS"]).toBeUndefined();
  });

  it("missed-cleanse(DISPEL-002,2026-08-06):lateDispelSeconds 有值 → facts 带整数串 latencyS;无值 → 该键不存在", () => {
    const base = {
      timeSeconds: 30,
      durationSeconds: 5,
      targetName: "Ally",
      spellName: "Fear",
      spellId: "5782",
      priority: "Critical" as const,
      postCcDamage: 50_000,
      cleanseWasOnCD: false,
      dispellersLockedOut: false,
      losReachable: null,
      drChainRisk: false,
      dispelType: "Magic" as const,
    };
    const evts = missedCleanseEvents(
      [
        { ...base, lateDispelSeconds: 4.6 },
        { ...base, postCcDamage: 40_000 }, // no lateDispelSeconds → key absent
      ],
      dispelOwner,
      [dispelOwner],
      false,
    );
    expect(evts).toHaveLength(2);
    expect(evts[0]!.facts["latencyS"]).toBe("5");
    expect(evts[1]!.facts["latencyS"]).toBeUndefined();
  });

  describe("missed-cleanse:owner 派系能力门(2026-08-05,37/200 场审计)", () => {
    // Holy Paladin (65) cannot remove Curse (CURSE_REMOVERS omits it) — the
    // exact bug reported: owner got handed "you should have dispelled the
    // Curse" candidates for an ability their class does not have.
    const holyPaladin = { id: "owner", spec: "65" };
    const arcaneMage = { id: "mage", spec: "62" }; // CURSE_REMOVERS
    const curseWindow = {
      timeSeconds: 30,
      durationSeconds: 5,
      targetName: "Ally",
      spellName: "Curse of Tongues",
      spellId: "1714",
      priority: "Critical" as const,
      postCcDamage: 50_000,
      cleanseWasOnCD: false,
      dispellersLockedOut: false,
      losReachable: null,
      drChainRisk: false,
      dispelType: "Curse" as const,
    };

    it("solo shuffle:owner 驱不了该派系 → 候选直接不进菜单", () => {
      const evts = missedCleanseEvents(
        [curseWindow],
        holyPaladin,
        [holyPaladin],
        true, // isShuffle
      );
      expect(evts).toHaveLength(0);
    });

    it("组队(3v3):owner 驱不了该派系 → 候选保留,facts 带 ownerCanDispel/eligibleDispellers", () => {
      const evts = missedCleanseEvents(
        [curseWindow],
        holyPaladin,
        [holyPaladin, arcaneMage],
        false, // isShuffle
      );
      expect(evts).toHaveLength(1);
      expect(evts[0]!.facts["ownerCanDispel"]).toBe("no");
      expect(evts[0]!.facts["eligibleDispellers"]).toContain("Arcane Mage");
    });

    it("owner=Resto Druid(能驱 Curse):照常产出,无守护字段", () => {
      const restoDruid = { id: "owner", spec: "105" };
      const evts = missedCleanseEvents(
        [curseWindow],
        restoDruid,
        [restoDruid],
        false,
      );
      expect(evts).toHaveLength(1);
      expect(evts[0]!.facts["ownerCanDispel"]).toBeUndefined();
      expect(evts[0]!.facts["eligibleDispellers"]).toBeUndefined();
      // owner-can-dispel path: existing fields/rendering are byte-identical
      expect(evts[0]!.facts["dispelType"]).toBe("Curse");
    });
  });

  it("missed-purge:击杀窗口内的 Medium 也报;purge 在 CD 不报", () => {
    const w = (p: string, kw: boolean, onCD = false, dur = 10) => ({
      timeSeconds: 20,
      durationSeconds: dur,
      enemyName: "Enemy",
      spellName: "PI",
      spellId: "10060",
      priority: p as never,
      purgeWasOnCD: onCD,
      duringKillWindow: kw,
      purgersLockedOut: false,
      losReachable: null,
    });
    const evts = missedPurgeEvents([
      w("Medium", true), // inside the kill window → reported
      w("Medium", false), // outside the window, low priority → not reported
      w("High", false, true), // on cooldown → not reported
      w("High", false),
    ]);
    expect(evts).toHaveLength(2);
    // in-window entries sort first
    expect(evts[0]!.facts["inKillWindow"]).toBe("yes");
  });

  it("cc-locked:≥4s 才报,trinketState 进 facts", () => {
    const cc = (dur: number, state: string, dmg: number) => ({
      atSeconds: 40,
      durationSeconds: dur,
      spellName: "Polymorph",
      spellId: "118",
      sourceName: "Mage",
      trinketState: state as never,
      damageTakenDuring: dmg,
    });
    const evts = ccLockedEvents(
      [cc(3.9, "available_unused", 999_999), cc(6, "on_cooldown", 50_000)],
      { id: "P1", name: "Me" },
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["trinketState"]).toBe("on_cooldown");
    expect(evts[0]!.facts["damageTakenK"]).toBe("50");
  });

  it("kick-eaten:#36(b) 按 postKick 严重度排序(idle 最前)截 2,facts 带行为", () => {
    const k = (
      at: number,
      postKick: "idle" | "acted" | "switched",
      delay: number | null,
    ) => ({
      atSeconds: at,
      lockoutDurationSeconds: 4,
      kickSpellName: "Kick",
      interruptedSpellName: "Chain Heal",
      sourceName: "Rogue",
      postKick,
      firstActionDelayS: delay,
      switchSpellName: postKick === "switched" ? "Flash Heal" : null,
      switchDelayS: postKick === "switched" ? delay : null,
      switchWasHardCast: postKick === "switched" ? true : null,
    });
    // switched 在时间上最早,但 idle 必须排最前 —— 旧排序键(锁定时长)已被
    // 实测判无信息(840 条全落 3–4s),postKick 是它的接任者。
    const evts = kickEatenEvents(
      [k(10, "switched", 1.2), k(50, "idle", null), k(30, "acted", 4.1)],
      { id: "P1", name: "Me" },
    );
    expect(evts).toHaveLength(2);
    expect(evts[0]!.t).toBe(50); // idle first
    expect(evts[0]!.facts["postKick"]).toBe("no cast for 5s after the kick");
    expect(evts[1]!.t).toBe(30); // acted second
    expect(evts[1]!.facts["postKick"]).toContain("waited out the lockout");
    expect(evts[1]!.facts["postKick"]).toContain("4.1s");
  });

  // 2026-09-06(postKickSwitchAudit):这一行以前断言 "kept playing through
  // the lockout",而 `switched` 只要求学派掩码不重叠、不要求硬读条 —— 语料
  // 276/292 是瞬发(猫形态 / 悬空 / 生存意志 / 甚至 PvP 徽章)。分类不变,
  // 只改这行能声称什么;三态限定词各钉一条。
  const switchedInst = (over: Record<string, unknown> = {}) => ({
    atSeconds: 10,
    lockoutDurationSeconds: 4,
    kickSpellName: "Kick",
    interruptedSpellName: "Chain Heal",
    sourceName: "Rogue",
    postKick: "switched" as const,
    // 故意与 switchDelayS 不同:旧文案把「窗口内第一发」的延迟和「异学派
    // 那一发」的学派声称缝在一起(实测 825ca842:0.5s vs 2.0s),这条
    // 断言就是那个 bug 的回归钉。
    firstActionDelayS: 0.5,
    switchSpellName: "Cat Form",
    switchDelayS: 2.0,
    switchWasHardCast: false as boolean | null,
    ...over,
  });

  it("kick-eaten:switched 引用触发那一发自己的延迟,不是窗口第一发", () => {
    const evts = kickEatenEvents([switchedInst()], { id: "P1", name: "Me" });
    expect(evts[0]!.facts["postKick"]).toContain("2.0s");
    expect(evts[0]!.facts["postKick"]).not.toContain("0.5s");
  });

  it("kick-eaten:switched 点名技能且不再声称「打穿了锁定」", () => {
    const evts = kickEatenEvents([switchedInst()], { id: "P1", name: "Me" });
    const f = evts[0]!.facts["postKick"]!;
    expect(f).toContain("Cat Form");
    expect(f).not.toContain("kept playing");
  });

  it("kick-eaten:switched 硬读条/瞬发/未知 三态各自的限定词", () => {
    const of = (v: boolean | null) =>
      kickEatenEvents([switchedInst({ switchWasHardCast: v })], {
        id: "P1",
        name: "Me",
      })[0]!.facts["postKick"]!;
    expect(of(true)).toContain("hard cast");
    expect(of(false)).toContain("instant or channel");
    // null = 没有 cast-start 数据(旧归档),不许猜 —— 只点名技能。
    const unknown = of(null);
    expect(unknown).toContain("Cat Form");
    expect(unknown).not.toContain("hard cast");
    expect(unknown).not.toContain("instant");
  });
});

describe("healingGapEvents(HEAL-001,2026-08-30 HP-crisis 门 change 1/5)", () => {
  const owner = { id: "h1", name: "Me-R" };
  const gap = (
    lowestFriendlyHpPct: number | null,
    dmg: number,
    name = "Ally",
    freeS = 5,
  ) => ({
    fromSeconds: 30.7,
    toSeconds: 40,
    durationSeconds: 9.3,
    freeCastSeconds: freeS,
    mostDamagedName: name,
    mostDamagedSpec: "Warrior_Arms",
    mostDamagedAmount: dmg,
    lowestFriendlyHpPct,
  });

  it("5s 空窗但全队 HP 都 >70% → 不报(gap 长度本身不再是判据)", () => {
    expect(healingGapEvents([gap(75, 50_000, "Ally", 5)], owner)).toEqual([]);
  });

  it("lowestFriendlyHpPct === null(窗口内无采样)→ 不报", () => {
    expect(healingGapEvents([gap(null, 50_000)], owner)).toEqual([]);
  });

  it("mostDamagedAmount === 0(没人真的挨打)→ 不报,即使有队友掉进危机线", () => {
    expect(healingGapEvents([gap(35, 0)], owner)).toEqual([]);
  });

  it("2.5s 空窗(短于旧 4s 门,但在 detectHealingGaps 自身下限之上)+ 队友掉到 35% → 报,facts.lowestAllyHp === '35'", () => {
    const evts = healingGapEvents([gap(35, 50_000, "Ally", 2.5)], owner);
    expect(evts).toHaveLength(1);
    expect(evts[0]!.type).toBe("healing-gap");
    expect(evts[0]!.t).toBe(30); // toRenderSecond(30.7) === 30
    expect(evts[0]!.facts["t"]).toBe("30");
    expect(evts[0]!.facts["durationS"]).toBe("9");
    expect(evts[0]!.facts["freeS"]).toBe("3"); // Math.round(2.5)
    expect(evts[0]!.facts["pressured"]).toBe("Ally");
    expect(evts[0]!.facts["pressuredSpec"]).toBe("Warrior_Arms");
    expect(evts[0]!.facts["lowestAllyHp"]).toBe("35");
  });

  it("HP 恰好 40%(HEAL_GAP_CRISIS_HP_PCT 边界)→ 报(<=)", () => {
    expect(healingGapEvents([gap(40, 50_000)], owner)).toHaveLength(1);
  });

  it("HP 40.1%(刚过边界)→ 不报", () => {
    expect(healingGapEvents([gap(40.1, 50_000)], owner)).toEqual([]);
  });

  it("按 lowestFriendlyHpPct 升序排(最危险优先),截 cap=2(HEALING_GAP_CAP)", () => {
    const evts = healingGapEvents(
      [gap(30, 10_000, "A"), gap(5, 40_000, "B"), gap(15, 30_000, "C")],
      owner,
    );
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["pressured"])).toEqual(["B", "C"]);
  });
});

describe("positionMistakeEvents(POSITION-001,2026-08-06 信号扩容批 1)", () => {
  const owner = { id: "p1", name: "Me" };

  it("STAYED_IN 无真实代价(stayedInHadRealCost=false)→ 不报", () => {
    const evts = positionMistakeEvents(
      [
        {
          type: "STAYED_IN" as const,
          atSeconds: 10,
          ownerHpStartPct: 100,
          ownerHpMinPct: 95, // >=85 且降幅<15 → 无真实代价
        },
      ],
      owner,
    );
    expect(evts).toEqual([]);
  });

  it("STAYED_IN 有真实代价 → 报,facts 带 kind/hpStart/hpMin/enemy", () => {
    const evts = positionMistakeEvents(
      [
        {
          type: "STAYED_IN" as const,
          atSeconds: 10.4,
          nearestEnemyName: "Rogue",
          ownerHpStartPct: 90,
          // 2026-08-20 GH #16 接地:代价门收紧为 hpMin<35,fixture 从 40 收到
          // 30 保持「有代价」侧覆盖(40 现在是无代价 —— 35–85 区间实测无结果
          // 关联)。
          ownerHpMinPct: 30,
        },
      ],
      owner,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.type).toBe("position-mistake");
    expect(evts[0]!.t).toBe(10); // floor
    expect(evts[0]!.facts["kind"]).toBe("stayed-in");
    expect(evts[0]!.facts["hpStart"]).toBe("90");
    expect(evts[0]!.facts["hpMin"]).toBe("30");
    expect(evts[0]!.facts["enemy"]).toBe("Rogue");
  });

  it("MISSED_PUSH 无 real-cost 门,直接报;facts.dist 取整", () => {
    const evts = positionMistakeEvents(
      [
        {
          type: "MISSED_PUSH" as const,
          atSeconds: 20,
          startDistanceYards: 44.6,
        },
      ],
      owner,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["kind"]).toBe("missed-push");
    expect(evts[0]!.facts["dist"]).toBe("45");
  });

  it("CD_OUT_OF_RANGE 直接报,facts.spell/顶层 spell 都带技能名", () => {
    const evts = positionMistakeEvents(
      [
        {
          type: "CD_OUT_OF_RANGE" as const,
          atSeconds: 30,
          spellName: "Divine Storm",
        },
      ],
      owner,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["kind"]).toBe("cd-out-of-range");
    expect(evts[0]!.facts["spell"]).toBe("Divine Storm");
    expect(evts[0]!.spell).toBe("Divine Storm");
  });

  it("KITED/SPLIT_PUSH/HEALER_TRAINED 不在 POSITION_MISTAKES 允许列表 → 不报", () => {
    expect(
      positionMistakeEvents([{ type: "KITED" as const, atSeconds: 10 }], owner),
    ).toEqual([]);
  });

  it("按 hpMin 升序(越低越重)排,截 cap=2(POSITION_MISTAKE_CAP)", () => {
    const mk = (hpMin: number) => ({
      type: "STAYED_IN" as const,
      atSeconds: 10,
      ownerHpStartPct: 100,
      ownerHpMinPct: hpMin,
    });
    const evts = positionMistakeEvents([mk(50), mk(10), mk(30)], owner);
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["hpMin"])).toEqual(["10", "30"]);
  });

  it("空输入(无位置数据轮的三态兑现:computeOwnerPositionEvents 本身已对此返回 [])→ 零产出", () => {
    expect(positionMistakeEvents([], owner)).toEqual([]);
  });
});

describe("ccHeldEvents(COOLDOWN-001,2026-08-06 信号扩容批 1)", () => {
  const owner = { id: "p1", name: "Me" };
  const cd = (
    spellId: string,
    spellName: string,
    windows: Array<{
      fromSeconds: number;
      toSeconds: number;
      durationSeconds: number;
    }>,
  ) => ({ spellId, spellName, availableWindows: windows });

  it("不在 ccSpellIds 里的技能 → 不报,即便窗口很长", () => {
    const evts = ccHeldEvents(
      [
        cd("100", "Not A CC", [
          { fromSeconds: 0, toSeconds: 200, durationSeconds: 200 },
        ]),
      ],
      owner,
    );
    expect(evts).toEqual([]);
  });

  it("CC 技能但窗口 < CC_HELD_MIN_S(90s)→ 不报", () => {
    const evts = ccHeldEvents(
      [
        cd("118", "Polymorph", [
          { fromSeconds: 0, toSeconds: 80, durationSeconds: 80 },
        ]),
      ],
      owner,
    );
    expect(evts).toEqual([]);
  });

  it("CC 技能且窗口 >= 90s → 报;facts 带 t(floor)/spell/heldS/windowEndT(均整数串)", () => {
    const evts = ccHeldEvents(
      [
        cd("118", "Polymorph", [
          { fromSeconds: 10.4, toSeconds: 105.9, durationSeconds: 95.5 },
        ]),
      ],
      owner,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.type).toBe("cc-held");
    expect(evts[0]!.t).toBe(10);
    expect(evts[0]!.spell).toBe("Polymorph");
    expect(evts[0]!.facts["t"]).toBe("10");
    expect(evts[0]!.facts["heldS"]).toBe("96");
    expect(evts[0]!.facts["windowEndT"]).toBe("105");
  });

  it("多个超阈值窗口按时长降序排,截 cap=2(CC_HELD_CAP)", () => {
    const evts = ccHeldEvents(
      [
        cd("118", "Polymorph", [
          { fromSeconds: 0, toSeconds: 95, durationSeconds: 95 },
          { fromSeconds: 200, toSeconds: 320, durationSeconds: 120 },
          { fromSeconds: 400, toSeconds: 500, durationSeconds: 100 },
        ]),
      ],
      owner,
    );
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["heldS"])).toEqual(["120", "100"]);
  });

  it("owner kit 里没有被追踪的 CC 大招 → 零产出(三态)", () => {
    expect(ccHeldEvents([], owner)).toEqual([]);
  });
});

describe("ccAvoidableEvents(DEFENSIVE-001,2026-08-07 信号扩容批 1)", () => {
  const owner = { id: "h1", name: "Me-R" };
  const cc = (
    dur: number,
    drLevel: "Full" | "50%" | "Immune",
    trinketState: string,
    atSeconds = 40,
  ) => ({
    atSeconds,
    durationSeconds: dur,
    spellName: "Cheap Shot",
    spellId: "1833",
    trinketState: trinketState as never,
    drInfo: { level: drLevel } as never,
  });

  it("< CC_AVOIDABLE_MIN_S(3s)→ 不报,即便有规避手段可用", () => {
    const evts = ccAvoidableEvents(
      [cc(2.9, "Full", "on_cooldown")],
      owner,
      () => ["Divine Shield"],
      () => true,
    );
    expect(evts).toEqual([]);
  });

  it("非 Full DR(50%/Immune)→ 不报", () => {
    expect(
      ccAvoidableEvents(
        [cc(5, "50%", "on_cooldown")],
        owner,
        () => ["Divine Shield"],
        () => true,
      ),
    ).toEqual([]);
    expect(
      ccAvoidableEvents(
        [cc(5, "Immune", "on_cooldown")],
        owner,
        () => ["Divine Shield"],
        () => true,
      ),
    ).toEqual([]);
  });

  it("trinketState=available_unused → 不报(去重门,已由 cc-locked/wasted-trinket 覆盖 64.3% 重叠)", () => {
    expect(
      ccAvoidableEvents(
        [cc(5, "Full", "available_unused")],
        owner,
        () => ["Divine Shield"],
        () => true,
      ),
    ).toEqual([]);
  });

  it("trinketState=passive_trinket/used/on_cooldown 均不触发去重门(只排除 available_unused)", () => {
    for (const state of ["passive_trinket", "used", "on_cooldown"]) {
      const evts = ccAvoidableEvents(
        [cc(5, "Full", state)],
        owner,
        () => ["Divine Shield"],
        () => true,
      );
      expect(evts).toHaveLength(1);
    }
  });

  it("瞬发控(无 cast bar)→ 不报:指控是「下次要反应」,瞬发没有可反应的东西", () => {
    // 2026-08-22 语料裁定:该类型 ~75% 的出面事件是瞬发控(制裁之锤/冰冻陷阱/
    // 心灵尖啸/肾击),且该比例在四个分段桶间持平(26/30/23/28% 硬读条),
    // 即长期在要求先知而非高分段伪影。
    expect(
      ccAvoidableEvents(
        [cc(5, "Full", "on_cooldown")],
        owner,
        () => ["Divine Shield"],
        () => false,
      ),
    ).toEqual([]);
  });

  it("看见读条 → 照报,并带 castBarSeen 事实", () => {
    const evts = ccAvoidableEvents(
      [cc(5, "Full", "on_cooldown")],
      owner,
      () => ["Divine Shield"],
      () => true,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["castBarSeen"]).toBe("yes");
  });

  it("无可用规避手段(probe 返回空数组)→ 不报", () => {
    expect(
      ccAvoidableEvents(
        [cc(5, "Full", "on_cooldown")],
        owner,
        () => [],
        () => true,
      ),
    ).toEqual([]);
  });

  it("Full DR + >=3s + trinket 非 available_unused + 有规避手段 → 报;facts 带 t(floor)/spell/durationS/avoidableWith(顿号连)", () => {
    const evts = ccAvoidableEvents(
      [cc(4.6, "Full", "on_cooldown", 40.9)],
      owner,
      () => ["Divine Shield", "Blessing of Protection"],
      () => true,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.type).toBe("cc-avoidable");
    expect(evts[0]!.t).toBe(40);
    expect(evts[0]!.facts["t"]).toBe("40");
    expect(evts[0]!.facts["spell"]).toBe("Cheap Shot");
    expect(evts[0]!.facts["durationS"]).toBe("5");
    expect(evts[0]!.facts["avoidableWith"]).toBe(
      "Divine Shield、Blessing of Protection",
    );
  });

  it("多条按 CC 时长降序排,截 cap=2(CC_AVOIDABLE_CAP)", () => {
    const evts = ccAvoidableEvents(
      [
        cc(3, "Full", "on_cooldown", 10),
        cc(8, "Full", "on_cooldown", 20),
        cc(5, "Full", "on_cooldown", 30),
      ],
      owner,
      () => ["Divine Shield"],
      () => true,
    );
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["durationS"])).toEqual(["8", "5"]);
  });
});

describe("ccAvoidanceOptionsAt(DEFENSIVE-001 wiring helper,2026-08-07)", () => {
  const cast = (
    spellId: string,
    timestamp: number,
    event: string = LogEvent.SPELL_CAST_SUCCESS,
  ) => ({ spellId, logLine: { event, timestamp } });
  const cc = { atSeconds: 40, spellId: "1833", spellName: "Cheap Shot" };

  it("owner 全场从未施放过该规避技(kit 无证据)→ 不计入", () => {
    const owner = { spellCastEvents: [] };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).toEqual([]);
  });

  it("owner 施放过该技能,但落地前(t=40s)最近一次施放仍在冷却内 → 不计入", () => {
    // Divine Shield (642, cd 300s) cast at t=10s — still on cooldown at t=40s.
    const owner = { spellCastEvents: [cast("642", 10_000)] };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).not.toContain("Divine Shield");
  });

  it("owner 落地前从未按过该技能,证据来自落地后的一次施放 → 计入(落地前视为一直可用)", () => {
    // Divine Shield cast AFTER the CC (t=60s) — proves the kit has it; the
    // pre-CC availability check (t=40s) finds no earlier cast, so it counts
    // as available at the CC.
    const owner = { spellCastEvents: [cast("642", 60_000)] };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).toContain("Divine Shield");
  });

  it("非 SPELL_CAST_SUCCESS 事件不算证据(例如 SPELL_CAST_START)", () => {
    const owner = {
      spellCastEvents: [cast("642", 60_000, LogEvent.SPELL_CAST_START)],
    };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).toEqual([]);
  });

  it("多个可用技能:返回顺序确定(跟随 applicableCCAvoidanceIds 的固定迭代顺序)", () => {
    const owner = {
      spellCastEvents: [cast("642", 60_000), cast("1022", 60_000)],
    };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).toEqual([
      "Divine Shield",
      "Blessing of Protection",
    ]);
  });

  // ── 2026-08-18: 天赋自适应 + 充能感知 + proc 触发链 ─────────────────────
  //
  // 三条都在同一个函数里,而且相互作用,所以钉在一起。fixture 全部用真实
  // id:642 圣盾术(单充能 300s)、1833 偷袭(cc)、408558 相位变换(proc buff,
  // 触发技能 586 渐隐术 30s,PvP 天赋 408557)。

  it("单充能等价性:charges=1 时与旧的『上次施放 + CD ≤ t』逐例一致(边界含端点)", () => {
    // Divine Shield cd=300s, CC at t=40s. 施放于 t=-260s(即 40-300)恰好
    // 到期 → 可用;施放于 t=-259s 差一秒 → 不可用。用 matchStartMs 平移到
    // 正时间轴上表达。
    const atExpiry = {
      spellCastEvents: [cast("642", 0)], // t=0s,CC 在 t=300s
    };
    expect(
      ccAvoidanceOptionsAt(atExpiry, { ...cc, atSeconds: 300 }, 0),
    ).toContain("Divine Shield");
    expect(
      ccAvoidanceOptionsAt(atExpiry, { ...cc, atSeconds: 299.9 }, 0),
    ).not.toContain("Divine Shield");
  });

  it("proc 型免疫(相位变换):没点 PvP 天赋 → 不计入,即使触发技能渐隐术随时可用", () => {
    // 渐隐术是每个牧师都有的基础技能;自门控只能靠天赋门,不能靠施放证据。
    const owner = {
      spec: "256",
      info: { pvpTalents: [] },
      spellCastEvents: [cast("586", 60_000)],
    };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).not.toContain("Phase Shift");
  });

  it("proc 型免疫(相位变换):点了 PvP 天赋 408557 且触发技能可用 → 计入", () => {
    const owner = {
      spec: "256",
      info: { pvpTalents: ["408557"] },
      spellCastEvents: [cast("586", 60_000)],
    };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).toContain("Phase Shift");
  });

  it("proc 型免疫:天赋点了但触发技能在冷却里 → 不计入(可用性走触发技能的 CD)", () => {
    // 渐隐术 cd=30s,CC 在 t=40s:t=20s 施放过 → 还有 10s 才好。
    const owner = {
      spec: "256",
      info: { pvpTalents: ["408557"] },
      spellCastEvents: [cast("586", 20_000)],
    };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).not.toContain("Phase Shift");
  });

  it("proc 型免疫:buff 自身的施放事件不再是证据来源(它本来就不存在)", () => {
    // 语料实证:378464/408558 这类 buff 只有光环事件、零 SPELL_CAST_SUCCESS。
    // 就算硬造一条 buff 施放事件,没有触发技能的施放也不该计入。
    const owner = {
      spec: "256",
      info: { pvpTalents: ["408557"] },
      spellCastEvents: [cast("408558", 60_000)],
    };
    expect(ccAvoidanceOptionsAt(owner, cc, 0)).not.toContain("Phase Shift");
  });
});

describe("wasted-trinket(中立局面浪费 PvP 饰品)", () => {
  const probes = {
    // lowest HP% on the team (null = no sample available)
    friendlyHpPctAt: (_t: number) => 95,
    healerInCCAt: (_t: number) => false,
    enemyOffensiveActiveAt: (_t: number) => false,
  };
  const owner = { id: "p1", name: "Me-R" };

  it("全队高血 + 治疗自由 + 无敌方爆发 → 中立,发一条", () => {
    const ev = wastedTrinketEvents([42.4], owner, probes);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("wasted-trinket");
    expect(ev[0]!.facts.teamMinHpPct).toBe("95");
  });

  it("有人低血(<80%)→ 非中立,不发", () => {
    expect(
      wastedTrinketEvents([42], owner, {
        ...probes,
        friendlyHpPctAt: () => 60,
      }),
    ).toEqual([]);
  });

  it("HP 采不到样 → 保守不发", () => {
    expect(
      wastedTrinketEvents([42], owner, {
        ...probes,
        friendlyHpPctAt: () => null,
      }),
    ).toEqual([]);
  });

  it("治疗在 CC 中 → 非中立,不发", () => {
    expect(
      wastedTrinketEvents([42], owner, { ...probes, healerInCCAt: () => true }),
    ).toEqual([]);
  });

  it("敌方进攻 CD buff 生效中 → 非中立,不发", () => {
    expect(
      wastedTrinketEvents([42], owner, {
        ...probes,
        enemyOffensiveActiveAt: () => true,
      }),
    ).toEqual([]);
  });

  it("agy flash 复核采纳:同一次按压的脏重复记录(近邻,含跨秒)只留最早一条", () => {
    // 42.1 and 42.4 fall in the same second (same id after Math.round, which
    // previously made them silently overwrite each other in auditFindings' byId
    // Map); 42.1 vs 43.2 cross a second boundary and would produce two coaching
    // entries nagging about the same action.
    const ev = wastedTrinketEvents([42.1, 42.4, 43.2], owner, probes);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.t).toBe(42.1);
  });

  it("间隔 ≥ TRINKET_DEDUPE_GAP_S 的两次独立开饰品,但 per-round 上限(TEMPORARY,BACKLOG #22)只保留 1 条", () => {
    // Before the 2026-08-06 throttle both survived (see git history); the
    // WASTED_TRINKET_CAP=1 truncation is exercised end-to-end in the dedicated
    // describe block below.
    const ev = wastedTrinketEvents([42.1, 100], owner, probes);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.t).toBe(42.1);
  });
});

describe("驱散/徽章类候选 per-round 上限(TEMPORARY,2026-08-06,BACKLOG #22——信号扩容批落地后移除;截断前先按各自严重度字段排序,保住最重的)", () => {
  it("cc-locked ≤2/round:4 条超阈值 CC 按承伤降序,只保留最重的 2 条", () => {
    const cc = (dmg: number) => ({
      atSeconds: 40,
      durationSeconds: 5, // >= CC_LOCKED_MIN_S
      spellName: "Polymorph",
      spellId: "118",
      sourceName: "Mage",
      trinketState: "on_cooldown" as never,
      damageTakenDuring: dmg,
    });
    const evts = ccLockedEvents(
      [cc(10_000), cc(40_000), cc(30_000), cc(20_000)],
      { id: "P1", name: "Me" },
    );
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["damageTakenK"])).toEqual(["40", "30"]);
  });

  it("missed-purge ≤2/round:4 条 High 优先级窗口按时长降序,只保留最重的 2 条", () => {
    const w = (dur: number) => ({
      timeSeconds: 20,
      durationSeconds: dur,
      enemyName: "Enemy",
      spellName: "PI",
      spellId: "10060",
      priority: "High" as never,
      purgeWasOnCD: false,
      duringKillWindow: false,
      purgersLockedOut: false,
      losReachable: null,
    });
    const evts = missedPurgeEvents([w(10), w(40), w(30), w(20)]);
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["duration"])).toEqual(["40.0", "30.0"]);
  });

  it("missed-cleanse ≤2/round:4 条 High 优先级窗口按承伤降序,只保留最重的 2 条", () => {
    const owner = { id: "owner", spec: "256" }; // Priest_Discipline, MAGIC_REMOVERS
    const w = (dmg: number) => ({
      timeSeconds: 30,
      durationSeconds: 5,
      targetName: "Ally",
      spellName: "Fear",
      spellId: "5782",
      priority: "High" as const,
      postCcDamage: dmg,
      cleanseWasOnCD: false,
      dispellersLockedOut: false,
      losReachable: null,
      drChainRisk: false,
      dispelType: "Magic" as const,
    });
    const evts = missedCleanseEvents(
      [w(10_000), w(40_000), w(30_000), w(20_000)],
      owner,
      [owner],
      false,
    );
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["postCcDamageK"])).toEqual(["40", "30"]);
  });

  it("wasted-trinket ≤1/round:3 次中立按压(间隔均超去重窗)按 teamMinHpPct 降序,只保留最中立的 1 条", () => {
    const owner = { id: "p1", name: "Me-R" };
    const hpByT = new Map([
      [10, 82],
      [80, 99],
      [160, 90],
    ]);
    const probes = {
      friendlyHpPctAt: (t: number) => hpByT.get(t) ?? null,
      healerInCCAt: () => false,
      enemyOffensiveActiveAt: () => false,
    };
    const evts = wastedTrinketEvents([10, 80, 160], owner, probes);
    expect(evts).toHaveLength(1);
    expect(evts[0]!.t).toBe(80);
    expect(evts[0]!.facts["teamMinHpPct"]).toBe("99");
  });

  it("防漂移(2026-08-11;2026-08-19 GH #14 cc-locked 与 wasted-trinket 先后退役后缩为二族):LEGACY_TOPIC_TYPES 恰好覆盖本 describe 块的两个类型,不多不少 -- 挑选层多样性指令(buildFindingsPrompt)与审计层上限(auditFindings)都从这个 export 派生名单,漂移会让二者与这些每-round-上限函数各说各话", () => {
    expect([...LEGACY_TOPIC_TYPES].sort()).toEqual(
      ["missed-cleanse", "missed-purge"].sort(),
    );
    // End-to-end: the actual `.type` string each capped function emits must
    // be a member of the set -- pins the association by real output, not by
    // two hand-typed string lists that merely happen to agree today.
    // (ccLockedEvents and wastedTrinketEvents left this family with their
    // GH #14 retirements — the pure functions still exist but no longer feed
    // the menu; the trinket check below pins the DEMOTION.)
    const purge = missedPurgeEvents([
      {
        timeSeconds: 20,
        durationSeconds: 10,
        enemyName: "Enemy",
        spellName: "PI",
        spellId: "10060",
        priority: "High" as never,
        purgeWasOnCD: false,
        duringKillWindow: false,
        purgersLockedOut: false,
        losReachable: null,
      },
    ]);
    const cleanseOwner = { id: "owner", spec: "256" };
    const cleanse = missedCleanseEvents(
      [
        {
          timeSeconds: 30,
          durationSeconds: 5,
          targetName: "Ally",
          spellName: "Fear",
          spellId: "5782",
          priority: "High" as const,
          postCcDamage: 10_000,
          cleanseWasOnCD: false,
          dispellersLockedOut: false,
          losReachable: null,
          drChainRisk: false,
          dispelType: "Magic" as const,
        },
      ],
      cleanseOwner,
      [cleanseOwner],
      false,
    );
    const trinket = wastedTrinketEvents(
      [10],
      { id: "p1", name: "Me-R" },
      {
        friendlyHpPctAt: () => 90,
        healerInCCAt: () => false,
        enemyOffensiveActiveAt: () => false,
      },
    );
    for (const evts of [purge, cleanse]) {
      expect(evts.length).toBeGreaterThan(0);
      for (const e of evts) expect(LEGACY_TOPIC_TYPES.has(e.type)).toBe(true);
    }
    // Demotion pin: the retired wasted-trinket's output must NOT count as
    // legacy any more (it no longer reaches the menu, but auditFindings'
    // cap must also not charge cached findings of it against the family).
    expect(trinket.length).toBeGreaterThan(0);
    for (const e of trinket) expect(LEGACY_TOPIC_TYPES.has(e.type)).toBe(false);
  });
});

describe("trinketTeamMinHpPctAt(HP 查询时刻先 floor 到渲染网格)", () => {
  // Review point (agy flash review): querying HP at trinketUseTimes' raw
  // fractional seconds would contradict the whole-second-tick [STATE] view (the
  // same bug as class A of the 2026-07-20 audit; see the toRenderSecond comment
  // in utils/cooldowns.ts). A spy that records its arguments pins down that "the
  // query instant is already toRenderSecond(t)*1000, not the raw t*1000".
  it("查询时刻是 toRenderSecond(t)*1000 + startTime,不是原始 t*1000", () => {
    const calls: number[] = [];
    const spyLookup = (_unit: any, timestampMs: number) => {
      calls.push(timestampMs);
      return 95;
    };
    trinketTeamMinHpPctAt([{ id: "f1" }], { startTime: 1000 }, 42.4, spyLookup);
    // toRenderSecond(42.4) = 42 → 1000 + 42*1000 = 43000; not 1000 + 42400 = 43400.
    expect(calls).toEqual([43000]);
  });

  it("多个友方都用同一个渲染网格时刻查询", () => {
    const calls: number[] = [];
    const spyLookup = (_unit: any, timestampMs: number) => {
      calls.push(timestampMs);
      return 90;
    };
    trinketTeamMinHpPctAt(
      [{ id: "f1" }, { id: "f2" }],
      { startTime: 0 },
      7.9,
      spyLookup,
    );
    // toRenderSecond(7.9) = 7, identical for both players
    expect(calls).toEqual([7000, 7000]);
  });

  it("任何人采不到样 → null(保守不发),仍走渲染网格时刻", () => {
    const spyLookup = (_unit: any, timestampMs: number) =>
      timestampMs === 5000 ? null : 100;
    expect(
      trinketTeamMinHpPctAt(
        [{ id: "f1" }, { id: "f2" }],
        { startTime: 0 },
        5.7,
        spyLookup,
      ),
    ).toBeNull();
  });
});

describe("HARD_CC_CATEGORIES(P1 同步度,2026-08-15,hard-CC 类别判据)", () => {
  it("覆盖 Stun/Incapacitate/Disorient/Silence(判据红线之外的常识校验:健全性,不是红线本身)", () => {
    expect(HARD_CC_CATEGORIES.has("Stun")).toBe(true);
    expect(HARD_CC_CATEGORIES.has("Incapacitate")).toBe(true);
    expect(HARD_CC_CATEGORIES.has("Disorient")).toBe(true);
    expect(HARD_CC_CATEGORIES.has("Silence")).toBe(true);
  });
  it("Root 不在集合内(ccBreakAnalysis.ts 的 rootBreakCount 先例:断根常是合理换血,不算硬控)", () => {
    expect(HARD_CC_CATEGORIES.has("Root")).toBe(false);
  });
});

describe("missedSyncWindowEvents(P1 起爆-1,2026-08-15,纯函数)", () => {
  // 60ab-7:19 形态:敌治疗被 Polymorph 睡 8.34s(439.62~447.96s ≈ 7:19),友方
  // Retribution Paladin 的 Avenging Wrath(120s CD)在 t=0 用过一次,窗口打开
  // 时(439.62s)早已转好且窗口内没有第二次施放 —— 团队有锁有弹药却没按下去。
  // 时间戳故意取小数(真实 CC 落地时刻几乎从不是整秒,review fix round 1 教训:
  // 整秒 fixture 会掩盖 durationS 未按渲染网格对齐的 bug):toRenderSecond 向下
  // 取整后 t=439/windowEndT=447(渲染秒差=8),而不是原始秒差 8.34。
  const ccWindow = {
    fromSeconds: 439.62,
    toSeconds: 447.96,
    spellName: "Polymorph",
    spellId: "118",
    healerName: "Enemy-Healer",
  };
  const readyHammer = {
    spellId: "31884",
    spellName: "Avenging Wrath",
    casts: [{ timeSeconds: 0 }],
    cooldownSeconds: 120,
    neverUsed: false,
  };
  // Door-passing reference fixture (2026-09-02 resurrection): 3v3-shaped
  // numbers (entered 18% vs unentered 8% = 10pp >= SYNC_REF_MIN_CONTRAST_PP).
  const REF = {
    cellKey: "3v3",
    nEntered: 174,
    killEnteredPct: 18,
    nUnentered: 497,
    killUnenteredPct: 8,
  };
  const probes = (
    minHp: number | null,
    extra?: { enemyDeathS?: number[]; ref?: typeof REF | null },
  ) => ({
    enemyMinHpPctAt: (_from: number, _to: number) => minHp,
    enemyDeathS: extra?.enemyDeathS ?? [],
    ref: extra && "ref" in extra ? extra.ref ?? null : REF,
  });

  it("① 60ab-7:19 形态:敌治疗被睡 8s + 我方锤 ready + 窗内无起爆 → 1 条,facts 含被控技能/时长/ready 清单/窗内敌方最低血", () => {
    const evts = missedSyncWindowEvents([ccWindow], [readyHammer], probes(42));
    expect(evts).toHaveLength(1);
    const e = evts[0]!;
    expect(e.type).toBe("missed-sync-window");
    expect(e.t).toBe(439);
    expect(e.unitNames).toEqual(["Enemy-Healer"]);
    expect(e.facts["healer"]).toBe("Enemy-Healer");
    expect(e.facts["cc"]).toBe("Polymorph");
    expect(e.facts["windowEndT"]).toBe("447");
    // Render-grid regression (review fix round 1): durationS must equal
    // windowEndT - t (447-439=8), NOT the raw fractional diff
    // (447.96-439.62=8.34 → fmtFactNum would render "8.3", self-inconsistent
    // with t/windowEndT).
    expect(e.facts["durationS"]).toBe("8");
    expect(e.facts["readyCds"]).toContain("Avenging Wrath");
    expect(e.facts["enemyMinHpPct"]).toBe("42");
    // Resurrection reference facts: quoted verbatim from the ref cell — the
    // gate (checkSyncWindowRefConsistency) re-checks these against the table.
    expect(e.facts["refN"]).toBe("671");
    expect(e.facts["refKillEntered"]).toBe("18");
    expect(e.facts["refKillUnentered"]).toBe("8");
    expect(e.facts["cellKey"]).toBe("3v3");
  });

  it("门:ref=null(bracket 无格/不够样本/对比不过门)→ 整轮静音", () => {
    expect(
      missedSyncWindowEvents([ccWindow], [readyHammer], probes(50, { ref: null })),
    ).toEqual([]);
  });

  it("门:对比 <3pp(平/反)→ 静音(引用的数字在反驳指控本身)", () => {
    const flat = { ...REF, killEnteredPct: 9, killUnenteredPct: 8 };
    expect(
      missedSyncWindowEvents([ccWindow], [readyHammer], probes(50, { ref: flat })),
    ).toEqual([]);
  });

  it("t<30s(开场铺垫窗)→ 不产出", () => {
    const opener = { ...ccWindow, fromSeconds: 12.4, toSeconds: 19.9 };
    expect(
      missedSyncWindowEvents([opener], [readyHammer], probes(50)),
    ).toEqual([]);
  });

  it("渲染时长 <3s → 不产出(与 syncWindowScan 共享的 eligibility)", () => {
    const blip = { ...ccWindow, fromSeconds: 439.62, toSeconds: 441.9 }; // 441-439=2
    expect(
      missedSyncWindowEvents([blip], [readyHammer], probes(50)),
    ).toEqual([]);
  });

  it("窗内有敌人死亡 → 不产出(没压 CD 也在转化的击杀不是漏同步;非血线门,B8 仍然成立)", () => {
    expect(
      missedSyncWindowEvents(
        [ccWindow],
        [readyHammer],
        probes(50, { enemyDeathS: [443.2] }),
      ),
    ).toEqual([]);
  });

  it("提前 2s 内进窗(SYNC_ENTER_LEAD_S)也算已同步 → 不产出", () => {
    const leadCast = {
      ...readyHammer,
      casts: [{ timeSeconds: 0 }, { timeSeconds: 438.0 }], // 439.62-2=437.62 <= 438
    };
    expect(
      missedSyncWindowEvents([ccWindow], [leadCast], probes(50)),
    ).toEqual([]);
  });

  it("② 红线(B8,用户裁决,无血线门):敌方全员满血(100%)→ 仍出候选,不因为血高就不报", () => {
    const evts = missedSyncWindowEvents([ccWindow], [readyHammer], probes(100));
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["enemyMinHpPct"]).toBe("100");
  });

  it("HP 采不到样(null,无进阶日志)→ 仍出候选,只是该 fact 缺席(B8:绝不能因为血量数据缺失而不发,accelerator-only)", () => {
    const evts = missedSyncWindowEvents(
      [ccWindow],
      [readyHammer],
      probes(null),
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts).not.toHaveProperty("enemyMinHpPct");
  });

  it("窗口开始时没有任何进攻大 CD ready → 不产出", () => {
    const onCd = { ...readyHammer, casts: [{ timeSeconds: 400 }] }; // 400+120=520 > 439,窗口开始时仍在冷却
    expect(missedSyncWindowEvents([ccWindow], [onCd], probes(50))).toEqual([]);
  });

  it("窗口内我方已经起爆(有施放)→ 不产出(同步已发生,非漏同步)", () => {
    const castDuring = {
      ...readyHammer,
      casts: [{ timeSeconds: 0 }, { timeSeconds: 442 }],
    };
    expect(
      missedSyncWindowEvents([ccWindow], [castDuring], probes(50)),
    ).toEqual([]);
  });

  it("id 消歧(review fix round 2,2026-08-15):同一治疗两个 CC 窗 floor 到同一渲染秒但技能不同 → 两条 id 不同(菜单 id 是 eventIds 引用键,碰撞会破坏采纳归因)", () => {
    // Both windows start at 439.x/439.y — toRenderSecond floors both to 439,
    // so the pre-fix id `missed-sync-window:${healerName}:${t}` collided.
    // Different castTimes so both survive the "no cast during window" gate.
    const polyWindow = {
      ...ccWindow,
      fromSeconds: 439.1,
      toSeconds: 447.96,
      spellName: "Polymorph",
      spellId: "118",
    };
    const fearWindow = {
      ...ccWindow,
      fromSeconds: 439.9,
      toSeconds: 450,
      spellName: "Fear",
      spellId: "5782",
    };
    const evts = missedSyncWindowEvents(
      [polyWindow, fearWindow],
      [readyHammer],
      probes(50),
    );
    expect(evts).toHaveLength(2);
    expect(evts[0]!.t).toBe(439);
    expect(evts[1]!.t).toBe(439);
    const ids = evts.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual([
      "missed-sync-window:Enemy-Healer:5782:439",
      "missed-sync-window:Enemy-Healer:118:439",
    ]);
  });

  it("多个窗口按渲染窗口时长降序排,截 MISSED_SYNC_WINDOW_CAP=2", () => {
    const short = {
      ...ccWindow,
      fromSeconds: 100,
      toSeconds: 104,
      healerName: "H1",
    }; // 4s
    const long = {
      ...ccWindow,
      fromSeconds: 200,
      toSeconds: 210,
      healerName: "H2",
    }; // 10s
    const mid = {
      ...ccWindow,
      fromSeconds: 300,
      toSeconds: 306,
      healerName: "H3",
    }; // 6s
    const evts = missedSyncWindowEvents(
      [short, long, mid],
      [readyHammer],
      probes(50),
    );
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["healer"])).toEqual(["H2", "H3"]);
  });
});

describe("unsyncedBurstEvents(P1 起爆-2,2026-08-15,纯函数)", () => {
  // Avenging Wrath(31884,cooldown 120s,spellEffectData duration 20s)在 t=200 施放。
  const cast = {
    ownerName: "Dps-R",
    spellId: "31884",
    spellName: "Avenging Wrath",
    castTimeSeconds: 200,
    cooldownSeconds: 120,
  };

  it("③ 爆发施放 + 窗内(生效窗)敌治疗零硬控 → 1 条", () => {
    const evts = unsyncedBurstEvents([cast], [], ["Enemy-Healer"], () => true);
    expect(evts).toHaveLength(1);
    const e = evts[0]!;
    expect(e.type).toBe("unsynced-burst");
    expect(e.t).toBe(200);
    expect(e.unitNames).toEqual(["Dps-R", "Enemy-Healer"]);
    expect(e.facts["owner"]).toBe("Dps-R");
    expect(e.facts["spell"]).toBe("Avenging Wrath");
    expect(e.facts["healer"]).toBe("Enemy-Healer");
  });

  it("可行性门:开爆发时队伍没有任何硬控就绪 → 不产出(不能要求你花掉没有的资源)", () => {
    // 2026-08-22 语料裁定:被判「不同步」的实例里,**整轮从未控过敌方治疗的
    // 占 0%**(~278 例,中位偏差 13–18s)—— 指控前提一次都不成立;该类型
    // 对 66–70% 的进攻冷却开火而技能梯度持平(−0.1pp),即在描述正常打法。
    expect(
      unsyncedBurstEvents([cast], [], ["Enemy-Healer"], () => false),
    ).toEqual([]);
  });

  it("生效窗内敌治疗有硬控(与 burstCastSpan 的效果窗重叠)→ 不产出(视为已同步)", () => {
    // burstCastSpan: [200, 220](castTime + spellEffectData duration 20s)。
    // 205~208 落在窗口内 → 判定为已同步。
    const evts = unsyncedBurstEvents(
      [cast],
      [{ fromSeconds: 205, toSeconds: 208 }],
      ["Enemy-Healer"],
      () => true,
    );
    expect(evts).toEqual([]);
  });

  it("硬控窗与生效窗不重叠(在效果窗结束之后)→ 仍视为无同步,产出", () => {
    const evts = unsyncedBurstEvents(
      [cast],
      [{ fromSeconds: 230, toSeconds: 235 }], // 220 之后,不重叠
      ["Enemy-Healer"],
      () => true,
    );
    expect(evts).toHaveLength(1);
  });

  it("场上没有敌方治疗(healerNames=[])→ 不产出(无对象可谈同步)", () => {
    expect(unsyncedBurstEvents([cast], [], [], () => true)).toEqual([]);
  });

  it("§29b:双治疗阵容,窗内零硬控 → fact 点名全部敌方治疗而非任取第一个(BACKLOG §29b,双治疗误标修复)", () => {
    const evts = unsyncedBurstEvents(
      [cast],
      [],
      ["Enemy-Healer-A", "Enemy-Healer-B"],
      () => true,
    );
    expect(evts).toHaveLength(1);
    const e = evts[0]!;
    expect(e.unitNames).toEqual(["Dps-R", "Enemy-Healer-A", "Enemy-Healer-B"]);
    expect(e.facts["healer"]).toBe("Enemy-Healer-A、Enemy-Healer-B");
  });

  it("按 cooldownSeconds 降序排(大 CD 优先),截 UNSYNCED_BURST_CAP=2", () => {
    const small = {
      ...cast,
      spellId: "1",
      spellName: "Small",
      castTimeSeconds: 10,
      cooldownSeconds: 30,
    };
    const big = {
      ...cast,
      spellId: "2",
      spellName: "Big",
      castTimeSeconds: 50,
      cooldownSeconds: 180,
    };
    const mid = {
      ...cast,
      spellId: "3",
      spellName: "Mid",
      castTimeSeconds: 90,
      cooldownSeconds: 90,
    };
    const evts = unsyncedBurstEvents(
      [small, big, mid],
      [],
      ["Enemy-Healer"],
      () => true,
    );
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.facts["spell"])).toEqual(["Big", "Mid"]);
  });
});

describe("enemyMinHpPctInWindow(missed-sync-window 的血量 accelerator 探针,渲染网格离散扫描)", () => {
  it("窗口内多次采样取最小值,跨多个敌人也取全场最小", () => {
    const enemies = [{ id: "e1" }, { id: "e2" }];
    const seen: number[] = [];
    const hp = enemyMinHpPctInWindow(
      enemies,
      { startTime: 0 },
      10,
      12,
      (unit: any, timestampMs: number) => {
        seen.push(timestampMs);
        return unit.id === "e2" ? 30 : 80;
      },
    );
    expect(hp).toBe(30);
    // 3 rendered seconds (10,11,12) x 2 enemies = 6 probes
    expect(seen).toHaveLength(6);
  });

  it("全程采不到样(全部返回 null)→ 整体 null,不是 0", () => {
    const hp = enemyMinHpPctInWindow(
      [{ id: "e1" }],
      { startTime: 0 },
      10,
      12,
      () => null,
    );
    expect(hp).toBeNull();
  });
});

describe("friendlyCrisisMomentInWindow(cd-hoarded 的危机时刻探针,渲染网格离散扫描)", () => {
  it("跨多个友方取最差血量,回带具体单位名与命中的渲染秒——不只是一个数字", () => {
    const friends = [
      { id: "f1", name: "Healer-R" },
      { id: "f2", name: "Ally-R" },
    ];
    const crisis = friendlyCrisisMomentInWindow(
      friends,
      { startTime: 0 },
      10,
      12,
      (unit: any) => (unit.id === "f2" ? 34 : 80),
    );
    expect(crisis).toEqual({ t: 10, unitName: "Ally-R", hpPct: 34 });
  });

  it("全程采不到样(全部返回 null)→ 整体 null,不是假 0%", () => {
    const crisis = friendlyCrisisMomentInWindow(
      [{ id: "f1", name: "Healer-R" }],
      { startTime: 0 },
      10,
      12,
      () => null,
    );
    expect(crisis).toBeNull();
  });
});

describe("cdHoardedEvents(2026-08-30 rewrite, GH #34, decision-point shape, 60ab-AW 精神传承)", () => {
  // 2026-08-30 决策点重写:判据换成 crisisDecisionPoints 的 dangerous && !inCC
  // 点,不再是 availableWindows 的「转好后晚 N 秒」——minLateS/crisisHpPct 两个
  // 门槛随窗口形状一起退役了(见 cooldownTiming.ts 的 cdHoardedEvents 文档注释)。
  // GH #28 的自愈/够不着队友细节、readyCds 截断、cap+排序、语料参照三件套已
  // 由 packages/analysis/test/cdHoardedSelfOnly.test.ts 覆盖;这里只保留
  // render-grid floor 这条与本文件其它测试同风格的锚点用例。
  const OWNER = { id: "h", name: "Healer-R" };
  const point = (
    tSec: number,
    hpPct: number,
    over: Record<string, unknown> = {},
  ) => ({
    tSec,
    hpPct,
    dmg2s: 0.3,
    attackers2s: 1,
    enemyBurst: false,
    inCC: false,
    dangerous: true,
    ...over,
  });
  const cd = (
    spellId: string,
    spellName: string,
    over: Record<string, unknown> = {},
  ) => ({
    spellId,
    spellName,
    tag: "Defensive",
    cooldownSeconds: 300,
    casts: [] as { timeSeconds: number }[],
    neverUsed: true,
    ...over,
  });

  it("① 小数秒的危机点(6:20.6)→ facts.t/e.t 都落在渲染网格(floor),不是原始小数秒", () => {
    const evts = cdHoardedEvents(
      [{ crisisUnit: OWNER, own: true, points: [point(380.6, 34)] }],
      [cd("642", "Divine Shield")],
      OWNER,
    );
    expect(evts).toHaveLength(1);
    const e = evts[0]!;
    expect(e.type).toBe("cd-hoarded");
    expect(e.t).toBe(380); // toRenderSecond(380.6)
    expect(e.facts["t"]).toBe("380");
    expect(e.facts["crisisUnit"]).toBe("Healer-R");
    expect(e.facts["crisisHpPct"]).toBe("34");
    expect(e.facts["dmg2sPct"]).toBe("30"); // Math.round(0.3*100)
    expect(e.facts["own"]).toBe("yes");
    expect(e.unitNames).toEqual(["Healer-R", "Healer-R"]);
    // 呈现用的 spell/spellId 取第一个 ready CD(types.ts:多技能事件只取第一个)。
    expect(e.spell).toBe("Divine Shield");
    expect(e.spellId).toBe("642");
  });

  it("② 同一 CD 在响应窗内(渲染网格意义上的 +3s)被按下 → 0 条(按了不算屯)", () => {
    const evts = cdHoardedEvents(
      [
        {
          crisisUnit: OWNER,
          own: true,
          points: [point(380.6, 34)],
        },
      ],
      [cd("642", "Divine Shield", { casts: [{ timeSeconds: 383 }] })],
      OWNER,
    );
    expect(evts).toHaveLength(0);
  });
});

describe("cdHoardedEvents 意图守护(BACKLOG #26 Task 2,按了被拒不算屯——2026-08-30 沿用/扩展到多技能合并)", () => {
  const OWNER = { id: "h", name: "Healer-R" };
  const point = (tSec: number, hpPct: number) => ({
    tSec,
    hpPct,
    dmg2s: 0.3,
    attackers2s: 1,
    enemyBurst: false,
    inCC: false,
    dangerous: true,
  });
  const ownSource = (tSec: number, hpPct: number) => ({
    crisisUnit: OWNER,
    own: true,
    points: [point(tSec, hpPct)],
  });
  // 与旧版同一形状的 fixture(readyT floors 到 380,响应窗 [378.5, 385]) —— 只
  // 是不再挂在 availableWindows 上,直接用一个决策点在 380.6s。
  const HOARDED_CD = {
    spellId: "642",
    spellName: "Divine Shield",
    tag: "Defensive",
    cooldownSeconds: 300,
    casts: [] as { timeSeconds: number }[],
    neverUsed: true,
  };

  it("① 屯窗内该技能 CAST_FAILED×3(两种理由)→ facts.attempted 按频次聚合(尚未恢复×2、法力值不足×1)", () => {
    const rawStreams: RawStreams = {
      available: true,
      manaSamples: [],
      castFailed: [
        {
          tSeconds: 381.2,
          unitGuid: "h",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "尚未恢复",
        },
        {
          tSeconds: 382.7,
          unitGuid: "h",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "尚未恢复",
        },
        {
          tSeconds: 384.9,
          unitGuid: "h",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "法力值不足",
        },
      ],
    };
    const evts = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [HOARDED_CD],
      OWNER,
      undefined,
      rawStreams,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["attempted"]).toBe(
      "曾尝试施放被拒(尚未恢复×2、法力值不足×1)",
    );
  });

  it("② 真没按(窗内有 CAST_FAILED,但不同技能/不同单位,零命中)→ facts 逐字段与无 rawStreams 时完全相同", () => {
    const rawStreams: RawStreams = {
      available: true,
      manaSamples: [],
      castFailed: [
        {
          tSeconds: 381.2,
          unitGuid: "h",
          spellId: 99999,
          spellName: "Some Other Spell",
          reason: "尚未恢复",
        },
        {
          tSeconds: 382.7,
          unitGuid: "someone-else",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "法力值不足",
        },
      ],
    };
    const withGuard = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [HOARDED_CD],
      OWNER,
      undefined,
      rawStreams,
    );
    const without = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [HOARDED_CD],
      OWNER,
    );
    expect(withGuard).toEqual(without);
    expect(withGuard[0]!.facts["attempted"]).toBeUndefined();
  });

  it("③ rawStreams 缺省 / available:false → 逐字段与无 rawStreams 时完全相同(优雅降级,绝不 throw)", () => {
    const without = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [HOARDED_CD],
      OWNER,
    );
    const absent = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [HOARDED_CD],
      OWNER,
      undefined,
      undefined,
    );
    expect(absent).toEqual(without);
    const unavailable: RawStreams = {
      available: false,
      manaSamples: [],
      castFailed: [
        {
          tSeconds: 381.2,
          unitGuid: "h",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "尚未恢复",
        },
      ],
    };
    const withUnavailable = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [HOARDED_CD],
      OWNER,
      undefined,
      unavailable,
    );
    expect(withUnavailable).toEqual(without);
  });

  // #29 rewrite (2026-08-17): GCD-spam presses are not "pressed but
  // rejected" evidence — see filterIntentGuardEvidence's own doc comment
  // (shared.ts) for the corpus numbers (96.9% of 尚未恢复 hits were GCD
  // artifacts). Still consumed the same way post-rewrite (per-cd
  // filterIntentGuardEvidence call, merged across every READY cd).
  it("④ #29:紧邻一次成功施放前 ≤2s 的连点(任何理由)不算证据 —— 该次成功施放本身落在响应窗之外(所以 spent=false、候选照常触发),窗内那次失败尝试因贴着它被判定为「最终按下前的连点」而剔除", () => {
    // 响应窗 [379.1, 385.6](380.6 - 1.5 / +5)。成功施放在 386.0(窗外,
    // 不算 spent);384.5 的失败尝试在窗内、且在成功施放前 1.5s(<=2s)——
    // 应被 pre-cast 排除,不计入 attempted。
    const cdWithLateCast = {
      ...HOARDED_CD,
      casts: [{ timeSeconds: 386.0 }],
    };
    const rawStreams: RawStreams = {
      available: true,
      manaSamples: [],
      castFailed: [
        {
          tSeconds: 384.5,
          unitGuid: "h",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "尚未恢复",
        },
      ],
    };
    const evts = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [cdWithLateCast],
      OWNER,
      undefined,
      rawStreams,
    );
    expect(evts).toHaveLength(1); // 386.0 在窗外 → spent=false → 仍触发
    expect(evts[0]!.facts["attempted"]).toBeUndefined();
  });

  it("⑤ #29:自己刚成功施放 ≤1.5s 内的「尚未恢复」是 GCD 不算证据;同时刻的昏迷理由保留(理由收窄)", () => {
    const rawStreams: RawStreams = {
      available: true,
      manaSamples: [],
      castFailed: [
        // 1.2s after an own successful cast at 382 → GCD artifact, excluded.
        {
          tSeconds: 383.2,
          unitGuid: "h",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "尚未恢复",
        },
        // Same instant but a CC reason → kept.
        {
          tSeconds: 383.2,
          unitGuid: "h",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "无法在昏迷时那样做",
        },
      ],
    };
    const evts = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [HOARDED_CD],
      OWNER,
      undefined,
      rawStreams,
      [382],
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["attempted"]).toBe(
      "曾尝试施放被拒(无法在昏迷时那样做×1)",
    );
  });

  it("⑥ 新增(2026-08-30 多技能合并):两个 ready CD 各自的 CAST_FAILED 一起并入 facts.attempted,不是只看第一个", () => {
    const rawStreams: RawStreams = {
      available: true,
      manaSamples: [],
      castFailed: [
        {
          tSeconds: 381.0,
          unitGuid: "h",
          spellId: 642,
          spellName: "Divine Shield",
          reason: "尚未恢复",
        },
        {
          tSeconds: 382.0,
          unitGuid: "h",
          spellId: 871,
          spellName: "Shield Wall",
          reason: "法力值不足",
        },
      ],
    };
    const evts = cdHoardedEvents(
      [ownSource(380.6, 34)],
      [HOARDED_CD, { ...HOARDED_CD, spellId: "871", spellName: "Shield Wall" }],
      OWNER,
      undefined,
      rawStreams,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts["attempted"]).toBe(
      "曾尝试施放被拒(尚未恢复×1、法力值不足×1)",
    );
  });
});

describe("cdSpentIdleEvents(P2 起爆-2,2026-08-15,圣佑盲发形态)", () => {
  const IDLE_CD = {
    spellId: "33206",
    spellName: "Pain Suppression",
    tag: "Defensive",
    isThroughput: false,
    casts: [{ timeSeconds: 512.7 }], // 小数秒,验证渲染网格 floor
  };

  it("① 威胁不活跃时施放 → 1 条,facts.t 落在渲染网格(不是原始小数秒),探针拿到的也是渲染网格整数", () => {
    const evts = cdSpentIdleEvents(
      [IDLE_CD],
      { id: "h", name: "Healer-R" },
      "med",
      {
        threatActiveAt: (t) => {
          expect(t).toBe(512);
          return false;
        },
      },
    );
    expect(evts).toHaveLength(1);
    const e = evts[0];
    expect(e.type).toBe("cd-spent-idle");
    expect(e.t).toBe(512);
    expect(e.facts["t"]).toBe("512");
    expect(e.facts["spell"]).toBe("Pain Suppression");
    expect(e.facts["costNorm"]).toBeUndefined();
  });

  it("② 施放时威胁活跃 → 0 条", () => {
    const evts = cdSpentIdleEvents(
      [IDLE_CD],
      { id: "h", name: "Healer-R" },
      "high",
      { threatActiveAt: () => true },
    );
    expect(evts).toHaveLength(0);
  });

  it("红线 B6:matchThreatLevel=low 整场 → 0 条,且探针从未被调用(不是恰好都判 true——低威胁场次用 CD 就是正确打法)", () => {
    const spy = vi.fn(() => {
      throw new Error(
        "threatActiveAt must not be called when matchThreat is low",
      );
    });
    const evts = cdSpentIdleEvents(
      [IDLE_CD],
      { id: "h", name: "Healer-R" },
      "low",
      { threatActiveAt: spy },
    );
    expect(evts).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("过滤掉非防御/保命向的大 CD(isThroughput)——不是这个类型要抓的形状", () => {
    const throughputCd = {
      ...IDLE_CD,
      spellId: "31884",
      spellName: "Avenging Wrath",
      tag: "Offensive",
      isThroughput: true,
    };
    const evts = cdSpentIdleEvents(
      [throughputCd],
      { id: "h", name: "Healer-R" },
      "med",
      { threatActiveAt: () => false },
    );
    expect(evts).toHaveLength(0);
  });

  it("红线:cost_norm 命中(642)时 facts 必须带 costNorm", () => {
    const cd = { ...IDLE_CD, spellId: "642", spellName: "Divine Shield" };
    const evts = cdSpentIdleEvents([cd], { id: "h", name: "Healer-R" }, "med", {
      threatActiveAt: () => false,
    });
    expect(evts).toHaveLength(1);
    expect(evts[0].facts["costNorm"]).toBeDefined();
    expect(evts[0].facts["costNorm"]).toContain("大技能");
  });

  it("按时间升序排序并按上限截断", () => {
    const cd = {
      ...IDLE_CD,
      casts: [{ timeSeconds: 300 }, { timeSeconds: 100 }, { timeSeconds: 500 }],
    };
    const evts = cdSpentIdleEvents([cd], { id: "h", name: "Healer-R" }, "med", {
      threatActiveAt: () => false,
    });
    expect(evts.map((e) => e.t)).toEqual([100, 300]);
  });
});

describe("missed-sync-window / unsynced-burst 接线(extractCandidateFindings,2026-08-15,Task 9 默认开启)", () => {
  // Task 2 评审(fix round 1,2026-08-15)Critical 发现之后,Task 4 把两个新
  // 候选类型接进了 teamPlayEvents,但 CANDIDATE_TYPE_FLAGS 默认全 false,所以
  // extractCandidateFindings 在 A/B 阶段仍不吐出它们(见 git 历史里本 describe
  // 块当时的负向断言版本)。Task 9(用户裁决全量上线)把四开关翻 true —— 本块
  // 断言方向翻回"出现":复用与之前完全相同的 fixture(同一场景直调
  // missedSyncWindowEvents/unsyncedBurstEvents 会产出 1 条,见上面两个纯函数
  // describe 块的 ①/③ 用例)。
  //
  // 团队编成:治疗 owner(Healer-R,团队视角,不参与同步判定本身)+ 一名友方
  // Retribution Paladin 队友(Dps-R,t=0 用过一次 Avenging Wrath,120s CD,窗口
  // 打开时早已转好)。敌方治疗(Enemy-Healer)在 439~447s(≈7:19)被 Polymorph
  // 定身 8s,期间我方没有第二次进攻大 CD 施放 —— 若已接线本应出现
  // missed-sync-window/unsynced-burst,但今天不应该。
  function syncFixture(): any {
    const polyApplied = {
      logLine: { event: "SPELL_AURA_APPLIED", timestamp: 439_000 },
      timestamp: 439_000,
      spellId: "118",
      spellName: "Polymorph",
      srcUnitId: "d",
      srcUnitName: "Dps-R",
      destUnitId: "e",
      destUnitName: "Enemy-Healer",
    };
    const polyRemoved = {
      ...polyApplied,
      logLine: { event: "SPELL_AURA_REMOVED", timestamp: 447_000 },
      timestamp: 447_000,
    };
    const avengingWrathCast = {
      logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 0 },
      timestamp: 0,
      spellId: "31884",
      spellName: "Avenging Wrath",
      srcUnitId: "d",
      srcUnitName: "Dps-R",
      destUnitId: "d",
      destUnitName: "Dps-R",
    };
    // 2026-08-22:unsynced-burst 现在要求「开爆发时队伍确实有硬控就绪」——
    // 原 fixture 的队伍一次硬控都没放过,可行性门会(正确地)拦掉整条。
    // 补一次制裁之锤(45s CD),让场景变成本类型真正想抓的那一种:
    // 有控可用却没压在爆发上。
    const hammerOfJusticeCast = {
      logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 10_000 },
      timestamp: 10_000,
      spellId: "853",
      spellName: "Hammer of Justice",
      srcUnitId: "d",
      srcUnitName: "Dps-R",
      destUnitId: "e",
      destUnitName: "Enemy-Healer",
    };
    const commonUnitFields = {
      healOut: [],
      healIn: [],
      damageOut: [],
      damageIn: [],
      absorbsIn: [],
      advancedActions: [],
      actionIn: [],
      actionOut: [],
      deathRecords: [],
    };
    return {
      startTime: 0,
      endTime: 600_000,
      startInfo: { zoneId: "0" },
      units: {
        h: {
          id: "h",
          name: "Healer-R",
          type: 1,
          reaction: 1,
          spec: "257", // Priest_Holy
          class: CombatUnitClass.Priest,
          spellCastEvents: [],
          auraEvents: [],
          info: { teamId: "0" },
          ...commonUnitFields,
        },
        d: {
          id: "d",
          name: "Dps-R",
          type: 1,
          reaction: 1,
          spec: "70", // Paladin_Retribution
          class: CombatUnitClass.Paladin,
          spellCastEvents: [avengingWrathCast, hammerOfJusticeCast],
          auraEvents: [],
          info: { teamId: "0" },
          ...commonUnitFields,
        },
        e: {
          id: "e",
          name: "Enemy-Healer",
          type: 1,
          reaction: 2,
          spec: "256", // Priest_Discipline (healer)
          class: CombatUnitClass.Priest,
          spellCastEvents: [],
          auraEvents: [polyApplied, polyRemoved],
          info: { teamId: "1" },
          ...commonUnitFields,
        },
      },
    };
  }

  it("复活默认态(2026-09-02,GH #13 撤销):missedSyncWindow 默认开,但 fixture 无 bracket → 参照查不到,门整轮静音;unsyncedBurst 仍默认关(GH #50)→ 两个类型都不产出", () => {
    const evts = extractCandidateFindings(syncFixture(), "h");
    expect(evts.some((e) => e.type === "missed-sync-window")).toBe(false);
    expect(evts.some((e) => e.type === "unsynced-burst")).toBe(false);
  });

  it("显式开 flag → unsynced-burst 仍可产出(纯函数与接线保留,只是默认关,GH #50)", () => {
    CANDIDATE_TYPE_FLAGS.unsyncedBurst = true;
    try {
      const evts = extractCandidateFindings(syncFixture(), "h");
      expect(evts.some((e) => e.type === "unsynced-burst")).toBe(true);
    } finally {
      CANDIDATE_TYPE_FLAGS.unsyncedBurst = false;
    }
  });

  it("bracket=3v3(真实生成表——数据耦合同 behaviorPrior.test.ts 健康测试:赛季太年轻/3v3 对比塌了会红,红了要重新裁决而不是改测试)→ missed-sync-window 产出且 facts 引用 3v3 格", () => {
    const c = syncFixture();
    c.startInfo.bracket = "3v3";
    const evts = extractCandidateFindings(c, "h");
    const msw = evts.filter((e) => e.type === "missed-sync-window");
    expect(msw).toHaveLength(1);
    expect(msw[0]!.facts["cellKey"]).toBe("3v3");
    expect(msw[0]!.facts["refN"]).toBeTruthy();
  });

  it("同一 fixture 直调纯函数(用真实 analyzeOutgoingCCChains/extractMajorCooldowns 数据,不是手搭 fixture)仍产出两条——证明数据条件本身没坏,菜单接线已按「退役到零件」摘除", () => {
    const c = syncFixture();
    const units = Object.values(c.units) as any[];
    const friends = units.filter((u) => u.reaction === 1);
    const enemies = units.filter((u) => u.reaction === 2);

    const ccWindows = enemyHealerCcWindows(friends, enemies, c);
    expect(ccWindows).toHaveLength(1);

    const dps = units.find((u) => u.id === "d");
    const awCd = extractMajorCooldowns(dps, c).find(
      (cd) => cd.spellId === "31884",
    )!;
    expect(awCd).toBeTruthy();

    expect(
      missedSyncWindowEvents(ccWindows, [awCd], {
        enemyMinHpPctAt: () => null,
        enemyDeathS: [],
        ref: {
          cellKey: "3v3",
          nEntered: 174,
          killEnteredPct: 18,
          nUnentered: 497,
          killUnenteredPct: 8,
        },
      }),
    ).toHaveLength(1);

    expect(
      unsyncedBurstEvents(
        awCd.casts.map((cast) => ({
          ownerName: "Dps-R",
          spellId: awCd.spellId,
          spellName: awCd.spellName,
          castTimeSeconds: cast.timeSeconds,
          cooldownSeconds: awCd.cooldownSeconds,
        })),
        ccWindows,
        ["Enemy-Healer"],
        () => true,
      ),
    ).toHaveLength(1);
  });

  // Task 4(2026-08-15,特性开关接线,更新于 Task 9 默认全 true 上线): 单独把
  // 每个开关关掉,验证只有那一个类型从产出里消失、另一个仍出现——即便同一
  // fixture 两个类型的数据条件都满足,证明两个 flag 各自独立生效而非联动。
  // finally 里把开关复位回默认 true(Task 9 上线态),防止状态泄漏给上面的
  // 默认开启正向测试或其它文件的默认态测试(CANDIDATE_TYPE_FLAGS 是模块级可
  // 变单例,和 DISPEL_FEATURE_FLAGS 一样)。
  // Both flags default to false since 2026-08-29; the independence check now
  // turns each ON alone and expects only that type to appear.
  it("unsynced-burst 默认关:bracket=3v3 时只有 missed-sync-window 出现,unsynced-burst 不出现", () => {
    const c = syncFixture();
    c.startInfo.bracket = "3v3";
    const evts = extractCandidateFindings(c, "h");
    expect(evts.some((e) => e.type === "missed-sync-window")).toBe(true);
    expect(evts.some((e) => e.type === "unsynced-burst")).toBe(false);
  });

  it("只开 unsyncedBurst → 只有 unsynced-burst 产出,missed-sync-window 不出现", () => {
    CANDIDATE_TYPE_FLAGS.unsyncedBurst = true;
    try {
      const evts = extractCandidateFindings(syncFixture(), "h");
      expect(evts.some((e) => e.type === "unsynced-burst")).toBe(true);
      expect(evts.some((e) => e.type === "missed-sync-window")).toBe(false);
    } finally {
      CANDIDATE_TYPE_FLAGS.unsyncedBurst = false;
    }
  });
});

describe("cd-hoarded / cd-spent-idle 接线(extractCandidateFindings,2026-08-15,Task 9 默认开启;2026-08-30 cd-spent-idle 下架)", () => {
  // Task 4 把两个新 P2 类型接进了 teamPlayEvents/extractCandidateFindings 的
  // 菜单,但 CANDIDATE_TYPE_FLAGS 默认全 false,A/B 阶段仍不出现。Task 9(用户
  // 裁决全量上线)把四开关翻 true —— 本块用真实数据条件证明"条件满足且默认
  // 开启 → 出现",再用同一 fixture 直调真实谓词链(extractMajorCooldowns + 真实
  // crisisDecisionPoints/threatActiveAt/matchThreatLevel,不是手搭 stub)证明
  // 底层数据本身是通的。
  //
  // cd-spent-idle 下架(2026-08-30,信号结果探针,用户裁定,CLAUDE.md 价值门
  // 第 4 条):19,019 个决策点(3,000 场新赛季归档)—— 威胁下按出之后 30s
  // 内"被罚"(敌方进攻大 CD 命中且 10s 内有人阵亡)3.6%,空当按出之后仅
  // 3.1%(Δ +0.5pp;前 10% 分段 −0.8pp;单排 −0.2pp)—— 指控没有可测量的
  // 代价。CANDIDATE_TYPE_FLAGS.cdSpentIdle 翻 false;纯函数 cdSpentIdleEvents
  // 与其测试保留(测试自行翻 flag,同 missedSyncWindow/unsyncedBurst/
  // missedPurge/ccHeld 先例)。cd-hoarded 不受影响,继续默认开启。
  //
  // 团队编成:治疗 owner(Healer-R,Priest_Discipline)+ 敌方(Enemy-E)。
  // Healer-R 真实施放圣言术:屏障(62618,180s CD)两次(t=0、t≈250.4s)——
  // 中间的可用窗口(180s→250.4s)内 Healer-R 自己血量从 190s 的 100%
  // 掉到 200s 的 30%(2026-08-30 决策点重写:crisisDecisionPoints 要看到一次
  // 真实的下穿,单点 HP 读数不够——补了 190s 这一读作「穿越前」的样本),同一
  // 窗口内还有一笔真实伤害(199.5s,25% maxHp)让 dmg2s 过 dangerous 门槛,
  // 构成 cd-hoarded 的决策点;又在远离威胁的 t≈400.7s 真实施放痛苦压制
  // (33206,防御向、非 throughput)——此时敌方没有任何进攻光环、也没有
  // 伤害数据,是真正的空档。敌方在 195~210s 有一段 Avenging Wrath 自增益
  // (真实 OFFENSIVE_SPELL_IDS 表项,任意单位类型都能触发
  // hasOffensiveSpellActive)——制造一段真实、未被治愈"答坑"的威胁片段,
  // 让 matchThreatLevel 落在 "low" 之外(B6 gate 的反例前提),同时也是
  // cd-hoarded 危机窗口内那次血量骤降的成因。
  function p2Fixture(): any {
    const barrierCast1 = {
      logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 0 },
      timestamp: 0,
      spellId: "62618",
      spellName: "Power Word: Barrier",
      srcUnitId: "h",
      srcUnitName: "Healer-R",
      destUnitId: "h",
      destUnitName: "Healer-R",
    };
    const barrierCast2 = {
      ...barrierCast1,
      logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 250_400 },
      timestamp: 250_400,
    };
    const painSuppressionCast = {
      logLine: { event: "SPELL_CAST_SUCCESS", timestamp: 400_700 },
      timestamp: 400_700,
      spellId: "33206",
      spellName: "Pain Suppression",
      srcUnitId: "h",
      srcUnitName: "Healer-R",
      destUnitId: "h",
      destUnitName: "Healer-R",
    };
    const enemyOffensiveApplied = {
      logLine: { event: "SPELL_AURA_APPLIED", timestamp: 195_000 },
      timestamp: 195_000,
      spellId: "31884", // Avenging Wrath — real OFFENSIVE_SPELL_IDS entry;
      // hasOffensiveSpellActive keys purely off spellId membership, not the
      // caster's actual class/spec, so a bare self-buff aura here is enough.
      spellName: "Avenging Wrath",
      srcUnitId: "e",
      srcUnitName: "Enemy-E",
      destUnitId: "e",
      destUnitName: "Enemy-E",
    };
    const enemyOffensiveRemoved = {
      ...enemyOffensiveApplied,
      logLine: { event: "SPELL_AURA_REMOVED", timestamp: 210_000 },
      timestamp: 210_000,
    };
    const healerHpBeforeCrisis = {
      timestamp: 190_000,
      logLine: { timestamp: 190_000 },
      advancedActorId: "h",
      advancedActorCurrentHp: 100,
      advancedActorMaxHp: 100,
    };
    const healerCrisisHp = {
      timestamp: 200_000,
      logLine: { timestamp: 200_000 },
      advancedActorId: "h",
      advancedActorCurrentHp: 30,
      advancedActorMaxHp: 100,
    };
    // 2026-08-30 决策点重写:crisisDecisionPoints 的 dangerous 门槛
    // (CRISIS_MIN_DMG2S=0.1)需要穿越前 2s 内的真实伤害,不是只看 HP 读数。
    // logLine.timestamp 也要给——threatAssessment.ts 的 threatActiveAt 走
    // 这个字段读伤害窗(与 crisisDecisionPoints 直接读 d.timestamp 是两条
    // 不同的伤害事件读法,同一 fixture 要同时满足两边)。
    const healerCrisisDamage = {
      timestamp: 199_500,
      logLine: { timestamp: 199_500 },
      srcUnitId: "e",
      amount: -25,
      effectiveAmount: -25,
    };
    const commonUnitFields = {
      healOut: [],
      healIn: [],
      damageOut: [],
      damageIn: [],
      absorbsIn: [],
      actionIn: [],
      actionOut: [],
      deathRecords: [],
    };
    return {
      startTime: 0,
      endTime: 600_000,
      startInfo: { zoneId: "0" },
      units: {
        h: {
          id: "h",
          name: "Healer-R",
          type: 1,
          reaction: 1,
          spec: "256", // Priest_Discipline — 62618/33206 都是这个专精独占
          class: CombatUnitClass.Priest,
          spellCastEvents: [barrierCast1, barrierCast2, painSuppressionCast],
          auraEvents: [],
          advancedActions: [healerHpBeforeCrisis, healerCrisisHp],
          info: { teamId: "0" },
          ...commonUnitFields,
          damageIn: [healerCrisisDamage],
        },
        e: {
          id: "e",
          name: "Enemy-E",
          type: 1,
          reaction: 2,
          spec: "577",
          class: CombatUnitClass.DemonHunter,
          spellCastEvents: [],
          auraEvents: [enemyOffensiveApplied, enemyOffensiveRemoved],
          advancedActions: [],
          info: { teamId: "1" },
          ...commonUnitFields,
        },
      },
    };
  }

  it("默认态(cd-hoarded 默认开启;cd-spent-idle 2026-08-30 下架)→ 同一 fixture 只产出 cd-hoarded,不产出 cd-spent-idle", () => {
    const evts = extractCandidateFindings(p2Fixture(), "h");
    expect(evts.some((e) => e.type === "cd-hoarded")).toBe(true);
    expect(evts.some((e) => e.type === "cd-spent-idle")).toBe(false);
  });

  it("同一 fixture 直调真实谓词链(extractMajorCooldowns + 真实 crisisDecisionPoints/threatActiveAt/matchThreatLevel)仍各产出 1 条——证明底层数据/谓词本身没坏;cd-spent-idle 菜单接线已按「退役到零件」摘除(2026-08-30),cd-hoarded 菜单接线仍在", () => {
    const c = p2Fixture();
    const units = Object.values(c.units) as any[];
    const friends = units.filter((u) => u.reaction === 1);
    const enemies = units.filter((u) => u.reaction === 2);
    const owner = { id: "h", name: "Healer-R" };

    const healer = units.find((u) => u.id === "h");
    const cds = extractMajorCooldowns(healer, c);
    const barrierCd = cds.find((cd) => cd.spellId === "62618")!;
    const painCd = cds.find((cd) => cd.spellId === "33206")!;
    expect(barrierCd).toBeTruthy();
    expect(painCd).toBeTruthy();

    // 真实威胁分级:敌方 195~210s 的进攻光环 + Healer-R 200s 真实掉到 30%
    // 构成一段真实、未被治愈"答坑"的威胁片段(15s,< THREAT_SEGMENT_PERSIST_S
    // 20s)→ "med",落在 B6 的 "low" 红线之外。
    const threat = matchThreatLevel(enemies, friends, c);
    expect(threat).not.toBe("low");

    // 2026-08-30 决策点重写:cd-hoarded 的输入换成了 crisisDecisionPoints 的
    // 真实产出(不是探针 stub),owner 的「own crisis」source。
    const points = crisisDecisionPoints(healer, c);
    expect(points).toHaveLength(1); // 唯一一次下穿,200s
    expect(points[0]!.dangerous).toBe(true);
    expect(
      cdHoardedEvents(
        [{ crisisUnit: owner, own: true, points }],
        [barrierCd],
        owner,
      ),
    ).toHaveLength(1);

    expect(
      cdSpentIdleEvents([painCd], owner, threat, {
        threatActiveAt: (t) => threatActiveAt(t, enemies, friends, c),
      }),
    ).toHaveLength(1);
  });

  // Task 4(2026-08-15,特性开关接线,更新于 Task 9 默认全 true 上线;2026-08-30
  // cd-spent-idle 下架后重写): 同上一 describe 块的分开开关验证。cd-hoarded
  // 保持默认 true,cd-spent-idle 保持默认 false(下架态)——两个方向各测一条:
  // 关掉 cd-hoarded 时 cd-spent-idle 依旧不出现(默认已关,不受影响);显式开
  // cd-spent-idle 时它照常出现且不影响 cd-hoarded(纯函数与接线保留,只是默认
  // 关,同 missedSyncWindow/unsyncedBurst 先例)。注意生产接线传入的是完整
  // ownerCds(barrierCd + painCd 一起),不是上面直调测试里为了断言干净而各自
  // 隔离传入的单元素数组,所以这里只断言"该类型消失/出现",不钉具体条数
  // (条数取决于两个 CD 互相产生的窗口叠加,细节见实现者报告)。finally 里
  // 复位开关回默认值,防止状态泄漏。
  it("CANDIDATE_TYPE_FLAGS.cdHoarded=false(cd-spent-idle 保持默认 false)→ 两者都不产出", () => {
    CANDIDATE_TYPE_FLAGS.cdHoarded = false;
    try {
      const evts = extractCandidateFindings(p2Fixture(), "h");
      expect(evts.some((e) => e.type === "cd-hoarded")).toBe(false);
      expect(evts.some((e) => e.type === "cd-spent-idle")).toBe(false);
    } finally {
      CANDIDATE_TYPE_FLAGS.cdHoarded = true;
    }
  });

  it("显式开 CANDIDATE_TYPE_FLAGS.cdSpentIdle → cd-spent-idle 仍可产出(纯函数与接线保留,只是默认关);cd-hoarded 默认 true 不受影响", () => {
    CANDIDATE_TYPE_FLAGS.cdSpentIdle = true;
    try {
      const evts = extractCandidateFindings(p2Fixture(), "h");
      expect(evts.some((e) => e.type === "cd-spent-idle")).toBe(true);
      expect(evts.some((e) => e.type === "cd-hoarded")).toBe(true);
    } finally {
      CANDIDATE_TYPE_FLAGS.cdSpentIdle = false;
    }
  });
});

describe("manaPressureEvents(BACKLOG #26 Task 3,2026-08-15,60ab-shape 纯函数,开关默认关)", () => {
  const healer = { id: "h", name: "Healer-R" };

  it("① 60ab 形态:治疗蓝连续 <阈值 ≥窗长(MANA_PRESSURE_MIN_WINDOW_S)× 窗内被拒 ≥门(MANA_PRESSURE_MIN_FAILED)→ 1 条,facts 齐", () => {
    // Anchor values from match 60ab1e8f (task-1-report.md): Holy Shock
    // (spellId 20473) rejected on "法力值不足" repeatedly as mana bottoms out
    // at 545/273000 — the exact shape mana-pressure exists to catch.
    const rawStreams: RawStreams = {
      available: true,
      manaSamples: [
        { tSeconds: 490, unitGuid: "h", mana: 20000, manaMax: 273000 },
        { tSeconds: 495, unitGuid: "h", mana: 10000, manaMax: 273000 },
        { tSeconds: 500, unitGuid: "h", mana: 545, manaMax: 273000 },
      ],
      castFailed: [
        {
          tSeconds: 492,
          unitGuid: "h",
          spellId: 20473,
          spellName: "Holy Shock",
          reason: "法力值不足",
        },
        {
          tSeconds: 496,
          unitGuid: "h",
          spellId: 20473,
          spellName: "Holy Shock",
          reason: "法力值不足",
        },
        {
          tSeconds: 499,
          unitGuid: "h",
          spellId: 20473,
          spellName: "Holy Shock",
          reason: "法力值不足",
        },
      ],
    };
    const evts = manaPressureEvents(rawStreams, healer, {
      threatActiveAt: () => true,
    });
    expect(evts).toHaveLength(1);
    expect(evts[0]!.type).toBe("mana-pressure");
    expect(evts[0]!.id).toBe("mana-pressure:Healer-R:490");
    expect(evts[0]!.t).toBe(490);
    expect(evts[0]!.unitNames).toEqual(["Healer-R"]);
    expect(evts[0]!.facts).toEqual({
      t: "490",
      toT: "500",
      durationS: "10",
      mana: "545/273000",
      rejectedCount: "3",
      rejected: "法力值不足×3",
      threat: "yes",
    });
  });

  it("② 蓝低但零被拒且无接敌 → 0(MANA_PRESSURE_MIN_FAILED 未达标,窗长/低蓝本身都满足)", () => {
    const rawStreams: RawStreams = {
      available: true,
      manaSamples: [
        { tSeconds: 490, unitGuid: "h", mana: 20000, manaMax: 273000 },
        { tSeconds: 505, unitGuid: "h", mana: 10000, manaMax: 273000 },
      ],
      castFailed: [],
    };
    expect(
      manaPressureEvents(rawStreams, healer, {
        threatActiveAt: () => false,
      }),
    ).toEqual([]);
  });

  it("④ rawStreams 缺省 / available:false → 0 条,不崩(优雅降级)", () => {
    expect(
      manaPressureEvents(undefined, healer, { threatActiveAt: () => false }),
    ).toEqual([]);
    const unavailable: RawStreams = {
      available: false,
      manaSamples: [
        { tSeconds: 490, unitGuid: "h", mana: 545, manaMax: 273000 },
      ],
      castFailed: [
        {
          tSeconds: 492,
          unitGuid: "h",
          spellId: 20473,
          spellName: "Holy Shock",
          reason: "法力值不足",
        },
      ],
    };
    expect(
      manaPressureEvents(unavailable, healer, {
        threatActiveAt: () => false,
      }),
    ).toEqual([]);
  });

  describe("尾部延伸处方(Task 1 评审 round 0 binding — oomWindows 的样本 toS 在 OOM 期系统性截短,见 progress.md/task-3-brief.md 项 2;round 1 评审修复——locale 无关的 manaAt 蓝量门替代拒因字符串,见 extendOomTailWithFailedCasts 的 doc comment)", () => {
    it("稀疏样本(sample-based 窗长 492-490=2s < MIN_WINDOW_S=5)+ 尾部 CAST_FAILED 连续接力(间隔均 <= tailGapS,拒因故意混用非中文/无关字符串证明 locale 无关)→ manaAt 显示仍低蓝 → toS 延伸,窗口仍过门长阈值", () => {
      const rawStreams: RawStreams = {
        available: true,
        manaSamples: [
          { tSeconds: 490, unitGuid: "h", mana: 15000, manaMax: 273000 },
          // Last mana SAMPLE at 492 — comes only from a successful cast; once
          // the healer goes fully OOM, successful casts (hence samples) stop
          // but SPELL_CAST_FAILED keeps firing (the exact 60ab shape). No
          // further sample exists after this, so `manaAt` holds this (low)
          // reading for every trailing failure below — the "hold-last-value"
          // semantics the round-1 fix's doc comment describes.
          { tSeconds: 492, unitGuid: "h", mana: 8000, manaMax: 273000 },
        ],
        castFailed: [
          // Deliberately NOT "法力值不足" — an English-client-shaped reason,
          // an unrelated-looking reason, and a third distinct string. The
          // bridge must fire on all three purely off `manaAt`, proving the
          // round-1 fix is locale-independent (the pre-fix implementation
          // would have bridged ZERO of these, since none string-matches the
          // literal Chinese text it used to require).
          {
            tSeconds: 497,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Not enough mana",
          },
          {
            tSeconds: 499,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Interrupted",
          },
          {
            tSeconds: 502,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Not yet recovered",
          },
        ],
      };
      // Sanity: the sample-only span (492-490=2s) is BELOW MIN_WINDOW_S —
      // without the tail extension this fixture would emit 0 candidates.
      expect(2).toBeLessThan(MANA_PRESSURE_MIN_WINDOW_S);
      const evts = manaPressureEvents(rawStreams, healer, {
        threatActiveAt: () => false,
      });
      expect(evts).toHaveLength(1);
      expect(evts[0]!.facts.t).toBe("490");
      expect(evts[0]!.facts.toT).toBe("502"); // extended past the sample-based 495
      expect(evts[0]!.facts.durationS).toBe("12"); // 502-490, clears MIN_WINDOW_S
      expect(Number(evts[0]!.facts.rejectedCount)).toBeGreaterThanOrEqual(
        MANA_PRESSURE_MIN_FAILED,
      );
    });

    it("延伸有边界:间隔超过 tailGapS 的后续被拒(拒因同样混用非中文字符串)不桥接(不无限外推到不相关的后续 OOM 尾巴)", () => {
      const rawStreams: RawStreams = {
        available: true,
        manaSamples: [
          { tSeconds: 490, unitGuid: "h", mana: 15000, manaMax: 273000 },
          { tSeconds: 495, unitGuid: "h", mana: 8000, manaMax: 273000 },
        ],
        castFailed: [
          {
            tSeconds: 493,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Not enough mana",
          },
          {
            tSeconds: 497,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Interrupted",
          },
          {
            tSeconds: 499,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Line of sight",
          },
          // Huge gap from the 499 failure (>> the tail-gap tolerance) — an
          // unrelated later OOM episode must NOT get bridged into this window.
          {
            tSeconds: 600,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Not enough mana",
          },
        ],
      };
      const evts = manaPressureEvents(rawStreams, healer, {
        threatActiveAt: () => false,
      });
      expect(evts).toHaveLength(1);
      expect(evts[0]!.facts.toT).toBe("499");
      expect(evts[0]!.facts.rejectedCount).toBe("3"); // 493/497/499 only — 600 excluded
    });

    it("负例(round 1 评审 note (c)):蓝量已在 CAST_FAILED 那一刻恢复到阈值以上(如健康蓝量下的视距/打断类拒绝)→ 不桥接,窗口停在恢复前最后一条", () => {
      const rawStreams: RawStreams = {
        available: true,
        manaSamples: [
          { tSeconds: 490, unitGuid: "h", mana: 15000, manaMax: 273000 }, // 5.49% < 15%
          { tSeconds: 495, unitGuid: "h", mana: 8000, manaMax: 273000 }, // 2.93% < 15%
          // A real recovery SAMPLE at 501 (21.98% >= MANA_PRESSURE_LOW_PCT)
          // — this is what closes oomWindows' own window at toS=495 (the
          // window algorithm pushes on the first at/above-threshold sample
          // it sees), and it's also what makes manaAt(…, 502) below read as
          // "healthy" instead of holding the stale 495 value.
          { tSeconds: 501, unitGuid: "h", mana: 60000, manaMax: 273000 },
        ],
        castFailed: [
          // Three failures inside/just past the window, all still reading
          // low mana via manaAt (nearest sample <=t is still 495) — these
          // legitimately extend toS to 499, same locale-independent gate as
          // the tests above.
          {
            tSeconds: 493,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Interrupted",
          },
          {
            tSeconds: 497,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Not enough mana",
          },
          {
            tSeconds: 499,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Line of sight",
          },
          // This one lands AFTER the 501 recovery sample — manaAt(…, 502)
          // now reads 40000/273000 (healthy) — must NOT bridge past it, even
          // though its own reason string ("Line of sight") looks nothing
          // like a mana complaint and the gap from the last bridge point
          // (499→502=3s) is well within tailGapS.
          {
            tSeconds: 502,
            unitGuid: "h",
            spellId: 20473,
            spellName: "Holy Shock",
            reason: "Line of sight",
          },
        ],
      };
      const evts = manaPressureEvents(rawStreams, healer, {
        threatActiveAt: () => false,
      });
      expect(evts).toHaveLength(1);
      expect(evts[0]!.facts.toT).toBe("499"); // NOT "502" — the healthy-mana failure did not extend the window
      expect(evts[0]!.facts.rejectedCount).toBe("3"); // 493/497/499 only — 502 excluded (outside the un-extended window)
    });
  });
});

describe("mana-pressure 接线(extractCandidateFindings,BACKLOG #26 Task 3,2026-08-15,开关默认关)", () => {
  // 团队编成:治疗 owner(Healer-R,Priest_Holy,团队视角——mana-pressure 目标
  // 是"你队治疗"而非 owner 本身,这里两者恰好重合便于验证接线本身)+ 敌方
  // (Enemy-R)。健者无技能施放/无光环/无位置数据,确保除 mana-pressure 外没有
  // 其它候选类型的数据条件被意外满足(同"信号扩容批 1"接线冒烟测试的最小
  // fixture 惯例)。rawStreams 独立构造(不经 parseRawStreams),数据条件完全
  // 复刻纯函数①用例的量级但压缩到匹配开局时间戳(t=10~20s,在 combat 60s 时长
  // 内)。
  function manaFixture(): any {
    return {
      startTime: 0,
      endTime: 60_000,
      startInfo: { zoneId: "0" },
      units: {
        h: {
          id: "h",
          name: "Healer-R",
          type: 1,
          reaction: 1,
          spec: "257", // Priest_Holy
          class: CombatUnitClass.Priest,
          deathRecords: [],
          spellCastEvents: [],
          healOut: [],
          advancedActions: [],
          auraEvents: [],
          actionIn: [],
          actionOut: [],
          damageIn: [],
          info: { teamId: "0" },
        },
        e: {
          id: "e",
          name: "Enemy-R",
          type: 1,
          reaction: 2,
          spec: "577",
          class: CombatUnitClass.Warrior,
          deathRecords: [],
          spellCastEvents: [],
          advancedActions: [],
          auraEvents: [],
          actionIn: [],
          actionOut: [],
          damageIn: [],
          info: { teamId: "1" },
        },
      },
    };
  }

  function manaRawStreams(): RawStreams {
    return {
      available: true,
      manaSamples: [
        { tSeconds: 10, unitGuid: "h", mana: 15000, manaMax: 273000 },
        { tSeconds: 15, unitGuid: "h", mana: 8000, manaMax: 273000 },
        { tSeconds: 20, unitGuid: "h", mana: 545, manaMax: 273000 },
      ],
      castFailed: [
        {
          tSeconds: 12,
          unitGuid: "h",
          spellId: 20473,
          spellName: "Holy Shock",
          reason: "法力值不足",
        },
        {
          tSeconds: 16,
          unitGuid: "h",
          spellId: 20473,
          spellName: "Holy Shock",
          reason: "法力值不足",
        },
        {
          tSeconds: 19,
          unitGuid: "h",
          spellId: 20473,
          spellName: "Holy Shock",
          reason: "法力值不足",
        },
      ],
    };
  }

  it("负断言(已退役出菜单,2026-08-21 管线审查第 3 条):数据条件完全满足(蓝量连续<阈值 ≥窗长、被拒≥门)→ extractCandidateFindings 不产出 mana-pressure", () => {
    const evts = extractCandidateFindings(manaFixture(), "h", manaRawStreams());
    expect(evts.some((e) => e.type === "mana-pressure")).toBe(false);
  });

  it("同一 fixture 直调纯函数 manaPressureEvents(真实 threatActiveAt)仍产出 1 条——证明数据条件本身没坏,菜单接线已按「退役到零件」摘除", () => {
    const c = manaFixture();
    const units = Object.values(c.units) as any[];
    const friends = units.filter((u) => u.reaction === 1);
    const enemies = units.filter((u) => u.reaction === 2);
    const evts = manaPressureEvents(manaRawStreams(), healerRef(), {
      threatActiveAt: (t) => threatActiveAt(t, enemies, friends, c),
    });
    expect(evts).toHaveLength(1);
  });

  function healerRef(): { id: string; name: string } {
    return { id: "h", name: "Healer-R" };
  }
});

// Real generated-table anchors (packages/analysis/src/data/
// spellManaCostGenerated.json, verified in scripts/datagen/genSpellManaCost.ts's
// own module header): Holy Shock (20473) is an UNCONDITIONAL 2%-of-max-mana
// row (no bySpec gating — applies regardless of the caster's spec, which is
// why fixtures below can use it with an arbitrary spec string) and Holy
// Light (82326) is an unconditional 7%. manaEfficiencyEvents reads
// SPELL_MANA_COST_TABLE directly (a generated-data lookup, not an
// injected probe — same convention as MITIGATION_TABLE/costNormPhrase
// elsewhere in this file), so these tests use real spellIds rather than
// synthetic ones.
describe("manaEfficiencyEvents(BACKLOG #26 Task 4,2026-08-15,全场聚合纯函数,开关默认关)", () => {
  const healer = { id: "h", name: "Healer-R", spec: "257" }; // Priest_Holy — irrelevant here since both anchor spells are unconditional

  function castSuccess(spellId: string, spellName: string, tMs: number) {
    return {
      spellId,
      spellName,
      logLine: { event: "SPELL_CAST_SUCCESS", timestamp: tMs },
    };
  }

  it("① 法术 A 耗蓝占比高、有效治疗占比低,总施法数 ≥ MANA_EFF_MIN_CASTS → 1 条,facts 含 A 行", () => {
    // Spell A = Holy Shock (20473, 2%/cast) × 20 casts = 40 mana-pct-points.
    // Spell B = Holy Light (82326, 7%/cast) × 10 casts = 70 mana-pct-points.
    // manaShare(A) = 40/110 ≈ 36.4%. healOut: A gets 1000 (10% of the 10000
    // total effective healing), B gets 9000 (90%). ratio(A) =
    // healShare/manaShare = 0.10/0.3636 ≈ 0.275 — well under
    // MANA_EFF_FLOOR(0.5), same "spent a lot, healed little" shape as the
    // plan brief's own worked example (29% mana / 11% heal), even though the
    // exact digits differ (real DB2 pct values aren't freely choosable).
    const spellCastEvents = [
      ...Array.from({ length: 20 }, (_, i) =>
        castSuccess("20473", "Holy Shock", 1000 + i * 1000),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        castSuccess("82326", "Holy Light", 30000 + i * 1000),
      ),
    ];
    const healOut = [
      { spellId: "20473", effectiveAmount: 1000 },
      { spellId: "82326", effectiveAmount: 9000 },
    ];
    const evts = manaEfficiencyEvents(
      healer,
      { spellCastEvents, healOut, absorbsOut: [] },
      0,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.type).toBe("mana-efficiency");
    expect(evts[0]!.unitNames).toEqual(["Healer-R"]);
    expect(evts[0]!.spellId).toBe("20473");
    expect(evts[0]!.facts.worstSpell).toBe("Holy Shock");
    expect(Number(evts[0]!.facts.worstManaPct)).toBeCloseTo(36.4, 0);
    expect(Number(evts[0]!.facts.worstHealPct)).toBeCloseTo(10, 0);
    expect(Number(evts[0]!.facts.worstRatio)).toBeLessThan(MANA_EFF_FLOOR);
    expect(evts[0]!.facts.worstCasts).toBe("20");
    // facts.table must contain spell A's own row (the brief's "facts 含 A 行").
    expect(evts[0]!.facts.table).toContain("Holy Shock");
    expect(evts[0]!.facts.table).toContain("Holy Light");
  });

  it("② 效率高于地板(ratio >= MANA_EFF_FLOOR)→ 0 条", () => {
    // Single spell, healShare===manaShare (ratio exactly 1) — well above the
    // floor.
    const spellCastEvents = Array.from({ length: 15 }, (_, i) =>
      castSuccess("20473", "Holy Shock", 1000 + i * 1000),
    );
    const healOut = [{ spellId: "20473", effectiveAmount: 5000 }];
    expect(
      manaEfficiencyEvents(
        healer,
        { spellCastEvents, healOut, absorbsOut: [] },
        0,
      ),
    ).toEqual([]);
  });

  it("③ 样本不足(施法数 < MANA_EFF_MIN_CASTS)→ 0 条,即使比值本身很差", () => {
    // MANA_EFF_MIN_CASTS-1 casts of a spell whose ratio would otherwise
    // clearly qualify (huge mana share, near-zero heal share) — the
    // sample-size gate must still zero it out.
    const spellCastEvents = Array.from(
      { length: MANA_EFF_MIN_CASTS - 1 },
      (_, i) => castSuccess("82326", "Holy Light", 1000 + i * 1000),
    );
    const healOut = [{ spellId: "82326", effectiveAmount: 1 }];
    expect(
      manaEfficiencyEvents(
        healer,
        { spellCastEvents, healOut, absorbsOut: [] },
        0,
      ),
    ).toEqual([]);
  });

  it("④ 未知法术(不在生成表中)不崩、被静默跳过,不猜成本", () => {
    const spellCastEvents = [
      ...Array.from({ length: 12 }, (_, i) =>
        castSuccess("999999999", "Unknown Spell", 1000 + i * 1000),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        castSuccess("20473", "Holy Shock", 30000 + i * 1000),
      ),
    ];
    const healOut = [
      { spellId: "999999999", effectiveAmount: 100000 },
      { spellId: "20473", effectiveAmount: 1 },
    ];
    // Must not throw, and the unknown spell must never appear in output —
    // only the known spell (Holy Shock) can possibly be scored.
    const evts = manaEfficiencyEvents(
      healer,
      { spellCastEvents, healOut, absorbsOut: [] },
      0,
    );
    for (const e of evts) {
      expect(e.facts.table).not.toContain("Unknown Spell");
      expect(e.spellId).not.toBe("999999999");
    }
  });

  it("绝对空输入(无施法记录)→ 0 条,不崩", () => {
    expect(
      manaEfficiencyEvents(
        healer,
        { spellCastEvents: [], healOut: [], absorbsOut: [] },
        0,
      ),
    ).toEqual([]);
  });

  it("absorbsOut 按同一 spellId 并入有效治疗(护盾类法术不会被误判成 0% 有效治疗)", () => {
    // Same shape as ①, but spell A's "healing" comes entirely from a shield
    // (absorbsOut) instead of a direct heal (healOut) — must still count.
    const spellCastEvents = [
      ...Array.from({ length: 20 }, (_, i) =>
        castSuccess("20473", "Holy Shock", 1000 + i * 1000),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        castSuccess("82326", "Holy Light", 30000 + i * 1000),
      ),
    ];
    const healOut = [{ spellId: "82326", effectiveAmount: 9000 }];
    const absorbsOut = [{ spellId: "20473", absorbedAmount: 1000 }];
    const evts = manaEfficiencyEvents(
      healer,
      { spellCastEvents, healOut, absorbsOut },
      0,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts.worstSpell).toBe("Holy Shock");
  });

  it("cast-id/heal-tick-id 漂移(match 60ab1e8f 实测发现):heal 事件的 spellId 与施法 spellId 不同,但 spellName 相同 → 按名字回退归并,不误判为 0% 有效治疗", () => {
    // Reproduces the real 60ab1e8f shape: Holy Shock casts as spellId 20473
    // but its own heal ticks log under a DIFFERENT spellId (25914 in the
    // real data) — same spellName on both. Before the idByName fallback,
    // this healOut row would be silently dropped (spellId "25914" has no
    // entry in bySpell), making Holy Shock look like it bought 0% effective
    // healing despite being the healer's primary spam heal.
    const spellCastEvents = [
      ...Array.from({ length: 20 }, (_, i) =>
        castSuccess("20473", "Holy Shock", 1000 + i * 1000),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        castSuccess("82326", "Holy Light", 30000 + i * 1000),
      ),
    ];
    const healOut = [
      // Same spellName as the "20473" cast, but a DIFFERENT spellId — the
      // heal-tick id, not the cast id.
      { spellId: "25914", spellName: "Holy Shock", effectiveAmount: 9000 },
      { spellId: "82326", spellName: "Holy Light", effectiveAmount: 1000 },
    ];
    const evts = manaEfficiencyEvents(
      healer,
      { spellCastEvents, healOut, absorbsOut: [] },
      0,
    );
    expect(evts).toHaveLength(1);
    // Holy Shock now has the LOWER mana-share and the HIGHER heal-share (via
    // the name-fallback resolution), so Holy Light — not Holy Shock — should
    // be the worst-ratio spell here; asserting this (rather than just
    // checking Holy Shock's healPct directly) proves the fallback actually
    // fed the aggregate, not just that the function didn't crash.
    expect(evts[0]!.facts.worstSpell).toBe("Holy Light");
    expect(
      Number(
        evts[0]!.facts.table.match(
          /Holy Shock 蓝耗[\d.]+%\/有效治疗([\d.]+)%/,
        )?.[1],
      ),
    ).toBeGreaterThan(0);
  });

  it("非治疗类耗蓝法术(match 60ab1e8f 实测发现):从未在 healOut/absorbsOut 出现过的法术(如驱散)被整条排除出评分,不进分母也不可能成为最差法术", () => {
    // Reproduces the real 60ab1e8f shape: Purify costs real mana (real
    // SPELL_MANA_COST_TABLE entry, 527, 1.3%/cast) but NEVER produces a
    // healOut/absorbsOut event at all — not "0 effective healing", literally
    // zero heal LOG EVENTS, because it is structurally not a healing spell.
    // Mixed in with the same A/B shape as ① (Holy Shock worst, Holy Light
    // fine) — Purify's huge mana share (would dwarf both if counted) must
    // not distort the shares or ever surface as the finding.
    const spellCastEvents = [
      ...Array.from({ length: 21 }, (_, i) =>
        castSuccess("527", "Purify", 500 + i * 500),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        castSuccess("20473", "Holy Shock", 20000 + i * 1000),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        castSuccess("82326", "Holy Light", 50000 + i * 1000),
      ),
    ];
    // Purify has NO healOut/absorbsOut entry anywhere — Holy Shock/Holy
    // Light do (same amounts as ①, so the expected worst is unchanged by
    // Purify's presence).
    const healOut = [
      { spellId: "20473", effectiveAmount: 1000 },
      { spellId: "82326", effectiveAmount: 9000 },
    ];
    const evts = manaEfficiencyEvents(
      healer,
      { spellCastEvents, healOut, absorbsOut: [] },
      0,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts.worstSpell).toBe("Holy Shock");
    expect(evts[0]!.facts.worstSpell).not.toBe("Purify");
    expect(evts[0]!.facts.table).not.toContain("Purify");
    // Shares must match ①'s numbers exactly (Purify contributed nothing to
    // either denominator) — proves exclusion, not just "outscored".
    expect(Number(evts[0]!.facts.worstManaPct)).toBeCloseTo(36.4, 0);
    expect(Number(evts[0]!.facts.worstHealPct)).toBeCloseTo(10, 0);
  });

  it("100% 过量治疗(每次施放都产出 heal 事件、有效量却恒为 0)——仍进表,不被当成非治疗法术排除(与上一条 Purify『压根没有 heal 事件』的区别正是这条要测的)", () => {
    // The headline case this candidate type exists to catch: a spell cast
    // repeatedly that ALWAYS produces a healOut event (proving it IS a
    // healing spell) but that event's effectiveAmount is 0 every single
    // time (fully overhealed on every cast — a real, if extreme, shape).
    // This must be scored (and, with zero heal share against nonzero mana
    // share, correctly become the worst spell) — NOT excluded the way
    // Purify was above, where there were no healOut events at all.
    const spellCastEvents = [
      ...Array.from({ length: 20 }, (_, i) =>
        castSuccess("20473", "Holy Shock", 1000 + i * 1000),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        castSuccess("82326", "Holy Light", 30000 + i * 1000),
      ),
    ];
    const healOut = [
      // One heal event PER Holy Shock cast, effectiveAmount 0 every time —
      // not a single aggregate 0, twenty individual 0-effective events.
      ...Array.from({ length: 20 }, () => ({
        spellId: "20473",
        effectiveAmount: 0,
      })),
      { spellId: "82326", effectiveAmount: 9000 },
    ];
    const evts = manaEfficiencyEvents(
      healer,
      { spellCastEvents, healOut, absorbsOut: [] },
      0,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.facts.worstSpell).toBe("Holy Shock");
    expect(evts[0]!.facts.worstHealPct).toBe("0");
    // The distinguishing assertion vs. the Purify-exclusion test above:
    // Holy Shock DOES appear in the table (it was scored, not excluded) —
    // presence of heal events, not their amount, is what keeps a spell
    // eligible.
    expect(evts[0]!.facts.table).toContain("Holy Shock");
  });

  it("t 取最差法术首次施放的渲染秒(match-level 约定)", () => {
    const spellCastEvents = [
      castSuccess("20473", "Holy Shock", 12_400), // 12.4s, floors to 12
      ...Array.from({ length: 19 }, (_, i) =>
        castSuccess("20473", "Holy Shock", 13000 + i * 1000),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        castSuccess("82326", "Holy Light", 40000 + i * 1000),
      ),
    ];
    const healOut = [
      { spellId: "20473", effectiveAmount: 1000 },
      { spellId: "82326", effectiveAmount: 9000 },
    ];
    const evts = manaEfficiencyEvents(
      healer,
      { spellCastEvents, healOut, absorbsOut: [] },
      0,
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]!.t).toBe(12);
    expect(evts[0]!.id).toBe("mana-efficiency:Healer-R:12");
  });
});

describe("mana-efficiency 接线(extractCandidateFindings,BACKLOG #26 Task 4,2026-08-15,开关默认关)", () => {
  // Same minimal-fixture convention as the mana-pressure wiring block above:
  // one healer (owner), one enemy, no other candidate-triggering data. This
  // type does NOT consume rawStreams (see manaEfficiencyEvents' own doc
  // comment) — everything comes from the healer unit's own
  // spellCastEvents/healOut.
  function manaEffFixture(): any {
    return {
      startTime: 0,
      endTime: 60_000,
      startInfo: { zoneId: "0" },
      units: {
        h: {
          id: "h",
          name: "Healer-R",
          type: 1,
          reaction: 1,
          spec: "257", // Priest_Holy
          class: CombatUnitClass.Priest,
          deathRecords: [],
          spellCastEvents: [
            ...Array.from({ length: 20 }, (_, i) => ({
              spellId: "20473",
              spellName: "Holy Shock",
              logLine: {
                event: "SPELL_CAST_SUCCESS",
                timestamp: 1000 + i * 1000,
              },
            })),
            ...Array.from({ length: 10 }, (_, i) => ({
              spellId: "82326",
              spellName: "Holy Light",
              logLine: {
                event: "SPELL_CAST_SUCCESS",
                timestamp: 30000 + i * 1000,
              },
            })),
          ],
          healOut: [
            { spellId: "20473", effectiveAmount: 1000 },
            { spellId: "82326", effectiveAmount: 9000 },
          ],
          absorbsOut: [],
          advancedActions: [],
          auraEvents: [],
          actionIn: [],
          actionOut: [],
          damageIn: [],
          info: { teamId: "0" },
        },
        e: {
          id: "e",
          name: "Enemy-R",
          type: 1,
          reaction: 2,
          spec: "577",
          class: CombatUnitClass.Warrior,
          deathRecords: [],
          spellCastEvents: [],
          advancedActions: [],
          auraEvents: [],
          actionIn: [],
          actionOut: [],
          damageIn: [],
          info: { teamId: "1" },
        },
      },
    };
  }

  it("负断言(已退役出菜单,2026-08-21 管线审查第 3 条):数据条件完全满足 → extractCandidateFindings 不产出 mana-efficiency", () => {
    const evts = extractCandidateFindings(manaEffFixture(), "h");
    expect(evts.some((e) => e.type === "mana-efficiency")).toBe(false);
  });

  it("同一 fixture 直调纯函数 manaEfficiencyEvents 仍产出 1 条——证明数据条件本身没坏,菜单接线已按「退役到零件」摘除", () => {
    const c = manaEffFixture();
    const healerUnit = c.units.h;
    const evts = manaEfficiencyEvents(
      { id: "h", name: "Healer-R", spec: "257" },
      healerUnit,
      0,
    );
    expect(evts).toHaveLength(1);
  });
});
