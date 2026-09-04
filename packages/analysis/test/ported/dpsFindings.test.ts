/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";

import { buildFindingsPrompt } from "../../src/analysis/buildFindingsPrompt";
import { extractCandidateFindings } from "../../src/analysis/candidateFindings";
import type { CandidateEvent } from "../../src/analysis/types";
import {
  makeAdvancedAction,
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./testHelpers";

const MATCH_START = 1_000_000;

function dmgOut(timestamp: number, amount: number, destUnitId: string): any {
  return {
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp, parameters: [] },
    timestamp,
    effectiveAmount: amount,
    amount,
    srcUnitId: "p1",
    srcUnitName: "Ret",
    destUnitId,
    destUnitName: destUnitId,
    spellId: "1",
    spellName: "TestSpell",
  };
}

const info = { teamId: "0", specId: "x" } as any;

/** 3v3: a DPS owner (Retribution Paladin p1) + healer teammate h1; enemy e1
 *  (carrying an immunity aura). */
function buildCombat() {
  const owner = makeUnit("p1", {
    name: "Ret",
    spec: CombatUnitSpec.Paladin_Retribution,
    info,
    spellCastEvents: [
      makeSpellCastEvent(
        "31884",
        MATCH_START + 10_000,
        "p1",
        "Self",
        "p1",
        "Ret",
        0,
        "Avenging Wrath",
      ),
      // Wind Shear whiffs and e1 has a cancelled cast → juked-kick
      makeSpellCastEvent(
        "57994",
        MATCH_START + 40_000,
        "e1",
        "Enemy",
        "p1",
        "Ret",
        0,
        "Wind Shear",
      ),
    ],
    damageOut: [dmgOut(MATCH_START + 12_000, -50_000, "e1")],
  } as any);
  const healerAlly = makeUnit("h1", {
    name: "Disc",
    spec: CombatUnitSpec.Priest_Discipline,
    info,
    reaction: CombatUnitReaction.Friendly,
  } as any);
  const e1 = makeUnit("e1", {
    name: "Enemy",
    info,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        "642",
        MATCH_START + 11_000,
        "e1",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        "642",
        MATCH_START + 17_000,
        "e1",
        "e1",
        "BUFF",
      ),
    ],
    castStartEvents: [
      // A cancelled cast (no SUCCESS) 1.5s before the Wind Shear → juke
      (() => {
        const e = makeSpellCastEvent(
          "116",
          MATCH_START + 38_500,
          "e1",
          "e1",
          "e1",
          "e1",
          0,
          "116",
        );
        e.logLine.event = LogEvent.SPELL_CAST_START;
        return e;
      })(),
    ],
  } as any);
  const combat = {
    startTime: MATCH_START,
    endTime: MATCH_START + 120_000,
    units: { p1: owner, h1: healerAlly, e1 },
  } as any;
  return { combat, owner, healerAlly };
}

describe("DPS candidate findings(D2)", () => {
  it("DPS owner:退役负控 —— burst-into-immunity(2026-08-20,GH #17)与 juked-kick(2026-08-19,GH #15)均不再产出", () => {
    const { combat } = buildCombat();
    const events = extractCandidateFindings(combat, "p1");
    const types = new Set(events.map((e) => e.type));
    // 本 fixture 在各自退役前确实产出过这两类(本用例旧版断言),摘发射后
    // 必须为 false。burst-into-immunity:按爆发归一化判别力持平(胜 7.1%
    // vs 负 6.8%),免疫事实由 [KILL ATTEMPTS] 失败归因供给。
    expect(types.has("burst-into-immunity")).toBe(false);
    expect(types.has("juked-kick")).toBe(false);
  });

  it("healer owner:菜单不含任何 DPS 事件类型(治疗管线不变)", () => {
    const { combat } = buildCombat();
    const events = extractCandidateFindings(combat, "h1");
    const dpsTypes = [
      "burst-into-immunity",
      "off-target-in-window",
      "juked-kick",
      "dr-clipped-cc",
    ];
    expect(events.some((e) => dpsTypes.includes(e.type))).toBe(false);
  });

  it("不传 ownerId:回退友方治疗,菜单与传治疗 id 完全一致(向后兼容)", () => {
    const { combat } = buildCombat();
    const legacyDefault = extractCandidateFindings(combat);
    const explicitHealer = extractCandidateFindings(combat, "h1");
    expect(legacyDefault).toEqual(explicitHealer);
  });

  it("cd-waste 锚定 owner:DPS owner 的 cd-waste 以 p1 为单位", () => {
    const { combat } = buildCombat();
    const events = extractCandidateFindings(combat, "p1");
    for (const e of events.filter((ev) => ev.type === "cd-waste")) {
      expect(e.unitNames).toEqual(["Ret"]);
    }
  });
});

/**
 * OFFENSIVE-002 (burst-into-mitigation, 2026-08-11): the owner opens an
 * offensive CD (Avenging Wrath, "31884") into e1 while e1 has a major
 * non-immune mitigation cooldown active (default: Pain Suppression "33206",
 * 40% all-school per MITIGATION_TABLE); e2, when present, has burned its
 * trinket with nothing stun-usable in hand — kill-opportunity tier "prime"
 * (2026-08-18 tier model) — so betterTargetExists fires.
 */
function buildMitigationCombat(
  opts: {
    // Spell id only — burstLedger resolves the display name from real spell
    // data by id (getEnglishSpellName), so a mock aura event's own name field
    // is never consulted.
    mitSpellId?: string;
    twoEnemies?: boolean;
    e2HpPct?: number;
    e2TrinketBurned?: boolean;
  } = {},
) {
  const {
    mitSpellId = "33206",
    twoEnemies = true,
    e2HpPct = 20,
    e2TrinketBurned = true,
  } = opts;

  const owner = makeUnit("p1", {
    name: "Ret",
    spec: CombatUnitSpec.Paladin_Retribution,
    info,
    spellCastEvents: [
      makeSpellCastEvent(
        "31884",
        MATCH_START + 10_000,
        "p1",
        "Self",
        "p1",
        "Ret",
        0,
        "Avenging Wrath",
      ),
    ],
    damageOut: [dmgOut(MATCH_START + 12_000, -50_000, "e1")],
  } as any);

  const e1 = makeUnit("e1", {
    name: "Tank",
    info,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        mitSpellId,
        MATCH_START + 5_000,
        "ally",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        mitSpellId,
        MATCH_START + 20_000,
        "ally",
        "e1",
        "BUFF",
      ),
    ],
    advancedActions: [
      makeAdvancedAction(MATCH_START + 10_000, 0, 0, 500_000, 450_000), // 90% HP
    ],
  } as any);

  const units: Record<string, unknown> = { p1: owner, e1 };
  if (twoEnemies) {
    units.e2 = makeUnit("e2", {
      name: "Squishy",
      info,
      reaction: CombatUnitReaction.Hostile,
      // Trinket burned before the burst → no trinket, nothing stun-usable in
      // hand → tier "prime" (what betterTargetExists now keys on).
      spellCastEvents: e2TrinketBurned
        ? [makeSpellCastEvent("336126", MATCH_START + 1_000, "e2")]
        : [],
      advancedActions: [
        makeAdvancedAction(
          MATCH_START + 10_000,
          0,
          0,
          500_000,
          (e2HpPct / 100) * 500_000,
        ),
      ],
    } as any);
  }

  const combat = {
    startTime: MATCH_START,
    endTime: MATCH_START + 120_000,
    units,
  } as any;
  return { combat, owner };
}

describe("burst-into-mitigation(OFFENSIVE-002,2026-08-11 信号扩容批 2)", () => {
  it("减伤达标 + 有更软目标:产出 burst-into-mitigation,facts 可验证", () => {
    const { combat } = buildMitigationCombat();
    const events = extractCandidateFindings(combat, "p1");
    const found = events.find((e) => e.type === "burst-into-mitigation");
    expect(found).toBeTruthy();
    expect(found!.unitNames).toContain("Ret");
    expect(found!.unitNames).toContain("Tank");
    expect(found!.facts.target).toBe("Tank");
    expect(found!.facts.mitSpell).toBe("Pain Suppression");
    expect(found!.facts.mitPct).toBe("40");
    expect(found!.facts.betterTarget).toBe("Squishy");
  });

  it("无更软目标(单一敌人):不产出", () => {
    const { combat } = buildMitigationCombat({ twoEnemies: false });
    const events = extractCandidateFindings(combat, "p1");
    expect(events.some((e) => e.type === "burst-into-mitigation")).toBe(false);
  });

  it("备选目标徽章还在(locked):血再低也不指控 —— 2026-08-18 tier 模型只认 prime-vs-rest", () => {
    // 旧版此处测 SCORE_MARGIN(HP 差 5pt < 15 不触发);margin 概念已随
    // softness 公式一并删除,新的负例是同一问题在 tier 语义下的形状。
    const { combat } = buildMitigationCombat({
      e2HpPct: 20,
      e2TrinketBurned: false,
    });
    const events = extractCandidateFindings(combat, "p1");
    expect(events.some((e) => e.type === "burst-into-mitigation")).toBe(false);
  });

  it("减伤百分比低于门槛(<30%):不产出", () => {
    // Barkskin: 20% per MITIGATION_TABLE — below BURST_INTO_MITIGATION_MIN_PCT
    // (Anti-Magic Zone used to be the example at 15%; since 2026-09-04 it is the
    // PvP value 30% and sits exactly on the threshold)
    const { combat } = buildMitigationCombat({ mitSpellId: "22812" });
    const events = extractCandidateFindings(combat, "p1");
    expect(events.some((e) => e.type === "burst-into-mitigation")).toBe(false);
  });

  it("positional 条目(黑暗 196718)不判定站位,契约要求不计入", () => {
    const { combat } = buildMitigationCombat({ mitSpellId: "196718" });
    const events = extractCandidateFindings(combat, "p1");
    expect(events.some((e) => e.type === "burst-into-mitigation")).toBe(false);
  });

  it("healer owner:菜单不含 burst-into-mitigation(DPS-only 门槛)", () => {
    const { combat } = buildMitigationCombat();
    const healer = makeUnit("h1", {
      name: "Disc",
      spec: CombatUnitSpec.Priest_Discipline,
      info,
      reaction: CombatUnitReaction.Friendly,
    } as any);
    (combat.units as Record<string, unknown>).h1 = healer;
    const healerEvents = extractCandidateFindings(combat, "h1");
    expect(healerEvents.some((e) => e.type === "burst-into-mitigation")).toBe(
      false,
    );
  });

  it("cap 2/轮,按窗口伤害降序保留最重的两个", () => {
    // Three qualifying bursts in one round (three separate Avenging Wrath
    // casts, well outside each other's grouping reach so each forms its own
    // burst), each hitting a different enemy at descending damage; only the
    // top two (by dominantTarget damage) survive BURST_INTO_MITIGATION_CAP.
    const owner = makeUnit("p1", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      info,
      spellCastEvents: [
        makeSpellCastEvent(
          "31884",
          MATCH_START + 10_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
        makeSpellCastEvent(
          "31884",
          MATCH_START + 60_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
        makeSpellCastEvent(
          "31884",
          MATCH_START + 110_000,
          "p1",
          "Self",
          "p1",
          "Ret",
          0,
          "Avenging Wrath",
        ),
      ],
      damageOut: [
        dmgOut(MATCH_START + 12_000, -30_000, "e1"),
        dmgOut(MATCH_START + 62_000, -50_000, "e2"),
        dmgOut(MATCH_START + 112_000, -70_000, "e3"),
      ],
    } as any);

    const mitigatedEnemy = (
      id: string,
      applyAtMs: number,
      removeAtMs: number,
      hpSnapshotMs: number,
    ) =>
      makeUnit(id, {
        name: id,
        info,
        reaction: CombatUnitReaction.Hostile,
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "33206",
            applyAtMs,
            "ally",
            id,
            "BUFF",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "33206",
            removeAtMs,
            "ally",
            id,
            "BUFF",
          ),
        ],
        advancedActions: [
          makeAdvancedAction(hpSnapshotMs, 0, 0, 500_000, 450_000), // 90% HP
        ],
      } as any);

    const softAlt = (id: string, hpSnapshotMs: number) =>
      makeUnit(id, {
        name: id,
        info,
        reaction: CombatUnitReaction.Hostile,
        // Trinket burned → tier "prime" under the 2026-08-18 model.
        spellCastEvents: [
          makeSpellCastEvent("336126", MATCH_START + 1_000, id),
        ],
        advancedActions: [
          makeAdvancedAction(hpSnapshotMs, 0, 0, 500_000, 100_000), // 20% HP
        ],
      } as any);

    const combat = {
      startTime: MATCH_START,
      endTime: MATCH_START + 200_000,
      units: {
        p1: owner,
        e1: mitigatedEnemy(
          "e1",
          MATCH_START + 5_000,
          MATCH_START + 20_000,
          MATCH_START + 10_000,
        ),
        e2: mitigatedEnemy(
          "e2",
          MATCH_START + 55_000,
          MATCH_START + 70_000,
          MATCH_START + 60_000,
        ),
        e3: mitigatedEnemy(
          "e3",
          MATCH_START + 105_000,
          MATCH_START + 120_000,
          MATCH_START + 110_000,
        ),
        alt1: softAlt("alt1", MATCH_START + 10_000),
        alt2: softAlt("alt2", MATCH_START + 60_000),
        alt3: softAlt("alt3", MATCH_START + 110_000),
      },
    } as any;

    const events = extractCandidateFindings(combat, "p1");
    const mits = events.filter((e) => e.type === "burst-into-mitigation");
    expect(mits.length).toBe(2);
    // Kept: the two heaviest windows (e3=70k, e2=50k); dropped: e1=30k.
    expect(mits.map((m) => m.facts.target).sort()).toEqual(["e2", "e3"]);
  });
});

describe("buildFindingsPrompt legend 动态化(D2)", () => {
  const death: CandidateEvent = {
    id: "death:x:1",
    type: "death",
    t: 1,
    unitNames: ["A"],
    facts: { t: "1", unit: "A", side: "friendly" },
  };

  it("无 DPS 事件时 prompt 与旧版字节一致(不含 DPS legend)", () => {
    const p = buildFindingsPrompt([death], "ctx", "Holy Paladin");
    expect(p).not.toContain("burst-into-immunity");
    expect(p).not.toContain("juked-kick");
  });

  it("含 DPS 事件时对应 legend 出现(且只出现在场的类型)", () => {
    const juke: CandidateEvent = {
      id: "juked-kick:p1:40",
      type: "juked-kick",
      t: 40,
      unitNames: ["Ret"],
      facts: { t: "40", kick: "Wind Shear", fake: "Frostbolt" },
    };
    const p = buildFindingsPrompt([death, juke], "ctx", "Retribution Paladin");
    expect(p).toContain(`"juked-kick"`);
    expect(p).not.toContain(`"burst-into-immunity"`);
  });
});
