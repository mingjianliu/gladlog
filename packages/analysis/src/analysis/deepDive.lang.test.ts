// UI-language spec §6.5 / §7: the deep-dive pack labels (chips) and the
// selected-window anchor (sent to the model) follow the UI language, while the
// zh output stays byte-for-byte what it was. Every whole-round reading the
// pack consumes is mocked so that one pack carries every label kind
// (vi.mock: this file runs isolated, not in vitest.shared.json).
import { createHash } from "node:crypto";

import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it, vi } from "vitest";

import { selfCastNoopAnnotatedName } from "../utils/cooldowns";
import { CJK_LEAK } from "../utils/localizedText";
import {
  buildDeepDivePack,
  buildDeepDivePrompt,
  buildOffensiveDeepDivePack,
  buildWindowAnchorFinding,
  buildWindowPack,
  type DeepDivePack,
  PACK_ITEM_KIND_EN,
  PACK_ITEM_KIND_ZH,
  type PackItem,
} from "./deepDive";
import type { CandidateEvent, Finding } from "./types";

vi.mock("../utils/ccTrinketAnalysis", async (orig) => ({
  ...(await orig<typeof import("../utils/ccTrinketAnalysis")>()),
  analyzePlayerCCAndTrinket: (u: { name: string }) => ({
    ccInstances:
      u.name === "Owner-Area52"
        ? [
            {
              atSeconds: 80,
              spellId: "5782",
              spellName: "Fear",
              durationSeconds: 4,
              trinketState: "available_unused",
            },
          ]
        : [],
  }),
}));
vi.mock("../utils/enemyCDs", async (orig) => ({
  ...(await orig<typeof import("../utils/enemyCDs")>()),
  reconstructEnemyCDTimeline: () => ({
    players: [
      {
        playerName: "Emage-Area52",
        offensiveCDs: [
          { spellId: "12472", spellName: "Icy Veins", castTimeSeconds: 82 },
        ],
      },
    ],
    alignedBurstWindows: [],
  }),
}));
vi.mock("../utils/cooldowns", async (orig) => ({
  ...(await orig<typeof import("../utils/cooldowns")>()),
  extractMajorCooldowns: () => [],
  computePressureWindows: () => [],
  annotateDefensiveTimings: (_cds: unknown, u: { name: string }) =>
    u.name === "Owner-Area52"
      ? [
          {
            spellId: "33206",
            spellName: "Pain Suppression",
            tag: "Defensive",
            casts: [{ timeSeconds: 84, timingLabel: "Late" }],
          },
        ]
      : [],
}));
vi.mock("../utils/killWindowTargetSelection", async (orig) => ({
  ...(await orig<typeof import("../utils/killWindowTargetSelection")>()),
  getHpPercentAtTime: () => 42,
}));
vi.mock("../utils/dispelAnalysis", async (orig) => ({
  ...(await orig<typeof import("../utils/dispelAnalysis")>()),
  reconstructDispelSummary: () => ({
    allyCleanse: [
      {
        timeSeconds: 86,
        dispelSpellId: "527",
        dispelSpellName: "Purify",
        removedSpellName: "Polymorph",
        sourceName: "Owner-Area52",
        targetName: "Warr-Area52",
        priority: "Critical",
      },
    ],
    ourPurges: [],
  }),
}));
vi.mock("../utils/deathOutcomeAnalysis", async (orig) => ({
  ...(await orig<typeof import("../utils/deathOutcomeAnalysis")>()),
  buildDeathOutcomeSummary: () => ({
    events: [
      {
        atSeconds: 100,
        deadPlayer: "Warr-Area52",
        availableImmunities: [
          { spellId: "642", spellName: "Divine Shield", wasInCC: false },
        ],
        missedExternals: [
          {
            spellId: "6940",
            spellName: "Blessing of Sacrifice",
            casterName: "Owner-Area52",
            casterWasInCC: false,
          },
        ],
      },
    ],
  }),
}));
vi.mock("../utils/positionAnalysis", async (orig) => ({
  ...(await orig<typeof import("../utils/positionAnalysis")>()),
  computeOwnerPositionEvents: () => [
    {
      type: "STAYED_IN",
      atSeconds: 88,
      ownerHpStartPct: 90,
      ownerHpLowPct: 30,
    },
    { type: "MISSED_PUSH", atSeconds: 90, startDistanceYards: 45 },
    { type: "CD_OUT_OF_RANGE", atSeconds: 92, spellName: "Avenging Wrath" },
    { type: "CD_OUT_OF_RANGE", atSeconds: 94 },
  ],
}));

const mkUnit = (id: string, name: string, friendly: boolean, spec: string) => ({
  id,
  name,
  info: { specId: spec },
  spec,
  reaction: friendly ? CombatUnitReaction.Friendly : CombatUnitReaction.Hostile,
  advancedActions: [],
  damageOut: [],
  damageIn: [],
  healOut: [],
  healIn: [],
  absorbsOut: [],
  absorbsIn: [],
  spellCastEvents: [],
  castStartEvents: [],
  auraEvents: [],
  deathRecords: [],
});
// A fresh round object per call: the pack readings are memoized per round.
const mkCombat = () => ({
  startTime: 0,
  endTime: 105_000,
  units: {
    o: mkUnit("o", "Owner-Area52", true, CombatUnitSpec.Priest_Discipline),
    w: mkUnit("w", "Warr-Area52", true, CombatUnitSpec.Warrior_Arms),
    e: mkUnit("e", "Emage-Area52", false, CombatUnitSpec.Mage_Frost),
  },
});
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
  title: "Warrior died",
  explanation: "x",
} as Finding;

const ALL_KINDS: PackItem["kind"][] = [
  "cc",
  "defensive",
  "enemy-cd",
  "hp",
  "dispel",
  "external-available",
  "immunity-available",
  "position",
  "target-hp",
  "enemy-defensive",
  "immunity",
  "our-cc",
  "our-cd",
  "cd-ledger",
  "aura-snap",
  "pos-snap",
  "dr-state",
  "healing-gap",
  "activity-gap",
  "hp-snap",
];
/** A pack holding one item of every kind (the anchor reads kinds only). */
const everyKindPack: DeepDivePack = {
  findingIndex: 0,
  anchorFrom: 36.7,
  anchorTo: 59.2,
  items: ALL_KINDS.map((kind, i) => ({
    key: `p${i + 1}`,
    kind,
    t: 40,
    label: kind,
    unitNames: [],
    facts: { t: "40" },
  })),
  facts: {},
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("deepDive 中文输出钉死(界面语言改造前)", () => {
  it("生存包:每类条目的 label(中文)", () => {
    const p = buildDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
    );
    expect(p!.items.map((i) => `${i.kind} | ${i.label}`))
      .toMatchInlineSnapshot(`
      [
        "cc | Fear → Owner(4.0s)",
        "enemy-cd | 敌 Icy Veins(Emage)",
        "defensive | Pain Suppression(Owner)",
        "hp | Warr HP 42%",
        "dispel | Purify 解 Polymorph",
        "position | 走位:停留承压",
        "hp | Warr HP 42%",
        "position | 走位:脱节",
        "position | 走位:Avenging Wrath空放",
        "position | 走位:大招空放",
        "hp | Warr HP 42%",
        "immunity-available | Divine Shield 可用未按(Warr)",
        "external-available | Blessing of Sacrifice 可用未给(Owner→Warr)",
      ]
    `);
  });

  it("选段包(buildWindowPack)走同一组 label", () => {
    const r = buildWindowPack(mkCombat(), 70, 105, candidates, "Owner-Area52");
    expect(r!.kind).toBe("survival");
    expect(r!.pack.items.map((i) => i.label)).toMatchInlineSnapshot(`
      [
        "Warr HP 42%",
        "Warr HP 42%",
        "Fear → Owner(4.0s)",
        "敌 Icy Veins(Emage)",
        "Warr HP 42%",
        "Pain Suppression(Owner)",
        "Purify 解 Polymorph",
        "走位:停留承压",
        "走位:脱节",
        "走位:Avenging Wrath空放",
        "走位:大招空放",
        "Divine Shield 可用未按(Warr)",
        "Blessing of Sacrifice 可用未给(Owner→Warr)",
      ]
    `);
  });

  it("选段锚点:标题与说明(全部 20 类 kind 的中文词)", () => {
    const f = buildWindowAnchorFinding(everyKindPack, 36.7, 59.2, "survival");
    expect(f).toMatchInlineSnapshot(`
      {
        "category": "window",
        "eventIds": [],
        "explanation": "该窗口由用户手动选取。窗口内证据:受控×1、防御施放×1、敌方进攻 CD×1、HP 轨迹×1、驱散×1、外置可用×1、免疫可用×1、走位×1、目标血线×1、敌方防御×1、敌方免疫×1、我方控制×1、我方大招×1、冷却台账×1、光环快照×1、站位快照×1、DR 档位×1、治疗空窗×1、输出空窗×1、HP 快照×1。",
        "severity": "low",
        "title": "用户选段 0:36–0:59",
      }
    `);
    const off = buildWindowAnchorFinding(
      everyKindPack,
      36.7,
      59.2,
      "offensive",
    );
    expect(off.category).toBe("window-offensive");
  });

  it("中文选段 prompt 与 deepen prompt 逐字节不变(sha256)", () => {
    const p = buildDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
    )!;
    const anchor = buildWindowAnchorFinding(p, 70, 105, "survival");
    const windowPrompt = buildDeepDivePrompt(
      [p],
      [anchor],
      "Discipline Priest",
      "Owner-Area52",
      "window",
    );
    expect(windowPrompt.split("\n")[2]).toMatchInlineSnapshot(
      `"SELECTED WINDOW 0: 用户选段 1:10–1:45 — 该窗口由用户手动选取。窗口内证据:受控×1、敌方进攻 CD×1、防御施放×1、HP 轨迹×3、驱散×1、走位×4、免疫可用×1、外置可用×1。"`,
    );
    expect(sha(windowPrompt)).toMatchInlineSnapshot(
      `"641473e9870426077ab94746a6dab3986cc3f0f95cf14738a627a1a427445715"`,
    );
    const everyKindPrompt = buildDeepDivePrompt(
      [everyKindPack],
      [buildWindowAnchorFinding(everyKindPack, 36.7, 59.2, "survival")],
      "Discipline Priest",
      "Owner-Area52",
      "window",
    );
    expect(sha(everyKindPrompt)).toMatchInlineSnapshot(
      `"546d923ef200ae899dbe074d447a7e79dcf22c2b1642be7a6446fd1c0764a96e"`,
    );
    const deepenPrompt = buildDeepDivePrompt(
      [p],
      [finding],
      "Discipline Priest",
      "Owner-Area52",
    );
    expect(sha(deepenPrompt)).toMatchInlineSnapshot(
      `"2aca7b47084866102b720b351b702d68da3d242b245c20ef90a0929b056cf928"`,
    );
  });
});

describe("deepDive 跟随界面语言(en)", () => {
  const enPack = () =>
    buildDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
      undefined,
      "en",
    )!;

  it("en 包:label 不含中文,facts 与 zh 逐项相同(facts 进 prompt)", () => {
    const en = enPack();
    const zh = buildDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
    )!;
    expect(en.items.filter((i) => CJK_LEAK.test(i.label))).toEqual([]);
    expect(en.facts).toEqual(zh.facts);
    expect(en.items.map((i) => i.kind)).toEqual(zh.items.map((i) => i.kind));
    expect(en.items.map((i) => `${i.kind} | ${i.label}`))
      .toMatchInlineSnapshot(`
        [
          "cc | Fear → Owner(4.0s)",
          "enemy-cd | Enemy Icy Veins(Emage)",
          "defensive | Pain Suppression(Owner)",
          "hp | Warr HP 42%",
          "dispel | Purify removed Polymorph",
          "position | Positioning: stayed in under pressure",
          "hp | Warr HP 42%",
          "position | Positioning: drifted out of range",
          "position | Positioning: Avenging Wrath out of range",
          "position | Positioning: cooldown out of range",
          "hp | Warr HP 42%",
          "immunity-available | Divine Shield ready, not pressed(Warr)",
          "external-available | Blessing of Sacrifice ready, not given(Owner→Warr)",
        ]
      `);
  });

  it("显式传 zh 与默认逐字节相同", () => {
    const dflt = buildDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
    )!;
    const zh = buildDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
      undefined,
      "zh",
    )!;
    expect(zh).toEqual(dflt);
    const wZh = buildWindowPack(
      mkCombat(),
      70,
      105,
      candidates,
      "Owner-Area52",
      "zh",
    )!;
    expect(wZh).toEqual(
      buildWindowPack(mkCombat(), 70, 105, candidates, "Owner-Area52")!,
    );
    expect(
      buildWindowAnchorFinding(everyKindPack, 36.7, 59.2, "survival", "zh"),
    ).toEqual(buildWindowAnchorFinding(everyKindPack, 36.7, 59.2, "survival"));
  });

  it("buildWindowPack 把 en 传到 label", () => {
    const r = buildWindowPack(
      mkCombat(),
      70,
      105,
      candidates,
      "Owner-Area52",
      "en",
    )!;
    expect(r.kind).toBe("survival");
    expect(r.pack.items.filter((i) => CJK_LEAK.test(i.label))).toEqual([]);
  });

  it("buildOffensiveDeepDivePack 接受 lang(label 本来就不带语言词)", () => {
    const zh = buildOffensiveDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
      { fromS: 70, toS: 105 },
    );
    const en = buildOffensiveDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
      { fromS: 70, toS: 105 },
      "en",
    );
    expect(en).toEqual(zh);
  });

  it("en 锚点:20 类 kind 都有英文词,不含中文", () => {
    const f = buildWindowAnchorFinding(
      everyKindPack,
      36.7,
      59.2,
      "survival",
      "en",
    );
    expect(CJK_LEAK.test(f.title + f.explanation)).toBe(false);
    expect(f).toMatchInlineSnapshot(`
      {
        "category": "window",
        "eventIds": [],
        "explanation": "The user selected this window manually. Evidence in the window: CC taken×1, defensive cast×1, enemy offensive CD×1, HP trajectory×1, dispel×1, external available×1, immunity available×1, positioning×1, target HP×1, enemy defensive×1, enemy immunity×1, our CC×1, our offensive CD×1, cooldown ledger×1, aura snapshot×1, position snapshot×1, DR level×1, healing gap×1, activity gap×1, HP snapshot×1.",
        "severity": "low",
        "title": "User-selected window 0:36–0:59",
      }
    `);
  });

  it("PACK_ITEM_KIND_EN 与 PACK_ITEM_KIND_ZH 同键、无中文、无 slug 原样", () => {
    expect(Object.keys(PACK_ITEM_KIND_EN).sort()).toEqual(
      Object.keys(PACK_ITEM_KIND_ZH).sort(),
    );
    expect(Object.keys(PACK_ITEM_KIND_EN).sort()).toEqual(
      [...ALL_KINDS].sort(),
    );
    for (const v of Object.values(PACK_ITEM_KIND_EN))
      expect(CJK_LEAK.test(v)).toBe(false);
  });

  it("en 选段 prompt:只有 SELECTED WINDOW 行变,其余逐行同 zh", () => {
    const p = buildDeepDivePack(
      mkCombat(),
      finding,
      0,
      candidates,
      "Owner-Area52",
    )!;
    const prompt = (lang: "zh" | "en") =>
      buildDeepDivePrompt(
        [p],
        [buildWindowAnchorFinding(p, 70, 105, "survival", lang)],
        "Discipline Priest",
        "Owner-Area52",
        "window",
      ).split("\n");
    const zh = prompt("zh");
    const en = prompt("en");
    expect(en.length).toBe(zh.length);
    const changed = en
      .map((l, i) => (l === zh[i] ? null : i))
      .filter((i) => i !== null);
    expect(changed).toEqual([2]);
    expect(en.filter((l) => CJK_LEAK.test(l))).toEqual(
      zh.filter((l, i) => i !== 2 && CJK_LEAK.test(l)),
    );
    expect(en[2]).toMatchInlineSnapshot(
      `"SELECTED WINDOW 0: User-selected window 1:10–1:45 — The user selected this window manually. Evidence in the window: CC taken×1, enemy offensive CD×1, defensive cast×1, HP trajectory×3, dispel×1, positioning×4, immunity available×1, external available×1."`,
    );
  });
});

describe("selfCastNoopAnnotatedName 语言", () => {
  const bos = { spellId: "6940", spellName: "Blessing of Sacrifice" };
  it("zh 默认不变;en 后缀英文", () => {
    expect(selfCastNoopAnnotatedName(bos)).toBe(
      "Blessing of Sacrifice(仅可施于队友,不可自保)",
    );
    expect(selfCastNoopAnnotatedName(bos, "zh")).toBe(
      selfCastNoopAnnotatedName(bos),
    );
    expect(selfCastNoopAnnotatedName(bos, "en")).toBe(
      "Blessing of Sacrifice (ally-only, cannot self-cast)",
    );
    expect(
      selfCastNoopAnnotatedName({ spellId: "1", spellName: "X" }, "en"),
    ).toBe("X");
  });
});
