/**
 * ccFullDurationSeconds — the single predicate for "how long does this CC /
 * root last at full DR" (GH #44 tail, user ruling 2026-09-02 "羊本身永远是6秒
 * 除非有龙给的加持续时间的debuff").
 *
 * Two properties are pinned:
 *   1. the accessor answers from the official DB2 duration (overrides layered,
 *      incl. the corpus-evidenced CORPUS_DURATION_PATCHES) and only falls back
 *      to the hand SPELL_CATEGORIES duration where DB2 is blank;
 *   2. no cc / roots entry in SPELL_CATEGORIES carries a hand duration that
 *      DB2 already covers — that duplicate is exactly the drift this predicate
 *      replaced (21 of the 22 hand-vs-DB2 disagreements were wrong on the hand
 *      side; S2 605-file lifetime check, 2026-09-02).
 */
import { SPELL_CATEGORIES } from "../src/data/spellCategories";
import {
  ccFullDurationSeconds,
  OPPRESSING_ROAR_PVP_CC_DURATION_MULT,
  OPPRESSING_ROAR_SPELL_ID,
  spellEffectData,
} from "../src/data/spellEffectData";
import { CORPUS_DURATION_PATCHES } from "../src/data/spellEffectOverrides";

describe("ccFullDurationSeconds — 官方时长单源", () => {
  it("变形全家与妖术按 DB2 PvP 时长 6s(手工表曾写 8)", () => {
    for (const id of [
      "118",
      "28271",
      "28272",
      "61305",
      "61721",
      "161353",
      "161354",
      "277787",
      "277792",
      "391622",
      "460392",
      "51514",
      "210873",
      "211004",
      "211015",
      "269352",
      "277778",
      "277784",
      "309328",
    ])
      expect(ccFullDurationSeconds(id)).toBe(6);
  });

  it("语料修正层压在 DB2 之上:束缚射击 DB2 2s → 实测 3s", () => {
    expect(CORPUS_DURATION_PATCHES["117526"]).toBe(3);
    expect(spellEffectData["117526"]?.durationSeconds).toBe(3);
    expect(ccFullDurationSeconds("117526")).toBe(3);
    // the patch is layered, not a stub: the generated dispelType survives
    expect(spellEffectData["117526"]?.dispelType).toBe("Magic");
  });

  it("DB2 空白时才回退到手工值:肾击 5s(S2 寿命众数 5.0s ×700)", () => {
    expect(spellEffectData["408"]?.durationSeconds).toBeUndefined();
    expect(ccFullDurationSeconds("408")).toBe(5);
    expect(ccFullDurationSeconds("no-such-id")).toBeUndefined();
  });

  it("cc/roots 条目不得携带 DB2 已覆盖的手工时长(单源,防再漂)", () => {
    const duplicated: string[] = [];
    const fallbacks: string[] = [];
    for (const [id, e] of Object.entries(SPELL_CATEGORIES)) {
      if (e.type !== "cc" && e.type !== "roots") continue;
      if (e.duration === undefined) continue;
      if (spellEffectData[id]?.durationSeconds !== undefined)
        duplicated.push(id);
      else fallbacks.push(id);
    }
    expect(duplicated).toEqual([]);
    // The fallback set is deliberately tiny and every member is documented in
    // spellCategories.ts; a new one needs the same corpus evidence.
    expect(fallbacks.sort()).toEqual(["107570", "408", "46968", "5782"]);
  });

  it("其他类型一律不带手工时长(2026-09-02 剔除 70 条零消费者的数字;interrupts 从未有过)", () => {
    // Only the four cc fallbacks above may carry `duration` at all. The buff /
    // debuff / immunity / disarm numbers had no reader (the two consumers are
    // ccFullDurationSeconds for cc/roots and kickLockoutSeconds for interrupts)
    // and 30 of the 70 disagreed with DB2 — a second table of facts nobody
    // checks is exactly the drift the Shared-Predicate rule exists to stop.
    const withDuration = Object.entries(SPELL_CATEGORIES)
      .filter(([, e]) => e.duration !== undefined)
      .map(([id]) => id)
      .sort();
    expect(withDuration).toEqual(["107570", "408", "46968", "5782"]);
  });

  it("压迫咆哮:官方 aura 232 基点 50 × PvpMultiplier 0.6 = +30%", () => {
    expect(OPPRESSING_ROAR_SPELL_ID).toBe("372048");
    expect(OPPRESSING_ROAR_PVP_CC_DURATION_MULT).toBeCloseTo(1.3);
  });
});
