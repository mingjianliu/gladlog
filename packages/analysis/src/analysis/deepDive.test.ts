import { describe, expect, it } from "vitest";

import {
  auditDeepDives,
  buildDeepDivePrompt,
  type DeepDivePack,
} from "./deepDive";
import type { Finding } from "./types";

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
      facts: { t: "128", spell: "Fear", duration: "4.0", trinket: "on_cooldown" },
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
