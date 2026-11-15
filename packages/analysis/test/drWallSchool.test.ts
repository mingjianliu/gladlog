/**
 * Pipeline T124: once Anti-Magic Zone's source-less aura 145629 is keyed by
 * its cast 51052, ABILITIES INTO IMMUNITY/DR sees it as a damage-reduction
 * wall — a magic-only one (0x7e). A physical cast into it is reduced by
 * nothing and is not "into" it.
 */
import { describe, expect, it } from "vitest";

import { drWallMissesSpellSchool } from "../src/utils/enemyDefensives";

describe("drWallMissesSpellSchool (pipeline T124)", () => {
  it("a physical spell into Anti-Magic Zone's aura is reduced by nothing", () => {
    expect(drWallMissesSpellSchool("145629", "12294")).toBe(true); // Mortal Strike
    expect(drWallMissesSpellSchool("51052", "100780")).toBe(true); // Tiger Palm
  });
  it("a magic spell into it is reduced", () => {
    expect(drWallMissesSpellSchool("145629", "78674")).toBe(false); // Starsurge
    expect(drWallMissesSpellSchool("145629", "55090")).toBe(false); // Scourge Strike (shadow)
  });
  it("a wall of every school, an immunity, an unknown spell: never", () => {
    expect(drWallMissesSpellSchool("22812", "12294")).toBe(false); // Barkskin
    expect(drWallMissesSpellSchool("31224", "12294")).toBe(false); // Cloak of Shadows (immunity: its own predicate)
    expect(drWallMissesSpellSchool("145629", "999999999")).toBe(false);
  });
});
