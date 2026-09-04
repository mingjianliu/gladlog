/**
 * kickLockoutSeconds — the single predicate for "how long does this kick lock
 * the school" (GH #62 → user ruling 2026-09-04: official DB2 PvP duration
 * first, the corpus scan is the verification gate).
 *
 * Two properties are pinned:
 *   1. the accessor answers from the official DB2 duration of the kick spell
 *      (SpellMisc.PvPDurationIndex through genSpellEffects) and only falls
 *      back to the corpus-observed table / hand duration / 3 s where DB2 is
 *      blank;
 *   2. official and corpus agree: for every kick the S2 scan saw ≥ 100 times,
 *      |official − observed p25| ≤ 0.5 s. p25, not the bin mode — the mode
 *      can sit one bin late (Counterspell mode 6, p25 5.04, official 5). A
 *      DB2 refresh that breaks this turns CI red instead of silently moving
 *      the cannot-cast exemption.
 */
import { KICK_LOCKOUT_OBSERVED } from "../src/data/kickLockoutObservedGenerated";
import { SPELL_CATEGORIES } from "../src/data/spellCategories";
import {
  kickLockoutOfficialSeconds,
  kickLockoutSeconds,
} from "../src/data/spellEffectData";

const GATE_MIN_N = 100;
const GATE_TOLERANCE_S = 0.5;

describe("kickLockoutSeconds — 官方 PvP 锁定时长单源", () => {
  it("2026-09-04 裁决值:法术反制 5(语料众数 6 是分箱伪影)、脚踢/拳击/心灵冰冻 3、风剪 2、压制 4、法术封锁 5", () => {
    expect(kickLockoutSeconds("2139")).toBe(5); // Counterspell
    expect(kickLockoutSeconds("1766")).toBe(3); // Kick
    expect(kickLockoutSeconds("6552")).toBe(3); // Pummel
    expect(kickLockoutSeconds("47528")).toBe(3); // Mind Freeze
    expect(kickLockoutSeconds("57994")).toBe(2); // Wind Shear
    expect(kickLockoutSeconds("351338")).toBe(4); // Quell
    expect(kickLockoutSeconds("19647")).toBe(5); // Spell Lock
    expect(kickLockoutSeconds("347008")).toBe(3); // Axe Toss (corpus 3.5, n=40)
  });

  it("官方值存在时以官方为准;DB2 空白的 id 才落到语料 / 手工 / 3s", () => {
    for (const id of Object.keys(KICK_LOCKOUT_OBSERVED)) {
      const official = kickLockoutOfficialSeconds(id);
      if (official !== undefined) expect(kickLockoutSeconds(id)).toBe(official);
      else
        expect(kickLockoutSeconds(id)).toBe(
          KICK_LOCKOUT_OBSERVED[id]!.lockoutSeconds,
        );
    }
    expect(kickLockoutSeconds("0")).toBe(3);
  });

  it("校验门:语料 n ≥ 100 的每个踢技,官方值都存在且 |官方 − p25| ≤ 0.5 s", () => {
    const gated = Object.entries(KICK_LOCKOUT_OBSERVED).filter(
      ([, e]) => e.n >= GATE_MIN_N,
    );
    expect(gated.length).toBeGreaterThanOrEqual(10);
    for (const [id, e] of gated) {
      const official = kickLockoutOfficialSeconds(id);
      expect(official, `${e.name} ${id}: DB2 duration missing`).toBeDefined();
      expect(
        Math.abs(official! - e.p25),
        `${e.name} ${id}: official ${official} vs corpus p25 ${e.p25}`,
      ).toBeLessThanOrEqual(GATE_TOLERANCE_S);
    }
  });

  it("没有 interrupts 手工条目携带时长(手工层只是第三回退,不得回填)", () => {
    for (const [id, e] of Object.entries(SPELL_CATEGORIES)) {
      if (e.type === "interrupts")
        expect(
          e.duration,
          `${id} interrupts entry carries a hand duration`,
        ).toBeUndefined();
    }
  });
});
