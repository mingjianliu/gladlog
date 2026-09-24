import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  auditDeepDives,
  buildAuditRepairPrompt,
  buildDeepDivePack,
  buildDeepDivePrompt,
  hasCoachableSignal,
  hasOffensiveCoachableSignal,
  offensivePackItems,
  shouldAttemptAuditRepair,
  type AuditDropInfo,
  type DeepDivePack,
} from "./deepDive";
import type { CandidateEvent, Finding } from "./types";
import type { IBurstLedgerEntry } from "../utils/burstLedger";

const pack: DeepDivePack = {
  findingIndex: 0,
  anchorFrom: 100,
  anchorTo: 150,
  items: [
    {
      key: "p1",
      kind: "cc",
      t: 128,
      label: "Fear → Healer(4.0s)",
      unitNames: ["Healer-R"],
      facts: {
        t: "128",
        spell: "Fear",
        duration: "4.0",
        trinket: "on_cooldown",
      },
    },
    {
      key: "p2",
      kind: "enemy-cd",
      t: 130,
      label: "敌 Avatar(Warr)",
      unitNames: ["Warr-R"],
      facts: { t: "130", spell: "Avatar", player: "Warr-R" },
    },
  ],
  facts: {
    "p1.t": "128",
    "p1.spell": "Fear",
    "p1.duration": "4.0",
    "p1.trinket": "on_cooldown",
    "p2.t": "130",
    "p2.spell": "Avatar",
    "p2.player": "Warr-R",
  },
};

const findings: Finding[] = [
  {
    eventIds: ["death:v:150"],
    severity: "high",
    category: "survival",
    title: "被秒",
    explanation: "You died at {{t}}s.",
  } as Finding,
];

describe("auditDeepDives", () => {
  it("合规条目通过:占位符插值 + chips 按时间序", () => {
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; {{p2.spell}} came out at {{p2.t}}s. Hold a stop for that window.",
          citedKeys: ["p2", "p1"],
        },
      ],
      [pack],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain("At 128s your healer ate Fear");
    expect(out[0]!.chips.map((c) => c.t)).toEqual([128, 130]);
  });

  it("未知占位符 / 裸统计数字 / 因果断言 / 空 citedKeys / 非法 key → 丢弃", () => {
    const bad = (deepDive: string, citedKeys: string[] = ["p1"]) =>
      auditDeepDives([{ findingIndex: 0, deepDive, citedKeys }], [pack]);
    expect(bad("At {{p9.t}}s something happened.")).toHaveLength(0);
    expect(bad("Your healer was CC'd 85% of the window.")).toHaveLength(0);
    expect(bad("At {{p1.t}}s the healer took 4 seconds of Fear.")).toHaveLength(
      0,
    ); // bare integer (mirrors the strict layer of auditFindings)
    expect(bad("The Fear at {{p1.t}}s caused your death.")).toHaveLength(0);
    expect(bad("Fine text, no evidence at all.", [])).toHaveLength(0);
    expect(bad("Fine text with {{p1.t}}s.", ["nope"])).toHaveLength(0);
    // citedKeys empty but the text used a valid placeholder → usedKeys is the
    // fallback, and chips are derived from actual usage
    const rescued = bad("Fine text with {{p1.t}}s.", []);
    expect(rescued).toHaveLength(1);
    expect(rescued[0]!.chips.map((c) => c.t)).toEqual([128]);
  });

  it("占位符带空格 {{ p1.t }}:与 claimChecker 同源,usedKeys 仍抓得到(新#1)", () => {
    // The old audit-side regex /\{\{(p\d+)\.[^}]+\}\}/ did not tolerate a
    // leading space while claimChecker's PLACEHOLDER did → the text passed
    // validation but usedKeys came back empty: with citedKeys absent the whole
    // entry was silently dropped, and with it present the chips degraded to
    // citedKeys only (jumping to the wrong moment).
    const spaced = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive: "At {{ p1.t }}s the healer was locked down. Swap earlier.",
          citedKeys: [],
        },
      ],
      [pack],
    );
    expect(spaced).toHaveLength(1); // empty citedKeys still falls back to usedKeys
    expect(spaced[0]!.text).toContain("At 128s the healer was locked down");
    expect(spaced[0]!.chips.map((c) => c.t)).toEqual([128]);
  });

  // 2026-08-06 (agy 27/27-dropped attribution): `[pack]` is a single-element
  // packs array, so under the new single-pack remap (see auditDeepDives' own
  // doc comment) a wild findingIndex is no longer ambiguous — it now
  // remaps to `pack`'s own index and survives, rather than being dropped.
  // The "still drops on an unknown index" behavior requires >1 pack (see the
  // dedicated test right below).
  it("单 pack 下 findingIndex 无对应 → 重映射存活;非数组输入 → 空", () => {
    const out = auditDeepDives(
      [{ findingIndex: 7, deepDive: "x", citedKeys: ["p1"] }],
      [pack],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.findingIndex).toBe(pack.findingIndex);
    expect(auditDeepDives("not-an-array", [pack])).toHaveLength(0);
  });

  it("多 pack 下 findingIndex 无对应任一 pack → 仍丢弃(有歧义不猜)", () => {
    const secondPack: DeepDivePack = { ...pack, findingIndex: 1 };
    expect(
      auditDeepDives(
        [{ findingIndex: 7, deepDive: "x", citedKeys: ["p1"] }],
        [pack, secondPack],
      ),
    ).toHaveLength(0);
  });
});

describe("buildDeepDivePrompt", () => {
  it("含 finding 标题、pack 清单、硬规则与 JSON 输出契约", () => {
    const p = buildDeepDivePrompt([pack], findings, "Frost Mage");
    expect(p).toContain("FINDING 0: [high] 被秒");
    expect(p).toContain("key=p1 kind=cc");
    expect(p).toContain("{{key.field}}");
    expect(p).toContain('"citedKeys"');
    expect(p).toContain("Do NOT assert causation");
    // PROMPT_VERSION 17 (retest-prep 2026-08-05): two format hard rules apply
    // in every mode, not just snapshot.
    expect(p).toContain("Never write a pack key");
    expect(p).toContain("「」 for quotation marks");
    // A survival-only pack (cc / enemy-cd items) must not trigger the offensive
    // legend (locks in the gate condition against being inverted)
    expect(p).not.toContain("Offensive items");
  });
});

describe("hasCoachableSignal(可教信号门,修 1)", () => {
  const item = (kind: string, facts: Record<string, string>) =>
    ({ key: "p1", kind, t: 1, label: "", unitNames: [], facts }) as never;
  it("防御 Early/Late = 信号;Optimal = 无信号", () => {
    expect(
      hasCoachableSignal([
        item("defensive", { role: "owner", timing: "Early" }),
      ]),
    ).toBe(true);
    expect(
      hasCoachableSignal([
        item("defensive", { role: "owner", timing: "Optimal" }),
      ]),
    ).toBe(false);
  });
  it("≥3s 硬控 + 饰品 available_unused = 信号;<3s 或 on_cooldown 无信号", () => {
    expect(
      hasCoachableSignal([
        item("cc", {
          role: "teammate",
          trinket: "available_unused",
          duration: "4.0",
        }),
      ]),
    ).toBe(true);
    expect(
      hasCoachableSignal([
        item("cc", {
          role: "teammate",
          trinket: "available_unused",
          duration: "1.2",
        }),
      ]),
    ).toBe(false);
    expect(
      hasCoachableSignal([
        item("cc", {
          role: "teammate",
          trinket: "on_cooldown",
          duration: "4.0",
        }),
      ]),
    ).toBe(false);
  });
  it("低优先级驱散 + 窗口内敌方 CD = 信号;无敌方 CD 则不算", () => {
    expect(
      hasCoachableSignal([
        item("dispel", { role: "owner", priority: "Low" }),
        item("enemy-cd", { role: "enemy" }),
      ]),
    ).toBe(true);
    expect(
      hasCoachableSignal([item("dispel", { role: "owner", priority: "Low" })]),
    ).toBe(false);
  });
  it("敌方条目自身不算信号;纯中性窗口 → false", () => {
    expect(
      hasCoachableSignal([
        item("cc", { role: "teammate", trinket: "used" }),
        item("hp", { role: "owner", hp: "50" }),
        item("enemy-cd", { role: "enemy" }),
      ]),
    ).toBe(false);
  });
  it("可用未用:owner 手里的外置未给 = 信号;holder 被控 / holder 是队友 = 无信号", () => {
    expect(
      hasCoachableSignal([
        item("external-available", {
          role: "teammate",
          holderRole: "owner",
          holderCc: "no",
          spell: "Pain Suppression",
        }),
      ]),
    ).toBe(true);
    expect(
      hasCoachableSignal([
        item("external-available", {
          role: "teammate",
          holderRole: "owner",
          holderCc: "yes",
          spell: "Pain Suppression",
        }),
      ]),
    ).toBe(false);
    expect(
      hasCoachableSignal([
        item("external-available", {
          role: "teammate",
          holderRole: "teammate",
          holderCc: "no",
          spell: "Blessing of Sacrifice",
        }),
      ]),
    ).toBe(false);
  });

  it("可用未用:owner 自己的免疫未按 = 信号;被控死锁 / 队友的免疫 = 无信号", () => {
    expect(
      hasCoachableSignal([
        item("immunity-available", {
          role: "owner",
          inCc: "no",
          spell: "Divine Shield",
        }),
      ]),
    ).toBe(true);
    expect(
      hasCoachableSignal([
        item("immunity-available", {
          role: "owner",
          inCc: "yes",
          spell: "Divine Shield",
        }),
      ]),
    ).toBe(false);
    expect(
      hasCoachableSignal([
        item("immunity-available", {
          role: "teammate",
          inCc: "no",
          spell: "Ice Block",
        }),
      ]),
    ).toBe(false);
  });

  it("走位:missed-push / 空放直通(本身即失误)", () => {
    expect(
      hasCoachableSignal([
        item("position", { role: "owner", kind: "missed-push", dist: "35" }),
      ]),
    ).toBe(true);
    expect(
      hasCoachableSignal([
        item("position", {
          role: "owner",
          kind: "cd-out-of-range",
          spell: "Ring of Frost",
        }),
      ]),
    ).toBe(true);
  });

  it("走位:STAYED_IN 必须付出真实代价才开门(周度复核 P1#1)", () => {
    // Stayed until near death → a genuine mistake
    expect(
      hasCoachableSignal([
        item("position", {
          role: "owner",
          kind: "stayed-in",
          hpStart: "100",
          hpMin: "12",
        }),
      ]),
    ).toBe(true);
    // 100%→98%: a clean window, not worth a model round-trip (the old
    // implementation returned true here unconditionally)
    expect(
      hasCoachableSignal([
        item("position", {
          role: "owner",
          kind: "stayed-in",
          hpStart: "100",
          hpMin: "98",
        }),
      ]),
    ).toBe(false);
    // 100→84(旧 85/15 判据的「大跌幅」有罪案例)→ 2026-08-20 GH #16 接地
    // 后为无代价:35–85 区间实测死亡率 0–3%、败率不高于基线,drop 半件退役。
    expect(
      hasCoachableSignal([
        item("position", {
          role: "owner",
          kind: "stayed-in",
          hpStart: "100",
          hpMin: "84",
        }),
      ]),
    ).toBe(false);
    // No HP data → keep the pre-change behaviour (treat as a real cost), which
    // keeps eval attribution possible
    expect(
      hasCoachableSignal([
        item("position", { role: "owner", kind: "stayed-in" }),
      ]),
    ).toBe(true);
  });
});

describe("hasOffensiveCoachableSignal(进攻信号门,进攻深挖)", () => {
  const item = (kind: string, facts: Record<string, string>) =>
    ({ key: "p1", kind, t: 1, label: "", unitNames: [], facts }) as never;
  it("目标触底 + 防御/免疫接了 = 信号", () => {
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "22" }),
        item("immunity", { role: "enemy", spell: "Divine Shield" }),
      ]),
    ).toBe(true);
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "20" }),
        item("enemy-defensive", { role: "enemy", spell: "Ice Barrier" }),
      ]),
    ).toBe(true);
  });
  it("目标没触底 / 只有 target-hp 无防御 → 无信号", () => {
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "80" }),
        item("enemy-defensive", { role: "enemy", spell: "Ice Barrier" }),
      ]),
    ).toBe(false);
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "15" }),
      ]),
    ).toBe(false);
  });
  it("免疫单独即信号(不要求目标触底);非免疫防御单独不算(Task 5 扫描修正)", () => {
    // Dumping burst into an immunity is a mistake by itself, even at high target HP
    expect(
      hasOffensiveCoachableSignal([
        item("immunity", { role: "enemy", spell: "Ice Block" }),
      ]),
    ).toBe(true);
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "90" }),
        item("immunity", { role: "enemy", spell: "Divine Shield" }),
      ]),
    ).toBe(true);
    // A non-immunity defensive alone, with the target never pushed low → not a
    // signal (the target must also be brought low for the "should have CC'd the
    // healer" story to hold)
    expect(
      hasOffensiveCoachableSignal([
        item("enemy-defensive", { role: "enemy", spell: "Ice Barrier" }),
      ]),
    ).toBe(false);
  });
});

describe("offensivePackItems(进攻证据映射,纯函数)", () => {
  const entry: IBurstLedgerEntry = {
    fromSeconds: 40,
    toSeconds: 44,
    spells: [{ spellId: "1", spellName: "Combustion", castTimeSeconds: 40 }],
    totalDamage: 500000,
    damageByTarget: [
      { unitId: "e1", unitName: "Rdruid-Area52", damage: 500000 },
    ],
    dominantTarget: {
      unitId: "e1",
      unitName: "Rdruid-Area52",
      hpStartPct: 70,
      hpEndPct: 18,
      damage: 500000,
      defensivesHit: [
        {
          spellId: "9",
          spellName: "Ice Block",
          overlapSeconds: 2.5,
          isImmunity: true,
        },
      ],
      died: false,
    },
    allyCDsOverlapping: [
      { playerName: "Mate-Area52", spellName: "Power Infusion" },
    ],
  };
  const inWin = (t: number) => t >= 10 && t <= 50;

  it("爆发打进免疫:出 target-hp(start+end)+ immunity + our-cd,名字短名、role 正确", () => {
    const items = offensivePackItems({
      entries: [entry],
      healerChains: [],
      ownerName: "Me-Area52",
      inWin,
    });
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("target-hp");
    expect(kinds).toContain("immunity");
    expect(
      items.find((i) => i.kind === "target-hp" && i.facts.hp === "18"),
    ).toBeTruthy();
    // Short name: strip the realm's digits, or the bare-number audit kills it
    expect(items.find((i) => i.facts.unit === "Rdruid")).toBeTruthy();
    expect(
      items.every(
        (i) => i.facts.unit === undefined || !/\d/.test(i.facts.unit),
      ),
    ).toBe(true);
    // immunity has role=enemy
    expect(items.find((i) => i.kind === "immunity")!.facts.role).toBe("enemy");
  });

  it("healer CC 链在窗口内 → our-cc(role=owner);窗口外的丢弃", () => {
    const items = offensivePackItems({
      entries: [],
      healerChains: [
        {
          targetName: "Hpal-Area52",
          targetSpec: "65",
          applications: [
            {
              atSeconds: 42,
              durationSeconds: 3,
              spellId: "118",
              spellName: "Polymorph",
              casterName: "Me-Area52",
              casterSpec: "Mage",
              drInfo: { level: "Full" } as never,
            },
            {
              atSeconds: 99,
              durationSeconds: 3,
              spellId: "82691",
              spellName: "Ring of Frost",
              casterName: "Me-Area52",
              casterSpec: "Mage",
              drInfo: { level: "Full" } as never,
            },
          ],
        },
      ],
      ownerName: "Me-Area52",
      inWin,
    });
    const cc = items.filter((i) => i.kind === "our-cc");
    expect(cc).toHaveLength(1); // the out-of-window 99s entry is dropped by inWin
    expect(cc[0]!.facts.role).toBe("owner");
  });

  it("Fix 1 回归:跨服撞名的队友(短名同、全名不同)不能被判成 owner", () => {
    const crossRealmEntry: IBurstLedgerEntry = {
      ...entry,
      allyCDsOverlapping: [
        { playerName: "Me-Ragnaros", spellName: "Power Infusion" },
      ],
    };
    const items = offensivePackItems({
      entries: [crossRealmEntry],
      healerChains: [],
      ownerName: "Me-Area52",
      inWin,
    });
    const ourCd = items.find(
      (i) => i.kind === "our-cd" && i.facts.spell === "Power Infusion",
    );
    expect(ourCd).toBeTruthy();
    expect(ourCd!.facts.role).toBe("teammate");
    // The owner's own spell item is unaffected; role stays owner
    const ownCd = items.find(
      (i) => i.kind === "our-cd" && i.facts.spell === "Combustion",
    );
    expect(ownCd!.facts.role).toBe("owner");
  });

  it("Fix 2 回归:burst 起点落在窗口外 → 锚在 fromSeconds 的条目丢弃,hp-end 仍保留", () => {
    const lateWin = (t: number) => t >= 50 && t <= 90;
    const spanningEntry: IBurstLedgerEntry = {
      ...entry,
      fromSeconds: 40,
      toSeconds: 55,
    };
    const items = offensivePackItems({
      entries: [spanningEntry],
      healerChains: [],
      ownerName: "Me-Area52",
      inWin: lateWin,
    });
    // fromSeconds=40 is outside the window: defensivesHit (immunity) and
    // allyCDsOverlapping (our-cd) are both anchored at e.fromSeconds, so no
    // item at t=40 may appear
    expect(items.some((i) => i.t === 40)).toBe(false);
    expect(items.some((i) => i.kind === "immunity")).toBe(false);
    // hp-end is anchored at toSeconds=55, inside the window, so it is kept
    expect(
      items.find(
        (i) => i.kind === "target-hp" && i.t === 55 && i.facts.hp === "18",
      ),
    ).toBeTruthy();
  });
});

describe("buildDeepDivePrompt 进攻图例", () => {
  it("含进攻 pack 时 prompt 印进攻条目说明", () => {
    const pack = {
      findingIndex: 0,
      anchorFrom: 0,
      anchorTo: 50,
      items: [
        {
          key: "p1",
          kind: "target-hp",
          t: 44,
          label: "",
          unitNames: [],
          facts: { t: "44", hp: "18", role: "enemy-target" },
        },
      ],
      facts: { "p1.t": "44", "p1.hp": "18", "p1.role": "enemy-target" },
    } as never;
    const findings = [
      {
        eventIds: ["b1"],
        severity: "high",
        category: "x",
        title: "爆发没打死",
        explanation: "x",
      },
    ] as never;
    const p = buildDeepDivePrompt([pack], findings, "Frost Mage", "Me-Area52");
    expect(p).toContain("kind=target-hp");
    expect(p).toContain("close it"); // keyword of the offensive coaching frame
  });
});

describe("buildDeepDivePack:focusT 锚在最末锚点(不从 clamp 过的 anchorTo 反推)", () => {
  // In arena the decisive death IS why the match ended, so "anchor +
  // PACK_AFTER_S > match duration" is the normal case. The old
  // focusT = anchorTo - PACK_AFTER_S landed earlier than the real anchor once
  // anchorTo was clamped by durS, shifting every HP checkpoint back (measured:
  // 5s early → all three "HP before death" readings misaligned).
  const mkUnit = (id: string, name: string, friendly: boolean) => ({
    id,
    name,
    info: { specId: "0" },
    spec: "0",
    reaction: friendly
      ? CombatUnitReaction.Friendly
      : CombatUnitReaction.Hostile,
    // One HP sample per second, HP% = 100 - seconds → the sampled instant can
    // be read back from the hp value
    advancedActions: Array.from({ length: 106 }, (_, s) => ({
      logLine: { timestamp: s * 1000 },
      advancedActorId: id,
      advancedActorCurrentHp: 100 - s,
      advancedActorMaxHp: 100,
    })),
    damageOut: [],
    damageIn: [],
    healOut: [],
    healIn: [],
    absorbsOut: [],
    absorbsIn: [],
    casts: [],
    castStarts: [],
    petCasts: [],
    auraEvents: [],
    actionsOut: [],
    actionsIn: [],
    deathRecords: [],
  });

  const combat = {
    startTime: 0,
    endTime: 105_000, // durS = 105
    units: {
      o: mkUnit("o", "Owner-Area52", true),
      e: mkUnit("e", "Warr-Area52", false),
    },
  };
  const candidates = [
    {
      id: "death:o:100",
      type: "death-setup",
      t: 100,
      unitNames: ["Owner-Area52"],
      facts: { t: "100" },
    },
  ] as unknown as CandidateEvent[];
  const finding = {
    eventIds: ["death:o:100"],
    severity: "high",
    category: "survival",
    title: "被秒",
    explanation: "x",
  } as Finding;

  it("锚点 100s / 比赛 105s:HP 检查点是 85/90/95,不是被夹早的 80/85/90", () => {
    const p = buildDeepDivePack(combat, finding, 0, candidates, "Owner-Area52");
    expect(p).not.toBeNull();
    // anchorTo is clamped by durS to 105 (< 100 + PACK_AFTER_S) — that is the
    // triggering condition
    expect(p!.anchorTo).toBe(105);
    const hpTimes = p!.items.filter((i) => i.kind === "hp").map((i) => i.t);
    expect(hpTimes).toEqual([85, 90, 95]);
    // HP value = 100 - seconds, reconfirming the samples land on those three
    // real instants
    const hpVals = p!.items
      .filter((i) => i.kind === "hp")
      .map((i) => i.facts.hp);
    expect(hpVals).toEqual(["15", "10", "5"]);
  });
});

describe("buildDeepDivePack:死亡锚定「可用未用」事实进包", () => {
  // The deep-dive pack previously only took defensives that were **cast**
  // (cd.casts); deathOutcome's missedExternals / availableImmunities never
  // entered the pack — the most valuable layer of death coaching (an external
  // that was available but never given) was locked out of the follow-up.
  // Single-source predicate: consume buildDeathOutcomeSummary directly.
  const mkUnit = (
    id: string,
    name: string,
    friendly: boolean,
    spec: string,
    deathAtMs?: number,
  ) => ({
    id,
    name,
    info: { specId: spec },
    spec,
    reaction: friendly
      ? CombatUnitReaction.Friendly
      : CombatUnitReaction.Hostile,
    advancedActions: [],
    damageOut: [],
    damageIn: [],
    healOut: [],
    healIn: [],
    absorbsOut: [],
    absorbsIn: [],
    casts: [],
    castStarts: [],
    petCasts: [],
    auraEvents: [],
    actionsOut: [],
    actionsIn: [],
    spellCastEvents: [],
    deathRecords: deathAtMs !== undefined ? [{ timestamp: deathAtMs }] : [],
  });

  const combat = {
    startTime: 0,
    endTime: 105_000,
    units: {
      o: mkUnit("o", "Owner-Area52", true, CombatUnitSpec.Priest_Discipline),
      w: mkUnit("w", "Warr-Area52", true, CombatUnitSpec.Warrior_Arms, 100_000),
      e: mkUnit("e", "Emage-Area52", false, CombatUnitSpec.Mage_Frost),
    },
  };
  const candidates = [
    {
      id: "death:w:100",
      type: "death-setup",
      t: 100,
      unitNames: ["Warr-Area52"],
      facts: { t: "100" },
    },
  ] as unknown as CandidateEvent[];
  const finding = {
    eventIds: ["death:w:100"],
    severity: "high",
    category: "survival",
    title: "战士暴毙",
    explanation: "x",
  } as Finding;

  it("队友死亡时 owner 的压制可用未给 → external-available 条目(holder=owner)", () => {
    const p = buildDeepDivePack(combat, finding, 0, candidates, "Owner-Area52");
    expect(p).not.toBeNull();
    const ext = p!.items.find(
      (i) =>
        i.kind === "external-available" && i.facts.spell === "Pain Suppression",
    );
    expect(ext).toBeTruthy();
    expect(ext!.facts.holder).toBe("Owner");
    expect(ext!.facts.holderRole).toBe("owner");
    expect(ext!.facts.holderCc).toBe("no");
    expect(ext!.facts.unit).toBe("Warr");
    expect(ext!.t).toBe(100);
  });

  it("prompt 图例:pack 含 external-available 时输出「可用未用」硬规则行", () => {
    const p = buildDeepDivePack(combat, finding, 0, candidates, "Owner-Area52");
    const prompt = buildDeepDivePrompt([p!], [finding], "Discipline Priest");
    expect(prompt).toContain("external-available");
    expect(prompt).toContain("OFF COOLDOWN");
  });
});

describe("shouldAttemptAuditRepair(全灭反馈重试判据,2026-08-06)", () => {
  it("0 存活 + ≥1 丢弃 → true(唯一的重试触发形状)", () => {
    expect(shouldAttemptAuditRepair(0, 1)).toBe(true);
    expect(shouldAttemptAuditRepair(0, 5)).toBe(true);
  });
  it("0 存活 + 0 丢弃(模型压根没写/空数组/解析失败,无违规可喂回)→ false", () => {
    expect(shouldAttemptAuditRepair(0, 0)).toBe(false);
  });
  it("有存活(不论丢弃多少)→ false —— 已经有可用内容,不重试", () => {
    expect(shouldAttemptAuditRepair(1, 0)).toBe(false);
    expect(shouldAttemptAuditRepair(1, 3)).toBe(false);
    expect(shouldAttemptAuditRepair(2, 0)).toBe(false);
  });
});

describe("buildAuditRepairPrompt(全灭反馈重试 prompt,2026-08-06)", () => {
  const originalPrompt = "FINDING 0: [high] 被秒 — died at the window's end.";
  const rawOutput = JSON.stringify([
    { findingIndex: 0, deepDive: "died at 40s", citedKeys: ["p1"] },
  ]);
  const drops: AuditDropInfo[] = [
    {
      reason: "bare-digit",
      detail: 'bare digit outside placeholder: "died at 40s"',
      text: "died at 40s",
      findingIndex: 0,
    },
    {
      reason: "causal-lint",
      detail: 'causal assertion: "caused"',
      text: "The stun caused the death",
      findingIndex: 0,
    },
  ];

  it("含原 prompt 全文段", () => {
    const out = buildAuditRepairPrompt(originalPrompt, rawOutput, drops);
    expect(out).toContain(originalPrompt);
  });
  it("含原始输出段(带分隔标记)", () => {
    const out = buildAuditRepairPrompt(originalPrompt, rawOutput, drops);
    expect(out).toContain(
      "YOUR PREVIOUS ATTEMPT (all entries were REJECTED by the audit):",
    );
    expect(out).toContain(rawOutput);
  });
  it("逐条列出违规(reason + detail)", () => {
    const out = buildAuditRepairPrompt(originalPrompt, rawOutput, drops);
    expect(out).toContain("AUDIT VIOLATIONS (fix every one):");
    expect(out).toContain(
      '- [bare-digit] bare digit outside placeholder: "died at 40s"',
    );
    expect(out).toContain('- [causal-lint] causal assertion: "caused"');
  });
  it("含收尾改写指令", () => {
    const out = buildAuditRepairPrompt(originalPrompt, rawOutput, drops);
    expect(out).toContain("Rewrite the COMPLETE JSON array");
    expect(out).toContain("Do not mention the audit or this correction.");
  });
  it("段落顺序:原 prompt → 原始输出 → 违规列表 → 改写指令", () => {
    const out = buildAuditRepairPrompt(originalPrompt, rawOutput, drops);
    const iOriginal = out.indexOf(originalPrompt);
    const iPrev = out.indexOf("YOUR PREVIOUS ATTEMPT");
    const iRaw = out.indexOf(rawOutput);
    const iViolations = out.indexOf("AUDIT VIOLATIONS");
    const iRewrite = out.indexOf("Rewrite the COMPLETE JSON array");
    expect(iOriginal).toBeGreaterThanOrEqual(0);
    expect(iPrev).toBeGreaterThan(iOriginal);
    expect(iRaw).toBeGreaterThan(iPrev);
    expect(iViolations).toBeGreaterThan(iRaw);
    expect(iRewrite).toBeGreaterThan(iViolations);
  });
});
