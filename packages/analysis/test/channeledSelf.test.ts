/**
 * fact3 D36 (6f49c8f0 0:26): a self-channelled spell (DB2 SpellMisc
 * Attributes_1 0x40 without 0x4) is a channel unless it is empowered — Dark
 * Harvest is, Fire Breath / Dream Breath are not.
 */
import { describe, expect, it } from "vitest";

import { CHANNELED_SPELL_IDS } from "../src/data/channeledGenerated";

describe("CHANNELED_SPELL_IDS — self-channelled spells", () => {
  it("Dark Harvest, Emerald Communion, Celestial Conduit are channels", () => {
    for (const id of ["1257052", "370960", "443028"])
      expect(CHANNELED_SPELL_IDS.has(id), id).toBe(true);
  });
  it("an empowered spell is not (Fire Breath, Dream Breath)", () => {
    for (const id of ["357208", "382266", "355936", "382614"])
      expect(CHANNELED_SPELL_IDS.has(id), id).toBe(false);
  });
});
