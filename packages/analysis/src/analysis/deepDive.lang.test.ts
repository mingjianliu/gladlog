// UI-language spec §6.5 / §7: the deep-dive pack labels (chips) and the
// selected-window anchor (sent to the model) follow the UI language, while the
// zh output stays byte-for-byte what it was. Every whole-round reading the
// pack consumes is mocked so that one pack carries every label kind
// (vi.mock: this file runs isolated, not in vitest.shared.json).
import { createHash } from "node:crypto";

import { CombatUnitReaction, CombatUnitSpec } from "@gladlog/parser-compat";
import { describe, expect, it, vi } from "vitest";

import {
  buildDeepDivePack,
  buildDeepDivePrompt,
  buildWindowAnchorFinding,
  buildWindowPack,
  type DeepDivePack,
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
