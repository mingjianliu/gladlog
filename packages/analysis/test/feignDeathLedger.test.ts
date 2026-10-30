/**
 * Feign Death 5384 (triage H15, user ruling 2026-09-30 R13 / A9-3): never
 * logged as a cast; Survival Tactics 202748 self-applied is the activation
 * AND the ownership evidence; a self response only (responseOnly), never an
 * ally save.
 */
import {
  AtomicArenaCombat,
  CombatUnitClass,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { spellEffectData } from "../src/data/spellEffectData";
import { buffFullDurationForCaster } from "../src/utils/buffDuration";
import {
  cdCanHelpAnotherUnit,
  extractMajorCooldowns,
  findCheaperDefensiveAlternatives,
} from "../src/utils/cooldowns";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const hunter = (withAura: boolean) =>
  makeUnit("player-1", {
    class: CombatUnitClass.Hunter,
    spec: CombatUnitSpec.Hunter_Marksmanship,
    info: { pvpTalents: [] },
    spellCastEvents: [],
    auraEvents: withAura
      ? [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "202748",
            224_452,
            "player-1",
            "player-1",
            "BUFF",
          ),
        ]
      : [],
  });
const fd = (u: ReturnType<typeof makeUnit>) =>
  extractMajorCooldowns(u, {
    startTime: 0,
    endTime: 300_000,
    units: { "player-1": u },
  } as unknown as AtomicArenaCombat).find((c) => c.spellId === "5384");

describe("Feign Death in the ledger (H15)", () => {
  it("a Survival Tactics aura admits it and counts as its press", () => {
    const e = fd(hunter(true))!;
    expect(e).toBeDefined();
    expect(e.casts.map((c) => c.timeSeconds)).toEqual([224.452]);
    expect(e.responseOnly).toBe(true);
    expect(cdCanHelpAnotherUnit(e)).toBe(false);
  });
  it("no press and no aura under COMBATANT_INFO → not admitted (no ownership evidence)", () => {
    expect(fd(hunter(false))).toBeUndefined();
  });
});

describe("Feign Death is never suggested (response-only)", () => {
  it("is not a 'cheaper available' alternative to Aspect of the Turtle", () => {
    const u = hunter(true);
    const cds = extractMajorCooldowns(u, {
      startTime: 0,
      endTime: 300_000,
      units: { "player-1": u },
    } as unknown as AtomicArenaCombat);
    const turtle = {
      spellId: "186265",
      spellName: "Aspect of the Turtle",
      tag: "Defensive",
      cooldownSeconds: 180,
      casts: [{ timeSeconds: 260 }],
      neverUsed: false,
      availableWindows: [],
    } as never;
    expect(findCheaperDefensiveAlternatives(turtle, cds, 260)).not.toContain(
      "Feign Death",
    );
  });
});

describe("Feign Death has no fixed duration", () => {
  it("DB2's 360 s is an upper bound ('lasts up to $d') — the buff-duration source answers unknown", () => {
    expect(spellEffectData["5384"]?.durationSeconds).toBe(360);
    expect(buffFullDurationForCaster("5384", undefined)).toBeUndefined();
    expect(buffFullDurationForCaster("5384", hunter(true))).toBeUndefined();
    // Survival Tactics keeps its own real 2 s
    expect(buffFullDurationForCaster("202748", undefined)).toBe(2);
  });
});
