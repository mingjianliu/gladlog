import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  auditDeepDives,
  buildDeepDivePack,
  buildDeepDivePrompt,
  classifyFindingKind,
  hasCoachableSignal,
  hasOffensiveCoachableSignal,
  offensivePackItems,
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
    ); // 裸整数(镜像 auditFindings 严格层)
    expect(bad("The Fear at {{p1.t}}s caused your death.")).toHaveLength(0);
    expect(bad("Fine text, no evidence at all.", [])).toHaveLength(0);
    expect(bad("Fine text with {{p1.t}}s.", ["nope"])).toHaveLength(0);
    // citedKeys 空但文本用了合法占位符 → usedKeys 兜底,chips 从实际使用推导
    const rescued = bad("Fine text with {{p1.t}}s.", []);
    expect(rescued).toHaveLength(1);
    expect(rescued[0]!.chips.map((c) => c.t)).toEqual([128]);
  });

  it("占位符带空格 {{ p1.t }}:与 claimChecker 同源,usedKeys 仍抓得到(新#1)", () => {
    // 旧实现审计侧自带 /\{\{(p\d+)\.[^}]+\}\}/ 不容忍前导空格,而 claimChecker
    // 的 PLACEHOLDER 容忍 → 文本通过校验但 usedKeys 为空:citedKeys 缺席时整条
    // 被静默丢弃,在场时 chips 退化成只认 citedKeys(跳错时刻)。
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
    expect(spaced).toHaveLength(1); // citedKeys 空也能靠 usedKeys 兜底
    expect(spaced[0]!.text).toContain("At 128s the healer was locked down");
    expect(spaced[0]!.chips.map((c) => c.t)).toEqual([128]);
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
    // 生存-only pack(cc/enemy-cd 条目)不应触发进攻图例(锁定门条件不被反转)
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
    // 站到濒死 → 真失误
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
    // 100%→98%:干净窗口,不值得一轮模型调用(旧实现在这里恒 true)
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
    // 血线高但跌幅够大(100→84)→ 仍算代价
    expect(
      hasCoachableSignal([
        item("position", {
          role: "owner",
          kind: "stayed-in",
          hpStart: "100",
          hpMin: "84",
        }),
      ]),
    ).toBe(true);
    // 无 HP 数据 → 保持改动前行为(视为有代价),便于 eval 归因
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
  it("off-target / dr-clip 各自即信号(juked-kick 已降级不算)", () => {
    expect(
      hasOffensiveCoachableSignal([
        item("off-target", { role: "owner", onTargetPct: "40" }),
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
  it("免疫单独即信号(不要求目标触底);非免疫防御单独不算(Task 5 扫描修正)", () => {
    // 把爆发砸进免疫本身就是失误,即使目标血量还很高
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
    // 非免疫防御单独、目标没触底 → 不是信号(需目标同时被打低才成「该控奶」故事)
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

describe("classifyFindingKind(分发)", () => {
  const cand = (id: string, type: string): CandidateEvent => ({
    id,
    type,
    t: 10,
    unitNames: [],
    facts: {},
  });
  const cands = [
    cand("d1", "death"),
    cand("b1", "unconverted-burst"),
    cand("o1", "off-target-in-window"),
    cand("j1", "juked-kick"),
  ];
  const F = (eventIds: string[]): Finding => ({
    eventIds,
    severity: "high",
    category: "x",
    title: "x",
    explanation: "x",
  });
  it("death 候选 → survival", () => {
    expect(classifyFindingKind(F(["d1"]), cands)).toBe("survival");
  });
  it("非死亡候选 → offensive", () => {
    expect(classifyFindingKind(F(["b1"]), cands)).toBe("offensive");
    expect(classifyFindingKind(F(["o1"]), cands)).toBe("offensive");
  });
  it("混合平票偏 survival", () => {
    expect(classifyFindingKind(F(["d1", "b1"]), cands)).toBe("survival");
  });
  it("juked-kick 已降级 → survival(不路由进攻深挖)", () => {
    expect(classifyFindingKind(F(["j1"]), cands)).toBe("survival");
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
    expect(p).toContain("close it"); // 进攻教练框架关键词
  });
});

describe("buildDeepDivePack:focusT 锚在最末锚点(不从 clamp 过的 anchorTo 反推)", () => {
  // 竞技场里决定性死亡就是比赛结束的原因,所以「锚点 + PACK_AFTER_S > 比赛时长」
  // 是常态。旧写法 focusT = anchorTo - PACK_AFTER_S 在 anchorTo 被 durS 夹住后
  // 会比真锚点早,HP 检查点整体前移(实测早 5s → 三个「死前血线」全部错位)。
  const mkUnit = (id: string, name: string, friendly: boolean) => ({
    id,
    name,
    info: { specId: "0" },
    spec: "0",
    reaction: friendly
      ? CombatUnitReaction.Friendly
      : CombatUnitReaction.Hostile,
    // 每秒一个 HP 采样,HP% = 100 - 秒数 → 从 hp 值就能反推被采样的时刻
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
    // anchorTo 被 durS 夹到 105(< 100 + PACK_AFTER_S),这是触发条件
    expect(p!.anchorTo).toBe(105);
    const hpTimes = p!.items.filter((i) => i.kind === "hp").map((i) => i.t);
    expect(hpTimes).toEqual([85, 90, 95]);
    // HP 值 = 100 - 秒数,再次确认采样落在这三个真实时刻上
    const hpVals = p!.items
      .filter((i) => i.kind === "hp")
      .map((i) => i.facts.hp);
    expect(hpVals).toEqual(["15", "10", "5"]);
  });
});
