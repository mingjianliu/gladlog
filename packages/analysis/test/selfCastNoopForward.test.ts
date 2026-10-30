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
import { ENEMY_REDIRECT_SAVE_IDS } from "../src/data/spellIdLists";
import {
  canonicalSpellId,
  isAllyCastableDefensive,
  SELF_CAST_NOOP_EXTERNAL_IDS,
} from "../src/utils/cooldowns";

describe("SELF_CAST_NOOP_EXTERNAL_IDS ↔ DB2 Exclude Caster", () => {
  beforeAll(async () => {
    await ensureAnalysisData();
  });

  // the universe is read on the canonical id (a talent variant — Ultimate
  // Sacrifice 199448 — is Blessing of Sacrifice's row, codex 20-G167-04),
  // the bit and the list on the logged one. It is every save the ledger can
  // list: the ally-castable defensives and the grips / redirects (Intervene,
  // Leap of Faith — codex 20-G167-08)
  it("forward: an observed ally-castable defensive with Exclude Caster is on the list", () => {
    const missing = (observed as number[])
      .map(String)
      .filter(
        (id) =>
          (isAllyCastableDefensive(canonicalSpellId(id)) ||
            ENEMY_REDIRECT_SAVE_IDS.has(id)) &&
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
