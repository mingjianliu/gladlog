/**
 * Triage 2026-09-29, group G13 — healer exposure and the enemy CC kit:
 *  - pets-summons F-PS3 (ruling A17 = A): a summon's CC is credited to its
 *    owner (`buildEnemyCCHistory`, keyed by the enemy player);
 *  - cc-dr F-KT1 (A17, R3 = A): the KIT header names the healer when the log
 *    owner is not the healer, and marks a spec default never seen landing;
 *  - cc-dr F-EX1 (ruling A′19): a window that opens while the healer is in a
 *    CC says so and drops the LoS-break advice.
 */
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildEnemyCCHistory,
  formatEnemyCCKitHeader,
  formatHealerExposureEntries,
} from "../src/utils/healerExposureAnalysis";
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

describe("cc-dr F-KT1 — the ENEMY CC KIT label and its spec defaults", () => {
  const threat = (over: object) => ({
    enemyName: "Alphawolf",
    enemySpec: "Restoration Druid",
    ccCategory: "Disorient",
    ccSpellName: "Cyclone",
    healerDRLevel: "Full" as const,
    losBlocked: false,
    ...over,
  });
  const exposures = [
    {
      atSeconds: 30,
      threats: [
        threat({ fromTemplate: true }),
        threat({
          enemyName: "Syrtangz",
          enemySpec: "Fury Warrior",
          ccCategory: "Stun",
          ccSpellName: "Shockwave",
        }),
      ],
    },
  ] as never;

  it("names the healer for a DPS owner and marks the spec default", () => {
    expect(formatEnemyCCKitHeader(exposures, "2(RDruid)")).toEqual([
      "ENEMY CC KIT (threats to your healer 2(RDruid) at enemy burst windows): Restoration Druid (Alphawolf): Cyclone [Disorient] (spec default, not seen); Fury Warrior (Syrtangz): Shockwave [Stun]",
    ]);
  });
  it("keeps 'threats to you' for a healer owner", () => {
    expect(formatEnemyCCKitHeader(exposures)[0]).toMatch(
      /^ENEMY CC KIT \(threats to you\): /,
    );
  });
});

describe("cc-dr F-EX1 — the healer is already in a CC at the window start", () => {
  const exposure = (over: object) =>
    ({
      atSeconds: 55.9,
      burstDangerLabel: "Critical",
      trinketState: "available",
      trinketAvailableAtSeconds: null,
      threats: [
        {
          enemyName: "Valkyirie",
          enemySpec: "Frost Mage",
          ccCategory: "Incapacitate",
          ccSpellName: "Polymorph",
          healerDRLevel: "Full",
          losBlocked: false,
        },
      ],
      exposureLabel: "Exposed",
      losBreak: { repositionYards: 16.7, blocksEnemyName: "Valkyirie" },
      ...over,
    }) as never;

  it("539b6ed0 shape: says the CC and drops the LoS break", () => {
    const [e] = formatHealerExposureEntries([
      exposure({ alreadyIn: { spellName: "Polymorph", untilSeconds: 61.567 } }),
    ]);
    expect(e!.line).toContain(
      "healer trinket ready — healer already in Polymorph until 1:01 (the DR levels count it) — exposure:",
    );
    expect(e!.line).not.toContain("LoS break");
  });
  it("control: not in a CC → the LoS break stays", () => {
    const [e] = formatHealerExposureEntries([exposure({})]);
    expect(e!.line).toContain("LoS break ~16.7yd away");
    expect(e!.line).not.toContain("already in");
  });
});
