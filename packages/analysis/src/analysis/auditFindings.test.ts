import { describe, expect, it } from "vitest";

import { auditFindings } from "./auditFindings";
import type { CandidateEvent, RawFinding } from "./types";

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R" },
  },
];
const base: RawFinding = {
  eventIds: ["death:a:30"],
  severity: "high",
  category: "survival",
  title: "Death",
  explanation: "You died at {{t}}s.",
};

describe("auditFindings", () => {
  it("keeps a grounded, numerically-clean, non-causal finding and interpolates it", () => {
    const r = auditFindings([base], candidates);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].explanation).toBe("You died at 30s.");
  });

  it("title 里的占位符同样解析(2026-08-18 真模型 smoke:{{target1}} 曾原样渲染进 UI)", () => {
    const r = auditFindings(
      [{ ...base, title: "{{unit}} died", explanation: "You died at {{t}}s." }],
      candidates,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].title).toBe("Me-R died");
  });

  it("title 使用碰撞键 → 与 explanation 同规则丢弃(歧义保证覆盖两个字段)", () => {
    const two: CandidateEvent[] = [
      candidates[0],
      {
        id: "death:b:40",
        type: "death",
        t: 40,
        unitNames: ["Ally"],
        facts: { t: "40", unit: "Ally" },
      },
    ];
    const r = auditFindings(
      [
        {
          ...base,
          eventIds: ["death:a:30", "death:b:40"],
          title: "Deaths around {{t}}s",
          explanation: "Two deaths, back to back.",
        },
      ],
      two,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/ambiguous|collid/i);
  });

  it("category 在审计层确定性归一(SURVIVAL → survival;词表外原样)", () => {
    const upper = auditFindings(
      [{ ...base, category: "SURVIVAL" }],
      candidates,
    );
    expect(upper.findings[0]!.category).toBe("survival");
    const zh = auditFindings([{ ...base, category: "目标选择" }], candidates);
    expect(zh.findings[0]!.category).toBe("target-selection");
    const unknown = auditFindings(
      [{ ...base, category: "macro-usage" }],
      candidates,
    );
    expect(unknown.findings[0]!.category).toBe("macro-usage");
  });
  it("drops a finding with a fabricated bare INTEGER outside a placeholder", () => {
    // The real death is at t=30; "47s" is fabricated. Integers are the analysis
    // fabrication surface, so a raw digit outside a placeholder must be dropped.
    const r = auditFindings(
      [{ ...base, explanation: "You died at 47s." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/raw digit|numeric/i);
  });
  it("drops an unanchored finding with empty eventIds (grounding)", () => {
    const r = auditFindings(
      [{ ...base, eventIds: [], explanation: "Play more defensively." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/ground|unanchored/i);
  });
  it("drops a multi-event finding whose referenced events collide on a fact key with differing values", () => {
    const two: CandidateEvent[] = [
      candidates[0],
      {
        id: "death:b:40",
        type: "death",
        t: 40,
        unitNames: ["Ally"],
        facts: { t: "40", unit: "Ally" },
      },
    ];
    const r = auditFindings(
      [
        {
          ...base,
          eventIds: ["death:a:30", "death:b:40"],
          explanation: "Two deaths, both around {{t}}s.",
        },
      ],
      two,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/ambiguous|collid/i);
  });
  it("keeps a finding referencing a bracket/format term (2v2) — not a fabricated digit", () => {
    const r = auditFindings(
      [
        {
          ...base,
          explanation: "In the 2v2 you went down at {{t}}s; play safer.",
        },
      ],
      candidates,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].explanation).toBe(
      "In the 2v2 you went down at 30s; play safer.",
    );
  });
  it("drops a finding citing a non-existent event (grounding)", () => {
    const r = auditFindings(
      [{ ...base, eventIds: ["death:zzz:99"] }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/ground/i);
  });
  it("drops a finding with a raw stat-digit outside a placeholder (numeric)", () => {
    const r = auditFindings(
      [{ ...base, explanation: "Your uptime was 0.85 there." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/numeric|claim/i);
  });
  it("drops a finding with strong causal attribution (causal lint)", () => {
    const r = auditFindings(
      [{ ...base, explanation: "You died because you greeded." }],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/causal/i);
  });
  it("sorts survivors by severity (high → low)", () => {
    const low: RawFinding = { ...base, severity: "low", title: "Low" };
    const r = auditFindings([low, base], candidates);
    expect(r.findings.map((f) => f.severity)).toEqual(["high", "low"]);
  });
});

describe("意图守护 severity 降一档(BACKLOG #26 Task 2,candidateFindings.ts 的 facts.attempted → 这里的确定性降级)", () => {
  // facts shape follows the 2026-08-30 decision-point rewrite (GH #34) —
  // this describe block only exercises auditFindings' ATTEMPTED_GUARD_TYPES
  // severity downgrade, which keys on `type` + presence of `facts.attempted`
  // alone, not on any other individual fact.
  const hoardedAttempted: CandidateEvent = {
    id: "cd-hoarded:h:m:380",
    type: "cd-hoarded",
    t: 380,
    unitNames: ["Healer-R", "Ally-R"],
    facts: {
      t: "380",
      crisisUnit: "Ally-R",
      crisisHpPct: "34",
      dmg2sPct: "30",
      readyCds: "Divine Shield",
      own: "no",
      refDeathSpent: "4.5",
      refDeathHeld: "11.4",
      refN: "16960",
      attempted: "曾尝试施放被拒(尚未恢复×3)",
    },
  };
  const { attempted: _attempted, ...factsWithoutAttempted } =
    hoardedAttempted.facts;
  const hoardedClean: CandidateEvent = {
    ...hoardedAttempted,
    id: "cd-hoarded:h:m:900",
    facts: factsWithoutAttempted,
  };
  const rawHoarded: RawFinding = {
    eventIds: [hoardedAttempted.id],
    severity: "high",
    category: "cooldown-usage",
    title: "Hoarded a ready defensive",
    explanation:
      "You had {{readyCds}} ready when {{crisisUnit}} fell to {{crisisHpPct}}% and spent none of it.",
  };

  it("① 候选带 attempted → severity 降一档(high→med)", () => {
    const r = auditFindings([rawHoarded], [hoardedAttempted]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.severity).toBe("med");
  });

  it("med→low、low→low(不会跌破 low,也不会一步从 high 跳到 low)", () => {
    const med = auditFindings(
      [{ ...rawHoarded, severity: "med" }],
      [hoardedAttempted],
    );
    expect(med.findings[0]!.severity).toBe("low");
    const low = auditFindings(
      [{ ...rawHoarded, severity: "low" }],
      [hoardedAttempted],
    );
    expect(low.findings[0]!.severity).toBe("low");
  });

  it("② 候选无 attempted(真没按)→ severity 不变", () => {
    const r = auditFindings(
      [{ ...rawHoarded, eventIds: [hoardedClean.id] }],
      [hoardedClean],
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.severity).toBe("high");
  });

  it("多事件 finding:任一引用事件带 attempted 即降级(与 isLegacy 的『任一即算』同规则)", () => {
    const r = auditFindings(
      [
        {
          ...rawHoarded,
          eventIds: [hoardedClean.id, hoardedAttempted.id],
          explanation: "Two cooldowns, one at {{t1}}s and one at {{t2}}s.",
        },
      ],
      [hoardedClean, hoardedAttempted],
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.severity).toBe("med");
  });

  it("③(review round 1 Minor 修复)类型门:非 ATTEMPTED_GUARD_TYPES 的候选即便碰巧带 facts.attempted 也不降级", () => {
    // A foreign type reusing the bare string key "attempted" for an unrelated
    // fact (e.g. a hypothetical future candidate) must NOT silently inherit
    // the severity downgrade — the gate is on `type`, not on the key's mere
    // presence (mirrors isLegacy's type-set gate, not a generic fact check).
    const foreignType: CandidateEvent = {
      id: "death:x:100",
      type: "death",
      t: 100,
      unitNames: ["Someone"],
      facts: { t: "100", unit: "Someone", attempted: "unrelated fact value" },
    };
    const foreignFinding: RawFinding = {
      eventIds: [foreignType.id],
      severity: "high",
      category: "survival",
      title: "Death",
      explanation: "They died at {{t}}s.",
    };
    const r = auditFindings([foreignFinding], [foreignType]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.severity).toBe("high"); // unchanged, not downgraded
  });
});

describe("挑选层多样性:legacy 二族(missed-cleanse/missed-purge;cc-locked 与 wasted-trinket 均 2026-08-19 GH #14 退役出族)合计上限 3(2026-08-11 定为 2,2026-08-15 约束审计 C1 放宽为 3——见 auditFindings.ts 的 legacyKept 门注释)", () => {
  // TWO events per legacy type (the cap counts findings, not distinct types,
  // so 4-legacy overflow scenarios survive the family shrinking to two), one
  // wasted-trinket event that now rides as NON-legacy (its 2026-08-19
  // retirement demoted it out of the family — kept here to pin exactly
  // that), one non-legacy (death) and one "mixed" finding referencing both a
  // legacy and a non-legacy event.
  const cleanse: CandidateEvent = {
    id: "missed-cleanse:a:10",
    type: "missed-cleanse",
    t: 10,
    unitNames: ["Ally"],
    facts: { t: "10" },
  };
  const cleanse2: CandidateEvent = {
    id: "missed-cleanse:a2:15",
    type: "missed-cleanse",
    t: 15,
    unitNames: ["Ally"],
    facts: { t: "15" },
  };
  const purge: CandidateEvent = {
    id: "missed-purge:b:20",
    type: "missed-purge",
    t: 20,
    unitNames: ["Enemy"],
    facts: { t: "20" },
  };
  const purge2: CandidateEvent = {
    id: "missed-purge:b2:30",
    type: "missed-purge",
    t: 30,
    unitNames: ["Enemy"],
    facts: { t: "30" },
  };
  const trinket: CandidateEvent = {
    id: "wasted-trinket:d:40",
    type: "wasted-trinket",
    t: 40,
    unitNames: ["Me"],
    facts: { t: "40" },
  };
  const death: CandidateEvent = {
    id: "death:e:50",
    type: "death",
    t: 50,
    unitNames: ["Me"],
    facts: { t: "50" },
  };
  const four: CandidateEvent[] = [
    cleanse,
    cleanse2,
    purge,
    purge2,
    trinket,
    death,
  ];

  const findingFor = (
    c: CandidateEvent,
    severity: RawFinding["severity"],
  ): RawFinding => ({
    eventIds: [c.id],
    severity,
    category: "dispel",
    title: c.type,
    explanation: `Something happened at {{t}}s.`,
  });

  it("4 条同族(混合 severity)→ 保留最重的 3 条,溢出(最轻的 1 条)计入 dropped 且理由点名 diversity", () => {
    // Deliberately shuffled + mixed severity: low/high/med/high. Expect the
    // two HIGH ones plus the MED one to survive regardless of input order
    // (cap=3, 2026-08-15 约束审计 C1 放宽), and only the single LOW one to be
    // dropped.
    const raw = [
      findingFor(cleanse2, "low"),
      findingFor(cleanse, "high"),
      findingFor(purge2, "med"),
      findingFor(purge, "high"),
    ];
    const r = auditFindings(raw, four);
    expect(r.findings).toHaveLength(3);
    expect(r.findings.map((f) => f.severity)).toEqual(["high", "high", "med"]);
    expect(r.findings.map((f) => f.title).sort()).toEqual(
      ["missed-cleanse", "missed-purge", "missed-purge"].sort(),
    );
    const overflowDropped = r.dropped.filter((d) => /diversity/.test(d.reason));
    expect(overflowDropped).toHaveLength(1);
    expect(overflowDropped[0]!.finding.title).toBe("missed-cleanse");
  });

  it("3 条同族 → 都保留,不触发多样性丢弃(cap=3 的边界)", () => {
    const raw = [
      findingFor(cleanse, "high"),
      findingFor(purge, "med"),
      findingFor(purge2, "low"),
    ];
    const r = auditFindings(raw, four);
    expect(r.findings).toHaveLength(3);
    expect(r.dropped).toHaveLength(0);
  });

  it("跨族(3 个 legacy + 2 个非 legacy)→ 非 legacy 的两条完全不受上限影响", () => {
    const kick: CandidateEvent = {
      id: "kick-eaten:f:60",
      type: "kick-eaten",
      t: 60,
      unitNames: ["Me"],
      facts: { t: "60" },
    };
    const raw = [
      findingFor(cleanse, "high"),
      findingFor(purge, "med"),
      findingFor(purge2, "low"),
      findingFor(cleanse2, "low"), // 4th legacy -> would overflow alone
      findingFor(trinket, "low"), // retired type: rides as NON-legacy now
      findingFor(death, "high"),
      findingFor(kick, "med"),
    ];
    const r = auditFindings(raw, [...four, kick]);
    // 3 legacy survive (cleanse, purge, purge2 -- higher severity/earlier),
    // cleanse2 is the overflow; the non-legacy three (death, kick-eaten, and
    // wasted-trinket after its 2026-08-19 GH #14 retirement demoted it out of
    // the family) survive untouched.
    expect(r.findings).toHaveLength(6);
    expect(r.findings.map((f) => f.title).sort()).toEqual(
      [
        "death",
        "kick-eaten",
        "missed-cleanse",
        "missed-purge",
        "missed-purge",
        "wasted-trinket",
      ].sort(),
    );
    expect(r.dropped.filter((d) => /diversity/.test(d.reason))).toHaveLength(1);
  });

  it("eventIds 回连从严语义:一条 finding 同时引用 legacy + 非 legacy 事件,也算 legacy(占一个族名额)", () => {
    // Mixed finding first, then three more pure-legacy findings: the mixed
    // one counts toward the cap, so TWO more pure-legacy findings fit
    // (cap=3), and the fourth (lowest severity) overflows.
    const mixed: RawFinding = {
      eventIds: [purge.id, death.id],
      severity: "high",
      category: "survival",
      title: "mixed",
      explanation: "At {{t1}}s the purge was missed; you died at {{t2}}s.",
    };
    const raw = [
      mixed,
      findingFor(cleanse, "high"),
      findingFor(purge2, "med"),
      findingFor(cleanse2, "low"),
    ];
    const r = auditFindings(raw, four);
    expect(r.findings).toHaveLength(3);
    expect(r.findings.map((f) => f.title)).toEqual([
      "mixed",
      "missed-cleanse",
      "missed-purge",
    ]);
    const overflow = r.dropped.filter((d) => /diversity/.test(d.reason));
    expect(overflow).toHaveLength(1);
    expect(overflow[0]!.finding.title).toBe("missed-cleanse");
  });

  it("无 eventIds / 回连不到候选的 finding 已在更早的 grounding 层被丢,不计入 legacy 族(不会被 diversity reason 误标)", () => {
    const raw = [
      { ...findingFor(cleanse, "high"), eventIds: [] },
      findingFor(purge, "high"),
      findingFor(trinket, "high"),
    ];
    const r = auditFindings(raw, four);
    // The empty-eventIds one dies at the grounding layer, never reaching the
    // diversity count -- so purge (1 legacy, under the cap=3 ceiling) and
    // trinket (non-legacy since its 2026-08-19 retirement) both survive.
    expect(r.findings).toHaveLength(2);
    expect(r.findings.map((f) => f.title).sort()).toEqual(
      ["missed-purge", "wasted-trinket"].sort(),
    );
    expect(r.dropped.find((d) => /ground/.test(d.reason))).toBeTruthy();
    expect(r.dropped.some((d) => /diversity/.test(d.reason))).toBe(false);
  });
});

describe("跨事件 facts 键冲突(2026-07-24 精化:只丢实际使用了冲突键的)", () => {
  const two: CandidateEvent[] = [
    {
      id: "missed-cleanse:X:20",
      type: "missed-cleanse",
      t: 20,
      unitNames: ["X"],
      facts: { t: "20.0", cc: "Fear", duration: "5.0" },
    },
    {
      id: "missed-cleanse:X:80",
      type: "missed-cleanse",
      t: 80,
      unitNames: ["X"],
      facts: { t: "80.0", cc: "Sheep", duration: "6.0" },
    },
  ];
  const multi: RawFinding = {
    eventIds: ["missed-cleanse:X:20", "missed-cleanse:X:80"],
    severity: "med",
    category: "dispel",
    title: "Cleanses missed twice",
    explanation: "High-value CC sat on your ally twice without a dispel.",
  };

  it("引用冲突事件但解释未用冲突键 → 保留(旧规则会误杀)", () => {
    const r = auditFindings([multi], two);
    expect(r.findings).toHaveLength(1);
  });

  it("HAS TEETH:解释用了冲突键 {{t}} → 丢,理由点名该键", () => {
    const r = auditFindings(
      [{ ...multi, explanation: "At {{t}}s the CC sat without a dispel." }],
      two,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0]!.reason).toMatch(/placeholder.*t.*collide/);
  });

  it("用的是非冲突键(仅一事件含 deathT 类独有键)→ 保留并插值", () => {
    const withUnique: CandidateEvent[] = [
      two[0]!,
      {
        ...two[1]!,
        id: "death-setup:X:90",
        facts: { t: "80.0", deathT: "90.0", kind: "healer-locked" },
      },
    ];
    const r = auditFindings(
      [
        {
          ...multi,
          eventIds: ["missed-cleanse:X:20", "death-setup:X:90"],
          explanation:
            "The setup happened earlier; the death followed at {{deathT}}s.",
        },
      ],
      withUnique,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.explanation).toContain("90.0s");
  });
});

describe("冲突键带序号变体(2026-07-25:多事件 finding 的合法时刻引用)", () => {
  const two: CandidateEvent[] = [
    {
      id: "cc-locked:P:20",
      type: "cc-locked",
      t: 20,
      unitNames: ["Me"],
      facts: { t: "19.9", cc: "Hammer of Justice", duration: "5.0" },
    },
    {
      id: "cc-locked:P:85",
      type: "cc-locked",
      t: 85,
      unitNames: ["Me"],
      facts: { t: "85.4", cc: "Hammer of Justice", duration: "5.0" },
    },
  ];

  it("{{t1}}/{{t2}} 按 eventIds 顺序解析并插值", () => {
    const r = auditFindings(
      [
        {
          eventIds: ["cc-locked:P:20", "cc-locked:P:85"],
          severity: "med",
          category: "cc",
          title: "两次被控",
          explanation: "第一次在 {{t1}}s,第二次在 {{t2}}s,同一套控制链。",
        },
      ],
      two,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.explanation).toContain("19.9s");
    expect(r.findings[0]!.explanation).toContain("85.4s");
  });

  it("HAS TEETH:裸 {{t}} 仍然丢(歧义不猜)", () => {
    const r = auditFindings(
      [
        {
          eventIds: ["cc-locked:P:20", "cc-locked:P:85"],
          severity: "med",
          category: "cc",
          title: "两次被控",
          explanation: "在 {{t}}s 被控。",
        },
      ],
      two,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0]!.reason).toMatch(/collide/);
  });

  it("值相同的共享键不算冲突,不生成序号变体也不丢", () => {
    const r = auditFindings(
      [
        {
          eventIds: ["cc-locked:P:20", "cc-locked:P:85"],
          severity: "low",
          category: "cc",
          title: "同法术",
          explanation: "两次都是 {{cc}},时长都到 {{duration}}s。",
        },
      ],
      two,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.explanation).toContain("Hammer of Justice");
  });
});

describe("序号变体覆盖全部键(2026-07-25 二修:模型看不见冲突集)", () => {
  it("非冲突键的 {{duration1}} 与单事件的 {{deathT1}} 也能解析", () => {
    const evts: CandidateEvent[] = [
      {
        id: "cc-locked:P:20",
        type: "cc-locked",
        t: 20,
        unitNames: ["Me"],
        facts: { t: "19.9", duration: "5.0" },
      },
      {
        id: "cc-locked:P:85",
        type: "cc-locked",
        t: 85,
        unitNames: ["Me"],
        facts: { t: "85.4", duration: "5.0" }, // same duration value → no collision
      },
    ];
    const r = auditFindings(
      [
        {
          eventIds: ["cc-locked:P:20", "cc-locked:P:85"],
          severity: "med",
          category: "cc",
          title: "链控",
          explanation: "第一次 {{t1}}s 吃满 {{duration1}}s,第二次 {{t2}}s。",
        },
      ],
      evts,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.explanation).toBe(
      "第一次 19.9s 吃满 5.0s,第二次 85.4s。",
    );

    const single: CandidateEvent[] = [
      {
        id: "death-setup:X:90",
        type: "death-setup",
        t: 80,
        unitNames: ["X"],
        facts: { t: "80.0", deathT: "90.0" },
      },
    ];
    const r2 = auditFindings(
      [
        {
          eventIds: ["death-setup:X:90"],
          severity: "high",
          category: "chain",
          title: "链",
          explanation: "铺垫在 {{t1}}s,死亡在 {{deathT1}}s。",
        },
      ],
      single,
    );
    expect(r2.findings).toHaveLength(1);
    expect(r2.findings[0]!.explanation).toBe("铺垫在 80.0s,死亡在 90.0s。");
  });
});

describe("hindsight 谓词(Task 2:auditFindings 第五层 drop)", () => {
  const kickEaten: CandidateEvent = {
    id: "kick-eaten:P:130",
    type: "kick-eaten",
    t: 130,
    unitNames: ["Foe"],
    facts: { t: "130", spell: "Kick" },
  };
  const deathUnusedDefensive: CandidateEvent = {
    id: "death-unused-defensive:P:161",
    type: "death-unused-defensive",
    t: 161,
    unitNames: ["Me"],
    facts: { t: "161", walls: "PvP Trinket" },
  };

  it("drops a finding whose referenced events cross the hindsight cluster window on a mismatched type", () => {
    const r = auditFindings(
      [
        {
          eventIds: [kickEaten.id, deathUnusedDefensive.id],
          severity: "high",
          category: "survival",
          title: "Kick then death",
          explanation:
            "You ate a kick at {{t1}}s; the defensive was still unused at {{t2}}s.",
        },
      ],
      [kickEaten, deathUnusedDefensive],
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0]!.reason).toMatch(/hindsight:/);
  });

  it("keeps a same-type finding spanning the same gap (no cross-type hindsight jump)", () => {
    const kickA: CandidateEvent = {
      id: "kick-eaten:P:10",
      type: "kick-eaten",
      t: 10,
      unitNames: ["Foe"],
      facts: { t: "10", spell: "Kick" },
    };
    const kickB: CandidateEvent = {
      id: "kick-eaten:P:200",
      type: "kick-eaten",
      t: 200,
      unitNames: ["Foe"],
      facts: { t: "200", spell: "Kick" },
    };
    const r = auditFindings(
      [
        {
          eventIds: [kickA.id, kickB.id],
          severity: "med",
          category: "survival",
          title: "Two kicks",
          explanation: "First kick at {{t1}}s, second kick at {{t2}}s.",
        },
      ],
      [kickA, kickB],
    );
    expect(r.findings).toHaveLength(1);
  });
});

describe("agy 复核采纳(2026-07-25)", () => {
  it("F3:非法占位符 {{t-1}} 不再漏过 —— 按裸数字丢弃,不会原样渲染", () => {
    const r = auditFindings(
      [
        {
          eventIds: ["death:a:30"],
          severity: "med",
          category: "x",
          title: "t",
          explanation: "被控发生在 {{t-1}}s。",
        },
      ],
      candidates,
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0]!.reason).toMatch(/raw digit|numeric/);
  });

  it("F2 契约:候选 facts 键不得以数字结尾(序号变体命名空间保留)", async () => {
    // Full sweep over the real extraction path: every candidate and every
    // facts key of the synth match
    const { GladLogParser } = await import("@gladlog/parser");
    const { synthArenaLog } =
      await import("../../../parser/src/testing/synthLog");
    const { toLegacyMatch } = await import("@gladlog/parser-compat");
    const { extractCandidateFindings } = await import("./candidateFindings");
    const parser = new GladLogParser();
    let match: unknown = null;
    parser.on("match", (m) => (match = m));
    for (const line of synthArenaLog().split("\n")) parser.push(line);
    parser.end();
    const legacy = toLegacyMatch(match as never);
    const evts = extractCandidateFindings(legacy);
    for (const c of evts) {
      for (const k of Object.keys(c.facts)) {
        expect(k, `候选 ${c.type} 的 facts 键 ${k} 以数字结尾`).not.toMatch(
          /\d$/,
        );
      }
    }
    // Task 2 smoke test (a defensive was available but unused at death): the
    // extraction must not blow up, and the type either appears in the output
    // or is legitimately absent — the synth match's only death is on the enemy
    // side (victim = team1) with no owner (friendly) death, so this type is
    // legitimately missing; if it does appear, its facts must be
    // self-consistent.
    const unusedDefensive = evts.filter(
      (c) => c.type === "death-unused-defensive",
    );
    for (const c of unusedDefensive) {
      expect(Number.isNaN(Number(c.facts["t"]))).toBe(false);
      expect(c.facts["walls"]).toBeTruthy();
    }
  });

  it("a finding without eventIds (model used its own schema) is dropped, not a crash (n=100 A/B, 2026-09-12)", () => {
    const bad = {
      severity: "high",
      category: "x",
      title: "t",
      explanation: "e",
    } as unknown as RawFinding;
    const res = auditFindings([bad], candidates);
    expect(res.findings).toHaveLength(0);
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0]!.reason).toBe("grounding: missing eventIds");
  });
});
