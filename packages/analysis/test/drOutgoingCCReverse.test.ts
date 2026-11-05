/**
 * BACKLOG #24: `analyzeOutgoingCCChains(friendlies, enemies, combat)` used to
 * filter its target side by a hardcoded `e.reaction === CombatUnitReaction.Hostile`
 * check. That's correct for the product's only call shape, `(friends, enemies)`,
 * but `matchExplore.ts`'s `dr` query and `archetypeInference.ts` also call it
 * reversed as `(enemies, friends)` to get the other direction's CC chains — and
 * a friendly target's reaction is `Friendly`, so the Hostile filter silently
 * dropped every target and the reversed call always returned `[]`.
 *
 * Fix: the target filter is now "is a Player unit AND belongs to the passed
 * second-arg collection" (id-set membership), which is satisfied by design in
 * both call directions since the function always maps over its own second
 * argument. `reaction` is no longer consulted for targeting.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";

import { analyzeOutgoingCCChains } from "../src/utils/outgoingCcChains";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

const MATCH_START = 1_000_000;
const S = (sec: number) => MATCH_START + sec * 1000;
const COMBAT = {
  startTime: MATCH_START,
  endTime: MATCH_START + 60_000,
  startInfo: { zoneId: "0" },
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("analyzeOutgoingCCChains — target filter is param-membership, not reaction (#24)", () => {
  it("reverse call (enemies, friends): enemy stun landing on a friendly returns the chain (was empty)", () => {
    const enemyCaster = makeUnit("e1", {
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Hostile,
    });
    const friendlyTarget = makeUnit("f1", {
      name: "Girlbye",
      spec: CombatUnitSpec.Priest_Holy,
      // default reaction is Friendly (see testHelpers.makeUnit) — this is
      // exactly the case the old Hostile-only filter dropped.
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "408", S(10), "e1", "f1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "408", S(13), "e1", "f1"),
      ],
    });

    const chains = analyzeOutgoingCCChains(
      [enemyCaster] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      [friendlyTarget] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      COMBAT,
    );

    expect(chains).toHaveLength(1);
    expect(chains[0].targetName).toBe("Girlbye");
    expect(chains[0].applications).toHaveLength(1);
    expect(chains[0].applications[0].spellId).toBe("408");
    expect(chains[0].applications[0].durationSeconds).toBeCloseTo(3);
    expect(chains[0].applications[0].drInfo.category).toBe("Stun");
  });

  it("forward call (friends, enemies): parity with pre-fix behavior — same fixture shape, roles swapped", () => {
    const friendlyCaster = makeUnit("h1", {
      spec: CombatUnitSpec.Paladin_Holy,
    });
    const enemyTarget = makeUnit("e1", {
      name: "Boofers",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "408", S(10), "h1", "e1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "408", S(13), "h1", "e1"),
      ],
    });

    const chains = analyzeOutgoingCCChains(
      [friendlyCaster] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      [enemyTarget] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      COMBAT,
    );

    // Snapshot captured by running this exact fixture against the pre-fix
    // implementation (hardcoded `reaction === Hostile` target filter) before
    // touching drAnalysis.ts — values must not move after the fix, since the
    // forward call direction's semantics are unchanged (membership in
    // `enemies` and `reaction === Hostile` coincide for every real product
    // callsite, which always passes an all-Hostile enemies array).
    expect(chains).toHaveLength(1);
    expect(chains[0].targetName).toBe("Boofers");
    expect(chains[0].targetSpec).toBe("Arms Warrior");
    expect(chains[0].applications).toHaveLength(1);
    expect(chains[0].applications[0].spellId).toBe("408");
    expect(chains[0].applications[0].casterName).toBe("Source");
    expect(chains[0].applications[0].casterSpec).toBe("Holy Paladin");
    expect(chains[0].applications[0].durationSeconds).toBeCloseTo(3);
    expect(chains[0].applications[0].drInfo).toEqual({
      category: "Stun",
      level: "Full",
      sequenceIndex: 0,
    });
  });
});
