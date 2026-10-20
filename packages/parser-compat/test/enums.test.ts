import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { describe, expect,it } from "vitest";

import * as Enums from "../src/enums";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(
  __dirname,
  "../data/legacy-enum-manifest.json",
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

function getEnumMemberNames(tsEnum: any): string[] {
  return Object.keys(tsEnum).filter((key) => isNaN(Number(key)));
}

describe("Legacy Enum Compatibility", () => {
  it("should match the manifest exactly for LogEvent", () => {
    const manifestEnum = manifest.LogEvent;
    const tsEnum = Enums.LogEvent;

    expect(getEnumMemberNames(tsEnum).length).toBe(51);

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  // Since 2026-08-01 CombatUnitSpec/CombatUnitClass are generated from
  // Blizzard's DB2 (see packages/analysis/scripts/datagen/genCombatUnitEnums.ts
  // and docs/DATA-COMPLIANCE.md). The manifest is still the historical record of
  // the old runtime dump, but what we guarantee has changed: we guarantee the
  // **values** — the Blizzard facts — no longer the member names or the private
  // numbering.

  it("covers every specId in the manifest (values are Blizzard facts)", () => {
    const manifestEnum = manifest.CombatUnitSpec;
    const tsEnum = Enums.CombatUnitSpec;

    expect(getEnumMemberNames(tsEnum).length).toBe(41);

    // Compare by specId value, not by member name — the generator builds names
    // from the official Name_lang, which differs from the old dump in one case,
    // Monk_BrewMaster vs Monk_Brewmaster (Blizzard writes "Brewmaster").
    const ours = new Set(Object.values(tsEnum) as string[]);
    for (const key of Object.keys(manifestEnum)) {
      expect(ours.has(manifestEnum[key])).toBe(true);
    }
  });

  it("uses official ChrClasses IDs for CombatUnitClass (diverges from the legacy dump on purpose)", () => {
    const tsEnum = Enums.CombatUnitClass;

    expect(getEnumMemberNames(tsEnum).length).toBe(14);

    // Official ChrClasses.ID. The old dump used an outside project's invented
    // numbering (1=Warrior, 2=Hunter, …), abandoned when the enums became
    // generated; what is pinned here is the Blizzard fact, not that numbering.
    // The differential oracle does not compare the class field (normalize.ts's
    // NormUnit only takes spec/reaction/type), so changing these values does not
    // affect the parity gate.
    const official: Record<string, number> = {
      Warrior: 1,
      Paladin: 2,
      Hunter: 3,
      Rogue: 4,
      Priest: 5,
      DeathKnight: 6,
      Shaman: 7,
      Mage: 8,
      Warlock: 9,
      Monk: 10,
      Druid: 11,
      DemonHunter: 12,
      Evoker: 13,
    };
    for (const [name, id] of Object.entries(official)) {
      expect((tsEnum as any)[name]).toBe(id);
    }
    expect(tsEnum.None).toBe(0);

    // The old numbering must not quietly return: Hunter was 2 in the old dump,
    // officially it is 3.
    expect((tsEnum as any).Hunter).not.toBe(manifest.CombatUnitClass.Hunter);
  });

  it("should match the manifest exactly for CombatUnitReaction", () => {
    const manifestEnum = manifest.CombatUnitReaction;
    const tsEnum = Enums.CombatUnitReaction;

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it("should match the manifest exactly for CombatUnitType", () => {
    const manifestEnum = manifest.CombatUnitType;
    const tsEnum = Enums.CombatUnitType;

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it("should match the manifest exactly for CombatResult", () => {
    const manifestEnum = manifest.CombatResult;
    const tsEnum = Enums.CombatResult;

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it("should match the manifest exactly for CombatUnitPowerType", () => {
    const manifestEnum = manifest.CombatUnitPowerType;
    const tsEnum = Enums.CombatUnitPowerType;

    expect(getEnumMemberNames(tsEnum).length).toBe(22);

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      // Convert to number because manifest has string values for CombatUnitPowerType (e.g. "-2")
      const expectedVal = Number(manifestVal);
      expect((tsEnum as any)[key]).toBe(expectedVal);
    }
  });
});
