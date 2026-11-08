import { describe, expect, it, vi } from "vitest";

import {
  cdIsDeathSaveOf,
  SURVIVAL_TACTICS_TALENT_ID,
} from "../src/utils/cooldowns";

// T24 ruling R05 (2026-11-08): a Feign Death press of a hunter without
// Survival Tactics stays in the ledger, but it is no save left unpressed at
// a death ([DEATH] (Unused: …), [DEFENSIVE AVAILABLE]).
vi.mock("../src/utils/talentOwnership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/talentOwnership")>()),
  talentModifierOwnershipOf: (
    unit: { info: { holds?: string[] } | null },
    talentSpellId: string,
  ) =>
    unit.info === null
      ? "unknown"
      : (unit.info.holds ?? []).includes(talentSpellId)
        ? "yes"
        : "no",
}));

const FEIGN = { spellId: "5384" };
const hunter = (
  info: { holds?: string[] } | null,
  auraIds: string[] = [],
) =>
  ({
    spec: "253",
    info,
    spellCastEvents: [],
    auraEvents: auraIds.map((spellId) => ({ spellId })),
  }) as never;

describe("Feign Death is a death save only with Survival Tactics", () => {
  it("holder: yes; without the talent: no; unknown: no", () => {
    expect(
      cdIsDeathSaveOf(FEIGN, hunter({ holds: [SURVIVAL_TACTICS_TALENT_ID] })),
    ).toBe(true);
    expect(cdIsDeathSaveOf(FEIGN, hunter({ holds: [] }))).toBe(false);
    expect(cdIsDeathSaveOf(FEIGN, hunter(null))).toBe(false);
  });

  it("its Survival Tactics aura seen this round proves the talent", () => {
    expect(cdIsDeathSaveOf(FEIGN, hunter(null, ["202748"]))).toBe(true);
  });

  it("every other cooldown is unaffected", () => {
    expect(cdIsDeathSaveOf({ spellId: "186265" }, hunter({ holds: [] }))).toBe(
      true,
    );
  });
});
