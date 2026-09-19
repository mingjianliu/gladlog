/**
 * effectiveCooldownSeconds — the one "how long until this button is back"
 * predicate (codex astra review 2026-09-18). DB2 gives a charge spell two
 * numbers; the inlined `cooldownSeconds ?? chargeCooldownSeconds` idiom
 * answered the short press-spacing one, so Zenith (16 / 90) failed every
 * 30 s gate right after being "added" to OFFENSIVE_CD_SPELL_IDS.
 */
import { describe, expect, it } from "vitest";

import { isEnemyCdWindowSpell } from "../utils/enemyCDs";
import { OFFENSIVE_CD_SPELL_IDS } from "../utils/spellDanger";
import { effectiveCooldownSeconds, spellEffectData } from "./spellEffectData";

describe("effectiveCooldownSeconds", () => {
  it("充能技能取回充时间,不取两次按键的间隔", () => {
    expect(spellEffectData["1249625"]?.cooldownSeconds).toBe(16);
    expect(effectiveCooldownSeconds("1249625")).toBe(90); // Zenith
    expect(effectiveCooldownSeconds("228920")).toBe(90); // Ravager 8 / 90
    expect(effectiveCooldownSeconds("228049")).toBe(240); // GotFQ 6 / 240
  });

  it("无充能的技能原样返回;两个字段都没有 → undefined(不猜)", () => {
    expect(effectiveCooldownSeconds("190319")).toBe(120); // Combustion
    expect(effectiveCooldownSeconds("no-such-spell")).toBeUndefined();
  });

  it("关键减伤、驱散与破无敌技能返回正典冷却时长", () => {
    expect(effectiveCooldownSeconds("32375")).toBe(120); // Mass Dispel
    expect(effectiveCooldownSeconds("45438")).toBe(240); // Ice Block
    expect(effectiveCooldownSeconds("642")).toBe(300); // Divine Shield
    expect(effectiveCooldownSeconds("64382")).toBe(180); // Shattering Throw
  });

  it("Zenith 真的进得了敌方大招窗口(成员资格 ≠ 可见)", () => {
    expect(OFFENSIVE_CD_SPELL_IDS.has("1249625")).toBe(true);
    expect(isEnemyCdWindowSpell("1249625")).toBe(true);
  });

  it("表里每个会产生施放的成员:要么过 30 s 门,要么是纯光环 id —— 且过门的必须有窗口时长", () => {
    const noDuration: string[] = [];
    for (const id of OFFENSIVE_CD_SPELL_IDS) {
      if (!isEnemyCdWindowSpell(id)) continue;
      if (!(spellEffectData[id]?.durationSeconds ?? 0)) noDuration.push(id);
    }
    // A member that passes the gate with no duration renders as a
    // zero-length window ([10,10]) — the Voidform / Colossus Smash shape.
    // Known, pre-existing, instant-effect members are listed; a NEW one fails.
    expect(noDuration.sort()).toEqual(KNOWN_NO_DURATION.sort());
  });
});

// Soul Fire: pre-existing spellCategories entry ("45s nuke") — an instant
// nuke, the same shape Meteor was EXCLUDED for on 2026-09-18. Left in place
// (retiring a registered member is a user call); listed so it stays visible.
const KNOWN_NO_DURATION: string[] = ["6353"];
