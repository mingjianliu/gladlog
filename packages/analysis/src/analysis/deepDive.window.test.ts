import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  auditDeepDives,
  type AuditDropInfo,
  buildDeepDivePack,
  buildDeepDivePrompt,
  buildWindowAnchorFinding,
  buildWindowPack,
  type DeepDivePack,
} from "./deepDive";
import type { CandidateEvent, Finding } from "./types";

// Copies the mkUnit/combat/candidates/finding style of the "death-anchored
// available-but-unused facts enter the pack" describe block in deepDive.test.ts
// (~703-758): anchor 100s / match 105s → window [70,105] (PACK_BEFORE_S=30,
// clamped to durS 105), and the available-but-unused judgement does not depend
// on finding.eventIds (it consumes the friends' deathRecords directly) — used
// to verify a pack can still be built when the override bypasses empty
// eventIds.
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
  reaction: friendly ? CombatUnitReaction.Friendly : CombatUnitReaction.Hostile,
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

describe("windowOverride 等价性", () => {
  // Scope of the equivalence (an all-branch review finding): this only proves
  // "for the same window bounds, the finding-anchored path and the override
  // path produce item-for-item identical packs"; it does not cover items
  // derived from focusT — the override path deliberately takes the window
  // midpoint as focusT (a user-selected window has no death anchor to use),
  // which is a different thing from the finding path's death-instant anchor;
  // the two paths only coincide because this fixture happens to fall inside
  // the same window [70,105]. This fixture also has no advancedActions and so
  // produces no hp items — once the fixture is fleshed out (adding HP
  // samples), the focusT divergence will surface, and this test will no longer
  // be a complete "item-for-item identical" invariant; the scope of the
  // assertions will need revisiting then.
  it("同一窗口:finding 锚点包与 override 包逐项相同", () => {
    const viaFinding = buildDeepDivePack(
      combat,
      finding,
      0,
      candidates,
      "Owner-Area52",
    );
    // finding anchor 100 → window [70, 105] (PACK_BEFORE_S=30, clamped to durS 105)
    const viaOverride = buildDeepDivePack(
      combat,
      finding,
      0,
      candidates,
      "Owner-Area52",
      { fromS: 70, toS: 105 },
    );
    expect(viaOverride).not.toBeNull();
    expect(viaOverride!.items).toEqual(viaFinding!.items);
    expect(viaOverride!.facts).toEqual(viaFinding!.facts);
    expect(viaOverride!.anchorFrom).toBe(70);
    expect(viaOverride!.anchorTo).toBe(105);
  });

  it("override 时不依赖 finding.eventIds(合成空锚点也能构包)", () => {
    const synth = {
      eventIds: [],
      severity: "low",
      category: "window",
      title: "",
      explanation: "",
    } as Finding;
    const p = buildDeepDivePack(combat, synth, 0, [], "Owner-Area52", {
      fromS: 70,
      toS: 105,
    });
    expect(p).not.toBeNull(); // Old behavior: empty eventIds → null; the override must bypass that
  });

  it("窗口越界被夹:fromS<0 → 0,toS>durS → durS", () => {
    const p = buildDeepDivePack(
      combat,
      finding,
      0,
      candidates,
      "Owner-Area52",
      { fromS: -5, toS: 999 },
    );
    expect(p!.anchorFrom).toBe(0);
    expect(p!.anchorTo).toBe(105);
  });
});

describe("buildWindowPack 信号门分级", () => {
  // An ICombatUnit stub with every field named correctly (unlike mkUnit above,
  // whose field names are deliberately misaligned with the real interface and
  // only support the HP/death paths; here analyzePlayerCCAndTrinket must
  // actually run, so we must use the field names it really reads:
  // auraEvents/spellCastEvents/damageIn etc.).
  const mkFullUnit = (
    id: string,
    name: string,
    friendly: boolean,
    spec: string,
    auraEvents: unknown[] = [],
  ) => ({
    id,
    name,
    info: { specId: spec },
    spec,
    class: 0,
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
    spellCastEvents: [],
    castStartEvents: [],
    petSpellCastEvents: [],
    auraEvents,
    actionIn: [],
    actionOut: [],
    deathRecords: [],
  });

  const auraEvent = (
    event: LogEvent,
    timestamp: number,
  ): Record<string, unknown> => ({
    logLine: { event, timestamp, parameters: [] },
    timestamp,
    spellId: "5782", // Fear — in ccSpellIds
    spellName: "Fear",
    srcUnitId: "e",
    srcUnitName: "Warr-Area52",
    destUnitId: "o",
    destUnitName: "Owner-Area52",
    effectiveAmount: 0,
    advancedActorMaxHp: 0,
    advancedActorCurrentHp: 0,
  });

  // The owner takes one 4s Fear (≥3s hard CC) with no trinket cast on record →
  // trinketState resolves to available_unused (the predicate of
  // hasCoachableSignal's cc branch). It lands at 80s, inside window [70,105].
  const ccCombat = {
    startTime: 0,
    endTime: 105_000,
    startInfo: { zoneId: "1672" },
    units: {
      o: mkFullUnit(
        "o",
        "Owner-Area52",
        true,
        CombatUnitSpec.Priest_Discipline,
        [
          auraEvent(LogEvent.SPELL_AURA_APPLIED, 80_000),
          auraEvent(LogEvent.SPELL_AURA_REMOVED, 84_000),
        ],
      ),
      e: mkFullUnit("e", "Warr-Area52", false, CombatUnitSpec.Warrior_Arms),
    },
  };

  it("生存信号过门 → kind=survival", () => {
    const r = buildWindowPack(ccCombat, 70, 105, [], "Owner-Area52");
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("survival");
  });

  it("全不过门 → null(调用方走无信号文案)", () => {
    const r = buildWindowPack(combat, 0, 10, [], "Owner-Area52"); // empty window
    expect(r).toBeNull();
  });

  // fix round 1 (found in review): if buildWindowPack synthesizes empty
  // eventIds, then the HP section's `focus` (which looks up
  // candidate.unitNames by eventIds) and the offensive section's `cands`
  // (which takes candidate-specific facts by eventIds) are always empty — so
  // kind=hp / off-target / dr-clip items can never be produced, and the
  // offensive gate's off-target/dr-clip branches are dead ends. The fix:
  // buildWindowPack now takes the real candidates and the synthesized finding
  // references every candidate id inside the window (rather than an empty
  // array), so focus/cands go through the existing derivation logic — zero
  // special-casing inside the collectors.
  it("含窗口内 death 类 candidate(带 unitNames)→ 包含 kind=hp 条目", () => {
    const combatWithHp = {
      ...ccCombat,
      units: {
        ...ccCombat.units,
        o: {
          ...ccCombat.units.o,
          // One HP sample per second (HP% = 100 - seconds), for the HP
          // checkpoints used once focus matches.
          advancedActions: Array.from({ length: 106 }, (_, s) => ({
            logLine: { timestamp: s * 1000 },
            advancedActorId: "o",
            advancedActorCurrentHp: 100 - s,
            advancedActorMaxHp: 100,
          })),
        },
      },
    };
    const hpCandidates = [
      {
        id: "death:o:100",
        type: "death-setup",
        t: 100,
        unitNames: ["Owner-Area52"],
        facts: { t: "100" },
      },
    ] as unknown as CandidateEvent[];
    const r = buildWindowPack(
      combatWithHp,
      70,
      105,
      hpCandidates,
      "Owner-Area52",
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("survival"); // still passes the gate via ccCombat's own Fear signal
    expect(r!.pack.items.some((i) => i.kind === "hp")).toBe(true);
  });

  // dr-clipped-cc / off-target-in-window are deleted candidate types; their
  // offensive pack items (dr-clip / off-target) were removed 2026-09-24, so a
  // stray candidate of that type no longer opens the offensive gate.
  it("窗口内只有已删除类型 dr-clipped-cc 的 candidate → 无进攻信号,返回 null", () => {
    const mkOffUnit = (id: string, name: string, friendly: boolean) => ({
      id,
      name,
      info: { specId: "0" },
      spec: "0",
      class: 0,
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
      spellCastEvents: [],
      castStartEvents: [],
      petSpellCastEvents: [],
      auraEvents: [],
      actionIn: [],
      actionOut: [],
      deathRecords: [],
    });
    const drCombat = {
      startTime: 0,
      endTime: 105_000,
      units: {
        o: mkOffUnit("o", "Owner-Area52", true),
        e: mkOffUnit("e", "Warr-Area52", false),
      },
    };
    const drCandidates = [
      {
        id: "dr:1",
        type: "dr-clipped-cc",
        t: 80,
        unitNames: [],
        facts: {
          t: "80",
          spell: "Cheap Shot",
          target: "Warr-Area52",
          dr: "50%",
        },
      },
    ] as unknown as CandidateEvent[];
    const r = buildWindowPack(drCombat, 70, 105, drCandidates, "Owner-Area52");
    expect(r).toBeNull();
  });
});

describe("buildWindowAnchorFinding 中性锚点", () => {
  const somePack: DeepDivePack = {
    findingIndex: 0,
    anchorFrom: 36.7,
    anchorTo: 59.2,
    items: [
      {
        key: "p1",
        kind: "cc",
        t: 40,
        label: "Fear → Owner(4.0s)",
        unitNames: ["Owner-Area52"],
        facts: {
          t: "40",
          spell: "Fear",
          duration: "4.0",
          trinket: "available_unused",
        },
      },
    ],
    facts: {
      "p1.t": "40",
      "p1.spell": "Fear",
      "p1.duration": "4.0",
      "p1.trinket": "available_unused",
    },
  };

  it("时间 floor 到渲染秒;无问题措辞;含 kind 计数摘要", () => {
    const f = buildWindowAnchorFinding(somePack, 36.7, 59.2, "survival");
    expect(f.title).toBe("用户选段 0:36–0:59");
    expect(f.explanation).not.toMatch(/问题|失误|错误|mistake|wrong/i);
    expect(f.eventIds).toEqual([]);
    expect(f.severity).toBe("low");
  });
});

describe("buildDeepDivePrompt window 模式", () => {
  // Copies the pack/findings style from the top of deepDive.test.ts
  // (findingIndex 0, anchorFrom/anchorTo 100/150), shared by
  // buildWindowAnchorFinding and the two mode-fork tests.
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
    ],
    facts: {
      "p1.t": "128",
      "p1.spell": "Fear",
      "p1.duration": "4.0",
      "p1.trinket": "on_cooldown",
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
  const windowFinding = buildWindowAnchorFinding(pack, 100, 150, "survival");

  it("含选段契约:不预设有问题 + 空数组合法", () => {
    const p = buildDeepDivePrompt(
      [pack],
      [windowFinding],
      "Holy Paladin",
      "Owner-Area52",
      "window",
    );
    expect(p).toContain("manually selected");
    expect(p).toContain("Do NOT assume something went wrong");
    expect(p).toContain("output an empty array");
    expect(p).not.toContain("deepening findings"); // the follow-up framing copy must not appear
    expect(p).toContain("SELECTED WINDOW"); // renamed section header
    // Hard rules and the output contract are preserved (audit-compatibility anchors)
    // v19 (2026-08-06 agy attribution): window mode's findingIndex is pinned to
    // 0 in the contract line, not left as a bare `number` type — see
    // buildDeepDivePrompt's window-only output line and promptVersion.ts's v19.
    expect(p).toContain('"findingIndex": 0');
    expect(p).toContain("Write NO digits");
    // PROMPT_VERSION 17 (retest-prep 2026-08-05): the two format hard rules
    // apply in window mode too, not just the default "deepen" mode.
    expect(p).toContain("Never write a pack key");
    expect(p).toContain("「」 for quotation marks");
  });

  it("缺省 mode 行为不变(回归锚)", () => {
    const p = buildDeepDivePrompt(
      [pack],
      findings,
      "Holy Paladin",
      "Owner-Area52",
    );
    expect(p).toContain("deepening findings");
    expect(p).toContain("FINDING 0:");
  });

  // SDD 2026-08-05 window-multi-finding, Task 1: window mode's output
  // contract widens to 1-4 entries with a `title` field, plus one new HARD
  // RULE gating that width — both gated on mode so the deepen contract line
  // (pinned above) stays byte-identical.
  it("(f) window 模式含新契约行与新 HARD RULE;deepen 模式不含", () => {
    const windowPrompt = buildDeepDivePrompt(
      [pack],
      [windowFinding],
      "Holy Paladin",
      "Owner-Area52",
      "window",
    );
    const deepenPrompt = buildDeepDivePrompt(
      [pack],
      findings,
      "Holy Paladin",
      "Owner-Area52",
      "deepen",
    );
    // v19 (2026-08-06 agy attribution): findingIndex is pinned to 0 (was
    // `number`) — window mode only ever builds one pack, so the field is
    // pure noise for the model to invent; agy's window-mode output ALWAYS
    // wrote a wrong index and lost every entry to unknown-finding-index.
    const newContractLine =
      'Output ONLY a JSON array (1-4 entries; [] if nothing is defensible; findingIndex is always 0 — this mode has only one evidence pack): [{ "findingIndex": 0, "title": string, "deepDive": string, "citedKeys": string[] }]';
    const newHardRule =
      "Each entry must focus on ONE unit or ONE decision; fewer, better-grounded entries beat padding; title ≤20 chars, no digits.";
    const oldContractLine =
      'Output ONLY a JSON array: [{ "findingIndex": number, "deepDive": string, "citedKeys": string[] }]';

    expect(windowPrompt).toContain(newContractLine);
    expect(windowPrompt).toContain(newHardRule);
    expect(windowPrompt).not.toContain(oldContractLine);

    expect(deepenPrompt).toContain(oldContractLine);
    expect(deepenPrompt).not.toContain(newContractLine);
    expect(deepenPrompt).not.toContain(newHardRule);
  });
});

// SDD 2026-08-05 window-multi-finding, Task 1: window mode now allows 1-4
// independent DeepDiveResult entries per findingIndex (each audited end to
// end on its own merit — one entry's bare-number failure never costs
// another entry its slot), plus a new `title` output surface that gets the
// same zero-digit discipline as the deepDive prose. deepen mode is the
// pre-Task-1 default and must stay byte-identical: (e) below pins its
// (previously untested) same-findingIndex behavior as "first entry that
// passes wins" rather than changing it.
// Shared by both this describe block and the onDrop diagnostics block below
// (2026-08-05): same two-item pack, no need for two copies.
const multiPack: DeepDivePack = {
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

describe("auditDeepDives — window 模式多条化(Task 1)", () => {
  it("(a) 同 index 3 条全过审计 → 3 条 DeepDiveResult,title 透传", () => {
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          title: "止损时机",
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
          citedKeys: ["p1"],
        },
        {
          findingIndex: 0,
          title: "补位提醒",
          deepDive:
            "At {{p2.t}}s {{p2.player}} used {{p2.spell}}; swap the kill target before it lands.",
          citedKeys: ["p2"],
        },
        {
          findingIndex: 0,
          title: "留手判断",
          deepDive:
            "Holding {{p2.spell}} back would have kept pressure on; watch for the swap around {{p2.t}}s.",
          citedKeys: ["p2"],
        },
      ],
      [multiPack],
      { mode: "window" },
    );
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.title)).toEqual([
      "止损时机",
      "补位提醒",
      "留手判断",
    ]);
    expect(out.every((o) => o.findingIndex === 0)).toBe(true);
  });

  it("(b) 3 条中 1 条裸数字 → 只丢那条,其他 2 条存活", () => {
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          title: "止损时机",
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
          citedKeys: ["p1"],
        },
        {
          findingIndex: 0,
          title: "裸数字条",
          // bare "4" outside any {{p1.field}} placeholder — mirrors the
          // strict layer's existing "healer took 4 seconds of Fear" case
          // (see deepDive.test.ts's auditDeepDives describe block).
          deepDive: "At {{p1.t}}s the healer took 4 seconds of Fear.",
          citedKeys: ["p1"],
        },
        {
          findingIndex: 0,
          title: "补位提醒",
          deepDive:
            "At {{p2.t}}s {{p2.player}} used {{p2.spell}}; swap the kill target before it lands.",
          citedKeys: ["p2"],
        },
      ],
      [multiPack],
      { mode: "window" },
    );
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.title)).toEqual(["止损时机", "补位提醒"]);
  });

  it("(c) 5 条全合规 → 第 5 条被丢弃,只留前 4 条", () => {
    const titles = ["条一", "条二", "条三", "条四", "条五"];
    const entries = titles.map((title, i) => ({
      findingIndex: 0,
      title,
      // Distinct prose per entry (varying the connective wording) so a
      // dedup-by-text bug would not accidentally make this pass.
      deepDive: `At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds (entry ${"x".repeat(i)}); hold a stop for that window.`,
      citedKeys: ["p1"],
    }));
    const out = auditDeepDives(entries, [multiPack], { mode: "window" });
    expect(out).toHaveLength(4);
    expect(out.map((o) => o.title)).toEqual(["条一", "条二", "条三", "条四"]);
  });

  it("(d) title 含数字 → 该条整条丢(即便 deepDive 正文干净)", () => {
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          title: "决策2号",
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { mode: "window" },
    );
    expect(out).toHaveLength(0);
  });

  it("(e) deepen 模式(默认)同 index 2 条 → 仅首条保留(现状语义钉住)", () => {
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
          citedKeys: ["p1"],
        },
        {
          findingIndex: 0,
          deepDive:
            "At {{p2.t}}s {{p2.player}} used {{p2.spell}}; swap the kill target before it lands.",
          citedKeys: ["p2"],
        },
      ],
      [multiPack],
      // opts omitted entirely (as every existing deepen call site does) —
      // this is the pre-Task-1 2-arg call shape, must not change behavior.
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain("your healer ate Fear");
    expect(out[0]!.title).toBeUndefined();
  });
});

describe("auditDeepDives — onDrop 逐条 drop-reason 诊断(2026-08-05)", () => {
  // (f) was rewritten 2026-08-06 (agy 27/27-dropped attribution): `[multiPack]`
  // is a single-element PACKS array (packs.length === 1) — under the new
  // single-pack remap this findingIndex=7 entry is no longer ambiguous, it
  // remaps to the one pack's index and survives. The "still drops on an
  // unrecognized index" behavior now requires >1 pack — see (f2) below.
  it("(f) 单 pack 下未知 findingIndex → 重映射存活,不触发 onDrop", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [{ findingIndex: 7, deepDive: "x", citedKeys: ["p1"] }],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.findingIndex).toBe(0); // remapped to multiPack's own findingIndex
    expect(drops).toHaveLength(0); // remap is not a drop
  });

  // (f2): with >1 pack (deepen's automatic follow-up round, one pack per
  // finding) an unrecognized index is genuinely ambiguous — still dropped.
  it("(f2) 多 pack 下未知 findingIndex 仍丢弃(有歧义不猜)", () => {
    const secondPack: DeepDivePack = { ...multiPack, findingIndex: 1 };
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [{ findingIndex: 7, deepDive: "x", citedKeys: ["p1"] }],
      [multiPack, secondPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("unknown-finding-index");
    expect(drops[0]!.findingIndex).toBe(7);
  });

  it("(g) deepDive 非字符串 → reason=invalid-shape", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive: 123 as unknown as string,
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("invalid-shape");
    expect(drops[0]!.findingIndex).toBe(0);
  });

  it("(h) 占位符 / citedKeys 指向非法 key → reason=placeholder-key(两个来源都覆盖)", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive: "At {{p9.t}}s something happened.",
          citedKeys: ["p1"],
        },
        {
          findingIndex: 0,
          deepDive: "Fine text with {{p1.t}}s.",
          citedKeys: ["nope"],
        },
      ],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(2);
    expect(drops.every((d) => d.reason === "placeholder-key")).toBe(true);
  });

  it("(i) claimChecker 拒绝(裸百分比)→ reason=claim-check", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive: "Your healer was CC'd 85% of the window.",
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("claim-check");
    expect(drops[0]!.detail).toContain("percentage");
  });

  it("(j) 占位符外裸数字 → reason=bare-digit", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive: "At {{p1.t}}s the healer took 4 seconds of Fear.",
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("bare-digit");
  });

  it("(k) window 模式 title 含数字 → reason=bare-digit-title", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          title: "决策2号",
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { mode: "window", onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("bare-digit-title");
  });

  it("(l) 因果断言 → reason=causal-lint", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive: "The Fear at {{p1.t}}s caused your death.",
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("causal-lint");
  });

  it("(m) deepen 模式同 index 第二条超上限 → reason=per-index-cap", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
          citedKeys: ["p1"],
        },
        {
          findingIndex: 0,
          deepDive:
            "At {{p2.t}}s {{p2.player}} used {{p2.spell}}; swap the kill target before it lands.",
          citedKeys: ["p2"],
        },
      ],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(1);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("per-index-cap");
  });

  it("(n) 全过审计 → onDrop 从不触发", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 0,
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(1);
    expect(drops).toHaveLength(0);
  });
});

// 2026-08-06 agy 27/27-dropped attribution: agy (N=20) read the window
// prompt's "1-4 entries" instruction as "number each entry" and wrote
// findingIndex 1, 2, 3… for a mode that only ever builds ONE pack (findingIndex
// 0) — every single one of its 27 window-mode deep dives died to
// unknown-finding-index. The fix widens ONLY the index match when there is
// exactly one pack (see auditDeepDives' own doc comment); these tests prove
// that widening is the only thing that changed — every other gate still
// fires exactly as before on a remapped entry.
describe("auditDeepDives — 单 pack findingIndex 重映射(2026-08-06 agy 27/27 归因修复)", () => {
  it.each([1, 2, 999])(
    "单 pack + findingIndex=%i(占位符合法)→ 重映射存活,findingIndex 落到唯一 pack 的真实索引",
    (idx) => {
      const out = auditDeepDives(
        [
          {
            findingIndex: idx,
            deepDive:
              "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
            citedKeys: ["p1"],
          },
        ],
        [multiPack],
      );
      expect(out).toHaveLength(1);
      expect(out[0]!.findingIndex).toBe(multiPack.findingIndex);
    },
  );

  it("单 pack + 野生 findingIndex,但正文违反 claimChecker(裸百分比)→ 仍死于 claim-check(只宽容了 index,没跳过别的门)", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 42,
          deepDive: "Your healer was CC'd 85% of the window.",
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("claim-check");
  });

  it("单 pack + 野生 findingIndex,window 模式 title 含数字 → 仍死于 bare-digit-title", () => {
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [
        {
          findingIndex: 3,
          title: "决策2号",
          deepDive:
            "At {{p1.t}}s your healer ate {{p1.spell}} for {{p1.duration}} seconds with trinket {{p1.trinket}}; hold a stop for that window.",
          citedKeys: ["p1"],
        },
      ],
      [multiPack],
      { mode: "window", onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("bare-digit-title");
  });

  // Multi-pack control: an unrecognized index is genuinely ambiguous once
  // there is more than one candidate pack, so it still drops — this mirrors
  // (f2) above but under mode "deepen" explicitly (the production shape of
  // the automatic follow-up round, one pack per finding).
  it("多 pack(mode deepen)+ 未知 index → 仍 unknown-finding-index 丢弃", () => {
    const secondPack: DeepDivePack = { ...multiPack, findingIndex: 1 };
    const drops: AuditDropInfo[] = [];
    const out = auditDeepDives(
      [{ findingIndex: 999, deepDive: "x", citedKeys: ["p1"] }],
      [multiPack, secondPack],
      { mode: "deepen", onDrop: (d) => drops.push(d) },
    );
    expect(out).toHaveLength(0);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.reason).toBe("unknown-finding-index");
    expect(drops[0]!.findingIndex).toBe(999);
  });
});
