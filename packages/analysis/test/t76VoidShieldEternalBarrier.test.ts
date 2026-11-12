/**
 * T76 (GH #123): Eternal Barrier 238135 lengthens Power Word: Shield by 5 s
 * by a class mask that also covers Void Shield 1253593 — the same button
 * under Master the Darkness. 605 files: 334 clean applications ran exactly
 * 5 s past the 15 s the predicate read.
 */
import { CombatUnitSpec } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import { talentModifierOwnershipOf } from "../src/utils/talentOwnership";
import { makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

// Discipline spec node 86730 / entry 103688 (talentIdMap.json)
const ETERNAL_BARRIER = { id1: 86730, id2: 103688, count: 1 };
const VOID_SHIELD = "1253593";

describe("Void Shield under Eternal Barrier", () => {
  it("a Discipline holder's Void Shield runs 20 s, as its Power Word: Shield does", () => {
    const holder = makeUnit("p1", {
      spec: CombatUnitSpec.Priest_Discipline,
      info: { talents: [ETERNAL_BARRIER], pvpTalents: [] } as never,
    });
    expect(talentModifierOwnershipOf(holder, "238135")).toBe("yes");
    expect(buffFullDurationForCaster(VOID_SHIELD, holder)).toBe(20);
    expect(buffFullDurationForCaster("17", holder)).toBe(20);
  });

  it("no caster, and a Shadow priest, keep the DB2 15 s", () => {
    expect(buffFullDurationForCaster(VOID_SHIELD, undefined)).toBe(15);
    const shadow = makeUnit("p2", {
      spec: CombatUnitSpec.Priest_Shadow,
      info: { talents: [ETERNAL_BARRIER], pvpTalents: [] } as never,
    });
    expect(buffFullDurationForCaster(VOID_SHIELD, shadow)).toBe(15);
  });
});
