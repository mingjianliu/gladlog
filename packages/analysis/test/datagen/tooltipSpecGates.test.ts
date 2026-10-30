import { describe, expect, it } from "vitest";

import {
  effectSpecGates,
  onlySpecIdsFor,
  UNREFERENCED,
} from "../../scripts/datagen/lib/tooltipSpecGates";
import talentModifiers from "../../src/data/talentModifiers.json";
import { applyCdModifiers } from "../../src/utils/cooldowns";
import type { ICDModifier } from "../../src/utils/talentModifiers";

const MAGE = { ordered: ["62", "63", "64"] };
const PRIEST = { ordered: ["256", "257", "258"] };
const DRUID = { ordered: ["102", "103", "104", "105"] };
// spec passives (SpecializationSpells): Disc 137032, Balance 137013
const specOf = (id: string) => ({ "137032": ["256"], "137013": ["102"] })[id];

describe("tooltip spec branches gate a talent's effect rows (GH #124)", () => {
  it("Elemental Affinity: Fire's row is effect 0 (Frost spells), Frost's is effect 2 (Fire spells)", () => {
    const g = effectSpecGates(
      "$?c2[The cooldown of Frost spells with a base cooldown shorter than $s4 minutes is reduced by $s1%.]?c3[The cooldown of Fire spells is reduced by $s3%.][]",
      MAGE,
      specOf,
    );
    expect(onlySpecIdsFor(g, 0, MAGE)).toEqual(["63"]);
    expect(onlySpecIdsFor(g, 2, MAGE)).toEqual(["64"]);
    expect(onlySpecIdsFor(g, 3, MAGE)).toEqual(["63"]);
    expect(onlySpecIdsFor(g, 1, MAGE)).toBe(UNREFERENCED);
  });

  it("a spec-aura branch and its else (Waste No Time)", () => {
    const g = effectSpecGates(
      "Reduces the cooldown of $?a137032[Power Word: Shield by ${$s2/-1000}.1 sec.][Prayer of Mending by ${$s1/-1000}.1 sec.]",
      PRIEST,
      specOf,
    );
    expect(onlySpecIdsFor(g, 1, PRIEST)).toEqual(["256"]);
    expect(onlySpecIdsFor(g, 0, PRIEST)).toEqual(["257", "258"]);
  });

  it("a negated condition (Starlight Conduit: not Balance)", () => {
    const g = effectSpecGates(
      "Wrath damage increased by $s1%. $?!a137013[ Starsurge's cooldown is reduced by ${-$s2/1000} sec.][]",
      DRUID,
      specOf,
    );
    expect(onlySpecIdsFor(g, 1, DRUID)).toEqual(["103", "104", "105"]);
    expect(onlySpecIdsFor(g, 0, DRUID)).toBeUndefined(); // unconditional
  });

  it("an unknown condition (a talent, not a spec passive) gates nothing", () => {
    const g = effectSpecGates(
      "$?s999[Reduces X by $s1 sec.][Reduces Y by $s2 sec.]",
      MAGE,
      specOf,
    );
    expect(onlySpecIdsFor(g, 0, MAGE)).toBeUndefined();
    expect(onlySpecIdsFor(g, 1, MAGE)).toBeUndefined();
  });

  it("an effect referenced outside every branch applies to every holder", () => {
    const g = effectSpecGates(
      "Cooldown of $?c1[Die By the Sword][Shield Wall] reduced by $s1%.",
      { ordered: ["71", "72", "73"] },
      specOf,
    );
    expect(onlySpecIdsFor(g, 0, { ordered: ["71", "72", "73"] })).toBe(
      undefined,
    );
  });

  it("generated: Dragon's Breath takes Elemental Affinity for Frost only; Ring of Frost for Fire only", () => {
    const mods = talentModifiers as Record<string, ICDModifier[]>;
    const ea = (target: string) =>
      mods[target]!.find((m) => m.talentSpellId === "431067");
    expect(ea("31661")?.onlySpecIds).toEqual(["64"]);
    expect(ea("113724")?.onlySpecIds).toEqual(["63"]);
    // effect 4 (Frost Nova's charge category) names no $s in the tooltip and
    // takes effect 0's gate through the shared target
    expect(ea("122")?.onlySpecIds).toEqual(["63"]);
    const cd = (specId: string) =>
      applyCdModifiers(
        mods["31661"],
        45,
        1,
        new Set(["387807", "431067"]),
        new Set(),
        { specId },
      ).cooldownSeconds;
    // corpus floors (2,240 files): Fire 40.0 s over 372 recasts, Frost 28.2
    expect(cd("63")).toBe(40);
    expect(cd("64")).toBe(28);
    // an unknown spec gets the gated row neither way — the longer cooldown
    expect(
      applyCdModifiers(
        mods["31661"],
        45,
        1,
        new Set(["387807", "431067"]),
        new Set(),
        {},
      ).cooldownSeconds,
    ).toBe(40);
  });
});
