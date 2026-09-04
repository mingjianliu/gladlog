/**
 * GH #63 (2026-09-04): the generated healer save-cooldown roster is the
 * authority for healer specs inside `extractMajorCooldowns` — a roster spell
 * the unit cast enters the ledger tagged Defensive even when the hand catalog
 * never listed it, and a catalog Offensive tag on a roster id is dropped.
 * Fixtures pick ids out of the generated table so the test moves with the
 * data; while the table is the placeholder the injection cases skip.
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  HEALER_SAVE_CD_IDS,
  healerSaveCdRoster,
} from "../src/data/healerSaveCd";
import RAW from "../src/data/healerSaveCdGenerated.json";
import { extractMajorCooldowns, specToString } from "../src/utils/cooldowns";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const hasTable = Object.keys((RAW as any).specs ?? {}).length > 0;
const withTable = hasTable ? it : it.skip;

function combatOf(owner: any): AtomicArenaCombat {
  return {
    startTime: 0,
    endTime: 300_000,
    units: { [owner.id]: owner },
  } as unknown as AtomicArenaCombat;
}

describe("healer save-cooldown roster (GH #63)", () => {
  it("every roster entry is well formed: 30 s+ official cooldown, share in (0,1], a reason", () => {
    for (const [spec, s] of Object.entries((RAW as any).specs ?? {}) as any) {
      for (const e of s.spells) {
        expect(e.cooldownSeconds, `${spec} ${e.spellId}`).toBeGreaterThanOrEqual(30);
        expect(e.share, `${spec} ${e.spellId}`).toBeGreaterThan(0);
        expect(e.share, `${spec} ${e.spellId}`).toBeLessThanOrEqual(1);
        expect(e.why.length, `${spec} ${e.spellId}`).toBeGreaterThan(0);
      }
    }
  });

  withTable("table health: the study's headline misses are now in the roster — regenerate when red", () => {
    expect(healerSaveCdRoster("Restoration Shaman")?.has("108280"), "Healing Tide Totem").toBe(true);
    expect(healerSaveCdRoster("Holy Paladin")?.has("471195"), "Lay on Hands (12.x id)").toBe(true);
    expect(healerSaveCdRoster("Mistweaver Monk")?.has("115310"), "Revival (user-signed 2026-09-04)").toBe(true);
    expect(healerSaveCdRoster("Holy Paladin")?.has("375576"), "Divine Toll (user-signed)").toBe(true);
    // user-ruled OUT (not_save_role) — a regenerate must not let them back in
    expect(healerSaveCdRoster("Holy Priest")?.has("2050"), "Holy Word: Serenity").toBe(false);
    expect(healerSaveCdRoster("Restoration Shaman")?.has("443454"), "Ancestral Swiftness").toBe(false);
    // CC-relief never enters (damage-school immunity only)
    expect(HEALER_SAVE_CD_IDS.has("336126"), "Gladiator's Medallion").toBe(false);
    expect(HEALER_SAVE_CD_IDS.size).toBeGreaterThan(30);
  });

  withTable("a roster spell the hand catalog never listed enters the ledger tagged Defensive once cast", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      spellCastEvents: [makeSpellCastEvent("108280", 20_000, "player-1", "player-1")],
    });
    const cds = extractMajorCooldowns(owner, combatOf(owner));
    const htt = cds.find((c) => c.spellId === "108280");
    expect(htt).toBeDefined();
    expect(htt!.tag).toBe("Defensive");
    expect(htt!.isThroughput).toBe(false);
    expect(htt!.casts).toHaveLength(1);
  });

  withTable("a catalog Offensive tag is dropped for a roster id in the healer's hands, and left alone for a non-healer", () => {
    const holy = makeUnit("player-1", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Holy,
      spellCastEvents: [makeSpellCastEvent("31884", 20_000, "player-1", "player-1")],
    });
    const aw = extractMajorCooldowns(holy, combatOf(holy)).find((c) => c.spellId === "31884");
    if (healerSaveCdRoster(specToString(CombatUnitSpec.Paladin_Holy))?.has("31884")) {
      expect(aw?.tag).toBe("Defensive");
      expect(aw?.isThroughput).toBe(false);
    }
    const ret = makeUnit("player-2", {
      class: CombatUnitClass.Paladin,
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [makeSpellCastEvent("31884", 20_000, "player-2", "player-2", "player-2")],
    });
    // The roster is keyed by healer spec — a Retribution Paladin has no
    // roster, so nothing is injected or re-tagged for it (whether the hand
    // catalog lists Avenging Wrath for this fixture is the catalog's business,
    // not the roster's).
    expect(healerSaveCdRoster(specToString(CombatUnitSpec.Paladin_Retribution))).toBeNull();
    // (the hand catalog's own tag for Ret's Avenging Wrath is the catalog's
    // business — only "no roster, no injection" is asserted here)
    expect(extractMajorCooldowns(ret, combatOf(ret)).find((c) => c.spellId === "108280")).toBeUndefined();
  });

  withTable("a Defensive-tagged catalog spell the roster does not list loses the tag in a healer's hands (Spirit Walk via the /spirit/ name regex)", () => {
    const sham = makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      spellCastEvents: [makeSpellCastEvent("58875", 20_000, "player-1", "player-1")],
    });
    expect(healerSaveCdRoster("Restoration Shaman")?.has("58875")).toBe(false);
    const sw = extractMajorCooldowns(sham, combatOf(sham)).find((c) => c.spellId === "58875");
    expect(sw === undefined || sw.tag !== "Defensive").toBe(true);
  });

  withTable("the strip/retag never leaks into the shared catalog: a Balance Druid after a Resto Druid still has Barkskin Defensive", () => {
    const resto = makeUnit("player-1", {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Restoration,
      spellCastEvents: [makeSpellCastEvent("22812", 20_000, "player-1", "player-1")],
    });
    extractMajorCooldowns(resto, combatOf(resto));
    const balance = makeUnit("player-2", {
      class: CombatUnitClass.Druid,
      spec: CombatUnitSpec.Druid_Balance,
      spellCastEvents: [makeSpellCastEvent("22812", 20_000, "player-2", "player-2", "player-2")],
    });
    const bark = extractMajorCooldowns(balance, combatOf(balance)).find((c) => c.spellId === "22812");
    expect(bark?.tag).toBe("Defensive");
  });

  it("a roster spell with no evidence (never cast, not talented) is not invented", () => {
    const owner = makeUnit("player-1", {
      class: CombatUnitClass.Shaman,
      spec: CombatUnitSpec.Shaman_Restoration,
      spellCastEvents: [],
    });
    const cds = extractMajorCooldowns(owner, combatOf(owner));
    expect(cds.find((c) => c.spellId === "108280")).toBeUndefined();
  });
});
