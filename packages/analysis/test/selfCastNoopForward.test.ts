/**
 * GH #167 (Curated-List Completeness): `SELF_CAST_NOOP_EXTERNAL_IDS` against
 * DB2 — SpellMisc Attributes_1 bit 19 "Exclude Caster"
 * (`excludeCasterGenerated.ts`, `genExcludeCaster.ts`). Forward: every
 * observed ally-castable defensive the game will not let its caster target
 * is on the hand list. Reverse: every entry carries the bit.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { EXCLUDE_CASTER_SPELL_IDS } from "../src/data/excludeCasterGenerated";
import observed from "../src/data/observedSpellIdsGenerated.json";
import {
  isAllyCastableDefensive,
  SELF_CAST_NOOP_EXTERNAL_IDS,
} from "../src/utils/cooldowns";

describe("SELF_CAST_NOOP_EXTERNAL_IDS ↔ DB2 Exclude Caster", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  it("forward: an observed ally-castable defensive with Exclude Caster is on the list", () => {
    const missing = (observed as number[])
      .map(String)
      .filter(
        (id) =>
          isAllyCastableDefensive(id) &&
          EXCLUDE_CASTER_SPELL_IDS.has(id) &&
          !SELF_CAST_NOOP_EXTERNAL_IDS.has(id),
      );
    expect(missing).toEqual([]);
  });

  it("reverse: every entry carries Exclude Caster", () => {
    expect(
      [...SELF_CAST_NOOP_EXTERNAL_IDS].filter(
        (id) => !EXCLUDE_CASTER_SPELL_IDS.has(id),
      ),
    ).toEqual([]);
  });
});
