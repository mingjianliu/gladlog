/**
 * Triage 2026-09-29, group G13 — healer exposure and the enemy CC kit:
 *  - pets-summons F-PS3 (ruling A17 = A): a summon's CC is credited to its
 *    owner (`buildEnemyCCHistory`, keyed by the enemy player).
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { buildEnemyCCHistory } from "../src/utils/healerExposureAnalysis";
import { makeUnit } from "./ported/testHelpers";

const cc = (sourceId: string, sourceName: string) => ({
  atSeconds: 10,
  durationSeconds: 3,
  spellId: "118905", // Static Charge (Capacitor Totem's stun)
  spellName: "Capacitor Totem",
  sourceName,
  sourceId,
});

describe("pets-summons F-PS3 — a summon's CC is its owner's", () => {
  const shaman = makeUnit("e-sham", {
    name: "Frogtide",
    reaction: CombatUnitReaction.Hostile,
  });
  const totem = makeUnit("totem-1", {
    name: "Capacitor Totem",
    reaction: CombatUnitReaction.Hostile,
    ownerId: "e-sham",
  });
  const summary = (c: ReturnType<typeof cc>) =>
    ({ playerName: "Me", ccInstances: [c] }) as never;

  it("a totem's stun is keyed to the Shaman", () => {
    const h = buildEnemyCCHistory(
      [summary(cc("totem-1", "Capacitor Totem"))],
      [shaman],
      [shaman, totem],
    );
    expect([...h.keys()]).toEqual(["Frogtide"]);
    expect(h.get("Frogtide")![0]!.spellName).toBe("Capacitor Totem");
  });

  it("control: without the unit table a summon's CC is skipped, never keyed by the summon's name", () => {
    const h = buildEnemyCCHistory(
      [summary(cc("totem-1", "Capacitor Totem"))],
      [shaman],
    );
    expect(h.size).toBe(0);
  });

  it("a player's own CC is keyed to that player", () => {
    const h = buildEnemyCCHistory(
      [summary(cc("e-sham", "Frogtide"))],
      [shaman],
      [shaman],
    );
    expect([...h.keys()]).toEqual(["Frogtide"]);
  });
});
