import { describe, expect, it } from "vitest";

import { CANDIDATE_TYPE_FLAGS } from "../data/candidateTypeFlags";
import {
  LATE_WINDOW_SECONDS,
  PRE_WALL_SECONDS,
  TIMING_DAMAGE_WINDOW_S,
  TIMING_SPIKE_THRESHOLD,
  UNNECESSARY_TARGET_HP_PCT,
} from "../utils/cooldowns";
import { DR_CHAIN_LOOKAHEAD_S } from "../utils/dispelAnalysis";
import { buildFindingsPrompt } from "./buildFindingsPrompt";
import { LEGACY_TOPIC_TYPES } from "./candidateFindings";
import { FINDING_CATEGORIES } from "./findingCategories";
import type { CandidateEvent } from "./types";

const candidates: CandidateEvent[] = [
  {
    id: "death:a:30",
    type: "death",
    t: 30,
    unitNames: ["Me-R"],
    facts: { t: "30", unit: "Me-R" },
  },
];

describe("buildFindingsPrompt", () => {
  it("lists the event menu with IDs, forbids invented events + causal claims, and demands JSON", () => {
    const p = buildFindingsPrompt(
      candidates,
      "RICH CONTEXT HERE",
      "Discipline Priest",
    );
    expect(p).toMatch(/death:a:30/); // the event id is offered
    expect(p).toMatch(/RICH CONTEXT HERE/); // holistic context included
    expect(p).toMatch(/JSON/i);
    expect(p).toMatch(/placeholder|\{\{/); // numbers via placeholders
    // GH #70: observable consequences are allowed; outcome attribution,
    // certain counterfactuals and unshown states stay banned
    expect(p).toMatch(/NEVER pin a death, loss or win on one event/);
    expect(p).toMatch(/NEVER claim what would certainly have happened/);
    expect(p).toMatch(/NEVER infer a state the context does not show/);
    expect(p).toMatch(/Discipline Priest/);
    expect(p).toMatch(/no digits|words|discarded/i); // strict no-raw-digit guidance
  });

  it("death-kill F-D1: the death legend prints only with a death on the menu, and names friendly deaths only", () => {
    const withDeath = buildFindingsPrompt(candidates, "", "Discipline Priest");
    expect(withDeath).toContain(
      // FT-T15 M4: facts.unit, which every death row carries, is named
      `- "death": one of YOUR team's players died (facts.unit names them; facts.side=friendly); enemy deaths are timeline context only.`,
    );
    expect(withDeath).not.toContain("facts.side=enemy");
    const noDeath = buildFindingsPrompt(
      [{ ...candidates[0]!, id: "cd-waste:x", type: "cd-waste" }],
      "",
      "Discipline Priest",
    );
    expect(noDeath).not.toContain(`- "death":`);
  });

  it("category 收敛为枚举(与 FINDING_CATEGORIES 单源渲染)", () => {
    const p = buildFindingsPrompt(candidates, "", "Discipline Priest");
    for (const c of FINDING_CATEGORIES) expect(p).toContain(`"${c}"`);
    // No longer a free-form string; and the "independent of the reply language"
    // discipline is stated explicitly
    expect(p).not.toMatch(/"category": string/);
    expect(p).toMatch(/regardless of the reply language/);
  });

  it("missed-cleanse:owner 派系能力门守护注出现在 legend(2026-08-05,37/200 场审计)", () => {
    const withMissedCleanse: CandidateEvent[] = [
      ...candidates,
      {
        id: "missed-cleanse:Ally:30",
        type: "missed-cleanse",
        t: 30,
        unitNames: ["Ally"],
        facts: {
          t: "30",
          target: "Ally",
          cc: "Curse of Tongues",
          duration: "5.0",
          priority: "Critical",
          postCcDamageK: "50",
          drChainRisk: "no",
          dispelType: "Curse",
          ownerCanDispel: "no",
          eligibleDispellers: "Arcane Mage",
        },
      },
    ];
    const p = buildFindingsPrompt(withMissedCleanse, "", "Holy Paladin");
    // The guard note is legend-level text (present whenever the menu has a
    // missed-cleanse event), steering the model toward a call-out suggestion
    // instead of "you should have dispelled it" for a debuff type the
    // owner's own class cannot remove.
    expect(p).toMatch(/ownerCanDispel/);
    expect(p).toMatch(/eligibleDispellers/);
    // F-C7 (triage 2026-09-29): the owner has no dispel SPELL for the type —
    // not "the class CANNOT remove it" (a rogue's Cloak of Shadows can).
    expect(p).toMatch(/has no dispel spell for this debuff type/);
    expect(p).not.toMatch(/CANNOT remove this debuff type/);
    // F-C15: a curse is not a CC
    expect(p).toMatch(/high-value enemy debuff \(a CC, root or curse/);
    expect(p).not.toMatch(/high-value enemy CC/);
    expect(p).toMatch(/call-out|call for a dispel/);
  });

  describe("挑选层多样性指令(2026-08-11 定为旧四族合计上限 2,2026-08-15 约束审计 C1 放宽为 3;2026-08-19 GH #14 cc-locked 与 wasted-trinket 先后退役后缩为二族)", () => {
    it("prompt 含合计最多 3 条的指令行,并逐一列出 LEGACY_TOPIC_TYPES 的两个类型名", () => {
      const p = buildFindingsPrompt(candidates, "", "Discipline Priest");
      // The instruction sentence itself (wording, not just the type names).
      expect(p).toMatch(/at most 3 findings TOTAL/);
      expect(p).toMatch(/Prioritize covering DIFFERENT event types/);
      // Every legacy type name must be enumerated -- sourced from the shared
      // set, not a hand-copied second list (CLAUDE.md shared-predicate rule).
      for (const t of LEGACY_TOPIC_TYPES) {
        expect(p).toContain(`"${t}"`);
      }
    });

    it("防漂移:LEGACY_TOPIC_TYPES 恰好是两个类型,不多不少", () => {
      // If a third type were folded in (or one dropped) without updating this
      // test, the prompt sentence and the audit-layer cap would silently
      // drift apart from what this suite actually exercises.
      // (cc-locked and wasted-trinket both left the set 2026-08-19 with
      // their GH #14 retirements.)
      expect([...LEGACY_TOPIC_TYPES].sort()).toEqual(
        ["missed-cleanse", "missed-purge"].sort(),
      );
    });
  });

  describe("cost_norm 守护注(#25,2026-08-14):facts.costNorm 字段说明", () => {
    // FT-T15 M5 (2026-10-10): the cd-waste legend follows the convention of
    // every other per-type legend — printed only with a cd-waste row on the
    // menu (it used to print on every prompt).
    it("cd-waste 图例(菜单有 cd-waste 行时渲染)已解释 costNorm 语义", () => {
      const p = buildFindingsPrompt(
        [
          ...candidates,
          {
            id: "cd-waste:p1:642",
            type: "cd-waste",
            t: 0,
            unitNames: ["Me-R"],
            spell: "Divine Shield",
            facts: { spell: "Divine Shield", unit: "Me-R" },
          },
        ],
        "",
        "Holy Paladin",
      );
      expect(p).toMatch(/facts\.costNorm/);
      expect(p).toMatch(/last-resort|emergency/);
      expect(p).toContain(`- "cd-waste": `);
    });

    it("菜单里没有 cd-waste 行 → cd-waste 图例与 costNorm 说明都不渲染", () => {
      const p = buildFindingsPrompt(candidates, "", "Holy Paladin");
      expect(p).not.toContain(`- "cd-waste":`);
      expect(p).not.toMatch(/facts\.costNorm/);
    });
  });

  describe("意图守护注(BACKLOG #26 Task 2,2026-08-15):facts.attempted 字段说明", () => {
    it("cd-hoarded 携带 attempted 事实时,图例出现意图守护措辞(不得读作屯而不用)", () => {
      const withAttempted: CandidateEvent[] = [
        ...candidates,
        {
          id: "cd-hoarded:p1:100",
          type: "cd-hoarded",
          t: 100,
          unitNames: ["Me-R"],
          facts: {
            t: "100",
            readyCds: "Astral Shift",
            attempted: "pressed but rejected (尚未恢复×3)",
          },
        },
      ];
      const p = buildFindingsPrompt(withAttempted, "", "Holy Paladin");
      expect(p).toMatch(/facts\.attempted/);
      expect(p).toMatch(/never phrase this as hoarding/);
    });

    // triage 2026-09-29 F-S1 (codex review): the line's spell is the ENEMY's
    // opener, so the note must point at the owner's own defensives
    it("slow-defensive-response's note names the player's own ally defensives, not 'this ability'", () => {
      const p = buildFindingsPrompt(
        [
          ...candidates,
          {
            id: "slow-defensive-response:p1:156",
            type: "slow-defensive-response",
            t: 156,
            unitNames: ["Me-R"],
            spell: "Summon Darkglare",
            facts: {
              t: "2:36",
              leadCd: "Summon Darkglare",
              attempted: "pressed but rejected (无法在昏迷时那样做×2)",
            },
          },
        ],
        "",
        "Holy Paladin",
      );
      const legend = p
        .split("\n")
        .find((l) => l.startsWith('- "slow-defensive-response":'))!;
      expect(legend).toMatch(
        /one of their own ally-reaching defensive cooldowns/,
      );
      expect(legend).not.toMatch(/DID try to press this ability/);
    });
  });

  describe("信号扩容批 1 图例(2026-08-06,healing-gap/position-mistake/cc-held)", () => {
    it("三个新类型的图例仅在菜单出现对应类型时才渲染(D2 惯例:无该类型时 prompt 字节不变)", () => {
      const withoutNewTypes = buildFindingsPrompt(
        candidates,
        "",
        "Holy Paladin",
      );
      expect(withoutNewTypes).not.toMatch(/healing-gap/);
      expect(withoutNewTypes).not.toMatch(/position-mistake/);
      expect(withoutNewTypes).not.toMatch(/cc-held/);
    });

    it("healing-gap 图例覆盖 facts 字段", () => {
      const p = buildFindingsPrompt(
        [
          ...candidates,
          {
            id: "healing-gap:h:30",
            type: "healing-gap",
            t: 30,
            unitNames: ["Me-R", "Ally"],
            facts: {
              t: "30",
              durationS: "9",
              freeS: "4",
              pressured: "Ally",
              pressuredSpec: "Warrior_Arms",
              lowestAllyHp: "35",
            },
          },
        ],
        "",
        "Holy Paladin",
      );
      expect(p).toMatch(/"healing-gap"/);
      expect(p).toMatch(/facts\.durationS/);
      expect(p).toMatch(/facts\.freeS/);
      expect(p).toMatch(/facts\.pressured\b/);
      expect(p).toMatch(/facts\.lowestAllyHp/);
    });

    it("md-cyclone-window 图例(GH #25,2026-08-21):条件渲染 + 图例引用的每个 facts 键都真在 builder 产出里,措辞守住红线", () => {
      const withoutType = buildFindingsPrompt(candidates, "", "Holy Paladin");
      expect(withoutType).not.toMatch(/md-cyclone-window/);

      // Facts 键与 mdCycloneWindowEvents 的真实产出保持一致(占位符纪律:
      // 图例引用了产出里不存在的键 = 模型只能编数据)。
      const p = buildFindingsPrompt(
        [
          ...candidates,
          {
            id: "md-cyclone-106",
            type: "md-cyclone-window",
            t: 106,
            unitNames: ["Me-R", "AllyA"],
            facts: {
              t: "106",
              windowFromT: "100",
              windowToT: "111",
              cycloneHits: "2",
              targets: "AllyA, AllyB",
              pressure: "enemy kill attempt on AllyA at 103s",
              strategicImmunities: "none in enemy comp",
            },
          },
        ],
        "",
        "Discipline Priest",
      );
      expect(p).toMatch(/"md-cyclone-window"/);
      for (const key of [
        "cycloneHits",
        "targets",
        "windowFromT",
        "windowToT",
        "pressure",
        "strategicImmunities",
      ]) {
        expect(p).toMatch(new RegExp(`facts\\.${key}`));
      }
      // 红线措辞:必须自称「可考虑的窗口」而非指控。
      expect(p).toMatch(/window worth considering/);
      expect(p).toMatch(/holding Mass Dispel is often correct/i);
    });

    it("position-mistake 图例解释三种 kind,且不越界断言因果", () => {
      const p = buildFindingsPrompt(
        [
          ...candidates,
          {
            id: "position-mistake:p1:10:stayed-in",
            type: "position-mistake",
            t: 10,
            unitNames: ["Me"],
            facts: { t: "10", kind: "stayed-in", hpStart: "90", hpMin: "40" },
          },
        ],
        "",
        "Holy Paladin",
      );
      expect(p).toMatch(/"position-mistake"/);
      expect(p).toMatch(/stayed-in/);
      expect(p).toMatch(/missed-push/);
      expect(p).toMatch(/cd-out-of-range/);
      // triage position F-S1 / F-S2 / F-S3: every stayed-in fact the mapper
      // emits is defined, and `moved` is a displacement, not a path
      for (const key of [
        "enemy",
        "dist",
        "endDist",
        "endEnemy",
        "minDist",
        "maxDist",
        "moved",
        "ccS",
        "rootS",
      ])
        expect(p).toMatch(new RegExp(`facts\\.${key}\\b`));
      expect(p).toContain(
        "facts.moved = the owner's straight-line displacement from span start to end",
      );
      expect(p).not.toContain("yards the owner itself moved");
    });

    it("cc-held 图例把「长期可用未使用」表述为事实层,明确禁止因果断言", () => {
      const p = buildFindingsPrompt(
        [
          ...candidates,
          {
            id: "cc-held:p1:118:10",
            type: "cc-held",
            t: 10,
            unitNames: ["Me"],
            spell: "Polymorph",
            facts: {
              t: "10",
              spell: "Polymorph",
              heldS: "96",
              windowEndT: "105",
            },
          },
        ],
        "",
        "Holy Paladin",
      );
      expect(p).toMatch(/"cc-held"/);
      expect(p).toMatch(/AVAILABLE/);
      // No-causation guard, in the spec's own words: uptime is a fact, "cost
      // the game" is the banned inference.
      expect(p).toMatch(
        /not a claim that pressing it would have changed the outcome/,
      );
      expect(p).toMatch(/never assert it "cost" anything/);
    });
  });
});

describe("P1/P2 起爆候选图例(Task 4,2026-08-15,特性开关接线;Task 9 默认全 true 上线)", () => {
  const missedSyncWindowEvent: CandidateEvent = {
    id: "missed-sync-window:Enemy-Healer:439",
    type: "missed-sync-window",
    t: 439,
    unitNames: ["Enemy-Healer"],
    facts: {
      t: "439",
      windowEndT: "447",
      healer: "Enemy-Healer",
      cc: "Polymorph",
      dr: "Full",
      durationS: "8",
      readyCds: "Avenging Wrath",
    },
  };
  // facts shape follows the 2026-08-30 decision-point rewrite (GH #34).
  const cdHoardedEvent: CandidateEvent = {
    id: "cd-hoarded:h:h:180",
    type: "cd-hoarded",
    t: 180,
    unitNames: ["Healer-R", "Healer-R"],
    spell: "Power Word: Barrier",
    facts: {
      t: "180",
      crisisUnit: "Healer-R",
      crisisHpPct: "30",
      dmg2sPct: "25",
      readyCds: "Power Word: Barrier",
      own: "yes",
      refDeathSpent: "4.5",
      refDeathHeld: "11.4",
      refN: "16960",
    },
  };

  it("默认态(2026-09-02 起 missedSyncWindow 复活为 true,GH #13 撤销)→ 该类型图例随事件出现;unsyncedBurst/cdSpentIdle 仍关死连图例都不出;现有图例不受影响", () => {
    // 单源门(candidateFindings 与 buildFindingsPrompt 读同一个 flag)在两头
    // 同时生效:开的类型图例随菜单出现,关死的类型连图例都不许出现。
    const p = buildFindingsPrompt(
      [...candidates, missedSyncWindowEvent, cdHoardedEvent],
      "",
      "Discipline Priest",
    );
    expect(p).toMatch(/"missed-sync-window"/);
    expect(p).toMatch(/"cd-hoarded"/);
    expect(p).not.toMatch(/"unsynced-burst"/);
    expect(p).not.toMatch(/"cd-spent-idle"/);
    expect(p).toMatch(/"death"/);
  });

  it("单开 missedSyncWindow(其余三个显式关闭,隔离验证)→ 只有 missed-sync-window 的图例出现,同同步是门/血线是加速器不要求低血", () => {
    // 2026-09-02 复活后默认 true(2026-08-19 至 09-02 曾默认 false)—— 本用例是纯函数隔离验证,四个开关都显式设,不依赖默认值。
    const savedFlags = { ...CANDIDATE_TYPE_FLAGS };
    CANDIDATE_TYPE_FLAGS.missedSyncWindow = true;
    CANDIDATE_TYPE_FLAGS.unsyncedBurst = false;
    CANDIDATE_TYPE_FLAGS.cdHoarded = false;
    CANDIDATE_TYPE_FLAGS.cdSpentIdle = false;
    try {
      const p = buildFindingsPrompt(
        [...candidates, missedSyncWindowEvent, cdHoardedEvent],
        "",
        "Discipline Priest",
      );
      expect(p).toMatch(/"missed-sync-window"/);
      expect(p).toMatch(/Syncing with the lock is the trigger/);
      expect(p).toMatch(/do NOT require low enemy HP/);
      expect(p).not.toMatch(/"cd-hoarded"/);
      expect(p).not.toMatch(/"unsynced-burst"/);
      expect(p).not.toMatch(/"cd-spent-idle"/);
    } finally {
      Object.assign(CANDIDATE_TYPE_FLAGS, savedFlags);
    }
  });

  // FT-T15 M5: the costNorm note this test used to find came from the
  // cd-waste legend, which printed on every prompt; cd-hoarded rows carry no
  // facts.costNorm (cost_norm abilities are kept out of readyCds), so with
  // no cd-waste row on the menu the note is absent.
  it("单开 cdHoarded(其余三个显式关闭,隔离验证)→ 只有 cd-hoarded 的图例出现;菜单无 cd-waste 行,costNorm 说明不出现", () => {
    const savedFlags = { ...CANDIDATE_TYPE_FLAGS };
    CANDIDATE_TYPE_FLAGS.missedSyncWindow = false;
    CANDIDATE_TYPE_FLAGS.unsyncedBurst = false;
    CANDIDATE_TYPE_FLAGS.cdSpentIdle = false;
    try {
      const p = buildFindingsPrompt(
        [...candidates, missedSyncWindowEvent, cdHoardedEvent],
        "",
        "Discipline Priest",
      );
      expect(p).toMatch(/"cd-hoarded"/);
      expect(p).not.toMatch(/facts\.costNorm is present/);
      expect(p).not.toMatch(/"missed-sync-window"/);
      expect(p).not.toMatch(/"unsynced-burst"/);
      expect(p).not.toMatch(/"cd-spent-idle"/);
    } finally {
      Object.assign(CANDIDATE_TYPE_FLAGS, savedFlags);
    }
  });

  it("cdSpentIdle 图例说明它只在中/高威胁对局里出现(2026-08-30 起默认关,显式开验证图例文案本身仍在)", () => {
    const savedFlags = { ...CANDIDATE_TYPE_FLAGS };
    CANDIDATE_TYPE_FLAGS.cdSpentIdle = true;
    try {
      const p = buildFindingsPrompt(
        [
          ...candidates,
          {
            id: "cd-spent-idle:h:33206:400",
            type: "cd-spent-idle",
            t: 400,
            unitNames: ["Healer-R"],
            spell: "Pain Suppression",
            facts: { t: "400", spell: "Pain Suppression", unit: "Healer-R" },
          },
        ],
        "",
        "Discipline Priest",
      );
      expect(p).toMatch(/"cd-spent-idle"/);
      expect(p).toMatch(/at least medium overall threat/);
    } finally {
      Object.assign(CANDIDATE_TYPE_FLAGS, savedFlags);
    }
  });

  it("显式关闭 missedSyncWindow,菜单里没有该类型的事件 → 图例仍不出现(presence 依旧把关,与既有类型同规则,避免白占 prompt 字节)", () => {
    const savedFlags = { ...CANDIDATE_TYPE_FLAGS };
    CANDIDATE_TYPE_FLAGS.missedSyncWindow = false;
    try {
      const p = buildFindingsPrompt(candidates, "", "Discipline Priest");
      expect(p).not.toMatch(/"missed-sync-window"/);
    } finally {
      Object.assign(CANDIDATE_TYPE_FLAGS, savedFlags);
    }
  });
});

describe("crisis-no-response 图例(spec 2026-08-29 §1b,GH #58):条件渲染 + 结果对照非因果", () => {
  it("菜单里没有该类型时,图例不渲染(D2 惯例)", () => {
    const withoutType = buildFindingsPrompt(candidates, "", "Holy Paladin");
    expect(withoutType).not.toMatch(/"crisis-no-response"/);
    expect(withoutType).not.toMatch(/not causal proof/);
  });

  it("菜单里有该类型时,图例出现,包含结果对照句式,且措辞守住「描述性对照,不是因果」的红线", () => {
    const p = buildFindingsPrompt(
      [
        ...candidates,
        {
          id: "crisis-no-response:H:2",
          type: "crisis-no-response",
          t: 2,
          unitNames: ["Heals-R"],
          facts: {
            t: "2",
            unit: "Heals-R",
            hpPct: "38",
            dmg2sPct: "30",
            attackers: "1",
            burst: "no",
            refNNoResp: "179",
            refDeathNoResp: "22",
            refNResp: "62",
            refDeathResp: "8",
            refOutcome: "this player died within 10 s",
            refOutcomeKey: "ownDeath10s",
            refTop: "self-heal 61%; wall 36%",
            cellKey: "3v3|healer|>=20%",
            fellBack: "no",
          },
        },
      ],
      "",
      "Holy Paladin",
    );
    expect(p).toMatch(/"crisis-no-response"/);
    expect(p).toMatch(
      /Players of the same role in this bracket who did NOT respond within 3 s saw that outcome/,
    );
    expect(p).toMatch(/players of the same role who DID respond saw it/);
    expect(p).toMatch(/Among players of the same role who DID respond here/);
    expect(p).not.toMatch(/healers who did NOT respond/);
    expect(p).not.toMatch(/healers who DID respond/);
    expect(p).not.toMatch(/Among healers who DID respond/);
    expect(p).toMatch(
      /For DPS the counted outcome is always "this player died within 10 s" \(DPS are the kill target\); for healers in Solo Shuffle it is a teammate's death within 15 s\./,
    );
    expect(p).toMatch(/not causal proof/);
    // crisis-external F-C1 (ruling A48 = C): "did NOTHING" is gone — the line
    // says what the measure is and what the player did press.
    expect(p).not.toMatch(/did NOTHING/);
    // WP-H 3 (FT-T13 D11): the dampening fact is conditional — it is left out
    // in a 2v2 round that logged no stack — so the legend says
    // "when … is present" instead of citing it unconditionally.
    expect(p).toContain(
      "did not answer it by this measure — no self-heal that reached 15% of max HP (facts.selfHealPct% landed from facts.selfHealCasts self-heal casts — at facts.dampeningPct% dampening, when facts.dampeningPct is present)",
    );
    expect(p).not.toContain(
      "self-heal casts at facts.dampeningPct% dampening)",
    );
  });

  it("图例说明两种结果口径(spec §1c):ownDeath10s = 本人 10 秒内阵亡,teamDeath15s = 含本人在内任意队友 15 秒内阵亡(单排常见击杀目标是队友)", () => {
    const p = buildFindingsPrompt(
      [
        ...candidates,
        {
          id: "crisis-no-response:H:2",
          type: "crisis-no-response",
          t: 2,
          unitNames: ["Heals-R"],
          facts: {
            t: "2",
            unit: "Heals-R",
            hpPct: "38",
            dmg2sPct: "30",
            attackers: "1",
            burst: "no",
            refNNoResp: "179",
            refDeathNoResp: "25",
            refNResp: "62",
            refDeathResp: "15",
            refOutcome: "a teammate (or the healer) died within 15 s",
            refOutcomeKey: "teamDeath15s",
            refTop: "self-heal 61%; wall 36%",
            cellKey: "Rated Solo Shuffle|healer|>=20%",
            fellBack: "no",
          },
        },
      ],
      "",
      "Holy Paladin",
    );
    expect(p).toMatch(/facts\.refOutcome names the outcome that was counted/);
    expect(p).toMatch(/"a teammate \(or the healer\) died within 15 s"/);
    expect(p).toMatch(/"this player died within 10 s"/);
    expect(p).toMatch(/kill target is often a teammate/);
    expect(p).toMatch(/never as a code token/);
  });
});

describe("FT-T15 M1–M4 (2026-10-10): a legend names every fact key its rows carry, and claims no more than they do", () => {
  const ev = (
    type: string,
    facts: Record<string, string>,
    t = 30,
  ): CandidateEvent => ({
    id: `${type}:x:${t}`,
    type,
    t,
    unitNames: ["Me-R"],
    facts,
  });
  const legendOf = (type: string, facts: Record<string, string>): string => {
    const p = buildFindingsPrompt([ev(type, facts)], "", "Holy Paladin");
    const line = p.split("\n").find((l) => l.startsWith(`- "${type}":`));
    expect(line, `${type} has a legend`).toBeDefined();
    return line!;
  };

  it("M1: questionable-external has a legend — printed only with the type, built from the Unnecessary tier's own constants", () => {
    expect(buildFindingsPrompt(candidates, "", "Holy Paladin")).not.toContain(
      `- "questionable-external":`,
    );
    const legend = legendOf("questionable-external", {
      t: "67.2",
      spell: "Blessing of Sacrifice",
      caster: "Me-R",
      target: "Ally-R",
      targetHp: "100",
      nearestBurstGapS: "22.3",
    });
    for (const key of [
      "spell",
      "caster",
      "target",
      "targetHp",
      "nearestBurstGapS",
    ])
      expect(legend).toMatch(new RegExp(`facts\\.${key}\\b`));
    expect(legend).toContain(`${UNNECESSARY_TARGET_HP_PCT}% or higher`);
    expect(legend).toContain(
      `less than ${TIMING_SPIKE_THRESHOLD / 1000}k damage in the ${TIMING_DAMAGE_WINDOW_S} s before the press`,
    );
    expect(legend).toContain(
      `within ${PRE_WALL_SECONDS} s before or ${LATE_WINDOW_SECONDS} s after one`,
    );
    expect(legend).toContain(`"n/a" = the round had no such window`);
    expect(legend).toMatch(/readings at the press, not a verdict/);
  });

  it("M2: missed-cleanse — a row with facts.latencyS WAS dispelled, late; the legend no longer says there was no friendly dispel", () => {
    const legend = legendOf("missed-cleanse", {
      t: "152",
      target: "Ally-R",
      cc: "Psychic Scream",
      duration: "3.3",
      worth: "must",
      latencyS: "3",
    });
    expect(legend).not.toMatch(/seconds without a friendly dispel/);
    expect(legend).toMatch(/facts\.latencyS/);
    expect(legend).toMatch(/the debuff WAS dispelled/);
    expect(legend).toMatch(/never write that nobody dispelled it/);
    for (const key of [
      "drChainRisk",
      "dispelType",
      "ownerCastingS",
      "ownerCastingSpells",
      "ownerCastingPreCommitted",
    ])
      expect(legend).toMatch(new RegExp(`facts\\.${key}\\b`));
    expect(legend).toContain(`within ${DR_CHAIN_LOOKAHEAD_S} s after`);
  });

  it("M3: kick-priority-team — ownerWhy=unknown is 'not known', never 'could not'", () => {
    const legend = legendOf("kick-priority-team", {
      t: "1:10",
      ownerWhy: "unknown",
    });
    expect(legend).not.toMatch(/The player could NOT kick it/);
    expect(legend).toMatch(/"unknown" = none of those held/);
    expect(legend).toMatch(
      /say it is not known whether the player could kick, never that they could not/,
    );
    for (const key of [
      "ownerWhy",
      "refNCompleted",
      "refNInterrupted",
      "refDeathCompleted",
      "refDeathInterrupted",
    ])
      expect(legend).toMatch(new RegExp(`facts\\.${key}\\b`));
  });

  it("M4: the keys the 605-capture table found on rows and in no legend are now named", () => {
    const cases: Array<[string, string[]]> = [
      ["death", ["unit"]],
      ["cd-waste", ["unit"]],
      ["death-setup", ["victim", "healer"]],
      [
        "slow-defensive-response",
        [
          "caster",
          "casterSpec",
          "pressuredHpT",
          "diedInWindow",
          "cellKey",
          "fellBack",
          "refTop",
          "leadCdId",
        ],
      ],
      [
        "kick-priority-missed",
        ["kickNeverUsed", "refDeathCompleted", "refDeathInterrupted"],
      ],
      ["crisis-no-response", ["unit", "refOutcomeKey"]],
      ["backlash-dispel", ["refKey"]],
    ];
    for (const [type, keys] of cases) {
      const legend = legendOf(type, { t: "30" });
      for (const key of keys)
        expect(legend, `${type} names facts.${key}`).toMatch(
          new RegExp(`facts\\.${key}\\b`),
        );
    }
    // a fallback cell is not this opener's: the legend says so
    expect(legendOf("slow-defensive-response", { t: "30" })).toMatch(
      /the numbers are not about facts\.leadCd alone/,
    );
  });
});
