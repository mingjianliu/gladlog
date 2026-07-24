import { describe, expect, it } from "vitest";

import {
  cdWasteEvents,
  deathSetupEvents,
  extractCandidateFindings,
  missedCleanseEvents,
  missedPurgeEvents,
  ccLockedEvents,
  kickEatenEvents,
} from "./candidateFindings";

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
  it("tags each death friendly/enemy so the LLM knows a kill from a loss", () => {
    const evts = extractCandidateFindings(combat());
    const mine = evts.find((e) => e.id === "death:a:30");
    const theirs = evts.find((e) => e.id === "death:b:45");
    expect(mine!.facts["side"]).toBe("friendly");
    expect(theirs!.facts["side"]).toBe("enemy");
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
    const evts = extractCandidateFindings(c);
    expect(evts.some((e) => e.unitNames.includes("Gzaadym"))).toBe(false);
    // The two real player deaths are still present.
    expect(evts.filter((e) => e.type === "death")).toHaveLength(2);
  });
  it("returns [] for an empty combat without throwing", () => {
    expect(
      extractCandidateFindings({ startTime: 0, endTime: 1000, units: {} }),
    ).toEqual([]);
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
    );
    expect(evts).toEqual([]);
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
          // 覆盖 [138,150] 窗口:143 起 5s 控
          { atSeconds: 143, durationSeconds: 5, spellName: "Fear", sourceName: "E" },
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
          { atSeconds: 145, durationSeconds: 2, spellName: "Kick", sourceName: "E" },
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
          // 120+8=128 < 150-12=138 → 窗口外
          { atSeconds: 120, durationSeconds: 8, spellName: "Fear", sourceName: "E" },
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
    // 回溯超 90s(死亡 150,饰品 40 → gap 110)不出
    const tooOld = deathSetupEvents({
      ...base,
      victimCC: { ...base.victimCC, trinketUseTimes: [40] },
    });
    expect(tooOld).toHaveLength(0);
  });

  it("defensive-early:死亡时 ON COOLDOWN 且上次使用被审计标 Early;Optimal/可用则不出", () => {
    const cd = (timingLabel: string, timeSeconds: number, cooldownSeconds = 120) => ({
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
      victimCDs: [cd("Early", 100)], // ready at 220 > 150 → CD 中
    });
    expect(early).toHaveLength(1);
    expect(early[0]!.facts["kind"]).toBe("defensive-early");
    expect(early[0]!.t).toBe(100);
    expect(early[0]!.facts["gapS"]).toBe("50");
    // Optimal 用法不出
    expect(
      deathSetupEvents({ deathT: 150, victim, victimCDs: [cd("Optimal", 100)] }),
    ).toHaveLength(0);
    // 死亡时已转好(可用未按归 death-trace,不是提前用掉的链)不出
    expect(
      deathSetupEvents({ deathT: 150, victim, victimCDs: [cd("Early", 20, 60)] }),
    ).toHaveLength(0);
  });

  it("每死亡至多 2 条,优先 healer-locked > trinket-early > defensive-early", () => {
    const evts = deathSetupEvents({
      deathT: 150,
      victim,
      healerCC: {
        healerName: "H",
        ccInstances: [
          { atSeconds: 143, durationSeconds: 5, spellName: "Fear", sourceName: "E" },
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

describe("团队协作候选映射(2026-07-24 覆盖面扩充)", () => {
  it("missed-cleanse:只报 Critical/High 且解控可用;按承伤排序截 3", () => {
    const w = (p: string, dmg: number, onCD = false) => ({
      timeSeconds: 30,
      durationSeconds: 5,
      targetName: "Ally",
      spellName: "Fear",
      spellId: "5782",
      priority: p as never,
      postCcDamage: dmg,
      cleanseWasOnCD: onCD,
    });
    const evts = missedCleanseEvents([
      w("Critical", 100_000),
      w("High", 50_000),
      w("Medium", 999_999), // 低优先级不报
      w("Critical", 80_000, true), // 解控在 CD 不报
      w("High", 70_000),
      w("High", 60_000), // 第 4 条被截
    ]);
    expect(evts).toHaveLength(3);
    expect(evts[0]!.facts["postCcDamageK"]).toBe("100");
    expect(evts.every((e) => e.type === "missed-cleanse")).toBe(true);
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
    });
    const evts = missedPurgeEvents([
      w("Medium", true), // 击杀窗口内 → 报
      w("Medium", false), // 窗口外低优先级 → 不报
      w("High", false, true), // CD 中 → 不报
      w("High", false),
    ]);
    expect(evts).toHaveLength(2);
    expect(evts[0]!.facts["inKillWindow"]).toBe("yes"); // 窗口内排前
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

  it("kick-eaten:按锁定时长排序截 2", () => {
    const k = (lock: number) => ({
      atSeconds: 10,
      lockoutDurationSeconds: lock,
      kickSpellName: "Kick",
      interruptedSpellName: "Chain Heal",
      sourceName: "Rogue",
    });
    const evts = kickEatenEvents([k(3), k(5), k(4)], {
      id: "P1",
      name: "Me",
    });
    expect(evts).toHaveLength(2);
    expect(evts[0]!.facts["lockout"]).toBe("5.0");
  });
});
