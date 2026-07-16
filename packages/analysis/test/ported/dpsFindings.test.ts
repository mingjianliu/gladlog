/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";

import { buildFindingsPrompt } from "../../src/analysis/buildFindingsPrompt";
import { extractCandidateFindings } from "../../src/analysis/candidateFindings";
import type { CandidateEvent } from "../../src/analysis/types";
import { makeAuraEvent, makeSpellCastEvent, makeUnit } from "./testHelpers";

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

/** 3v3:DPS owner(惩戒骑 p1)+ 治疗队友 h1;敌方 e1(有免疫 aura)。 */
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
      // 风剪落空且 e1 有取消读条 → juked-kick
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
      // 取消的读条(无 SUCCESS)在风剪前 1.5s → juke
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
  it("DPS owner:产出 burst-into-immunity 与 juked-kick,facts 可验证", () => {
    const { combat } = buildCombat();
    const events = extractCandidateFindings(combat, "p1");
    const types = new Set(events.map((e) => e.type));
    expect(types.has("burst-into-immunity")).toBe(true);
    expect(types.has("juked-kick")).toBe(true);

    const imm = events.find((e) => e.type === "burst-into-immunity")!;
    expect(imm.unitNames).toContain("Ret");
    expect(imm.unitNames).toContain("Enemy");
    expect(imm.facts.immunity).toBe("Divine Shield");
    expect(Number(imm.facts.overlap)).toBeGreaterThan(0);

    const juke = events.find((e) => e.type === "juked-kick")!;
    expect(juke.facts.kick).toBe("Wind Shear");
    expect(juke.facts.fake).toBeTruthy();
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
