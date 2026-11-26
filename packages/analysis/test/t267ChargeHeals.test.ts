/**
 * Pipeline T267 — the two charge heals the model called impossible to
 * re-press:
 *  - Penance: Discipline's passive recovers its charges by haste (DB2 aura
 *    457 on charge category 1230), so it is in the haste-scaled set and no
 *    line prints an exact return for it;
 *  - Swiftmend: Renewing Surge takes 15 % off its cooldown (a dummy aura,
 *    the hand row in scripts/datagen/customTalentModifiers.ts).
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { CUSTOM_TALENT_MODIFIERS } from "../scripts/datagen/customTalentModifiers";
import manifest from "../src/data/datagen-manifest.json";
import { ensureAnalysisData } from "../src/data/ensure";
import { isHasteScaledCooldown } from "../src/data/hasteScaledCooldowns";
import raw from "../src/data/hasteScaledCooldownsGenerated.json";
import { applyCdModifiers } from "../src/utils/cooldowns";
import { CD_TALENT_MODIFIERS } from "../src/utils/talentModifiers";

const PENANCE = "47540";
const SWIFTMEND = "18562";
const RENEWING_SURGE = "470562";
const PROSPERITY = "200383";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("T267 — charges a spec passive recovers by haste (DB2 aura 457)", () => {
  it("Penance for Discipline, not for the other priest specs", () => {
    expect(
      isHasteScaledCooldown(PENANCE, CombatUnitSpec.Priest_Discipline),
    ).toBe(true);
    expect(isHasteScaledCooldown(PENANCE, CombatUnitSpec.Priest_Holy)).toBe(
      false,
    );
    expect(isHasteScaledCooldown(PENANCE, CombatUnitSpec.Priest_Shadow)).toBe(
      false,
    );
  });
  it("a row of basePoints 0 counts (Holy's Prayer of Mending) as one of 100 (Retribution's Judgment)", () => {
    expect(isHasteScaledCooldown("33076", CombatUnitSpec.Priest_Holy)).toBe(
      true,
    );
    expect(
      isHasteScaledCooldown("20271", CombatUnitSpec.Paladin_Retribution),
    ).toBe(true);
  });
  it("Swiftmend's charges are not recovered by haste", () => {
    expect(
      isHasteScaledCooldown(SWIFTMEND, CombatUnitSpec.Druid_Restoration),
    ).toBe(false);
  });
  it("a charge category no other row resolves is listed, not dropped silently", () => {
    // Preservation's Reversion (category 2010): no other row of the
    // inventory reaches it, so the table cannot name the spell — and says so
    const { meta, bySpec } = raw as {
      meta: { unresolvedChargeCategories: string[] };
      bySpec: Record<string, string[]>;
    };
    expect(bySpec[String(CombatUnitSpec.Evoker_Preservation)]).not.toContain(
      "366155",
    );
    expect(meta.unresolvedChargeCategories).toContain("2010(356810)");
  });
  it("the manifest counts the table's specs", () => {
    expect(
      (manifest as { artifacts: Record<string, { specs?: number }> }).artifacts[
        "hasteScaledCooldownsGenerated.json"
      ]!.specs,
    ).toBe(Object.keys((raw as { bySpec: object }).bySpec).length);
  });
});

describe("T267 — Renewing Surge takes 15 % off Swiftmend", () => {
  it("the generated table carries the hand row", () => {
    const hand = CUSTOM_TALENT_MODIFIERS[SWIFTMEND]!;
    expect(hand).toEqual([
      { talentSpellId: RENEWING_SURGE, effect: "reduce_cd_pct", value: 15 },
    ]);
    expect(CD_TALENT_MODIFIERS[SWIFTMEND]).toContainEqual(hand[0]);
  });
  it("15 s → 12.75 s with the talent, two charges with Prosperity; 15 s without", () => {
    const mods = CD_TALENT_MODIFIERS[SWIFTMEND];
    const spec = { specId: String(CombatUnitSpec.Druid_Restoration) };
    expect(
      applyCdModifiers(
        mods,
        15,
        1,
        new Set([RENEWING_SURGE, PROSPERITY]),
        new Set(),
        spec,
      ),
    ).toEqual({ cooldownSeconds: 12.75, charges: 2 });
    expect(
      applyCdModifiers(mods, 15, 1, new Set([PROSPERITY]), new Set(), spec),
    ).toEqual({ cooldownSeconds: 15, charges: 2 });
  });
});
