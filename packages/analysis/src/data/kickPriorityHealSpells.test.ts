import { describe, expect, it } from "vitest";

import { HARDCAST_HEAL_SPELL_IDS, hardcastHealSpell } from "./kickPriorityHealSpells";

describe("kickPriorityHealSpells (corpus hardcast-heal table, GH #78 codex R2)", () => {
  it("the table is non-empty and every entry carries a positive nominal cast length", () => {
    expect(HARDCAST_HEAL_SPELL_IDS.length).toBeGreaterThanOrEqual(5);
    for (const id of HARDCAST_HEAL_SPELL_IDS) {
      const s = hardcastHealSpell(id)!;
      expect(s.n).toBeGreaterThanOrEqual(50);
      expect(s.medianCastS).toBeGreaterThan(0.5);
      expect(s.medianCastS).toBeLessThan(4);
    }
  });
  it("Flash Heal (2061) qualifies; an interrupt id (Kick 1766) and an unknown id do not", () => {
    expect(hardcastHealSpell("2061")?.name).toBe("Flash Heal");
    expect(hardcastHealSpell("1766")).toBeNull();
    expect(hardcastHealSpell("0")).toBeNull();
  });
});
