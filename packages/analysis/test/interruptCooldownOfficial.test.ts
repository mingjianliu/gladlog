/**
 * FT-T11 (2026-10-09): an interrupt's base cooldown is the official one.
 * `spellEffectOverrides.ts` carried Quell 40 s, Silence 45 s and Counterspell
 * 24 s by hand; DB2 12.1.5 says 20 / 30 / 25 and the corpus agrees (605
 * files, shortest recast gap by the same player in a round: Quell 20.0 s,
 * Silence 30.0 s, Counterspell 20.0 s = 25 − Quick Witted's 5). An enemy
 * `[KICK] … (Quell; back m:ss)` was contradicted by the same evoker's next
 * Quell on 34 of 59 pairs.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import {
  kickLockoutSeconds,
  spellEffectData,
} from "../src/data/spellEffectData";
import { SPELL_EFFECTS_GENERATED } from "../src/data/spellEffectGenerated";
import {
  INTERRUPT_SPELL_IDS,
  interruptCooldownSeconds,
} from "../src/utils/enemyInterrupts";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("FT-T11 — interrupt cooldowns are the official ones", () => {
  it("Quell 20 s、Silence 30 s、Counterspell 25 s(无天赋的基础值)", () => {
    expect(interruptCooldownSeconds("351338")).toBe(20);
    expect(interruptCooldownSeconds("15487")).toBe(30);
    expect(interruptCooldownSeconds("2139")).toBe(25);
  });

  it("Counterspell 的锁定仍是签过字的 6 秒(只还原了冷却)", () => {
    expect(kickLockoutSeconds("2139")).toBe(6);
  });

  it("名册里每个打断的冷却都等于官方行:手写值不能再悄悄盖过去", () => {
    const differs: string[] = [];
    // a hand cooldown on an id DB2 gives none (codex 40-FT-38: the
    // comparison used to skip these silently)
    const handOnly: string[] = [];
    for (const id of INTERRUPT_SPELL_IDS) {
      const official = SPELL_EFFECTS_GENERATED[id]?.cooldownSeconds;
      const used = spellEffectData[id]?.cooldownSeconds;
      if (used === undefined) continue;
      if (official === undefined) handOnly.push(id);
      else if (official !== used)
        differs.push(`${id}: ${used} vs DB2 ${official}`);
    }
    expect(differs).toEqual([]);
    // 119910 = Spell Lock's interrupt-effect id (the Felhunter casts 19647,
    // DB2 24 s; the effect id has no cooldown row of its own)
    expect(handOnly).toEqual(["119910"]);
    expect(spellEffectData["119910"]?.cooldownSeconds).toBe(
      SPELL_EFFECTS_GENERATED["19647"]?.cooldownSeconds,
    );
  });
});
