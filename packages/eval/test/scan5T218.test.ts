/**
 * Pipeline T218: scan5/t218's reader of a guardian-kind damage label.
 */
import { describe, expect, it } from "vitest";

import { lineNamesGuardianDamage } from "../scripts/scan5/t218";

describe("scan5/t218 — `<pid>'s guardian — <spell>` 的读法", () => {
  it("3c8cd2a3 r0 修复前的行认得出;修复后的 totem 行不认", () => {
    expect(
      lineNamesGuardianDamage(
        "2:49  [DMG SPIKE]   … Top sources: 4(EShaman)'s guardian — Counterstrike [Nature] (317k), 5(SPriest) — Void Blast (210k)",
        "4",
        "Counterstrike",
      ),
    ).toBe(true);
    expect(
      lineNamesGuardianDamage(
        "2:49  [DMG SPIKE]   … Top sources: 4(EShaman)'s totem — Counterstrike [Nature] (317k)",
        "4",
        "Counterstrike",
      ),
    ).toBe(false);
  });

  it("编号是整词:14 号的行不算 4 号的", () => {
    expect(
      lineNamesGuardianDamage(
        "Top sources: 14(EShaman)'s guardian — Counterstrike (3k)",
        "4",
        "Counterstrike",
      ),
    ).toBe(false);
  });

  it("别的单位、更长的法术名不算", () => {
    const l = "Top sources: 5(EShaman)'s guardian — Counterstrike Totem (3k)";
    expect(lineNamesGuardianDamage(l, "4", "Counterstrike")).toBe(
      false,
    );
    expect(lineNamesGuardianDamage(l, "5", "Counterstrike")).toBe(
      false,
    );
    expect(
      lineNamesGuardianDamage(l, "5", "Counterstrike Totem"),
    ).toBe(true);
  });
});
