import { describe, expect, it } from "vitest";

import {
  auditDeepDives,
  buildDeepDivePrompt,
  hasCoachableSignal,
  hasOffensiveCoachableSignal,
  offensivePackItems,
  type DeepDivePack,
} from "./deepDive";
import type { Finding } from "./types";
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
    ); // 裸整数(镜像 auditFindings 严格层)
    expect(bad("The Fear at {{p1.t}}s caused your death.")).toHaveLength(0);
    expect(bad("Fine text, no evidence at all.", [])).toHaveLength(0);
    expect(bad("Fine text with {{p1.t}}s.", ["nope"])).toHaveLength(0);
    // citedKeys 空但文本用了合法占位符 → usedKeys 兜底,chips 从实际使用推导
    const rescued = bad("Fine text with {{p1.t}}s.", []);
    expect(rescued).toHaveLength(1);
    expect(rescued[0]!.chips.map((c) => c.t)).toEqual([128]);
  });

  it("findingIndex 无对应 pack → 丢弃;非数组输入 → 空", () => {
    expect(
      auditDeepDives(
        [{ findingIndex: 7, deepDive: "x", citedKeys: ["p1"] }],
        [pack],
      ),
    ).toHaveLength(0);
    expect(auditDeepDives("not-an-array", [pack])).toHaveLength(0);
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
  it("走位失误(修 3)= 信号:STAYED_IN 只在掉血时触发,故任一走位条即真失误", () => {
    expect(
      hasCoachableSignal([
        item("position", { role: "owner", kind: "stayed-in", hpMin: "12" }),
      ]),
    ).toBe(true);
    expect(
      hasCoachableSignal([
        item("position", { role: "owner", kind: "missed-push", dist: "35" }),
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
  it("off-target / juked / dr-clip 各自即信号", () => {
    expect(
      hasOffensiveCoachableSignal([
        item("off-target", { role: "owner", onTargetPct: "40" }),
      ]),
    ).toBe(true);
    expect(
      hasOffensiveCoachableSignal([
        item("juked-kick", { role: "owner", kick: "Kick" }),
      ]),
    ).toBe(true);
    expect(
      hasOffensiveCoachableSignal([
        item("dr-clip", { role: "owner", dr: "Immune" }),
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

  it("burst-into-immunity:出 target-hp(start+end)+ immunity + our-cd,名字短名、role 正确", () => {
    const items = offensivePackItems({
      entries: [entry],
      healerChains: [],
      candFacts: [{ immunity: "Ice Block", overlap: "2.5" }],
      candTypes: ["burst-into-immunity"],
      ownerName: "Me-Area52",
      inWin,
    });
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("target-hp");
    expect(kinds).toContain("immunity");
    expect(
      items.find((i) => i.kind === "target-hp" && i.facts.hp === "18"),
    ).toBeTruthy();
    // 短名:realm 数字去掉,否则裸数字审计误杀
    expect(items.find((i) => i.facts.unit === "Rdruid")).toBeTruthy();
    expect(
      items.every(
        (i) => i.facts.unit === undefined || !/\d/.test(i.facts.unit),
      ),
    ).toBe(true);
    // 免疫 role=enemy
    expect(items.find((i) => i.kind === "immunity")!.facts.role).toBe("enemy");
  });

  it("healer CC 链在窗口内 → our-cc(role=owner);窗口外的丢弃", () => {
    const items = offensivePackItems({
      entries: [],
      candTypes: ["off-target-in-window"],
      candFacts: [
        {
          onTargetPct: "40",
          target: "Rdruid-Area52",
          offTarget: "Warr-Area52",
        },
      ],
      healerChains: [
        {
          targetName: "Hpal-Area52",
          targetSpec: "65",
          hasWastedApplications: false,
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
    expect(cc).toHaveLength(1); // 窗口外的 99s 被 inWin 丢
    expect(cc[0]!.facts.role).toBe("owner");
    // off-target 类型条:来自候选 facts
    const off = items.find((i) => i.kind === "off-target");
    expect(off!.facts.onTargetPct).toBe("40");
    expect(off!.facts.target).toBe("Warr"); // offTarget 短名
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
      candFacts: [],
      candTypes: [],
      ownerName: "Me-Area52",
      inWin,
    });
    const ourCd = items.find(
      (i) => i.kind === "our-cd" && i.facts.spell === "Power Infusion",
    );
    expect(ourCd).toBeTruthy();
    expect(ourCd!.facts.role).toBe("teammate");
    // owner 自己的 spell 条目不受影响,role 仍是 owner
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
      candFacts: [],
      candTypes: [],
      ownerName: "Me-Area52",
      inWin: lateWin,
    });
    // fromSeconds=40 在窗口外:defensivesHit(immunity)、allyCDsOverlapping(our-cd)
    // 都锚在 e.fromSeconds,不能出现 t=40 的条目
    expect(items.some((i) => i.t === 40)).toBe(false);
    expect(items.some((i) => i.kind === "immunity")).toBe(false);
    // hp-end 锚在 toSeconds=55,在窗口内,应保留
    expect(
      items.find(
        (i) => i.kind === "target-hp" && i.t === 55 && i.facts.hp === "18",
      ),
    ).toBeTruthy();
  });
});
