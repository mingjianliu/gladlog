/**
 * B9 (user 2026-10-24): `talentOwnershipOf` reads an activation only the
 * press can make (`AURA_ACTIVATION_PROVES_BUTTON_IDS`) as cast evidence, as
 * the ledger's ownership filter does — a Feign Death seen only through
 * Survival Tactics' 202748.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { talentOwnershipOf } from "../src/utils/talentOwnership";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("talentOwnershipOf — aura-proved presses", () => {
  const FEIGN = "5384";
  it("a Survival Tactics activation on the hunter proves Feign Death", () => {
    const hunter = makeUnit("h", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "202748", 1_000, "h", "h", "BUFF"),
      ],
    });
    expect(talentOwnershipOf(hunter, FEIGN)).toBe("yes");
  });
  it("the same aura from someone else proves nothing", () => {
    const hunter = makeUnit("h", {
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "202748", 1_000, "x", "h", "BUFF"),
      ],
    });
    expect(talentOwnershipOf(hunter, FEIGN)).not.toBe("yes");
  });
});
