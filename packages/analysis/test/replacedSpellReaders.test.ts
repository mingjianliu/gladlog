/**
 * The readers that answer "does this unit have spell X" WITHOUT
 * `replacedSpellIds` (docs/predicate-index.md, "Not yet unified", F22). Each is
 * deliberate for the ids it can name today. A new replacement pair landing on
 * one of these tables turns this red, and the answer is then to decide that
 * reader, not to update the list.
 */
import { describe, expect, it } from "vitest";

import { PVP_TALENT_REPLACES_GENERATED } from "../src/data/pvpTalentReplacesGenerated";
import { TALENT_REPLACES } from "../src/data/talentReplaces";
import { TALENT_REPLACES_GENERATED } from "../src/data/talentReplacesGenerated";
import {
  CLEANSE_SPELLS_BY_TYPE,
  PURGE_SPELLS_BY_SPEC,
} from "../src/utils/dispelAnalysis";
import { INTERRUPT_SPELL_IDS } from "../src/utils/enemyInterrupts";
import { SPEC_PRIMARY_CC } from "../src/utils/healerExposureAnalysis";

const replaced = new Set(
  [
    TALENT_REPLACES,
    TALENT_REPLACES_GENERATED,
    PVP_TALENT_REPLACES_GENERATED,
  ].flatMap((t) => Object.values(t).flat()),
);
const named = (ids: Iterable<string | undefined>) =>
  [...new Set(ids)]
    .filter((id): id is string => id !== undefined && replaced.has(id))
    .sort();

describe("kit readers off the ledger name only the replaced ids they were judged for", () => {
  it("SPEC_PRIMARY_CC: Hammer of Justice, a template printed as not seen", () => {
    expect(named(SPEC_PRIMARY_CC.map((e) => e.spellId))).toEqual(["853"]);
  });

  it("the interrupt kit: none", () => {
    expect(named(INTERRUPT_SPELL_IDS)).toEqual([]);
  });

  it("the purge table: Spellsteal, known off the ledger (GH #174)", () => {
    expect(named(Object.values(PURGE_SPELLS_BY_SPEC).flat())).toEqual([
      "30449",
    ]);
  });

  it("the cleanse table: none", () => {
    expect(
      named(
        Object.values(CLEANSE_SPELLS_BY_TYPE).flatMap((bySpec) =>
          Object.values(bySpec ?? {}).flat(),
        ),
      ),
    ).toEqual([]);
  });
});
